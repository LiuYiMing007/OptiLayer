import type { WindowPreferences } from "../windowPreferences.ts";
import type { InteractiveTarget } from "../interactiveModel.ts";
import type {
  Material,
  Project,
  SavedProject,
  Spectrum,
  WorkspaceInfo,
} from "../types.ts";
import { synchronizeBoundaries } from "../model.ts";
import definitions from "./windows.json" with { type: "json" };
export const toolDefinitions = definitions;
export type ToolId =
  | "layers"
  | "materials"
  | "substrate"
  | "settings"
  | "project"
  | "analysis"
  | "targets"
  | "interactive"
  | "materialdata"
  | "rear"
  | "environment"
  | "illuminant"
  | "detector"
  | "groups"
  | "stack"
  | "windowconfig"
  | "distribution";
export interface ToolSnapshot {
  windowPreferences?: WindowPreferences;
  environmentPending?: boolean;
  inspectedMaterial?: { name: string; substrate: boolean; draft?: Material };
  focus?: { id: string; label: string; token: string };
  sequence: number;
  scope: string;
  project: Project;
  selected: number;
  layerSide?: "front" | "back";
  busy: boolean;
  calculating: boolean;
  dirty: boolean;
  persisted?: boolean;
  canUndo: boolean;
  canRedo: boolean;
  workspace: WorkspaceInfo | null;
  projects: SavedProject[];
  library: Material[];
  spectrum?: Spectrum | null;
  stale: boolean;
  error: string;
  notice: string;
}
export type Patch =
  | {
      kind: "layer";
      side?: "front" | "back";
      id: string;
      field: "material" | "thickness_nm" | "group";
      expected: unknown;
      value: unknown;
    }
  | {
      kind: "material";
      name: string;
      expected: Material | null;
      value: Material;
    }
  | {
      kind: "setting";
      field: keyof Project["settings"];
      expected: unknown;
      value: unknown;
    }
  | {
      kind: "property";
      field:
        | "name"
        | "analysis_bands"
        | "target_points"
        | "response_data"
        | "group_factors";
      expected: unknown;
      value: unknown;
    };
export type ToolAction = { scope: string; requestId: string } & (
  | { kind: "material-new"; substrate: boolean }
  | {
      kind: "material-delete";
      name: string;
      expected: Material;
      target: "project" | "library";
    }
  | { kind: "material-restore"; name: string }
  | { kind: "material-inspect"; name: string; substrate: boolean }
  | { kind: "patch"; patches: Patch[] }
  | {
      kind: "interactive";
      session: string;
      phase: "preview" | "finish" | "undo";
      target: InteractiveTarget;
      value: number;
    }
  | { kind: "command"; id: string }
  | { kind: "window-preferences"; preferences: WindowPreferences }
  | { kind: "environment-complete" }
  | {
      kind: "stack-apply";
      side: "front" | "back";
      expected: Project["layers"];
      layers: Project["layers"];
    }
  | { kind: "select"; layerId: string; side?: "front" | "back" }
  | { kind: "layer-side"; side: "front" | "back" }
  | {
      kind: "layer";
      side?: "front" | "back";
      command:
        "layer.add" | "layer.copy" | "layer.delete" | "layer.up" | "layer.down";
      layerId?: string;
    }
  | { kind: "open-project"; id: string }
  | { kind: "library-save" | "library-refresh" | "projects-refresh" }
  | { kind: "save-copy"; name: string }
  | { kind: "catalogue-import"; name: string; substrate?: boolean }
  | {
      kind: "material-save";
      material: Material;
      replaces: string;
      expected: Material | null;
      substrate?: boolean;
    }
  | {
      kind: "material-editing";
      active: boolean;
      tool: "materials" | "substrate";
    }
  | { kind: "materials-folder" }
  | { kind: "analyze" }
  | { kind: "export"; name: string; content: string; type?: string }
);
const canonical = (v: unknown): unknown =>
  Array.isArray(v)
    ? v.map(canonical)
    : v && typeof v === "object"
      ? Object.fromEntries(
          Object.entries(v)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([k, value]) => [k, canonical(value)]),
        )
      : v;
const equal = (a: unknown, b: unknown) =>
  JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
// Apply only the fields actually edited in a queued object proposal. A rapid
// edit of material.source must not restore the old n included in its snapshot.
function mergeIntent(
  actual: unknown,
  expected: unknown,
  value: unknown,
): unknown {
  if (
    value &&
    expected &&
    actual &&
    typeof value === "object" &&
    typeof expected === "object" &&
    typeof actual === "object" &&
    !Array.isArray(value) &&
    !Array.isArray(expected) &&
    !Array.isArray(actual)
  ) {
    const result = structuredClone(actual) as Record<string, unknown>;
    const previous = expected as Record<string, unknown>,
      next = value as Record<string, unknown>;
    for (const key of new Set([
      ...Object.keys(previous),
      ...Object.keys(next),
    ])) {
      if (equal(previous[key], next[key])) continue;
      if (!(key in next)) delete result[key];
      else result[key] = mergeIntent(result[key], previous[key], next[key]);
    }
    return result;
  }
  return structuredClone(value);
}
export const patchKey = (p: Patch) =>
  p.kind === "layer"
    ? `layer:${p.side || "front"}:${p.id}:${p.field}`
    : p.kind === "material"
      ? `material:${p.name}`
      : `${p.kind}:${p.field}`;
