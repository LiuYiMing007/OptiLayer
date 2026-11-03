import type { Material, Project } from "./types.ts";
import { dataKey } from "./projectStatus.ts";
import { replaceMaterial, synchronizeBoundaries } from "./model.ts";
export function applyMaterialChange(
  p: Project,
  material: Material,
  replaces: string,
  expected: Material | null,
  substrate = false,
): Project {
  if (
    dataKey(p.materials.find((m) => m.name === replaces) || null) !==
    dataKey(expected)
  )
    throw Error("该材料已被其它窗口更新，请重新载入最新数据");
  const next = structuredClone(p);
  replaceMaterial(next, material);
  if (next.materials.length > 300) throw Error("单个项目最多 300 种材料");
  if (replaces !== material.name) {
    for (const l of next.layers)
      if (l.material === replaces) l.material = material.name;
    for (const kind of ["incident", "substrate"] as const)
      if (next.settings[`${kind}_material`] === replaces)
        next.settings[`${kind}_material`] = material.name;
  }
  if (substrate) next.settings.substrate_material = material.name;
  synchronizeBoundaries(next);
  return next;
}
