import definitions from "./menus.json" with { type: "json" };
import internal from "./internalCommands.json" with { type: "json" };

export interface MenuEntry {
  id?: string;
  label?: string;
  shortcut?: string;
  macShortcut?: string;
  separator?: boolean;
  implemented?: boolean;
  check?: boolean;
  platform?: string;
}
export interface MenuGroup {
  title: string;
  items: MenuEntry[];
}
export const menus: MenuGroup[] = definitions;
export const menuEntries = menus
  .flatMap((group) => group.items)
  .filter((item) => item.id);
export const entries: MenuEntry[] = [...menuEntries, ...internal];
// macOS registers visible accelerators natively; hidden toolbar shortcuts use the renderer.
export function nativeOwnsShortcut(id: string | undefined): boolean {
  return id === "file.quit" || menuEntries.some((item) => item.id === id);
}
export type CommandState = { enabled: boolean; checked?: boolean };
export interface MenuContext {
  projectOpen?: boolean;
  busy: boolean;
  blocked: boolean;
  workspace: boolean;
  canUndo: boolean;
  canRedo: boolean;
  hasLayer: boolean;
  canAdd: boolean;
  canMoveUp: boolean;
  canMoveDown: boolean;
  validSpectrum: boolean;
  panels: Record<string, boolean>;
}
export function commandStates(c: MenuContext): Record<string, CommandState> {
  const available = !c.busy && !c.blocked;
  return Object.fromEntries(
    entries.map((item) => {
      let enabled = !!item.implemented && available;
      if (c.projectOpen === false)
        enabled &&=
          [
            "file.new",
            "file.open",
            "file.import",
            "file.quit",
            "file.workspace",
            "tools.workspace",
            "view.windowconfig",
            "view.menu",
          ].includes(item.id!) || item.id!.startsWith("help.");
      if (["file.save"].includes(item.id!)) enabled &&= c.workspace;
      if (item.id === "edit.undo") enabled &&= c.canUndo;
      if (item.id === "edit.redo") enabled &&= c.canRedo;
      if (["layer.copy", "layer.delete", "layer.material"].includes(item.id!))
        enabled &&= c.hasLayer;
      if (["layer.add", "layer.copy"].includes(item.id!)) enabled &&= c.canAdd;
      if (item.id === "layer.up") enabled &&= c.canMoveUp;
      if (item.id === "layer.down") enabled &&= c.canMoveDown;
      if (item.id === "file.exportSpectrum") enabled &&= c.validSpectrum;
      return [
        item.id!,
        {
          enabled,
          ...(item.check ? { checked: c.panels[item.id!.slice(5)] } : {}),
        },
      ];
    }),
  );
}
// Native menus own macOS accelerators. Browser/Windows main-window shortcuts
// use this same configuration, with no global OS keyboard hook.
export function shortcutCommand(
  e: Pick<KeyboardEvent, "key" | "metaKey" | "ctrlKey" | "altKey" | "shiftKey">,
  mac: boolean,
  editing: boolean,
) {
  if (!(mac ? e.metaKey : e.ctrlKey) || (mac ? e.ctrlKey : e.metaKey)) return;
  if (
    editing &&
    !e.altKey &&
    ["z", "c", "x", "v", "a"].includes(e.key.toLowerCase())
  )
    return;
  return entries.find((item) => {
    const shortcut = mac ? item.macShortcut || item.shortcut : item.shortcut;
    return (
      item.implemented &&
      shortcut &&
      shortcut.endsWith(
        "+" + (e.key === "Enter" ? "Enter" : e.key.toUpperCase()),
      ) &&
      shortcut.includes("+Shift+") === e.shiftKey &&
      shortcut.includes("+Alt+") === e.altKey
    );
  })?.id;
}
