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
