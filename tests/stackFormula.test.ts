import test from "node:test";
import assert from "node:assert/strict";
import { generateStack, replaceStack } from "../src/stackFormula.ts";
import { pasteHorizontal } from "../src/horizontalGrid.ts";
import type { Project } from "../src/types.ts";
const project = () =>
  ({
    settings: { reference_nm: 400, substrate_model: "incoherent" },
    materials: [
      { name: "H", model: "constant", n: 2, k: 0 },
      { name: "L", model: "constant", n: 1.5, k: 0 },
    ],
    layers: [
      { id: "a", material: "H", thickness_nm: 50 },
      { id: "b", material: "L", thickness_nm: 100 },
    ],
    group_factors: { "1": 2 },
  }) as unknown as Project;
const symbols = [
  { symbol: "H", material: "H", thickness: 1, unit: "qw", group: 0 },
  { symbol: "L", material: "L", thickness: 30, unit: "nm", group: 0 },
] as const;
let id = 0;
const generate = (text: string) =>
  generateStack(project(), text, [...symbols], () => `new-${++id}`);
test("stack formula ordering, nested scaling and group factors are physical exactly once", () => {
  assert.deepEqual(
    generate("G1 0.5(HL)^2").map((l) => l.thickness_nm),
    [50, 30, 50, 30],
  );
  assert.deepEqual(
    generate("H (0.5L H)^2").map((l) => l.material),
    ["H", "L", "H", "L", "H"],
  );
  assert.equal(new Set(generate("(HL)^5").map((l) => l.id)).size, 10);
});
test("stack parser rejects executable input, malformed grammar, undefined groups and resource exhaustion", () => {
  for (const s of [
    "",
    "H;process.exit()",
    "(HL)",
    "(HL)^0",
    "(HL)^1.5",
    "(HL)^501",
    "G2HL",
    "-1H",
    "H)",
    "(HL",
    "NaN H",
  ])
    assert.throws(() => generate(s), s);
});
test("stack replacement checks optimistic state, rear medium and is atomic", () => {
  const p = project(),
    layers = generate("HL");
  assert.equal(replaceStack(p, "front", p.layers, layers).layers.length, 2);
  assert.equal(p.layers[0].id, "a");
  assert.throws(() => replaceStack(p, "front", [], layers));
  assert.throws(() =>
    replaceStack(
      { ...p, settings: { ...p.settings, substrate_model: "semi_infinite" } },
      "back",
      [],
      layers,
    ),
  );
  assert.throws(() => replaceStack(p, "front", p.layers, [p.layers[0]]));
});
test("horizontal clipboard preserves substrate-outward order and rejects inconsistent thickness rectangle", () => {
  const p = project(),
    next = pasteHorizontal(p, 1, 0, "60\t110");
  assert.deepEqual(
    next.layers.map((l) => l.thickness_nm),
    [60, 110],
  );
  assert.deepEqual(
    p.layers.map((l) => l.thickness_nm),
    [50, 100],
  );
  assert.throws(() => pasteHorizontal(p, 1, 0, "60\t110\n100\t100"));
  assert.throws(() => pasteHorizontal(p, 0, 1, "H\tL"));
  assert.throws(() => pasteHorizontal(p, 4, 0, "1.5"));
});
