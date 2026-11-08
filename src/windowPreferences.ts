import definitions from "./tools/windows.json" with { type: "json" };
export interface WindowPreferences {
  openWindows: string[];
  rememberGeometry: boolean;
}
export const defaultWindowPreferences: WindowPreferences = {
  openWindows: ["spectrum", "layers"],
  rememberGeometry: false,
};
export const openingWindows = [
  { id: "spectrum", title: "光谱窗口" },
  ...definitions.filter(
    (d) =>
      !["settings", "environment", "windowconfig", "materialdata"].includes(
        d.id,
      ),
  ),
];
export function normalizeWindowPreferences(value: unknown): WindowPreferences {
  if (!value || typeof value !== "object")
    return structuredClone(defaultWindowPreferences);
  const v = value as Partial<WindowPreferences>;
  const valid = new Set(openingWindows.map((w) => w.id));
  return {
    openWindows: Array.isArray(v.openWindows)
      ? [
          ...new Set(
            v.openWindows.filter(
              (id): id is string => typeof id === "string" && valid.has(id),
            ),
          ),
        ]
      : [...defaultWindowPreferences.openWindows],
    rememberGeometry: v.rememberGeometry === true,
  };
}
