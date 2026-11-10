import { useRef, useState } from "react";
import { Proposal, useAnalysis, type Candidate } from "./DesignTools";
import FitChart from "./FitChart";
import { parseTargetCsv } from "./model";
import type { Project, Spectrum, TargetPoint } from "./types";
import type { ToolSnapshot } from "./tools/state";
import type { ToolIntent } from "./tools/useToolHost";
type Variable = {
  side: "front" | "back";
  id: string;
  min_nm: number;
  max_nm: number;
};
type Diagnostic = {
  side: string;
  id: string;
  index: number;
  material: string;
  nominal_nm: number;
  fitted_nm: number;
  delta_nm: number;
  delta_percent: number | null;
  compensation_nm: number | null;
  sensitivity_pp_per_percent: number | null;
  at_bound: boolean;
};
type FitResult = Candidate & {
  nominal_spectrum: Spectrum;
  spectrum: Spectrum;
  compensation_project: Project | null;
  diagnostics: Diagnostic[];
  initial_rmse: number;
  final_rmse: number;
  evaluations: number;
  elapsed_seconds: number;
  warnings: string[];
  fit_range_nm: number[];
  used_points: number;
  ignored_points: number;
  search_points: number;
  rank: number;
  variables: number;
  status: string;
  history: { evaluation: number; rmse: number }[];
  data_points: TargetPoint[];
  mode: string;
};
const layerRows = (p: Project) =>
  (["front", "back"] as const).flatMap((side) =>
    (side === "front" ? p.layers : p.back_layers || []).map((l, index) => ({
      ...l,
      side,
      index,
    })),
  );
