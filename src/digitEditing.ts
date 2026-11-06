/** A displayed decimal place is an increment, not a rounding of the stored value. */
export function decimalColumns(value: number, precision = 7) {
  if (!Number.isFinite(value) || value < 0 || value > 1e9)
    throw new Error("数值超出逐位编辑范围");
  const text = value.toFixed(precision),
    dot = text.indexOf(".");
  return [...text].map((character, index) => ({
    character,
    place:
      character === "." ? null : index < dot ? dot - index - 1 : dot - index,
  }));
}
export function incrementPlace(
  value: number,
  place: number,
  direction: number,
) {
  if (
    !Number.isFinite(value) ||
    !Number.isInteger(place) ||
    place < -7 ||
    place > 9 ||
    ![1, -1].includes(direction)
  )
    throw new Error("数位无效");
  const next = Number((value + direction * 10 ** place).toPrecision(15));
  // The displayed 1.0000000 may be stored a few billionths below 1. An
  // explicit step to displayed zero must not manufacture a negative thickness.
  return next < 0 && next > -0.5e-7 ? 0 : next;
}
