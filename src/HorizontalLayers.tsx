import { useRef, useState } from "react";
import { gridValue } from "./layerGrid";
import { pasteHorizontal } from "./horizontalGrid";
import { materialLabel } from "./materials";
import type { Project } from "./types";
import type { LayerCommand } from "./layerCommands";
export default function HorizontalLayers({
  project: p,
  update,
  command,
  undo,
  redo,
  onSelect,
}: {
  project: Project;
  onSelect: (index: number) => void;
  update: (f: (p: Project) => void) => void;
  command: (id: LayerCommand, index: number) => void;
  undo: () => void;
  redo: () => void;
}) {
  const [cell, setCell] = useState({ row: 1, col: 0 }),
    [anchor, setAnchor] = useState(cell),
    [draft, setDraft] = useState<string | null>(null),
    [error, setError] = useState("");
  const root = useRef<HTMLDivElement>(null),
    editing = useRef(false),
    original = useRef("");
  const count = p.layers.length;
  const value = (row: number, col: number) =>
    gridValue(p, { row: count - 1 - col, col: row });
  const select = (row: number, col: number, extend = false) => {
    const next = {
      row: Math.max(0, Math.min(4, row)),
      col: Math.max(0, Math.min(count - 1, col)),
    };
    setCell(next);
    if (count) onSelect(next.col);
    if (!extend) setAnchor(next);
    queueMicrotask(() =>
      root.current
        ?.querySelector<HTMLElement>(
          `[data-sheet-row="${next.row}"][data-sheet-col="${next.col}"]`,
        )
        ?.focus(),
    );
  };
  const finish = (commit = true) => {
    if (!editing.current) return true;
    if (commit && draft !== null && draft !== original.current) {
      try {
        const next = pasteHorizontal(p, cell.row, cell.col, draft);
        update((p) => {
          p.layers = next.layers;
        });
        setError("");
      } catch (e) {
        setError(String(e));
        return false;
      }
    }
    editing.current = false;
    setDraft(null);
    return true;
  };
  const start = (row: number, col: number, initial?: string) => {
    setCell({ row, col });
    onSelect(col);
    setAnchor({ row, col });
    original.current = value(row, col);
    setDraft(initial ?? original.current);
    editing.current = true;
  };
  const move = (key: string, shift: boolean) => {
    let { row, col } = cell;
    if (key === "Tab") {
      col += shift ? -1 : 1;
      if (col >= count) {
        col = 0;
        row++;
      }
      if (col < 0) {
        col = count - 1;
        row--;
      }
    }
    if (key === "Enter" || key === "ArrowDown")
      row += shift && key === "Enter" ? -1 : 1;
    if (key === "ArrowUp") row--;
    if (key === "ArrowLeft") col--;
    if (key === "ArrowRight") col++;
    select(row, col, shift && key.startsWith("Arrow"));
  };
  return (
    <section className="compact-tool">
      <div className="sheet-toolbar">
        {(["add", "copy", "delete", "up", "down"] as const).map((id, i) => (
          <button
            key={id}
            disabled={id !== "add" && !count}
            onClick={() => {
              if (finish())
                command(`layer.${id}`, Math.min(cell.col, count - 1));
            }}
          >
            {["添加", "复制", "删除", "向外移", "向基底移"][i]}
          </button>
        ))}
        <span>λ₀ {p.settings.reference_nm} nm · 基底 → 外侧</span>
      </div>
      {error && <p role="alert">{error}</p>}
      <div
        className="sheet-scroll"
        ref={root}
        onCopy={(e) => {
          if (editing.current) return;
          const text = Array.from(
            { length: Math.abs(anchor.row - cell.row) + 1 },
            (_, r) =>
              Array.from(
                { length: Math.abs(anchor.col - cell.col) + 1 },
                (_, c) =>
                  value(
                    Math.min(cell.row, anchor.row) + r,
                    Math.min(cell.col, anchor.col) + c,
                  ),
              ).join("\t"),
          ).join("\n");
          e.preventDefault();
          e.clipboardData.setData("text/plain", text);
        }}
        onPaste={(e) => {
          if (editing.current) return;
          e.preventDefault();
          try {
            const next = pasteHorizontal(
              p,
              cell.row,
              cell.col,
              e.clipboardData.getData("text/plain"),
            );
            update((p) => {
              p.layers = next.layers;
            });
            setError("");
          } catch (e) {
            setError(String(e));
          }
        }}
      >
        <table
          className="engineering-sheet layer-horizontal"
          role="grid"
          aria-label="横向膜层表"
        >
          <thead>
            <tr>
              <th>膜层</th>
              {p.layers.map((l, c) => (
                <th key={l.id}>{c + 1}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {[
              "材料",
              "物理厚度 (nm)",
              "光学厚度 (nm)",
              "1/4 光学厚度",
              "组",
            ].map((label, r) => (
              <tr key={r}>
                <th>{label}</th>
                {p.layers.map((l, c) => {
                  const active = cell.row === r && cell.col === c,
                    selected =
                      r >= Math.min(cell.row, anchor.row) &&
                      r <= Math.max(cell.row, anchor.row) &&
                      c >= Math.min(cell.col, anchor.col) &&
                      c <= Math.max(cell.col, anchor.col);
                  return (
                    <td
                      key={l.id}
                      data-sheet-row={r}
                      data-sheet-col={c}
                      tabIndex={active ? 0 : -1}
                      aria-selected={selected}
                      title={r === 0 ? l.material : undefined}
                      onClick={(e) => {
                        if (editing.current && !finish()) return;
                        select(r, c, e.shiftKey);
                      }}
                      onDoubleClick={() => start(r, c)}
                      onKeyDown={(e) => {
                        if (editing.current) return;
                        if (
                          (e.metaKey || e.ctrlKey) &&
                          ["z", "y"].includes(e.key.toLowerCase())
                        ) {
                          e.preventDefault();
                          e.key.toLowerCase() === "y" || e.shiftKey
                            ? redo()
                            : undo();
                          return;
                        }
                        if (
                          [
                            "ArrowUp",
                            "ArrowDown",
                            "ArrowLeft",
                            "ArrowRight",
                            "Enter",
                            "Tab",
                          ].includes(e.key)
                        ) {
                          e.preventDefault();
                          move(e.key, e.shiftKey);
                        } else if (e.key === "F2") {
                          e.preventDefault();
                          start(r, c);
                        } else if (
                          e.key.length === 1 &&
                          !e.ctrlKey &&
                          !e.metaKey &&
                          !e.altKey
                        ) {
                          e.preventDefault();
                          start(r, c, e.key);
                        }
                      }}
                    >
                      {active && draft !== null ? (
                        <input
                          autoFocus
                          aria-label={`第 ${c + 1} 层${label}`}
                          list={r === 0 ? "horizontal-materials" : undefined}
                          value={draft}
                          onFocus={(e) => {
                            if (original.current === draft) e.target.select();
                          }}
                          onClick={(e) => e.stopPropagation()}
                          onChange={(e) => setDraft(e.target.value)}
                          onBlur={() => finish()}
                          onKeyDown={(e) => {
                            e.stopPropagation();
                            if (e.key === "Escape") {
                              e.preventDefault();
                              finish(false);
                              select(r, c);
                            }
                            if (e.key === "Enter" || e.key === "Tab") {
                              e.preventDefault();
                              if (finish()) move(e.key, e.shiftKey);
                            }
                          }}
                        />
                      ) : r === 0 ? (
                        materialLabel(
                          p.materials.find((m) => m.name === l.material)!,
                        )
                      ) : r === 4 ? (
                        value(r, c)
                      ) : (
                        Number(value(r, c)).toFixed(r === 3 ? 7 : 4)
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <datalist id="horizontal-materials">
        {p.materials.map((m) => (
          <option key={m.name} value={m.name}>
            {m.display_name || m.name}
          </option>
        ))}
      </datalist>
      <details className="sheet-help">
        <summary>键盘操作</summary>
        <p className="engineering-help">
          双击 / F2 编辑，Enter / Tab 提交并移动，方向键选择，Shift 扩选，Esc
          取消，⌘/Ctrl+C/V 复制粘贴，⌘/Ctrl+Z 撤销。
        </p>
      </details>
    </section>
  );
}
