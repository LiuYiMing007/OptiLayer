import type { Project } from "./types.ts";
function ordered(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(ordered);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => [k, ordered(v)]),
    );
  return value;
}
export const dataKey = (value: unknown) => JSON.stringify(ordered(value));
export const projectKey = (p: Project) => dataKey(p);
export const hasUnsavedChanges = (p: Project, baseline: string) =>
  projectKey(p) !== baseline;
