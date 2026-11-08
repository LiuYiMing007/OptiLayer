import type { Material } from "./types.ts";
// Legacy labels describe provenance, not a separate user library. Keep records in the unified list.
export function materialCollection(
  material: Pick<Material, "collection">,
): string {
  const name = material.collection?.trim() || "";
  return /^自定义(?:材料|基底)?$/.test(name) ? "" : name;
}
