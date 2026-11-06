import test from "node:test";
import assert from "node:assert/strict";
import { decimalColumns, incrementPlace } from "../src/digitEditing.ts";
test("decimal-place increments carry and borrow without rounding unrelated precision", () => {
  assert.equal(incrementPlace(9.9, 0, 1), 10.9);
  assert.equal(incrementPlace(10.1, 0, -1), 9.1);
  assert.equal(incrementPlace(0.264055012345, -3, 1), 0.265055012345);
  assert.equal(incrementPlace(1, -7, -1), 0.9999999);
  assert.equal(incrementPlace(0.999999996, 0, -1), 0);
  assert.equal(incrementPlace(0.5, 0, -1), -0.5);
  assert.throws(() => incrementPlace(1, -9, 1));
});
test("TFC decimal columns keep seven fractional controls and correct place weights", () => {
  const columns = decimalColumns(123.264055);
  assert.equal(columns.map((c) => c.character).join(""), "123.2640550");
  assert.deepEqual(
    columns.filter((c) => c.place !== null).map((c) => c.place),
    [2, 1, 0, -1, -2, -3, -4, -5, -6, -7],
  );
  assert.throws(() => decimalColumns(Infinity));
});
