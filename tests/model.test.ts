import test from "node:test";
import assert from "node:assert/strict";
import {
  physicalThickness,
  physicalSignature,
  thicknessValue,
  parseTargetCsv,
  synchronizeBoundaries,
} from "../src/model.ts";
import type { Project } from "../src/types.ts";

test("QWOT and optical thickness round-trip to the physical thickness used by optics", () => {
  assert.equal(physicalThickness(1, 2, 550, "qwot"), 68.75);
  assert.equal(physicalThickness(137.5, 2, 550, "optical"), 68.75);
  for (const unit of ["physical", "optical", "qwot"] as const) {
    const d = physicalThickness(
      thicknessValue(9.54, 2.1, 380, unit),
      2.1,
      380,
      unit,
    );
    assert.ok(Math.abs(d - 9.54) < 1e-12);
  }
});
test("changing a named substrate refreshes the boundary index without changing layer thickness", () => {
  const p = {
    settings: {
      substrate_material: "CUSTOM",
      substrate_n: 1.52,
      incident_material: "AIR",
      incident_n: 1,
    },
    materials: [
      { name: "CUSTOM", n: 1.73 },
      { name: "AIR", n: 1 },
    ],
    layers: [{ thickness_nm: 9.54 }],
  } as Project;
  synchronizeBoundaries(p);
  assert.equal(p.settings.substrate_n, 1.73);
  assert.equal(p.layers[0].thickness_nm, 9.54);
});
test("target CSV uses explicit percent columns and rejects invalid or duplicate data", () => {
  const points = parseTargetCsv(
    "\ufeffwavelength_nm,T_percent\n450,95\n400,90",
  );
  assert.equal(points[0].wavelength_nm, 400);
  assert.equal(points[1].T_percent, 95);
  assert.throws(() =>
    parseTargetCsv("wavelength_nm,T_percent\n400,90\n400,95"),
  );
  assert.throws(() =>
    parseTargetCsv("wavelength_nm,T_percent\n400,101\n450,90"),
  );
  assert.throws(() =>
    parseTargetCsv("wavelength_nm,T_percent\n400,NaN\n450,90"),
  );
});

test("native JSON key reordering preserves valid spectrum signatures, physical edits invalidate them", () => {
  const p = {
    settings: { angle_deg: 25, start_nm: 400 },
    materials: [{ name: "M", n: 2.1, k: 0 }],
    layers: [{ id: "l", material: "M", thickness_nm: 72 }],
    layer_order: "substrate_to_air",
  } as Project;
  const reorder = (value: unknown): unknown =>
    Array.isArray(value)
      ? value.map(reorder)
      : value && typeof value === "object"
        ? Object.fromEntries(
            Object.entries(value)
              .reverse()
              .map(([k, v]) => [k, reorder(v)]),
          )
        : value;
  const transported = reorder(p) as Project;
  assert.equal(physicalSignature(p), physicalSignature(transported));
  transported.layers[0].thickness_nm += 1;
  assert.notEqual(physicalSignature(p), physicalSignature(transported));
});
