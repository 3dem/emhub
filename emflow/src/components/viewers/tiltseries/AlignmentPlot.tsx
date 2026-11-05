// src/components/viewers/tiltseries/AlignmentPlot.tsx
//
// The plot of TiltSeriesViewer against the tilt angle: the shifts (Å) and
// the angle offsets (°, only when they vary) of the alignment above, the
// neighbour correlation of each view below (when measured), the current
// tilt as a line; a click on a point goes to that tilt.
import { useMemo } from "react";
import Plot from "@/lib/plot";
import { useTheme } from "@/context/ThemeContext";
import type { TiltSeriesTilt } from "@/services/ProjectService";
import { hasAlign, type View } from "./alignment";
import { fmt, median, tiltLabel } from "./tilts";
import type { NeighbourCorrelation } from "./useNeighbourCorrelation";
import styles from "../TiltSeriesViewer.module.css";

export const VIEW_COLOR: Record<View, string> = { raw: "#94a3b8", global: "#16a34a", both: "#a855f7" };
export const VIEW_LABEL: Record<View, string> = { raw: "as acquired", global: "global", both: "global + local" };
// as acquired dotted, global solid, dashed global + local over it (both
// visible when they coincide)
const VIEW_DASH: Record<View, string | undefined> = { raw: "dot", global: undefined, both: "dash" };
const VIEWS: View[] = ["raw", "global", "both"];

export default function AlignmentPlot({ tilts, hasAlignment, metrics, cur, width, onSelect }: {
  tilts: TiltSeriesTilt[];
  hasAlignment: boolean;
  /** The neighbour correlation, once every view is measured. */
  metrics: NeighbourCorrelation | null;
  cur: number;
  /** The width it is drawn at: the figure is drawn anew when it changes. */
  width: number;
  onSelect: (index: number) => void;
}) {
  const { theme } = useTheme();
  const dark = theme === "dark";
  const xs = useMemo(() => tilts.map((t, i) => t.tiltAngle ?? t.yTilt ?? i + 1), [tilts]);
  const xTitle = tilts.some((t) => t.tiltAngle != null || t.yTilt != null) ? "Tilt angle (°)" : "Tilt";
  const metricViews = VIEWS.filter((v) => metrics?.[v]);

  const data = useMemo(() => {
    const text = tilts.map(tiltLabel);
    const trace = (name: string, y: Array<number | null>, color: string, axis: string, dash?: string) => ({
      x: xs, y, text, name, type: "scatter", mode: "lines+markers", yaxis: axis,
      line: { color, width: 1.5, dash }, marker: { size: 4 },
      hovertemplate: `%{text}<br>${name}: %{y:.2f}<extra></extra>`,
    });
    const out: any[] = [];
    if (hasAlignment) {
      const rot0 = median(tilts.filter(hasAlign).map((t) => t.zRot as number));
      out.push(trace("shift X (Å)", tilts.map((t) => t.shiftX), "#1f77b4", "y"),
               trace("shift Y (Å)", tilts.map((t) => t.shiftY), "#ff7f0e", "y"));
      // Angles on the right axis, only when they change more than the
      // rounding of the STAR (Warp keeps the rotation and the tilts)
      const varies = (v: Array<number | null>) => v.some((x) => x != null && Math.abs(x) >= 0.05);
      const tiltOffset = tilts.map((t) => (t.yTilt != null && t.tiltAngle != null ? t.yTilt - t.tiltAngle : null));
      if (varies(tiltOffset)) out.push(trace("aligned − nominal tilt (°)", tiltOffset, "#2ca02c", "y2", "dot"));
      const rotOffset = tilts.map((t) => (t.zRot != null ? t.zRot - rot0 : null));
      if (varies(rotOffset)) out.push(trace(`rotation from ${fmt(rot0, 2)}° (°)`, rotOffset, "#9467bd", "y2", "dot"));
    }
    // The neighbour correlation of each view, in its own panel below
    for (const v of metricViews) {
      out.push(trace(`neighbour CC, ${VIEW_LABEL[v]}`, metrics![v]!, VIEW_COLOR[v], "y3", VIEW_DASH[v]));
    }
    return out;
    // metricViews follows metrics
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasAlignment, tilts, xs, metrics]);

  const usesY2 = data.some((t) => t.yaxis === "y2");
  const hasShifts = data.some((t) => t.yaxis === "y");
  const hasCC = data.some((t) => t.yaxis === "y3");
  const height = hasShifts && hasCC ? 250 : 150;
  // A figure with other panels or axes, or of another width (an expanded
  // grid cell keeps the viewer), is drawn anew: traces and axes added to a
  // drawn figure are not always laid out by Plotly.react
  const key = `${hasShifts}:${usesY2}:${metricViews.join(",")}:${Math.round(width)}`;
  const layout = useMemo(() => {
    const ink = dark ? "#e5e7eb" : "#334155", grid = dark ? "rgba(255,255,255,0.12)" : "rgba(0,0,0,0.08)";
    const axis = { gridcolor: grid, zerolinecolor: grid, color: ink, tickfont: { size: 10 } };
    // Shifts above, correlation below (when both)
    const top = hasCC && hasShifts ? [0.5, 1] : [0, 1];
    const bottom = hasCC && hasShifts ? [0, 0.38] : [0, 1];
    return {
      height,
      margin: { l: 44, r: usesY2 ? 40 : 10, t: 6, b: 30 },
      paper_bgcolor: "rgba(0,0,0,0)",
      plot_bgcolor: "rgba(0,0,0,0)",
      font: { size: 10, color: ink },
      showlegend: true,
      legend: { orientation: "h", x: 0, y: 1.02, yanchor: "bottom", font: { size: 9 } },
      // The tilt angles under the lowest panel
      xaxis: { ...axis, anchor: hasCC ? "y3" : "y", title: { text: xTitle, font: { size: 10 }, standoff: 2 } },
      ...(hasShifts ? { yaxis: { ...axis, domain: top, title: { text: "Å", font: { size: 10 } } } } : {}),
      ...(usesY2 ? { yaxis2: { ...axis, overlaying: "y", side: "right", showgrid: false, title: { text: "°", font: { size: 10 } } } } : {}),
      ...(hasCC ? { yaxis3: { ...axis, domain: bottom, anchor: "x", title: { text: "CC", font: { size: 10 } } } } : {}),
      // The current tilt
      shapes: [{
        type: "line", xref: "x", yref: "paper", x0: xs[cur], x1: xs[cur], y0: 0, y1: 1,
        line: { color: "#0ea5e9", width: 1.5 },
      }],
    };
  }, [dark, xTitle, xs, cur, usesY2, hasCC, hasShifts, height]);

  if (!data.length) return null;
  const onClick = (e: any) => {
    const i = e?.points?.[0]?.pointIndex;
    if (typeof i === "number") onSelect(i);
  };
  return (
    <div className={styles.plot}>
      <Plot key={key} data={data as any} layout={layout as any}
            config={{ displaylogo: false, displayModeBar: false, responsive: true }}
            style={{ width: "100%", height }} useResizeHandler onClick={onClick} />
    </div>
  );
}
