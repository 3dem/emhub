// src/components/viewers/Plot.tsx
//
// A Plotly figure ({data, layout, config}), given inline or loaded with the
// DataLoader (`source`). Mountable from the host (EMFlow.mount("Plot", ...)).
// String titles are turned into {text} objects: plotly.js 3 only takes those.
import { Box, Typography } from "@mui/material";
import PlotlyPlot from "@/lib/plot";
import { useLoad } from "@/data/DataLoaderContext";
import { useTheme } from "@/context/ThemeContext";

export type PlotFigure = {
  data?: any[];
  layout?: Record<string, any>;
  config?: Record<string, any>;
};

export type PlotProps = PlotFigure & {
  /** Load the figure ({data, layout, config} or {figure: ...}) instead. */
  source?: { path: string; payload?: unknown };
  /** Height in px, or "100%" to fill the container (default 360). */
  height?: number | string;
  onClick?: (event: any) => void;
  onHover?: (event: any) => void;
  onUnhover?: (event: any) => void;
  onSelected?: (event: any) => void;
  onRelayout?: (event: any) => void;
};

const AXIS_RE = /^[xy]axis\d*$|^zaxis$/;

/** layout.title and axis titles as {text: ...} (plotly.js 3 drops strings). */
export function normalizeTitles(layout: Record<string, any> = {}): Record<string, any> {
  const fix = (t: unknown) => (typeof t === "string" ? { text: t } : t);
  const out: Record<string, any> = { ...layout };
  if ("title" in out) out.title = fix(out.title);
  for (const key of Object.keys(out)) {
    if (AXIS_RE.test(key) && out[key] && typeof out[key] === "object" && "title" in out[key]) {
      out[key] = { ...out[key], title: fix(out[key].title) };
    }
  }
  if (out.scene && typeof out.scene === "object") out.scene = normalizeTitles(out.scene);
  return out;
}

/** The layout with dark-mode defaults (transparent background, light text,
 * faint grid and axis lines) when dark, unchanged otherwise. Values set in
 * the layout win, except the backgrounds. */
export function themedLayout(layout: Record<string, any> = {}, dark: boolean): Record<string, any> {
  if (!dark) return layout;
  const ink = "#e2e8f0";
  const axis = { gridcolor: "rgba(148,163,184,0.16)", zerolinecolor: "rgba(148,163,184,0.38)",
                 linecolor: "rgba(148,163,184,0.38)", tickcolor: "rgba(148,163,184,0.38)" };
  const out: Record<string, any> = {
    ...layout,
    paper_bgcolor: "rgba(0,0,0,0)",
    plot_bgcolor: "rgba(0,0,0,0)",
    font: { color: ink, ...(layout.font ?? {}) },
    legend: { bgcolor: "rgba(0,0,0,0)", ...(layout.legend ?? {}) },
  };
  for (const key of Object.keys(out)) {
    if (/^[xy]axis\d*$/.test(key)) out[key] = { ...axis, ...(out[key] ?? {}) };
  }
  for (const key of ["xaxis", "yaxis"]) {
    if (!out[key]) out[key] = { ...axis };
  }
  // Annotations with a white box (e.g. the FSC resolution): a dark box
  if (Array.isArray(out.annotations)) {
    out.annotations = out.annotations.map((a: any) =>
      /^rgba?\(255,\s*255,\s*255/.test(String(a?.bgcolor ?? "")) ? { ...a, bgcolor: "rgba(17,24,39,0.85)" } : a);
  }
  return out;
}

export default function Plot({
  data,
  layout,
  config,
  source,
  height = 360,
  onClick,
  onHover,
  onUnhover,
  onSelected,
  onRelayout,
}: PlotProps) {
  const loaded = useLoad<any>(source?.path, source?.payload);
  const dark = useTheme().theme === "dark";
  const figure: PlotFigure = source
    ? (loaded.data?.figure ?? loaded.data ?? {})
    : { data, layout, config };

  if (source && loaded.status !== "ready") {
    return (
      <Box sx={{ height, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <Typography variant="body2" color="text.secondary">
          {loaded.status === "error" ? loaded.error.message : "Loading…"}
        </Typography>
      </Box>
    );
  }

  return (
    <Box sx={{ width: "100%", height, minHeight: 0 }}>
      <PlotlyPlot
        data={figure.data ?? []}
        layout={themedLayout({ autosize: true, ...normalizeTitles(figure.layout) }, dark)}
        config={{ displaylogo: false, responsive: true, ...figure.config }}
        style={{ width: "100%", height: "100%" }}
        useResizeHandler
        onClick={onClick}
        onHover={onHover}
        onUnhover={onUnhover}
        onSelected={onSelected}
        onRelayout={onRelayout}
      />
    </Box>
  );
}
