import {
  defaultWindowPreferences,
  normalizeWindowPreferences,
  type WindowPreferences,
} from "./windowPreferences";
import { replaceStack } from "./stackFormula";
import { interactiveProject } from "./interactiveModel";
import SaveProjectDialog, { type SaveChoice } from "./SaveProjectDialog";
import { readImportFile } from "./importEncoding";
import {
  applyMaterialChange,
  removeProjectMaterial,
} from "./applyMaterialChange";
import UnsavedDialog from "./UnsavedDialog";
import { projectKey, hasUnsavedChanges, dataKey } from "./projectStatus";
import { useEffect, useRef, useState } from "react";
import {
  ArrowUpRight,
  BookOpen,
  FileText,
  FolderOpen,
  X,
  Waves,
} from "lucide-react";
import { invoke, isTauri } from "@tauri-apps/api/core";

import { request } from "./api";
import { clone, referenceProject } from "./defaults";
import {
  replaceMaterial,
  synchronizeBoundaries,
  physicalSignature,
} from "./model";
import MaterialLibrary from "./MaterialLibrary";
import SpectrumPanel from "./SpectrumPanel";
import WorkspacePanel from "./WorkspacePanel";
import BrowserMenu from "./menus/BrowserMenu";
import {
  commandStates,
  entries,
  shortcutCommand,
  nativeOwnsShortcut,
} from "./menus/commands";
import { useDesktopMenus } from "./menus/useDesktopMenus";
import { changeLayer, type LayerCommand } from "./layerCommands";
import { spectrumCsv } from "./spectrumExport";
import { version, tfcRevision } from "../package.json";
import { CalculationQueue } from "./calculationQueue";
import {
  applyPatches,
  patchKey,
  toolDefinitions,
  type ToolId,
  type ToolAction,
  type ToolSnapshot,
} from "./tools/state";
import { useToolHost, type ToolIntent } from "./tools/useToolHost";
import BrowserTool from "./tools/BrowserTool";
import feedbackFixture from "../fixtures/user-feedback/380nm-project.json";
import type {
  AnalysisBands,
  Material,
  Project,
  SavedProject,
  Spectrum,
  SpectrumAnalysis,
  WorkspaceInfo,
} from "./types";

const appVersion =
  tfcRevision > 1 ? `${version} · 修订${tfcRevision}` : version;
type LeaveChoice = "cancel" | "discard" | "save";
type Modal =
  "projects" | "materials" | "about" | "workspace" | "shortcuts" | null;
