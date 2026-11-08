import type { Project } from "./types.ts";
import { gridValue, pasteGrid } from "./layerGrid.ts";
export const horizontalColumns = [0, 1, 3, 4] as const;
export const horizontalLabels = [
  "材料",
  "物理厚度 (nm)",
  "1/4 光学厚度",
  "组",
] as const;
export function formatHorizontal(row: number, value: string) {
  if ((row === 1 || row === 2) && !Number.isFinite(Number(value))) return "—";
  return row === 1
    ? Number(value).toFixed(2)
    : row === 2
      ? Number(value).toFixed(4)
      : value;
}
export type ThicknessBasis = "nominal" | "actual";
export function layerGroupFactor(p: Project, col: number) {
  const group = p.layers[col].group || 0;
  return group ? (p.group_factors?.[String(group)] ?? 1) : 1;
}
export function horizontalValue(
  p: Project,
  row: number,
  col: number,
  basis: ThicknessBasis = "nominal",
): string {
  const raw = gridValue(p, {
    row: p.layers.length - 1 - col,
    col: horizontalColumns[row],
  });
  if (basis === "actual" || row === 0 || row === 3) return raw;
  const factor = layerGroupFactor(p, col);
  return factor > 0 ? String(Number(raw) / factor) : "—";
}
export function pasteHorizontal(
  p: Project,
  row: number,
  col: number,
  text: string,
  basis: ThicknessBasis = "nominal",
): Project {
  const rows = text
    .replace(/\r\n?/g, "\n")
    .replace(/\n$/, "")
    .split("\n")
    .map((r) => r.split("\t"));
  const width = rows[0].length;
  if (
    rows.some((r) => r.length !== width) ||
    row + rows.length > horizontalColumns.length ||
    col + width > p.layers.length
  )
    throw Error("粘贴范围超过已有膜层，或不是完整矩形");
  const transposed = Array.from({ length: width }, (_, c) =>
    rows.map((r) => r[width - 1 - c]).join("\t"),
  ).join("\n");
  return pasteLayerTable(
    p,
    { row: p.layers.length - col - width, col: row },
    transposed,
    basis,
  );
}
export function pasteLayerTable(
  p: Project,
  start: { row: number; col: number },
  text: string,
  basis: ThicknessBasis = "nominal",
): Project {
  const cells = text
    .replace(/\r\n?/g, "\n")
    .replace(/\n$/, "")
    .split("\n")
    .map((r) => r.split("\t"));
  const projected =
    basis === "actual"
      ? p
      : {
          ...p,
          layers: p.layers.map((layer, index) => ({
            ...layer,
            thickness_nm:
              layerGroupFactor(p, index) > 0
                ? layer.thickness_nm / layerGroupFactor(p, index)
                : 0,
          })),
        };
  const next = pasteGrid(projected, start, text, horizontalColumns);
  if (basis === "nominal") {
    next.layers.forEach((layer, index) => {
      const editedRow = p.layers.length - 1 - index - start.row;
      const thicknessEdited =
        editedRow >= 0 &&
        editedRow < cells.length &&
        start.col <= 2 &&
        start.col + cells[editedRow].length > 1;
      if (thicknessEdited) {
        const factor = layerGroupFactor(next, index);
        if (factor <= 0)
          throw Error("组系数为零，不能编辑组前厚度；请切换实际厚度模式");
        layer.thickness_nm *= factor;
        if (!Number.isFinite(layer.thickness_nm) || layer.thickness_nm > 1e6)
          throw Error("实际膜厚超出有效范围");
      } else layer.thickness_nm = p.layers[index].thickness_nm;
    });
  }
  return next;
}
