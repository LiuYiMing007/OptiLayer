//! Opt-in native integration check: blank main webview, no optical engine or Workspace.
use serde_json::{json, Value};
use std::{
    sync::{
        atomic::{AtomicUsize, Ordering},
        mpsc, Arc,
    },
    time::Duration,
};
use tauri::{Listener, Manager};

fn ui(
    app: &tauri::AppHandle,
    action: impl FnOnce(tauri::AppHandle) -> Result<Value, String> + Send + 'static,
) -> Result<Value, String> {
    let (sender, receiver) = mpsc::channel();
    let handle = app.clone();
    app.run_on_main_thread(move || {
        let _ = sender.send(action(handle));
    })
    .map_err(|e| e.to_string())?;
    receiver
        .recv_timeout(Duration::from_secs(15))
        .map_err(|e| e.to_string())?
}
pub fn start(app: tauri::AppHandle) {
    std::thread::spawn(move || {
        let result = (|| -> Result<Value, String> {
            let count = Arc::new(AtomicUsize::new(0));
            let received = count.clone();
            let tool_count = Arc::new(AtomicUsize::new(0));
            let tool_received = tool_count.clone();
            ui(&app, move |app| {
                let main = app.get_webview_window("main").ok_or("main missing")?;
                main.listen("menu-command", move |_| {
                    received.fetch_add(1, Ordering::SeqCst);
                });
                let native = if cfg!(target_os = "macos") {
                    app.menu()
                } else {
                    app.get_webview_window("menu").and_then(|w| w.menu())
                };
                let native = native.ok_or("native menu missing")?;
                let categories = native.items().map_err(|e| e.to_string())?.len();
                if categories != if cfg!(target_os = "macos") { 10 } else { 9 } {
                    return Err("wrong category count".into());
                }
                if cfg!(windows) && main.menu().is_some() {
                    return Err("main window must not duplicate menu".into());
                }
                if cfg!(target_os = "macos") && app.get_webview_window("menu").is_some() {
                    return Err("macOS must not create menu window".into());
                }
                crate::menus::menu_sync(
                    main.clone(),
                    app.clone(),
                    json!({"project":"菜单验收","commands":{"file.save":{"enabled":false},"layer.add":{"enabled":true},"view.layers":{"enabled":true,"checked":false}}}),
                )?;
                let state = app.state::<crate::menus::MenuState>();
                state.check_native_state()?;
                crate::menus::dispatch(&app, "file.save");
                crate::menus::dispatch(&app, "layer.add");
                if let Some(menu) = app.get_webview_window("menu") {
                    if crate::menus::menu_sync(menu.clone(), app.clone(), json!({})).is_ok() {
                        return Err("auxiliary changed authoritative state".into());
                    }
                    if crate::menus::require_main(&menu).is_ok() {
                        return Err("auxiliary can invoke business operations".into());
                    }
                    menu.close().map_err(|e| e.to_string())?;
                }
                main.listen("tool-action", move |event| {
                    if let Ok(value) = serde_json::from_str::<Value>(event.payload()) {
                        if value["source"] == "tool-layers"
                            && value["action"]["requestId"] == "native-check"
                        {
                            tool_received.fetch_add(1, Ordering::SeqCst);
                        }
                    }
                });
                crate::tools::open(&app, "layers")?;
                crate::tools::open(&app, "settings")?;
                let layers = app
                    .get_webview_window("tool-layers")
                    .ok_or("layer window missing")?;
                let settings = app
                    .get_webview_window("tool-settings")
                    .ok_or("settings window missing")?;
                let main = app.get_webview_window("main").ok_or("main missing")?;
                if !layers.is_visible().map_err(|e| e.to_string())?
                    || !settings.is_visible().map_err(|e| e.to_string())?
                {
                    return Err("tools not independently visible".into());
                }
                if crate::menus::require_main(&layers).is_ok()
                    || crate::tools::tool_publish(
                        layers.clone(),
                        app.clone(),
                        json!({"sequence":99}),
                    )
                    .is_ok()
                {
                    return Err("tool can mutate authoritative state".into());
                }
                crate::tools::tool_publish(
                    main.clone(),
                    app.clone(),
                    json!({"sequence":10,"project":{"id":"test"},"spectrum":[1],"library":[2]}),
                )?;
                crate::tools::tool_publish(
                    main.clone(),
                    app.clone(),
                    json!({"sequence":9,"project":{"id":"obsolete"}}),
                )?;
                let snapshot = crate::tools::tool_snapshot(layers.clone(), app.clone())?
                    .ok_or("projection missing")?;
                if snapshot["project"]["id"] != "test"
                    || !snapshot["spectrum"].is_null()
                    || !snapshot["library"].is_null()
                {
                    return Err("outdated or excessive tool projection".into());
                }
                let action =
                    json!({"requestId":"native-check","kind":"select","layerId":"stable-id"});
                crate::tools::tool_submit(layers.clone(), app.clone(), action.clone())?;
                if crate::tools::tool_submit(layers.clone(), app.clone(), action).is_ok() {
                    return Err("duplicate tool command accepted".into());
                }
                layers.close().map_err(|e| e.to_string())?;
                Ok(json!(true))
            })?;
            // Let the native event loop process CloseRequested before inspecting it.
            std::thread::sleep(Duration::from_millis(700));
            ui(&app, |app| {
                let main = app
                    .get_webview_window("main")
                    .ok_or("main closed with menu")?;
                if cfg!(windows) {
                    let menu = app
                        .get_webview_window("menu")
                        .ok_or("menu destroyed instead of hidden")?;
                    if menu.is_visible().map_err(|e| e.to_string())? {
                        return Err("menu close did not hide it".into());
                    }
                    crate::menus::menu_show(main, app.clone())?;
                }
                let layers = app
                    .get_webview_window("tool-layers")
                    .ok_or("tool destroyed on close")?;
                if layers.is_visible().map_err(|e| e.to_string())? {
                    return Err("tool close did not hide".into());
                }
                if !app
                    .get_webview_window("tool-settings")
                    .ok_or("other tool missing")?
                    .is_visible()
                    .map_err(|e| e.to_string())?
                {
                    return Err("closing one tool affected another".into());
                }
                crate::tools::open(&app, "layers")?;
                if !layers.is_visible().map_err(|e| e.to_string())? {
                    return Err("tool did not reopen".into());
                }
                Ok(json!(true))
            })?;
            if tool_count.load(Ordering::SeqCst) != 1 {
                return Err("tool action routing failed".into());
            }
            if count.load(Ordering::SeqCst) != 1 {
                return Err("enabled-command routing or disabled guard failed".into());
            }
            ui(&app, |app| {
                if let Some(menu) = app.get_webview_window("menu") {
                    if !menu.is_visible().map_err(|e| e.to_string())? {
                        return Err("menu could not be restored".into());
                    }
                }
                Ok(json!(true))
            })?;
            Ok(
                json!({"platform":crate::menus::menu_platform(),"native_tool_windows":true,"tool_close_hide_restore":true,"tool_projection_ordered":true,"tool_command_routed_once":true,"tool_cannot_mutate_workspace":true,"native_menu":true,"command_routed_once_to_main":true,"disabled_command_blocked":true,"native_enabled_and_checked_sync":true,"windows_auxiliary_close_hide_restore":cfg!(windows),"auxiliary_cannot_mutate_workspace":cfg!(windows),"workspace_untouched":true}),
            )
        })();
        match &result {
            Ok(report) => println!("{report}"),
            Err(error) => eprintln!("menu self-test failed: {error}"),
        }
        let passed = result.is_ok();
        let _ = ui(&app, move |app| {
            // The normal main Destroyed handler destroys the auxiliary and exits.
            if passed {
                app.get_webview_window("main")
                    .ok_or("main missing")?
                    .destroy()
                    .map_err(|e| e.to_string())?;
            } else {
                app.exit(1);
            }
            Ok(json!(true))
        });
    });
}
