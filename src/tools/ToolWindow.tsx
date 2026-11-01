import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import ToolView from "./ToolView";
import { toolDefinitions, type ToolAction, type ToolSnapshot } from "./state";
import type { ToolIntent } from "./useToolHost";
import { shortcutCommand } from "../menus/commands";

export default function ToolWindow() {
  const id = getCurrentWindow().label.slice(5);
  const definition = toolDefinitions.find((d) => d.id === id)!;
  const [snapshot, setSnapshot] = useState<ToolSnapshot | null>(null),
    [error, setError] = useState("");
  useEffect(() => {
    if (error && document.activeElement instanceof HTMLInputElement)
      document.activeElement.blur();
  }, [error]);
  const latest = useRef<ToolSnapshot | null>(null);
  const waiting = useRef(
    new Map<string, { resolve: () => void; reject: (e: unknown) => void }>(),
  );
  const tail = useRef(Promise.resolve());
  const accept = (s: ToolSnapshot | null) => {
    if (s && (!latest.current || s.sequence >= latest.current.sequence)) {
      latest.current = s;
      setSnapshot(s);
    }
  };
  function send(intent: ToolIntent): Promise<void> {
    if (!latest.current) return Promise.reject(new Error("主工作台尚未就绪"));
    const action = {
      ...intent,
      scope: latest.current.scope,
      requestId: crypto.randomUUID(),
    } as ToolAction;
    const result = tail.current
      .catch(() => {})
      .then(
        () =>
          new Promise<void>((resolve, reject) => {
            waiting.current.set(action.requestId, { resolve, reject });
            void invoke("tool_submit", { action }).catch((e) => {
              waiting.current.delete(action.requestId);
              reject(e);
            });
          }),
      );
    tail.current = result;
    void result.catch((e) => setError(String(e)));
    return result;
  }
  const sendRef = useRef(send);
  sendRef.current = send;
  useEffect(() => {
    let disposed = false;
    const off: (() => void)[] = [];
    void (async () => {
      const window = getCurrentWindow();
      for (const [event, callback] of [
        ["tool-state", (e: { payload: ToolSnapshot }) => accept(e.payload)],
        [
          "tool-feedback",
          (e: {
            payload: {
              requestId: string;
              error: string | null;
              snapshot: ToolSnapshot | null;
            };
          }) => {
            accept(e.payload.snapshot);
            const pending = waiting.current.get(e.payload.requestId);
            waiting.current.delete(e.payload.requestId);
            if (e.payload.error) pending?.reject(new Error(e.payload.error));
            else {
              setError("");
              pending?.resolve();
            }
          },
        ],
      ] as const) {
        const stop = await window.listen(
          event,
          callback as (event: { payload: unknown }) => void,
        );
        if (disposed) {
          stop();
          return;
        }
        off.push(stop);
      }
      const initial = await invoke<ToolSnapshot | null>("tool_snapshot");
      if (!disposed) accept(initial);
    })().catch((e) => {
      if (!disposed) setError(String(e));
    });
    const keyboard = (e: KeyboardEvent) => {
      if (navigator.platform.includes("Mac")) return;
      const t = e.target as HTMLElement;
      const command = shortcutCommand(
        e,
        false,
        t.matches("input,textarea,select") || t.isContentEditable,
      );
      if (command) {
        e.preventDefault();
        void sendRef.current({ kind: "command", id: command }).catch(() => {});
      }
    };
    window.addEventListener("keydown", keyboard);
    return () => {
      disposed = true;
      off.forEach((fn) => fn());
      window.removeEventListener("keydown", keyboard);
      waiting.current.forEach((v) => v.reject(new Error("工具窗口已关闭")));
      waiting.current.clear();
    };
  }, []);
  return (
    <div className={`tool-shell tool-${id}`}>
      <header className="tool-context">
        <strong>{definition.title}</strong>
        <span>
          {snapshot?.project.name || "等待主工作台…"}
          {snapshot?.dirty ? " · 未保存" : ""}
        </span>
        <small>
          {snapshot?.calculating ? "光谱自动更新中…" : "编辑即时联动主光谱"}
        </small>
      </header>
      {error && (
        <div className="notice error" role="alert">
          {error}
          <button onClick={() => setError("")}>关闭提示</button>
        </div>
      )}
      {snapshot ? (
        <ToolView
          key={snapshot.scope}
          id={id}
          snapshot={snapshot}
          send={send}
        />
      ) : (
        <p className="tool-wait">正在连接主工作台…</p>
      )}
    </div>
  );
}
