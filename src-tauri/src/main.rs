#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
use std::{
    io::Write,
    path::{Path, PathBuf},
    process::{Command, Stdio},
    sync::Mutex,
};
mod calculation_worker;
mod menu_check;
mod menus;
mod portable;
mod recent_projects;
mod tools;
mod window_check;
use tauri::Manager;
use tauri_plugin_dialog::DialogExt;

#[derive(Default)]
struct WorkspaceSelection(Mutex<Option<PathBuf>>);
// Explicit selection is session-only. Never restore another app installation's
// machine-global locator; portable preferences live inside the project.
const DATA_SECTIONS: [&str; 8] = ["root", "projects", "materials", "spectra", "exports", "database", "imports", "config"];
static PROJECT_OVERRIDE: Mutex<Option<PathBuf>> = Mutex::new(None);

fn engine_command(app: &tauri::AppHandle) -> Result<Command, String> {
    let mut command = if cfg!(debug_assertions) {
        let project = Path::new(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .ok_or("无法定位开发目录")?;
        let python = if cfg!(windows) {
            project.join(".venv/Scripts/python.exe")
        } else {
            project.join(".venv/bin/python")
        };
        let mut cmd = Command::new(python);
        cmd.arg(project.join("engine/main.py"));
        cmd
    } else {
        let executable = if cfg!(windows) {
            "tfc-engine.exe"
        } else {
            "tfc-engine"
        };
        Command::new(
            app.path()
                .resource_dir()
                .map_err(|e| e.to_string())?
                .join("engine")
                .join(executable),
        )
    };
    #[cfg(windows)] { use std::os::windows::process::CommandExt; command.creation_flags(0x08000000); }
    Ok(command)
}

fn run_engine(
    app: &tauri::AppHandle,
    root: Option<&Path>,
    create: bool,
    request: serde_json::Value,
) -> Result<serde_json::Value, String> {
    if request["action"] == "calculate" {
        return app.state::<calculation_worker::CalculationWorker>().calculate(app, request);
    }
    let mut command = engine_command(app)?;
    // The frontend cannot choose arbitrary roots inside a business request.
    command
        .env_remove("TFC_WORKSPACE_ROOT")
        .env_remove("TFC_CREATE_WORKSPACE");
    if let Some(root) = root {
        command.env("TFC_WORKSPACE_ROOT", root);
    }
    if create {
        command.env("TFC_CREATE_WORKSPACE", "1");
    }
    let legacy = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("projects.sqlite3");
    command.env("TFC_LEGACY_DATABASE", legacy);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000);
    }
    let mut child = command
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("无法启动本地服务：{e}"))?;
    child
        .stdin
        .take()
        .ok_or("进程输入不可用")?
        .write_all(&serde_json::to_vec(&request).map_err(|e| e.to_string())?)
        .map_err(|e| e.to_string())?;
    let output = child.wait_with_output().map_err(|e| e.to_string())?;
    if !output.status.success() {
        return Err(format!(
            "本地服务退出：{}",
            String::from_utf8_lossy(&output.stderr)
        ));
    }
    let mut value: serde_json::Value =
        serde_json::from_slice(&output.stdout).map_err(|e| format!("本地响应格式错误：{e}"))?;
    if let Some(error) = value.get("error").and_then(|v| v.as_str()) {
        return Err(error.to_owned());
    }
    if let Some(workspace) = value.get_mut("workspace").and_then(|v| v.as_object_mut()) {
        let project = project_folder()?;
        workspace.insert("project_root".into(), serde_json::json!(project));
        workspace.insert(
            "location_mode".into(),
            serde_json::json!("project-relative"),
        );
        if let Some(root) = root {
            workspace.insert(
                "relative_path".into(),
                serde_json::json!(portable::relative(&project, root)?),
            );
        }
    }
    Ok(value)
}

