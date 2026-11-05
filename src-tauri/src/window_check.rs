//! Explicit release regression mode: real webviews and frontend IPC, pure catalogue reads only, no Workspace writes.
use serde_json::{json, Value};
use std::{
    collections::HashMap,
    sync::{
        atomic::{AtomicBool, Ordering},
        Mutex,
    },
    time::Duration,
};
use tauri::Manager;
pub struct CheckState {
    pub enabled: bool,
    ready: Mutex<HashMap<String, String>>,
    details: Mutex<HashMap<String, Value>>,
    finished: AtomicBool,
}
impl CheckState {
    pub fn new(enabled: bool) -> Self {
        Self {
            enabled,
            ready: Mutex::new(HashMap::new()),
            details: Mutex::new(HashMap::new()),
            finished: AtomicBool::new(false),
        }
    }
}
pub fn enabled(app: &tauri::AppHandle) -> bool {
    app.state::<CheckState>().enabled
}
fn require(app: &tauri::AppHandle) -> Result<(), String> {
    if enabled(app) {
        Ok(())
    } else {
        Err("窗口回归检查未启用".into())
    }
}
#[tauri::command]
pub fn window_check_enabled(app: tauri::AppHandle) -> bool {
    enabled(&app)
}
#[tauri::command]
pub fn window_check_ready(
    window: tauri::WebviewWindow,
    app: tauri::AppHandle,
    project_id: String,
) -> Result<(), String> {
    require(&app)?;
    if !window
        .label()
        .strip_prefix("tool-")
        .map(crate::tools::valid)
        .unwrap_or(false)
    {
        return Err("不是工具窗口".into());
    }
    eprintln!("window-check ready: {}", window.label());
    app.state::<CheckState>()
        .ready
        .lock()
        .map_err(|e| e.to_string())?
        .insert(window.label().into(), project_id);
    Ok(())
}
#[tauri::command]
pub fn window_check_details(
    window: tauri::WebviewWindow,
    app: tauri::AppHandle,
    details: Value,
) -> Result<(), String> {
    require(&app)?;
    if !["tool-materials", "tool-substrate", "tool-settings", "tool-layers", "tool-interactive"].contains(&window.label()) {
        return Err("不是已授权的验收工具窗口".into());
    }
    eprintln!("window-check details: {} {details}", window.label());
    app.state::<CheckState>()
        .details
        .lock()
        .map_err(|e| e.to_string())?
        .insert(window.label().into(), details);
    Ok(())
}
#[tauri::command]
pub fn window_check_status(
    window: tauri::WebviewWindow,
    app: tauri::AppHandle,
) -> Result<Value, String> {
    require(&app)?;
    crate::menus::require_main(&window)?;
    Ok(
        json!({"details":app.state::<CheckState>().details.lock().map_err(|e|e.to_string())?.clone(),"ready":app.state::<CheckState>().ready.lock().map_err(|e| e.to_string())?.clone(), "visible":crate::tools::visibility(&app), "menu":crate::menus::menu_snapshot(app.clone())?}),
    )
}
#[tauri::command]
pub fn window_check_dispatch(
    window: tauri::WebviewWindow,
    app: tauri::AppHandle,
    id: String,
) -> Result<(), String> {
    require(&app)?;
    crate::menus::require_main(&window)?;
    crate::menus::dispatch(&app, &id);
    Ok(())
}
#[tauri::command]
pub fn window_check_close(
    window: tauri::WebviewWindow,
    app: tauri::AppHandle,
    id: String,
) -> Result<(), String> {
    require(&app)?;
    crate::menus::require_main(&window)?;
    if !crate::tools::valid(&id) {
        return Err("无效工具".into());
    }
    app.get_webview_window(&format!("tool-{id}"))
        .ok_or("工具不存在")?
        .close()
        .map_err(|e| e.to_string())
}
#[tauri::command]
pub fn window_check_finish(
    window: tauri::WebviewWindow,
    app: tauri::AppHandle,
    report: Value,
) -> Result<(), String> {
    require(&app)?;
    crate::menus::require_main(&window)?;
    if app
        .state::<CheckState>()
        .finished
        .swap(true, Ordering::SeqCst)
    {
        return Err("检查已结束".into());
    }
    let passed = report["all_pass"] == true;
    println!("{report}");
    use std::io::Write;
    let _ = std::io::stdout().flush();
    app.exit(if passed { 0 } else { 1 });
    Ok(())
}
pub fn watchdog(app: tauri::AppHandle) {
    std::thread::spawn(move || {
        std::thread::sleep(Duration::from_secs(120));
        if !app.state::<CheckState>().finished.load(Ordering::SeqCst) {
            eprintln!("real frontend window IPC check timed out (possible WebView2 deadlock)");
            // Exit cannot wait on a potentially blocked UI event loop.
            std::process::exit(1);
        }
    });
}