export function patchesBetween(before: Project, after: Project): Patch[] {
  const patches: Patch[] = [];
  for (const side of ["front", "back"] as const) {
    const previousLayers =
      side === "front" ? before.layers : before.back_layers || [];
    const nextLayers =
      side === "front" ? after.layers : after.back_layers || [];
    if (
      !equal(
        previousLayers.map((l) => l.id),
        nextLayers.map((l) => l.id),
      )
    )
      throw new Error("膜层增删排序请使用膜层命令");
    for (const layer of nextLayers) {
      const previous = previousLayers.find((l) => l.id === layer.id)!;
      for (const field of ["material", "thickness_nm", "group"] as const)
        if (!equal(previous[field], layer[field]))
          patches.push({
            kind: "layer",
            ...(side === "back" ? { side } : {}),
            id: layer.id,
            field,
            expected: previous[field],
            value: layer[field],
          });
    }
  }
  for (const material of after.materials) {
    const previous = before.materials.find((m) => m.name === material.name);
    if (!equal(previous, material))
      patches.push({
        kind: "material",
        name: material.name,
        expected: previous || null,
        value: material,
      });
  }
  for (const field of Object.keys(
    after.settings,
  ) as (keyof Project["settings"])[])
    if (!equal(before.settings[field], after.settings[field]))
      patches.push({
        kind: "setting",
        field,
        expected: before.settings[field],
        value: after.settings[field],
      });
  for (const field of [
    "name",
    "analysis_bands",
    "target_points",
    "response_data",
    "group_factors",
  ] as const)
    if (!equal(before[field], after[field]))
      patches.push({
        kind: "property",
        field,
        expected: before[field] ?? null,
        value: after[field] ?? null,
      });
  return patches;
}
export function hasNonFinite(value: unknown): boolean {
  if (typeof value === "number") return !Number.isFinite(value);
  if (value && typeof value === "object")
    return Object.values(value).some(hasNonFinite);
  return false;
}
export function applyPatches(
  project: Project,
  patches: Patch[],
  owned: (patch: Patch) => boolean = () => false,
): Project {
  if (!patches.length || patches.length > 2000)
    throw new Error("编辑命令为空或过大");
  if (patches.some((p) => hasNonFinite(p.value)))
    throw new Error("编辑值必须是有效数值");
  const allowedSettings = new Set([
    ...Object.keys(project.settings),
    "substrate_model",
    "substrate_thickness_mm",
    "exit_material",
    "first_surface",
    "illuminant",
    "detector",
  ]);
  // Check every precondition against the original state before changing anything.
  for (const patch of patches) {
    let actual: unknown;
    if (patch.kind === "layer") {
      if (!["material", "thickness_nm", "group"].includes(patch.field))
        throw new Error("膜层字段无效");
      const layer = (
        patch.side === "back" ? project.back_layers || [] : project.layers
      ).find((l) => l.id === patch.id);
      if (!layer) throw new Error("该膜层已删除，请使用最新内容");
      if (
        patch.field === "group" &&
        (!Number.isInteger(patch.value) ||
          Number(patch.value) < 0 ||
          Number(patch.value) > 999)
      )
        throw new Error("组号须为 0–999 的整数");
      actual = layer[patch.field];
      if (
        patch.field === "thickness_nm" &&
        (typeof patch.value !== "number" ||
          !Number.isFinite(patch.value) ||
          patch.value < 0)
      )
        throw new Error("厚度必须是有效非负数");
      if (
        patch.field === "material" &&
        !project.materials.some((m) => m.name === patch.value)
      )
        throw new Error("材料不存在");
    } else if (patch.kind === "material") {
      actual = project.materials.find((m) => m.name === patch.name) || null;
      if (
        patch.name !== patch.value.name ||
        !Number.isFinite(patch.value.n) ||
        patch.value.n <= 0 ||
        patch.value.n > 20 ||
        !Number.isFinite(patch.value.k) ||
        patch.value.k < 0 ||
        patch.value.catalogue_summary ||
        patch.value.status === "quarantined"
      )
        throw new Error("材料需要有效 n/k 和完整、可用的光学数据");
    } else if (patch.kind === "setting") {
      if (!allowedSettings.has(patch.field)) throw new Error("计算参数无效");
      actual = project.settings[patch.field];
      if (
        typeof actual === "number" &&
        (typeof patch.value !== "number" || !Number.isFinite(patch.value))
      )
        throw new Error("计算参数必须是有效数值");
    } else if (
      patch.kind === "property" &&
      [
        "name",
        "analysis_bands",
        "target_points",
        "response_data",
        "group_factors",
      ].includes(patch.field)
    )
      actual = project[patch.field] ?? null;
    else throw new Error("不支持的编辑命令");
    if (!equal(actual, patch.expected) && !owned(patch))
      throw new Error("该字段已被其他操作更新，本次未覆盖，请重新编辑");
  }
  const next = structuredClone(project);
  for (const patch of patches) {
    if (patch.kind === "layer")
      Object.assign(
        (patch.side === "back" ? next.back_layers || [] : next.layers).find(
          (l) => l.id === patch.id,
        )!,
        { [patch.field]: patch.value },
      );
    else if (patch.kind === "material") {
      const index = next.materials.findIndex((m) => m.name === patch.name);
      if (index < 0) next.materials.push(structuredClone(patch.value));
      else
        next.materials[index] = mergeIntent(
          next.materials[index],
          patch.expected,
          patch.value,
        ) as Material;
    } else if (patch.kind === "setting")
      Object.assign(next.settings, { [patch.field]: patch.value });
    else if (patch.value === null) delete next[patch.field];
    else
      Object.assign(next, {
        [patch.field]: mergeIntent(
          next[patch.field],
          patch.expected,
          patch.value,
        ),
      });
  }
  synchronizeBoundaries(next);
  return next;
}
