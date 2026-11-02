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
            {s.dirty ? "有未保存的更改" : "已保存到工作区"} ·{" "}
            {s.project.layers.length} 层 · 工作区：
            {s.workspace?.name || "未选择"}
          </p>
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
          <div className="project-list">
            {s.projects.length ? (
              s.projects.map((p) => (
                <button
                  key={p.id}
                  onClick={() => {
                    void send({ kind: "open-project", id: p.id });
                  }}
                >
                  <div>
                    <strong>{p.name}</strong>
                    <small>
                      {new Date(p.updated_at).toLocaleString("zh-CN")}
                    </small>
                  </div>
                  <span>打开 →</span>
                </button>
              ))
            ) : (
              <p>此工作区尚无已保存项目。</p>
            )}
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
