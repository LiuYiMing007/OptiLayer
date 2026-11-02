import { useEffect, useRef } from "react";
import Plotly from "plotly.js-basic-dist-min";
import { chartTheme, curveStyle } from "./design/chartTheme";
import type { Spectrum, TargetPoint } from "./types";
export interface ChartOptions {
  T: boolean;
  R: boolean;
  A: boolean;
  sp: boolean;
  yMode: "auto" | "full";
}
export default function SpectrumChart({
  spectrum,
  referenceNm,
  options,
  targets = [],
}: {
  spectrum: Spectrum | null;
  referenceNm: number;
  options: ChartOptions;
  targets?: TargetPoint[];
}) {
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const element = host.current;
    if (!element) return;
    const observer = new ResizeObserver(() => Plotly.Plots.resize(element));
    observer.observe(element);
    return () => {
      observer.disconnect();
      Plotly.purge(element);
    };
  }, []);
  useEffect(() => {
    const element = host.current;
    if (!element) return;
    const traces: unknown[] = [];
    let values: number[] = [];
    function trace(
      name: string,
      x: number[],
      y: number[],
      style: ReturnType<typeof curveStyle>,
    ) {
      const physical = spectrum && x === spectrum.wavelength_nm;
      const customdata = physical
        ? spectrum.wavelength_nm.map((_, i) => [
            spectrum.T_percent[i],
            spectrum.R_percent[i],
            spectrum.A_percent[i],
          ])
        : undefined;
      traces.push({
        x,
        y,
        customdata,
        type: "scatter",
        mode: "lines",
        name,
        line: style,
        hovertemplate: physical
          ? `%{x:.3f} nm<br>${name} %{y:.6f}%<br>T %{customdata[0]:.6f}% · R %{customdata[1]:.6f}%<br>A %{customdata[2]:.2e}%<extra></extra>`
          : `%{x:.3f} nm<br>${name} %{y:.6f}%<extra></extra>`,
      });
      values = values.concat(y);
    }
    if (spectrum) {
      const x = spectrum.wavelength_nm;
      if (options.T) trace("T", x, spectrum.T_percent, curveStyle("T"));
      if (options.R) trace("R", x, spectrum.R_percent, curveStyle("R"));
      if (options.A)
        trace(
          spectrum.absorbing ? "A（吸收）" : "A（数值残差）",
          x,
          spectrum.A_percent,
          curveStyle("A"),
        );
      if (options.sp) {
        if (options.T) {
          trace("Ts", x, spectrum.Ts_percent, curveStyle("T", "computed", "s"));
          trace("Tp", x, spectrum.Tp_percent, curveStyle("T", "computed", "p"));
        }
        if (options.R) {
          trace("Rs", x, spectrum.Rs_percent, curveStyle("R", "computed", "s"));
          trace("Rp", x, spectrum.Rp_percent, curveStyle("R", "computed", "p"));
        }
      }
    }
    if (targets.length) {
      const ts = targets.filter((p) => p.T_percent !== undefined),
        rs = targets.filter((p) => p.R_percent !== undefined);
      if (options.T && ts.length)
        trace(
          "目标 T",
          ts.map((p) => p.wavelength_nm),
          ts.map((p) => p.T_percent!),
          curveStyle("T", "target"),
        );
      if (options.R && rs.length)
        trace(
          "目标 R",
          rs.map((p) => p.wavelength_nm),
          rs.map((p) => p.R_percent!),
          curveStyle("R", "target"),
        );
    }
    let range = [0, 100];
    if (options.yMode === "auto" && values.length) {
      let low = Infinity,
        high = -Infinity;
      for (const y of values) {
        low = Math.min(low, y);
        high = Math.max(high, y);
      }
      const padding = Math.max((high - low) * 0.12, 0.01);
      range = [
        Math.max(options.A ? -0.01 : 0, low - padding),
        Math.min(100, high + padding),
      ];
      if (range[1] - range[0] < 0.01) range = [low - 0.01, high + 0.01];
    }
    void Plotly.react(
      element,
      traces,
      {
        autosize: true,
        margin: { l: 62, r: 24, t: 22, b: 48 },
        paper_bgcolor: chartTheme.background,
        plot_bgcolor: chartTheme.background,
        showlegend: options.sp || targets.length > 0,
        legend: { orientation: "h", x: 0, y: 1.02, font: { size: 12 } },
        font: {
          family: chartTheme.font,
          color: chartTheme.text,
          size: 12,
        },
        xaxis: {
          title: { text: "波长 / nm", font: { size: 12 } },
          gridcolor: chartTheme.grid,
          zeroline: false,
          showspikes: true,
          spikemode: "across",
          spikesnap: "cursor",
          spikecolor: chartTheme.reference,
          spikethickness: 1,
          range: spectrum
            ? [spectrum.wavelength_nm[0], spectrum.wavelength_nm.at(-1)]
            : [400, 700],
        },
        yaxis: {
          title: { text: "光谱 / %", font: { size: 12 } },
          range,
          gridcolor: chartTheme.grid,
          zeroline: false,
          showspikes: true,
          spikemode: "across",
          spikesnap: "cursor",
          spikecolor: chartTheme.reference,
          spikethickness: 1,
          tickformat: ".6~g",
        },
        hovermode: "closest",
        hoverdistance: 100,
        spikedistance: -1,
        hoverlabel: {
          bgcolor: chartTheme.background,
          bordercolor: chartTheme.border,
          font: { color: chartTheme.text },
        },
        dragmode: "zoom",
        uirevision: JSON.stringify([
          spectrum?.input_snapshot,
          options.yMode,
          options.T,
          options.R,
          options.A,
        ]),
        shapes: [
          {
            type: "line",
            x0: referenceNm,
            x1: referenceNm,
            yref: "paper",
            y0: 0,
            y1: 1,
            line: { color: chartTheme.reference, width: 1, dash: "dot" },
          },
        ],
        annotations: !spectrum
          ? [
              {
                text: "计算后显示光谱，可拖拽框选并缩放",
                xref: "paper",
                yref: "paper",
                x: 0.5,
                y: 0.5,
                showarrow: false,
                font: { size: 13, color: chartTheme.text },
              },
            ]
          : [],
      },
      {
        responsive: true,
        displaylogo: false,
        displayModeBar: true,
        modeBarButtons: [
          ["zoom2d", "pan2d", "zoomIn2d", "zoomOut2d", "resetScale2d"],
        ],
        scrollZoom: true,
      },
    );
  }, [spectrum, referenceNm, options, targets]);
  return (
    <div
      ref={host}
      className="spectrum-chart"
      aria-label="可缩放反射率与透过率光谱图"
    />
  );
}
