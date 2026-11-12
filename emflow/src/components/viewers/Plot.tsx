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

/** Dark-mode text colors: titles near white, axis titles and legends light,
 * tick labels a little dimmer. */
const DARK_INK = { title: "#f8fafc", text: "#e2e8f0", tick: "#cbd5e1" };

function rgbOf(color: string): [number, number, number] | null {
  const c = color.trim();
  let m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(c);
  if (m) {
    const h = m[1].length === 3 ? m[1].replace(/./g, "$&$&") : m[1];
    return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) as [number, number, number];
  }
  m = /^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)/i.exec(c);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

/** A text color set by the figure, readable on a dark background: a dark
 * gray becomes `neutral`, a dark color is lightened, others are kept. */
function darkText(color: unknown, neutral: string): string {
  if (typeof color !== "string") return neutral;
  const rgb = rgbOf(color);
  if (!rgb) return color;
  const [r, g, b] = rgb;
  if ((0.2126 * r + 0.7152 * g + 0.0722 * b) / 255 >= 0.55) return color;
  if (Math.max(r, g, b) - Math.min(r, g, b) < 40) return neutral;
  const mix = (v: number) => Math.round(v + (255 - v) * 0.6);
  return `rgb(${mix(r)},${mix(g)},${mix(b)})`;
}

/** A title, legend or tick font object ({text?, font?}, or a string title)
 * with its font color readable on a dark background. */
function withFont(v: any, neutral: string): any {
  const o = typeof v === "string" ? { text: v } : (v ?? {});
  return { ...o, font: { ...(o.font ?? {}), color: darkText(o.font?.color, neutral) } };
}

/** The layout with dark-mode defaults (transparent background, light text,
 * faint grid and axis lines) when dark, unchanged otherwise. Values set in
 * the layout win, except the backgrounds and the dark text colors, which
 * are made light. */
export function themedLayout(layout: Record<string, any> = {}, dark: boolean): Record<string, any> {
  if (!dark) return layout;
  const axis = { gridcolor: "rgba(148,163,184,0.16)", zerolinecolor: "rgba(148,163,184,0.38)",
                 linecolor: "rgba(148,163,184,0.38)", tickcolor: "rgba(148,163,184,0.38)" };
  const legend = { bgcolor: "rgba(0,0,0,0)", ...(layout.legend ?? {}) };
  const out: Record<string, any> = {
    ...layout,
    paper_bgcolor: "rgba(0,0,0,0)",
    plot_bgcolor: "rgba(0,0,0,0)",
    font: { ...(layout.font ?? {}), color: darkText(layout.font?.color, DARK_INK.text) },
    legend: { ...withFont(legend, DARK_INK.text),
              ...(legend.title != null ? { title: withFont(legend.title, DARK_INK.text) } : {}) },
  };
  if (out.title != null) out.title = withFont(out.title, DARK_INK.title);
  for (const key of ["xaxis", "yaxis"]) {
    if (!out[key]) out[key] = {};
  }
  for (const key of Object.keys(out)) {
    if (!/^[xy]axis\d*$/.test(key)) continue;
    const a = { ...axis, ...(out[key] ?? {}) };
    // Light gray grid and axis lines set by the figure (e.g. #e6e6e6): faint
    for (const line of Object.keys(axis) as (keyof typeof axis)[]) {
      const rgb = typeof a[line] === "string" ? rgbOf(a[line]) : null;
      if (rgb && Math.max(...rgb) - Math.min(...rgb) < 40
          && (0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2]) / 255 >= 0.55) a[line] = axis[line];
    }
    if (typeof a.color === "string") a.color = darkText(a.color, DARK_INK.text);
    a.tickfont = { ...(a.tickfont ?? {}), color: darkText(a.tickfont?.color, DARK_INK.tick) };
    if (a.title != null) a.title = withFont(a.title, DARK_INK.text);
    out[key] = a;
  }
  // Annotations: light text; a white box (e.g. the FSC resolution) dark
  if (Array.isArray(out.annotations)) {
    out.annotations = out.annotations.map((a: any) => ({
      ...a,
      font: { ...(a?.font ?? {}), color: darkText(a?.font?.color, DARK_INK.text) },
      ...(/^rgba?\(255,\s*255,\s*255/.test(String(a?.bgcolor ?? "")) ? { bgcolor: "rgba(17,24,39,0.85)" } : {}),
    }));
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
