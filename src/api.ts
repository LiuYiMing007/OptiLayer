import { invoke, isTauri } from "@tauri-apps/api/core";
export async function request<T>(body: Record<string, unknown>): Promise<T> {
  if (isTauri()) {
    if (body.action === "workspace_reveal")
      return invoke<T>("workspace_reveal", { section: body.section });
    if (body.action === "project_pick") return invoke<T>("project_pick");
    if (body.action === "materials_reveal")
      return invoke<T>("materials_reveal");
    if (body.action === "workspace_copy") return invoke<T>("workspace_copy");
    if (body.action === "workspace_pick")
      return invoke<T>("workspace_pick", { create: body.create });
    return invoke<T>("engine_request", { request: body });
  }
  if (
    body.action === "materials_reveal" ||
    body.action === "project_pick" ||
    body.action === "workspace_reveal"
  )
    throw new Error("请在桌面版中选择项目位置或打开数据文件夹");
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

export async function readCatalogue(name: string) {
  if (isTauri())
    return invoke<{ material: import("./types").Material }>("catalogue_read", {
      name,
    });
  return request<{ material: import("./types").Material }>({
    action: "catalogue_get",
    name,
  });
}

export async function checkMaterials(materials: import("./types").Material[]) {
  if (isTauri())
    return invoke<{ materials: import("./types").Material[] }>(
      "material_check",
      { materials },
    );
  return request<{ materials: import("./types").Material[] }>({
    action: "materials_validate",
    materials,
  });
}

// Analysis runs separately from the shared calculation queue and can be stopped.
export async function designRequest<T>(
  body: Record<string, unknown>,
  signal: AbortSignal,
): Promise<T> {
  if (signal.aborted) throw new Error("分析已停止");
  if (!isTauri()) {
    if (!import.meta.env.DEV) throw new Error("请在桌面版中使用分析功能");
    const response = await fetch("/__engine", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal,
    });
    const result = await response.json();
    if (!response.ok || result.error)
      throw new Error(result.error || "分析失败");
    return result;
  }
  const id = crypto.randomUUID();
  const cancel = () => {
    void invoke("design_cancel", { id }).catch(() => {});
  };
  signal.addEventListener("abort", cancel, { once: true });
  try {
    const result = await invoke<T>("design_request", { id, request: body });
    if (signal.aborted) throw new Error("分析已停止");
    return result;
  } finally {
    signal.removeEventListener("abort", cancel);
  }
}
