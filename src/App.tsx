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
import feedbackFixture from "../fixtures/user-feedback/380nm-project.json";
import type {
  AnalysisBands,
  Project,
  SavedProject,
  Spectrum,
  SpectrumAnalysis,
  WorkspaceInfo,
} from "./types";

type Modal = "projects" | "materials" | "about" | "workspace" | null;
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
  const current = useRef(project);
  current.current = project;
  const resultRef = useRef(spectrum);
  resultRef.current = spectrum;
  const working = useRef(false),
    importRef = useRef<HTMLInputElement>(null);
  const dirty = JSON.stringify(project) !== savedKey;
  const stale = !!spectrum && physicalSignature(project) !== resultKey;
  function update(mutator: (p: Project) => void) {
    const next = clone(current.current);
    mutator(next);
    setPast((p) => [...p.slice(-49), clone(current.current)]);
    setFuture([]);
    setProject(next);
  }
  function undo() {
    if (!past.length || busy) return;
    setFuture((f) => [clone(project), ...f]);
    setProject(past.at(-1)!);
    setPast((p) => p.slice(0, -1));
  }
  function redo() {
    if (!future.length || busy) return;
    setPast((p) => [...p, clone(project)]);
    setProject(future[0]);
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
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        void save();
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
  }, [savedKey]);
  useEffect(() => {
    if (!isTauri()) return;
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void getCurrentWindow()
      .onCloseRequested(async (event) => {
        if (JSON.stringify(current.current) === savedKey) return;
        event.preventDefault();
        if (
          await new Promise<boolean>((resolve) =>
            setConfirmation(() => resolve),
          )
        )
          await getCurrentWindow().destroy();
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
    return (
      !dirty ||
      (await new Promise<boolean>((resolve) => setConfirmation(() => resolve)))
    );
  }
  function replace(p: Project, saved = false) {
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
  async function importFile(file: File) {
    if (file.size > 2_000_000) {
      setError("文件不能超过 2 MB");
      return;
    }
    if (!(await canReplace())) return;
    await run(async () => {
      const text = await file.text();
      const r = file.name.toLowerCase().endsWith(".tfd")
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
    });
  }
  return (
    <div className="app-shell">
      <aside className="sidebar">
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
            使用说明<span>v0.1.2</span>
          </button>
        </div>
      </aside>
      <div className="workspace">
        <header className="topbar">
          <div className="breadcrumb">
            工作空间<span>/</span>
            <span>膜系设计</span>
          </div>
          <div className="topbar-right">
            <button
              className="workspace-switch"
              disabled={busy}
              onClick={() => setModal("workspace")}
            >
              <FolderOpen size={14} />
              {workspace?.name || "选择工作区"}
            </button>
            <span className="version-badge">V0.1.2 · 离线工作区</span>
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
                onClick={async () => {
                  if (await canReplace()) {
                    const p = referenceProject();
                    p.name = "未命名膜系";
                    p.layers = [];
                    replace(p);
                  }
                }}
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
                保存项目<span className="shortcut">⌘ S</span>
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
                onClick={() => importRef.current?.click()}
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
          <div className="editor-grid">
            <LayerEditor
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
            <CalculationSettings
              project={project}
              busy={busy}
              update={update}
              calculate={() => void calculate()}
              openMaterials={() => setModal("materials")}
            />
          </div>
          <SpectrumPanel
            project={project}
            spectrum={spectrum}
            stale={stale}
            busy={busy}
            update={update}
            analyze={(bands) => void analyze(bands)}
            download={download}
            onError={setError}
          />
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
            无吸收相干膜层 · 无基底背面<span className="dot-separator">·</span>
            v0.1.2
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
            {modal === "about" && (
              <div className="about-content">
                <div className="about-logo">
                  <Waves size={32} />
                </div>
                <h3>
                  TFC <span>0.1.2</span>
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
