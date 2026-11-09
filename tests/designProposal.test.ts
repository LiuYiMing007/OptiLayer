import test from "node:test";
import assert from "node:assert/strict";
import { referenceProject } from "../src/defaults.ts";
import { applyDesignProposal } from "../src/designProposal.ts";
import {
  commandStates,
  menus,
  type MenuContext,
} from "../src/menus/commands.ts";
import { toolDefinitions } from "../src/tools/state.ts";
test("design proposals reject stale input across fields and apply thickness atomically", () => {
  const p = referenceProject(),
    next = structuredClone(p);
  next.layers[0].thickness_nm = 70;
  assert.equal(applyDesignProposal(p, p, next).layers[0].thickness_nm, 70);
  assert.notEqual(p.layers[0].thickness_nm, 70);
  const changed = structuredClone(p);
  changed.settings.angle_deg = 20;
  assert.throws(() => applyDesignProposal(changed, p, next), /项目已变化/);
  const renamed = structuredClone(p);
  renamed.name = "new";
  assert.throws(() => applyDesignProposal(renamed, p, next), /项目已变化/);
});
test("design proposals cannot smuggle material, structure, metadata or invalid thickness changes", () => {
  const p = referenceProject();
  const mutations = [
    (q: typeof p) => q.layers.reverse(),
    (q: typeof p) => {
      q.materials[0].n = 3;
    },
    (q: typeof p) => {
      q.layers[0].thickness_nm = NaN;
    },
    (q: typeof p) => {
      q.layers[0].thickness_nm = -1;
    },
    (q: typeof p) => {
      q.id = "other";
    },
    (q: typeof p) => {
      q.settings.angle_deg = 20;
    },
    (q: typeof p) => {
      q.materials.pop();
    },
  ];
  for (const mutate of mutations) {
    const next = structuredClone(p);
    next.layers[0].thickness_nm = 70;
    mutate(next);
    assert.throws(() => applyDesignProposal(p, p, next));
  }
  assert.throws(() => applyDesignProposal(p, p, p), /没有膜厚修改/);
});
test("both new tools live only in Analysis and are disabled without a project", () => {
  for (const id of ["optimization", "agent"]) {
    assert.ok(toolDefinitions.some((t) => t.id === id));
    assert.ok(
      menus
        .find((g) => g.title === "分析")!
        .items.some((e) => e.id === `analysis.${id}`),
    );
    assert.equal(
      commandStates({
        projectOpen: false,
        busy: false,
        blocked: false,
        panels: {},
      } as MenuContext)[`analysis.${id}`].enabled,
      false,
    );
  }
});
