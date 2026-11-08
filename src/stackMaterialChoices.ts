import type { Material } from "./types.ts";
/** Resolve an explicit film name without substituting a synthetic *_REF record. */
export function resolveStackMaterial(
  name: string,
  choices: Material[],
): Material {
  const eligible = choices.filter(
    (m) =>
      (m.role === "film" || m.role === "all") && m.status !== "quarantined",
  );
  const matches = eligible.filter(
    (m) => m.name === name || m.display_name === name,
  );
  const selected =
    eligible.find((m) => m.name === name) ||
    eligible.find((m) => m.name === `TFC/MATERIAL/${name.toUpperCase()}`) ||
    (matches.length === 1 ? matches[0] : undefined);
  if (!selected)
    throw Error(
      matches.length > 1
        ? "同名材料不唯一，请选择完整材料名称"
        : "找不到材料，请从材料目录选择或先添加材料",
    );
  return selected;
}
