export function parseDistribution(name: string, text: string) {
  name = name.trim().toUpperCase();
  if (!/^[A-Z0-9_-]{1,8}$/.test(name) || name === "EQUAL")
    throw Error("名称需为1–8位字母、数字、下划线或短横线，不能覆盖 EQUAL");
  const rows = text
    .trim()
    .split(/\r?\n/)
    .filter((l) => l.trim())
    .map((l) =>
      l
        .trim()
        .split(/[\s,;]+/)
        .map(Number),
    );
  if (
    !rows.length ||
    rows.length > 1001 ||
    rows.some(
      (r) =>
        r.length !== 2 ||
        r.some((v) => !Number.isFinite(v)) ||
        r[0] < 0 ||
        r[0] > 90 ||
        r[1] < 0 ||
        r[1] > 100,
    )
  )
    throw Error("需1–1001行角度(0–90°)和相对强度(0–100%)，每行两列");
  if (new Set(rows.map((r) => r[0])).size !== rows.length)
    throw Error("角度不能重复");
  if (!rows.some((r) => r[1] > 0)) throw Error("分布强度不能全部为0");
  return { name, samples: rows.sort((a, b) => a[0] - b[0]) };
}
