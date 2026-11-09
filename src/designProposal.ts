import type { Project } from "./types.ts";
import { projectKey } from "./projectStatus.ts";
import { applyPatches, patchesBetween } from "./tools/state.ts";
// Both prototype tools may change thickness only. Never trust a returned project.
export function applyDesignProposal(
  current: Project,
  expected: Project,
  proposal: Project,
): Project {
  if (projectKey(current) !== projectKey(expected))
    throw new Error("项目已变化，请重新运行分析后再应用");
  const patches = patchesBetween(expected, proposal);
  if (!patches.length) throw new Error("候选没有膜厚修改");
  if (patches.some((p) => p.kind !== "layer" || p.field !== "thickness_nm"))
    throw new Error("候选只允许修改现有膜层的物理厚度");
  // Detect changes in fields not represented by the patch protocol as well.
  const next = applyPatches(expected, patches);
  if (projectKey(next) !== projectKey(proposal))
    throw new Error("候选包含不支持的项目修改");
  return next;
}
