import { useEffect, useRef, useState } from "react";
import {
  ArrowUpRight,
  BookOpen,
  CircleHelp,
  Download,
  FilePlus2,
  FileText,
  FlaskConical,
  FolderOpen,
  Layers3,
  Save,
  ShieldCheck,
  Upload,
  Waves,
  X,
} from "lucide-react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { request } from "./api";
import { clone, referenceProject } from "./defaults";
import { physicalSignature } from "./model";
import LayerEditor from "./LayerEditor";
import CalculationSettings from "./CalculationSettings";
import MaterialLibrary from "./MaterialLibrary";
import SpectrumPanel from "./SpectrumPanel";
import WorkspacePanel from "./WorkspacePanel";
import BrowserMenu from "./menus/BrowserMenu";
import { commandStates, entries, shortcutCommand } from "./menus/commands";
import { useDesktopMenus } from "./menus/useDesktopMenus";
import { changeLayer, type LayerCommand } from "./layerCommands";
import { spectrumCsv } from "./spectrumExport";
import { version as appVersion } from "../package.json";
import feedbackFixture from "../fixtures/user-feedback/380nm-project.json";
import type {
  AnalysisBands,
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
  const [panels, setPanels] = useState({
    sidebar: true,
    layers: true,
    settings: true,
    spectrum: true,
  });
  const [focusTarget, setFocusTarget] = useState<{
    panel: string;
    label?: string;
  } | null>(null);
  useEffect(() => {
    if (!focusTarget) return;
    const element = document.querySelector<HTMLElement>(
      `[data-workbench-panel="${focusTarget.panel}"]`,
    );
    element?.scrollIntoView({ block: "center", behavior: "smooth" });
    if (focusTarget.label)
      element
        ?.querySelector<HTMLElement>(`[aria-label="${focusTarget.label}"]`)
        ?.focus();
  }, [focusTarget]);
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
  function update(mutator: (p: Project) => void) {
    const previous = clone(current.current);
    const next = clone(previous);
    mutator(next);
    setPast((p) => [...p.slice(-49), previous]);
    setFuture([]);
    current.current = next;
    setProject(next);
  }
  function undo() {
    if (!past.length || busy) return;
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
    const snapshot = clone(p);
    await run(async () => {
      acceptResult(
        await request<Spectrum>({ action: "calculate", project: snapshot }),
        snapshot,
      );
    });
  }
  async function save() {
    const snapshot = clone(current.current);
    await run(async () => {
      const r = await request<{ project: Project; warnings?: string[] }>({
        action: "save",
        project: snapshot,
      });
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
            project: resultRef.current.input_snapshot,
            spectrum: resultRef.current,
          });
        } catch (e) {
          spectrumWarning = `；项目已保存，光谱快照未保存：${message(e)}`;
        }
      }
      setNotice(
        `项目已保存到当前工作区${r.warnings?.length ? "；" + r.warnings.join("；") : ""}${spectrumWarning}`,
      );
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
  function focusPanel(
    panel: "layers" | "settings" | "spectrum",
    label?: string,
  ) {
    setModal(null);
    setPanels((p) => ({ ...p, [panel]: true }));
    setFocusTarget({ panel, label });
  }
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
    if (id.startsWith("view.") && id.slice(5) in panels) {
      setPanels((p) => ({
        ...p,
        [id.slice(5)]: !p[id.slice(5) as keyof typeof p],
      }));
      return;
    }
    switch (id) {
      case "file.new":
        await newProject();
        break;
      case "file.open":
        await openProjects();
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
        focusPanel("layers");
        break;
      case "layer.material":
        focusPanel("layers", `第 ${selected + 1} 层材料`);
        break;
      case "settings.wavelength":
        focusPanel("settings", "起始波长");
        break;
      case "settings.angle":
        focusPanel("settings", "入射角");
        break;
      case "settings.polarization":
        focusPanel("settings", "偏振");
        break;
      case "tools.materials":
      case "tools.library":
        setModal("materials");
        break;
      case "calculate.spectrum":
        await calculate();
        break;
      case "analysis.spectrum":
        focusPanel("spectrum");
        break;
      case "analysis.details":
        setDetails(true);
        focusPanel("spectrum");
        break;
      case "view.reset":
        setPanels({
          sidebar: true,
          layers: true,
          settings: true,
          spectrum: true,
        });
        break;
      case "view.menu":
        await invoke("menu_show");
        break;
      case "help.guide":
      case "help.about":
        setModal("about");
        break;
      case "help.shortcuts":
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
    void calculate(current.current);
  }, []);
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
  async function openProjects() {
    await run(async () => {
      const r = await request<{ projects: SavedProject[] }>({ action: "list" });
      setProjects(r.projects);
      setModal("projects");
    });
  }
  async function openProject(id: string) {
    if (!(await canReplace())) return;
    await run(async () => {
      const r = await request<{ project: Project }>({ action: "load", id });
      replace(r.project, true);
      acceptResult(
        await request<Spectrum>({ action: "calculate", project: r.project }),
        r.project,
      );
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
      acceptResult(
        await request<Spectrum>({ action: "calculate", project: r.project }),
        r.project,
      );
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
    acceptResult(
      await request<Spectrum>({ action: "calculate", project: r.project }),
      r.project,
    );
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
  return (
    <div className="app-shell">
      <aside className="sidebar" hidden={!panels.sidebar}>
        <div className="brand">
          <div className="brand-mark">
            <Waves size={25} />
          </div>
          <div>
            <strong>
              TFC<span> Workbench</span>
            </strong>
            <small>THIN FILM WORKBENCH</small>
          </div>
        </div>
        <div className="workspace-label">
          工作空间 <span>本地</span>
        </div>
        <nav>
          <button className="nav-item active" onClick={() => setModal(null)}>
            <Layers3 size={18} />
            膜系设计<span className="nav-count">01</span>
          </button>
          <button
            className="nav-item"
            disabled={busy}
            onClick={() => void openProjects()}
          >
            <FolderOpen size={18} />
            我的项目
          </button>
          <button className="nav-item" onClick={() => setModal("materials")}>
            <FlaskConical size={18} />
            材料与基底
            <span className="nav-count">{project.materials.length}</span>
          </button>
        </nav>
        <div className="sidebar-divider" />
        <div className="workspace-label">验证案例</div>
        <button
          className="sample-link"
          disabled={busy}
          onClick={() => void switchExample()}
        >
          <span className="sample-dot" />
          <div>
            550 nm 四层参考<small>原始 Golden Sample</small>
          </div>
          <ArrowUpRight size={14} />
        </button>
        <button
          className="sample-link"
          disabled={busy}
          onClick={() => void switchExample(true)}
        >
          <span className="sample-dot" />
          <div>
            380 nm 使用反馈<small>高透过曲线 · 自动纵轴</small>
          </div>
          <ArrowUpRight size={14} />
        </button>
        <div className="sidebar-bottom">
          <div className="local-card">
            <span className="online-dot" />
            <div>
              本地计算引擎<small>独立 TMM · 材料快照</small>
            </div>
            <ShieldCheck size={16} />
          </div>
          <button className="help-link" onClick={() => setModal("about")}>
            <CircleHelp size={16} />
            使用说明<span>v{appVersion}</span>
          </button>
        </div>
      </aside>
      <div className="workspace">
        {platform === "browser" && (
          <BrowserMenu
            states={states}
            dispatch={(id) => {
              void executeCommand(id).catch((e) => setError(message(e)));
            }}
          />
        )}
        <header className="topbar">
          <div className="breadcrumb">
            工作空间<span>/</span>
            <span>膜系设计</span>
          </div>
          <div className="topbar-right">
            {platform === "windows" && (
              <button
                className="workspace-switch"
                onClick={() =>
                  void invoke("menu_show").catch((e) => setError(message(e)))
                }
              >
                显示菜单窗口
              </button>
            )}
            <button
              className="workspace-switch"
              disabled={busy}
              onClick={() => setModal("workspace")}
            >
              <FolderOpen size={14} />
              {workspace?.location_mode === "project-relative"
                ? "项目内 · "
                : ""}
              {workspace?.name || "选择工作区"}
            </button>
            <span className="version-badge">V{appVersion} · 离线工作区</span>
            <span className="top-divider" />
            <span className="platform">离线优先 · 本地工作台</span>
          </div>
        </header>
        <main>
          <div className="page-heading">
            <div>
              <div className="eyebrow">OPTICAL THIN FILM DESIGN</div>
              <h1>
                膜系设计
                <span className="heading-dot" />
              </h1>
              <p>编辑膜层、选择材料与基底，查看可追溯的光谱结果。</p>
            </div>
            <div className="heading-actions">
              <button
                className="button secondary"
                disabled={busy}
                onClick={() => void newProject()}
              >
                <FilePlus2 size={16} />
                新建项目
              </button>
              <button
                className="button primary"
                disabled={busy}
                onClick={() => void save()}
              >
                <Save size={16} />
                保存项目
                <span className="shortcut">
                  {navigator.platform.includes("Mac") ? "⌘ S" : "Ctrl S"}
                </span>
              </button>
            </div>
          </div>
          {workspaceError && (
            <div className="notice error">
              <span>{workspaceError}</span>
              <button onClick={() => setModal("workspace")}>
                重新选择工作区
              </button>
            </div>
          )}
          {(error || notice) && (
            <div
              role={error ? "alert" : "status"}
              className={`notice ${error ? "error" : ""}`}
            >
              <span>{error || notice}</span>
              <button
                aria-label="关闭提示"
                onClick={() => {
                  setError("");
                  setNotice("");
                }}
              >
                <X size={14} />
              </button>
            </div>
          )}
          <section className="project-strip">
            <div className="project-icon">
              <FileText size={20} />
            </div>
            <div className="project-title">
              <input
                aria-label="项目名称"
                value={project.name}
                disabled={busy}
                maxLength={200}
                onChange={(e) =>
                  update((p) => {
                    p.name = e.target.value;
                  })
                }
              />
              <span>
                <span className={`save-dot ${dirty ? "unsaved" : ""}`} />
                {dirty ? "有未保存的更改" : "已保存到工作区"}
                <span className="dot-separator">·</span>
                编号从基底侧开始；表格按光传播方向显示
              </span>
            </div>
            <div className="strip-actions">
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
              <button
                className="text-button"
                disabled={busy}
                onClick={() => {
                  if (isTauri()) void importNative();
                  else importRef.current?.click();
                }}
              >
                <Upload size={15} />
                导入
              </button>
              <button
                className="text-button"
                disabled={busy}
                onClick={() =>
                  void download(
                    `${project.name}.tfc.json`,
                    JSON.stringify(project, null, 2),
                  )
                }
              >
                <Download size={15} />
                导出项目
              </button>
            </div>
          </section>
          <div
            className={`editor-grid ${!panels.layers || !panels.settings ? "single-editor" : ""}`}
            hidden={!panels.layers && !panels.settings}
          >
            <div data-workbench-panel="layers" hidden={!panels.layers}>
              <LayerEditor
                command={layerCommand}
                project={project}
                busy={busy}
                selected={selected}
                setSelected={setSelected}
                update={update}
                undo={undo}
                redo={redo}
                canUndo={!!past.length}
                canRedo={!!future.length}
              />
            </div>
            <div data-workbench-panel="settings" hidden={!panels.settings}>
              <CalculationSettings
                project={project}
                busy={busy}
                update={update}
                calculate={() => void calculate()}
                openMaterials={() => setModal("materials")}
              />
            </div>
          </div>
          <div data-workbench-panel="spectrum" hidden={!panels.spectrum}>
            <SpectrumPanel
              details={details}
              setDetails={setDetails}
              project={project}
              spectrum={spectrum}
              stale={stale}
              busy={busy}
              update={update}
              analyze={(bands) => void analyze(bands)}
              download={download}
              onError={setError}
            />
          </div>
          <footer className="workspace-footer">
            <span>
              <ShieldCheck size={13} />
              独立数值计算 · 无人工归一化
            </span>
            <span>REF 为合成常数材料；不代表真实材料色散</span>
          </footer>
        </main>
        <div className="statusbar">
          <span>
            <span className="online-dot" />
            {busy ? "计算引擎处理中" : "TFC 工作台就绪"}
          </span>
          <span>
            无吸收相干膜层 · 无基底背面<span className="dot-separator">·</span>v
            {appVersion}
          </span>
        </div>
      </div>
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
                  void calculate(p);
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
              <MaterialLibrary project={project} update={update} />
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
