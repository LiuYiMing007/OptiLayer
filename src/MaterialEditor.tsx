import { NkSheetEditor } from "./NkSheet";
import { useState } from "react";
import type { Material, MaterialRole } from "./types";
import { parseNkTable } from "./materialEditing";
export default function MaterialEditor({
  material,
  save,
  cancel,
}: {
  material: Material;
  save: (m: Material) => Promise<void>;
  cancel: () => void;
}) {
  const [draft, setDraft] = useState(() => structuredClone(material));
  const [table, setTable] = useState(
    material.samples?.map((r) => r.join("\t")).join("\n") || "550\t1.5\t0",
  );
  const [a, setA] = useState(
      (material.formula?.coefficients || [1.5, 0, 0, 0, 0, 0]).join(", "),
    ),
    [b, setB] = useState(
      (material.formula?.k_coefficients || [1, 0, 0]).join(", "),
    );
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const field = (key: keyof Material, value: unknown) =>
    setDraft((d) => ({ ...d, [key]: value }));
  function coefficients(text: string, count: number) {
    const parts = text
      .trim()
      .split(/[,\s]+/)
      .map(Number);
    if (parts.length !== count || parts.some((x) => !Number.isFinite(x)))
      throw Error(`需要 ${count} 个有效系数，可使用科学计数法`);
    return parts;
  }
  async function submit() {
    setBusy(true);
    setError("");
    try {
      const m = structuredClone(draft);
      if (m.model === "tabulated") {
        m.samples = parseNkTable(table);
        m.range_nm = [m.samples[0][0], m.samples.at(-1)![0]];
      }
      if (m.model === "tfcalc-formula") {
        m.range_nm ||= [400, 700];
        m.formula = {
          n_type: m.formula?.n_type || 5,
          k_type: m.formula?.k_type || 1,
          coefficients: coefficients(a, 6),
          k_coefficients: coefficients(b, 3),
          wavelength_unit: "um",
        };
      }
      await save(m);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section
      className="material-editor-panel"
      role="region"
      aria-label="编辑材料与基底"
    >
      <header>
        <h2>编辑材料 / 基底</h2>
        <span>保存后更新当前项目，并写入工作区共享材料库</span>
      </header>
      <fieldset disabled={busy}>
        <div className="material-property-grid">
          <label>
            名称
            <input
              aria-label="材料显示名称"
              value={draft.display_name ?? draft.name}
              maxLength={100}
              onChange={(e) => field("display_name", e.target.value)}
            />
          </label>
          <label>
            用途
            <select
              aria-label="编辑材料用途"
              value={draft.role}
              onChange={(e) => field("role", e.target.value as MaterialRole)}
            >
              <option value="film">膜层</option>
              <option value="substrate">基底</option>
              <option value="medium">介质</option>
              <option value="all">通用</option>
            </select>
          </label>
          <label>
            数据模型
            <select
              aria-label="编辑材料模型"
              value={draft.model}
              onChange={(e) => field("model", e.target.value)}
            >
              <option value="constant">常数 n/k</option>
              <option value="tabulated">逐波长 n/k 数据表</option>
              <option value="tfcalc-formula">TFCalc 色散公式</option>
            </select>
          </label>
          <label>
            来源
            <input
              aria-label="编辑材料来源"
              value={draft.source}
              onChange={(e) => field("source", e.target.value)}
            />
          </label>
          {draft.model === "constant" && (
            <>
              <label>
                折射率 n
                <input
                  aria-label="编辑折射率 n"
                  type="number"
                  step="any"
                  value={Number.isFinite(draft.n) ? draft.n : ""}
                  onChange={(e) =>
                    field(
                      "n",
                      e.target.value === "" ? NaN : Number(e.target.value),
                    )
                  }
                />
              </label>
              <label>
                消光系数 k
                <input
                  aria-label="编辑消光系数 k"
                  type="number"
                  step="any"
                  value={Number.isFinite(draft.k) ? draft.k : ""}
                  onChange={(e) =>
                    field(
                      "k",
                      e.target.value === "" ? NaN : Number(e.target.value),
                    )
                  }
                />
              </label>
            </>
          )}
          {draft.model === "tfcalc-formula" && (
            <>
              <label>
                n 公式
                <select
                  aria-label="n 色散公式"
                  value={draft.formula?.n_type || 5}
                  onChange={(e) =>
                    field("formula", {
                      ...draft.formula,
                      n_type: Number(e.target.value),
                    })
                  }
                >
                  <option value={1}>Sellmeier 1</option>
                  <option value={4}>Sellmeier 3</option>
                  <option value={5}>Cauchy</option>
                  <option value={6}>Hartmann 1</option>
                </select>
              </label>
              <label>
                k 公式
                <select
                  aria-label="k 色散公式"
                  value={draft.formula?.k_type || 1}
                  onChange={(e) =>
                    field("formula", {
                      ...draft.formula,
                      k_type: Number(e.target.value),
                    })
                  }
                >
                  <option value={1}>零消光</option>
                  <option value={2}>Sellmeier 消光</option>
                </select>
              </label>
              <label>
                起始波长 / nm
                <input
                  aria-label="材料公式起始波长"
                  type="number"
                  value={draft.range_nm?.[0] ?? 400}
                  onChange={(e) =>
                    field("range_nm", [
                      Number(e.target.value),
                      draft.range_nm?.[1] ?? 700,
                    ])
                  }
                />
              </label>
              <label>
                终止波长 / nm
                <input
                  aria-label="材料公式终止波长"
                  type="number"
                  value={draft.range_nm?.[1] ?? 700}
                  onChange={(e) =>
                    field("range_nm", [
                      draft.range_nm?.[0] ?? 400,
                      Number(e.target.value),
                    ])
                  }
                />
              </label>
              <label className="full-width">
                n 系数（{draft.formula?.n_type === 4 ? "A1–A6" : "A0–A5"}，λ
                使用 μm）
                <input
                  aria-label="n 公式系数"
                  value={a}
                  onChange={(e) => setA(e.target.value)}
                />
              </label>
              <label className="full-width">
                k 系数 B1–B3
                <input
                  aria-label="k 公式系数"
                  value={b}
                  onChange={(e) => setB(e.target.value)}
                />
              </label>
            </>
          )}
        </div>
        {draft.model === "tabulated" && (
          <div>
            <NkSheetEditor value={table} onChange={setTable} />
            <details>
              <summary>批量粘贴 / 原始三列文本</summary>
              <label className="nk-table-editor">
                波长 nm　n　k（可从 Excel 粘贴三列；波长必须递增）
                <textarea
                  spellCheck={false}
                  aria-label="编辑 n/k 数据表"
                  value={table}
                  onChange={(e) => setTable(e.target.value)}
                />
              </label>
            </details>
          </div>
        )}
        {error && (
          <p role="alert" className="inline-error">
            {error}
          </p>
        )}
        <footer>
          <span>内置原始记录保留；编辑副本使用独立标识。</span>
          <button onClick={cancel}>取消编辑</button>
          <button className="save-button" onClick={() => void submit()}>
            {busy ? "正在保存…" : "保存材料"}
          </button>
        </footer>
      </fieldset>
    </section>
  );
}
