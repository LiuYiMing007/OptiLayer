import test from "node:test";
import assert from "node:assert/strict";
import { referenceProject } from "../src/defaults.ts";
import { parseChartRange } from "../src/chartRange.ts";
import {
  horizontalValue,
  formatHorizontal,
  pasteHorizontal,
  pasteLayerTable,
  horizontalLabels,
} from "../src/horizontalGrid.ts";
import { moveCell } from "../src/layerGrid.ts";
import { interactiveProject } from "../src/interactiveModel.ts";

test("manual chart ranges accept narrow/negative domains and reject incomplete or inverted inputs", () => {
  assert.deepEqual(parseChartRange("99.5", "100"), [99.5, 100]);
  assert.deepEqual(parseChartRange("-0.1", "0.2"), [-0.1, 0.2]);
  for (const [a, b] of [
    ["", "100"],
    ["0", ""],
    ["NaN", "100"],
    ["Infinity", "100"],
    ["2", "1"],
    ["1", "1"],
  ])
    assert.throws(() => parseChartRange(a, b));
});
test("layer format shows two/four decimals without changing stored precision or including optical-nm column", () => {
  assert.equal(formatHorizontal(1, "10.539996"), "10.54");
  assert.equal(formatHorizontal(2, "0.264055"), "0.2641");
  assert.equal(formatHorizontal(1, "—"), "—");
  assert.equal(formatHorizontal(3, "2"), "2");
  assert.equal(horizontalLabels.length, 4);
  assert.ok(!horizontalLabels.some((l) => l === ("光学厚度 (nm)" as string)));
});
test("nominal and effective thickness show TFCalc group convention; edits and previews multiply once", () => {
  const p = referenceProject();
  p.layers[0].thickness_nm = 125;
  p.layers[0].group = 1;
  p.group_factors = { "1": 1.25 };
  assert.equal(Number(horizontalValue(p, 1, 0)), 100);
  assert.equal(Number(horizontalValue(p, 1, 0, "actual")), 125);
  const edited = pasteHorizontal(p, 1, 0, "105");
  assert.equal(edited.layers[0].thickness_nm, 131.25);
  const scaled = interactiveProject(edited, { kind: "group", group: 1 }, 1.5);
  assert.equal(scaled.layers[0].thickness_nm, 157.5);
  assert.equal(Number(horizontalValue(scaled, 1, 0)), 105);
  assert.equal(p.layers[0].thickness_nm, 125);
  const vertical = pasteLayerTable(
    p,
    { row: p.layers.length - 1, col: 1 },
    "105",
  );
  assert.equal(vertical.layers[0].thickness_nm, 131.25);
});
test("visible QWOT and group fields paste into the right underlying field after optical-nm removal", () => {
  const p = referenceProject();
  p.layers[0].group = 1;
  p.group_factors = { "1": 2 };
  const q = Number(horizontalValue(p, 2, 0));
  const edited = pasteHorizontal(p, 2, 0, String(q * 2));
  assert.ok(
    Math.abs(edited.layers[0].thickness_nm - p.layers[0].thickness_nm * 2) <
      1e-10,
  );
  const grouped = pasteHorizontal(p, 3, 0, "3");
  assert.equal(grouped.layers[0].group, 3);
  assert.equal(grouped.layers[0].thickness_nm, p.layers[0].thickness_nm);
  assert.deepEqual(moveCell({ row: 0, col: 3 }, "Tab", 4, false, 4), {
    row: 1,
    col: 0,
  });
});
test("zero group cannot invent nominal thickness, and mixed physical/QWOT paste remains atomic", () => {
  const p = referenceProject();
  p.layers[0].group = 1;
  p.group_factors = { "1": 0 };
  p.layers[0].thickness_nm = 0;
  assert.equal(horizontalValue(p, 1, 0), "—");
  assert.throws(() => pasteHorizontal(p, 1, 0, "100"), /组系数为零/);
  assert.equal(
    pasteHorizontal(p, 1, 0, "100", "actual").layers[0].thickness_nm,
    100,
  );
  assert.throws(
    () => pasteHorizontal(referenceProject(), 1, 0, "100\n100"),
    /不一致/,
  );
});
