// src/components/viewers/volume/IterationsBar.tsx
//
// The iterations of a map (a Relion class at every iteration of its job) in
// the 3D volume tab of VolumeViewer: play / pause, a slider over the
// iterations, the speed, how many maps are loaded, and small charts (one
// series each, never two y axes): the resolution per iteration and, for a
// refinement, the FSC of the shown iteration. The shown iteration is marked;
// a click on a point of the resolution chart shows that iteration.
import { useEffect, useMemo, useRef, useState } from "react";
import { Pause, Play } from "lucide-react";
import Plot from "../Plot";
import styles from "../VolumeViewer.module.css";
import type { MapIteration } from "./volumeMath";

/** Frames per second of the playback. */
export const ITERATION_FPS = [1, 2, 4, 8];

type Props = {
  items: MapIteration[];
  index: number;
  playing: boolean;
  fps: number;
  /** Maps loaded (decoded) so far, by index. */
  loaded: boolean[];
  /** Width of the bar (the scene: it is under it). */
  width: number;
  onIndex: (i: number) => void;
  onPlaying: (p: boolean) => void;
  onFps: (fps: number) => void;
};

// Slot 1 of the validated categorical palette (dataviz), light and dark
const SERIES = { light: "#2a78d6", dark: "#3987e5" };
const CHART_HEIGHT = 150;

const fmtRes = (r: number | null | undefined) => (r ? `${r.toFixed(2)} Å` : "–");
const resolutionOf = (it: MapIteration) => it.classResolution ?? it.resolution ?? null;
/** Short label of an iteration for the x axis: its number, or "Final". */
const tick = (it: MapIteration) => (it.iteration === null || it.iteration === undefined ? "Final" : String(it.iteration));

/** Text colors of the viewer (its theme tokens), for the charts. */
function useInk(ref: React.RefObject<HTMLDivElement | null>) {
  const [ink, setInk] = useState({ text: "#52514e", grid: "rgba(128,128,128,0.25)", dark: false, surface: "#ffffff" });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const cs = getComputedStyle(el);
    const text = cs.color || ink.text;
    // Dark text: a light theme
    const m = text.match(/\d+/g)?.map(Number) ?? [82, 81, 78];
    const dark = (m[0] + m[1] + m[2]) / 3 > 128;
    setInk({ text, grid: dark ? "rgba(255,255,255,0.12)" : "rgba(0,0,0,0.10)", dark, surface: dark ? "#1a1a19" : "#ffffff" });
    // once mounted (the theme does not change under a viewer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return ink;
}

