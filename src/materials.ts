import type { Material } from "./types.ts";
/** UI reference display only; Optical Core evaluates the entire wavelength grid. */
export function materialAt(m: Material, nm: number): [number, number] {
  if (m.catalogue_summary) return [m.n, m.k];
  if (!m.model || m.model === "constant") return [m.n, m.k];
  if (m.model === "tabulated" && m.samples?.length) {
    const a = m.samples;
    if (nm <= a[0][0]) return [a[0][1], a[0][2]];
    if (nm >= a.at(-1)![0]) return [a.at(-1)![1], a.at(-1)![2]];
    let lo = 0,
      hi = a.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (a[mid][0] <= nm) lo = mid;
      else hi = mid;
    }
    const f = (nm - a[lo][0]) / (a[hi][0] - a[lo][0]);
    return [1, 2].map((i) => a[lo][i] + f * (a[hi][i] - a[lo][i])) as [
      number,
      number,
    ];
  }
  const f = m.formula;
  if (!f || !m.range_nm || nm < m.range_nm[0] || nm > m.range_nm[1])
    return [NaN, NaN];
  const a = f.coefficients,
    b = f.k_coefficients,
    x = nm / 1000,
    x2 = x * x;
  const n =
    f.n_type === 1
      ? Math.sqrt(a[0] + (a[1] * x2) / (x2 - a[2]))
      : f.n_type === 4
        ? Math.sqrt(
            1 +
              [0, 2, 4].reduce((v, i) => v + (a[i] * x2) / (x2 - a[i + 1]), 0),
          )
        : f.n_type === 5
          ? a[0] + a[1] / x2 + a[2] / (x2 * x2)
          : f.n_type === 6
            ? a[0] + (a[1] === 0 ? 0 : a[1] / (x - a[2]))
            : NaN;
  return [
    n,
    f.k_type === 1 ? 0 : 1 / (n * (b[0] * x + b[1] / x + b[2] / x ** 3)),
  ];
}
export const materialLabel = (m: Material) => m.display_name || m.name;
export function matchesMaterial(m: Material, query: string): boolean {
  const text =
    `${m.name} ${m.display_name || ""} ${m.collection || ""} ${m.source} ${m.provenance?.comments?.join(" ") || ""}`.toLocaleLowerCase();
  return query
    .trim()
    .toLocaleLowerCase()
    .split(/\s+/)
    .every((word) => text.includes(word));
}
