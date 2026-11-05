import type { Material, Project, TargetPoint } from "./types";
import { materialAt } from "./materials.ts";
export type ThicknessUnit = "physical" | "optical" | "qwot";
export function thicknessValue(
  d: number,
  n: number,
  reference: number,
  unit: ThicknessUnit,
): number {
  return unit === "physical"
    ? d
    : unit === "optical"
      ? n * d
      : (4 * n * d) / reference;
}
export function physicalThickness(
  value: number,
  n: number,
  reference: number,
  unit: ThicknessUnit,
): number {
  if (!Number.isFinite(value) || n <= 0 || reference <= 0) return NaN;
  return unit === "physical"
    ? value
    : unit === "optical"
      ? value / n
      : (value * reference) / (4 * n);
}
export function synchronizeBoundaries(p: Project): void {
  if (
    (p.settings.substrate_model || "semi_infinite") !== "semi_infinite" ||
    p.back_layers?.length ||
    p.settings.first_surface === "back" ||
    (p.settings.illuminant && p.settings.illuminant !== "WHITE") ||
    (p.settings.detector && p.settings.detector !== "IDEAL") ||
    p.response_data
  )
    p.schema_version = 2;
  if (
    (p.settings.substrate_model || "semi_infinite") === "semi_infinite" &&
    p.settings.exit_material !== undefined
  )
    p.settings.exit_material = p.settings.substrate_material;
  for (const kind of ["incident", "substrate"] as const) {
    const m = p.materials.find(
      (m) => m.name === p.settings[`${kind}_material`],
    );
    if (m) {
      const n = materialAt(m, p.settings.reference_nm)[0];
      if (Number.isFinite(n) && n > 0) p.settings[`${kind}_n`] = n;
    }
  }
}
export function replaceMaterial(p: Project, material: Material): void {
  const index = p.materials.findIndex((m) => m.name === material.name);
  if (index < 0) p.materials.push(structuredClone(material));
  else p.materials[index] = structuredClone(material);
  synchronizeBoundaries(p);
}
// JSON objects may arrive in a different key order through native transports.
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, item]) => [key, canonical(item)]),
    );
  return value;
}
export const physicalSignature = (p: Project) =>
  JSON.stringify(
    canonical({
      settings: p.settings,
      materials: p.materials,
      layers: p.layers,
      back_layers: p.back_layers || [],
      response_data: p.response_data || {},
      layer_order: p.layer_order,
    }),
  );
export function parseTargetCsv(text: string): TargetPoint[] {
  const lines = text
    .replace(/^\uFEFF/, "")
    .trim()
    .split(/\r?\n/)
    .filter((l) => l.trim());
  const header =
    lines
      .shift()
      ?.split(",")
      .map((s) => s.trim()) || [];
  const xi = header.indexOf("wavelength_nm"),
    ti = header.indexOf("T_percent"),
    ri = header.indexOf("R_percent");
  if (xi < 0 || (ti < 0 && ri < 0))
    throw new Error(
      "CSV 需要 wavelength_nm，以及 T_percent / R_percent 中至少一列",
    );
  if (lines.length < 2 || lines.length > 10001)
    throw new Error("目标曲线需要 2–10001 个点");
  const points = lines.map((line, index) => {
    const row = line.split(",");
    const read = (i: number) => (row[i]?.trim() ? Number(row[i]) : NaN);
    const point: TargetPoint = { wavelength_nm: read(xi) };
    if (ti >= 0 && row[ti]?.trim()) point.T_percent = read(ti);
    if (ri >= 0 && row[ri]?.trim()) point.R_percent = read(ri);
    if (
      !Number.isFinite(point.wavelength_nm) ||
      point.wavelength_nm <= 0 ||
      [point.T_percent, point.R_percent].some(
        (v) => v !== undefined && (!Number.isFinite(v) || v < 0 || v > 100),
      ) ||
      (point.T_percent === undefined && point.R_percent === undefined)
    )
      throw new Error(
        `目标曲线第 ${index + 2} 行无效；R/T 使用 0–100 的百分数`,
      );
    return point;
  });
  points.sort((a, b) => a.wavelength_nm - b.wavelength_nm);
  if (
    points.some(
      (p, i) => i > 0 && p.wavelength_nm === points[i - 1].wavelength_nm,
    )
  )
    throw new Error("目标曲线波长不能重复");
  return points;
}
