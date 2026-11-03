import { useLayoutEffect, useRef, useState } from "react";
import type { LayerCommand } from "./layerCommands";
import { gridValue, moveCell, pasteGrid, type GridCell } from "./layerGrid";
import type { Project } from "./types";
let restoreGridFocus: GridCell | null = null;
interface Props {
  command: (id: LayerCommand, index?: number) => void;
  project: Project;
  busy: boolean;
  selected: number;
  setSelected: (n: number) => void;
  update: (mutator: (p: Project) => void) => void;
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
}
export default function LayerEditor({
  project: p,
  busy,
  selected,
  setSelected,
  update,
  command,
  undo,
  redo,
  canUndo,
  canRedo,
}: Props) {
  const [active, setActive] = useState<GridCell>(
    restoreGridFocus ?? {
      row: Math.max(0, p.layers.length - 1 - selected),
      col: 1,
    },
  );
  const [anchor, setAnchor] = useState<GridCell>(active);
  const [editing, setEditing] = useState(false),
    [draft, setDraft] = useState(""),
    [error, setError] = useState("");
  const [context, setContext] = useState<{
    x: number;
    y: number;
    layerId: string;
  } | null>(null);
  const editingRef = useRef(false);
  const originalDraft = useRef("");
  const selectDraft = useRef(true);
  const root = useRef<HTMLDivElement>(null);
  const rows = p.layers.length;
  const structure = p.layers.map((l) => l.id).join("|");
  const previousStructure = useRef(structure);
  useLayoutEffect(() => {
    if (previousStructure.current === structure) return;
    previousStructure.current = structure;
    const cell = { row: Math.max(0, rows - 1 - selected), col: active.col };
    const hadFocus = root.current?.contains(document.activeElement);
    editingRef.current = false;
    setEditing(false);
    setActive(cell);
    setAnchor(cell);
    setContext(null);
    if (hadFocus)
      root.current
        ?.querySelector<HTMLElement>(
          `[data-row="${cell.row}"][data-col="${cell.col}"]`,
        )
        ?.focus();
  }, [structure, rows, selected, active.col]);

  useLayoutEffect(() => {
    if (restoreGridFocus) {
      const cell = {
        row: Math.min(restoreGridFocus.row, Math.max(0, rows - 1)),
        col: restoreGridFocus.col,
      };
      restoreGridFocus = null;
      setActive(cell);
      setAnchor(cell);
      root.current
        ?.querySelector<HTMLElement>(
          `[data-row="${cell.row}"][data-col="${cell.col}"]`,
        )
        ?.focus();
    }
    return () => {
      const focused = document.activeElement as HTMLElement | null;
      const cell = focused?.closest<HTMLElement>("[data-row][data-col]");
      if (cell && root.current?.contains(cell))
        restoreGridFocus = {
          row: Number(cell.dataset.row),
          col: Number(cell.dataset.col),
        };
    };
  }, []);

  useLayoutEffect(() => {
    const row = Math.max(0, Math.min(rows - 1, active.row));
    if (row !== active.row) {
      setActive({ ...active, row });
      setAnchor({ ...active, row });
    }
  }, [rows, active.row]);

  function select(cell: GridCell, extend = false) {
    setActive(cell);
    if (!extend) setAnchor(cell);
    setSelected(rows - 1 - cell.row);
    root.current
      ?.querySelector<HTMLElement>(
        `[data-row="${cell.row}"][data-col="${cell.col}"]`,
      )
      ?.focus();
  }
  function begin(cell = active, initial?: string) {
    if (busy || !rows) return;
    setActive(cell);
    setAnchor(cell);
    setError("");
    originalDraft.current = gridValue(p, cell);
    selectDraft.current = initial === undefined;
    setDraft(initial ?? originalDraft.current);
    editingRef.current = true;
    setEditing(true);
  }
  function apply(text: string, cell = active) {
    try {
      const next = pasteGrid(p, cell, text);
      update((project) => {
        project.layers = next.layers;
      });
      setError("");
      return true;
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e));
      return false;
    }
  }
  function finish(commit: boolean) {
    if (!editingRef.current) return true;
    // Opening a cell without editing must not round-trip its stored thickness.
    if (commit && draft !== originalDraft.current && !apply(draft))
      return false;
    editingRef.current = false;
    setEditing(false);
    return true;
  }
  function copyText() {
    const result = [];
    for (
      let r = Math.min(active.row, anchor.row);
      r <= Math.max(active.row, anchor.row);
      r++
    ) {
      const line = [];
      for (
        let c = Math.min(active.col, anchor.col);
        c <= Math.max(active.col, anchor.col);
        c++
      )
        line.push(gridValue(p, { row: r, col: c }));
      result.push(line.join("\t"));
    }
    return result.join("\n");
  }
  return (
    <section
      className="engineering-layers"
      onPointerDown={(e) => {
        if (!(e.target as HTMLElement).closest(".grid-context-menu"))
          setContext(null);
      }}
    >
      {context && (
        <div
          className="grid-context-menu"
          role="menu"
          aria-label="膜层操作"
          style={{ left: context.x, top: context.y }}
          onKeyDown={(e) => {
            if (e.key === "Escape") setContext(null);
          }}
        >
          {(
            [
              ["layer.copy", "复制层"],
              ["layer.up", "上移"],
              ["layer.down", "下移"],
              ["layer.delete", "删除层"],
            ] as const
          ).map(([id, label]) => (
            <button
              role="menuitem"
              key={id}
              disabled={
                busy ||
                !rows ||
                (id === "layer.up" && selected >= rows - 1) ||
                (id === "layer.down" && selected <= 0) ||
                (id === "layer.copy" && rows >= 500)
              }
              onClick={() => {
                const index = p.layers.findIndex(
                  (l) => l.id === context.layerId,
                );
                if (index >= 0) command(id, index);
                setContext(null);
              }}
            >
              {label}
            </button>
          ))}
        </div>
      )}
      <div className="engineering-toolbar">
        <button
          disabled={busy || rows >= 500}
          onClick={() => command("layer.add")}
        >
          添加
        </button>
        <button disabled={busy || !rows} onClick={() => command("layer.copy")}>
          复制层
        </button>
        <button
          disabled={busy || !rows}
          onClick={() => command("layer.delete")}
        >
          删除层
        </button>
        <span className="toolbar-separator" />
        <button
          disabled={busy || selected >= rows - 1}
          onClick={() => command("layer.up")}
        >
          上移
        </button>
        <button
          disabled={busy || selected <= 0}
          onClick={() => command("layer.down")}
        >
          下移
        </button>
        <span className="toolbar-separator" />
        <button disabled={busy || !canUndo} onClick={undo}>
          撤销
        </button>
        <button disabled={busy || !canRedo} onClick={redo}>
          重做
        </button>
        <span className="toolbar-meta">{rows} 层</span>
      </div>
      <div className="engineering-boundary">
        入射：{p.settings.incident_material}{" "}
        <span>n = {p.settings.incident_n}　↓ 光入射方向</span>
      </div>
      {error && (
        <div role="alert" className="grid-error">
          {error}
        </div>
      )}
      <div
        className="engineering-grid-wrap"
        ref={root}
        onContextMenu={(e) => {
          const target = (e.target as HTMLElement).closest<HTMLElement>(
            "[data-row][data-col]",
          );
          if (!target || editing || busy) return;
          e.preventDefault();
          select({
            row: Number(target.dataset.row),
            col: Number(target.dataset.col),
          });
          setContext({
            layerId: p.layers[rows - 1 - Number(target.dataset.row)].id,
            x: Math.max(0, Math.min(e.clientX, window.innerWidth - 130)),
            y: Math.max(0, Math.min(e.clientY, window.innerHeight - 140)),
          });
        }}
        onCopy={(e) => {
          if (!editing) {
            e.preventDefault();
            e.clipboardData.setData("text/plain", copyText());
          }
        }}
        onPaste={(e) => {
          if (!editing && !busy) {
            e.preventDefault();
            apply(e.clipboardData.getData("text/plain"));
          }
        }}
        onKeyDown={(e) => {
          if (editing || busy) return;
          if (
            (e.ctrlKey || e.metaKey) &&
            ["z", "y"].includes(e.key.toLowerCase())
          ) {
            e.preventDefault();
            e.stopPropagation();
            if (e.key.toLowerCase() === "y" || e.shiftKey) {
              if (canRedo) redo();
            } else if (canUndo) undo();
          } else if (
            [
              "ArrowUp",
              "ArrowDown",
              "ArrowLeft",
              "ArrowRight",
              "Tab",
              "Enter",
            ].includes(e.key)
          ) {
            e.preventDefault();
            e.stopPropagation();
            select(
              moveCell(active, e.key, rows, e.shiftKey),
              e.shiftKey && e.key.startsWith("Arrow"),
            );
          } else if (e.key === "F2") {
            e.preventDefault();
            begin();
          } else if (
            !e.ctrlKey &&
            !e.metaKey &&
            !e.altKey &&
            e.key.length === 1
          ) {
            e.preventDefault();
            begin(active, e.key);
          }
        }}
      >
        <table
          className="engineering-grid"
          role="grid"
          aria-label="膜层结构表格"
          aria-rowcount={rows + 1}
          aria-colcount={5}
        >
          <thead>
            <tr>
              <th>层号</th>
              <th>材料</th>
              <th>
                物理厚度 d <span>nm</span>
              </th>
              <th>
                光学厚度 n·d <span>nm</span>
              </th>
              <th>
                QWOT <span>λ₀/4</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {[...p.layers].reverse().map((layer, r) => (
              <tr
                key={layer.id}
                className={selected === rows - 1 - r ? "selected" : ""}
              >
                <th scope="row">{rows - r}</th>
                {[0, 1, 2, 3].map((c) => {
                  const cell = { row: r, col: c },
                    isActive = active.row === r && active.col === c;
                  const inRange =
                    r >= Math.min(active.row, anchor.row) &&
                    r <= Math.max(active.row, anchor.row) &&
                    c >= Math.min(active.col, anchor.col) &&
                    c <= Math.max(active.col, anchor.col);
                  const raw = gridValue(p, cell);
                  return (
                    <td
                      key={c}
                      role="gridcell"
                      data-row={r}
                      data-col={c}
                      tabIndex={isActive ? 0 : -1}
                      aria-label={`第 ${rows - r} 层${["材料", "物理厚度", "光学厚度", "QWOT"][c]}`}
                      aria-selected={inRange}
                      className={`${c ? "numeric" : ""} ${isActive ? "active-cell" : ""}`}
                      onClick={(e) => {
                        if (!editingRef.current) select(cell, e.shiftKey);
                      }}
                      onDoubleClick={() => begin(cell)}
                    >
                      {editing && isActive ? (
                        <input
                          autoFocus
                          list={c === 0 ? "film-materials" : undefined}
                          aria-label={`编辑第 ${rows - r} 层${["材料", "物理厚度", "光学厚度", "QWOT"][c]}`}
                          value={draft}
                          onFocus={(e) => {
                            if (selectDraft.current) e.currentTarget.select();
                          }}
                          onChange={(e) => setDraft(e.target.value)}
                          onBlur={() => {
                            if (!finish(true)) {
                              editingRef.current = false;
                              setEditing(false);
                            }
                          }}
                          onKeyDown={(e) => {
                            e.stopPropagation();
                            if (e.key === "Escape") {
                              e.preventDefault();
                              finish(false);
                              select(active);
                            }
                            if (e.key === "Enter" || e.key === "Tab") {
                              e.preventDefault();
                              if (finish(true))
                                select(
                                  moveCell(active, e.key, rows, e.shiftKey),
                                );
                            }
                          }}
                        />
                      ) : c ? (
                        String(Number(Number(raw).toFixed(6)))
                      ) : (
                        p.materials.find((m) => m.name === raw)?.display_name ||
                        raw
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
        {!rows && (
          <p className="engineering-empty">尚无膜层，点击“添加”开始编辑。</p>
        )}
        <datalist id="film-materials">
          {p.materials
            .filter(
              (m) =>
                m.role === "film" ||
                m.role === "all" ||
                p.layers.some((l) => l.material === m.name),
            )
            .map((m) => (
              <option
                key={m.name}
                value={m.name}
                label={m.display_name || m.name}
              />
            ))}
        </datalist>
      </div>
      <div className="engineering-boundary">
        基底：
        {p.materials.find((m) => m.name === p.settings.substrate_material)
          ?.display_name || p.settings.substrate_material}
        <span>n = {p.settings.substrate_n}　不含背面反射</span>
      </div>
      <footer className="engineering-grid-status">
        <span>
          总厚度{" "}
          {Number(p.layers.reduce((s, l) => s + l.thickness_nm, 0).toFixed(6))}{" "}
          nm　·　λ₀ {p.settings.reference_nm} nm
        </span>
        <span>F2 编辑 · Enter / Tab 提交 · Shift + 方向键选区</span>
      </footer>
    </section>
  );
}
