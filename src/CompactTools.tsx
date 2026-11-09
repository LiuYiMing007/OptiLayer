import StackMaterialInput from "./StackMaterialInput";
import { useState } from "react";
import type { Project, Material } from "./types";
import type { ToolIntent } from "./tools/useToolHost";
import CommitNumber from "./CommitNumber";
import MediumInput from "./MediumInput";
import { interactiveProject } from "./interactiveModel";
import { generateStack, type StackSymbol } from "./stackFormula";
import { parseResponse } from "./responseEditing";
export function EnvironmentTable({
  project: p,
  update,
}: {
  project: Project;
  update: (f: (p: Project) => void) => void;
}) {
  const s = p.settings;
  const row = (label: string, content: React.ReactNode) => (
    <tr key={label}>
      <th>{label}</th>
      <td>{content}</td>
    </tr>
  );
  return (
    <section className="compact-tool">
      <div className="sheet-scroll">
        <table className="engineering-sheet environment-sheet">
          <thead>
            <tr>
              <th>环境</th>
              <th>当前项目</th>
            </tr>
          </thead>
          <tbody>
            {(
              [
                ["start_nm", "起始波长"],
                ["end_nm", "终止波长"],
                ["step_nm", "采样步长"],
              ] as const
            ).map(([key, label]) =>
              row(
                label + " (nm)",
                <CommitNumber
                  label={label}
                  value={s[key]}
                  min={key === "step_nm" ? 0.001 : 1}
                  onChange={(v) =>
                    update((p) => {
                      p.settings[key] = v;
                    })
                  }
                />,
              ),
            )}
            {row(
              "偏振",
              <select
                aria-label="偏振"
                value={s.polarization}
                onChange={(e) =>
                  update((p) => {
                    p.settings.polarization = e.target
                      .value as typeof s.polarization;
                  })
                }
              >
                <option value="unpolarized">非偏振（S/P 平均）</option>
                <option value="s">S 偏振</option>
                <option value="p">P 偏振</option>
              </select>,
            )}
            {row(
              "参考波长 (nm)",
              <CommitNumber
                label="环境参考波长"
                value={s.reference_nm}
                min={1}
                onChange={(v) =>
                  update((p) => {
                    p.settings.reference_nm = v;
                  })
                }
              />,
            )}
            {row(
              "光源",
              <select
                aria-label="环境光源"
                value={s.illuminant || "WHITE"}
                onChange={(e) =>
                  update((p) => {
                    p.settings.illuminant = e.target.value;
                  })
                }
              >
                <option>WHITE</option>
                {p.response_data?.illuminants?.map((r) => (
                  <option key={r.name}>{r.name}</option>
                ))}
              </select>,
            )}
            {row(
              "入射角 (°)",
              <CommitNumber
                label="入射角"
                value={s.angle_deg}
                min={0}
                max={89.9}
                onChange={(v) =>
                  update((p) => {
                    p.settings.angle_deg = v;
                  })
                }
              />,
            )}
            {(["incident_material", "substrate_material"] as const).map(
              (field, i) =>
                row(
                  ["入射介质", "基底"][i],
                  <MediumInput
                    project={p}
                    field={field}
                    label={i === 0 ? "环境入射介质" : "环境基底材料"}
                    update={update}
                  />,
                ),
            )}
            {row(
              "基底厚度 (mm)",
              <CommitNumber
                label="基底厚度"
                value={s.substrate_thickness_mm ?? 1}
                min={0.000001}
                max={1e5}
                onChange={(v) =>
                  update((p) => {
                    p.settings.substrate_thickness_mm = v;
                    if (
                      (p.settings.substrate_model || "semi_infinite") ===
                      "semi_infinite"
                    ) {
                      p.settings.substrate_model = "incoherent";
                      p.settings.exit_material = p.settings.incident_material;
                    }
                  })
                }
              />,
            )}
            {row(
              "出射介质",
              <MediumInput
                project={p}
                field="exit_material"
                label="出射介质"
                update={update}
              />,
            )}
            {row(
              "探测器",
              <select
                aria-label="环境探测器"
                value={s.detector || "IDEAL"}
                onChange={(e) =>
                  update((p) => {
                    p.settings.detector = e.target.value;
                  })
                }
              >
                <option>IDEAL</option>
                {p.response_data?.detectors?.map((r) => (
                  <option key={r.name}>{r.name}</option>
                ))}
              </select>,
            )}
            {row(
              "第一表面",
              <select
                aria-label="第一表面"
                value={s.first_surface || "front"}
                onChange={(e) =>
                  update((p) => {
                    p.settings.first_surface = e.target.value as
                      "front" | "back";
                  })
                }
              >
                <option value="front">Front</option>
                <option value="back">Back</option>
              </select>,
            )}
            {row(
              "基底模型",
              <select
                aria-label="基底模型"
                value={s.substrate_model || "semi_infinite"}
                onChange={(e) =>
                  update((p) => {
                    const before =
                      p.settings.substrate_model || "semi_infinite";
                    p.settings.substrate_model = e.target
                      .value as typeof s.substrate_model;
                    if (
                      before === "semi_infinite" &&
                      e.target.value !== "semi_infinite"
                    )
                      p.settings.exit_material = p.settings.incident_material;
                    p.settings.substrate_thickness_mm ??= 1;
                    if (e.target.value === "semi_infinite")
                      p.settings.exit_material = p.settings.substrate_material;
                  })
                }
              >
                <option
                  value="semi_infinite"
                  disabled={!!p.back_layers?.length}
                >
                  半无限基底
                </option>
                <option value="incoherent">有限厚 · 非相干</option>
                <option value="coherent">有限厚 · 相干</option>
              </select>,
            )}
          </tbody>
        </table>
      </div>
      <details className="sheet-help">
        <summary>说明</summary>
        <p className="engineering-help">
          参考波长改变时保留物理厚度。出射介质独立于基底时需有限厚模型；环境与参数窗口共用同一项目。
        </p>
      </details>
    </section>
  );
}
export function GroupTable({
  project: p,
  update,
}: {
  project: Project;
  update: (f: (p: Project) => void) => void;
}) {
  const [number, setNumber] = useState("1"),
    [error, setError] = useState("");
  const ids = [
    ...new Set([
      ...Object.keys(p.group_factors || {}).map(Number),
      ...[...p.layers, ...(p.back_layers || [])].map((l) => l.group || 0),
    ]),
  ]
    .filter((x) => x > 0)
    .sort((a, b) => a - b);
  return (
    <section className="compact-tool">
      <div className="sheet-toolbar">
        <label>
          新组{" "}
          <input
            aria-label="新组号"
            value={number}
            onChange={(e) => setNumber(e.target.value)}
          />
        </label>
        <button
          onClick={() => {
            const g = Number(number);
            if (!Number.isInteger(g) || g < 1 || g > 999) {
              setError("组号须为 1–999");
              return;
            }
            update((p) => {
              p.group_factors = {
                ...p.group_factors,
                [String(g)]: p.group_factors?.[String(g)] ?? 1,
              };
            });
            setError("");
          }}
        >
          添加组
        </button>
      </div>
      {error && <p role="alert">{error}</p>}
      <div className="sheet-scroll">
        <table className="engineering-sheet">
          <thead>
            <tr>
              <th>组</th>
              {ids.map((g) => (
                <th key={g}>{g}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr>
              <th>系数</th>
              {ids.map((g) => (
                <td key={g}>
                  <CommitNumber
                    label={`组 ${g} 系数`}
                    value={p.group_factors?.[g] ?? 1}
                    min={0.000001}
                    max={1e6}
                    onChange={(v) => {
                      try {
                        const used = [
                          ...p.layers,
                          ...(p.back_layers || []),
                        ].some((l) => l.group === g);
                        const next = used
                          ? interactiveProject(
                              p,
                              { kind: "group", group: g },
                              v,
                            )
                          : {
                              ...p,
                              group_factors: { ...p.group_factors, [g]: v },
                            };
                        update((p) => Object.assign(p, next));
                        setError("");
                      } catch (e) {
                        setError(String(e));
                      }
                    }}
                  />
                </td>
              ))}
            </tr>
            <tr>
              <th>膜层数</th>
              {ids.map((g) => (
                <td key={g}>
                  {
                    [...p.layers, ...(p.back_layers || [])].filter(
                      (l) => l.group === g,
                    ).length
                  }
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>
      <details className="sheet-help">
        <summary>说明</summary>
        <p className="engineering-help">
          修改系数同步缩放该组前后表面膜厚，可撤销；0
          为未分组。自动优化在分析菜单中按实际物理厚度逐层调整，暂不支持组约束。
        </p>
      </details>
    </section>
  );
}
export function ResponseTable({
  project: p,
  update,
  detector = false,
}: {
  project: Project;
  update: (f: (p: Project) => void) => void;
  detector?: boolean;
}) {
  const category = detector ? "detectors" : "illuminants",
    field = detector ? "detector" : "illuminant",
    builtin = detector ? "IDEAL" : "WHITE";
  const [selected, setSelected] = useState(p.settings[field] || builtin),
    [name, setName] = useState(""),
    [text, setText] = useState(""),
    [editing, setEditing] = useState(false),
    [error, setError] = useState("");
  const responses = p.response_data?.[category] || [],
    current = responses.find((r) => r.name === selected),
    samples = current?.samples || [[550, 100]];
  const [page, setPage] = useState(0);
  const visible = samples.slice(page * 32, page * 32 + 32);
  return (
    <section className="compact-tool">
      <div className="sheet-toolbar">
        <select
          aria-label={detector ? "选择探测器" : "选择光源"}
          value={selected}
          onChange={(e) => {
            setSelected(e.target.value);
            setPage(0);
            setEditing(false);
          }}
        >
          <option>{builtin}</option>
          {responses.map((r) => (
            <option key={r.name}>{r.name}</option>
          ))}
        </select>
        <button
          onClick={() =>
            update((p) => {
              p.settings[field] = selected;
            })
          }
        >
          选用
        </button>
        <button
          onClick={() => {
            setName("");
            setText("400 100\n700 100");
            setEditing(true);
          }}
        >
          新建…
        </button>
        <button
          disabled={!current}
          onClick={() => {
            setName(selected);
            setText(samples.map((r) => r.join("\t")).join("\n"));
            setEditing(true);
          }}
        >
          编辑…
        </button>
        <span>当前：{p.settings[field] || builtin}</span>
      </div>
      <div className="sheet-scroll">
        <table className="engineering-sheet">
          <thead>
            <tr>
              <th>数据</th>
              {visible.map((_, i) => (
                <th key={i}>{page * 32 + i + 1}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {["波长 (nm)", detector ? "效率 (%)" : "强度 (%)"].map(
              (label, r) => (
                <tr key={label}>
                  <th>{label}</th>
                  {visible.map((s, i) => (
                    <td key={i}>{s[r]}</td>
                  ))}
                </tr>
              ),
            )}
          </tbody>
        </table>
      </div>
      {samples.length > 32 && (
        <div className="sheet-toolbar">
          <button disabled={!page} onClick={() => setPage(page - 1)}>
            上一页
          </button>
          <span>
            {page + 1}/{Math.ceil(samples.length / 32)}
          </span>
          <button
            disabled={(page + 1) * 32 >= samples.length}
            onClick={() => setPage(page + 1)}
          >
            下一页
          </button>
        </div>
      )}
      {editing && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            try {
              const r = parseResponse(name, text, detector);
              update((p) => {
                p.response_data ||= {};
                p.response_data[category] = [
                  ...(p.response_data[category] || []).filter(
                    (x) => x.name !== r.name,
                  ),
                  r,
                ];
                p.settings[field] = r.name;
              });
              setSelected(r.name);
              setPage(0);
              setEditing(false);
              setError("");
            } catch (e) {
              setError(String(e));
            }
          }}
        >
          <label>
            名称{" "}
            <input
              aria-label="响应表名称"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <textarea
            aria-label="响应表数据"
            rows={5}
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
          <button>保存并选用</button>
          <button type="button" onClick={() => setEditing(false)}>
            取消
          </button>
        </form>
      )}
      {error && <p role="alert">{error}</p>}
      <details className="sheet-help">
        <summary>说明</summary>
        <p className="engineering-help">
          {builtin} 为平坦 100%
          参考，保留只读。自定义响应在“响应加权”中显示，不改变本征
          R/T/A；本窗口不模拟相位或角度分布。
        </p>
      </details>
    </section>
  );
}
export function StackTool({
  project: p,
  library,
  send,
}: {
  project: Project;
  library: Material[];
  send: (a: ToolIntent) => Promise<void>;
}) {
  const [expression, setExpression] = useState("HLHL"),
    [side, setSide] = useState<"front" | "back">("front"),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const films = p.materials.filter(
    (m) => m.role === "film" || m.role === "all",
  );
  const [symbols, setSymbols] = useState<StackSymbol[]>(() =>
    ["H", "L"].map((s, i) => ({
      symbol: s,
      material:
        films.find(
          (m) => m.name === `TFC/MATERIAL/${i === 0 ? "TA2O5" : "SIO2"}`,
        )?.name ||
        films[i]?.name ||
        films[0]?.name ||
        "",
      thickness: 1,
      unit: "qw",
      group: 1,
    })),
  );
  const [materialPending, setMaterialPending] = useState<
    Record<number, boolean>
  >({});
  const materialBlocked = Object.values(materialPending).some(Boolean);
  const [preview, setPreview] = useState<{
    layers: Project["layers"];
    expected: Project["layers"];
    key: string;
  } | null>(null);
  const key = JSON.stringify([
    expression,
    symbols,
    side,
    p.settings.reference_nm,
    p.materials,
    p.group_factors,
  ]);
  const field = (i: number, k: keyof StackSymbol, v: unknown) =>
    setSymbols((a) => a.map((s, j) => (j === i ? { ...s, [k]: v } : s)));
  return (
    <section className="compact-tool">
      <div className="sheet-toolbar">
        <select
          aria-label="膜堆表面"
          value={side}
          onChange={(e) => {
            setSide(e.target.value as typeof side);
            setPreview(null);
          }}
        >
          <option value="front">前表面</option>
          <option value="back">后表面</option>
        </select>
        <span>基底在第 1 层左侧 · λ₀ {p.settings.reference_nm} nm</span>
      </div>
      <textarea
        aria-label="膜堆表达式"
        value={expression}
        onChange={(e) => setExpression(e.target.value)}
        rows={3}
      />
      <div className="sheet-scroll">
        <table className="engineering-sheet">
          <thead>
            <tr>
              <th>符号</th>
              <th>材料</th>
              <th>厚度</th>
              <th>单位</th>
              <th>组</th>
            </tr>
          </thead>
          <tbody>
            {symbols.map((s, i) => (
              <tr key={i}>
                <td>
                  <input
                    aria-label={`符号 ${i + 1}`}
                    maxLength={1}
                    value={s.symbol}
                    onChange={(e) =>
                      field(i, "symbol", e.target.value.toUpperCase())
                    }
                  />
                </td>
                <td>
                  <StackMaterialInput
                    project={p}
                    library={library}
                    value={s.material}
                    label={`${s.symbol} 材料`}
                    select={(name) => field(i, "material", name)}
                    send={send}
                    pending={(value) =>
                      setMaterialPending((previous) => ({
                        ...previous,
                        [i]: value,
                      }))
                    }
                  />
                </td>
                <td>
                  <CommitNumber
                    label={`${s.symbol} 厚度`}
                    min={0}
                    value={s.thickness}
                    onChange={(v) => field(i, "thickness", v)}
                  />
                </td>
                <td>
                  <select
                    value={s.unit}
                    onChange={(e) => field(i, "unit", e.target.value)}
                  >
                    <option>qw</option>
                    <option>nm</option>
                  </select>
                </td>
                <td>
                  <CommitNumber
                    label={`${s.symbol} 组`}
                    min={0}
                    max={999}
                    value={s.group}
                    onChange={(v) => field(i, "group", v)}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="sheet-toolbar">
        <button
          onClick={() => {
            const symbol = "ABCDEFGHIJKLMNOPQRSTUVWXYZ"
              .split("")
              .find((c) => !symbols.some((s) => s.symbol === c));
            if (symbol)
              setSymbols([
                ...symbols,
                {
                  symbol,
                  material: films[0]?.name || "",
                  thickness: 1,
                  unit: "qw",
                  group: 0,
                },
              ]);
          }}
        >
          添加符号
        </button>
        <button
          disabled={materialBlocked}
          onClick={() => {
            try {
              setPreview({
                layers: generateStack(p, expression, symbols, () =>
                  crypto.randomUUID(),
                ),
                expected: structuredClone(
                  side === "front" ? p.layers : p.back_layers || [],
                ),
                key,
              });
              setError("");
              setNotice("");
            } catch (e) {
              setError(String(e));
              setPreview(null);
            }
          }}
        >
          预览膜堆
        </button>
        <button
          disabled={materialBlocked || !preview || preview.key !== key}
          onClick={() => {
            if (preview)
              void send({
                kind: "stack-apply",
                side,
                expected: preview.expected,
                layers: preview.layers,
              })
                .then(() => {
                  setPreview(null);
                  setNotice("膜堆已生成，可撤销。");
                })
                .catch((e) => setError(String(e)));
          }}
        >
          替换{side === "front" ? "前" : "后"}表面膜层
        </button>
      </div>
      {preview && preview.key === key && (
        <p>
          将替换 {preview.expected.length} 层 → {preview.layers.length}{" "}
          层；总厚度{" "}
          {preview.layers.reduce((s, l) => s + l.thickness_nm, 0).toFixed(4)} nm
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
      {error && <p role="alert">{error}</p>}
      <details className="sheet-help">
        <summary>说明</summary>
        <p className="engineering-help">
          支持
          HLHL、(HL)^5、0.5H、G1(HL)^2；组系数仅计入一次。先预览再替换，替换可一次撤销。表达式暂为窗口草稿，实际生成膜层随项目保存。
        </p>
      </details>
    </section>
  );
}
