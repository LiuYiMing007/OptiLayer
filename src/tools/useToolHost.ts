import { flushSync } from "react-dom";
import { useEffect, useRef, useState } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type { ToolAction, ToolId, ToolSnapshot } from "./state";
export type ToolIntent = ToolAction extends infer A
  ? A extends ToolAction
    ? Omit<A, "scope" | "requestId">
    : never
  : never;
export function useToolHost(
  snapshot: ToolSnapshot,
  action: (source: string, action: ToolAction) => Promise<void>,
  onError: (e: string) => void,
) {
  const latest = useRef({ snapshot, action, onError });
  latest.current = { snapshot, action, onError };
  const [opened, setOpened] = useState<Record<string, boolean>>({});
  const [visible, setVisible] = useState<Record<string, boolean>>({});
  const publish = useRef<(() => Promise<void>) | null>(null);
  useEffect(() => {
    if (!isTauri()) return;
    let disposed = false;
    const off: (() => void)[] = [];
    let active: Promise<void> | null = null,
      pending = false;
    const sync = (): Promise<void> => {
      pending = true;
      if (active) return active;
      active = (async () => {
        try {
          while (pending && !disposed) {
            pending = false;
            await invoke("tool_publish", { snapshot: latest.current.snapshot });
          }
        } finally {
          active = null;
        }
      })();
      return active;
    };
    void (async () => {
      const main = getCurrentWindow();
      const stop = await main.listen<{ source: string; action: ToolAction }>(
        "tool-action",
        (event) => {
          const { source, action } = event.payload;
          void (async () => {
            let error: string | null = null;
            try {
              await latest.current.action(source, action);
            } catch (e) {
              error = String(e);
            }
            // No animation-frame dependency: minimized main windows must still ACK.
            flushSync(() => {});
            await sync();
            await invoke("tool_reply", {
              target: source,
              requestId: action.requestId,
              error,
            });
          })().catch((e) => latest.current.onError(String(e)));
        },
      );
      if (disposed) {
        stop();
        return;
      }
      off.push(stop);
      const stopVisibility = await main.listen<Record<string, boolean>>(
        "tools-visibility",
        (e) => setVisible(e.payload),
      );
      if (disposed) {
        stopVisibility();
        return;
      }
      off.push(stopVisibility);
      const v = await invoke<Record<string, boolean>>("tool_visibility");
      if (disposed) return;
      setVisible(v);
      publish.current = sync;
      await sync();
    })().catch((e) => {
      if (!disposed) latest.current.onError(String(e));
    });
    return () => {
      disposed = true;
      off.forEach((fn) => fn());
      publish.current = null;
    };
  }, []);
  useEffect(() => {
    void publish.current?.().catch((e) => latest.current.onError(String(e)));
  }, [snapshot]);
  async function show(id: ToolId) {
    if (isTauri()) await invoke("tool_open", { id });
    else {
      setOpened((v) => ({ ...v, [id]: true }));
      setVisible((v) => ({ ...v, [id]: true }));
    }
  }
  async function hide(id: ToolId) {
    if (isTauri()) await invoke("tool_hide", { id });
    else setVisible((v) => ({ ...v, [id]: false }));
  }
  async function hideAll() {
    if (isTauri()) await invoke("tool_hide_all");
    else
      setVisible((v) =>
        Object.fromEntries(
          Object.entries(v).map(([id, value]) => [
            id,
            id === "remember" ? value : false,
          ]),
        ),
      );
  }
  async function spectrum(visible: boolean) {
    if (isTauri()) await invoke("tool_spectrum", { visible });
    else setVisible((v) => ({ ...v, spectrum: visible }));
  }
  async function remember(enabled: boolean) {
    if (isTauri()) await invoke("tool_remember", { enabled });
    else setVisible((v) => ({ ...v, remember: enabled }));
  }
  return { visible, opened, show, hide, hideAll, remember, spectrum };
}
