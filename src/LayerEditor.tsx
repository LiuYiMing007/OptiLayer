import {
  ArrowDown,
  ArrowUp,
  Copy,
  Layers3,
  Plus,
  Redo2,
  Trash2,
  Undo2,
} from "lucide-react";
import type { LayerCommand } from "./layerCommands";
import NumericInput from "./NumericInput";
import { physicalThickness, thicknessValue, type ThicknessUnit } from "./model";
import type { Project } from "./types";
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
  command,
  project: p,
  busy,
  selected,
  setSelected,
  update,
  undo,
  redo,
  canUndo,
  canRedo,
}: Props) {
  const total = p.layers.reduce((sum, l) => sum + l.thickness_nm, 0);
  const editThickness = (index: number, value: number, unit: ThicknessUnit) =>
    update((next) => {
      const layer = next.layers[index];
      const material = next.materials.find((m) => m.name === layer.material)!;
      layer.thickness_nm = physicalThickness(
        value,
        material.n,
        next.settings.reference_nm,
        unit,
      );
    });
  const names = p.materials.filter(
    (m) =>
      m.role === "film" ||
      m.role === "all" ||
      p.layers.some((l) => l.material === m.name),
  );
  return (
    <section className="panel layers-panel">
      <div className="panel-heading">
        <div>
          <Layers3 size={17} />
          <h2>膜层结构</h2>
          <span className="pill">{p.layers.length} 层</span>
        </div>
        <div className="icon-actions">
          <button
            aria-label="撤销"
            title="撤销"
            disabled={!canUndo || busy}
            onClick={undo}
          >
            <Undo2 size={16} />
          </button>
          <button
            aria-label="重做"
            title="重做"
            disabled={!canRedo || busy}
            onClick={redo}
          >
            <Redo2 size={16} />
          </button>
          <span className="thin-divider" />
          <button
            aria-label="上移选中层"
            title="上移选中层"
            disabled={busy || selected >= p.layers.length - 1}
            onClick={() => command("layer.up")}
          >
            <ArrowUp size={16} />
          </button>
          <button
            aria-label="下移选中层"
            title="下移选中层"
            disabled={busy || selected <= 0 || !p.layers[selected]}
            onClick={() => command("layer.down")}
          >
            <ArrowDown size={16} />
          </button>
        </div>
      </div>
      <div className="medium-label">
        <span className="medium-dot" />
        入射介质{" "}
        <strong>
          {p.settings.incident_material} · n={p.settings.incident_n}
        </strong>
        <span>光从此侧入射 ↓</span>
      </div>
      <div className="layer-table-wrap">
        <table className="layer-table">
          <thead>
            <tr>
              <th>层号</th>
              <th>材料</th>
              <th>
                物理厚度 d<span>nm</span>
              </th>
              <th>
                光学厚度 n·d<span>nm</span>
              </th>
              <th>
                QWOT<span>λ₀/4</span>
              </th>
              <th />
            </tr>
          </thead>
          <tbody>
            {[...p.layers].reverse().map((l, display) => {
              const index = p.layers.length - 1 - display;
              const n =
                p.materials.find((m) => m.name === l.material)?.n || NaN;
              return (
                <tr
                  key={l.id}
                  className={selected === index ? "selected" : ""}
                  onClick={() => setSelected(index)}
                >
                  <td>
                    <span className="layer-index">{index + 1}</span>
                  </td>
                  <td>
                    <div className="material-cell">
                      <span
                        className="material-dot"
                        style={{
                          background: p.materials.find(
                            (m) => m.name === l.material,
                          )?.color,
                        }}
                      />
                      <select
                        aria-label={`第 ${index + 1} 层材料`}
                        disabled={busy}
                        value={l.material}
                        onChange={(e) =>
                          update((next) => {
                            next.layers[index].material = e.target.value;
                          })
                        }
                      >
                        {names.map((m) => (
                          <option key={m.name}>{m.name}</option>
                        ))}
                      </select>
                    </div>
                  </td>
                  {(["physical", "optical", "qwot"] as const).map((unit, i) => (
                    <td key={unit}>
                      <NumericInput
                        label={`第 ${index + 1} 层${["物理厚度", "光学厚度", "QWOT"][i]}`}
                        value={thicknessValue(
                          l.thickness_nm,
                          n,
                          p.settings.reference_nm,
                          unit,
                        )}
                        min={0}
                        disabled={busy}
                        onChange={(v) => editThickness(index, v, unit)}
                      />
                    </td>
                  ))}
                  <td>
                    <button
                      className="row-delete"
                      aria-label={`删除第 ${index + 1} 层`}
                      disabled={busy}
                      onClick={(e) => {
                        e.stopPropagation();
                        command("layer.delete", index);
                      }}
                    >
                      <Trash2 size={14} />
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {!p.layers.length && (
          <div className="empty-layers">
            尚无膜层。添加膜层后选择材料，也可先查看裸基底反射。
          </div>
        )}
      </div>
      <div className="medium-label substrate">
        <span className="substrate-mark" />
        基底{" "}
        <strong>
          {p.settings.substrate_material} · n={p.settings.substrate_n}
        </strong>
        <span>不含基底背面反射</span>
      </div>
      <div className="layer-footer">
        <button
          className="text-button teal"
          disabled={busy || p.layers.length >= 500}
          onClick={() => command("layer.add")}
        >
          <Plus size={16} />
          添加膜层
        </button>
        <button
          className="text-button"
          disabled={busy || !p.layers[selected] || p.layers.length >= 500}
          onClick={() => command("layer.copy")}
        >
          <Copy size={14} />
          复制
        </button>
        <span>
          总厚度{" "}
          <strong>{Number.isFinite(total) ? total.toFixed(2) : "—"}</strong> nm
        </span>
      </div>
      <div className="thickness-note">
        三列均可编辑 · QWOT = 4n·d/λ₀，λ₀={p.settings.reference_nm} nm。修改 n
        或 λ₀ 时保持物理厚度 d；修改 n·d / QWOT 时反算 d。
      </div>
    </section>
  );
}
