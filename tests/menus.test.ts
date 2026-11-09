import test from "node:test";
import assert from "node:assert/strict";
import {
  menus,
  entries,
  menuEntries,
  nativeOwnsShortcut,
  commandStates,
  shortcutCommand,
  type MenuContext,
} from "../src/menus/commands.ts";
import { changeLayer } from "../src/layerCommands.ts";
import type { Project } from "../src/types.ts";

const context = (): MenuContext => ({
  busy: false,
  blocked: false,
  workspace: true,
  canUndo: true,
  canRedo: false,
  hasLayer: true,
  canAdd: true,
  canMoveUp: true,
  canMoveDown: false,
  validSpectrum: true,
  panels: { sidebar: true, layers: true, settings: false, spectrum: true },
});
test("compact menu catalogue has six categories while toolbar commands remain available", () => {
  assert.deepEqual(
    menus.map((m) => m.title),
    ["文件", "编辑", "参数", "分析", "结果", "帮助"],
  );
  assert.deepEqual(
    menus[0].items.map((e) => e.id),
    [
      "file.new",
      "file.open",
      "file.recent",
      "file.close",
      "file.save",
      "file.saveAs",
      "file.exportSpectrum",
      undefined,
      "view.windowconfig",
    ],
  );
  assert.deepEqual(
    menus[1].items.map((e) => e.id),
    ["edit.undo", "edit.redo"],
  );
  assert.deepEqual(
    menus[2].items.map((e) => (e.separator ? "separator" : e.label)),
    [
      "环境",
      "膜堆表达式",
      "前表面膜层",
      "后表面膜层",
      "组",
      "separator",
      "材料",
      "基底",
      "光源",
      "探测器",
      "分布",
    ],
  );
  assert.deepEqual(
    menus[3].items.map((e) => e.id),
    [
      "calculate.spectrum",
      "analysis.interactive",
      "analysis.details",
      "analysis.optimization",
      "analysis.agent",
      undefined,
      "view.targets",
    ],
  );
  assert.equal(
    menuEntries.some((e) => e.id === "layer.add"),
    false,
  );
  assert.equal(
    entries.some((e) => e.id === "layer.add"),
    true,
  );
  assert.equal(new Set(entries.map((e) => e.id)).size, entries.length);
  for (const platform of ["windows", "macos"]) {
    const keys = entries
      .map((e) =>
        platform === "macos" ? e.macShortcut || e.shortcut : e.shortcut,
      )
      .filter(Boolean);
    assert.equal(new Set(keys).size, keys.length);
  }
});
test("busy and modal guards disable all commands, including quit and project replacement", () => {
  for (const guard of [{ busy: true }, { blocked: true }]) {
    assert.ok(
      Object.values(commandStates({ ...context(), ...guard })).every(
        (s) => !s.enabled,
      ),
    );
  }
});
test("selection, stale spectra, workspace failures and layer limit gate actual destructive commands", () => {
  const state = commandStates({
    ...context(),
    workspace: false,
    hasLayer: false,
    canAdd: false,
    canMoveUp: false,
    validSpectrum: false,
  });
  for (const id of [
    "file.save",
    "layer.copy",
    "layer.delete",
    "layer.material",
    "layer.add",
    "layer.up",
    "file.exportSpectrum",
    "edit.redo",
  ])
    assert.equal(state[id].enabled, false, id);
  assert.equal(state["file.open"].enabled, true);
  assert.equal(state["file.workspace"].enabled, true);
  assert.equal(state["calculate.spectrum"].enabled, true);
  assert.equal(state["view.settings"].checked, false);
});
const key = (name: string, overrides = {}) => ({
  key: name,
  ctrlKey: true,
  metaKey: false,
  shiftKey: false,
  altKey: false,
  ...overrides,
});
test("shortcuts preserve native text editing and match Windows, macOS and shift modifiers", () => {
  assert.equal(shortcutCommand(key("s"), false, true), "file.save");
  assert.equal(shortcutCommand(key("z"), false, true), undefined);
  assert.equal(shortcutCommand(key("z"), false, false), "edit.undo");
  assert.equal(
    shortcutCommand(key("z", { shiftKey: true }), false, false),
    "edit.redo",
  );
  assert.equal(
    shortcutCommand(key("z", { ctrlKey: false, metaKey: true }), true, true),
    undefined,
  );
  assert.equal(
    shortcutCommand(
      key("z", { ctrlKey: false, metaKey: true, altKey: true }),
      true,
      true,
    ),
    "edit.undo",
  );
  assert.equal(
    shortcutCommand(key("Enter"), false, false),
    "calculate.spectrum",
  );
  assert.equal(
    shortcutCommand(key("s", { altKey: true }), false, false),
    undefined,
  );
});
test("menu and toolbar layer operations preserve optical inputs, order and fresh IDs", () => {
  const p = {
    materials: [{ name: "film", role: "film" }],
    layers: [
      { id: "a", material: "film", thickness_nm: 72 },
      { id: "b", material: "film", thickness_nm: 50 },
    ],
  } as Project;
  assert.equal(
    changeLayer(p, 0, "layer.copy", () => "copy"),
    1,
  );
  assert.deepEqual(
    p.layers.map((l) => l.thickness_nm),
    [72, 72, 50],
  );
  assert.equal(p.layers[1].id, "copy");
  assert.equal(
    changeLayer(p, 1, "layer.up", () => ""),
    2,
  );
  assert.deepEqual(
    p.layers.map((l) => l.id),
    ["a", "b", "copy"],
  );
  assert.equal(
    changeLayer(p, 2, "layer.up", () => ""),
    2,
  );
  assert.equal(
    changeLayer(p, 2, "layer.delete", () => ""),
    1,
  );
  assert.equal(
    changeLayer(p, 1, "layer.add", () => "new"),
    2,
  );
  assert.equal(p.layers[2].material, "film");
  assert.equal(p.layers[2].thickness_nm, 60);
});

test("native and renderer shortcuts have one owner after menu simplification", () => {
  assert.equal(nativeOwnsShortcut("file.open"), true);
  assert.equal(nativeOwnsShortcut("file.quit"), true);
  assert.equal(nativeOwnsShortcut("layer.add"), false);
  assert.equal(nativeOwnsShortcut("layer.copy"), false);
  assert.equal(nativeOwnsShortcut(undefined), false);
});

test("menu-only startup exposes new/open and configuration without a phantom project", () => {
  const states = commandStates({ ...context(), projectOpen: false });
  for (const id of ["file.new", "file.open", "view.windowconfig", "help.about"])
    assert.equal(states[id].enabled, true, id);
  for (const id of [
    "file.save",
    "file.saveAs",
    "file.exportSpectrum",
    "view.layers",
    "view.spectrum",
    "calculate.spectrum",
    "view.environment",
  ])
    assert.equal(states[id].enabled, false, id);
});
