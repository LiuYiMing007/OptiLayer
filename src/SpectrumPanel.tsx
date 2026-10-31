import { useRef, useState } from "react";
import { Activity, Download, Upload, X } from "lucide-react";
import NumericInput from "./NumericInput";
import SpectrumChart, { type ChartOptions } from "./SpectrumChart";
import { parseTargetCsv } from "./model";
import type { AnalysisBands, BandResult, Project, Spectrum } from "./types";
interface Props {
  project: Project;
  spectrum: Spectrum | null;
  stale: boolean;
  busy: boolean;
  update: (f: (p: Project) => void) => void;
  analyze: (bands: AnalysisBands) => void;
  download: (name: string, content: string, type?: string) => Promise<void>;
  onError: (message: string) => void;
}
const value = (v: number | undefined, digits = 4) =>
  v === undefined || !Number.isFinite(v) ? "—" : v.toFixed(digits);
const bandValue = (r: BandResult | null | undefined) =>
  r?.error ||
  (r?.mean_percent === undefined
    ? "尚未设置"
    : `${r.mean_percent.toFixed(4)}%`);
export default function SpectrumPanel({
  project: p,
  spectrum,
  stale,
  busy,
  update,
  analyze,
  download,
  onError,
}: Props) {
  const [options, setOptions] = useState<ChartOptions>({
    T: true,
    R: false,
    A: false,
    sp: false,
    yMode: "auto",
  });
  const [details, setDetails] = useState(false);
  const targetRef = useRef<HTMLInputElement>(null);
  const result = !stale ? spectrum : null;
  const analysis = result?.analysis;
  const bands = p.analysis_bands || {};
  const bandStale =
    !!result &&
    JSON.stringify(bands) !== JSON.stringify(result.analysis_bands || {});
  const exportCsv = () => {
    if (!result) return;
    void download(
      `${p.name}-spectrum.csv`,
      "\ufeffwavelength_nm,R_percent,T_percent,A_percent,Rs_percent,Rp_percent,Ts_percent,Tp_percent,energy_error\n" +
        result.wavelength_nm
          .map((w, i) =>
            [
              w,
              result.R_percent[i],
              result.T_percent[i],
              result.A_percent[i],
              result.Rs_percent[i],
              result.Rp_percent[i],
              result.Ts_percent[i],
              result.Tp_percent[i],
              result.energy_error[i],
            ].join(","),
          )
          .join("\n"),
      "text/csv;charset=utf-8",
    );
  };
  return (
    <section className="panel chart-panel">
      <div className="panel-heading chart-heading">
        <div>
          <Activity size={18} />
          <h2>光谱分析</h2>
          {spectrum && (
            <span className={`result-badge ${stale ? "stale" : ""}`}>
              {stale ? "参数已修改 · 结果已过期" : "当前计算结果"}
            </span>
          )}
        </div>
        <div className="chart-controls">
          {(["T", "R", "A"] as const).map((channel) => (
            <button
              key={channel}
              aria-pressed={options[channel]}
              className={!options[channel] ? "muted" : ""}
              onClick={() =>
                setOptions((o) => ({ ...o, [channel]: !o[channel] }))
              }
            >
              <span
                className={`line-key ${channel === "T" ? "teal-key" : channel === "R" ? "purple-key" : "amber-key"}`}
              />
              {channel === "A" ? "A 残差" : channel}
            </button>
          ))}
          <select
            aria-label="纵轴范围"
            value={options.yMode}
            onChange={(e) =>
              setOptions((o) => ({
                ...o,
                yMode: e.target.value as ChartOptions["yMode"],
              }))
            }
          >
            <option value="auto">自动纵轴</option>
            <option value="full">0–100%</option>
          </select>
          <button
            className={!options.sp ? "muted" : ""}
            aria-pressed={options.sp}
            onClick={() => setOptions((o) => ({ ...o, sp: !o.sp }))}
          >
            S/P
          </button>
          <button
            aria-label="导出光谱"
            disabled={!result || busy}
            onClick={exportCsv}
          >
            <Download size={16} />
          </button>
        </div>
      </div>
      <div className="chart-context">
        <span>
          {spectrum?.model || "等待计算"}
          {stale ? " · 图中保留上次结果" : ""}
        </span>
        <span>拖拽框选缩放 · 滚轮缩放 · 双击复位</span>
      </div>
      <div className={stale ? "chart-stale" : ""}>
        <SpectrumChart
          spectrum={spectrum}
          referenceNm={p.settings.reference_nm}
          options={options}
          targets={p.target_points}
        />
      </div>
      <div className="spectrum-summary">
        <div>
          <span>最大透过率 T</span>
          <strong className="teal-text">
            {value(analysis?.T.max.value_percent)}
            <small> %</small>
          </strong>
          <small>
            {analysis
              ? `@ ${value(analysis.T.max.wavelength_nm, 2)} nm`
              : "等待计算"}
          </small>
        </div>
        <div>
          <span>最小透过率 T</span>
          <strong>
            {value(analysis?.T.min.value_percent)}
            <small> %</small>
          </strong>
          <small>
            {analysis
              ? `@ ${value(analysis.T.min.wavelength_nm, 2)} nm`
              : "等待计算"}
          </small>
        </div>
        <div>
          <span>参考波长 {p.settings.reference_nm} nm</span>
          <strong className="teal-text">
            {value(result?.reference_point.T_percent)}
            <small> % T</small>
          </strong>
          <small>R = {value(result?.reference_point.R_percent)}%</small>
        </div>
        <div>
          <span>50% 截止 · 全部交点</span>
          <strong>
            {analysis
              ? analysis.crossings["50"].length
                ? "共 " + analysis.crossings["50"].length + " 处"
                : "无交点"
              : "—"}
          </strong>
          <small>
            {analysis?.crossings["50"].length
              ? analysis.crossings["50"]
                  .slice(0, 3)
                  .map((c) => value(c.wavelength_nm, 2))
                  .join(" / ") + " nm"
              : "当前波段未跨过 T=50%"}
          </small>
        </div>
      </div>
      <div className="analysis-toolbar">
        <div>
          <input
            ref={targetRef}
            type="file"
            accept=".csv"
            hidden
            onChange={async (e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (!file) return;
              try {
                if (file.size > 2_000_000)
                  throw new Error("目标 CSV 不能超过 2 MB");
                const points = parseTargetCsv(await file.text());
                update((next) => {
                  next.target_points = points;
                });
              } catch (error) {
                onError(String(error));
              }
            }}
          />
          <button
            className="text-button"
            disabled={busy}
            onClick={() => targetRef.current?.click()}
          >
            <Upload size={13} />
            导入目标 CSV
          </button>
          {!!p.target_points?.length && (
            <button
              className="text-button"
              disabled={busy}
              onClick={() =>
                update((next) => {
                  delete next.target_points;
                })
              }
            >
              <X size={13} />
              移除目标
            </button>
          )}
        </div>
        <button
          className="text-button teal"
          onClick={() => setDetails((v) => !v)}
        >
          {details ? "收起详细分析" : "展开波段、截止边缘与峰谷分析"}{" "}
          {details ? "↑" : "↓"}
        </button>
      </div>
      {details && (
        <div className="analysis-details">
          <div className="band-editor">
            {(["passband", "stopband"] as const).map((key, i) => (
              <div className="band-row" key={key}>
                <label>
                  <input
                    aria-label={i ? "启用阻带分析" : "启用通带分析"}
                    type="checkbox"
                    checked={!!bands[key]}
                    disabled={busy}
                    onChange={(e) =>
                      update((next) => {
                        next.analysis_bands = { ...next.analysis_bands };
                        if (e.target.checked)
                          next.analysis_bands[key] = {
                            start_nm: next.settings.start_nm,
                            end_nm: next.settings.end_nm,
                          };
                        else delete next.analysis_bands[key];
                      })
                    }
                  />
                  {i ? "阻带" : "通带"}
                </label>
                <NumericInput
                  label={i ? "阻带起点" : "通带起点"}
                  value={bands[key]?.start_nm ?? p.settings.start_nm}
                  disabled={!bands[key] || busy}
                  onChange={(v) =>
                    update((next) => {
                      next.analysis_bands![key]!.start_nm = v;
                    })
                  }
                />
                <span>—</span>
                <NumericInput
                  label={i ? "阻带终点" : "通带终点"}
                  value={bands[key]?.end_nm ?? p.settings.end_nm}
                  disabled={!bands[key] || busy}
                  onChange={(v) =>
                    update((next) => {
                      next.analysis_bands![key]!.end_nm = v;
                    })
                  }
                />
                <span>nm</span>
              </div>
            ))}
            <button
              className="button secondary"
              disabled={!result || busy}
              onClick={() => analyze(bands)}
            >
              更新波段指标
            </button>
          </div>
          <div className="band-results">
            <span>
              通带平均 T{" "}
              <strong>
                {bandStale ? "待更新" : bandValue(analysis?.passband_T)}
              </strong>
            </span>
            <span>
              阻带平均 T{" "}
              <strong>
                {bandStale ? "待更新" : bandValue(analysis?.stopband_T)}
              </strong>
            </span>
            <span>
              阻带平均 R{" "}
              <strong>
                {bandStale ? "待更新" : bandValue(analysis?.stopband_R)}
              </strong>
            </span>
          </div>
          <div className="analysis-two-columns">
            <div>
              <h3>10–90% 截止边缘</h3>
              {analysis?.edges.length ? (
                <table className="analysis-table">
                  <thead>
                    <tr>
                      <th>方向</th>
                      <th>50% / nm</th>
                      <th>宽度 / nm</th>
                      <th>陡度 / %·nm⁻¹</th>
                    </tr>
                  </thead>
                  <tbody>
                    {analysis.edges.slice(0, 12).map((edge, i) => (
                      <tr key={i}>
                        <td>{edge.direction === "rising" ? "上升" : "下降"}</td>
                        <td>{value(edge.cutoff_50_nm, 3)}</td>
                        <td>{value(edge.width_nm, 3)}</td>
                        <td>{value(edge.slope_percent_per_nm, 3)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <p>当前光谱范围没有完整的单调 10–90% 边缘。</p>
              )}
            </div>
            <div>
              <h3>透过率局部峰谷</h3>
              <p>
                峰 {analysis?.T.peaks.length ?? "—"} 个 · 谷{" "}
                {analysis?.T.valleys.length ?? "—"} 个
              </p>
              <div className="extrema-list">
                {analysis &&
                  [
                    ...analysis.T.peaks.map((p) => ({ ...p, kind: "峰" })),
                    ...analysis.T.valleys.map((p) => ({ ...p, kind: "谷" })),
                  ]
                    .sort((a, b) => a.wavelength_nm - b.wavelength_nm)
                    .slice(0, 12)
                    .map((point, i) => (
                      <span key={i}>
                        {point.kind} · {value(point.wavelength_nm, 2)} nm{" "}
                        <strong>{value(point.value_percent)}%</strong>
                      </span>
                    ))}
              </div>
            </div>
          </div>
          <div className="analysis-bottom">
            <span>
              {result
                ? `${result.wavelength_nm.length} 点 · max |R+T−1|=${result.max_energy_error.toExponential(2)}`
                : "等待有效计算结果"}
            </span>
            <button
              className="text-button"
              disabled={!result || busy || bandStale}
              onClick={() => {
                if (result)
                  void download(
                    `${p.name}-analysis.json`,
                    JSON.stringify(
                      {
                        input_snapshot: result.input_snapshot,
                        analysis_bands: bands,
                        analysis: result.analysis,
                      },
                      null,
                      2,
                    ),
                  );
              }}
            >
              <Download size={13} />
              完整分析报告
            </button>
          </div>
          <p className="analysis-footnote">
            {analysis?.note || "阈值与峰谷来自计算采样；没有交点时不推断截止。"}{" "}
            A=100−R−T，为无吸收模型的数值残差。峰谷/边缘最多展示 12
            项，报告包含全部结果。目标 CSV 使用 wavelength_nm 与 T_percent /
            R_percent 列。
          </p>
        </div>
      )}
    </section>
  );
}
