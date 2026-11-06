import test from "node:test";
import assert from "node:assert/strict";
import {
  interactiveProject,
  interactiveValue,
} from "../src/interactiveModel.ts";
import type { Project } from "../src/types.ts";
const project = () =>
  ({
    settings: { angle_deg: 0, reference_nm: 550 },
    materials: [{ name: "H", n: 2, k: 0, model: "constant" }],
    layers: [
      { id: "a", material: "H", thickness_nm: 100 },
      { id: "b", material: "H", thickness_nm: 200 },
    ],
  }) as Project;
test("QWOT adjustment preserves conversion and never changes source project", () => {
  const p = project();
  const t = { kind: "qwot", layerId: "a" } as const;
  assert.equal(interactiveValue(p, t), 800 / 550);
  const next = interactiveProject(p, t, 1);
  assert.equal(next.layers[0].thickness_nm, 68.75);
  assert.equal(p.layers[0].thickness_nm, 100);
});
test("scale previews always refer to baseline, not compounded preceding preview", () => {
  const p = project();
  assert.deepEqual(
    interactiveProject(p, { kind: "scale" }, 1.1).layers.map(
      (l) => l.thickness_nm,
    ),
    [110.00000000000001, 220.00000000000003],
  );
  assert.deepEqual(
    interactiveProject(p, { kind: "scale" }, 1).layers,
    p.layers,
  );
  assert.equal(
    interactiveProject(p, { kind: "angle" }, 45).settings.angle_deg,
    45,
  );
});
test("invalid inputs, stale layers and overflowing thicknesses are rejected", () => {
  for (const v of [NaN, Infinity, -1, 90])
    assert.throws(() => interactiveProject(project(), { kind: "angle" }, v));
  assert.throws(() =>
    interactiveProject(project(), { kind: "physical", layerId: "deleted" }, 1),
  );
  assert.throws(() => interactiveProject(project(), { kind: "scale" }, 1e308));
});

test("back-face tuning and whole-stack scale keep both surfaces attached", () => {
  const p = project();
  p.back_layers = [{ id: "rear", material: "H", thickness_nm: 80 }];
  const next = interactiveProject(p, { kind: "physical", layerId: "rear" }, 90);
  assert.equal(next.back_layers![0].thickness_nm, 90);
  assert.deepEqual(next.layers, p.layers);
  assert.equal(
    interactiveProject(p, { kind: "scale" }, 1.5).back_layers![0].thickness_nm,
    120,
  );
});
test("group factor scales only members across both faces using the stored factor once", () => {
  const p = project();
  p.layers[0].group = 2;
  p.back_layers = [{ ...p.layers[1], id: "rear", group: 2 }];
  p.group_factors = { "2": 2 };
  const target = { kind: "group", group: 2 } as const;
  assert.equal(interactiveValue(p, target), 2);
  const next = interactiveProject(p, target, 3);
  assert.equal(next.layers[0].thickness_nm, 150);
  assert.equal(next.layers[1].thickness_nm, 200);
  assert.equal(next.back_layers![0].thickness_nm, 300);
  assert.equal(next.group_factors!["2"], 3);
  assert.equal(p.layers[0].thickness_nm, 100);
  assert.deepEqual(interactiveProject(p, target, 2), p);
  assert.throws(() => interactiveProject(p, { kind: "group", group: 9 }, 2));
});
test("group membership paste and patches round trip without changing thickness", async () => {
  const { pasteGrid, gridValue } = await import("../src/layerGrid.ts");
  const { patchesBetween, applyPatches } =
    await import("../src/tools/state.ts");
  const p = project(),
    q = pasteGrid(p, { row: 0, col: 4 }, "3\n3");
  assert.equal(gridValue(q, { row: 0, col: 4 }), "3");
  assert.equal(q.layers[0].thickness_nm, 100);
  const next = applyPatches(p, patchesBetween(p, q));
  assert.deepEqual(next, q);
  assert.throws(() => pasteGrid(p, { row: 0, col: 4 }, "1.5"));
  assert.throws(() => pasteGrid(p, { row: 0, col: 4 }, "-1"));
});

test("restoring an optical-thickness original preserves the exact original project snapshot", () => {
  const p = project();
  p.layers[0].thickness_nm = 13.12345678912345;
  const target = { kind: "qwot", layerId: "a" } as const;
  assert.deepEqual(
    interactiveProject(p, target, interactiveValue(p, target)),
    p,
  );
});
