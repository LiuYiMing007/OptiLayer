import { useEffect, useRef } from "react";
import Plotly from "plotly.js-basic-dist-min";
import type { Spectrum, TargetPoint } from "./types";
export default function FitChart({
  original,
  fitted,
  points,
  range,
}: {
  original: Spectrum;
  fitted: Spectrum;
  points: TargetPoint[];
  range: number[];
}) {
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const observer = new ResizeObserver(() => {
      void Promise.resolve(Plotly.Plots.resize(el)).catch(() => {});
    });
    observer.observe(el);
    return () => {
      observer.disconnect();
      Plotly.purge(el);
    };
  }, []);
  useEffect(() => {
    if (!host.current) return;
    const traces: unknown[] = [];
    const interpolate = (s: Spectrum, w: number, channel: "T" | "R") => {
      const xs = s.wavelength_nm,
        ys = channel === "T" ? s.T_percent : s.R_percent;
      let j = xs.findIndex((x) => x >= w);
      if (j < 0) j = xs.length - 1;
      if (j === 0 || xs[j] === w) return ys[j];
      return (
        ys[j - 1] +
        ((ys[j] - ys[j - 1]) * (w - xs[j - 1])) / (xs[j] - xs[j - 1])
      );
    };
    for (const channel of ["T", "R"] as const) {
      const data = points.filter((p) => p[`${channel}_percent`] !== undefined);
      if (!data.length) continue;
      for (const [name, s, color, dash] of [
        ["理论", original, "#5a728f", "solid"],
        ["拟合", fitted, "#0b9d87", "dash"],
      ] as const) {
        traces.push({
          name: `${name} ${channel}`,
          x: s.wavelength_nm,
          y: channel === "T" ? s.T_percent : s.R_percent,
          mode: "lines",
          line: { color, dash, width: 2 },
          xaxis: "x",
          yaxis: "y",
        });
      }
      traces.push({
        name: `导入数据 ${channel}`,
        x: data.map((p) => p.wavelength_nm),
        y: data.map((p) => p[`${channel}_percent`]),
        mode: "lines",
        line: { color: "#d47936", width: 1.7 },
      });
      traces.push({
        name: `拟合−数据 ${channel}`,
        x: data.map((p) => p.wavelength_nm),
        y: data.map((p) =>
          p.wavelength_nm < range[0] || p.wavelength_nm > range[1]
            ? null
            : interpolate(fitted, p.wavelength_nm, channel) -
              p[`${channel}_percent`]!,
        ),
        mode: "lines",
        line: { color: "#ad5479", width: 1.2 },
        xaxis: "x",
        yaxis: "y2",
      });
    }
    const min = Math.min(...points.map((p) => p.wavelength_nm)),
      max = Math.max(...points.map((p) => p.wavelength_nm));
    void Plotly.react(
      host.current,
      traces,
      {
        margin: { l: 48, r: 18, t: 26, b: 40 },
        paper_bgcolor: "transparent",
        plot_bgcolor: "transparent",
        font: { size: 11, color: "#4a5967" },
        legend: { orientation: "h", y: 1.12 },
        xaxis: {
          title: { text: "波长 / nm" },
          range: [min, max],
          anchor: "y2",
        },
        yaxis: {
          title: { text: "R/T / %" },
          domain: [0.34, 1],
          range: [0, 102],
        },
        yaxis2: {
          title: { text: "残差 / pp" },
          domain: [0, 0.2],
          zeroline: true,
        },
        shapes: [
          {
            type: "rect",
            xref: "x",
            yref: "paper",
            x0: min,
            x1: range[0],
            y0: 0,
            y1: 1,
            line: { width: 0 },
            fillcolor: "#8995a122",
          },
          {
            type: "rect",
            xref: "x",
            yref: "paper",
            x0: range[1],
            x1: max,
            y0: 0,
            y1: 1,
            line: { width: 0 },
            fillcolor: "#8995a122",
          },
        ],
        uirevision: JSON.stringify([min, max]),
      },
      { responsive: true, displaylogo: false },
    );
  }, [original, fitted, points, range]);
  return (
    <div
      className="fit-chart"
      ref={host}
      aria-label="理论、实测、拟合光谱与残差对比图"
    />
  );
}
