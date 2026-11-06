import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import ToolView from "./ToolView";
import { toolDefinitions, type ToolAction, type ToolSnapshot } from "./state";
import type { ToolIntent } from "./useToolHost";
import { readCatalogue } from "../api";
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
  useEffect(() => {
    if (
      snapshot?.project.id &&
      new URLSearchParams(location.search).has("window-ipc-check")
    )
      void invoke("window_check_ready", { projectId: snapshot.project.id });
  }, [snapshot?.project.id]);
  const catalogueCheck = useRef(false);
  useEffect(() => {
    if (
      !new URLSearchParams(location.search).has("window-ipc-check") ||
      !["materials", "substrate"].includes(id) ||
      !snapshot?.library?.length ||
      catalogueCheck.current
    )
      return;
    catalogueCheck.current = true;
    void (async () => {
      const full = await readCatalogue("TFC/SOPRA/AG");
      if (full.material.samples?.length !== 121)
        throw new Error("材料工具窗口读取不到完整 n/k");
      const edit = document.querySelector<HTMLButtonElement>(
        ".catalogue-edit-button",
      );
      if (!edit) throw new Error("材料编辑入口缺失");
      edit.click();
      const deadline = Date.now() + 10000;
      while (Date.now() < deadline) {
        if (document.querySelector('[aria-label="编辑 n/k 数据表"]')) {
          await invoke("window_check_details", {
            details: { editor: true, catalogue: true },
          });
          return;
        }
        await new Promise((r) => setTimeout(r, 100));
      }
      throw new Error("材料编辑窗口没有显示完整 n/k 数据表");
    })().catch(
      (e) =>
        void invoke("window_check_details", { details: { error: String(e) } }),
    );
  }, [id, snapshot?.library?.length]);
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
  const controlsChecked = useRef(false);
  useEffect(() => {
    if (
      !new URLSearchParams(location.search).has("window-ipc-check") ||
      !snapshot ||
      controlsChecked.current ||
      !["settings", "layers", "interactive"].includes(id)
    )
      return;
    if (
      id === "layers" &&
      snapshot.project.settings.substrate_model !== "incoherent"
    )
      return;
    controlsChecked.current = true;
    void (async () => {
      const until = async (test: () => boolean) => {
        const end = Date.now() + 10000;
        while (Date.now() < end) {
          if (test()) return;
          await new Promise((r) => setTimeout(r, 30));
        }
        throw new Error(`${id} 控件没有同步到主窗口`);
      };
      const select = async (label: string, value: string) => {
        const node = document.querySelector<
          HTMLSelectElement | HTMLInputElement
        >(`select[aria-label="${label}"], input[aria-label="${label}"]`);
        if (!node) throw new Error(`缺少 ${label}`);
        if (node instanceof HTMLInputElement) {
          node.focus();
          Object.getOwnPropertyDescriptor(
            HTMLInputElement.prototype,
            "value",
          )!.set!.call(node, value);
          node.dispatchEvent(new Event("input", { bubbles: true }));
          await new Promise((r) => setTimeout(r, 30));
          node.blur();
        } else {
          node.value = value;
          node.dispatchEvent(new Event("change", { bubbles: true }));
        }
      };
      if (id === "settings") {
        await invoke("window_check_details", {
          details: { phase: "select-model" },
        });
        await select("基底模型", "incoherent");
        await until(
          () =>
            latest.current?.project.settings.substrate_model === "incoherent",
        );
        await invoke("window_check_details", {
          details: { phase: "set-thickness" },
        });
        const thickness = document.querySelector<HTMLInputElement>(
          'input[aria-label="基底厚度"]',
        );
        if (!thickness) throw new Error("缺少基底厚度");
        thickness.focus();
        Object.getOwnPropertyDescriptor(
          HTMLInputElement.prototype,
          "value",
        )!.set!.call(thickness, "2");
        thickness.dispatchEvent(new Event("input", { bubbles: true }));
        await new Promise((r) => setTimeout(r, 30));
        thickness.blur();
        await until(
          () => latest.current?.project.settings.substrate_thickness_mm === 2,
        );
        await invoke("window_check_details", {
          details: { phase: "set-direction" },
        });
        await select("出射介质", "AIR");
        await select("第一表面", "back");
        await until(
          () =>
            latest.current?.project.settings.first_surface === "back" &&
            latest.current.project.settings.exit_material === "AIR",
        );
        await invoke("window_check_details", {
          details: { environment: true },
        });
      } else if (id === "layers") {
        const button = document.querySelector<HTMLButtonElement>(
          '[aria-label="选择背面膜层"]',
        );
        if (!button) throw new Error("缺少背面膜层入口");
        button.click();
        await until(() => latest.current?.layerSide === "back");
        const add = [
          ...document.querySelectorAll<HTMLButtonElement>(
            ".engineering-toolbar button",
          ),
        ].find((b) => b.textContent?.trim() === "添加");
        if (!add) throw new Error("缺少添加背面膜层按钮");
        add.click();
        await until(() => latest.current?.project.back_layers?.length === 1);
        await invoke("window_check_details", {
          details: { back_layers: true },
        });
      } else {
        const target = document.querySelector<HTMLSelectElement>(
          'select[aria-label="分析变量"]',
        );
        if (!target) throw new Error("缺少调膜变量选择");
        target.value = "angle";
        target.dispatchEvent(new Event("change", { bubbles: true }));
        await until(
          () =>
            !!document.querySelector(
              '.interactive-analysis[data-target-kind="angle"]',
            ) &&
            document.querySelector<HTMLInputElement>(
              '[aria-label="交互式调节新值"]',
            )?.value === String(latest.current?.project.settings.angle_deg),
        );
        const original = latest.current!.project.settings.angle_deg;
        const plus = document.querySelector<HTMLButtonElement>(
          '.digit-step[data-place="0"][data-direction="up"]',
        );
        if (!plus) throw new Error("缺少调膜增大按钮");
        plus.click();
        await until(
          () => latest.current?.project.settings.angle_deg === original + 1,
        );
        await invoke("window_check_details", {
          details: { interactive: true },
        });
      }
    })().catch(
      (e) =>
        void invoke("window_check_details", { details: { error: String(e) } }),
    );
  }, [id, snapshot]);
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
