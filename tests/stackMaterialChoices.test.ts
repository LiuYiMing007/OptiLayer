import test from "node:test";
import assert from "node:assert/strict";
import { resolveStackMaterial } from "../src/stackMaterialChoices.ts";
import { generateStack } from "../src/stackFormula.ts";
import { referenceProject } from "../src/defaults.ts";
import type { Material } from "../src/types.ts";
test("TA2O5 explicitly resolves original film data while REF stays a separate historical material", () => {
  const p = referenceProject();
  const original: Material = {
    ...p.materials[0],
    name: "TFC/MATERIAL/TA2O5",
    display_name: "TA2O5",
    n: 2.3,
  };
  const chosen = resolveStackMaterial("TA2O5", [...p.materials, original]);
  assert.equal(chosen.name, original.name);
  p.materials.push(chosen);
  const layer = generateStack(
    p,
    "H",
    [
      {
        symbol: "H",
        material: chosen.name,
        thickness: 1,
        unit: "qw",
        group: 0,
      },
    ],
    () => "new-layer",
  )[0];
  assert.ok(Math.abs(layer.thickness_nm - 550 / (4 * 2.3)) < 1e-12);
  assert.equal(resolveStackMaterial("TA2O5_REF", p.materials).n, 2.1);
  assert.throws(() =>
    resolveStackMaterial("TA2O5", [...p.materials.filter((m) => m !== chosen)]),
  );
});
test("ambiguous film names and substrate records cannot silently replace film choices", () => {
  const a: Material = {
    name: "USER/a",
    display_name: "Film",
    role: "film",
    n: 2,
    k: 0,
    color: "#000",
  };
  assert.throws(() =>
    resolveStackMaterial("Film", [a, { ...a, name: "USER/b" }]),
  );
  assert.equal(
    resolveStackMaterial("USER/b", [a, { ...a, name: "USER/b" }]).name,
    "USER/b",
  );
  assert.throws(() =>
    resolveStackMaterial("glass", [{ ...a, name: "glass", role: "substrate" }]),
  );
});
