import { useEffect, useState } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { FolderOpen, Plus, RefreshCw } from "lucide-react";
import { request } from "./api";
import type { WorkspaceInfo } from "./types";
export default function WorkspacePanel({
  workspace,
  error,
  beforeChange,
  onChanged,
}: {
  workspace: WorkspaceInfo | null;
  error: string;
  beforeChange: () => Promise<boolean>;
  onChanged: (w: WorkspaceInfo) => void;
}) {
  const [busy, setBusy] = useState(false),
    [failure, setFailure] = useState(error);
  useEffect(() => setFailure(error), [error]);
  async function pickProject() {
    if (!(await beforeChange())) return;
    setBusy(true);
    setFailure("");
    try {
      const result = await request<{ workspace: WorkspaceInfo } | null>({
        action: "project_pick",
      });
      if (result) onChanged(result.workspace);
    } catch (e) {
      setFailure(String(e));
    } finally {
      setBusy(false);
    }
  }
  async function pick(create: boolean, copy = false) {
    if (!(await beforeChange())) return;
    setBusy(true);
    setFailure("");
    try {
      const result = await request<{ workspace: WorkspaceInfo } | null>({
        action: copy ? "workspace_copy" : "workspace_pick",
        create,
      });
      if (result) onChanged(result.workspace);
    } catch (e) {
      setFailure(String(e));
    } finally {
      setBusy(false);
    }
  }
  async function refresh() {
    setFailure("");
    setBusy(true);
    try {
      const r = await request<{ workspace: WorkspaceInfo }>({
        action: "workspace_info",
      });
      onChanged(r.workspace);
    } catch (e) {
      setFailure(String(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="workspace-panel">
      <p>
        默认工作区位于程序所属的项目文件夹内。Mac 和 Windows 使用同一个
        Workspace；搬走整个项目文件夹后，程序会按相对位置自动找到数据。
      </p>
      {(failure || error) && (
        <div className="inline-error" role="alert">
          {failure || error}
        </div>
      )}
      {workspace && (
        <div className="workspace-location">
          <strong>{workspace.name}</strong>
          {workspace.project_root && (
            <small>项目文件夹：{workspace.project_root}</small>
          )}
          <code>{workspace.root}</code>
          {workspace.relative_path && (
            <small>项目内相对位置：{workspace.relative_path}</small>
          )}
          <small>
            Workspace v{workspace.schema_version} · UTF-8 / JSON / SQLite
          </small>
        </div>
      )}
      <div className="workspace-buttons">
        <button
          className="button primary"
          disabled={busy || !isTauri()}
          onClick={() => void pickProject()}
        >
          选择便携项目位置…
        </button>
        <button
          className="button primary"
          disabled={busy || !isTauri()}
          onClick={() => void pick(false)}
        >
          <FolderOpen size={15} />
          打开项目内工作区
        </button>
        <button
          className="button secondary"
          disabled={busy || !isTauri()}
          onClick={() => void pick(true)}
        >
          <Plus size={15} />
          新建项目内工作区
        </button>
        <button
          className="button secondary"
          disabled={busy}
          onClick={() => void refresh()}
        >
          <RefreshCw size={14} />
          重新连接
        </button>
        <button
          className="button secondary"
          disabled={busy || !isTauri()}
          onClick={() => void pick(false, true)}
        >
          <FolderOpen size={14} />
          迁入旧工作区（复制）
        </button>
      </div>
      <p className="workspace-recovery-help">
        若从 Mac“应用程序”、下载隔离位置或只读目录启动，请选择固态盘上的 TFC
        项目文件夹，也可以直接选择已有
        Workspace。数据仍保存在所选项目内，不会转移到系统磁盘。隔离启动无法可靠辨认原程序位置时，每次启动需明确选择；不会自动连接其它安装或测试目录。
      </p>
      {workspace && (
        <section className="workspace-data-map" aria-label="数据文件位置">
          <h3>数据文件位置</h3>
          {(
            [
              ["root", "工作区", ""],
              ["projects", "膜系项目", workspace.directories.projects],
              ["materials", "材料与基底", workspace.directories.materials],
              ["spectra", "保存的光谱", workspace.directories.spectra],
              ["exports", "导出文件", workspace.directories.exports],
              ["database", "项目数据库", workspace.directories.database],
              ["imports", "导入与原件归档", workspace.directories.imports],
              ["config", "工作区配置", workspace.directories.config],
            ] as const
          ).map(([section, label, path]) => (
            <div key={section}>
              <span>{label}</span>
              <code>
                {workspace.root}
                {path ? "/" + path : ""}
              </code>
              <button
                disabled={busy || !isTauri()}
                onClick={() =>
                  void request({ action: "workspace_reveal", section }).catch(
                    (e) => setFailure(String(e)),
                  )
                }
              >
                打开
              </button>
            </div>
          ))}
          <p>
            材料与基底共用材料库：catalogue 保存原始目录，custom
            保存编辑副本。新膜系需要点“保存”才会生成项目文件。
          </p>
        </section>
      )}
      {!isTauri() && (
        <p className="small-label">
          当前为 localhost
          预览，工作区由服务启动参数指定；浏览器没有直接操作任意本地目录的能力。
        </p>
      )}
      <div className="workspace-layout">
        workspace.json
        <br />
        projects/ · materials/ · spectra/
        <br />
        database/ · imports/ · exports/ · config/
      </div>
      <p>
        SQLite 是主存储，projects / materials 中的 JSON
        是恢复副本。保存项目时会一并保留与当前输入一致的光谱；普通文件导出默认放在
        exports。
      </p>
      <p className="small-label">
        跨电脑使用前关闭应用并安全弹出磁盘；当前没有多电脑同步或冲突合并功能。不要通过两台电脑同时写入同一数据库。0.1.3
        的本机旧数据可通过“迁入旧工作区”复制进项目，原件保留；不再自动使用其它电脑的旧位置。
      </p>
    </div>
  );
}
