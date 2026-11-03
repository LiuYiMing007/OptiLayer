import { flushSync } from "react-dom";
import { request } from "../api";
import type { Material } from "../types";
import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { referenceProject } from "../defaults";
import { useDesktopMenus } from "../menus/useDesktopMenus";
import { toolDefinitions, type ToolId, type ToolSnapshot } from "./state";
import { useToolHost } from "./useToolHost";
interface Status {
  details?: Record<
    string,
    { editor?: boolean; catalogue?: boolean; error?: string }
  >;
  ready: Record<string, string>;
  visible: Record<string, boolean>;
  menu: { project: string } | null;
}
// Only mounted after the host explicitly authorizes --window-ipc-self-test.
// Reuses production IPC hooks and child React windows, with pure catalogue reads; never mounts App or opens a Workspace.
export default function WindowIpcCheck() {
  const [library, setLibrary] = useState<Material[]>([]);
  const [project] = useState(referenceProject),
    [error, setError] = useState("");
  const sequence = useRef(0),
    started = useRef(false);
  const snapshot: ToolSnapshot = {
    sequence: ++sequence.current,
    scope: "isolated-window-ipc-check",
    project,
    selected: 0,
    busy: false,
    calculating: false,
    dirty: false,
    canUndo: false,
    canRedo: false,
    workspace: null,
    projects: [],
    library,
    spectrum: null,
    stale: false,
    error: "",
    notice: "",
  };
  const host = useToolHost(snapshot, async () => {}, setError);
  const commands = Object.fromEntries(
    toolDefinitions.map((d) => [
      `view.${d.id}`,
      { enabled: true, checked: !!host.visible[d.id] },
    ]),
  );
  const platform = useDesktopMenus(
    {
      project: project.name,
      workspace: "isolated check",
      dirty: false,
      busy: false,
      commands,
    },
    (id) => {
      const tool = id.slice(5) as ToolId;
      if (toolDefinitions.some((d) => d.id === tool))
        void host.show(tool).catch((e) => setError(String(e)));
    },
    setError,
  );
  const latest = useRef({ host, error });
  latest.current = { host, error };
  useEffect(() => {
    if (platform === "desktop" || started.current) return;
    started.current = true;
    const report: Record<string, unknown> = {
      all_pass: false,
      platform,
      main_button_ipc: [],
      menu_command_ipc: [],
      shared_project_rendered: false,
      close_hide_reopen: false,
      workspace_used: false,
      catalogue_without_workspace: false,
      material_and_substrate_editors: false,
    };
    async function until(predicate: (s: Status) => boolean) {
      const end = Date.now() + 12000;
      while (Date.now() < end) {
        if (latest.current.error) throw new Error(latest.current.error);
        const s = await invoke<Status>("window_check_status");
        for (const d of Object.values(s.details || {}))
          if (d.error) throw new Error(d.error);
        if (predicate(s)) return s;
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      throw new Error("frontend IPC/render acknowledgement timed out");
    }
    void (async () => {
      const catalogue = await request<{ materials: Material[] }>({
        action: "catalogue_list",
      });
      if (catalogue.materials.length !== 1211)
        throw new Error("内置材料目录缺失");
      const silver = catalogue.materials.find(
        (m) => m.name === "TFC/SOPRA/AG",
      )!;
      flushSync(() =>
        setLibrary([
          silver,
          ...catalogue.materials.filter((m) => m.name !== silver.name),
        ]),
      );
      report.catalogue_without_workspace = true;
      await until((s) => s.menu?.project === project.name);
      for (const d of toolDefinitions) {
        const id = d.id as ToolId;
        const button = document.querySelector<HTMLButtonElement>(
          `[data-check-open="${id}"]`,
        );
        if (!button) throw new Error(`open button missing: ${id}`);
        button.click();
        await until(
          (s) => s.visible[id] && s.ready[`tool-${id}`] === project.id,
        );
        (report.main_button_ipc as string[]).push(id);
        if (id === "materials" || id === "substrate")
          await until((s) => !!s.details?.[`tool-${id}`]?.editor);
        await latest.current.host.hide(id);
        await until((s) => !s.visible[id]);
        await invoke("window_check_dispatch", { id: `view.${id}` });
        await until(
          (s) => s.visible[id] && s.ready[`tool-${id}`] === project.id,
        );
        (report.menu_command_ipc as string[]).push(id);
      }
      // Exercise the native CloseRequested handler, not only the host's hide command.
      await invoke("window_check_close", { id: "layers" });
      await until((s) => !s.visible.layers && s.visible.settings);
      document
        .querySelector<HTMLButtonElement>('[data-check-open="layers"]')!
        .click();
      await until(
        (s) => s.visible.layers && s.ready["tool-layers"] === project.id,
      );
      report.material_and_substrate_editors = true;
      report.shared_project_rendered = true;
      report.close_hide_reopen = true;
      report.all_pass = true;
    })()
      .catch((e) => {
        report.error = String(e);
      })
      .finally(() => {
        void invoke("window_check_finish", { report });
      });
  }, [platform, project]);
  return (
    <main>
      <h1>Isolated frontend window IPC regression</h1>
      {toolDefinitions.map((d) => (
        <button
          key={d.id}
          data-check-open={d.id}
          onClick={() =>
            void host.show(d.id as ToolId).catch((e) => setError(String(e)))
          }
        >
          {d.title}
        </button>
      ))}
      <p role="alert">{error}</p>
    </main>
  );
}
