import InteractiveAnalysis from "../InteractiveAnalysis";
import { useEffect, useRef, useState } from "react";
import TextInput from "../TextInput";
import LayerEditor from "../LayerEditor";
import CalculationSettings from "../CalculationSettings";
import MaterialLibrary from "../MaterialLibrary";
import SpectrumPanel from "../SpectrumPanel";
import { hasNonFinite, patchesBetween, type ToolSnapshot } from "./state";
import type { ToolIntent } from "./useToolHost";
import type { Project } from "../types";

export default function ToolView({
  id,
  snapshot: s,
  send: dispatch,
}: {
  id: string;
  snapshot: ToolSnapshot;
  send: (action: ToolIntent) => Promise<void>;
}) {
  const root = useRef<HTMLFieldSetElement>(null);
  useEffect(() => {
    if (s.focus?.id === id && s.focus.label) {
      const target = root.current?.querySelector<HTMLElement>(
        `[aria-label="${s.focus.label}"]`,
      );
      // Grid focus also establishes its keyboard selection, as a pointer click does.
      if (id === "layers") target?.click();
      target?.focus();
    }
  }, [s.focus?.token, id]);
  const importInfo = s.project.import_info;
  const showImportInfo =
    importInfo &&
    typeof importInfo.file_name === "string" &&
    typeof importInfo.encoding === "string" &&
    Array.isArray(importInfo.notes) &&
    importInfo.notes.every((n) => typeof n === "string") &&
    Array.isArray(importInfo.materials) &&
    importInfo.materials.every(
      (m) =>
        m &&
        [m.role, m.original, m.resolved].every((v) => typeof v === "string"),
    );
  const [projectSearch, setProjectSearch] = useState("");
  const [projectPage, setProjectPage] = useState(0);
  useEffect(() => setProjectPage(0), [projectSearch, s.workspace?.id]);
  const projectMatches = s.projects.filter((p) =>
    projectSearch
      .trim()
      .toLocaleLowerCase()
      .split(/\s+/)
      .every((term) => p.name.toLocaleLowerCase().includes(term)),
  );
  const projectPages = Math.max(1, Math.ceil(projectMatches.length / 50));
  const visibleProjectPage = Math.min(projectPage, projectPages - 1);
  const [copyName, setCopyName] = useState(""),
    [error, setError] = useState("");
  function send(action: ToolIntent) {
    setError("");
    const result = dispatch(action);
    void result.catch((e) => setError(String(e)));
    return result;
  }
  function update(mutator: (p: Project) => void) {
    const next = structuredClone(s.project);
    mutator(next);
    const patches = patchesBetween(s.project, next);
    if (patches.some((p) => hasNonFinite(p.value))) return;
    if (patches.length) void send({ kind: "patch", patches });
  }
  const command = (id: string) => {
    void send({ kind: "command", id });
  };
  return (
    <fieldset className="tool-content" ref={root} disabled={s.busy}>
      {(error || s.error) && (
        <p role="alert" className="inline-error">
          {error || s.error}
        </p>
      )}
      {s.notice && (
        <p className="tool-notice" role="status">
          {s.notice}
        </p>
      )}
      {id === "interactive" && (
        <InteractiveAnalysis snapshot={s} send={dispatch} />
      )}
      {id === "layers" && (
        <LayerEditor
          project={s.project}
          busy={s.busy}
          selected={s.selected}
          setSelected={(index) => {
            const layer = s.project.layers[index];
            if (layer) void send({ kind: "select", layerId: layer.id });
          }}
          update={update}
          command={(command, index = s.selected) => {
            void send({
              kind: "layer",
              command,
              layerId: s.project.layers[index]?.id,
            });
          }}
          undo={() => command("edit.undo")}
          redo={() => command("edit.redo")}
          canUndo={s.canUndo}
          canRedo={s.canRedo}
        />
      )}
      {(id === "materials" || id === "substrate") && (
        <MaterialLibrary
          project={s.project}
          update={update}
          library={s.library || []}
          substrate={id === "substrate"}
          onImport={(name, substrate) =>
            send({ kind: "catalogue-import", name, substrate })
          }
          onMaterialSave={(material, replaces, expected) =>
            send({
              kind: "material-save",
              material,
              replaces,
              expected,
              substrate: id === "substrate",
            })
          }
          onEditing={(active) =>
            send({
              kind: "material-editing",
              active,
              tool: id as "materials" | "substrate",
            })
          }
          openFolder={() => send({ kind: "materials-folder" })}
          onSaveLibrary={() => send({ kind: "library-save" })}
        />
      )}
      {id === "settings" && (
        <CalculationSettings
          project={s.project}
          busy={s.busy}
          update={update}
          calculate={() => command("calculate.spectrum")}
          openMaterials={() => command("tools.materials")}
        />
      )}
      {id === "project" && (
        <div className="project-tool">
          <label>
            项目名称
            <TextInput
              aria-label="项目名称"
              value={s.project.name}
              maxLength={200}
              onChange={(value) =>
                update((p) => {
                  p.name = value;
                })
              }
            />
          </label>
          <p>
            {s.dirty
              ? "有未保存的更改"
              : s.persisted
                ? "已保存到工作区"
                : "新项目，尚未写入工作区"}{" "}
            · {s.project.layers.length} 层 · 工作区：
            {s.workspace?.name || "未选择"}
          </p>
          {showImportInfo && s.project.import_info && (
            <details className="tfd-import-record">
              <summary>
                原始 TFCalc 导入记录 · {s.project.import_info.file_name}
              </summary>
              <p>
                编码：{s.project.import_info.encoding} ·{" "}
                {s.project.layers.length} 层
              </p>
              {s.project.import_info.notes.map((note, i) => (
                <p key={i}>{note}</p>
              ))}
              <table>
                <thead>
                  <tr>
                    <th>用途</th>
                    <th>原始名称</th>
                    <th>采用的材料快照</th>
                  </tr>
                </thead>
                <tbody>
                  {s.project.import_info.materials.map((m, i) => (
                    <tr key={i}>
                      <td>{m.role}</td>
                      <td>{m.original}</td>
                      <td>{m.resolved}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </details>
          )}
          <div className="project-tool-actions">
            <button
              className="button secondary"
              onClick={() => command("file.new")}
            >
              新建项目
            </button>
            <button
              className="button primary"
              onClick={() => command("file.save")}
            >
              保存
            </button>
            <button
              className="button secondary"
              onClick={() => command("file.import")}
            >
              导入
            </button>
            <button
              className="button secondary"
              onClick={() => command("file.export")}
            >
              导出
            </button>
          </div>
          <div className="save-copy">
            <input
              aria-label="另存为名称"
              placeholder="另存为项目名称"
              value={copyName}
              onChange={(e) => setCopyName(e.target.value)}
            />
            <button
              className="button secondary"
              disabled={!copyName.trim() || !s.workspace}
              onClick={() => {
                void send({ kind: "save-copy", name: copyName.trim() }).then(
                  () => setCopyName(""),
                  () => {},
                );
              }}
            >
              另存为
            </button>
          </div>
          <div className="panel-heading">
            <h2>已保存的项目</h2>
            <button
              onClick={() => {
                void send({ kind: "projects-refresh" });
              }}
            >
              刷新
            </button>
          </div>
          <input
            aria-label="搜索膜系项目"
            placeholder="搜索项目名称或原文件夹…"
            value={projectSearch}
            onChange={(e) => setProjectSearch(e.target.value)}
          />
          <div className="project-list">
            {projectMatches.length ? (
              projectMatches
                .slice(visibleProjectPage * 50, (visibleProjectPage + 1) * 50)
                .map((p) => (
                  <button
                    key={p.id}
                    onClick={() => {
                      void send({ kind: "open-project", id: p.id });
                    }}
                  >
                    <div>
                      <strong>{p.name}</strong>
                      {p.relative_path && <small>{p.relative_path}</small>}
                      <small>
                        {new Date(p.updated_at).toLocaleString("zh-CN")}
                      </small>
                    </div>
                    <span>打开 →</span>
                  </button>
                ))
            ) : (
              <p>
                {s.projects.length
                  ? "没有匹配的项目。"
                  : "此工作区尚无已保存项目。"}
              </p>
            )}
          </div>
          <div className="project-pagination">
            <span>
              {projectMatches.length} 个项目 · {visibleProjectPage + 1}/
              {projectPages} 页
            </span>
            <button
              disabled={visibleProjectPage === 0}
              onClick={() => setProjectPage(visibleProjectPage - 1)}
            >
              上一页
            </button>
            <button
              disabled={visibleProjectPage + 1 >= projectPages}
              onClick={() => setProjectPage(visibleProjectPage + 1)}
            >
              下一页
            </button>
          </div>
          <button
            className="text-button"
            onClick={() => command("file.workspace")}
          >
            工作区位置与迁入…
          </button>
        </div>
      )}
      {(id === "analysis" || id === "targets") && (
        <SpectrumPanel
          mode={id === "analysis" ? "analysis" : "targets"}
          project={s.project}
          spectrum={s.spectrum || null}
          stale={s.stale}
          busy={s.busy}
          update={update}
          analyze={() => {
            void send({ kind: "analyze" });
          }}
          download={(name, content, type) =>
            send({ kind: "export", name, content, type })
          }
          onError={setError}
          details={true}
          setDetails={() => {}}
          openAnalysis={() => {}}
          openTargets={() => {}}
        />
      )}
    </fieldset>
  );
}
