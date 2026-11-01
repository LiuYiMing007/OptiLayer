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
                    main,
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
                Ok(json!(true))
            })?;
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
                json!({"platform":crate::menus::menu_platform(),"native_menu":true,"command_routed_once_to_main":true,"disabled_command_blocked":true,"native_enabled_and_checked_sync":true,"windows_auxiliary_close_hide_restore":cfg!(windows),"auxiliary_cannot_mutate_workspace":cfg!(windows),"workspace_untouched":true}),
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
