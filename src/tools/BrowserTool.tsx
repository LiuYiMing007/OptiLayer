import { useEffect, useRef, useState } from "react";
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
  const root = useRef<HTMLElement>(null);
  const remembered = useRef<{
    x?: number;
    y?: number;
    width?: number;
    height?: number;
  }>({});
  const [layoutLoaded] = useState(() => {
    if (snapshot.windowPreferences?.rememberGeometry) {
      try {
        remembered.current = JSON.parse(
          localStorage.getItem("tfc-tool-rect-" + id) || "{}",
        );
      } catch {
        /* Invalid local layout uses defaults. */
      }
    }
    return true;
  });
  void layoutLoaded;
  const [position, setPosition] = useState({
    x: Math.min(
      remembered.current.x ?? 40 + index * 22,
      Math.max(8, window.innerWidth - definition.width - 8),
    ),
    y: Math.max(
      0,
      Math.min(
        remembered.current.y ?? 70 + index * 22,
        window.innerHeight - 40,
      ),
    ),
  });
  const [minimized, setMinimized] = useState(false);
  useEffect(() => {
    if (!snapshot.windowPreferences?.rememberGeometry || minimized) return;
    const element = root.current;
    if (!element) return;
    const save = () => {
      const r = element.getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0) return;
      localStorage.setItem(
        "tfc-tool-rect-" + id,
        JSON.stringify({
          x: position.x,
          y: position.y,
          width: r.width,
          height: r.height,
        }),
      );
    };
    const observer = new ResizeObserver(save);
    observer.observe(element);
    save();
    return () => observer.disconnect();
  }, [
    id,
    position.x,
    position.y,
    snapshot.windowPreferences?.rememberGeometry,
    minimized,
  ]);
  return (
    <section
      ref={root}
      role="dialog"
      aria-label={title}
      className={`browser-tool tool-${id} ${minimized ? "minimized" : ""}`}
      style={{
        left: position.x,
        top: position.y,
        width: `min(${remembered.current.width || definition.width}px, calc(100vw - 50px))`,
        height: minimized
          ? 28
          : remembered.current.height
            ? Math.max(definition.minHeight, remembered.current.height)
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
      <div style={{ display: minimized ? "none" : "contents" }}>
        <ToolView
          key={snapshot.scope}
          id={id}
          snapshot={snapshot}
          send={send}
        />
      </div>
    </section>
  );
}
