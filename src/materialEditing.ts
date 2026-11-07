import type { Material } from "./types.ts";
export function editableCopy(
  m: Material,
  id: () => string = () => crypto.randomUUID(),
): Material {
  const copy = structuredClone(m);
  delete copy.catalogue_summary;
  delete copy.preview;
  delete copy.duplicate_of;
  delete copy.issues;
  if (copy.name.startsWith("TFC/")) {
    copy.name = `USER/${id()}`;
    copy.display_name = `${m.display_name || m.name}（副本）`;
    delete copy.collection;
    copy.source = `用户编辑副本；原始来源：${m.source}`;
  }
  copy.status = "ready";
  return copy;
}
export function parseNkTable(text: string): number[][] {
  const lines = text
    .trim()
    .split(/\r?\n/)
    .filter((l) => l.trim());
  if (!lines.length || lines.length > 10001)
    throw Error("n/k 数据表需要 1–10001 行");
  let last = 0;
  return lines.map((line, i) => {
    const fields = line.includes("\t")
      ? line.split("\t")
      : line.includes(",")
        ? line.split(",")
        : line.includes(";")
          ? line.split(";")
          : line.trim().split(/\s+/);
    if (fields.some((v) => !v.trim()))
      throw Error(`第 ${i + 1} 行包含空单元格`);
    const values = fields.map(Number);
    if (
      values.length !== 3 ||
      values.some((v) => !Number.isFinite(v)) ||
      values[0] <= last ||
      values[1] <= 0 ||
      values[2] < 0
    )
      throw Error(`第 ${i + 1} 行无效：需要递增波长、正 n、非负 k 的三列数值`);
    last = values[0];
    return values;
  });
}