const keyOf = (r: { side: string; id: string }) => `${r.side}:${r.id}`;
export default function OptimizationTool({
  snapshot: s,
  send,
}: {
  snapshot: ToolSnapshot;
  send: (a: ToolIntent) => Promise<void>;
}) {
  const materialLabel = (name: string) =>
    s.project.materials.find((m) => m.name === name)?.display_name ||
    name.split("/").at(-1) ||
    name;
  const all = layerRows(s.project),
    file = useRef<HTMLInputElement>(null),
    task = useAnalysis(s.scope);
  const [mode, setMode] = useState("fit"),
    [points, setPoints] = useState<TargetPoint[]>(
      s.project.target_points || [],
    ),
    [source, setSource] = useState(
      s.project.target_points?.length ? "项目目标曲线" : "尚未导入数据",
    );
  const [percent, setPercent] = useState(10),
    [kind, setKind] = useState("layer"),
    [seconds, setSeconds] = useState(60),
    [starts, setStarts] = useState(3),
    [regularization, setRegularization] = useState(0.1);
  const validFilmRange = s.project.materials.filter(
    (m) =>
      all.some((l) => l.material === m.name) &&
      m.model !== "constant" &&
      m.range_nm &&
      !(m.samples?.length === 1),
  );
  const defaultLo = Math.max(
    s.project.settings.start_nm,
    points[0]?.wavelength_nm || s.project.settings.start_nm,
    ...validFilmRange.map((m) => m.range_nm![0]),
  );
  const defaultHi = Math.min(
    s.project.settings.end_nm,
    points.at(-1)?.wavelength_nm || s.project.settings.end_nm,
    ...validFilmRange.map((m) => m.range_nm![1]),
  );
  const [lo, setLo] = useState(defaultLo),
    [hi, setHi] = useState(defaultHi);
  const makeVariable = (r: (typeof all)[number], p = percent): Variable => ({
    side: r.side,
    id: r.id,
    min_nm: Math.max(0, r.thickness_nm * (1 - p / 100)),
    max_nm: Math.max(r.thickness_nm * (1 + p / 100), r.thickness_nm + 0.01),
  });
  const [variables, setVariables] = useState<Record<string, Variable>>(() =>
    Object.fromEntries(
      all.slice(0, 256).map((r) => [keyOf(r), makeVariable(r)]),
    ),
  );
  const [result, setResult] = useState<FitResult | null>(null),
    [sorted, setSorted] = useState(false);
  const restoreContext = (proposal: Project, before: Project) => {
    const p = structuredClone(proposal);
    if (before.target_points)
      p.target_points = structuredClone(before.target_points);
    else delete p.target_points;
    return p;
  };
  return (
    <section className="design-tool fit-workbench">
      <header className="fit-heading">
        <div>
          <span className="fit-eyebrow">OPTILAYER · 光谱与工艺</span>
          <h2>膜系自动优化</h2>
        </div>
        <span className="fit-badge">
          {all.length} 层 / {points.length} 数据点
        </span>
      </header>
      <div className="fit-modes">
        <button
          aria-pressed={mode === "fit"}
          disabled={task.running}
          onClick={() => {
            setMode("fit");
            setResult(null);
          }}
        >
          实测反推与补偿
        </button>
        <button
          aria-pressed={mode === "target"}
          disabled={task.running}
          onClick={() => {
            setMode("target");
            setResult(null);
          }}
        >
          设计目标优化
        </button>
      </div>
      <p>
        {mode === "fit"
          ? "以当前膜系为理论基准，拟合实测光谱，查看一种可解释的层厚偏差及下一炉补偿候选。单条光谱不能唯一确定真实层厚。"
          : "在固定材料与层序下调整膜厚，使设计光谱接近导入目标；不作实际层厚归因。"}
      </p>
      <div className="fit-data-bar">
        <input
          ref={file}
          type="file"
          accept=".csv,.tsv,.txt"
          hidden
          onChange={async (e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (!f) return;
            try {
              if (f.size > 2000000) throw Error("数据文件不能超过2 MB");
              const data = parseTargetCsv(await f.text());
              setPoints(data);
              setSource(f.name);
              setLo(
                Math.max(
                  s.project.settings.start_nm,
                  data[0].wavelength_nm,
                  ...validFilmRange.map((m) => m.range_nm![0]),
                ),
              );
              setHi(
                Math.min(
                  s.project.settings.end_nm,
                  data.at(-1)!.wavelength_nm,
                  ...validFilmRange.map((m) => m.range_nm![1]),
                ),
              );
              setResult(null);
              task.setError("");
            } catch (err) {
              task.setError(String(err));
            }
          }}
        />
        <button disabled={task.running} onClick={() => file.current?.click()}>
          {mode === "fit" ? "导入实测 CSV…" : "导入目标 CSV…"}
        </button>
        <span>
          {source} · {points.length} 点{" "}
          {points.length
            ? `${points[0].wavelength_nm}–${points.at(-1)!.wavelength_nm} nm`
            : ""}
        </span>
      </div>
      <fieldset disabled={task.running} className="fit-settings">
        <label>
          拟合起点 nm
          <input
            aria-label="拟合起点"
            type="number"
            value={lo}
            onChange={(e) => setLo(Number(e.target.value))}
          />
        </label>
        <label>
          拟合终点 nm
          <input
            aria-label="拟合终点"
            type="number"
            value={hi}
            onChange={(e) => setHi(Number(e.target.value))}
          />
        </label>
        <label>
          变量方式
          <select
            aria-label="优化变量方式"
            value={kind}
            onChange={(e) => setKind(e.target.value)}
          >
            <option value="layer">逐层膜厚（自动预拟合共同偏差）</option>
            <option value="material">同材料按相同比例</option>
            <option value="group">同组按相同比例</option>
            <option value="global">全部所选层按相同比例</option>
          </select>
        </label>
        <label>
          运行预算
          <select
            value={seconds}
            onChange={(e) => setSeconds(Number(e.target.value))}
          >
            <option value={20}>快速 · 20 秒</option>
            <option value={60}>标准 · 60 秒</option>
            <option value={120}>精细 · 120 秒</option>
          </select>
        </label>
        <label>
          搜索起点
          <select
            value={starts}
            onChange={(e) => setStarts(Number(e.target.value))}
          >
            <option value={1}>1 个</option>
            <option value={3}>3 个</option>
            <option value={5}>5 个</option>
          </select>
        </label>
        <label>
          偏差约束
          <input
            aria-label="偏差约束"
            type="number"
            min={0}
            max={10}
            step={0.05}
            value={regularization}
            onChange={(e) => setRegularization(Number(e.target.value))}
          />
        </label>
      </fieldset>
      <details className="fit-variable-details">
        <summary>
          膜层与厚度范围 · 已选 {Object.keys(variables).length}/{all.length} 层
        </summary>
        <fieldset disabled={task.running}>
          <div className="design-toolbar">
            <label>
              统一允许偏差 ±
              <input
                aria-label="统一允许偏差"
                type="number"
                min={0.1}
                max={100}
                step={1}
                value={percent}
                onChange={(e) => setPercent(Number(e.target.value))}
              />
              %
            </label>
            <button
              onClick={() =>
                setVariables(
                  Object.fromEntries(
                    all.slice(0, 256).map((r) => [keyOf(r), makeVariable(r)]),
                  ),
                )
              }
            >
              全选并设置范围（最多256层）
            </button>
            <button onClick={() => setVariables({})}>清空选择</button>
          </div>
          <div className="design-layer-list">
            <table className="engineering-sheet">
              <thead>
                <tr>
                  <th>拟合</th>
                  <th>膜层</th>
                  <th>材料</th>
                  <th>理论 nm</th>
                  <th>下限 nm</th>
                  <th>上限 nm</th>
                </tr>
              </thead>
              <tbody>
                {all.map((r) => {
                  const key = keyOf(r),
                    v = variables[key];
                  return (
                    <tr key={key}>
                      <td>
                        <input
                          aria-label={`优化${r.side}第${r.index + 1}层`}
                          type="checkbox"
                          checked={!!v}
                          onChange={(e) =>
                            setVariables((old) => {
                              const next = { ...old };
                              if (e.target.checked) next[key] = makeVariable(r);
                              else delete next[key];
                              return next;
                            })
                          }
                        />
                      </td>
                      <td>
                        {r.side === "front" ? "正" : "背"} {r.index + 1}
                      </td>
                      <td title={r.material}>{materialLabel(r.material)}</td>
                      <td>{r.thickness_nm.toFixed(3)}</td>
                      {(["min_nm", "max_nm"] as const).map((f) => (
                        <td key={f}>
                          <input
                            type="number"
                            aria-label={`${key}-${f}`}
                            step="any"
                            disabled={!v}
                            value={v?.[f] ?? ""}
                            onChange={(e) =>
                              setVariables((old) => ({
                                ...old,
                                [key]: {
                                  ...old[key],
                                  [f]: Number(e.target.value),
                                },
                              }))
                            }
                          />
                        </td>
                      ))}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </fieldset>
      </details>
      <p className="fit-help">
        默认波段取数据、项目与膜层材料范围的交集，可手动调整；基底材料范围仍须核对。偏差约束越大越保守，0
        表示不约束。灰色波段不参与拟合，原数据保留。
      </p>
      <div className="fit-run">
        <button
          className="primary"
          disabled={
            task.running || !points.length || !Object.keys(variables).length
          }
          onClick={() => {
            const before = structuredClone(s.project);
            setResult(null);
            void task.run<FitResult>(
              {
                action: "optimize",
                project: { ...before, target_points: points },
                variables: Object.values(variables),
                max_evaluations: 30000,
                options: {
                  mode,
                  seconds,
                  starts,
                  regularization,
                  parameterization: kind,
                  range_nm: [lo, hi],
                },
              },
              (r) =>
                setResult({
                  ...r,
                  before,
                  scope: s.scope,
                  project: restoreContext(r.project, before),
                  compensation_project: r.compensation_project
                    ? restoreContext(r.compensation_project, before)
                    : null,
                  data_points: structuredClone(points),
                }),
            );
          }}
        >
          {task.running
            ? "正在搜索膜厚偏差…"
            : mode === "fit"
              ? "开始实测拟合"
              : "开始目标优化"}
        </button>
        {task.running && <button onClick={task.stop}>停止</button>}
        <span>
          {task.running
            ? "先拟合共同偏差，再细化；可随时停止，原膜系不变。"
            : "全程在副本上计算，应用前核对结果。"}
        </span>
      </div>
      {task.error && (
        <p role="alert" className="inline-error">
          {task.error}
        </p>
      )}
      {result && (
        <>
          <div className="fit-metrics">
            <div>
              <small>拟合区间 RMSE / 百分点</small>
              <strong>
                {result.initial_rmse.toFixed(3)} →{" "}
                {result.final_rmse.toFixed(3)}
              </strong>
            </div>
            <div>
              <small>误差降低</small>
              <strong>
                {result.initial_rmse
                  ? (
                      (1 - result.final_rmse / result.initial_rmse) *
                      100
                    ).toFixed(1)
                  : "0"}
                %
              </strong>
            </div>
            <div>
              <small>数据 / 评估</small>
              <strong>
                {result.used_points} 点 / {result.evaluations} 次
              </strong>
            </div>
          </div>
          <p>
            {result.fit_range_nm.join("–")} nm · 未使用 {result.ignored_points}{" "}
            点 · 搜索采样 {result.search_points} 点 ·{" "}
            {result.elapsed_seconds.toFixed(1)} 秒 ·{" "}
            {result.status === "budget" ? "达到预算，返回当前最佳" : "搜索完成"}
          </p>
          <FitChart
            original={result.nominal_spectrum}
            fitted={result.spectrum}
            points={result.data_points}
            range={result.fit_range_nm}
          />
          <div className="fit-notes">
            {result.warnings.map((w, i) => (
              <p key={i}>{w}</p>
            ))}
            <p>
              下表是固定材料/环境假设下的一组拟合解，不是“坏层”判定。灵敏度表示光谱对该层厚度的响应，不是故障概率。
            </p>
          </div>
          <div className="design-toolbar">
            <h3>层厚偏差与补偿</h3>
            <button onClick={() => setSorted(!sorted)}>
              {sorted ? "按层序显示" : "按偏差大小排序"}
            </button>
            <button
              onClick={() =>
                void send({
                  kind: "export",
                  name: `${s.project.name}-光谱拟合报告.json`,
                  content: JSON.stringify(result, null, 2),
                })
              }
            >
              导出完整拟合报告…
            </button>
            <button
              onClick={() =>
                void send({
                  kind: "export",
                  name: `${s.project.name}-膜厚偏差.csv`,
                  type: "text/csv;charset=utf-8",
                  content:
                    "\ufeffside,layer,material,nominal_nm,fitted_nm,delta_percent,compensation_nm,sensitivity_pp_per_percent,at_bound\n" +
                    result.diagnostics
                      .map((d) =>
                        [
                          d.side,
                          d.index,
                          JSON.stringify(d.material),
                          d.nominal_nm,
                          d.fitted_nm,
                          d.delta_percent ?? "",
                          d.compensation_nm ?? "",
                          d.sensitivity_pp_per_percent ?? "",
                          d.at_bound,
                        ].join(","),
                      )
                      .join("\n"),
                })
              }
            >
              导出膜厚表…
            </button>
          </div>
          <div className="fit-diagnostics">
            <table className="engineering-sheet">
              <thead>
                <tr>
                  <th>膜层</th>
                  <th>材料</th>
                  <th>理论 nm</th>
                  <th>拟合 nm</th>
                  <th>偏差 %</th>
                  <th>补偿 nm</th>
                  <th>灵敏度 pp/%</th>
                  <th>边界</th>
                </tr>
              </thead>
              <tbody>
                {(sorted
                  ? [...result.diagnostics].sort(
                      (a, b) =>
                        Math.abs(b.delta_percent || 0) -
                        Math.abs(a.delta_percent || 0),
                    )
                  : result.diagnostics
                ).map((d) => (
                  <tr key={keyOf(d)}>
                    <td>
                      {d.side === "front" ? "正" : "背"} {d.index}
                    </td>
                    <td title={d.material}>{materialLabel(d.material)}</td>
                    <td>{d.nominal_nm.toFixed(3)}</td>
                    <td>{d.fitted_nm.toFixed(3)}</td>
                    <td
                      className={
                        (d.delta_percent || 0) >= 0
                          ? "delta-positive"
                          : "delta-negative"
                      }
                    >
                      {d.delta_percent?.toFixed(3) ?? "—"}
                    </td>
                    <td>
                      {mode === "fit"
                        ? (d.compensation_nm?.toFixed(3) ?? "—")
                        : "—"}
                    </td>
                    <td>
                      {d.sensitivity_pp_per_percent?.toFixed(3) ?? "未完成"}
                    </td>
                    <td>{d.at_bound ? "达到边界" : ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="fit-apply">
            <Proposal
              compact
              candidate={result}
              snapshot={s}
              send={send}
              title={
                result.mode === "fit"
                  ? "拟合膜系 · 用于复核实测"
                  : "优化设计候选"
              }
              label={
                result.mode === "fit"
                  ? "应用拟合膜系（可撤销）"
                  : "应用优化设计（可撤销）"
              }
              applied={() => setResult(null)}
            />
            {result.mode === "fit" && result.compensation_project && (
              <Proposal
                compact
                candidate={{
                  before: result.before,
                  project: result.compensation_project,
                  scope: result.scope,
                }}
                snapshot={s}
                send={send}
                title="下一炉补偿候选 · 须工艺复验"
                label="应用补偿候选（可撤销）"
                applied={() => setResult(null)}
              />
            )}
          </div>
          <p className="fit-help">
            补偿按 d理论² / d拟合
            估算，只在同类乘性偏差可重复时成立。不能用于修复已镀成品；材料
            n/k、测量角度、光谱仪分辨率等误差也可能造成曲线差异。应用前建议先导出报告，并另存原理论项目。
          </p>
        </>
      )}
    </section>
  );
}
