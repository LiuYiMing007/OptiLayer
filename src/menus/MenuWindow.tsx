import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type { MenuSnapshot } from "./useDesktopMenus";

// This window never mounts App and never requests the optical engine.
export default function MenuWindow() {
  const [snapshot, setSnapshot] = useState<MenuSnapshot | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let disposed = false;
    let received = false;
    let off: (() => void) | undefined;
    void (async () => {
      const stop = await getCurrentWindow().listen<MenuSnapshot>(
        "menu-state",
        (event) => {
          received = true;
          setSnapshot(event.payload);
        },
      );
      if (disposed) {
        stop();
        return;
      }
      off = stop;
      const initial = await invoke<MenuSnapshot | null>("menu_snapshot");
      if (!disposed && !received) setSnapshot(initial);
    })().catch((e) => {
      if (!disposed) setError(String(e));
    });
    return () => {
      disposed = true;
      off?.();
    };
  }, []);
  return (
    <div className="menu-window-content">
      <strong>
        {snapshot?.project || "OptiLayer"}
        {snapshot?.dirty ? " · 未保存" : ""}
      </strong>
      <span>
        {error ||
          (snapshot?.busy
            ? "正在处理…"
            : snapshot
              ? `工作区：${snapshot.workspace}`
              : "等待工作台就绪…")}
      </span>
      <small>关闭此窗口仅收起菜单；可在主工作台重新显示。</small>
    </div>
  );
}
