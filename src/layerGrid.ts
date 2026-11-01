import { physicalThickness, thicknessValue } from "./model.ts";
import type { Project } from "./types.ts";
export const thicknessUnits = ["physical", "optical", "qwot"] as const;
export type GridCell = { row: number; col: number };
export function moveCell(
  cell: GridCell,
  key: string,
  rows: number,
  backwards = false,
): GridCell {
  let { row, col } = cell;
  if (key === "Tab") {
    col += backwards ? -1 : 1;
    if (col > 3) {
      col = 0;
      row++;
    }
    if (col < 0) {
      col = 3;
      row--;
    }
  }
  if (key === "Enter") row += backwards ? -1 : 1;
  if (key === "ArrowUp") row--;
  if (key === "ArrowDown") row++;
  if (key === "ArrowLeft") col--;
  if (key === "ArrowRight") col++;
  return {
    row: Math.max(0, Math.min(rows - 1, row)),
    col: Math.max(0, Math.min(3, col)),
  };
}
export function gridValue(p: Project, cell: GridCell): string {
  const l = p.layers[p.layers.length - 1 - cell.row];
  if (!l) return "";
  if (!cell.col) return l.material;
  const n = p.materials.find((m) => m.name === l.material)!.n;
  return String(
    thicknessValue(
      l.thickness_nm,
      n,
      p.settings.reference_nm,
      thicknessUnits[cell.col - 1],
    ),
  );
}
// Validate the entire rectangle before mutation: one paste becomes one history entry.
export function pasteGrid(p: Project, start: GridCell, text: string): Project {
  const lines = text
    .replace(/\r\n?/g, "\n")
    .replace(/\n$/, "")
    .split("\n")
    .map((l) => l.split("\t"));
  if (
    !text.trim() ||
    start.row + lines.length > p.layers.length ||
    lines.some((l) => start.col + l.length > 4)
  )
    throw new Error("粘贴范围超出已有膜层或可编辑列。");
  const next = structuredClone(p);
  lines.forEach((cells, r) => {
    const layer = next.layers[next.layers.length - 1 - start.row - r];
    if (start.col === 0) {
      const name = cells[0].trim();
      if (
        !p.materials.some(
          (m) =>
            m.name === name &&
            (m.role === "film" ||
              m.role === "all" ||
              p.layers.some((l) => l.material === name)),
        )
      )
        throw new Error(`材料不存在或不能用于膜层：${name}`);
      layer.material = name;
    }
    const n = next.materials.find((m) => m.name === layer.material)!.n;
    const ds: number[] = [];
    cells.forEach((text, c) => {
      const col = start.col + c;
      if (!col) return;
      const v = Number(text.trim());
      if (!text.trim() || !Number.isFinite(v) || v < 0)
        throw new Error("厚度必须是有限的非负数。");
      const d = physicalThickness(
        v,
        n,
        next.settings.reference_nm,
        thicknessUnits[col - 1],
      );
      if (!Number.isFinite(d)) throw new Error("厚度换算无效。");
      ds.push(d);
    });
    if (
      ds.some(
        (d) =>
          Math.abs(d - ds[0]) >
          1e-9 * Math.max(1, Math.abs(d), Math.abs(ds[0])),
      )
    )
      throw new Error(
        "同一膜层的物理厚度、光学厚度与 QWOT 不一致，请只粘贴需要修改的一列。",
      );
    if (ds.length) layer.thickness_nm = ds[0];
  });
  return next;
}
