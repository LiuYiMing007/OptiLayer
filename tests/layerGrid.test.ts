import test from "node:test";
import assert from "node:assert/strict";
import { gridValue, moveCell, pasteGrid } from "../src/layerGrid.ts";
import { curveStyle, chartTheme } from "../src/design/chartTheme.ts";
import type { Project } from "../src/types.ts";
const project = () =>
  ({
    settings: { reference_nm: 550 },
    materials: [
      { name: "H", n: 2, role: "film" },
      { name: "L", n: 1.5, role: "film" },
    ],
    layers: [
      { id: "bottom", material: "L", thickness_nm: 9.541234567891 },
      { id: "top", material: "H", thickness_nm: 100 },
    ],
  }) as Project;
test("grid order is incidence-first; rectangular clipboard preserves full physical precision", () => {
  const p = project();
  assert.equal(gridValue(p, { row: 0, col: 0 }), "H");
  assert.equal(gridValue(p, { row: 1, col: 1 }), "9.541234567891");
  const text = [0, 1]
    .map((row) =>
      [0, 1, 2, 3].map((col) => gridValue(p, { row, col })).join("\t"),
    )
    .join("\r\n");
  assert.deepEqual(pasteGrid(p, { row: 0, col: 0 }, text).layers, p.layers);
});
test("multirow paste converts optical units atomically and does not mutate source", () => {
  const p = project();
  const q = pasteGrid(p, { row: 0, col: 2 }, "210\n30\n");
  assert.equal(q.layers[1].thickness_nm, 105);
  assert.equal(q.layers[0].thickness_nm, 20);
  assert.equal(p.layers[1].thickness_nm, 100);
  assert.throws(() => pasteGrid(p, { row: 0, col: 1 }, "105\nNaN"));
  assert.throws(() => pasteGrid(p, { row: 0, col: 1 }, "105\t205"));
  assert.throws(() => pasteGrid(p, { row: 0, col: 0 }, "unknown"));
  assert.throws(() => pasteGrid(p, { row: 1, col: 4 }, "1\t2"));
  assert.throws(() => pasteGrid(p, { row: 0, col: 1 }, "-1"));
  assert.equal(p.layers[1].thickness_nm, 100);
});
test("material + physical paste resolves n using new material, without changing unrelated rows", () => {
  const p = project();
  const q = pasteGrid(p, { row: 0, col: 0 }, "L\t105");
  assert.equal(q.layers[1].material, "L");
  assert.equal(q.layers[1].thickness_nm, 105);
  assert.deepEqual(q.layers[0], p.layers[0]);
});
test("Tab wraps editable columns; reverse Tab, Enter and arrows clamp to actual grid", () => {
  assert.deepEqual(moveCell({ row: 0, col: 4 }, "Tab", 2), { row: 1, col: 0 });
  assert.deepEqual(moveCell({ row: 1, col: 0 }, "Tab", 2, true), {
    row: 0,
    col: 4,
  });
  assert.deepEqual(moveCell({ row: 1, col: 2 }, "Enter", 2), {
    row: 1,
    col: 2,
  });
  assert.deepEqual(moveCell({ row: 0, col: 0 }, "ArrowLeft", 2), {
    row: 0,
    col: 0,
  });
});
test("semantic chart theme distinguishes channels and sources, keeps S/P channel color", () => {
  assert.notEqual(curveStyle("T").color, curveStyle("R").color);
  assert.equal(curveStyle("T", "computed", "s").color, chartTheme.channels.T);
  assert.notEqual(
    curveStyle("T", "computed", "s").dash,
    curveStyle("T", "computed", "p").dash,
  );
  assert.notEqual(curveStyle("T", "target").dash, curveStyle("T").dash);
  assert.equal(
    curveStyle("T", "comparison", undefined, 4).color,
    chartTheme.comparison[0],
  );
});
