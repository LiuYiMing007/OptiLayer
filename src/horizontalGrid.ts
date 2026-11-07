import type { Project } from "./types.ts";
import { pasteGrid } from "./layerGrid.ts";
export function pasteHorizontal(
  p: Project,
  row: number,
  col: number,
  text: string,
): Project {
  const rows = text
    .replace(/\r\n?/g, "\n")
    .replace(/\n$/, "")
    .split("\n")
    .map((r) => r.split("\t"));
  const width = rows[0].length;
  if (
    rows.some((r) => r.length !== width) ||
    row + rows.length > 5 ||
    col + width > p.layers.length
  )
    throw Error("粘贴范围超过已有膜层，或不是完整矩形");
  const transposed = Array.from({ length: width }, (_, c) =>
    rows.map((r) => r[width - 1 - c]).join("\t"),
  ).join("\n");
  return pasteGrid(
    p,
    { row: p.layers.length - col - width, col: row },
    transposed,
  );
}
