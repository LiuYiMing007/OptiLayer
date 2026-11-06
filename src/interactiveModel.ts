import type { Project } from "./types.ts";
import { materialAt } from "./materials.ts";
import { physicalThickness, thicknessValue } from "./model.ts";
export type InteractiveTarget =
  | { kind: "physical" | "qwot"; layerId: string }
  | { kind: "angle" | "scale" }
  | { kind: "group"; group: number };
export function interactiveValue(
  p: Project,
  target: InteractiveTarget,
): number {
  if (target.kind === "group") {
    if (
      !Number.isInteger(target.group) ||
      target.group < 1 ||
      ![...p.layers, ...(p.back_layers || [])].some(
        (l) => l.group === target.group,
      )
    )
      throw new Error("所选组不存在");
    return p.group_factors?.[String(target.group)] ?? 1;
  }
  if (target.kind === "angle") return p.settings.angle_deg;
  if (target.kind === "scale") return 1;
  if (!("layerId" in target)) throw new Error("调节变量无效");
  const layer = [...p.layers, ...(p.back_layers || [])].find(
    (l) => l.id === target.layerId,
  );
  if (!layer) throw new Error("所选膜层已删除");
  if (target.kind === "physical") return layer.thickness_nm;
  const m = p.materials.find((m) => m.name === layer.material);
  if (!m) throw new Error("膜层材料不存在");
  const n = materialAt(m, p.settings.reference_nm)[0];
  return thicknessValue(layer.thickness_nm, n, p.settings.reference_nm, "qwot");
}
export function interactiveProject(
  baseline: Project,
  target: InteractiveTarget,
  value: number,
): Project {
  if (!Number.isFinite(value) || value < 0)
    throw new Error("调节值必须是非负有限数");
  const next = structuredClone(baseline);
  if (value === interactiveValue(baseline, target)) return next;
  if (target.kind === "group") {
    const previous = interactiveValue(baseline, target);
    if (value <= 0) throw new Error("组系数必须大于零");
    if (previous <= 0)
      throw new Error("原组系数为零，无法从零厚度恢复；请先设置该组实际膜厚");
    [...next.layers, ...(next.back_layers || [])]
      .filter((l) => l.group === target.group)
      .forEach((l) => {
        l.thickness_nm *= value / previous;
      });
    next.group_factors = {
      ...next.group_factors,
      [String(target.group)]: value,
    };
  } else if (target.kind === "angle") {
    if (value > 89.9) throw new Error("入射角须为 0–89.9°");
    next.settings.angle_deg = value;
  } else if (target.kind === "scale") {
    if (value <= 0) throw new Error("膜系系数必须大于零");
    [...next.layers, ...(next.back_layers || [])].forEach((l) => {
      l.thickness_nm *= value;
    });
  } else if ("layerId" in target) {
    const layer = [...next.layers, ...(next.back_layers || [])].find(
      (l) => l.id === target.layerId,
    );
    if (!layer) throw new Error("所选膜层已删除");
    const m = next.materials.find((m) => m.name === layer.material);
    if (!m) throw new Error("膜层材料不存在");
    layer.thickness_nm =
      target.kind === "physical"
        ? value
        : physicalThickness(
            value,
            materialAt(m, next.settings.reference_nm)[0],
            next.settings.reference_nm,
            "qwot",
          );
  }
  if (
    [...next.layers, ...(next.back_layers || [])].some(
      (l) => !Number.isFinite(l.thickness_nm) || l.thickness_nm > 1e6,
    )
  )
    throw new Error("膜厚超出有效范围");
  return next;
}
