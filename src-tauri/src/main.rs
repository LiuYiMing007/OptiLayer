#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
use std::{
    io::Write,
    path::{Path, PathBuf},
    process::{Command, Stdio},
    sync::Mutex,
};
mod menu_check;
mod menus;
mod portable;
mod tools;
use tauri::Manager;
use tauri_plugin_dialog::DialogExt;

#[derive(Default)]
struct WorkspaceSelection(Mutex<Option<PathBuf>>);

fn run_engine(
    app: &tauri::AppHandle,
    root: Option<&Path>,
    create: bool,
    request: serde_json::Value,
) -> Result<serde_json::Value, String> {
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
            "calculate" | "calculate_rt" | "analyze" | "validate" | "import_tfd"
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
        let picked = app.dialog().file().set_parent(&window).set_title("导入 TFD / JSON 项目")
            .set_directory(project_folder()?)
            .add_filter("TFCalc / TFC 项目", &["tfd", "json"]).blocking_pick_file();
        let Some(file) = picked else { return Ok(None); };
        let path = file.into_path().map_err(|e| e.to_string())?;
        if std::fs::metadata(&path).map_err(|e| e.to_string())?.len() > 2_000_000 { return Err("文件不能超过 2 MB".into()); }
        let content = std::fs::read_to_string(&path).map_err(|e| e.to_string())?;
        Ok(Some(serde_json::json!({"name":path.file_name().and_then(|s| s.to_str()).ok_or("文件名称无效")?,"content":content})))
    }).await.map_err(|e| e.to_string())?
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
fn main() {
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
    let menu_check = std::env::args_os().any(|arg| arg == "--menu-self-test");
    let mut context = tauri::generate_context!();
    if menu_check {
        // Never mount the real App or touch user data during the native check.
        context.config_mut().app.windows[0].url =
            tauri::WebviewUrl::External("about:blank".parse().unwrap());
        context.config_mut().app.windows[0].visible = false;
    }
    tauri::Builder::default()
        .manage(WorkspaceSelection::default())
        .manage(menus::MenuState::default())
        .manage(tools::ToolsState::default())
        .setup(move |app| {
            if menu_check {
                tools::testing(app.handle());
            }
            menus::setup(app)?;
            if !menu_check {
                tools::setup(app.handle());
            }
            if menu_check {
                menu_check::start(app.handle().clone());
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            if window.label() == "main"
                && matches!(event, tauri::WindowEvent::CloseRequested { .. })
            {
                let _ = tools::save_layout(window.app_handle());
            }
            if window.label() == "main" && matches!(event, tauri::WindowEvent::Destroyed) {
                tools::shutdown(window.app_handle());
                window.app_handle().exit(0);
            }
        })
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            engine_request,
            workspace_pick,
            workspace_copy,
            export_file,
            import_file,
            menus::menu_platform,
            menus::menu_sync,
            menus::menu_snapshot,
            menus::menu_show,
            tools::tool_open,
            tools::tool_hide,
            tools::tool_visibility,
            tools::tool_remember,
            tools::tool_snapshot,
            tools::tool_publish,
            tools::tool_submit,
            tools::tool_reply,
            tools::tool_focus_main
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
