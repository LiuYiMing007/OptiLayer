import { useEffect, useRef, useState } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type { CommandState } from "./commands";

export interface MenuSnapshot {
  project: string;
  workspace: string;
  dirty: boolean;
  busy: boolean;
  commands: Record<string, CommandState>;
}
export function useDesktopMenus(
  snapshot: MenuSnapshot,
  dispatch: (id: string) => void,
  onError: (text: string) => void,
) {
  const latest = useRef({ snapshot, dispatch, onError });
  latest.current = { snapshot, dispatch, onError };
  const publish = useRef<(() => void) | null>(null);
  const [platform, setPlatform] = useState(isTauri() ? "desktop" : "browser");
  useEffect(() => {
    if (!isTauri()) return;
    let disposed = false;
    let unlisten: (() => void) | undefined;
    let sending = false,
      pending = false;
    const sync = async () => {
      pending = true;
      if (sending || disposed) return;
      sending = true;
      try {
        while (pending && !disposed) {
          pending = false;
          await invoke("menu_sync", { snapshot: latest.current.snapshot });
        }
      } catch (error) {
        if (!disposed)
          latest.current.onError(`菜单状态同步失败：${String(error)}`);
      } finally {
        sending = false;
      }
    };
    void (async () => {
      const off = await getCurrentWindow().listen<string>("menu-command", (e) =>
        latest.current.dispatch(e.payload),
      );
      if (disposed) {
        off();
        return;
      }
      unlisten = off;
      const name = await invoke<string>("menu_platform");
      if (disposed) return;
      setPlatform(name);
      publish.current = () => void sync();
      void sync();
    })().catch((error) => {
      if (!disposed) latest.current.onError(String(error));
    });
    return () => {
      disposed = true;
      unlisten?.();
      publish.current = null;
    };
  }, []);
  useEffect(() => {
    publish.current?.();
  }, [snapshot]);
  return platform;
}
