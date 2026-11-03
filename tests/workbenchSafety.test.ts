import test from "node:test";
import assert from "node:assert/strict";
import { referenceProject } from "../src/defaults.ts";
import { projectKey, hasUnsavedChanges } from "../src/projectStatus.ts";
import { editableCopy, parseNkTable } from "../src/materialEditing.ts";
import { applyMaterialChange } from "../src/applyMaterialChange.ts";
import type { Material } from "../src/types.ts";
test("pristine startup/new project does not warn; mutations and undo compare canonical data", () => {
  const p = referenceProject(),
    baseline = projectKey(p);
  assert.equal(hasUnsavedChanges(p, baseline), false);
  const reordered = JSON.parse(JSON.stringify(p), (_k, v) =>
    v && typeof v === "object" && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v).reverse())
      : v,
  );
  assert.equal(hasUnsavedChanges(reordered, baseline), false);
  reordered.layers[0].thickness_nm += 1;
  assert.equal(hasUnsavedChanges(reordered, baseline), true);
  assert.equal(hasUnsavedChanges(p, baseline), false);
  assert.equal(hasUnsavedChanges(p, ""), true);
});
test("built-in edit retains full spectrum, original identity and provenance while producing a user copy", () => {
  const original = {
    name: "TFC/SOPRA/AG",
    display_name: "AG",
    n: 0.13,
    k: 3.3,
    model: "tabulated",
    role: "all",
    color: "#aaa",
    source: "SOPRA",
    samples: [
      [400, 0.1, 3],
      [700, 0.2, 4],
    ],
    provenance: {
      path: "SOPRA/AG.MAT",
      sha256: "abc",
      encoding: "ascii",
      comments: [],
    },
  } as Material;
  const copy = editableCopy(original, () => "fixed-id");
  assert.equal(copy.name, "USER/fixed-id");
  copy.samples![0][1] = 0.15;
  assert.equal(original.samples![0][1], 0.1);
  assert.equal(copy.provenance?.sha256, "abc");
  assert.equal(copy.collection, "自定义");
});
test("material edit atomically rebinds used layers and substrate; a stale editor cannot overwrite newer input", () => {
  const p = referenceProject(),
    old = p.materials.find((m) => m.name === p.settings.substrate_material)!;
  p.layers[0].material = old.name;
  const edited = { ...old, name: "USER/test", n: 1.8, display_name: "新基底" };
  const next = applyMaterialChange(p, edited, old.name, old, true);
  assert.equal(next.layers[0].material, edited.name);
  assert.equal(next.settings.substrate_material, edited.name);
  assert.equal(next.settings.substrate_n, 1.8);
  assert.equal(p.settings.substrate_material, old.name);
  p.materials.find((m) => m.name === old.name)!.n = 1.7;
  assert.throws(
    () => applyMaterialChange(p, edited, old.name, { ...old, n: 1.52 }),
    /其它窗口/,
  );
});
test("nk editor accepts Excel TSV without losing precision and rejects partial, unordered, negative or conflicting rows", () => {
  assert.deepEqual(parseNkTable("400\t1.234567890123\t0\r\n500\t1.5\t.01"), [
    [400, 1.234567890123, 0],
    [500, 1.5, 0.01],
  ]);
  for (const s of [
    "400 1.5",
    "400 1.5 -1",
    "400 1.5 0\n400 1.6 0",
    "400 1.5 0\n300 1.6 0",
    "400 NaN 0",
    "400\t\t1.5\t0",
    "400,,0",
    "0 1.5 0",
  ])
    assert.throws(() => parseNkTable(s));
});
