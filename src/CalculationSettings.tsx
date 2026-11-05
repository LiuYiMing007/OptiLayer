import EnvironmentSettings from "./EnvironmentSettings";
import CommitNumber from "./CommitNumber";
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
        m.role === "medium" ||
        m.role === "substrate" ||
        m.name === p.settings[`${kind}_material`],
    );
  return (
    <section className="engineering-parameters">
      <fieldset disabled={busy}>
        <legend>波长采样</legend>
        {(
          [
            ["start_nm", "起始波长", "nm", 1],
            ["end_nm", "终止波长", "nm", 1],
            ["step_nm", "采样步长", "nm", 0.001],
            ["reference_nm", "参考波长 λ₀", "nm", 1],
          ] as const
        ).map(([key, label, unit, min]) => (
          <label className="property-row" key={key}>
            <span>{label}</span>
            <CommitNumber
              label={label}
              value={p.settings[key]}
              min={min}
              onChange={(v) => set(key, v)}
            />
            <span className="property-unit">{unit}</span>
          </label>
        ))}
      </fieldset>
      <fieldset disabled={busy}>
        <legend>入射条件</legend>
        <label className="property-row">
          <span>入射角度</span>
          <CommitNumber
            label="入射角"
            value={p.settings.angle_deg}
            min={0}
            max={89.9}
            onChange={(v) => set("angle_deg", v)}
          />
          <span className="property-unit">°</span>
        </label>
        <label className="property-row">
          <span>偏振模式</span>
          <select
            aria-label="偏振"
            value={p.settings.polarization}
            onChange={(e) =>
              update((next) => {
                next.settings.polarization = e.target.value as Polarization;
              })
            }
          >
            <option value="unpolarized">非偏振（S/P 平均）</option>
            <option value="s">S 偏振</option>
            <option value="p">P 偏振</option>
          </select>
          <span />
        </label>
        <label className="property-row">
          <span>入射介质</span>
          <select
            aria-label="入射介质材料"
            value={p.settings.incident_material}
            onChange={(e) =>
              update((next) => {
                next.settings.incident_material = e.target.value;
                synchronizeBoundaries(next);
              })
            }
          >
            {media("incident").map((m) => (
              <option key={m.name}>{m.name}</option>
            ))}
          </select>
          <span />
        </label>
        <div className="property-row property-readonly">
          <span>折射率 n</span>
          <output>{p.settings.incident_n}</output>
          <span />
        </div>
      </fieldset>
      <EnvironmentSettings project={p} update={update} busy={busy} />
      <p className="engineering-help">
        Enter / Tab 提交，Esc
        取消。有效参数提交后自动更新光谱。修改参考波长保持物理膜厚。
      </p>
      <footer className="engineering-parameter-actions">
        <button disabled={busy} onClick={openMaterials}>
          材料管理…
        </button>
        <button disabled={busy} onClick={calculate}>
          计算光谱
        </button>
      </footer>
    </section>
  );
}
