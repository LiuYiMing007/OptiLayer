import { useState, useEffect } from "react";
import {
  openingWindows,
  normalizeWindowPreferences,
  type WindowPreferences,
} from "./windowPreferences";
export default function WindowConfiguration({
  preferences,
  save,
}: {
  preferences: WindowPreferences;
  save: (p: WindowPreferences) => Promise<void>;
}) {
  const [draft, setDraft] = useState(preferences);
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  const preferencesKey = JSON.stringify(preferences);
  useEffect(() => setDraft(preferences), [preferencesKey]);
  return (
    <section className="window-configuration">
      <p>打开项目时先显示环境，完成后显示以下窗口：</p>
      <div className="opening-window-options">
        {openingWindows.map((w) => (
          <label key={w.id}>
            <input
              type="checkbox"
              checked={draft.openWindows.includes(w.id)}
              onChange={(e) => {
                setMessage("");
                setDraft((p) => ({
                  ...p,
                  openWindows: e.target.checked
                    ? [...p.openWindows, w.id]
                    : p.openWindows.filter((id) => id !== w.id),
                }));
              }}
            />
            {w.title}
          </label>
        ))}
      </div>
      <label>
        <input
          type="checkbox"
          checked={draft.rememberGeometry}
          onChange={(e) => {
            setMessage("");
            setDraft((p) => ({ ...p, rememberGeometry: e.target.checked }));
          }}
        />
        保存所有窗口的大小和位置
      </label>
      <p className="sheet-help">
        关闭光谱或工具窗口只会隐藏窗口。退出程序请使用菜单中的退出命令。
      </p>
      <button
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setMessage("");
          try {
            await save(normalizeWindowPreferences(draft));
            setMessage("配置已保存，下次打开项目时生效。");
          } catch (e) {
            setMessage(String(e));
          } finally {
            setBusy(false);
          }
        }}
      >
        保存配置
      </button>
      <p role="status">{message}</p>
    </section>
  );
}