fn project_folder() -> Result<PathBuf, String> {
    if let Some(root) = PROJECT_OVERRIDE.lock().map_err(|e| e.to_string())?.as_ref() {
        return root
            .canonicalize()
            .map_err(|e| format!("所选项目位置不可用：{e}，请重新选择项目文件夹"));
    }
    let executable = std::env::current_exe().map_err(|e| e.to_string())?;
    let development = if cfg!(debug_assertions) {
        Path::new(env!("CARGO_MANIFEST_DIR")).parent()
    } else {
        None
    };
    portable::project_root(&executable, development)
}
fn current_workspace(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let state = app.state::<WorkspaceSelection>();
    let mut selection = state.0.lock().map_err(|_| "工作区状态不可用")?;
    if let Some(root) = selection.as_ref() {
        return Ok(root.clone());
    }
    let project = project_folder()?;
    let (root, create) = portable::selected(&project)?;
    run_engine(app, Some(&root), create, serde_json::json!({"action":"workspace_info"}))
        .map_err(|e| format!("项目内工作区不可用：{e}。请确认整个项目文件夹可写且数据目录仍在原位；不会改用本机磁盘。"))?;
    portable::remember(&project, &root)?;
    *selection = Some(root.clone());
    Ok(root)
}

#[tauri::command]
async fn engine_request(
    window: tauri::WebviewWindow,
    app: tauri::AppHandle,
    request: serde_json::Value,
) -> Result<serde_json::Value, String> {
    menus::require_main(&window)?;
    tauri::async_runtime::spawn_blocking(move || {
        let action = request["action"].as_str().unwrap_or("");
        if action == "workspace_copy" {
            return Err("请使用工作区面板的迁入操作".into());
        }
        let pure = matches!(
            action,
            "calculate"
                | "calculate_rt"
                | "analyze"
                | "validate"
                | "export_project"
                | "import_tfd"
                | "catalogue_list"
                | "catalogue_get"
                | "material_validate"
                | "materials_validate"
        );
        let root = if pure {
            None
        } else {
            Some(current_workspace(&app)?)
        };
        run_engine(&app, root.as_deref(), false, request)
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
async fn material_check(
    window: tauri::WebviewWindow,
    app: tauri::AppHandle,
    materials: serde_json::Value,
) -> Result<serde_json::Value, String> {
    if !["main", "tool-materials", "tool-substrate", "tool-materialdata"].contains(&window.label()) {
        return Err("此窗口无权校验材料".into());
    }
    if materials.to_string().len() > 2_000_000 {
        return Err("材料数据不能超过 2 MB".into());
    }
    tauri::async_runtime::spawn_blocking(move || {
        run_engine(
            &app,
            None,
            false,
            serde_json::json!({"action":"materials_validate","materials":materials}),
        )
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
async fn catalogue_read(
    window: tauri::WebviewWindow,
    app: tauri::AppHandle,
    name: String,
) -> Result<serde_json::Value, String> {
    if window.label() != "main" && !window.label().strip_prefix("tool-").map(tools::valid).unwrap_or(false) {
        return Err("此窗口无权读取材料目录".into());
    }
    tauri::async_runtime::spawn_blocking(move || {
        run_engine(
            &app,
            None,
            false,
            serde_json::json!({"action":"catalogue_get","name":name}),
        )
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
async fn project_pick(
    window: tauri::WebviewWindow,
    app: tauri::AppHandle,
) -> Result<Option<serde_json::Value>, String> {
    menus::require_main(&window)?;
    tauri::async_runtime::spawn_blocking(move|| {
        let Some(folder)=app.dialog().file().set_parent(&window).set_title("选择 TFC 便携项目文件夹或已有 Workspace").blocking_pick_folder() else {return Ok(None);};
        let picked=folder.into_path().map_err(|e|e.to_string())?.canonicalize().map_err(|e|e.to_string())?;
        let (project,workspace,create)=if picked.join("workspace.json").is_file() {
            let parent=picked.parent().ok_or("工作区缺少项目父目录")?;
            let project=parent.ancestors().find(|p|p.join(portable::MARKER).exists()).unwrap_or(parent).to_path_buf();
            (project,picked,false)
        } else {
            let (workspace,create)=portable::selected(&picked)?;
            (picked,workspace,create)
        };
        let old=PROJECT_OVERRIDE.lock().map_err(|e|e.to_string())?.replace(project.clone());
        let result=(|| {
            let result=run_engine(&app,Some(&workspace),create,serde_json::json!({"action":"workspace_info"}))?;
            portable::remember(&project,&workspace)?;
            if !project.join(portable::MARKER).exists() {
                std::fs::write(project.join(portable::MARKER),serde_json::to_vec_pretty(&serde_json::json!({"format":"tfc-portable-project","schema_version":1,"default_workspace":"Workspace"})).map_err(|e|e.to_string())?).map_err(|e|e.to_string())?;
            }
            Ok(result)
        })();
        if result.is_err() {*PROJECT_OVERRIDE.lock().map_err(|e|e.to_string())?=old;return result.map(Some);}
        *app.state::<WorkspaceSelection>().0.lock().map_err(|e|e.to_string())?=Some(workspace);
        result.map(Some)
    }).await.map_err(|e|e.to_string())?
}
#[tauri::command]
async fn materials_reveal(
    window: tauri::WebviewWindow,
    app: tauri::AppHandle,
) -> Result<String, String> {
    menus::require_main(&window)?;
    reveal_data(app, "materials".into()).await
}
#[tauri::command]
async fn workspace_reveal(
    window: tauri::WebviewWindow,
    app: tauri::AppHandle,
    section: String,
) -> Result<String, String> {
    menus::require_main(&window)?;
    if !DATA_SECTIONS.contains(&section.as_str()) {
        return Err("不支持的数据目录".into());
    }
    reveal_data(app, section).await
}
fn open_data_directory(path: &Path) -> Result<(), String> {
    if !path.is_dir() { return Err("数据目录不存在，请重新连接工作区".into()); }
    #[cfg(target_os = "macos")]
    let status = Command::new("open").arg(path).status().and_then(|s| if s.success() {Ok(())} else {Err(std::io::Error::other("Finder refused directory"))});
    #[cfg(windows)]
    let status = Command::new("explorer.exe").arg(portable::explorer_path(path)).stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null()).spawn().map(|_| ());
    #[cfg(not(any(target_os = "macos", windows)))]
    let status = Command::new("xdg-open").arg(path).status().and_then(|s| if s.success() {Ok(())} else {Err(std::io::Error::other("File manager refused directory"))});
    status.map_err(|e| format!("无法打开数据文件夹：{e}"))
}

async fn reveal_data(app: tauri::AppHandle, section: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let root = current_workspace(&app)?;
        let info = run_engine(
            &app,
            Some(&root),
            false,
            serde_json::json!({"action":"workspace_info"}),
        )?;
        // Initialize the discoverable catalogue export alongside the user library.
        run_engine(
            &app,
            Some(&root),
            false,
            serde_json::json!({"action":"library_list"}),
        )?;
        let path = if section == "root" {
            root.clone()
        } else {
            let relative = info["workspace"]["directories"][&section]
                .as_str()
                .ok_or("缺少数据目录")?;
            portable::resolve(&root, relative)?
        };
        open_data_directory(&path)?;
        Ok(path.to_string_lossy().into_owned())
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
async fn workspace_pick(
    window: tauri::WebviewWindow,
    app: tauri::AppHandle,
    create: bool,
) -> Result<Option<serde_json::Value>, String> {
    menus::require_main(&window)?;
    tauri::async_runtime::spawn_blocking(move || {
        let title = if create {
            "选择空文件夹创建工作区"
        } else {
            "选择包含 workspace.json 的工作区"
        };
        let project = project_folder()?;
        let picked = app
            .dialog()
            .file()
            .set_title(title)
            .set_directory(&project)
            .set_can_create_directories(true)
            .blocking_pick_folder();
        let Some(folder) = picked else {
            return Ok(None);
        };
        let root = folder.into_path().map_err(|e| e.to_string())?;
        portable::relative(&project, &root)?;
        let result = run_engine(
            &app,
            Some(&root),
            create,
            serde_json::json!({"action":"workspace_info"}),
        )?;
        portable::remember(&project, &root)?;
        *app.state::<WorkspaceSelection>()
            .0
            .lock()
            .map_err(|_| "工作区状态不可用")? = Some(root);
        Ok(Some(result))
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
async fn workspace_copy(
    window: tauri::WebviewWindow,
    app: tauri::AppHandle,
) -> Result<Option<serde_json::Value>, String> {
    menus::require_main(&window)?;
    tauri::async_runtime::spawn_blocking(move || {
        let project = project_folder()?;
        let initial = app
            .path()
            .app_data_dir()
            .map_err(|e| e.to_string())?
            .join("workspaces/default");
        let mut dialog = app
            .dialog()
            .file()
            .set_title("选择已有工作区，复制迁入当前项目");
        if initial.is_dir() {
            dialog = dialog.set_directory(initial);
        }
        let Some(picked) = dialog.blocking_pick_folder() else {
            return Ok(None);
        };
        let source = picked.into_path().map_err(|e| e.to_string())?;
        let nonce = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map_err(|e| e.to_string())?
            .as_nanos();
        let target = portable::resolve(&project, &format!("Workspaces/import-{nonce}"))?;
        let result = run_engine(
            &app,
            Some(&target),
            false,
            serde_json::json!({"action":"workspace_copy","source":source}),
        )?;
        portable::remember(&project, &target)?;
        *app.state::<WorkspaceSelection>()
            .0
            .lock()
            .map_err(|_| "工作区状态不可用")? = Some(target);
        Ok(Some(result))
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
async fn import_file(
    window: tauri::WebviewWindow,
    app: tauri::AppHandle,
) -> Result<Option<serde_json::Value>, String> {
    menus::require_main(&window)?;
    tauri::async_runtime::spawn_blocking(move || {
        let parent=app.webview_windows().into_values().find(|w|w.is_visible().unwrap_or(false) && w.is_focused().unwrap_or(false)).unwrap_or(window.clone());
        let mut dialog = app.dialog().file().set_title("打开项目")
            .add_filter("TFCalc / TFC 项目", &["tfd", "json"]);
        if parent.is_visible().unwrap_or(false) {dialog=dialog.set_parent(&parent);}
        if let Ok(root)=current_workspace(&app) { dialog=dialog.set_directory(root.join("projects")); } else if let Ok(project)=project_folder() { dialog=dialog.set_directory(project); }
        let picked=dialog.blocking_pick_file();
        let Some(file) = picked else { return Ok(None); };
        let path = file.into_path().map_err(|e| e.to_string())?;
        Ok(Some(read_project_file(&app,&path)?))
    }).await.map_err(|e| e.to_string())?
}

fn read_project_file(app: &tauri::AppHandle, path: &Path) -> Result<serde_json::Value,String> {
        if std::fs::metadata(&path).map_err(|e| e.to_string())?.len() > 2_000_000 { return Err("文件不能超过 2 MB".into()); }
        let bytes = std::fs::read(&path).map_err(|e| e.to_string())?;
        let is_tfd = path.extension().is_some_and(|e|e.to_str().is_some_and(|e| e.eq_ignore_ascii_case("tfd")));
        let decoded = if is_tfd { run_engine(&app,None,false,serde_json::json!({"action":"decode_tfd","bytes":bytes}))? } else {
            serde_json::json!({"content":String::from_utf8(bytes).map_err(|e|e.to_string())?,"encoding":"utf-8"})
        };
        Ok(serde_json::json!({"name":path.file_name().and_then(|s| s.to_str()).ok_or("文件名称无效")?,"content":decoded["content"],"encoding":decoded["encoding"],"path":path}))
}
#[tauri::command]
async fn export_file(
    window: tauri::WebviewWindow,
    app: tauri::AppHandle,
    name: String,
    content: String,
) -> Result<bool, String> {
    if content.len() > 10_000_000 {
        return Err("导出内容过大".into());
    }
    menus::require_main(&window)?;
    tauri::async_runtime::spawn_blocking(move || {
        let safe_name = name.replace(['/', ':', '\\'], "_");
        let root = current_workspace(&app)?;
        let selected = app
            .dialog()
            .file()
            .set_title("导出文件")
            .set_directory(root.join("exports"))
            .set_can_create_directories(true)
            .set_file_name(&safe_name)
            .blocking_save_file();
        if let Some(file) = selected {
            std::fs::write(file.into_path().map_err(|e| e.to_string())?, content)
                .map_err(|e| e.to_string())?;
            Ok(true)
        } else {
            Ok(false)
        }
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
async fn project_save_as(window: tauri::WebviewWindow, app: tauri::AppHandle, mut project: serde_json::Value, format: String) -> Result<Option<serde_json::Value>,String> {
    menus::require_main(&window)?;
    tauri::async_runtime::spawn_blocking(move || {
        let name=project["name"].as_str().unwrap_or("未命名膜系").replace(['/', ':', '\\'], "_");
        let file_name=format!("{}{}",name,if format=="tfd" {".tfd"}else{".tfc.json"});
        let parent=app.webview_windows().into_values().find(|w|w.is_visible().unwrap_or(false) && w.is_focused().unwrap_or(false)).unwrap_or(window.clone());
        let mut dialog=app.dialog().file().set_title("另存项目")
            .add_filter("TFCalc 膜系 (*.tfd)", &["tfd"])
            .add_filter("TFC 完整项目 (*.tfc.json)", &["json"])
            .set_can_create_directories(true).set_file_name(&file_name);
        if parent.is_visible().unwrap_or(false) {dialog=dialog.set_parent(&parent);}
        if let Ok(root)=current_workspace(&app) {dialog=dialog.set_directory(root.join("projects"));}
        let Some(picked)=dialog.blocking_save_file() else {return Ok(None)};
        let path=picked.into_path().map_err(|e| e.to_string())?;
        let filename=path.file_name().and_then(|s|s.to_str()).ok_or("文件名无效")?;
        let lower=filename.to_lowercase();
        let (chosen,label)=if lower.ends_with(".tfd") {("tfd",&filename[..filename.len()-4])}
            else if lower.ends_with(".tfc.json") {("json",&filename[..filename.len()-9])}
            else if lower.ends_with(".json") {("json",&filename[..filename.len()-5])}
            else {return Err("请使用 .tfd 或 .tfc.json 扩展名；文件未写入".into())};
        project["name"]=serde_json::json!(label);
        let result=run_engine(&app,None,false,serde_json::json!({"action":"export_project","project":project,"format":chosen}))?;
        let bytes=if chosen=="tfd" {
            result["bytes"].as_array().ok_or("TFD 编码无效")?.iter().map(|v|v.as_u64().and_then(|x|u8::try_from(x).ok()).ok_or("TFD 字节无效")).collect::<Result<Vec<u8>,_>>()?
        } else {result["content"].as_str().ok_or("项目内容无效")?.as_bytes().to_vec()};
        if bytes.len()>2_000_000 {return Err("项目文件超过 2 MB，未写入".into())}
        let parent=path.parent().ok_or("保存目录无效")?;
        let temp=parent.join(format!(".tfc-save-{}-{}.tmp",std::process::id(),std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_err(|e|e.to_string())?.as_nanos()));
        let written=(|| -> Result<(),String> {
            use std::io::Write;
            let mut file=std::fs::OpenOptions::new().create_new(true).write(true).open(&temp).map_err(|e|e.to_string())?;
            file.write_all(&bytes).map_err(|e|e.to_string())?;file.sync_all().map_err(|e|e.to_string())?;
            std::fs::rename(&temp,&path).map_err(|e|e.to_string())?;Ok(())
        })();
        if written.is_err(){let _=std::fs::remove_file(&temp);}written?;
        Ok(Some(serde_json::json!({"project":result["project"],"format":chosen,"path":path,"warnings":result["warnings"]})))
    }).await.map_err(|e|e.to_string())?
}
#[tauri::command]
fn app_quit(window: tauri::WebviewWindow, app: tauri::AppHandle) -> Result<(),String> {
    menus::require_main(&window)?;
    tools::save_layout(&app)?;
    app.state::<calculation_worker::CalculationWorker>().stop();
    tools::shutdown(&app);
    app.exit(0); Ok(())
}
fn main() {
    // Explicit diagnostics use a caller-created copy, without booting App or user preferences.
    let args: Vec<_> = std::env::args_os().collect();
    if let Some(index) = args.iter().position(|a| a == "--workspace-folder-check") {
        let result = (|| -> Result<serde_json::Value,String> {
            let root = PathBuf::from(args.get(index + 1).ok_or("缺少验收工作区路径")?).canonicalize().map_err(|e|e.to_string())?;
            let manifest: serde_json::Value = serde_json::from_slice(&std::fs::read(root.join("workspace.json")).map_err(|e|e.to_string())?).map_err(|e|e.to_string())?;
            let mut opened = serde_json::Map::new();
            for section in DATA_SECTIONS {
                let path = if section == "root" { root.clone() } else {
                    portable::resolve(&root, manifest["directories"][section].as_str().ok_or("目录清单缺失")?)?
                };
                open_data_directory(&path)?;
                opened.insert(section.into(),serde_json::json!(path));
            }
            Ok(serde_json::json!({"all_pass":true,"opened":opened,"limits":"Checks real production directory opener launch and existing paths; physical file-manager interaction is a separate check."}))
        })();
        match result { Ok(report)=>println!("{report}"), Err(error)=>{eprintln!("{error}");std::process::exit(1);} }
        return;
    }

    // Read-only entry-point check used by cross-platform portable package validation.
    if std::env::args_os().any(|arg| arg == "--workspace-location") {
        let result = (|| -> Result<serde_json::Value, String> {
            let project = project_folder()?;
            let (workspace, create) = portable::selected(&project)?;
            Ok(
                serde_json::json!({"project_root":project,"workspace_root":workspace,"creation_allowed":create}),
            )
        })();
        match result {
            Ok(value) => println!("{value}"),
            Err(error) => {
                eprintln!("{error}");
                std::process::exit(1);
            }
        }
        return;
    }
    let window_ipc_check = std::env::args_os().any(|arg| arg == "--window-ipc-self-test");
    let menu_check = std::env::args_os().any(|arg| arg == "--menu-self-test");
    let mut context = tauri::generate_context!();
    if menu_check {
        // Never mount the real App or touch user data during the native check.
        context.config_mut().app.windows[0].url =
            tauri::WebviewUrl::External("about:blank".parse().unwrap());
        context.config_mut().app.windows[0].visible = false;
    }
    if window_ipc_check {
        context.config_mut().app.windows[0].visible = true;
        context.config_mut().app.windows[0].url =
            tauri::WebviewUrl::App("index.html?window-ipc-check=1".into());
    }
    tauri::Builder::default()
        .manage(WorkspaceSelection::default())
        .manage(calculation_worker::CalculationWorker::default())
        .manage(menus::MenuState::default())
        .manage(tools::ToolsState::default())
        .manage(window_check::CheckState::new(window_ipc_check))
        .setup(move |app| {
            if menu_check || window_ipc_check {
                tools::testing(app.handle());
            }
            menus::setup(app)?;
            if window_ipc_check {
                window_check::watchdog(app.handle().clone());
            }
            if !menu_check && !window_ipc_check {
                tools::setup(app.handle());
            }
            if menu_check {
                menu_check::start(app.handle().clone());
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            if window.label() == "main" {
                match event {
                    tauri::WindowEvent::CloseRequested {api, ..} => {
                        api.prevent_close();
                        let _ = tools::save_layout(window.app_handle());
                        let _ = tools::spectrum_visible(window.app_handle(), false);
                    },
                    tauri::WindowEvent::Moved(_) | tauri::WindowEvent::Resized(_) => {tools::persist_later(window.app_handle().clone());},
                    _ => {}
                }
            }
            if window.label() == "main" && matches!(event, tauri::WindowEvent::Destroyed) {
                window.app_handle().state::<calculation_worker::CalculationWorker>().stop();
                tools::shutdown(window.app_handle());
                window.app_handle().exit(0);
            }
        })
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            engine_request,
            catalogue_read,
            material_check,
            project_pick,
            materials_reveal,
            workspace_reveal,
            workspace_pick,
            workspace_copy,
            export_file,
            project_save_as,
            import_file,
            recent_projects::recent_list,
            recent_projects::recent_remember,
            recent_projects::recent_open,
            menus::menu_platform,
            menus::menu_sync,
            menus::menu_snapshot,
            menus::menu_show,
            tools::tool_open,
            tools::tool_hide,
            tools::tool_hide_all,
            tools::tool_visibility,
            tools::tool_remember,
            tools::tool_preferences,
            tools::tool_spectrum,
            app_quit,
            tools::tool_snapshot,
            tools::tool_publish,
            tools::tool_submit,
            tools::tool_reply,
            tools::tool_focus_main,
            window_check::window_check_enabled,
            window_check::window_check_ready,
            window_check::window_check_status,
            window_check::window_check_details,
            window_check::window_check_dispatch,
            window_check::window_check_close,
            window_check::window_check_finish
        ])
        .build(context)
        .expect("无法启动 TFC")
        .run(|app, event| {
            if let tauri::RunEvent::ExitRequested { api, code, .. } = event {
                if code.is_none() && app.get_webview_window("main").is_some() {
                    api.prevent_exit();
                    menus::dispatch(app, "file.quit");
                }
            }
        });
}

#[cfg(test)]
mod transport_tests {
    #[test]
    fn scientific_json_keeps_engine_float_bits() {
        for number in [
            20.586653548966346_f64,
            -1.1102230246251565e-14,
            1.1102230246251565e-16,
        ] {
            let json = serde_json::to_string(&number).unwrap();
            let parsed: serde_json::Value = serde_json::from_str(&json).unwrap();
            assert_eq!(
                parsed.as_f64().unwrap().to_bits(),
                number.to_bits(),
                "{json}"
            );
        }
    }
}
