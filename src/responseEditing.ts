import type { SpectralResponse } from "./types.ts";
export function parseResponse(
  name: string,
  text: string,
  detector: boolean,
): SpectralResponse {
  name = name.trim();
  if (!name || name.length > 100 || ["WHITE", "IDEAL"].includes(name))
    throw new Error("请输入自定义名称，不能覆盖 WHITE 或 IDEAL");
  const lines = text
    .trim()
    .split(/\r?\n/)
    .filter((l) => l.trim());
  if (lines.length < 2 || lines.length > 10001)
    throw new Error("需要 2–10001 行响应数据");
  let previous = 0;
  const samples = lines.map((line, i): [number, number] => {
    const tokens = line.trim().split(/[\s,;]+/);
    const [w, value] = tokens.map(Number);
    if (
      tokens.length !== 2 ||
      !Number.isFinite(w) ||
      !Number.isFinite(value) ||
      w <= previous ||
      w > 1e7 ||
      value < 0 ||
      value > (detector ? 100 : 1e9)
    )
      throw new Error(
        `第 ${i + 1} 行无效：波长须递增，响应为非负百分数${detector ? "且不超过 100%" : ""}`,
      );
    previous = w;
    return [w, value];
  });
  return { name, samples };
}
