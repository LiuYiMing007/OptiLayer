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
    for (const l of [...next.layers, ...(next.back_layers || [])])
      if (l.material === replaces) l.material = material.name;
    for (const kind of ["incident", "substrate", "exit"] as const)
      if (next.settings[`${kind}_material`] === replaces)
        next.settings[`${kind}_material`] = material.name;
  }
  if (substrate) next.settings.substrate_material = material.name;
  synchronizeBoundaries(next);
  return next;
}

export function removeProjectMaterial(
  p: Project,
  name: string,
  expected: Material,
): Project {
  if (dataKey(p.materials.find((m) => m.name === name)) !== dataKey(expected))
    throw Error("材料已改变，请刷新后再删除");
  const uses = [
    ...p.layers.flatMap((l, i) =>
      l.material === name ? [`前表面第 ${i + 1} 层`] : [],
    ),
    ...(p.back_layers || []).flatMap((l, i) =>
      l.material === name ? [`后表面第 ${i + 1} 层`] : [],
    ),
    ...(["incident", "substrate", "exit"] as const).flatMap((k, i) =>
      p.settings[`${k}_material`] === name
        ? [["入射介质", "基底", "出射介质"][i]]
        : [],
    ),
  ];
  if (uses.length) throw Error(`正在用于${uses.join("、")}，请先替换再删除`);
  const next = structuredClone(p);
  next.materials = next.materials.filter((m) => m.name !== name);
  return next;
}
