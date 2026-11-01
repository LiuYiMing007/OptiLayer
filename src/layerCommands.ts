import type { Project } from "./types.ts";
export type LayerCommand =
  "layer.add" | "layer.copy" | "layer.delete" | "layer.up" | "layer.down";
// A single mutation implementation for toolbar buttons, menus and shortcuts.
export function changeLayer(
  p: Project,
  selected: number,
  command: LayerCommand,
  newId: () => string,
): number {
  if (command === "layer.add") {
    if (p.layers.length >= 500) return selected;
    const material =
      p.materials.find((m) => m.role === "film" || m.role === "all") ||
      p.materials[0];
    p.layers.push({ id: newId(), material: material.name, thickness_nm: 60 });
    return p.layers.length - 1;
  }
  if (!p.layers[selected]) return selected;
  if (command === "layer.copy") {
    if (p.layers.length >= 500) return selected;
    p.layers.splice(selected + 1, 0, { ...p.layers[selected], id: newId() });
    return selected + 1;
  }
  if (command === "layer.delete") {
    p.layers.splice(selected, 1);
    return Math.max(0, selected - 1);
  }
  const target = selected + (command === "layer.up" ? 1 : -1);
  if (target < 0 || target >= p.layers.length) return selected;
  [p.layers[selected], p.layers[target]] = [
    p.layers[target],
    p.layers[selected],
  ];
  return target;
}
