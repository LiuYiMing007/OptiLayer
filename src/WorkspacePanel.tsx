import { useState } from "react";
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
  async function pick(create: boolean) {
    if (!(await beforeChange())) return;
    setBusy(true);
    setFailure("");
    try {
      const result = await request<{ workspace: WorkspaceInfo } | null>({
        action: "workspace_pick",
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
        项目、材料、已保存光谱和配置集中在一个可迁移的目录中。将整个目录搬到移动
        SSD 后，在另一台电脑选择「打开工作区」即可继续使用同一套数据。
      </p>
      {(failure || error) && (
        <div className="inline-error" role="alert">
          {failure || error}
        </div>
      )}
      {workspace && (
        <div className="workspace-location">
          <strong>{workspace.name}</strong>
          <code>{workspace.root}</code>
          <small>
            Workspace v{workspace.schema_version} · UTF-8 / JSON / SQLite
          </small>
        </div>
      )}
      <div className="workspace-buttons">
        <button
          className="button primary"
          disabled={busy || !isTauri()}
          onClick={() => void pick(false)}
        >
          <FolderOpen size={15} />
          打开工作区
        </button>
        <button
          className="button secondary"
          disabled={busy || !isTauri()}
          onClick={() => void pick(true)}
        >
          <Plus size={15} />
          新建工作区
        </button>
        <button
          className="button secondary"
          disabled={busy}
          onClick={() => void refresh()}
        >
          <RefreshCw size={14} />
          重新连接
        </button>
      </div>
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
        跨电脑使用前关闭应用并安全弹出磁盘；当前没有多电脑同步或冲突合并功能。不要通过两台电脑同时写入同一数据库。首次升级会将旧数据库复制到默认工作区，旧数据仍保留。
      </p>
    </div>
  );
}
