// Semantic chart styling. New curve sources use roles rather than component colors.
export type ChartChannel = "T" | "R" | "A";
export type CurveRole = "computed" | "target" | "measured" | "comparison";
export const chartTheme = {
  background: "#FFFFFF",
  text: "#505963",
  grid: "#E9EDF1",
  axis: "#AAB3BC",
  reference: "#8795A3",
  border: "#D8DDE3",
  channels: { T: "#2878B8", R: "#D17A30", A: "#865BA6" },
  comparison: ["#388A80", "#A35E78", "#7278B1", "#887641"],
  font: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  widths: { primary: 2, secondary: 1.5 },
} as const;
export function curveStyle(
  channel: ChartChannel,
  role: CurveRole = "computed",
  polarization?: "s" | "p",
  comparison = 0,
) {
  return {
    color:
      role === "comparison"
        ? chartTheme.comparison[
            ((comparison % chartTheme.comparison.length) +
              chartTheme.comparison.length) %
              chartTheme.comparison.length
          ]
        : chartTheme.channels[channel],
    width:
      role === "computed" && !polarization
        ? chartTheme.widths.primary
        : chartTheme.widths.secondary,
    dash:
      polarization === "s"
        ? "dot"
        : polarization === "p"
          ? "dash"
          : role === "target"
            ? "dashdot"
            : role === "measured"
              ? "dot"
              : "solid",
  };
}
