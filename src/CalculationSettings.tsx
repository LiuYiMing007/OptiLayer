import { FlaskConical, LoaderCircle, Play, Settings2 } from "lucide-react";
import NumericInput from "./NumericInput";
import { synchronizeBoundaries } from "./model";
import type { Polarization, Project, Settings } from "./types";
export default function CalculationSettings({
  mode = "parameters",
  project: p,
  busy,
  update,
  calculate,
  openMaterials,
}: {
  mode?: "parameters" | "substrate";
  project: Project;
  busy: boolean;
  update: (f: (p: Project) => void) => void;
  calculate: () => void;
  openMaterials: () => void;
}) {
  const set = (key: keyof Settings, value: number) =>
    update((next) => {
      Object.assign(next.settings, { [key]: value });
    });
  const media = (kind: "incident" | "substrate") =>
    p.materials.filter(
      (m) =>
        m.role === "all" ||
        m.role === (kind === "incident" ? "medium" : "substrate") ||
        m.name === p.settings[`${kind}_material`],
    );
  if (mode === "substrate")
    return (
      <section className="panel substrate-tool">
        <div className="panel-heading">
          <h2>基底</h2>
        </div>
        <div className="settings-fields">
          <label>
            基底材料
            <select
              aria-label="基底材料"
              disabled={busy}
              value={p.settings.substrate_material}
              onChange={(e) =>
                update((next) => {
                  next.settings.substrate_material = e.target.value;
                  synchronizeBoundaries(next);
                })
              }
            >
              {media("substrate").map((m) => (
                <option key={m.name}>{m.name}</option>
              ))}
            </select>
          </label>
          <label>
            当前基底折射率 n
            <NumericInput
              label="基底折射率"
              value={p.settings.substrate_n}
              min={0.001}
              max={20}
              disabled={busy}
              onChange={(n) =>
                update((next) => {
                  const m = next.materials.find(
                    (m) => m.name === next.settings.substrate_material,
                  )!;
                  m.n = n;
                  synchronizeBoundaries(next);
                })
              }
            />
          </label>
          <p>k=0 · 常数折射率 · 不含基底背面反射</p>
          <button className="button secondary" onClick={openMaterials}>
            管理材料与基底
          </button>
          <p className="model-note">
            修改基底材料快照会自动更新主光谱，保持膜层物理厚度。
          </p>
        </div>
      </section>
    );
  return (
    <section className="panel settings-panel">
      <div className="panel-heading">
        <div>
          <Settings2 size={17} />
          <h2>计算设置</h2>
        </div>
        <span className="small-label">TMM · S/P</span>
      </div>
      <fieldset className="settings-fields" disabled={busy}>
        <div className="field-pair">
          {(["start_nm", "end_nm"] as const).map((key, i) => (
            <label key={key}>
              {i ? "终止波长" : "起始波长"}
              <div className="input-unit">
                <NumericInput
                  label={i ? "终止波长" : "起始波长"}
                  value={p.settings[key]}
                  min={1}
                  onChange={(v) => set(key, v)}
                />
                <span>nm</span>
              </div>
            </label>
          ))}
        </div>
        <div className="field-pair">
          {(["step_nm", "reference_nm"] as const).map((key, i) => (
            <label key={key}>
              {i ? "参考波长 λ₀" : "采样步长"}
              <div className="input-unit">
                <NumericInput
                  label={i ? "参考波长" : "采样步长"}
                  value={p.settings[key]}
                  min={0.001}
                  onChange={(v) => set(key, v)}
                />
                <span>nm</span>
              </div>
            </label>
          ))}
        </div>
        <div className="field-pair">
          <label>
            入射角
            <div className="input-unit">
              <NumericInput
                label="入射角"
                value={p.settings.angle_deg}
                min={0}
                max={89.9}
                onChange={(v) => set("angle_deg", v)}
              />
              <span>°</span>
            </div>
          </label>
          <label>
            偏振
            <select
              aria-label="偏振"
              value={p.settings.polarization}
              onChange={(e) =>
                update((next) => {
                  next.settings.polarization = e.target.value as Polarization;
                })
              }
            >
              <option value="unpolarized">非偏振（S/P平均）</option>
              <option value="s">S 偏振</option>
              <option value="p">P 偏振</option>
            </select>
          </label>
        </div>
        {(["incident"] as const).map((kind) => (
          <label className="boundary-field" key={kind}>
            {kind === "incident" ? "入射介质" : "基底材料"}
            <div>
              <select
                aria-label={kind === "incident" ? "入射介质材料" : "基底材料"}
                value={p.settings[`${kind}_material`]}
                onChange={(e) =>
                  update((next) => {
                    next.settings[`${kind}_material`] = e.target.value;
                    synchronizeBoundaries(next);
                  })
                }
              >
                {media(kind).map((m) => (
                  <option key={m.name}>{m.name}</option>
                ))}
              </select>
              <span>n={p.settings[`${kind}_n`]}</span>
            </div>
          </label>
        ))}
        <button
          className="text-button teal manage-materials"
          onClick={openMaterials}
        >
          <FlaskConical size={13} />
          管理材料 / 添加基底
        </button>
        <button className="button primary calculate-button" onClick={calculate}>
          {busy ? (
            <LoaderCircle size={16} className="spin" />
          ) : (
            <Play size={15} fill="currentColor" />
          )}
          {busy ? "正在处理…" : "计算光谱"}
          <span>→</span>
        </button>
      </fieldset>
    </section>
  );
}
