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
  | "targets";
export interface ToolSnapshot {
  focus?: { id: string; label: string; token: string };
  sequence: number;
  scope: string;
  project: Project;
  selected: number;
  busy: boolean;
  calculating: boolean;
  dirty: boolean;
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
      id: string;
      field: "material" | "thickness_nm";
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
      field: "name" | "analysis_bands" | "target_points";
      expected: unknown;
      value: unknown;
    };
export type ToolAction = { scope: string; requestId: string } & (
  | { kind: "patch"; patches: Patch[] }
  | { kind: "command"; id: string }
  | { kind: "select"; layerId: string }
  | {
      kind: "layer";
      command:
        "layer.add" | "layer.copy" | "layer.delete" | "layer.up" | "layer.down";
      layerId?: string;
    }
  | { kind: "open-project"; id: string }
  | { kind: "library-save" | "library-refresh" | "projects-refresh" }
  | { kind: "save-copy"; name: string }
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
export const patchKey = (p: Patch) =>
  p.kind === "layer"
    ? `layer:${p.id}:${p.field}`
    : p.kind === "material"
      ? `material:${p.name}`
      : `${p.kind}:${p.field}`;
export function patchesBetween(before: Project, after: Project): Patch[] {
  const patches: Patch[] = [];
  if (
    !equal(
      before.layers.map((l) => l.id),
      after.layers.map((l) => l.id),
    )
  )
    throw new Error("膜层增删排序请使用膜层命令");
  for (const layer of after.layers) {
    const previous = before.layers.find((l) => l.id === layer.id)!;
    for (const field of ["material", "thickness_nm"] as const)
      if (!equal(previous[field], layer[field]))
        patches.push({
          kind: "layer",
          id: layer.id,
          field,
          expected: previous[field],
          value: layer[field],
        });
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
  for (const field of ["name", "analysis_bands", "target_points"] as const)
    if (!equal(before[field], after[field]))
      patches.push({
        kind: "property",
        field,
        expected: before[field] ?? null,
        value: after[field] ?? null,
      });
  return patches;
}
export function applyPatches(
  project: Project,
  patches: Patch[],
  owned: (patch: Patch) => boolean = () => false,
): Project {
  if (!patches.length || patches.length > 2000)
    throw new Error("编辑命令为空或过大");
  const allowedSettings = new Set(Object.keys(project.settings));
  // Check every precondition against the original state before changing anything.
  for (const patch of patches) {
    let actual: unknown;
    if (patch.kind === "layer") {
      if (!["material", "thickness_nm"].includes(patch.field))
        throw new Error("膜层字段无效");
      const layer = project.layers.find((l) => l.id === patch.id);
      if (!layer) throw new Error("该膜层已删除，请使用最新内容");
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
        patch.value.k !== 0
      )
        throw new Error("当前仅支持有效常数 n 和 k=0");
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
      ["name", "analysis_bands", "target_points"].includes(patch.field)
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
        next.layers.find((l) => l.id === patch.id)!,
        { [patch.field]: patch.value },
      );
    else if (patch.kind === "material") {
      const index = next.materials.findIndex((m) => m.name === patch.name);
      if (index < 0) next.materials.push(structuredClone(patch.value));
      else next.materials[index] = structuredClone(patch.value);
    } else if (patch.kind === "setting")
      Object.assign(next.settings, { [patch.field]: patch.value });
    else if (patch.value === null) delete next[patch.field];
    else Object.assign(next, { [patch.field]: patch.value });
  }
  synchronizeBoundaries(next);
  return next;
}
