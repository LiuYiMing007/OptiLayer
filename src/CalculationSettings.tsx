import { FlaskConical, LoaderCircle, Play, Settings2 } from "lucide-react";
import NumericInput from "./NumericInput";
import { synchronizeBoundaries } from "./model";
import type { Polarization, Project, Settings } from "./types";
export default function CalculationSettings({
  project: p,
  busy,
  update,
  calculate,
  openMaterials,
}: {
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
        {(["incident", "substrate"] as const).map((kind) => (
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
