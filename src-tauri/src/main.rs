#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
use std::{
    io::Write,
    path::{Path, PathBuf},
    process::{Command, Stdio},
    sync::Mutex,
};
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
    let value: serde_json::Value =
        serde_json::from_slice(&output.stdout).map_err(|e| format!("本地响应格式错误：{e}"))?;
    if let Some(error) = value.get("error").and_then(|v| v.as_str()) {
        return Err(error.to_owned());
    }
    Ok(value)
}

fn preference_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .app_config_dir()
        .map_err(|e| e.to_string())?
        .join("workspace-selection.json"))
}
fn remember_workspace(app: &tauri::AppHandle, root: &Path) -> Result<(), String> {
    let file = preference_path(app)?;
    let parent = file.parent().ok_or("配置目录无效")?;
    std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    // Only this local preference contains a machine path, never the portable manifest.
    let content = serde_json::to_vec_pretty(&serde_json::json!({"workspace_root":root}))
        .map_err(|e| e.to_string())?;
    std::fs::write(file, content).map_err(|e| e.to_string())
}
fn current_workspace(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let state = app.state::<WorkspaceSelection>();
    let mut selection = state.0.lock().map_err(|_| "工作区状态不可用")?;
    if let Some(root) = selection.as_ref() {
        return Ok(root.clone());
    }
    let pref = preference_path(app)?;
    let remembered = if pref.exists() {
        let text = std::fs::read_to_string(&pref).map_err(|e| e.to_string())?;
        let value: serde_json::Value =
            serde_json::from_str(&text).map_err(|e| format!("工作区配置无效：{e}"))?;
        Some(PathBuf::from(
            value["workspace_root"]
                .as_str()
                .ok_or("工作区配置缺少目录")?,
        ))
    } else {
        None
    };
    let is_new = remembered.is_none();
    let root = remembered.unwrap_or(
        app.path()
            .app_data_dir()
            .map_err(|e| e.to_string())?
            .join("workspaces/default"),
    );
    run_engine(
        app,
        Some(&root),
        is_new,
        serde_json::json!({"action":"workspace_info"}),
    )
    .map_err(|e| format!("工作区不可用，请重新选择目录：{e}"))?;
    // First upgrade copies the old database into a NEW default workspace. Source stays intact.
    let legacy = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("projects.sqlite3");
    if is_new && legacy.exists() && !root.join("database/workspace.sqlite3").exists() {
        run_engine(
            app,
            Some(&root),
            false,
            serde_json::json!({"action":"workspace_import_legacy"}),
        )?;
    }
    remember_workspace(app, &root)?;
    *selection = Some(root.clone());
    Ok(root)
}

#[tauri::command]
async fn engine_request(
    app: tauri::AppHandle,
    request: serde_json::Value,
) -> Result<serde_json::Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let action = request["action"].as_str().unwrap_or("");
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
    app: tauri::AppHandle,
    create: bool,
) -> Result<Option<serde_json::Value>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let title = if create {
            "选择空文件夹创建工作区"
        } else {
            "选择包含 workspace.json 的工作区"
        };
        let picked = app
            .dialog()
            .file()
            .set_title(title)
            .set_can_create_directories(true)
            .blocking_pick_folder();
        let Some(folder) = picked else {
            return Ok(None);
        };
        let root = folder.into_path().map_err(|e| e.to_string())?;
        let result = run_engine(
            &app,
            Some(&root),
            create,
            serde_json::json!({"action":"workspace_info"}),
        )?;
        remember_workspace(&app, &root)?;
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
async fn export_file(app: tauri::AppHandle, name: String, content: String) -> Result<bool, String> {
    if content.len() > 10_000_000 {
        return Err("导出内容过大".into());
    }
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
    tauri::Builder::default()
        .manage(WorkspaceSelection::default())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            engine_request,
            workspace_pick,
            export_file
        ])
        .run(tauri::generate_context!())
        .expect("无法启动 TFC");
}
