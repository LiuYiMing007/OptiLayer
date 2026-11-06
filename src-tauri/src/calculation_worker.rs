//! A single warm, stateless optical worker. Storage requests never enter this pipe.
use std::{io::{BufRead, BufReader, Write}, process::{Child, ChildStdin, ChildStdout, Stdio}, sync::Mutex};
use serde_json::Value;
#[derive(Default)]
pub struct CalculationWorker(pub Mutex<Option<Worker>>);
pub struct Worker { child: Child, input: ChildStdin, output: BufReader<ChildStdout> }
impl Drop for Worker { fn drop(&mut self) { let _=self.child.kill(); let _=self.child.wait(); } }
impl CalculationWorker {
 pub fn calculate(&self, app:&tauri::AppHandle, request:Value)->Result<Value,String>{
  let mut slot=self.0.lock().map_err(|e|e.to_string())?;
  let result:Result<Value,String>=(||{
   if slot.is_none(){
    let mut command=crate::engine_command(app)?;
    command.arg("--serve-calculation").env_remove("TFC_WORKSPACE_ROOT").env_remove("TFC_CREATE_WORKSPACE");
    let mut child=command.stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::null()).spawn().map_err(|e|format!("无法启动计算服务：{e}"))?;
    let input=child.stdin.take().ok_or("计算输入不可用")?;
    let output=BufReader::new(child.stdout.take().ok_or("计算输出不可用")?);
    *slot=Some(Worker{child,input,output});
   }
   let worker=slot.as_mut().ok_or("计算服务不可用")?;
   let mut payload=serde_json::to_vec(&request).map_err(|e|e.to_string())?;payload.push(b'\n');
   worker.input.write_all(&payload).and_then(|_|worker.input.flush()).map_err(|e|e.to_string())?;
   let mut response=String::new();
   if worker.output.read_line(&mut response).map_err(|e|e.to_string())?==0{return Err("计算服务已退出，下次计算将重新启动".into())}
   let value:Value=serde_json::from_str(&response).map_err(|e|format!("计算响应无效：{e}"))?;
   Ok(value)
  })();
  if result.is_err(){*slot=None;}
  let value=result?;
  if let Some(error)=value.get("error").and_then(Value::as_str){return Err(error.to_owned())}
  Ok(value)
 }
 pub fn stop(&self){if let Ok(mut slot)=self.0.lock(){*slot=None;}}
}
