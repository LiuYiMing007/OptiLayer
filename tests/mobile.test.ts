import test from "node:test";
import assert from "node:assert/strict";
import { parsePocketProject } from "../src/mobile/data.ts";
const project = {
  schema_version: 1,
  id: "synthetic-mobile",
  name: "手机验收 · 示例膜系",
  layer_order: "substrate_to_air",
  settings: {
    start_nm: 400,
    end_nm: 700,
    step_nm: 1,
    reference_nm: 550,
    angle_deg: 0,
    polarization: "unpolarized",
    incident_n: 1,
    substrate_n: 1.52,
    incident_material: "AIR",
    substrate_material: "GLASS",
  },
  materials: [
    { name: "SIO2", n: 1.46, k: 0 },
    { name: "GLASS", n: 1.52, k: 0 },
    { name: "AIR", n: 1, k: 0 },
  ],
  layers: [{ id: "layer-1", material: "SIO2", thickness_nm: 94.178082 }],
  import_info: { notes: ["保留桌面来源说明"] },
};
test("mobile viewing import preserves full project and provenance without calculation or migration", () => {
  assert.deepEqual(parsePocketProject(JSON.stringify(project)), project);
});
test("mobile rejects missing materials, invalid thickness and render-unsafe display names", () => {
  for (const changed of [
    {
      ...project,
      layers: [{ id: "a", material: "MISSING", thickness_nm: 10 }],
    },
    { ...project, layers: [{ id: "a", material: "SIO2", thickness_nm: -1 }] },
    {
      ...project,
      materials: [{ name: "SIO2", n: 1.46, k: 0, display_name: { bad: true } }],
    },
    { ...project, settings: { ...project.settings, step_nm: 0 } },
    { ...project, settings: { ...project.settings, angle_deg: 90 } },
    { ...project, settings: { ...project.settings, polarization: "invalid" } },
    { ...project, schema_version: 2 },
    null,
    {},
    [],
  ])
    assert.throws(() => parsePocketProject(JSON.stringify(changed)));
});
test("mobile refuses oversized files before JSON parsing", () => {
  assert.throws(() => parsePocketProject(" ".repeat(10_000_001)), /10 MB/);
});
