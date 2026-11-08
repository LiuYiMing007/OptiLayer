import { changeLayer } from "../layerCommands";
import { interactiveProject } from "../interactiveModel";
import { flushSync } from "react-dom";
import { request } from "../api";
import type { Material } from "../types";
import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { referenceProject } from "../defaults";
import { useDesktopMenus } from "../menus/useDesktopMenus";
import {
  applyPatches,
  toolDefinitions,
  type ToolId,
  type ToolSnapshot,
} from "./state";
import { useToolHost } from "./useToolHost";
interface Status {
  details?: Record<
    string,
    {
      management?: boolean;
      editor_reopened?: boolean;
      editor_browse_cancel?: boolean;
      editor?: boolean;
      catalogue?: boolean;
      environment?: boolean;
      interactive?: boolean;
      back_layers?: boolean;
      error?: string;
    }
  >;
  ready: Record<string, string>;
  visible: Record<string, boolean>;
  menu: { project: string } | null;
}
// Only mounted after the host explicitly authorizes --window-ipc-self-test.
// Reuses production IPC hooks and child React windows, with pure catalogue reads; never mounts App or opens a Workspace.
export default function WindowIpcCheck() {
  const [inspectedName, setInspectedName] = useState("TFC/SOPRA/AG");
  const [focus, setFocus] = useState<ToolSnapshot["focus"]>();
  const [library, setLibrary] = useState<Material[]>([]);
  const [project, setProject] = useState(referenceProject),
    [error, setError] = useState("");
  const [layerSide, setLayerSide] = useState<"front" | "back">("front");
  const materialCommands = useRef(new Set<string>());
  const currentProject = useRef(project);
  currentProject.current = project;
  const sequence = useRef(0),
    started = useRef(false);
  const snapshot: ToolSnapshot = {
    focus,
    inspectedMaterial: { name: inspectedName, substrate: false },
    sequence: ++sequence.current,
    scope: "isolated-window-ipc-check",
    project,
    selected: 0,
    layerSide,
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
  const host = useToolHost(
    snapshot,
    async (source, action) => {
      if (
        ["material-new", "material-delete", "material-restore"].includes(
          action.kind,
        )
      ) {
        if (
          action.kind === "material-new" &&
          action.substrate !==
            (source === "substrate" || source === "tool-substrate")
        )
          throw Error("新增材料用途未正确传递");
        materialCommands.current.add(
          `${source.replace(/^tool-/, "")}:${action.kind}`,
        );
      }
      let next = currentProject.current;
      if (action.kind === "patch") next = applyPatches(next, action.patches);
      if (action.kind === "layer-side") {
        setLayerSide(action.side);
        return;
      }
      if (action.kind === "layer") {
        next = structuredClone(next);
        if (layerSide === "back") {
          const proxy = { ...next, layers: next.back_layers || [] };
          changeLayer(proxy, 0, action.command, () => crypto.randomUUID());
          next.back_layers = proxy.layers;
        } else changeLayer(next, 0, action.command, () => crypto.randomUUID());
      }
      if (action.kind === "interactive" && action.phase === "preview")
        next = interactiveProject(next, action.target, action.value);
      currentProject.current = next;
      setProject(next);
    },
    setError,
  );
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
      const end = Date.now() + 25000;
      let last: Status | undefined;
      while (Date.now() < end) {
        if (latest.current.error) throw new Error(latest.current.error);
        const s = await invoke<Status>("window_check_status");
        last = s;
        for (const d of Object.values(s.details || {}))
          if (d.error) throw new Error(d.error);
        if (predicate(s)) return s;
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      throw new Error(
        "frontend IPC/render acknowledgement timed out: " +
          JSON.stringify(last),
      );
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
          await until((s) => !!s.details?.[`tool-${id}`]?.management);
        if (id === "materialdata") {
          await until((s) => !!s.details?.["tool-materialdata"]?.editor);
          await invoke("window_check_close", { id });
          await until((s) => !s.visible[id]);
          flushSync(() =>
            setFocus({
              id,
              label: "编辑 n/k 数据表",
              token: "material-editor-reopen",
            }),
          );
          await latest.current.host.show(id);
          await until(
            (s) => !!s.details?.["tool-materialdata"]?.editor_reopened,
          );
          report.material_editor_close_reopen = true;
          flushSync(() => {
            setInspectedName("TFC/SOPRA/AU");
            setFocus({ id, label: "", token: "material-editor-browse" });
          });
          await until(
            (s) => !!s.details?.["tool-materialdata"]?.editor_browse_cancel,
          );
          report.material_editor_browse_cancel = true;
        }
        // Keep the input window visible until blur commits have been acknowledged.
        // WebView2 can defer hidden-renderer input work when the sweep opens the next window.
        if (id === "settings")
          await until((s) => !!s.details?.["tool-settings"]?.environment);
        if (id === "interactive")
          await until((s) => !!s.details?.["tool-interactive"]?.interactive);
        await latest.current.host.hide(id);
        await until((s) => !s.visible[id]);
        await invoke("window_check_dispatch", { id: `view.${id}` });
        await until(
          (s) => s.visible[id] && s.ready[`tool-${id}`] === project.id,
        );
        (report.menu_command_ipc as string[]).push(id);
      }
      await until((s) => !!s.details?.["tool-settings"]?.environment);
      report.environment_controls_shared_state = true;
      await until((s) => !!s.details?.["tool-layers"]?.back_layers);
      report.back_layer_controls_shared_state = true;
      await until((s) => !!s.details?.["tool-interactive"]?.interactive);
      report.interactive_controls_shared_state = true;
      // Exercise the native CloseRequested handler, not only the host's hide command.
      await invoke("window_check_close", { id: "layers" });
      await until((s) => !s.visible.layers && s.visible.settings);
      document
        .querySelector<HTMLButtonElement>('[data-check-open="layers"]')!
        .click();
      await until(
        (s) => s.visible.layers && s.ready["tool-layers"] === project.id,
      );
      // Exercise the production Rust -> persistent frozen Python service, not a mock.
      const base = structuredClone(currentProject.current);
      const compute = (p: typeof base) =>
        invoke<{ T_percent: number[] }>("engine_request", {
          request: { action: "calculate", project: p },
        });
      const originalSpectrum = await compute(base);
      const changed = structuredClone(base);
      changed.settings.angle_deg = 32;
      const startedAt = performance.now();
      const adjusted = await compute(changed);
      report.warm_calculation_ms = performance.now() - startedAt;
      const restored = await compute(base);
      if (
        JSON.stringify(originalSpectrum) !== JSON.stringify(restored) ||
        JSON.stringify(adjusted.T_percent) ===
          JSON.stringify(originalSpectrum.T_percent)
      )
        throw new Error("常驻计算服务结果或无状态恢复失败");
      report.warm_calculation_service = true;
      for (const tool of ["materials", "substrate"]) {
        for (const action of [
          "material-new",
          "material-delete",
          "material-restore",
        ]) {
          if (!materialCommands.current.has(`${tool}:${action}`))
            throw Error(`材料管理 IPC 缺失：${tool}/${action}`);
        }
      }
      report.material_management_button_ipc = true;
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
