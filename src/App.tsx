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
import { getCurrentWindow } from "@tauri-apps/api/window";
import { request } from "./api";
import { clone, referenceProject } from "./defaults";
import { synchronizeBoundaries, physicalSignature } from "./model";
import MaterialLibrary from "./MaterialLibrary";
import SpectrumPanel from "./SpectrumPanel";
import WorkspacePanel from "./WorkspacePanel";
import BrowserMenu from "./menus/BrowserMenu";
import { commandStates, entries, shortcutCommand } from "./menus/commands";
import { useDesktopMenus } from "./menus/useDesktopMenus";
import { changeLayer, type LayerCommand } from "./layerCommands";
import { spectrumCsv } from "./spectrumExport";
import { version as appVersion } from "../package.json";
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

type Modal =
  "projects" | "materials" | "about" | "workspace" | "shortcuts" | null;
const message = (e: unknown) => (e instanceof Error ? e.message : String(e));
export default function App() {
  const [workspace, setWorkspace] = useState<WorkspaceInfo | null>(null);
  const [workspaceError, setWorkspaceError] = useState("");
  const [project, setProject] = useState<Project>(referenceProject);
  const [spectrum, setSpectrum] = useState<Spectrum | null>(null),
    [resultKey, setResultKey] = useState("");
  const [savedKey, setSavedKey] = useState(""),
    [selected, setSelected] = useState(0);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const [modal, setModal] = useState<Modal>(null),
    [projects, setProjects] = useState<SavedProject[]>([]);
  const [confirmation, setConfirmation] = useState<
    ((answer: boolean) => void) | null
  >(null);
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
  const asking = useRef(false);
  const current = useRef(project);
  current.current = project;
  const resultRef = useRef(spectrum);
  resultRef.current = spectrum;
  const working = useRef(false),
    importRef = useRef<HTMLInputElement>(null);
  const dirty = JSON.stringify(project) !== savedKey;
  const stale = !!spectrum && physicalSignature(project) !== resultKey;
  const scope = `${workspace?.id || "unavailable"}:${project.id}:${epoch.current}`;
  const scopeRef = useRef(scope);
  scopeRef.current = scope;
  const receiverRef = useRef({
    result: (s: Spectrum, p: Project) => acceptResult(s, p),
    error: (e: unknown) => setCalculationError(message(e)),
    activity: setCalculating,
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
  };
  const queue = useRef<CalculationQueue | null>(null);
  if (!queue.current)
    queue.current = new CalculationQueue(
      (p) => request<Spectrum>({ action: "calculate", project: p }),
      (s, p) => receiverRef.current.result(s, p),
      (e) => receiverRef.current.error(e),
      (v) => receiverRef.current.activity(v),
    );
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
      Math.min(i, Math.max(0, current.current.layers.length - 1)),
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
      Math.min(i, Math.max(0, current.current.layers.length - 1)),
    );
    setFuture((f) => f.slice(1));
  }
  async function run(task: () => Promise<void>) {
    if (working.current) return;
    working.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await task();
    } catch (e) {
      setError(message(e));
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
    queue.current!.invalidate();
    setCalculationError("");
    const timer = setTimeout(() => {
      queue.current!.submit(current.current);
    }, 180);
    return () => {
      clearTimeout(timer);
      queue.current!.invalidate();
    };
  }, [physicalKey, scope]);
  async function save(copyName?: string) {
    const snapshot = clone(current.current);
    if (copyName) {
      snapshot.id = crypto.randomUUID();
      snapshot.name = copyName;
    }
    await run(async () => {
      const r = await request<{ project: Project; warnings?: string[] }>({
        action: "save",
        project: snapshot,
      });
      if (copyName) {
        epoch.current++;
        scopeRef.current = `${workspace?.id || "unavailable"}:${r.project.id}:${epoch.current}`;
        writers.current.clear();
        setPast([]);
        setFuture([]);
      }
      current.current = r.project;
      setProject(r.project);
      setSavedKey(JSON.stringify(r.project));
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
        `项目已保存到当前工作区${r.warnings?.length ? "；" + r.warnings.join("；") : ""}${spectrumWarning}`,
      );
      await refreshProjects();
    });
  }
  async function newProject() {
    if (!(await canReplace())) return;
    const p = referenceProject();
    p.name = "未命名膜系";
    p.layers = [];
    replace(p);
  }
  function layerCommand(id: LayerCommand, index = selected) {
    if (working.current || confirmation) return;
    let nextSelected = index;
    update((next) => {
      nextSelected = changeLayer(next, index, id, () => crypto.randomUUID());
    });
    setSelected(nextSelected);
  }
  const toolSnapshot: ToolSnapshot = {
    focus,
    sequence: ++sequence.current,
    scope,
    project,
    selected,
    busy: busy || !!confirmation || !!modal,
    calculating,
    dirty,
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
    setFocus({ id, label, token: crypto.randomUUID() });
    await host.show(id);
    if (id === "project") await refreshProjects();
    if (id === "materials") await refreshLibrary();
  }
  async function focusMain() {
    if (isTauri()) await invoke("tool_focus_main");
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
  async function handleToolAction(source: string, action: ToolAction) {
    if (action.scope !== scopeRef.current)
      throw new Error("项目或工作区已切换，请使用最新窗口内容");
    if (working.current || asking.current || modal)
      throw new Error("主工作台正在处理，请稍后重试");
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
    if (action.kind === "select") {
      const index = current.current.layers.findIndex(
        (l) => l.id === action.layerId,
      );
      if (index >= 0) setSelected(index);
      return;
    }
    if (action.kind === "layer") {
      const index = action.layerId
        ? current.current.layers.findIndex((l) => l.id === action.layerId)
        : selected;
      if (index < 0 && action.command !== "layer.add")
        throw new Error("该膜层已删除");
      layerCommand(action.command, index);
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
      await save(action.name.trim());
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
      await run(async () => {
        await request({
          action: "library_save",
          materials: current.current.materials,
        });
        await refreshLibrary();
      });
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
  const panels = { ...host.visible, spectrum: true };
  const states = commandStates({
    busy,
    blocked: !!confirmation || !!modal,
    workspace: !!workspace && !workspaceError,
    canUndo: !!past.length,
    canRedo: !!future.length,
    hasLayer: !!project.layers[selected],
    canAdd: project.layers.length < 500,
    canMoveUp:
      !!project.layers[selected] && selected < project.layers.length - 1,
    canMoveDown: !!project.layers[selected] && selected > 0,
    validSpectrum: !!spectrum && !stale,
    panels,
  });
  async function executeCommand(id: string) {
    if (!states[id]?.enabled || working.current || asking.current) return;
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
        else await showTool(tool);
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
      case "file.new":
        await newProject();
        break;
      case "file.open":
        await showTool("project");
        break;
      case "file.saveAs":
        await showTool("project");
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
        if (isTauri()) await getCurrentWindow().close();
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
      project: project.name,
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
  // Restored native tools may open before the frontend's showTool entry point.
  // Load their shared catalogues once the authoritative Workspace is known.
  useEffect(() => {
    setProjects([]);
    setLibrary([]);
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
      if (isTauri() && platform === "macos") return;
      const target = e.target as HTMLElement;
      const editing =
        target.matches("input, textarea, select") || target.isContentEditable;
      const id = shortcutCommand(
        e,
        navigator.platform.includes("Mac"),
        editing,
      );
      if (id) {
        e.preventDefault();
        void commandRef.current(id).catch((error) => setError(message(error)));
      }
    };
    const leave = (e: BeforeUnloadEvent) => {
      if (JSON.stringify(current.current) !== savedKey) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("keydown", handler);
    window.addEventListener("beforeunload", leave);
    return () => {
      window.removeEventListener("keydown", handler);
      window.removeEventListener("beforeunload", leave);
    };
  }, [savedKey, platform]);
  useEffect(() => {
    if (!isTauri()) return;
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void getCurrentWindow()
      .onCloseRequested(async (event) => {
        if (working.current) {
          event.preventDefault();
          setNotice("正在处理，请完成后再关闭工作台");
          return;
        }
        if (JSON.stringify(current.current) === savedKey) return;
        event.preventDefault();
        if (await canReplace()) await getCurrentWindow().destroy();
      })
      .then((fn) => {
        if (disposed) fn();
        else unlisten = fn;
      })
      .catch((e) => setError(message(e)));
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [savedKey]);
  async function canReplace() {
    if (JSON.stringify(current.current) === savedKey) return true;
    if (asking.current) return false;
    await focusMain();
    asking.current = true;
    try {
      return await new Promise<boolean>((resolve) =>
        setConfirmation(() => resolve),
      );
    } finally {
      asking.current = false;
    }
  }
  function replace(p: Project, saved = false) {
    queue.current!.invalidate();
    epoch.current++;
    writers.current.clear();
    scopeRef.current = `${workspace?.id || "unavailable"}:${p.id}:${epoch.current}`;
    current.current = p;
    setProject(p);
    setSelected(0);
    setPast([]);
    setFuture([]);
    setSpectrum(null);
    setResultKey("");
    setSavedKey(saved ? JSON.stringify(p) : "");
    setNotice("");
    setError("");
    setModal(null);
  }
  async function openProject(id: string) {
    if (!(await canReplace())) return;
    await run(async () => {
      const r = await request<{ project: Project }>({ action: "load", id });
      replace(r.project, true);
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
  async function loadImportedText(name: string, text: string) {
    const r = name.toLowerCase().endsWith(".tfd")
      ? await request<{ project: Project; warning?: string }>({
          action: "import_tfd",
          text,
          template: current.current,
        })
      : await request<{ project: Project; warning?: string }>({
          action: "validate",
          project: JSON.parse(text),
        });
    replace(r.project);

    if (r.warning) setNotice(r.warning);
  }
  async function importNative() {
    if (!(await canReplace())) return;
    await run(async () => {
      const picked = await invoke<{ name: string; content: string } | null>(
        "import_file",
      );
      if (picked) await loadImportedText(picked.name, picked.content);
    });
  }
  async function importFile(file: File) {
    if (file.size > 2_000_000) {
      setError("文件不能超过 2 MB");
      return;
    }
    if (!(await canReplace())) return;
    await run(async () => {
      await loadImportedText(file.name, await file.text());
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
          dispatch={(id) => {
            void executeCommand(id).catch((e) => setError(message(e)));
          }}
        />
      )}
      <header className="spectrum-topbar">
        <div className="spectrum-project">
          <div>
            <strong title={project.name}>{project.name}</strong>
            <small>
              {dirty ? "未保存" : "已保存"} ·{" "}
              {workspace?.name || "未选择工作区"} · {project.layers.length} 层
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
                  void showTool(d.id as ToolId).catch((e) =>
                    setError(message(e)),
                  )
                }
              >
                {d.title}
              </button>
            ))}
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
            {calculating ? "更新中…" : "计算光谱"}
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
        <span>常数 n · k=0 · A 为数值残差 · {appVersion}</span>
      </footer>
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
          .filter((d) => host.visible[d.id])
          .map((d, index) => (
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
            className={`modal ${modal === "materials" ? "wide-modal" : ""}`}
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
                beforeChange={canReplace}
                onChanged={(w) => {
                  const unchanged =
                    workspace?.id === w.id && workspace.root === w.root;
                  setWorkspace(w);
                  setWorkspaceError("");
                  if (unchanged) return;
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
                    当前为各向同性、无吸收常数 n
                    的单面相干膜层模型。尚不支持色散、吸收、基底背面及非相干厚基底；TFD
                    只读取参考子集。A 为数值残差。真实材料数据需明确来源。
                  </p>
                </div>
              </div>
            )}
          </section>
        </div>
      )}
      {confirmation && (
        <div className="modal-backdrop confirmation-backdrop">
          <section
            role="alertdialog"
            aria-modal="true"
            aria-label="未保存的更改"
            className="modal confirm-modal"
          >
            <h2>保留当前修改？</h2>
            <p>当前项目有未保存的更改。可以先返回保存，或放弃修改后继续。</p>
            <div className="confirm-actions">
              <button
                className="button secondary"
                autoFocus
                onClick={() => {
                  confirmation(false);
                  setConfirmation(null);
                }}
              >
                返回编辑
              </button>
              <button
                className="button primary"
                onClick={() => {
                  confirmation(true);
                  setConfirmation(null);
                }}
              >
                放弃修改并继续
              </button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
