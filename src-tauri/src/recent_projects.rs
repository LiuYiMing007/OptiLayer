//! Recent-file locations are a device-local cache, never part of Workspace data.
use serde_json::{json, Value};
use std::{path::PathBuf, sync::Mutex};
use tauri::Manager;
static LOCK: Mutex<()> = Mutex::new(());
fn cache(app: &tauri::AppHandle) -> Result<PathBuf,String> {
    use std::hash::{Hash,Hasher};
    let mut key=std::collections::hash_map::DefaultHasher::new();
    crate::project_folder()?.hash(&mut key);
    Ok(app.path().app_local_data_dir().map_err(|e|e.to_string())?.join("recent-projects").join(format!("{:016x}.json",key.finish())))
}
fn load(app: &tauri::AppHandle) -> Vec<Value> {
    cache(app).ok().and_then(|p|std::fs::read(p).ok()).and_then(|b|serde_json::from_slice::<Vec<Value>>(&b).ok()).unwrap_or_default().into_iter().take(10).collect()
}
fn summaries(rows: Vec<Value>) -> Value {json!(rows.into_iter().filter_map(|v|Some(json!({"id":v["id"].as_str()?,"name":v["name"].as_str()?}))).collect::<Vec<_>>())}
#[tauri::command]
pub fn recent_list(window: tauri::WebviewWindow,app:tauri::AppHandle) -> Result<Value,String> {
    crate::menus::require_main(&window)?;let _guard=LOCK.lock().map_err(|e|e.to_string())?;Ok(summaries(load(&app)))
}
#[tauri::command]
pub fn recent_remember(window:tauri::WebviewWindow,app:tauri::AppHandle,path:String) -> Result<Value,String> {
    crate::menus::require_main(&window)?;let _guard=LOCK.lock().map_err(|e|e.to_string())?;
    let path=std::fs::canonicalize(path).map_err(|e|e.to_string())?;
    let name=path.file_name().and_then(|n|n.to_str()).ok_or("文件名无效")?;
    let lower=name.to_lowercase(); if !lower.ends_with(".tfd") && !lower.ends_with(".json") {return Err("最近项目仅支持 TFD / JSON".into())}
    let mut rows=load(&app);let existing=rows.iter().find(|v|v["path"]==json!(path));
    let id=existing.and_then(|v|v["id"].as_str()).map(str::to_owned).unwrap_or_else(||std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap_or_default().as_nanos().to_string());
    rows.retain(|v|v["path"]!=json!(path));rows.insert(0,json!({"id":id,"name":name,"path":path}));rows.truncate(10);
    let file=cache(&app)?;std::fs::create_dir_all(file.parent().ok_or("最近项目目录无效")?).map_err(|e|e.to_string())?;
    let tmp=file.with_extension("tmp");std::fs::write(&tmp,serde_json::to_vec_pretty(&rows).map_err(|e|e.to_string())?).map_err(|e|e.to_string())?;
    std::fs::rename(tmp,file).map_err(|e|e.to_string())?;Ok(summaries(rows))
}
#[tauri::command]
pub async fn recent_open(window:tauri::WebviewWindow,app:tauri::AppHandle,id:String) -> Result<Value,String> {
    crate::menus::require_main(&window)?;
    let path={let _guard=LOCK.lock().map_err(|e|e.to_string())?;load(&app).iter().find(|v|v["id"]==id).and_then(|v|v["path"].as_str()).map(PathBuf::from).ok_or("最近项目记录不存在")?};
    tauri::async_runtime::spawn_blocking(move||crate::read_project_file(&app,&path)).await.map_err(|e|e.to_string())?
}
