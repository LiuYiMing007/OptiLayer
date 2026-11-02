import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { materialAt, matchesMaterial } from "../src/materials.ts";
import { gridValue, pasteGrid } from "../src/layerGrid.ts";
import { synchronizeBoundaries } from "../src/model.ts";
import type { Material, Project } from "../src/types.ts";
const catalogue = JSON.parse(
  fs.readFileSync(
    new URL("../engine/data/tfcalc-catalogue.json", import.meta.url),
    "utf8",
  ),
).materials as Material[];
const find = (name: string) => catalogue.find((m) => m.name === name)!;
test("reference indices use tabulated interpolation and exact formula coefficients", () => {
  const m = find("TFC/SCHOTT/BK7");
  assert.ok(Math.abs(materialAt(m, 587.6)[0] - 1.5168) < 5e-5);
  const c = find("TFC/SUBSTRAT/12");
  assert.ok(
    Math.abs(
      materialAt(c, 550)[0] -
        (1.79175926 + 0.0121758785 / 0.55 ** 2 + 0.0000135464689 / 0.55 ** 4),
    ) < 1e-12,
  );
  assert.ok(Number.isNaN(materialAt(c, 900)[0]));
  const silver = find("TFC/SOPRA/AG");
  const a = silver.samples![0];
  assert.deepEqual(materialAt(silver, a[0] - 10), [a[1], a[2]]);
});
test("search accepts case insensitive names, original Chinese filenames and multiple tokens", () => {
  assert.ok(matchesMaterial(find("TFC/SCHOTT/BK7"), "schott bk7"));
  assert.ok(!matchesMaterial(find("TFC/SCHOTT/BK7"), "schott silver"));
  assert.ok(
    catalogue.some(
      (m) => m.display_name?.includes("肖特") && matchesMaterial(m, "肖特"),
    ),
  );
});
test("optical thickness uses index at current reference, not the cached preview n", () => {
  const m = find("TFC/SUBSTRAT/12");
  const p = {
    settings: {
      reference_nm: 600,
      incident_material: "AIR",
      substrate_material: m.name,
      substrate_n: m.n,
    },
    materials: [m],
    layers: [{ id: "x", material: m.name, thickness_nm: 100 }],
  } as Project;
  const n = materialAt(m, 600)[0];
  synchronizeBoundaries(p);
  assert.equal(p.settings.substrate_n, n);
  assert.equal(Number(gridValue(p, { row: 0, col: 2 })), 100 * n);
  const next = pasteGrid(p, { row: 0, col: 2 }, String(200 * n));
  assert.ok(Math.abs(next.layers[0].thickness_nm - 200) < 1e-10);
});
