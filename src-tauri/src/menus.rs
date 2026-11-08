//! Native rendering of the same command catalogue consumed by the React UI.
use serde_json::Value;
use std::{collections::HashMap, sync::Mutex};
use tauri::{
    menu::{CheckMenuItem, Menu, MenuItem, MenuItemKind, PredefinedMenuItem, Submenu},
    Emitter, Manager,
};

const CATALOGUE: &str = include_str!("../../src/menus/menus.json");
#[derive(Default)]
pub struct MenuState {
    items: Mutex<HashMap<String, MenuItemKind<tauri::Wry>>>,
    snapshot: Mutex<Option<Value>>,
    recent: Mutex<Option<Submenu<tauri::Wry>>>,
    recent_key: Mutex<Value>,
}
impl MenuState {
    pub fn check_native_state(&self) -> Result<(), String> {
        let items = self.items.lock().map_err(|e| e.to_string())?;
        let save = items
            .get("file.save")
            .and_then(|i| i.as_menuitem())
            .ok_or("save menu missing")?;
        let add = items
            .get("calculate.spectrum")
            .and_then(|i| i.as_menuitem())
            .ok_or("analysis menu missing")?;
        let layers = items
            .get("view.layers")
            .and_then(|i| i.as_check_menuitem())
            .ok_or("layer check missing")?;
        if save.is_enabled().map_err(|e| e.to_string())?
            || !add.is_enabled().map_err(|e| e.to_string())?
            || layers.is_checked().map_err(|e| e.to_string())?
        {
            return Err("native menu state mismatch".into());
        }
        Ok(())
    }
}
pub fn require_main(window: &tauri::WebviewWindow) -> Result<(), String> {
    if window.label() != "main" {
        return Err("只有主工作台可以执行此操作".into());
    }
    Ok(())
}
#[tauri::command]
pub fn menu_platform() -> &'static str {
    if cfg!(target_os = "macos") {
        "macos"
    } else if cfg!(windows) {
        "windows"
    } else {
        "browser"
    }
}
#[tauri::command]
pub fn menu_snapshot(app: tauri::AppHandle) -> Result<Option<Value>, String> {
    Ok(app
        .state::<MenuState>()
        .snapshot
        .lock()
        .map_err(|e| e.to_string())?
        .clone())
}
#[tauri::command]
pub fn menu_sync(
    window: tauri::WebviewWindow,
    app: tauri::AppHandle,
    snapshot: Value,
) -> Result<(), String> {
    require_main(&window)?;
    let state = app.state::<MenuState>();
    let items = state.items.lock().map_err(|e| e.to_string())?;
    let rows=snapshot["recent"].as_array().cloned().unwrap_or_default();
    if let Some(menu)=state.recent.lock().map_err(|e|e.to_string())?.as_ref() {
        let mut previous=state.recent_key.lock().map_err(|e|e.to_string())?;
        if *previous != serde_json::json!(rows) {
            while menu.remove_at(0).map_err(|e|e.to_string())?.is_some() {}
            for entry in &rows {
                if let (Some(id),Some(name))=(entry["id"].as_str(),entry["name"].as_str()) {
                    if id.len()>64 || !id.chars().all(|c|c.is_ascii_digit()) {continue;}
                    menu.append(&MenuItem::with_id(&app,format!("file.recent.{id}"),name,true,None::<&str>).map_err(|e|e.to_string())?).map_err(|e|e.to_string())?;
                }
            }
            *previous=serde_json::json!(rows);
        }
        menu.set_enabled(!rows.is_empty() && snapshot["commands"]["file.recent"]["enabled"]==true).map_err(|e|e.to_string())?;
        for item in menu.items().map_err(|e|e.to_string())? {
            if let Some(item)=item.as_menuitem(){item.set_enabled(snapshot["commands"][item.id().as_ref()]["enabled"]==true).map_err(|e|e.to_string())?;}
        }
    }
    for (id, item) in items.iter() {
        let state_id = id.strip_prefix("application.").unwrap_or(id);
        let enabled = snapshot["commands"][state_id]["enabled"]
            .as_bool()
            .unwrap_or(false);
        if let Some(normal) = item.as_menuitem() {
            normal.set_enabled(enabled).map_err(|e| e.to_string())?;
        }
        if let Some(check) = item.as_check_menuitem() {
            check.set_enabled(enabled).map_err(|e| e.to_string())?;
            check
                .set_checked(
                    snapshot["commands"][id]["checked"]
                        .as_bool()
                        .unwrap_or(false),
                )
                .map_err(|e| e.to_string())?;
        }
    }
    *state.snapshot.lock().map_err(|e| e.to_string())? = Some(snapshot.clone());
    if app.get_webview_window("menu").is_some() {
        app.emit_to("menu", "menu-state", &snapshot)
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}
#[tauri::command]
pub fn menu_show(window: tauri::WebviewWindow, app: tauri::AppHandle) -> Result<(), String> {
    require_main(&window)?;
    if let Some(menu) = app.get_webview_window("menu") {
        menu.show().map_err(|e| e.to_string())?;
        menu.unminimize().map_err(|e| e.to_string())?;
        menu.set_focus().map_err(|e| e.to_string())?;
    }
    Ok(())
}
pub fn dispatch(app: &tauri::AppHandle, id: &str) {
    let id = id.strip_prefix("application.").unwrap_or(id);
    let state = app.state::<MenuState>();
    let enabled = state
        .snapshot
        .lock()
        .ok()
        .and_then(|s| {
            s.as_ref()
                .map(|s| s["commands"][id]["enabled"].as_bool().unwrap_or(false))
        })
        .unwrap_or(false);
    if !enabled {
        return;
    }
    if let Some(main) = app.get_webview_window("main") {
        // Route commands without stealing focus from the current tool window.
        // The coordinator brings main forward only for dialogs or explicit focus.
        let _ = main.emit("menu-command", id);
    }
}
pub fn setup(app: &mut tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    if !cfg!(target_os = "macos") && !cfg!(windows) {
        return Ok(());
    }
    let menu = Menu::new(app)?;
    let mut handles = HashMap::new();
    #[cfg(target_os = "macos")]
    {
        let application = Submenu::new(app, "TFC Workbench", true)?;
        // Quit is a custom command so it goes through the same unsaved-project guard.
        let about = MenuItem::with_id(
            app,
            "application.help.about",
            "关于 TFC Workbench…",
            false,
            None::<&str>,
        )?;
        application.append(&about)?;
        handles.insert(
            "application.help.about".into(),
            MenuItemKind::MenuItem(about),
        );
        application.append(&PredefinedMenuItem::separator(app)?)?;
        application.append(&PredefinedMenuItem::services(app, Some("服务"))?)?;
        let text = Submenu::new(app, "文本编辑", true)?;
        text.append(&PredefinedMenuItem::undo(app, Some("撤销文本编辑"))?)?;
        text.append(&PredefinedMenuItem::redo(app, Some("重做文本编辑"))?)?;
        text.append(&PredefinedMenuItem::cut(app, Some("剪切文本"))?)?;
        text.append(&PredefinedMenuItem::copy(app, Some("复制文本"))?)?;
        text.append(&PredefinedMenuItem::paste(app, Some("粘贴文本"))?)?;
        text.append(&PredefinedMenuItem::select_all(app, Some("全选文本"))?)?;
        application.append(&text)?;
        application.append(&PredefinedMenuItem::hide(app, Some("隐藏 TFC"))?)?;
        application.append(&PredefinedMenuItem::hide_others(app, Some("隐藏其他"))?)?;
        application.append(&PredefinedMenuItem::show_all(app, Some("显示全部"))?)?;
        application.append(&PredefinedMenuItem::separator(app)?)?;
        // File menu is limited to project operations; application owns Cmd+Q.
        let quit = MenuItem::with_id(
            app,
            "application.file.quit",
            "退出 TFC",
            false,
            Some("CmdOrCtrl+Q"),
        )?;
        application.append(&quit)?;
        handles.insert("application.file.quit".into(), MenuItemKind::MenuItem(quit));
        menu.append(&application)?;
    }
    let groups: Vec<Value> = serde_json::from_str(CATALOGUE)?;
    for group in groups {
        let title = group["title"].as_str().ok_or("菜单标题缺失")?;
        let submenu = Submenu::new(app, title, true)?;
        for entry in group["items"].as_array().ok_or("菜单内容缺失")? {
            if entry["platform"] == "windows" && !cfg!(windows) {
                continue;
            }
            if entry["separator"] == true {
                submenu.append(&PredefinedMenuItem::separator(app)?)?;
                continue;
            }
            let id = entry["id"].as_str().ok_or("菜单命令缺失")?;
            let label = entry["label"].as_str().ok_or("菜单文字缺失")?;
            let accelerator = if cfg!(target_os = "macos") {
                entry["macShortcut"].as_str().or(entry["shortcut"].as_str())
            } else {
                entry["shortcut"].as_str()
            };
            if entry["dynamic"] == "recent" {
                let recent=Submenu::with_id(app,id,label,false)?;
                submenu.append(&recent)?;
                *app.state::<MenuState>().recent.lock().unwrap()=Some(recent);
                continue;
            }
            if entry["check"] == true {
                let item = CheckMenuItem::with_id(app, id, label, false, true, accelerator)?;
                submenu.append(&item)?;
                handles.insert(id.to_string(), MenuItemKind::Check(item));
            } else {
                let item = MenuItem::with_id(app, id, label, false, accelerator)?;
                submenu.append(&item)?;
                handles.insert(id.to_string(), MenuItemKind::MenuItem(item));
            }
        }
        menu.append(&submenu)?;
    }
    *app.state::<MenuState>()
        .items
        .lock()
        .map_err(|e| e.to_string())? = handles;
    #[cfg(target_os = "macos")]
    app.set_menu(menu)?;
    #[cfg(windows)]
    {
        let auxiliary = tauri::WebviewWindowBuilder::new(
            app,
            "menu",
            tauri::WebviewUrl::App("index.html?window=menu".into()),
        )
        .title("TFC Workbench · 菜单")
        .inner_size(460.0, 108.0)
        .min_inner_size(460.0, 108.0)
        .resizable(false)
        .maximizable(false)
        .focused(false)
        .menu(menu)
        .build()?;
        let handle = app.handle().clone();
        auxiliary.on_window_event(move |event| {
            if matches!(event,tauri::WindowEvent::Moved(_) | tauri::WindowEvent::Resized(_)) {crate::tools::persist_later(handle.clone());}
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                if let Some(window) = handle.get_webview_window("menu") {
                    let _ = window.hide();
                }
            }
        });
    }
    app.on_menu_event(|app, event| dispatch(app, event.id().as_ref()));
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn shared_catalogue_has_unique_commands_and_complete_categories() {
        let groups: Vec<Value> = serde_json::from_str(CATALOGUE).unwrap();
        assert_eq!(groups.len(), 6);
        let mut ids = std::collections::HashSet::new();
        for item in groups.iter().flat_map(|g| g["items"].as_array().unwrap()) {
            if let Some(id) = item["id"].as_str() {
                assert!(ids.insert(id.to_string()), "duplicate {id}");
            }
        }
        assert!(
            ids.contains("file.save")
                && ids.contains("view.spectrum")
                && ids.contains("calculate.spectrum")
        );
    }
}