export default function IterationsBar(props: Props) {
  const { items, index, playing, fps, loaded, width } = props;
  const root = useRef<HTMLDivElement>(null);
  const ink = useInk(root);
  const cur = items[index];
  const nLoaded = loaded.filter(Boolean).length;
  const hasFsc = items.some((it) => it.fsc);
  const color = ink.dark ? SERIES.dark : SERIES.light;

  const axisStyle = { color: ink.text, gridcolor: ink.grid, zeroline: false, linecolor: ink.grid,
                      tickfont: { size: 10, color: ink.text }, title: { font: { size: 11, color: ink.text } } };
  const baseLayout = (title: string) => ({
    title: { text: title, font: { size: 12, color: ink.text }, x: 0.02, xanchor: "left", y: 0.97 },
    margin: { l: 48, r: 10, t: 26, b: 34 },
    paper_bgcolor: "rgba(0,0,0,0)",
    plot_bgcolor: "rgba(0,0,0,0)",
    showlegend: false,
    hoverlabel: { font: { size: 11 } },
    font: { color: ink.text },
  });

  // Per iteration: the shown one is a larger marker with a surface ring
  const perIteration = (y: (number | null)[], name: string, unit: string, digits: number) => {
    const x = items.map(tick);
    return {
      data: [
        { type: "scatter", mode: "lines+markers", x, y, name,
          line: { color, width: 2 }, marker: { color, size: 6 },
          connectgaps: false,
          hovertemplate: `%{x}: %{y:.${digits}f} ${unit}<extra></extra>` },
        { type: "scatter", mode: "markers", x: [x[index]], y: [y[index]], name: "shown",
          marker: { color, size: 12, line: { color: ink.surface, width: 2 } }, hoverinfo: "skip" },
      ],
      layout: {
        ...baseLayout(name),
        xaxis: { ...axisStyle, type: "category", title: { ...axisStyle.title, text: "Iteration" },
                 nticks: 12, fixedrange: true },
        yaxis: { ...axisStyle, title: { ...axisStyle.title, text: unit }, fixedrange: true },
        shapes: [{ type: "line", xref: "x", yref: "paper", x0: x[index], x1: x[index], y0: 0, y1: 1,
                   line: { color: ink.grid, width: 1, dash: "dot" } }],
      },
    };
  };

  const resChart = useMemo(
    () => perIteration(items.map(resolutionOf), "Resolution per iteration", "Å", 2),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [items, index, ink, color]);
  const fscChart = useMemo(() => {
    if (!hasFsc) return null;
    // FSC of the shown iteration against the spatial frequency (linear, as
    // Relion), the ticks labelled in Å; the 0.143 criterion dashed. The axis
    // is the same for every iteration, so the curves can be compared
    const f = cur?.fsc;
    const x: number[] = [], y: number[] = [], res: number[] = [];
    if (f) {
      f.resolution.forEach((r, i) => {
        if (r > 0) {
          x.push(r);
          y.push(f.fsc[i]);
          res.push(1 / r);
        }
      });
    }
    let fmax = 0;
    for (const it of items) for (const r of it.fsc?.resolution ?? []) fmax = Math.max(fmax, r);
    const tickvals = [1, 2, 3, 4].map((k) => (fmax * k) / 4);
    return {
      data: [{ type: "scatter", mode: "lines+markers", x, y, customdata: res, name: "FSC",
               line: { color, width: 2 }, marker: { color, size: 5 },
               hovertemplate: "%{customdata:.1f} Å: %{y:.3f}<extra></extra>" }],
      layout: {
        ...baseLayout(`FSC — ${cur?.label ?? ""}${f ? "" : " (none)"}`),
        xaxis: { ...axisStyle, title: { ...axisStyle.title, text: "Resolution (Å)" },
                 range: [0, fmax * 1.02], tickvals, ticktext: tickvals.map((v) => (1 / v).toFixed(1)),
                 fixedrange: true },
        yaxis: { ...axisStyle, range: [-0.1, 1.05], fixedrange: true },
        shapes: [{ type: "line", xref: "paper", x0: 0, x1: 1, y0: 0.143, y1: 0.143,
                   line: { color: ink.text, width: 1, dash: "dash" } }],
        annotations: [{ xref: "paper", x: 1, y: 0.143, yanchor: "bottom", xanchor: "right", showarrow: false,
                        text: "0.143", font: { size: 10, color: ink.text } }],
      },
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, index, ink, color, hasFsc]);

  const onPointClick = (e: any) => {
    const pt = e?.points?.[0];
    if (pt && typeof pt.pointIndex === "number" && pt.curveNumber === 0) props.onIndex(pt.pointIndex);
  };

  const parts = [cur?.label ?? ""];
  const res = cur ? resolutionOf(cur) : null;
  if (res) parts.push(fmtRes(res));
  if (cur?.classDistribution !== null && cur?.classDistribution !== undefined && !hasFsc) {
    parts.push(`${(100 * cur.classDistribution).toFixed(1)}% of the particles`);
  }
  // Two charts side by side; the resolution alone takes the whole width
  const chartW = fscChart ? Math.max(160, Math.floor((width - 12) / 2)) : width;
  return (
    <div ref={root} className={styles.iterBar} style={{ width }}>
      <div className={styles.iterRow}>
        <button type="button" className={styles.iterPlay} title={playing ? "Pause" : "Play the iterations"}
                onClick={() => props.onPlaying(!playing)}>
          {playing ? <Pause size={16} /> : <Play size={16} />}
        </button>
        <input type="range" min={0} max={items.length - 1} step={1} value={index}
               aria-label="Iteration" className={styles.iterSlider}
               onChange={(e) => { props.onPlaying(false); props.onIndex(Number(e.target.value)); }} />
        <span className={styles.iterLabel}>{parts.join(" · ")}</span>
        <select value={fps} title="Iterations per second" onChange={(e) => props.onFps(Number(e.target.value))}>
          {ITERATION_FPS.map((f) => <option key={f} value={f}>{f}/s</option>)}
        </select>
        {nLoaded < items.length && (
          <span className={styles.iterLoaded} title="Maps loaded (all are loaded in the background)">
            {nLoaded}/{items.length} loaded
          </span>
        )}
      </div>
      <div className={styles.iterCharts}>
        <div style={{ width: chartW }}>
          <Plot data={resChart.data} layout={resChart.layout} height={CHART_HEIGHT}
                config={{ displayModeBar: false, responsive: true }} onClick={onPointClick} />
        </div>
        {fscChart && (
          <div style={{ width: chartW }}>
            <Plot data={fscChart.data} layout={fscChart.layout} height={CHART_HEIGHT}
                  config={{ displayModeBar: false, responsive: true }} />
          </div>
        )}
      </div>
    </div>
  );
}
