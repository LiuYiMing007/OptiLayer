import { useState } from "react";
import ToolView from "./ToolView";
import { toolDefinitions } from "./state";
import type { ToolSnapshot } from "./state";
import type { ToolIntent } from "./useToolHost";
export default function BrowserTool({
  id,
  title,
  snapshot,
  send,
  close,
  index,
}: {
  id: string;
  title: string;
  snapshot: ToolSnapshot;
  send: (a: ToolIntent) => Promise<void>;
  close: () => void;
  index: number;
}) {
  const definition = toolDefinitions.find((d) => d.id === id)!;
  const compact = [
    "layers",
    "rear",
    "environment",
    "illuminant",
    "detector",
    "groups",
    "stack",
    "materialdata",
  ].includes(id);
  const [position, setPosition] = useState({
    x: Math.min(
      40 + index * 22,
      Math.max(8, window.innerWidth - definition.width - 8),
    ),
    y: 70 + index * 22,
  });
  const [minimized, setMinimized] = useState(false);
  return (
    <section
      role="dialog"
      aria-label={title}
      className={`browser-tool tool-${id} ${minimized ? "minimized" : ""}`}
      style={{
        left: position.x,
        top: position.y,
        width: `min(${definition.width}px, calc(100vw - 50px))`,
        height: minimized
          ? 28
          : compact
            ? "auto"
            : `min(${definition.height}px, 80vh)`,
        minWidth: Math.min(definition.minWidth, 300),
        minHeight: minimized ? 28 : compact ? 0 : definition.minHeight,
        maxHeight: "85vh",
      }}
    >
      <header
        onPointerDown={(e) => {
          if ((e.target as HTMLElement).closest("button")) return;
          const start = {
            pointerX: e.clientX,
            pointerY: e.clientY,
            ...position,
          };
          const move = (event: PointerEvent) =>
            setPosition({
              x: Math.max(
                0,
                Math.min(
                  window.innerWidth - 120,
                  start.x + event.clientX - start.pointerX,
                ),
              ),
              y: Math.max(
                0,
                Math.min(
                  window.innerHeight - 40,
                  start.y + event.clientY - start.pointerY,
                ),
              ),
            });
          const stop = () => {
            window.removeEventListener("pointermove", move);
            window.removeEventListener("pointerup", stop);
          };
          window.addEventListener("pointermove", move);
          window.addEventListener("pointerup", stop);
        }}
      >
        <strong>{title}</strong>
        <span title={snapshot.project.name} />
        <button
          aria-label={`最小化${title}`}
          onClick={() => setMinimized((v) => !v)}
        >
          —
        </button>
        <button aria-label={`关闭${title}`} onClick={close}>
          ×
        </button>
      </header>
      {!minimized && (
        <ToolView
          key={snapshot.scope}
          id={id}
          snapshot={snapshot}
          send={send}
        />
      )}
    </section>
  );
}
