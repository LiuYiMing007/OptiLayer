//! Tool windows are views of the main coordinator, never independent projects.
use serde_json::{json, Value};
use std::{
    collections::HashSet,
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        Mutex,
    },
};
use tauri::{Emitter, Manager};
const REGISTRY: &str = include_str!("../../src/tools/windows.json");
#[derive(Default)]
pub struct ToolsState {
    snapshot: Mutex<Option<Value>>,
    layout: Mutex<Value>,
    generation: AtomicU64,
    closing: AtomicBool,
    testing: AtomicBool,
    seen: Mutex<(HashSet<String>, Vec<String>)>,
    opening: tauri::async_runtime::Mutex<()>,
}
pub fn definitions() -> Vec<Value> {
    serde_json::from_str(REGISTRY).expect("invalid tool catalogue")
}
pub fn valid(id: &str) -> bool {
    definitions().iter().any(|v| v["id"] == id)
}
fn tool_label(id: &str) -> String {
    format!("tool-{id}")
}
fn layout_file() -> Result<std::path::PathBuf, String> {
    crate::portable::resolve(&crate::project_folder()?, ".tfc/window-layout.json")
}
fn read_layout() -> Value {
    layout_file()
        .ok()
        .and_then(|p| std::fs::read(p).ok())
        .and_then(|v| serde_json::from_slice::<Value>(&v).ok())
        .filter(|v| {
            v["version"] == 1
                && v["windows"].is_object()
                && ["macos", "windows"]
                    .iter()
                    .all(|key| v["windows"][key].is_null() || v["windows"][key].is_object())
        })
        .unwrap_or(json!({"version":1,"restore":false,"windows":{}}))
}
fn preferences(layout: &Value) -> Value {
    let value = &layout["preferences"];
    let selected = value["openWindows"].as_array().cloned().unwrap_or(vec![json!("spectrum"),json!("layers")]);
    let mut seen = HashSet::new();
    let selected: Vec<Value> = selected.into_iter().filter(|v| {
        v.as_str().map(|id| (id == "spectrum" || (valid(id) && !["settings","environment","windowconfig","materialdata"].contains(&id))) && seen.insert(id.to_string())).unwrap_or(false)
    }).collect();
    json!({"openWindows":selected,"rememberGeometry":value["rememberGeometry"].as_bool().unwrap_or(layout["restore"] == true)})
}
#[tauri::command]
pub fn tool_preferences(window: tauri::WebviewWindow, app: tauri::AppHandle, preferences: Option<Value>) -> Result<Value,String> {
    crate::menus::require_main(&window)?;
    let result;
    {
        let state = app.state::<ToolsState>();
        let mut layout = state.layout.lock().map_err(|e| e.to_string())?;
        if let Some(value) = preferences {layout["preferences"] = value;layout["restore"] = json!(false);}
        result = self::preferences(&layout);
        layout["preferences"] = result.clone();
    }
    save_layout(&app)?;
    changed(&app);
    Ok(result)
}
pub fn spectrum_visible(app: &tauri::AppHandle, visible: bool) -> Result<(),String> {
    let main = app.get_webview_window("main").ok_or("光谱窗口不可用")?;
    if visible {main.show().map_err(|e| e.to_string())?;main.unminimize().map_err(|e| e.to_string())?;main.set_focus().map_err(|e| e.to_string())?;}
    else {main.hide().map_err(|e| e.to_string())?;}
    changed(app); Ok(())
}
#[tauri::command]
pub fn tool_spectrum(window: tauri::WebviewWindow, app: tauri::AppHandle, visible: bool) -> Result<(),String> {
    crate::menus::require_main(&window)?; spectrum_visible(&app, visible)
}
fn os_key() -> &'static str {
    if cfg!(windows) {
        "windows"
    } else {
        "macos"
    }
}
fn rect(window: &tauri::WebviewWindow) -> Option<Value> {
    let monitor = window.current_monitor().ok()??;
    let scale = monitor.scale_factor();
    let pos = window.outer_position().ok()?;
    let size = window.inner_size().ok()?;
    let m = monitor.position();
    let screen = monitor.size();
    Some(
        json!({"sizing":2,"monitor":monitor.name(),"x":(pos.x-m.x) as f64 / screen.width as f64,"y":(pos.y-m.y) as f64 / screen.height as f64,"width":size.width as f64/scale,"height":size.height as f64/scale,"visible":window.is_visible().ok()?,"maximized":window.is_maximized().ok()?}),
    )
}
pub fn save_layout(app: &tauri::AppHandle) -> Result<(), String> {
    let state = app.state::<ToolsState>();
    if state.closing.load(Ordering::Relaxed) || state.testing.load(Ordering::Relaxed) {
        return Ok(());
    }
    let mut layout = state.layout.lock().map_err(|e| e.to_string())?;
    if !layout.is_object() {
        *layout = json!({"version":1,"restore":false,"windows":{}});
    }
    if preferences(&layout)["rememberGeometry"] == true {
    for (label, window) in app.webview_windows() {
        if label == "main" || label.starts_with("tool-") || label == "menu" {
            if let Some(value) = rect(&window) {
                layout["windows"][os_key()][label] = value;
            }
        }
    }
    }
    let path = layout_file()?;
    std::fs::create_dir_all(path.parent().ok_or("layout parent missing")?)
        .map_err(|e| e.to_string())?;
    let temp = path.with_extension("tmp");
    std::fs::write(
        &temp,
        serde_json::to_vec_pretty(&*layout).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())?;
    std::fs::rename(temp, path).map_err(|e| e.to_string())
}
pub fn persist_later(app: tauri::AppHandle) {
    let generation = app
        .state::<ToolsState>()
        .generation
        .fetch_add(1, Ordering::Relaxed)
        + 1;
    std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_millis(350));
        if app.state::<ToolsState>().generation.load(Ordering::Relaxed) == generation {
            let handle = app.clone();
            let _ = app.run_on_main_thread(move || {
                let _ = save_layout(&handle);
            });
        }
    });
}
fn restore_rect(app: &tauri::AppHandle, window: &tauri::WebviewWindow) {
    let layout = app
        .state::<ToolsState>()
        .layout
        .lock()
        .ok()
        .map(|v| v.clone())
        .unwrap_or(Value::Null);
    if preferences(&layout)["rememberGeometry"] != true {return;}
    let r = &layout["windows"][os_key()][window.label()];
    if !r.is_object() {
        return;
    }
    let monitors = window.available_monitors().unwrap_or_default();
    let monitor = monitors
        .iter()
        .find(|m| {
            m.name()
                .map(|n| Some(n.as_str()) == r["monitor"].as_str())
                .unwrap_or(false)
        })
        .cloned()
        .or_else(|| window.primary_monitor().ok().flatten());
    if let Some(monitor) = monitor {
        let scale = monitor.scale_factor();
        let screen = monitor.size();
        let origin = monitor.position();
        let max_w = screen.width as f64 / scale;
        let max_h = screen.height as f64 / scale;
        let definition = definitions()
            .into_iter()
            .find(|d| tool_label(d["id"].as_str().unwrap_or("")) == window.label());
        let default_w = definition
            .as_ref()
            .and_then(|d| d["width"].as_f64())
            .unwrap_or(800.0);
        let default_h = definition
            .as_ref()
            .and_then(|d| d["height"].as_f64())
            .unwrap_or(600.0);
        let min_w = definition
            .as_ref()
            .and_then(|d| d["minWidth"].as_f64())
            .unwrap_or(340.0);
        let min_h = definition
            .as_ref()
            .and_then(|d| d["minHeight"].as_f64())
            .unwrap_or(260.0);
        // Older layouts contain Dashboard-sized tools. Keep their location and
        // adopt compact defaults once; later user resizes are retained as usual.
        let migrated = definition.is_some() && r["sizing"] != 2;
        let width = (if migrated {
            default_w
        } else {
            r["width"].as_f64().unwrap_or(default_w)
        })
        .clamp(min_w, max_w.max(min_w));
        let height = (if migrated {
            default_h
        } else {
            r["height"].as_f64().unwrap_or(default_h)
        })
        .clamp(min_h, (max_h - 80.0).max(min_h));
        let x = (r["x"].as_f64().unwrap_or(0.1) * max_w).clamp(0.0, (max_w - width).max(0.0));
        let y =
            (r["y"].as_f64().unwrap_or(0.1) * max_h).clamp(40.0, (max_h - height - 40.0).max(40.0));
        let _ = window.set_size(tauri::LogicalSize::new(width, height));
        let _ = window.set_position(tauri::PhysicalPosition::new(
            origin.x + (x * scale) as i32,
            origin.y + (y * scale) as i32,
        ));
        // Maximizing a hidden window can show it on Windows before project selection.
        if r["maximized"] == true && window.is_visible().unwrap_or(false) {
            let _ = window.maximize();
        }
    }
}
pub fn visibility(app: &tauri::AppHandle) -> Value {
    let mut value = json!({});
    for definition in definitions() {
        let id = definition["id"].as_str().unwrap();
        value[id] = json!(app
            .get_webview_window(&tool_label(id))
            .and_then(|w| w.is_visible().ok())
            .unwrap_or(false));
    }
    value["spectrum"] = json!(app.get_webview_window("main").and_then(|w| w.is_visible().ok()).unwrap_or(false));
    value["remember"] = json!(app
        .state::<ToolsState>()
        .layout
        .lock()
        .ok()
        .map(|v| preferences(&v)["rememberGeometry"] == true)
        .unwrap_or(false));
    value
}
fn changed(app: &tauri::AppHandle) {
    let _ = app.emit_to("main", "tools-visibility", visibility(app));
}
pub fn open(app: &tauri::AppHandle, id: &str) -> Result<(), String> {
    let definition = definitions()
        .into_iter()
        .find(|v| v["id"] == id)
        .ok_or("工具窗口不存在")?;
    let label = tool_label(id);
    let window = if let Some(window) = app.get_webview_window(&label) {
        window
    } else {
        let window = tauri::WebviewWindowBuilder::new(
            app,
            &label,
            tauri::WebviewUrl::App(
                format!(
                    "index.html?tool={id}{}",
                    if crate::window_check::enabled(app) {
                        "&window-ipc-check=1"
                    } else {
                        ""
                    }
                )
                .into(),
            ),
        )
        .title(format!(
            "{} · OptiLayer",
            definition["title"].as_str().unwrap()
        ))
        .inner_size(
            definition["width"].as_f64().unwrap(),
            definition["height"].as_f64().unwrap(),
        )
        .min_inner_size(
            definition["minWidth"].as_f64().unwrap(),
            definition["minHeight"].as_f64().unwrap(),
        )
        .visible(false)
        .build()
        .map_err(|e| e.to_string())?;
        restore_rect(app, &window);
        let handle = app.clone();
        let name = label.clone();
        window.on_window_event(move |event| match event {
            tauri::WindowEvent::CloseRequested { api, .. } => {
                api.prevent_close();
                if let Some(w) = handle.get_webview_window(&name) {
                    let _ = w.hide();
                }
                changed(&handle);
                persist_later(handle.clone());
            }
            tauri::WindowEvent::Moved(_) | tauri::WindowEvent::Resized(_) => {
                persist_later(handle.clone())
            }
            _ => {}
        });
        window
    };
    window.show().map_err(|e| e.to_string())?;
    window.unminimize().map_err(|e| e.to_string())?;
    window.set_focus().map_err(|e| e.to_string())?;
    changed(app);
    persist_later(app.clone());
    Ok(())
}
#[tauri::command]
pub async fn tool_open(
    window: tauri::WebviewWindow,
    app: tauri::AppHandle,
    id: String,
) -> Result<(), String> {
    crate::menus::require_main(&window)?;
    // WebView2 creation from a synchronous IPC callback deadlocks on Windows.
    // Keep the callback free and serialize duplicate/rapid open requests.
    let state = app.state::<ToolsState>();
    let _opening = state.opening.lock().await;
    open(&app, &id)
}
#[tauri::command]
pub fn tool_hide(
    window: tauri::WebviewWindow,
    app: tauri::AppHandle,
    id: String,
) -> Result<(), String> {
    crate::menus::require_main(&window)?;
    if !valid(&id) {
        return Err("工具窗口不存在".into());
    }
    if let Some(w) = app.get_webview_window(&tool_label(&id)) {
        w.hide().map_err(|e| e.to_string())?;
    }
    changed(&app);
    persist_later(app);
    Ok(())
}
// Hide every work window inside the host, including dynamically opened editors.
// Serialize against WebView creation; keep the auxiliary Windows menu untouched.
#[tauri::command]
pub async fn tool_hide_all(window: tauri::WebviewWindow, app: tauri::AppHandle) -> Result<(), String> {
    crate::menus::require_main(&window)?;
    let state = app.state::<ToolsState>();
    let _opening = state.opening.lock().await;
    let mut errors = Vec::new();
    for (label, work) in app.webview_windows() {
        if label == "main" || label.strip_prefix("tool-").map(valid).unwrap_or(false) {
            if let Err(error) = work.hide() { errors.push(format!("{label}: {error}")); }
        }
    }
    changed(&app);
    persist_later(app.clone());
    if errors.is_empty() { Ok(()) } else { Err(errors.join("；")) }
}
#[tauri::command]
pub fn tool_visibility(app: tauri::AppHandle) -> Value {
    visibility(&app)
}
#[tauri::command]
pub fn tool_remember(
    window: tauri::WebviewWindow,
    app: tauri::AppHandle,
    enabled: bool,
) -> Result<(), String> {
    crate::menus::require_main(&window)?;
    app.state::<ToolsState>()
        .layout
        .lock()
        .map_err(|e| e.to_string())?["preferences"]["rememberGeometry"] = json!(enabled);
    save_layout(&app)?;
    changed(&app);
    Ok(())
}
fn projection(mut snapshot: Value, label: &str) -> Value {
    if label != "tool-analysis" && label != "tool-targets" {
        if let Some(v) = snapshot.as_object_mut() {
            v.remove("spectrum");
        }
    }
    if label != "tool-materials" && label != "tool-substrate" && label != "tool-materialdata" && label != "tool-stack" {
        if let Some(v) = snapshot.as_object_mut() {
            v.remove("library");
        }
    }
    snapshot
}
#[tauri::command]
pub fn tool_snapshot(
    window: tauri::WebviewWindow,
    app: tauri::AppHandle,
) -> Result<Option<Value>, String> {
    if window.label() != "main"
        && !window
            .label()
            .strip_prefix("tool-")
            .map(valid)
            .unwrap_or(false)
    {
        return Err("不是工具窗口".into());
    }
    Ok(app
        .state::<ToolsState>()
        .snapshot
        .lock()
        .map_err(|e| e.to_string())?
        .clone()
        .map(|s| projection(s, window.label())))
}
#[tauri::command]
pub fn tool_publish(
    window: tauri::WebviewWindow,
    app: tauri::AppHandle,
    snapshot: Value,
) -> Result<(), String> {
    crate::menus::require_main(&window)?;
    let state = app.state::<ToolsState>();
    let mut current = state.snapshot.lock().map_err(|e| e.to_string())?;
    if current
        .as_ref()
        .and_then(|v| v["sequence"].as_u64())
        .unwrap_or(0)
        > snapshot["sequence"].as_u64().ok_or("状态序号缺失")?
    {
        return Ok(());
    }
    *current = Some(snapshot.clone());
    drop(current);
    for (label, _) in app.webview_windows() {
        if label.starts_with("tool-") {
            app.emit_to(&label, "tool-state", projection(snapshot.clone(), &label))
                .map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}
#[tauri::command]
pub fn tool_submit(
    window: tauri::WebviewWindow,
    app: tauri::AppHandle,
    action: Value,
) -> Result<(), String> {
    if !window
        .label()
        .strip_prefix("tool-")
        .map(valid)
        .unwrap_or(false)
    {
        return Err("不是工具窗口".into());
    }
    let id = action["requestId"].as_str().ok_or("命令编号缺失")?;
    if id.len() > 120 || action.to_string().len() > 3_000_000 {
        return Err("命令过大".into());
    }
    let state = app.state::<ToolsState>();
    let mut seen = state.seen.lock().map_err(|e| e.to_string())?;
    let key = format!("{}:{id}", window.label());
    if seen.0.contains(&key) {
        return Err("重复命令".into());
    }
    seen.0.insert(key.clone());
    seen.1.push(key);
    if seen.1.len() > 512 {
        let first = seen.1.remove(0);
        seen.0.remove(&first);
    }
    drop(seen);
    app.emit_to(
        "main",
        "tool-action",
        json!({"source":window.label(),"action":action}),
    )
    .map_err(|e| e.to_string())
}
#[tauri::command]
pub fn tool_reply(
    window: tauri::WebviewWindow,
    app: tauri::AppHandle,
    target: String,
    request_id: String,
    error: Option<String>,
) -> Result<(), String> {
    crate::menus::require_main(&window)?;
    if !target.strip_prefix("tool-").map(valid).unwrap_or(false) {
        return Err("回复目标无效".into());
    }
    let snapshot = app
        .state::<ToolsState>()
        .snapshot
        .lock()
        .map_err(|e| e.to_string())?
        .clone()
        .map(|s| projection(s, &target));
    app.emit_to(
        target,
        "tool-feedback",
        json!({"requestId":request_id,"error":error,"snapshot":snapshot}),
    )
    .map_err(|e| e.to_string())
}
pub fn testing(app: &tauri::AppHandle) {
    app.state::<ToolsState>()
        .testing
        .store(true, Ordering::Relaxed);
}
#[tauri::command]
pub fn tool_focus_main(window: tauri::WebviewWindow, app: tauri::AppHandle) -> Result<(), String> {
    crate::menus::require_main(&window)?;
    spectrum_visible(&app,true)
}
pub fn setup(app: &tauri::AppHandle) {
    let saved = read_layout();
    *app.state::<ToolsState>().layout.lock().unwrap() = saved.clone();
    if let Some(main) = app.get_webview_window("main") {
        restore_rect(app, &main);
    }
    if let Some(menu) = app.get_webview_window("menu") {restore_rect(app, &menu);}

}
pub fn shutdown(app: &tauri::AppHandle) {
    app.state::<ToolsState>()
        .closing
        .store(true, Ordering::Relaxed);
    for (label, w) in app.webview_windows() {
        if label.starts_with("tool-") || label == "menu" {
            let _ = w.destroy();
        }
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn stack_receives_catalogue_without_spectrum_payload() {
        let snapshot=json!({"library":[{"name":"film"}],"spectrum":{"large":true}});
        let stack=projection(snapshot.clone(),"tool-stack");
        assert_eq!(stack["library"].as_array().unwrap().len(),1);
        assert!(stack["spectrum"].is_null());
        assert!(projection(snapshot,"tool-layers")["library"].is_null());
    }
    #[test]
    fn preferences_migrate_geometry_without_reopening_old_windows() {
        assert_eq!(preferences(&json!({"restore":true}))["rememberGeometry"],true);
        let p=preferences(&json!({"preferences":{"openWindows":["spectrum","layers","layers","settings","environment","../secret"],"rememberGeometry":false},"restore":true}));
        assert_eq!(p["openWindows"],json!(["spectrum","layers"]));
        assert_eq!(p["rememberGeometry"],false);
        assert_eq!(preferences(&json!({"preferences":{"openWindows":[]}}))["openWindows"],json!([]));
    }
    #[test]
    fn registry_is_extensible_and_unique() {
        let d = definitions();
        let ids: HashSet<_> = d.iter().map(|v| v["id"].as_str().unwrap()).collect();
        assert_eq!(ids.len(), d.len());
        assert!(valid("layers") && valid("settings") && !valid("../../data"));
    }
}
