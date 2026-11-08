export function parseChartRange(min: string, max: string): [number, number] {
  const low = Number(min),
    high = Number(max);
  if (
    !min.trim() ||
    !max.trim() ||
    !Number.isFinite(low) ||
    !Number.isFinite(high) ||
    high <= low ||
    !Number.isFinite(high - low)
  )
    throw Error("纵轴下限和上限必须为有效数值，且上限大于下限");
  return [low, high];
}