const message = (e: unknown) => (e instanceof Error ? e.message : String(e));
export default function App() {
  const [recent, setRecent] = useState<{ id: string; name: string }[]>([]);
  const browserRecent = useRef(
    new Map<string, { name: string; text: string; encoding: string }>(),
  );
  const [hasProject, setHasProject] = useState(false);
  const [startupChooser, setStartupChooser] = useState(!isTauri());
  const startupStarted = useRef(false);
  const windowTransition = useRef(0);
  const [savePrompt, setSavePrompt] = useState<{
    initial: string;
    copy: boolean;
  } | null>(null);
  const saveResolver = useRef<((value: SaveChoice | null) => void) | null>(
    null,
  );
  async function chooseSaveName(copy: boolean): Promise<SaveChoice | null> {
    if (saveResolver.current) return null;
    await focusMain();
    return new Promise((resolve) => {
      saveResolver.current = resolve;
      setSavePrompt({
        initial: current.current.name + (copy ? " 副本" : ""),
        copy,
      });
    });
  }
  const [workspace, setWorkspace] = useState<WorkspaceInfo | null>(null);
  const [workspaceError, setWorkspaceError] = useState("");
  const [project, setProject] = useState<Project>(referenceProject);
  const [spectrum, setSpectrum] = useState<Spectrum | null>(null),
    [resultKey, setResultKey] = useState("");
  const [persisted, setPersisted] = useState(false);
  const [projectFormat, setProjectFormat] = useState<"tfd" | "json">("tfd");
  const [savedKey, setSavedKey] = useState(() => projectKey(project)),
    [selected, setSelected] = useState(0);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const [modal, setModal] = useState<Modal>(null),
    [projects, setProjects] = useState<SavedProject[]>([]);
  const [confirmation, setConfirmation] = useState<
    ((answer: LeaveChoice) => void) | null
  >(null);
  const [inspectedMaterial, setInspectedMaterial] = useState<{
    name: string;
    substrate: boolean;
    draft?: Material;
  }>();
  const [windowPreferences, setWindowPreferences] = useState<WindowPreferences>(
    () => {
      try {
        return normalizeWindowPreferences(
          JSON.parse(localStorage.getItem("tfc-window-preferences") || "null"),
        );
      } catch {
        return structuredClone(defaultWindowPreferences);
      }
    },
  );
  const [environmentPending, setEnvironmentPending] = useState(false);
  useEffect(() => {
    if (isTauri())
      void invoke<WindowPreferences>("tool_preferences")
        .then((p) => setWindowPreferences(normalizeWindowPreferences(p)))
        .catch((e) => setError(message(e)));
  }, []);
  const [layerSide, setLayerSide] = useState<"front" | "back">("front");
  const editingLayers =
    layerSide === "front" ? project.layers : project.back_layers || [];
  const [past, setPast] = useState<Project[]>([]),
    [future, setFuture] = useState<Project[]>([]);
  const [focus, setFocus] = useState<
    { id: string; label: string; token: string } | undefined
  >();
  const [library, setLibrary] = useState<Material[]>([]);
  const [calculating, setCalculating] = useState(false);
  const [calculationError, setCalculationError] = useState("");
  const epoch = useRef(0),
    writers = useRef(new Map<string, string>());
  const sequence = useRef(0);
  const [details, setDetails] = useState(false);
  const [importFailure, setImportFailure] = useState<{
    name: string;
    reason: string;
  } | null>(null);
  const materialEditors = useRef(new Map<string, "materials" | "substrate">());
  const asking = useRef(false);
  const current = useRef(project);
  current.current = project;
  const resultRef = useRef(spectrum);
  resultRef.current = spectrum;
  const working = useRef(false),
    importRef = useRef<HTMLInputElement>(null);
  const dirty = hasUnsavedChanges(project, savedKey);
  const stale = !!spectrum && physicalSignature(project) !== resultKey;
  const scope = `${workspace?.id || "unavailable"}:${project.id}:${epoch.current}`;
  const scopeRef = useRef(scope);
  scopeRef.current = scope;
  const receiverRef = useRef({
    result: (s: Spectrum, p: Project) => acceptResult(s, p),
    error: (e: unknown) => setCalculationError(message(e)),
    activity: setCalculating,
    preview: (_s: Spectrum, _p: Project) => {},
  });
  receiverRef.current = {
    result: (s, p) => {
      if (
        current.current.id === p.id &&
        physicalSignature(current.current) === physicalSignature(p)
      ) {
        acceptResult(s, p);
        setCalculationError("");
      }
    },
    error: (e) => setCalculationError(message(e)),
    activity: setCalculating,
    preview: (s, p) => {
      const session = interaction.current;
      if (
        session &&
        session.scope === scopeRef.current &&
        session.last === projectKey(current.current) &&
        session.keys.has(physicalSignature(p))
      ) {
        acceptResult(s, p);
        setNotice("实时调膜预览 · 继续更新最新参数");
      }
    },
  };
  const queue = useRef<CalculationQueue | null>(null);
  if (!queue.current)
    queue.current = new CalculationQueue(
      (p) => request<Spectrum>({ action: "calculate", project: p }),
      (s, p) => receiverRef.current.result(s, p),
      (e) => receiverRef.current.error(e),
      (v) => receiverRef.current.activity(v),
      (s, p) => receiverRef.current.preview(s, p),
    );
  const calculationScope = useRef(scope);
  const interaction = useRef<{
    session: string;
    source: string;
    scope: string;
    target: string;
    baseline: Project;
    last: string;
    keys: Set<string>;
  } | null>(null);
  function commit(next: Project, clearWriters = true) {
    const previous = clone(current.current);
    if (physicalSignature(previous) !== physicalSignature(next))
      queue.current!.invalidate();
    if (clearWriters) writers.current.clear();
    setPast((p) => [...p.slice(-49), previous]);
    setFuture([]);
    current.current = next;
    setProject(next);
  }
  function update(mutator: (p: Project) => void) {
    const next = clone(current.current);
    mutator(next);
    synchronizeBoundaries(next);
    commit(next);
  }
  function undo() {
    if (!past.length || busy) return;
    if (physicalSignature(current.current) !== physicalSignature(past.at(-1)!))
      queue.current!.invalidate();
    epoch.current++;
    scopeRef.current = `${workspace?.id || "unavailable"}:${current.current.id}:${epoch.current}`;
    writers.current.clear();
    setFuture((f) => [clone(project), ...f]);
    current.current = past.at(-1)!;
    setProject(current.current);
    setSelected((i) =>
      Math.min(
        i,
        Math.max(
          0,
          (layerSide === "front"
            ? current.current.layers
            : current.current.back_layers || []
          ).length - 1,
        ),
      ),
    );
    setPast((p) => p.slice(0, -1));
  }
  function redo() {
    if (!future.length || busy) return;
    if (physicalSignature(current.current) !== physicalSignature(future[0]))
      queue.current!.invalidate();
    epoch.current++;
    scopeRef.current = `${workspace?.id || "unavailable"}:${current.current.id}:${epoch.current}`;
    writers.current.clear();
    setPast((p) => [...p, clone(project)]);
    current.current = future[0];
    setProject(current.current);
    setSelected((i) =>
      Math.min(
        i,
        Math.max(
          0,
          (layerSide === "front"
            ? current.current.layers
            : current.current.back_layers || []
          ).length - 1,
        ),
      ),
    );
    setFuture((f) => f.slice(1));
  }
  async function run(task: () => Promise<void>) {
    if (working.current) return false;
    working.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await task();
      return true;
    } catch (e) {
      setError(message(e));
      return false;
    } finally {
      working.current = false;
      setBusy(false);
    }
  }
  function acceptResult(result: Spectrum, p: Project) {
    setSpectrum(result);
    setResultKey(physicalSignature(p));
    setNotice(`计算完成 · ${result.wavelength_nm.length} 点 · ${result.model}`);
  }
  async function calculate(p = current.current) {
    setCalculationError("");
    queue.current!.submit(p, true);
  }
  const physicalKey = physicalSignature(project);
  useEffect(() => {
    if (!hasProject) return;
    if (calculationScope.current !== scope) {
      queue.current!.reset();
      calculationScope.current = scope;
    } else queue.current!.invalidate();
    setCalculationError("");
    queue.current!.submit(current.current);
    return () => queue.current!.invalidate();
  }, [physicalKey, scope, hasProject]);
  async function save(copyName?: string, forceCopy = false) {
    if (saveResolver.current || working.current) return false;
    if (forceCopy) return await saveAsFile(copyName);
    let name = copyName,
      format = projectFormat;
    if (!persisted && !copyName) {
      const chosen = await chooseSaveName(forceCopy);
      if (chosen === null) return false;
      name = chosen.name;
      format = chosen.format;
    }
    const snapshot = clone(current.current);
    if (copyName || forceCopy) snapshot.id = crypto.randomUUID();
    if (name) snapshot.name = name;
    return await run(async () => {
      const r = await request<{
        project: Project;
        relative_path?: string;
        warnings?: string[];
      }>({
        action: "save",
        project: snapshot,
        format,
      });
      if (copyName || forceCopy) {
        epoch.current++;
        scopeRef.current = `${workspace?.id || "unavailable"}:${r.project.id}:${epoch.current}`;
        writers.current.clear();
        setPast([]);
        setFuture([]);
      }
      current.current = r.project;
      setProject(r.project);
      setSavedKey(projectKey(r.project));
      setPersisted(true);
      setProjectFormat(format);
      let spectrumWarning = "";
      if (
        resultRef.current &&
        physicalSignature(resultRef.current.input_snapshot) ===
          physicalSignature(snapshot)
      ) {
        try {
          await request({
            action: "spectrum_save",
            project_id: r.project.id,
            project: snapshot,
            spectrum: { ...resultRef.current, input_snapshot: snapshot },
          });
        } catch (e) {
          spectrumWarning = `；项目已保存，光谱快照未保存：${message(e)}`;
        }
      }
      setNotice(
        `项目已保存${r.relative_path ? "：" + r.relative_path : "到当前工作区"}${r.warnings?.length ? "；" + r.warnings.join("；") : ""}${spectrumWarning}`,
      );
      await refreshProjects();
    });
  }
  async function saveAsFile(initialName?: string) {
    let choice: SaveChoice | null = null;
    if (!isTauri()) {
      choice = await chooseSaveName(true);
      if (!choice) return false;
    }
    let written = false;
    const ok = await run(async () => {
      const snapshot = clone(current.current);
      snapshot.id = crypto.randomUUID();
      if (initialName) snapshot.name = initialName;
      let result: {
        project: Project;
        format: "tfd" | "json";
        path?: string;
        warnings?: string[];
      } | null;
      if (isTauri())
        result = await invoke("project_save_as", {
          project: snapshot,
          format: projectFormat,
        });
      else {
        snapshot.name = choice!.name;
        const data = await request<{
          project: Project;
          format: "tfd" | "json";
          content: string;
          bytes?: number[];
          warnings?: string[];
        }>({
          action: "export_project",
          project: snapshot,
          format: choice!.format,
        });
        const url = URL.createObjectURL(
          new Blob([data.bytes ? new Uint8Array(data.bytes) : data.content], {
            type: "application/octet-stream",
          }),
        );
        const a = document.createElement("a");
        a.href = url;
        a.download =
          snapshot.name + (data.format === "tfd" ? ".tfd" : ".tfc.json");
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        result = data;
      }
      if (!result) return;
      epoch.current++;
      writers.current.clear();
      scopeRef.current = `${workspace?.id || "unavailable"}:${result.project.id}:${epoch.current}`;
      current.current = result.project;
      setProject(result.project);
      setPast([]);
      setFuture([]);
      setProjectFormat(result.format);
      setSavedKey(projectKey(result.project));
      setPersisted(true);
      setNotice(
        `项目已另存${result.path ? "：" + result.path : "为下载文件"}；下一次“保存项目”写入 Workspace${result.warnings?.length ? "；" + result.warnings.join("；") : ""}`,
      );
      if (isTauri() && result.path) await rememberFile(result.path);
      written = true;
    });
    return ok && written;
  }
  async function newProject() {
    if (!(await canReplace())) return;
    await run(async () => {
      const names = [
        "TFC/MATERIAL/TA2O5",
        "TFC/MATERIAL/SIO2",
        "TFC/SUBSTRAT/AIR",
        "TFC/SUBSTRAT/GLASS",
      ];
      const materials = await Promise.all(
        names.map(
          async (name) =>
            (
              await request<{ material: Material }>({
                action: "catalogue_get",
                name,
              })
            ).material,
        ),
      );
      const p = referenceProject();
      p.name = "未命名膜系";
      p.layers = [];
      p.materials = materials;
      p.settings.incident_material = names[2];
      p.settings.substrate_material = names[3];
      synchronizeBoundaries(p);
      replace(p);
      setProjectFormat("tfd");
      await beginProjectWindows();
    });
  }
  async function closeProject() {
    if (!(await canReplace())) return;
    windowTransition.current++;
    replace(referenceProject());
    setHasProject(false);
    setEnvironmentPending(false);
    queue.current!.reset();
    setCalculating(false);
    await host.hideAll();
  }
  async function rememberFile(path: string) {
    try {
      setRecent(await invoke("recent_remember", { path }));
    } catch (error) {
      setNotice(`项目操作已完成，最近项目列表未能更新：${String(error)}`);
    }
  }
  async function reopenRecent(id: string) {
    if (!(await canReplace())) return;
    const ok = await run(async () => {
      const picked = isTauri()
        ? await invoke<{
            name: string;
            content: string;
            encoding: string;
            path: string;
          }>("recent_open", { id })
        : browserRecent.current.get(id);
      if (!picked) throw Error("最近项目记录已过期，请重新打开文件");
      const text = "content" in picked ? picked.content : picked.text;
      if (await loadImportedText(picked.name, text, picked.encoding)) {
        if ("path" in picked) await rememberFile(picked.path);
        else
          setRecent((r) => [
            ...r.filter((e) => e.id === id),
            ...r.filter((e) => e.id !== id),
          ]);
      } else await focusMain();
    });
    if (!ok) await focusMain();
  }
  function layerCommand(id: LayerCommand, index = selected, side = layerSide) {
    if (working.current || confirmation) return;
    let nextSelected = index;
    update((next) => {
      if (side === "back") {
        if (
          (next.settings.substrate_model || "semi_infinite") === "semi_infinite"
        )
          throw new Error("请先在环境中启用有限厚基底，再编辑背面膜层");
        const projection = { ...next, layers: next.back_layers || [] };
        nextSelected = changeLayer(projection, index, id, () =>
          crypto.randomUUID(),
        );
        next.back_layers = projection.layers;
      } else
        nextSelected = changeLayer(next, index, id, () => crypto.randomUUID());
    });
    setSelected(nextSelected);
  }
  const toolSnapshot: ToolSnapshot = {
    windowPreferences,
    environmentPending,
    focus,
    inspectedMaterial,
    sequence: ++sequence.current,
    scope,
    project,
    selected,
    layerSide,
    busy: busy || !!confirmation || !!modal || !!savePrompt,
    calculating,
    dirty,
    persisted,
    canUndo: !!past.length,
    canRedo: !!future.length,
    workspace,
    projects,
    library,
    spectrum,
    stale,
    error: error || calculationError,
    notice,
  };
  const toolActionRef = useRef<
    (source: string, action: ToolAction) => Promise<void>
  >(async () => {});
  const host = useToolHost(
    toolSnapshot,
    (source, action) => toolActionRef.current(source, action),
    setError,
  );
  async function showTool(id: ToolId, label = "") {
    if (id === "settings") id = "environment";
    setFocus({ id, label, token: crypto.randomUUID() });
    await host.show(id);
    if (id === "project") await refreshProjects();
    if ((id === "materials" || id === "substrate") && workspace)
      await refreshLibrary();
  }
  async function beginProjectWindows() {
    const transition = ++windowTransition.current;
    setEnvironmentPending(true);
    await host.hideAll();
    if (transition === windowTransition.current) await showTool("environment");
  }
  async function completeEnvironment() {
    const transition = windowTransition.current;
    setError("");
    // Validate the whole environment before leaving the first step.
    await request({ action: "validate", project: current.current });
    const selected = isTauri()
      ? normalizeWindowPreferences(await invoke("tool_preferences"))
      : windowPreferences;
    if (transition !== windowTransition.current) return;
    setWindowPreferences(selected);
    setEnvironmentPending(false);
    await host.hide("environment");
    if (transition !== windowTransition.current) return;
    await host.spectrum(selected.openWindows.includes("spectrum"));
    for (const id of selected.openWindows) {
      if (transition !== windowTransition.current) return;
      if (id !== "spectrum")
        await showTool(id as ToolId, id === "layers" ? "选择正面膜层" : "");
    }
  }
  async function focusMain() {
    if (isTauri()) await invoke("tool_focus_main");
    else await host.spectrum(true);
  }
  async function focusPanel(panel: "layers" | "settings" | "spectrum") {
    if (panel === "spectrum") {
      await focusMain();
      return;
    }
    await showTool(panel);
  }
  async function refreshProjects() {
    const r = await request<{ projects: SavedProject[] }>({ action: "list" });
    setProjects(r.projects);
  }
  async function refreshLibrary() {
    const r = await request<{ materials: Material[] }>({
      action: "library_list",
    });
    setLibrary(r.materials);
  }
  async function revealMaterialEditor() {
    if (!materialEditors.current.size) return false;
    setError("");
    setNotice("已恢复未保存的材料编辑；请保存或取消编辑后再选择其它材料。");
    await showTool("materialdata");
    return true;
  }
  async function handleToolAction(source: string, action: ToolAction) {
    if (action.kind === "material-editing") {
      if (action.active) materialEditors.current.set(source, action.tool);
      else {
        materialEditors.current.delete(source);
        setNotice((n) =>
          n.startsWith("已恢复未保存的材料编辑")
            ? "材料编辑已结束，可以选择其它材料。"
            : n,
        );
        if (source.endsWith("materialdata"))
          setInspectedMaterial((m) =>
            m ? { name: m.name, substrate: m.substrate } : m,
          );
      }
      return;
    }
    if (action.scope !== scopeRef.current)
      throw new Error("项目或工作区已切换，请使用最新窗口内容");
    if (
      working.current ||
      asking.current ||
      saveResolver.current ||
      (modal && source !== "main")
    )
      throw new Error("主工作台正在处理，请稍后重试");
    if (action.kind === "window-preferences") {
      const preferences = normalizeWindowPreferences(action.preferences);
      if (isTauri()) await invoke("tool_preferences", { preferences });
      else
        localStorage.setItem(
          "tfc-window-preferences",
          JSON.stringify(preferences),
        );
      setWindowPreferences(preferences);
      return;
    }
    if (action.kind === "environment-complete") {
      await completeEnvironment();
      return;
    }
    if (action.kind === "interactive") {
      if (action.phase === "undo") {
        const session = interaction.current;
        if (
          !session ||
          session.session !== action.session ||
          session.source !== source ||
          session.scope !== action.scope ||
          session.last !== projectKey(current.current)
        )
          throw new Error(
            "当前修改已不属于这一轮调膜，请使用常规撤销或重新载入原值",
          );
        interaction.current = null;
        undo();
        return;
      }
      if (action.phase === "finish") {
        if (
          interaction.current?.session === action.session &&
          interaction.current.source === source
        )
          interaction.current = null;
        return;
      }
      let session = interaction.current;
      if (
        session &&
        session.session === action.session &&
        (session.source !== source ||
          session.scope !== action.scope ||
          session.last !== projectKey(current.current) ||
          session.target !== JSON.stringify(action.target))
      )
        throw new Error("膜系已被其他操作修改，请重新载入原值后继续");
      const continuing = !!session && session.session === action.session;
      if (!continuing)
        session = {
          session: action.session,
          source,
          scope: action.scope,
          target: JSON.stringify(action.target),
          baseline: clone(current.current),
          keys: new Set<string>(),
          last: projectKey(current.current),
        };
      const next = interactiveProject(
        session!.baseline,
        action.target,
        action.value,
      );
      if (!continuing) commit(next);
      else {
        queue.current!.invalidate();
        writers.current.clear();
        current.current = next;
        setProject(next);
      }
      session!.keys.add(physicalSignature(next));
      if (session!.keys.size > 128)
        session!.keys.delete(session!.keys.values().next().value!);
      interaction.current = { ...session!, last: projectKey(next) };
      return;
    }
    if (action.kind === "patch") {
      const next = applyPatches(
        current.current,
        action.patches,
        (p) => writers.current.get(patchKey(p)) === source,
      );
      commit(next, false);
      for (const patch of action.patches)
        writers.current.set(patchKey(patch), source);
      return;
    }
    if (action.kind === "materials-folder") {
      await request({ action: "materials_reveal" });
      return;
    }
    if (action.kind === "material-new") {
      if (await revealMaterialEditor()) return;
      const draft: Material = {
        name: `USER/${crypto.randomUUID()}`,
        display_name: "",
        samples: [[550, 1.5, 0]],
        n: 1.5,
        k: 0,
        role: action.substrate ? "substrate" : "film",
        model: "tabulated",
        color: "#6488a6",
        source: "用户输入；未经实测校准",
      };
      setInspectedMaterial({
        name: draft.name,
        substrate: action.substrate,
        draft,
      });
      await showTool("materialdata");
      return;
    }
    if (action.kind === "material-delete") {
      if (await revealMaterialEditor())
        throw Error(
          "已恢复材料编辑窗口；请保存或取消编辑后再删除，尚未删除任何数据",
        );
      if (action.target === "project") {
        const next = removeProjectMaterial(
          current.current,
          action.name,
          action.expected,
        );
        commit(next);
        setNotice("已从当前项目移除材料，可撤销；共享目录未改变");
      } else {
        const full =
          action.expected.catalogue_summary &&
          action.expected.status !== "quarantined"
            ? (
                await request<{ material: Material }>({
                  action: "catalogue_get",
                  name: action.name,
                })
              ).material
            : action.expected;
        await request({
          action: "library_delete",
          name: action.name,
          expected: full,
        });
        await refreshLibrary();
        setNotice("已从共享目录删除；现有项目快照保留。可在目录中撤销删除");
      }
      return;
    }
    if (action.kind === "material-restore") {
      await request({ action: "library_restore", name: action.name });
      await refreshLibrary();
      return;
    }
    if (action.kind === "material-save") {
      if (
        dataKey(
          current.current.materials.find((m) => m.name === action.replaces) ||
            null,
        ) !== dataKey(action.expected)
      )
        throw new Error("该材料已被其它窗口更新，请取消编辑并重新载入最新数据");
      const scope = scopeRef.current;
      const ok = await run(async () => {
        const { material } = await request<{ material: Material }>({
          action: "material_validate",
          material: action.material,
        });
        if (scope !== scopeRef.current)
          throw new Error("项目已切换，请重新编辑");
        const next = applyMaterialChange(
          current.current,
          material,
          action.replaces,
          action.expected,
          !!action.substrate && !!action.expected,
        );
        const result = await request<{ warnings?: string[] }>({
          action: "library_save",
          materials: [material],
        });
        commit(next);
        await refreshLibrary();
        setNotice(
          `材料已保存到共享库并更新项目${result.warnings?.length ? "；" + result.warnings.join("；") : "；项目修改可撤销，请保存项目"}`,
        );
      });
      if (!ok) throw new Error("材料保存未完成，请查看主窗口的错误信息后重试");
      return;
    }
    if (action.kind === "catalogue-import") {
      const scope = scopeRef.current;
      const result = await request<{ material: Material }>({
        action: "catalogue_get",
        name: action.name,
      });
      if (scope !== scopeRef.current)
        throw new Error("项目已切换，请重新选择材料");
      const next = structuredClone(current.current);
      replaceMaterial(next, result.material);
      if (action.substrate)
        next.settings.substrate_material = result.material.name;
      synchronizeBoundaries(next);
      commit(next, false);
      return;
    }
    if (action.kind === "material-inspect") {
      if (
        ![...current.current.materials, ...library].some(
          (m) => m.name === action.name,
        )
      )
        throw Error("材料不存在，请刷新目录");
      setInspectedMaterial({ name: action.name, substrate: action.substrate });
      await showTool("materialdata");
      return;
    }
    if (action.kind === "stack-apply") {
      const next = replaceStack(
        current.current,
        action.side,
        action.expected,
        action.layers,
      );
      commit(next, false);
      setSelected(0);
      return;
    }
    if (action.kind === "layer-side") {
      setLayerSide(action.side);
      setSelected(0);
      return;
    }
    if (action.kind === "select") {
      if (action.side) setLayerSide(action.side);
      const index = (
        (action.side || layerSide) === "front"
          ? current.current.layers
          : current.current.back_layers || []
      ).findIndex((l) => l.id === action.layerId);
      if (index >= 0) setSelected(index);
      return;
    }
    if (action.kind === "layer") {
      const index = action.layerId
        ? ((action.side || layerSide) === "front"
            ? current.current.layers
            : current.current.back_layers || []
          ).findIndex((l) => l.id === action.layerId)
        : selected;
      if (index < 0 && action.command !== "layer.add")
        throw new Error("该膜层已删除");
      layerCommand(action.command, index, action.side || layerSide);
      return;
    }
    if (action.kind === "command") {
      await commandRef.current(action.id);
      return;
    }
    if (action.kind === "open-project") {
      await openProject(action.id);
      return;
    }
    if (action.kind === "save-copy") {
      if (!action.name.trim() || action.name.length > 200)
        throw new Error("请输入有效项目名称");
      if (!(await save(action.name.trim()))) throw new Error("另存为未完成");
      return;
    }
    if (action.kind === "projects-refresh") {
      await run(refreshProjects);
      return;
    }
    if (action.kind === "library-refresh") {
      await run(refreshLibrary);
      return;
    }
    if (action.kind === "library-save") {
      const ok = await run(async () => {
        const result = await request<{ warnings?: string[] }>({
          action: "library_save",
          materials: current.current.materials,
        });
        await refreshLibrary();
        setNotice(
          result.warnings?.join("；") ||
            "项目材料已保存到共享库与材料数据文件夹",
        );
      });
      if (!ok) throw new Error("共享材料保存失败，请查看主窗口错误");
      return;
    }
    if (action.kind === "analyze") {
      await analyze(current.current.analysis_bands || {});
      return;
    }
    if (action.kind === "export") {
      await download(action.name, action.content, action.type);
      return;
    }
  }
  toolActionRef.current = handleToolAction;
  const panels = {
    ...host.visible,
    spectrum: hasProject && host.visible.spectrum !== false,
  };
  const states = commandStates({
    projectOpen: hasProject,
    busy,
    blocked: !!confirmation || !!modal || !!savePrompt || startupChooser,
    workspace: !!workspace && !workspaceError,
    canUndo: !!past.length,
    canRedo: !!future.length,
    hasLayer: !!editingLayers[selected],
    canAdd: editingLayers.length < 500,
    canMoveUp: !!editingLayers[selected] && selected < editingLayers.length - 1,
    canMoveDown: !!editingLayers[selected] && selected > 0,
    validSpectrum: !!spectrum && !stale,
    panels,
  });
  states["file.recent"].enabled &&= recent.length > 0;
  for (const item of recent)
    states[`file.recent.${item.id}`] = {
      enabled: !busy && !confirmation && !modal && !savePrompt && !startupChooser,
    };
  async function executeCommand(id: string) {
    if (
      !states[id]?.enabled ||
      working.current ||
      asking.current ||
      saveResolver.current
    )
      return;
    if (id.startsWith("file.recent.")) {
      await reopenRecent(id.slice("file.recent.".length));
      return;
    }
    if (
      id.startsWith("layer.") &&
      ["add", "copy", "delete", "up", "down"].includes(id.slice(6))
    ) {
      layerCommand(id as LayerCommand);
      return;
    }
    if (
      id.startsWith("view.") &&
      toolDefinitions.some((d) => d.id === id.slice(5))
    ) {
      const tool = id.slice(5) as ToolId;
      if (toolDefinitions.some((d) => d.id === tool)) {
        if (host.visible[tool]) await host.hide(tool);
        else await showTool(tool, tool === "layers" ? "选择正面膜层" : "");
      }
      return;
    }
    switch (id) {
      case "project.reference":
        await switchExample();
        break;
      case "project.feedback":
        await switchExample(true);
        break;
      case "file.close":
        await closeProject();
        break;
      case "file.new":
        await newProject();
        break;
      case "file.open":
        if (isTauri()) await importNative();
        else importRef.current?.click();
        break;
      case "file.saveAs":
        await save(undefined, true);
        break;
      case "file.save":
        await save();
        break;
      case "file.import":
        if (isTauri()) await importNative();
        else importRef.current?.click();
        break;
      case "file.export":
        await download(
          `${current.current.name}.tfc.json`,
          JSON.stringify(current.current, null, 2),
        );
        break;
      case "file.exportSpectrum":
        if (resultRef.current)
          await download(
            `${current.current.name}-spectrum.csv`,
            spectrumCsv(resultRef.current),
            "text/csv;charset=utf-8",
          );
        break;
      case "file.workspace":
      case "tools.workspace":
        await focusMain();
        setModal("workspace");
        break;
      case "file.quit":
        if (isTauri() && (await canReplace())) await invoke("app_quit");
        break;
      case "edit.undo":
        undo();
        break;
      case "edit.redo":
        redo();
        break;
      case "layer.manage":
        await focusPanel("layers");
        break;
      case "layer.material":
        await showTool("layers", `第 ${selected + 1} 层材料`);
        break;
      case "settings.wavelength":
        await showTool("settings", "起始波长");
        break;
      case "settings.angle":
        await showTool("settings", "入射角");
        break;
      case "settings.substrate":
        await showTool("substrate");
        break;
      case "settings.polarization":
        await showTool("settings", "偏振");
        break;
      case "tools.materials":
      case "tools.library":
        await showTool("materials");
        break;
      case "calculate.spectrum":
        await calculate();
        break;
      case "analysis.spectrum":
        await focusPanel("spectrum");
        break;
      case "analysis.interactive":
        await showTool("interactive");
        break;
      case "analysis.details":
        await showTool("analysis");
        break;
      case "view.reset":
        for (const d of toolDefinitions) await host.hide(d.id as ToolId);
        break;
      case "view.spectrum":
        await focusMain();
        break;
      case "view.remember":
        await host.remember(!host.visible.remember);
        break;
      case "view.menu":
        await invoke("menu_show");
        break;
      case "help.guide":
      case "help.about":
        await focusMain();
        setModal("about");
        break;
      case "help.shortcuts":
        await focusMain();
        setModal("shortcuts");
        break;
    }
  }
  const commandRef = useRef(executeCommand);
  commandRef.current = executeCommand;
  const platform = useDesktopMenus(
    {
      recent,
      project: hasProject ? project.name : "未打开项目",
      workspace: workspace?.name || "未选择",
      dirty,
      busy,
      commands: states,
    },
    (id) => {
      void commandRef.current(id).catch((e) => setError(message(e)));
    },
    setError,
  );
  useEffect(() => {
    if (isTauri())
      void invoke<{ id: string; name: string }[]>("recent_list")
        .then(setRecent)
        .catch((e) => setError(message(e)));
  }, []);
  useEffect(() => {
    if (platform === "desktop" || startupStarted.current) return;
    startupStarted.current = true;
    if (isTauri()) void importNative();
  }, [platform]);
  async function download(
    name: string,
    content: string,
    type = "application/json",
  ) {
    await run(async () => {
      if (isTauri()) {
        const exported = await invoke<boolean>("export_file", {
          name,
          content,
        });
        if (exported) setNotice("文件已导出");
      } else {
        const url = URL.createObjectURL(new Blob([content], { type }));
        const a = document.createElement("a");
        a.href = url;
        a.download = name;
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        setNotice("已生成下载文件");
      }
    });
  }
  async function analyze(bands: AnalysisBands) {
    if (!spectrum || stale) return;
    const previous = spectrum;
    await run(async () => {
      const result = await request<SpectrumAnalysis>({
        action: "analyze",
        spectrum: previous,
        bands,
      });
      setSpectrum({
        ...previous,
        analysis: result,
        analysis_bands: clone(bands),
      });
      setNotice("波段指标已更新；未改变光谱计算结果");
    });
  }
  useEffect(() => {
    void request<{ workspace: WorkspaceInfo }>({ action: "workspace_info" })
      .then((r) => {
        setWorkspace(r.workspace);
        setWorkspaceError("");
      })
      .catch((e) => setWorkspaceError(message(e)));
  }, []);
  useEffect(() => {
    let disposed = false;
    void request<{ materials: Material[] }>({ action: "catalogue_list" })
      .then((r) => {
        if (!disposed)
          setLibrary((existing) => [
            ...existing,
            ...r.materials.filter(
              (m) => !existing.some((x) => x.name === m.name),
            ),
          ]);
      })
      .catch((e) => {
        if (!disposed) setError(`材料目录加载失败：${message(e)}`);
      });
    return () => {
      disposed = true;
    };
  }, []);
  // Restored native tools may open before the frontend's showTool entry point.
  // Load their shared catalogues once the authoritative Workspace is known.
  useEffect(() => {
    setProjects([]);
    if (!workspace) return;
    let disposed = false;
    void Promise.allSettled([
      request<{ projects: SavedProject[] }>({ action: "list" }),
      request<{ materials: Material[] }>({ action: "library_list" }),
    ]).then(([saved, materials]) => {
      if (disposed) return;
      if (saved.status === "fulfilled") setProjects(saved.value.projects);
      else setError(message(saved.reason));
      if (materials.status === "fulfilled")
        setLibrary(materials.value.materials);
      else setError(message(materials.reason));
    });
    return () => {
      disposed = true;
    };
  }, [workspace?.id]);
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const editing =
        target.matches("input, textarea, select") || target.isContentEditable;
      const id = shortcutCommand(
        e,
        navigator.platform.includes("Mac"),
        editing,
      );
      if (isTauri() && platform === "macos" && nativeOwnsShortcut(id)) return;
      if (id) {
        e.preventDefault();
        void commandRef.current(id).catch((error) => setError(message(error)));
      }
    };
    const leave = (e: BeforeUnloadEvent) => {
      if (hasUnsavedChanges(current.current, savedKey)) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("keydown", handler);
    if (!isTauri()) window.addEventListener("beforeunload", leave);
    return () => {
      window.removeEventListener("keydown", handler);
      window.removeEventListener("beforeunload", leave);
    };
  }, [savedKey, platform]);
  async function canReplace() {
    if (materialEditors.current.size) {
      await revealMaterialEditor();
      setNotice("请先在材料窗口保存或取消当前编辑，再切换项目或退出。");
      return false;
    }
    if (!hasUnsavedChanges(current.current, savedKey)) return true;
    if (asking.current) return false;
    await focusMain();
    asking.current = true;
    try {
      const choice = await new Promise<LeaveChoice>((resolve) =>
        setConfirmation(() => resolve),
      );
      // Finish the confirmation before opening the naming dialog or saving.
      // No hidden confirmation component owns the pending save continuation.
      if (choice === "cancel") return false;
      if (choice === "discard") return true;
      return await save();
    } finally {
      asking.current = false;
    }
  }
  function replace(p: Project, saved = false) {
    setHasProject(true);
    queue.current!.invalidate();
    epoch.current++;
    writers.current.clear();
    scopeRef.current = `${workspace?.id || "unavailable"}:${p.id}:${epoch.current}`;
    current.current = p;
    setProject(p);
    setSelected(0);
    setLayerSide("front");
    setPast([]);
    setFuture([]);
    setSpectrum(null);
    setResultKey("");
    setSavedKey(projectKey(p));
    setPersisted(saved);
    setNotice("");
    setError("");
    setImportFailure(null);
    setModal(null);
  }
  async function openProject(id: string) {
    if (!(await canReplace())) return;
    await run(async () => {
      const r = await request<{ project: Project }>({ action: "load", id });
      replace(r.project, true);
      setProjectFormat(
        projects.find((p) => p.id === id)?.relative_path?.endsWith(".tfd")
          ? "tfd"
          : "json",
      );
      await beginProjectWindows();
    });
  }
  async function switchExample(feedback = false) {
    if (!(await canReplace())) return;
    await run(async () => {
      const raw = feedback
        ? { ...clone(feedbackFixture), id: crypto.randomUUID() }
        : referenceProject();
      const r = await request<{ project: Project }>({
        action: "validate",
        project: raw,
      });
      replace(r.project);
    });
  }
  async function loadImportedText(
    name: string,
    text: string,
    encoding = "unicode",
  ) {
    try {
      const r = name.toLowerCase().endsWith(".tfd")
        ? await request<{ project: Project; warning?: string }>({
            action: "import_tfd",
            name,
            encoding,
            text,
            template: current.current,
          })
        : await request<{ project: Project; warning?: string }>({
            action: "validate",
            project: JSON.parse(text),
          });
      replace(r.project);
      setProjectFormat(name.toLowerCase().endsWith(".tfd") ? "tfd" : "json");
      await beginProjectWindows();
      // Opening an existing file is clean until the user changes project data.
      if (r.warning) setNotice(r.warning);
      setImportFailure(null);
      return true;
    } catch (e) {
      setImportFailure({ name, reason: message(e) });
      // Import is transactional: existing project and its spectrum stay intact.
      return false;
    }
  }
  async function importNative() {
    if (!(await canReplace())) return;
    await run(async () => {
      try {
        const picked = await invoke<{
          name: string;
          content: string;
          encoding?: string;
          path: string;
        } | null>("import_file");
        if (picked) {
          const loaded = await loadImportedText(
            picked.name,
            picked.content,
            picked.encoding,
          );
          if (!loaded) await focusMain();
          else await rememberFile(picked.path);
        }
      } catch (e) {
        setImportFailure({ name: "所选文件", reason: message(e) });
        await focusMain();
      }
    });
  }
  async function importFile(file: File) {
    if (file.size > 2_000_000) {
      setImportFailure({
        name: file.name,
        reason: "文件不能超过 2 MB；未替换当前项目。",
      });
      return;
    }
    if (!(await canReplace())) return;
    await run(async () => {
      try {
        const { content, encoding } = await readImportFile(file);
        if (await loadImportedText(file.name, content, encoding)) {
          const id = String(Date.now());
          browserRecent.current.set(id, {
            name: file.name,
            text: content,
            encoding,
          });
          setRecent((r) =>
            [
              { id, name: file.name },
              ...r.filter((x) => x.name !== file.name),
            ].slice(0, 10),
          );
        }
      } catch (e) {
        setImportFailure({ name: file.name, reason: message(e) });
      }
    });
  }
  const browserSend = (id: string) => (intent: ToolIntent) =>
    handleToolAction(`browser-${id}`, {
      ...intent,
      scope: scopeRef.current,
      requestId: crypto.randomUUID(),
    } as ToolAction).catch((e) => {
      setError(message(e));
      throw e;
    });
  return (
    <div className="spectral-workstation">
      {platform === "browser" && (
        <BrowserMenu
          states={states}
          recent={recent}
          dispatch={(id) => {
            void executeCommand(id).catch((e) => setError(message(e)));
          }}
        />
      )}
      {startupChooser && (
        <div className="startup-open-backdrop">
          <section
            role="dialog"
            aria-label="打开项目"
            className="startup-open-dialog"
          >
            <h2>打开项目</h2>
            <p>选择 TFCalc 膜系（.tfd）或 TFC 项目（.tfc.json）。</p>
            <footer>
              <button onClick={() => setStartupChooser(false)}>取消</button>
              <button
                onClick={() => {
                  setStartupChooser(false);
                  importRef.current?.click();
                }}
              >
                选择文件…
              </button>
            </footer>
          </section>
        </div>
      )}
      {!hasProject && (importFailure || error) && (
        <section className="startup-open-dialog" role="alert">
          <p>{importFailure?.reason || error}</p>
          <button
            onClick={() => {
              setImportFailure(null);
              setError("");
              if (isTauri()) void host.spectrum(false);
            }}
          >
            关闭提示
          </button>
        </section>
      )}
      <div
        className="spectrum-window-body"
        hidden={!hasProject || host.visible.spectrum === false}
      >
        <header className="spectrum-topbar">
          <div className="spectrum-project">
            <div>
              <strong title={project.name}>{project.name}</strong>
              <small>
                {dirty ? "未保存" : persisted ? "已保存" : "新项目 · 未修改"} ·{" "}
                {workspace?.name || "未选择工作区"} · 正面{" "}
                {project.layers.length} 层
                {project.back_layers?.length
                  ? ` / 背面 ${project.back_layers.length} 层`
                  : ""}
              </small>
            </div>
          </div>
          <nav className="compact-tools" aria-label="打开工具窗口">
            {toolDefinitions
              .filter((d) => ["layers", "settings", "project"].includes(d.id))
              .map((d) => (
                <button
                  key={d.id}
                  aria-pressed={!!host.visible[d.id]}
                  onClick={() =>
                    void (
                      d.id === "project"
                        ? isTauri()
                          ? importNative()
                          : Promise.resolve(importRef.current?.click())
                        : showTool(d.id as ToolId)
                    ).catch((e) => setError(message(e)))
                  }
                >
                  {d.title}
                </button>
              ))}
            <button
              title={
                workspace ? `数据保存在：${workspace.root}` : "尚未连接工作区"
              }
              onClick={() => setModal("workspace")}
            >
              数据位置…
            </button>
          </nav>
          <div className="spectrum-actions">
            <button
              className="button secondary"
              disabled={busy}
              onClick={() => void save()}
            >
              保存
            </button>
            <button
              className="button primary"
              disabled={busy}
              onClick={() => void calculate()}
            >
              单纯分析
            </button>
            {platform === "windows" && (
              <button
                onClick={() =>
                  void invoke("menu_show").catch((e) => setError(message(e)))
                }
              >
                菜单
              </button>
            )}
          </div>
        </header>
        {importFailure && (
          <section className="import-failure" role="alert">
            <div>
              <strong>未导入：{importFailure.name}</strong>
              <span>{importFailure.reason}</span>
              <small>
                当前项目未被替换。下方曲线仍属于“{project.name}
                ”，不是本次导入文件的结果。
              </small>
            </div>
            <button
              disabled={busy}
              onClick={() => {
                if (isTauri()) void importNative();
                else importRef.current?.click();
              }}
            >
              重新选择文件
            </button>
            <button onClick={() => setImportFailure(null)}>关闭提示</button>
          </section>
        )}
        {(error || calculationError || workspaceError) && (
          <div role="alert" className="notice error">
            <span>{error || calculationError || workspaceError}</span>
            <button
              onClick={() => {
                setError("");
                setCalculationError("");
                if (workspaceError) setModal("workspace");
              }}
            >
              {workspaceError ? "工作区设置" : "关闭提示"}
            </button>
          </div>
        )}
        <div className="main-spectrum">
          <SpectrumPanel
            mode="main"
            project={project}
            spectrum={spectrum}
            stale={stale}
            busy={busy}
            update={update}
            analyze={(bands) => void analyze(bands)}
            download={download}
            onError={setError}
            details={details}
            setDetails={setDetails}
            openAnalysis={() => void showTool("analysis")}
            openTargets={() => void showTool("targets")}
          />
        </div>
        <footer className="spectral-status">
          <span>
            {calculating
              ? "正在自动更新光谱…"
              : !spectrum
                ? "等待光谱计算"
                : stale
                  ? "参数已改变，等待更新…"
                  : "光谱已与当前膜系同步"}
            {notice ? " · " + notice : ""}
          </span>
          <span>各向同性 n/k · A=100−R−T · {appVersion}</span>
        </footer>
      </div>
      <input
        ref={importRef}
        type="file"
        accept=".tfd,.json"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (file) void importFile(file);
        }}
      />
      {!isTauri() &&
        toolDefinitions
          .filter((d) => host.visible[d.id] || host.opened[d.id])
          .map((d, index) => (
            <div
              key={d.id}
              style={{ display: host.visible[d.id] ? "contents" : "none" }}
            >
              <BrowserTool
                key={d.id}
                id={d.id}
                title={d.title}
                snapshot={toolSnapshot}
                index={index}
                send={browserSend(d.id)}
                close={() => {
                  void host.hide(d.id as ToolId);
                }}
              />
            </div>
          ))}
      {modal && (
        <div
          className="modal-backdrop"
          onClick={() => {
            if (!busy) setModal(null);
          }}
        >
          <section
            role="dialog"
            aria-modal="true"
            aria-label={
              modal === "projects"
                ? "我的项目"
                : modal === "materials"
                  ? "材料与基底"
                  : modal === "shortcuts"
                    ? "快捷键"
                    : modal === "workspace"
                      ? "工作区"
                      : "使用说明"
            }
            className={`modal ${modal === "materials" ? "wide-modal" : modal === "workspace" ? "workspace-modal" : ""}`}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-heading">
              <h2>
                {modal === "projects"
                  ? "我的项目"
                  : modal === "materials"
                    ? "材料与基底"
                    : modal === "shortcuts"
                      ? "快捷键"
                      : modal === "workspace"
                        ? "工作区"
                        : "关于 TFC 工作台"}
              </h2>
              <button aria-label="关闭" onClick={() => setModal(null)}>
                <X size={20} />
              </button>
            </div>
            {modal === "workspace" && (
              <WorkspacePanel
                workspace={workspace}
                error={workspaceError}
                beforeChange={workspace ? canReplace : async () => true}
                onChanged={(w) => {
                  const unchanged =
                    workspace?.id === w.id && workspace.root === w.root;
                  setWorkspace(w);
                  setWorkspaceError("");
                  if (unchanged || !workspace) return;
                  const p = referenceProject();
                  replace(p);
                  setProjects([]);
                }}
              />
            )}
            {modal === "projects" && (
              <>
                <p className="modal-description">
                  旧版项目打开时会保留材料常数和物理厚度，并迁移为具名的介质、基底快照。
                </p>
                {!projects.length ? (
                  <div className="empty-state">
                    <FolderOpen size={32} />
                    <p>还没有保存的项目</p>
                  </div>
                ) : (
                  <div className="project-list">
                    {projects.map((p) => (
                      <button
                        key={p.id}
                        disabled={busy}
                        onClick={() => void openProject(p.id)}
                      >
                        <FileText size={20} />
                        <div>
                          <strong>{p.name}</strong>
                          <small>
                            {new Date(p.updated_at).toLocaleString("zh-CN")}
                          </small>
                        </div>
                        <ArrowUpRight size={16} />
                      </button>
                    ))}
                  </div>
                )}
              </>
            )}
            {modal === "materials" && (
              <MaterialLibrary
                project={project}
                update={update}
                library={library}
                onImport={(name, substrate) =>
                  handleToolAction("main", {
                    kind: "catalogue-import",
                    name,
                    substrate,
                    scope: scopeRef.current,
                    requestId: crypto.randomUUID(),
                  })
                }
                onNew={() =>
                  handleToolAction("main", {
                    kind: "material-new",
                    substrate: false,
                    scope: scopeRef.current,
                    requestId: crypto.randomUUID(),
                  })
                }
                onDelete={(name, expected, target) =>
                  handleToolAction("main", {
                    kind: "material-delete",
                    name,
                    expected,
                    target,
                    scope: scopeRef.current,
                    requestId: crypto.randomUUID(),
                  })
                }
                onRestore={(name) =>
                  handleToolAction("main", {
                    kind: "material-restore",
                    name,
                    scope: scopeRef.current,
                    requestId: crypto.randomUUID(),
                  })
                }
                onMaterialSave={(material, replaces, expected) =>
                  handleToolAction("main", {
                    kind: "material-save",
                    material,
                    replaces,
                    expected,
                    scope: scopeRef.current,
                    requestId: crypto.randomUUID(),
                  })
                }
                onEditing={(active) =>
                  handleToolAction("main", {
                    kind: "material-editing",
                    active,
                    tool: "materials",
                    scope: scopeRef.current,
                    requestId: crypto.randomUUID(),
                  })
                }
                openFolder={() => request<void>({ action: "materials_reveal" })}
                onSaveLibrary={async () => {
                  await request({
                    action: "library_save",
                    materials: project.materials,
                  });
                  await refreshLibrary();
                }}
              />
            )}
            {modal === "shortcuts" && (
              <div className="shortcut-guide">
                <p>
                  文本输入中的标准撤销、复制和粘贴保持系统行为。以下为工作台命令：
                </p>
                <table>
                  <tbody>
                    {entries
                      .filter((item) => item.implemented && item.shortcut)
                      .map((item) => (
                        <tr key={item.id}>
                          <td>{item.label}</td>
                          <td>
                            <kbd>
                              {(navigator.platform.includes("Mac")
                                ? item.macShortcut || item.shortcut
                                : item.shortcut
                              )
                                ?.replace(
                                  "CmdOrCtrl",
                                  navigator.platform.includes("Mac")
                                    ? "⌘"
                                    : "Ctrl",
                                )
                                .replace("Alt", "⌥")
                                .replaceAll("+", " ")}
                            </kbd>
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
                <p>
                  Mac 使用系统顶部菜单；Windows
                  从独立菜单窗口调用，关闭后可在主工作台重新显示。
                </p>
              </div>
            )}
            {modal === "about" && (
              <div className="about-content">
                <div className="about-logo">
                  <Waves size={32} />
                </div>
                <h3>
                  TFC <span>{appVersion}</span>
                </h3>
                <p>
                  物理厚度 d、光学厚度 n·d 和 QWOT
                  都可编辑。QWOT=4n·d/λ₀；引擎只接收物理厚度。修改材料 n
                  或参考波长时保持 d。
                </p>
                <ol>
                  <li>
                    在「材料与基底」添加具名材料，并选择用途；基底可在计算设置中选择。
                  </li>
                  <li>
                    入射角支持 0–89.9°，可选 S、P 或非偏振（S/P 功率平均）。
                  </li>
                  <li>
                    光谱默认仅显示 T 并自动调整纵轴；可切换 R、0–100% 及 S/P
                    分量。
                  </li>
                  <li>
                    详细分析提供波段积分均值、全部 50% 交点、10–90%
                    边缘、峰谷及报告导出。
                  </li>
                </ol>
                <div className="model-note">
                  <BookOpen size={18} />
                  <p>
                    当前支持各向同性常数、色散及吸收 n/k
                    计算，支持半无限基底、有限厚非相干基底和相干基底；正背面膜层可分别编辑。照射方向由第一表面指定。
                    A
                    为薄膜及有限基底的吸收，无吸收时为数值残差。光源/探测器响应与本征
                    T/R/A 分离。 尚不支持各向异性、增益和缺少完整定义的 TFCalc
                    混合/可变材料。
                  </p>
                </div>
              </div>
            )}
          </section>
        </div>
      )}
      {savePrompt && (
        <SaveProjectDialog
          initial={savePrompt.initial}
          copy={savePrompt.copy}
          defaultFormat={projectFormat}
          folder={workspace?.root || "Workspace"}
          finish={(name) => {
            const resolve = saveResolver.current;
            saveResolver.current = null;
            setSavePrompt(null);
            resolve?.(name);
          }}
        />
      )}
      {confirmation && (
        <UnsavedDialog
          name={project.name}
          cancel={() => {
            confirmation("cancel");
            setConfirmation(null);
          }}
          discard={() => {
            confirmation("discard");
            setConfirmation(null);
          }}
          save={() => {
            confirmation("save");
            setConfirmation(null);
          }}
        />
      )}
    </div>
  );
}
