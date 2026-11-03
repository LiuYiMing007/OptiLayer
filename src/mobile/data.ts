import type { Project } from "../types.ts";
export interface PocketProject {
  project: Project;
  importedAt: string;
}
/** A viewing import, never a TFCalc parser or an Optical Core calculation. */
export function parsePocketProject(text: string): Project {
  if (new TextEncoder().encode(text).length > 10_000_000)
    throw new Error("项目文件不能超过 10 MB");
  const p = JSON.parse(text) as Project;
  const finite = (x: unknown): x is number =>
    typeof x === "number" && Number.isFinite(x);
  if (
    !p ||
    p.schema_version !== 1 ||
    typeof p.id !== "string" ||
    !p.id ||
    typeof p.name !== "string" ||
    p.layer_order !== "substrate_to_air" ||
    !Array.isArray(p.layers) ||
    !Array.isArray(p.materials) ||
    !p.settings
  )
    throw new Error(
      "请选择桌面版导出的项目 JSON，不支持直接读取 TFD 或 SQLite",
    );
  if (p.layers.length > 10000 || p.materials.length > 10000)
    throw new Error("项目数据过大");
  if (
    p.materials.some(
      (m) =>
        !m ||
        typeof m.name !== "string" ||
        !finite(m.n) ||
        !finite(m.k) ||
        (m.display_name !== undefined && typeof m.display_name !== "string"),
    )
  )
    throw new Error("材料快照不完整");
  const names = new Set(p.materials.map((m) => m.name));
  if (
    p.layers.some(
      (l) =>
        !l ||
        typeof l.id !== "string" ||
        typeof l.material !== "string" ||
        !names.has(l.material) ||
        !finite(l.thickness_nm) ||
        l.thickness_nm < 0,
    )
  )
    throw new Error("膜层数据不完整或引用了缺失的材料");
  const s = p.settings;
  if (
    ![
      s.start_nm,
      s.end_nm,
      s.step_nm,
      s.reference_nm,
      s.angle_deg,
      s.incident_n,
      s.substrate_n,
    ].every(finite) ||
    s.start_nm <= 0 ||
    s.end_nm <= s.start_nm ||
    s.step_nm <= 0 ||
    s.reference_nm <= 0 ||
    s.angle_deg < 0 ||
    s.angle_deg >= 90 ||
    !["s", "p", "unpolarized"].includes(s.polarization) ||
    typeof s.substrate_material !== "string" ||
    typeof s.incident_material !== "string"
  )
    throw new Error("计算参数不完整");
  return p;
}
function db(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open("tfc-pocket", 1);
    r.onupgradeneeded = () =>
      r.result.createObjectStore("projects", { keyPath: "project.id" });
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}
export async function projects(action?: {
  save?: PocketProject;
  remove?: string;
}): Promise<PocketProject[]> {
  const d = await db();
  try {
    return await new Promise((resolve, reject) => {
      const tx = d.transaction("projects", action ? "readwrite" : "readonly"),
        store = tx.objectStore("projects");
      if (action?.save) store.put(action.save);
      if (action?.remove) store.delete(action.remove);
      const r = store.getAll();
      tx.oncomplete = () =>
        resolve(
          (r.result as PocketProject[]).sort((a, b) =>
            b.importedAt.localeCompare(a.importedAt),
          ),
        );
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    d.close();
  }
}
