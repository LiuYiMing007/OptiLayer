import test from "node:test";
import assert from "node:assert/strict";
import { applyPatches, patchesBetween, patchKey } from "../src/tools/state.ts";
import { CalculationQueue } from "../src/calculationQueue.ts";
import type { Project, Spectrum } from "../src/types.ts";
const project = (): Project => ({
  schema_version: 1,
  id: "p",
  name: "Test",
  layer_order: "substrate_to_air",
  settings: {
    start_nm: 400,
    end_nm: 800,
    step_nm: 1,
    reference_nm: 550,
    angle_deg: 0,
    polarization: "unpolarized",
    incident_n: 1,
    substrate_n: 1.5,
    incident_material: "AIR",
    substrate_material: "GLASS",
  },
  materials: ["AIR", "GLASS", "H"].map((name, i) => ({
    name,
    n: [1, 1.5, 2.1][i],
    k: 0,
    color: "#abc",
    model: "constant",
    role: "all",
    source: "test",
  })),
  layers: [
    { id: "a", material: "H", thickness_nm: 100 },
    { id: "b", material: "H", thickness_nm: 200 },
  ],
});
function edits(p: Project, change: (p: Project) => void) {
  const next = structuredClone(p);
  change(next);
  return patchesBetween(p, next);
}
test("two windows merge independent fields, stable layer IDs survive reordering", () => {
  const p = project();
  const thickness = edits(p, (p) => {
    p.layers[0].thickness_nm = 105;
  });
  const angle = edits(p, (p) => {
    p.settings.angle_deg = 30;
  });
  const reordered = structuredClone(p);
  reordered.layers.reverse();
  const result = applyPatches(applyPatches(reordered, angle), thickness);
  assert.equal(result.layers[1].id, "a");
  assert.equal(result.layers[1].thickness_nm, 105);
  assert.equal(result.settings.angle_deg, 30);
  assert.equal(p.layers[0].thickness_nm, 100);
});
test("conflicting batch rejects atomically and deleted layers never change a different row", () => {
  const p = project();
  const batch = edits(p, (p) => {
    p.name = "Renamed";
    p.layers[0].thickness_nm = 105;
  });
  const changed = applyPatches(
    p,
    edits(p, (p) => {
      p.layers[0].thickness_nm = 110;
    }),
  );
  assert.throws(() => applyPatches(changed, batch), /已被其他操作/);
  assert.equal(changed.name, "Test");
  changed.layers.shift();
  assert.throws(() => applyPatches(changed, batch), /已删除/);
});
test("rapid edits from same owner accept queued drafts, another owner still conflicts", () => {
  const p = project();
  const first = edits(p, (p) => {
    p.layers[0].thickness_nm = 101;
  });
  const second = edits(p, (p) => {
    p.layers[0].thickness_nm = 105;
  });
  const changed = applyPatches(p, first);
  const key = patchKey(first[0]);
  assert.equal(
    applyPatches(changed, second, (p) => patchKey(p) === key).layers[0]
      .thickness_nm,
    105,
  );
  assert.throws(() => applyPatches(changed, second), /已被其他操作/);
});
test("transport key order is irrelevant, named substrate changes synchronize boundaries", () => {
  const p = project();
  const patches = edits(p, (p) => {
    p.materials[1].n = 1.7;
  });
  const transport = JSON.parse(JSON.stringify(p), (_k, v) =>
    v && !Array.isArray(v) && typeof v === "object"
      ? Object.fromEntries(Object.entries(v).reverse())
      : v,
  );
  const result = applyPatches(transport, patches);
  assert.equal(result.settings.substrate_n, 1.7);
  assert.equal(result.layers[0].thickness_nm, 100);
});
test("nonfinite thickness, negative extinction and structural patch proposals reject", () => {
  const p = project();
  for (const value of [NaN, Infinity, -1])
    assert.throws(() =>
      applyPatches(
        p,
        edits(p, (p) => {
          p.layers[0].thickness_nm = value;
        }),
      ),
    );
  assert.throws(() =>
    applyPatches(
      p,
      edits(p, (p) => {
        p.materials[0].k = -0.1;
      }),
    ),
  );
  assert.throws(() =>
    applyPatches(
      p,
      edits(p, (p) => {
        p.analysis_bands = { passband: { start_nm: NaN, end_nm: 700 } };
      }),
    ),
  );
  assert.throws(
    () =>
      edits(p, (p) => {
        p.layers.reverse();
      }),
    /膜层命令/,
  );
});
const tick = () => new Promise<void>((resolve) => setImmediate(resolve));
function harness(live = false) {
  const previews: Project[] = [];
  const calls: {
    p: Project;
    resolve: (s: Spectrum) => void;
    reject: (e: unknown) => void;
  }[] = [];
  const results: Project[] = [],
    errors: unknown[] = [],
    activity: boolean[] = [];
  const queue = new CalculationQueue(
    (p) => new Promise((resolve, reject) => calls.push({ p, resolve, reject })),
    (_s, p) => results.push(p),
    (e) => errors.push(e),
    (v) => activity.push(v),
    live
      ? (_s, p) => {
          previews.push(p);
        }
      : undefined,
  );
  return { queue, calls, results, errors, activity, previews };
}
test("continuous edits coalesce to newest request, never compute concurrently or publish old result", async () => {
  const h = harness();
  const p = project();
  h.queue.submit(p);
  p.layers[0].thickness_nm = 101;
  h.queue.submit(p);
  p.layers[0].thickness_nm = 105;
  h.queue.submit(p);
  assert.equal(h.calls.length, 1);
  assert.equal(h.calls[0].p.layers[0].thickness_nm, 100);
  h.calls[0].resolve({} as Spectrum);
  await tick();
  assert.equal(h.results.length, 0);
  assert.equal(h.calls.length, 2);
  assert.equal(h.calls[1].p.layers[0].thickness_nm, 105);
  h.calls[1].resolve({} as Spectrum);
  await tick();
  assert.equal(h.results.length, 1);
  assert.deepEqual(h.activity, [true, false]);
});
test("project switching invalidates result and errors, auto dedups and manual calculation retries", async () => {
  const h = harness(),
    p = project();
  h.queue.submit(p);
  h.queue.submit(p);
  h.queue.invalidate();
  h.calls[0].reject(new Error("obsolete"));
  await tick();
  assert.equal(h.errors.length, 0);
  assert.equal(h.results.length, 0);
  h.queue.submit(p);
  h.calls[1].resolve({} as Spectrum);
  await tick();
  h.queue.submit(p);
  assert.equal(h.calls.length, 2);
  h.queue.submit(p, true);
  h.calls[2].reject(new Error("current"));
  await tick();
  assert.equal(h.errors.length, 1);
});

