//! Isolated, cancellable analysis processes; never attach a Workspace.
use std::{collections::HashMap, io::{Read, Write}, process::Stdio, sync::{Arc, Mutex, atomic::{AtomicBool, Ordering}}, time::{Duration, Instant}};
use tauri::Manager;
#[derive(Default)]
pub struct DesignJobs(Mutex<HashMap<String, Arc<AtomicBool>>>);
fn owner(window: &tauri::WebviewWindow, action: &str) -> Result<(), String> {
    let allowed = match window.label() {
        "main" => true,
        "tool-optimization" => action == "optimize",
        "tool-agent" => action == "agent",
        _ => false,
    };
    if allowed && ["optimize", "agent"].contains(&action) { Ok(()) } else { Err("不允许此窗口执行该分析任务".into()) }
}
#[tauri::command]
pub async fn design_request(window: tauri::WebviewWindow, app: tauri::AppHandle, id: String, request: serde_json::Value) -> Result<serde_json::Value, String> {
    owner(&window, request["action"].as_str().unwrap_or(""))?;
    if id.len() > 100 || request.to_string().len() > 3_000_000 { return Err("分析请求过大".into()); }
    let label = window.label().to_string();
    let key = format!("{label}:{id}");
    let flag = Arc::new(AtomicBool::new(false));
    {
        let state = app.state::<DesignJobs>();
        let mut jobs = state.0.lock().map_err(|_| "任务锁不可用")?;
        if jobs.keys().any(|k| k.starts_with(&format!("{label}:"))) { return Err("此窗口已有分析任务运行".into()); }
        jobs.insert(key.clone(), flag.clone());
    }
    let handle = app.clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        let run = || -> Result<serde_json::Value, String> {
            let mut command = super::engine_command(&handle)?;
            command.env_remove("TFC_WORKSPACE_ROOT").env_remove("TFC_CREATE_WORKSPACE").env_remove("TFC_LEGACY_DATABASE");
            let mut child = command.stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::null()).spawn().map_err(|_| "无法启动分析服务")?;
            let mut stdout = child.stdout.take().ok_or("分析输出不可用")?;
            let reader = std::thread::spawn(move || { let mut bytes = Vec::new(); stdout.read_to_end(&mut bytes).map(|_| bytes) });
            let write = child.stdin.take().ok_or("分析输入不可用").and_then(|mut input| input.write_all(&serde_json::to_vec(&request).map_err(|_| "请求编码失败")?).map_err(|_| "分析输入失败"));
            if let Err(error) = write { let _ = child.kill(); let _ = child.wait(); let _ = reader.join(); return Err(error.into()); }
            let started = Instant::now();
            loop {
                if flag.load(Ordering::SeqCst) || started.elapsed() > Duration::from_secs(150) {
                    let _ = child.kill(); let _ = child.wait(); let _ = reader.join();
                    return Err("分析已停止或超时，项目未修改".into());
                }
                match child.try_wait() {
                    Ok(Some(status)) => {
                        let bytes = reader.join().map_err(|_| "读取分析响应失败")?.map_err(|_| "读取分析响应失败")?;
                        if !status.success() { return Err("分析服务退出，项目未修改".into()); }
                        let result: serde_json::Value = serde_json::from_slice(&bytes).map_err(|_| "分析响应格式错误")?;
                        if let Some(error) = result["error"].as_str() { return Err(error.to_string()); }
                        return Ok(result);
                    },
                    Ok(None) => std::thread::sleep(Duration::from_millis(40)),
                    Err(_) => { let _ = child.kill(); let _ = child.wait(); let _ = reader.join(); return Err("分析进程状态不可用".into()); }
                }
            }
        };
        let result = run();
        if let Ok(mut jobs) = handle.state::<DesignJobs>().0.lock() { jobs.remove(&key); }
        result
    }).await.map_err(|_| "分析任务意外退出")?;
    result
}
#[tauri::command]
pub fn design_cancel(window: tauri::WebviewWindow, app: tauri::AppHandle, id: String) -> Result<(), String> {
    let key = format!("{}:{id}", window.label());
    if let Some(flag) = app.state::<DesignJobs>().0.lock().map_err(|_| "任务锁不可用")?.get(&key) { flag.store(true, Ordering::SeqCst); }
    Ok(())
}
