import { invoke, isTauri } from "@tauri-apps/api/core";
export async function request<T>(body: Record<string, unknown>): Promise<T> {
  if (isTauri()) {
    if (body.action === "workspace_copy") return invoke<T>("workspace_copy");
    if (body.action === "workspace_pick")
      return invoke<T>("workspace_pick", { create: body.create });
    return invoke<T>("engine_request", { request: body });
  }
  if (body.action === "workspace_pick" || body.action === "workspace_copy")
    throw new Error("浏览器预览的工作区由本地服务启动参数指定");
  if (!import.meta.env.DEV)
    throw new Error("请在 TFC 桌面应用中使用计算和保存功能");
  const response = await fetch("/__engine", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await response.json();
  if (!response.ok || data.error)
    throw new Error(data.error || "计算引擎不可用");
  return data;
}
