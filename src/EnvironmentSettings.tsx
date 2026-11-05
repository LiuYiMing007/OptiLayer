import { useState } from "react";
import type { Project } from "./types";
import CommitNumber from "./CommitNumber";
import { synchronizeBoundaries } from "./model";
import { parseResponse } from "./responseEditing";
export default function EnvironmentSettings({
  project: p,
  update,
  busy,
}: {
  project: Project;
  update: (m: (p: Project) => void) => void;
  busy: boolean;
}) {
  const s = p.settings,
    mode = s.substrate_model || "semi_infinite";
  const [category, setCategory] = useState<"illuminants" | "detectors">(
    "illuminants",
  );
  const [name, setName] = useState("");
  const [data, setData] = useState("");
  const [error, setError] = useState("");
  const media = p.materials.filter(
    (m) =>
      m.role !== "film" ||
      [s.substrate_material, s.exit_material].includes(m.name),
  );
  return (
    <>
      <fieldset disabled={busy}>
        <legend>基底与出射环境</legend>
        <label className="property-row">
          <span>基底模型</span>
          <select
            aria-label="基底模型"
            value={mode}
            onChange={(e) =>
              update((next) => {
                const nextMode = e.target.value as typeof mode;
                next.settings.substrate_model = nextMode;
                next.settings.substrate_thickness_mm ||= 1;
                if (nextMode === "semi_infinite")
                  next.settings.exit_material =
                    next.settings.substrate_material;
                else if (
                  mode === "semi_infinite" ||
                  !next.settings.exit_material
                )
                  next.settings.exit_material = next.settings.incident_material;
              })
            }
          >
            <option value="semi_infinite" disabled={!!p.back_layers?.length}>
              半无限基底（仅正面边界）
            </option>
            <option value="incoherent">有限厚基底 · 非相干</option>
            <option value="coherent">有限厚基底 · 相干干涉</option>
          </select>
          <span />
        </label>
        <label className="property-row">
          <span>基底材料</span>
          <select
            aria-label="环境基底材料"
            value={s.substrate_material}
            onChange={(e) =>
              update((next) => {
                next.settings.substrate_material = e.target.value;
                if (mode === "semi_infinite")
                  next.settings.exit_material = e.target.value;
                synchronizeBoundaries(next);
              })
            }
          >
            {media.map((m) => (
              <option key={m.name} value={m.name}>
                {m.display_name || m.name}
              </option>
            ))}
          </select>
          <span />
        </label>
        <label className="property-row">
          <span>基底厚度</span>
          <CommitNumber
            label="基底厚度"
            value={s.substrate_thickness_mm || 1}
            min={0.000001}
            max={1e5}
            disabled={mode === "semi_infinite"}
            onChange={(v) =>
              update((next) => {
                next.settings.substrate_thickness_mm = v;
              })
            }
          />
          <span className="property-unit">mm</span>
        </label>
        <label className="property-row">
          <span>出射介质</span>
          <select
            aria-label="出射介质"
            disabled={mode === "semi_infinite"}
            value={
              mode === "semi_infinite"
                ? s.substrate_material
                : s.exit_material || s.substrate_material
            }
            onChange={(e) =>
              update((next) => {
                next.settings.exit_material = e.target.value;
              })
            }
          >
            {media.map((m) => (
              <option key={m.name} value={m.name}>
                {m.display_name || m.name}
              </option>
            ))}
          </select>
          <span />
        </label>
        <label className="property-row">
          <span>第一表面</span>
          <select
            aria-label="第一表面"
            value={s.first_surface || "front"}
            onChange={(e) =>
              update((next) => {
                next.settings.first_surface = e.target.value as
                  "front" | "back";
              })
            }
          >
            <option value="front">Front · 正面照射</option>
            <option value="back">Back · 背面照射</option>
          </select>
          <span />
        </label>
        <p className="engineering-help">
          Front 从入射介质照射，Back
          从出射介质照射；角度相对于所选表面的法线。半无限模型的 T
          表示进入基底，有限模型的 T
          表示穿出整个元件。相干模型需足够细的波长采样。
        </p>
      </fieldset>
      <fieldset disabled={busy}>
        <legend>光源与探测器</legend>
        {(
          [
            ["illuminants", "illuminant", "WHITE", "光源"],
            ["detectors", "detector", "IDEAL", "探测器"],
          ] as const
        ).map(([group, field, reference, label]) => (
          <label className="property-row" key={field}>
            <span>{label}</span>
            <select
              aria-label={label}
              value={s[field] || reference}
              onChange={(e) =>
                update((next) => {
                  next.settings[field] = e.target.value;
                })
              }
            >
              <option value={reference}>{reference} · 平坦 100%</option>
              {p.response_data?.[group]?.map((r) => (
                <option key={r.name}>{r.name}</option>
              ))}
            </select>
            <span />
          </label>
        ))}
        <p className="engineering-help">
          本征 T/R/A
          保持不变。自定义光源和探测器响应通过光谱窗口的“响应加权”单独显示；WHITE
          不代表 D65。
        </p>
        <details className="response-editor">
          <summary>自定义响应数据…</summary>
          <label>
            数据类型
            <select
              value={category}
              onChange={(e) => {
                setCategory(e.target.value as typeof category);
                setError("");
              }}
            >
              <option value="illuminants">光源相对强度</option>
              <option value="detectors">探测器效率</option>
            </select>
          </label>
          <label>
            名称
            <input
              aria-label="响应名称"
              value={name}
              maxLength={100}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <label>
            波长 nm　响应 %
            <textarea
              aria-label="响应光谱数据"
              value={data}
              onChange={(e) => setData(e.target.value)}
              placeholder={"400 100\n700 100"}
              rows={5}
            />
          </label>
          <div className="interactive-actions">
            <button
              type="button"
              onClick={() => {
                try {
                  const response = parseResponse(
                    name,
                    data,
                    category === "detectors",
                  );
                  update((next) => {
                    next.response_data ||= {};
                    next.response_data[category] = [
                      ...(next.response_data[category] || []).filter(
                        (r) => r.name !== response.name,
                      ),
                      response,
                    ];
                    next.settings[
                      category === "detectors" ? "detector" : "illuminant"
                    ] = response.name;
                  });
                  setError("");
                } catch (e) {
                  setError(String(e));
                }
              }}
            >
              保存响应并选用
            </button>
            <button
              type="button"
              onClick={() => {
                const selected =
                  category === "detectors" ? s.detector : s.illuminant;
                const r = p.response_data?.[category]?.find(
                  (r) => r.name === selected,
                );
                if (r) {
                  setName(r.name);
                  setData(r.samples.map((row) => row.join("\t")).join("\n"));
                } else setError("当前为内置平坦响应，请新建自定义名称。");
              }}
            >
              载入当前自定义响应
            </button>
          </div>
          {error && (
            <p role="alert" className="inline-error">
              {error}
            </p>
          )}
        </details>
      </fieldset>
    </>
  );
}