test("queued material metadata and band edits preserve earlier edits from the same window", () => {
  const p = project();
  const n = edits(p, (p) => {
    p.materials[2].n = 2.2;
  });
  const source = edits(p, (p) => {
    p.materials[2].source = "new provenance";
  });
  const result = applyPatches(applyPatches(p, n), source, () => true);
  assert.equal(result.materials[2].n, 2.2);
  assert.equal(result.materials[2].source, "new provenance");
  p.analysis_bands = { passband: { start_nm: 400, end_nm: 700 } };
  const start = edits(p, (p) => {
    p.analysis_bands!.passband!.start_nm = 450;
  });
  const end = edits(p, (p) => {
    p.analysis_bands!.passband!.end_nm = 650;
  });
  assert.deepEqual(
    applyPatches(applyPatches(p, start), end, () => true).analysis_bands,
    { passband: { start_nm: 450, end_nm: 650 } },
  );
});

test("back-side patches preserve the front face and conflict independently", () => {
  const p = project();
  p.back_layers = [
    { id: "rear", material: p.layers[0].material, thickness_nm: 80 },
  ];
  const next = structuredClone(p);
  next.back_layers![0].thickness_nm = 85;
  const changes = patchesBetween(p, next);
  assert.equal(changes[0].kind, "layer");
  const result = applyPatches(p, changes);
  assert.equal(result.back_layers![0].thickness_nm, 85);
  assert.deepEqual(result.layers, p.layers);
  assert.throws(() => applyPatches(result, changes), /已被其他操作/);
});
test("new environment settings and full response data travel through shared patches", () => {
  const p = project(),
    next = structuredClone(p);
  next.settings.substrate_model = "incoherent";
  next.settings.exit_material = p.settings.incident_material;
  next.settings.substrate_thickness_mm = 1;
  next.response_data = {
    illuminants: [
      {
        name: "Lamp",
        samples: [
          [400, 50],
          [700, 100],
        ],
      },
    ],
  };
  next.settings.illuminant = "Lamp";
  const result = applyPatches(p, patchesBetween(p, next));
  assert.equal(result.settings.substrate_model, "incoherent");
  assert.deepEqual(result.response_data, next.response_data);
});

test("live tuning previews completed frames while retaining only the latest final result", async () => {
  const h = harness(true),
    p = project();
  h.queue.submit(p);
  const next = structuredClone(p);
  next.layers[0].thickness_nm = 120;
  h.queue.submit(next);
  h.calls[0].resolve({} as Spectrum);
  await tick();
  assert.equal(h.previews.length, 1);
  assert.equal(h.results.length, 0);
  assert.equal(h.previews[0].layers[0].thickness_nm, 100);
  h.calls[1].resolve({} as Spectrum);
  await tick();
  assert.equal(h.results[0].layers[0].thickness_nm, 120);
  assert.equal(h.previews.length, 1);
  assert.deepEqual(h.activity, [true, false]);
});
test("invalidated requests and another project's frames cannot become live previews", async () => {
  const h = harness(true),
    p = project();
  h.queue.submit(p);
  h.queue.invalidate();
  h.calls[0].resolve({} as Spectrum);
  await tick();
  assert.equal(h.previews.length, 0);
  h.queue.submit(p);
  const other = structuredClone(p);
  other.id = "other";
  h.queue.submit(other);
  h.calls[1].resolve({} as Spectrum);
  await tick();
  assert.equal(h.previews.length, 0);
  h.calls[2].resolve({} as Spectrum);
  await tick();
  assert.equal(h.results[0].id, "other");
});

test("scope reset rejects a previous workspace frame even when project IDs match", async () => {
  const h = harness(true),
    p = project();
  h.queue.submit(p);
  h.queue.reset();
  const moved = structuredClone(p);
  moved.layers[0].thickness_nm = 140;
  h.queue.submit(moved);
  h.calls[0].resolve({} as Spectrum);
  await tick();
  assert.equal(h.previews.length, 0);
  assert.equal(h.results.length, 0);
  h.calls[1].resolve({} as Spectrum);
  await tick();
  assert.equal(h.results[0].layers[0].thickness_nm, 140);
});
