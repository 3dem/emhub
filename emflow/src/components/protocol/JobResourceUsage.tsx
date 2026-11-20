// src/components/protocol/JobResourceUsage.tsx
// Resource usage of the profiled runs of a job (EMWRAP_PROFILE or the
// 'profile' param, recorded by the emtools ResourceMonitor in
// <job>/profile/runNN.csv): metric tiles from the run summary and one chart
// with CPU, memory and GPU utilization over time. Shown in the "Resource
// usage" tab of ClusterJobDialog.
import { useMemo, useState } from "react";
import { Box, Chip, Typography } from "@mui/material";

import Plot from "@/lib/plot";
import { useTheme } from "@/context/ThemeContext";
import type { JobProfileRun } from "@/services/ProjectService";

const GPU_COLORS = ["#16a34a", "#9333ea", "#ea580c", "#0891b2", "#db2777", "#65a30d", "#4f46e5", "#ca8a04"];

function fmtNumber(v: any, digits = 1): string {
  const n = Number(v);
  return v == null || v === "" || !Number.isFinite(n) ? "-" : n.toFixed(digits);
}

function fmtDuration(seconds?: number | null): string {
  if (seconds == null) return "-";
  const s = Math.round(seconds);
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  return h ? `${h}h ${m}m` : m ? `${m}m ${r}s` : `${r}s`;
}

function Tile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <Box sx={{ bgcolor: "action.hover", borderRadius: 1, px: 1.5, py: 1, minWidth: 0 }}>
      <Typography variant="caption" sx={{ color: "text.secondary", display: "block" }} noWrap>
        {label}
      </Typography>
      <Typography variant="body1" sx={{ fontWeight: 600, lineHeight: 1.3 }} noWrap>{value}</Typography>
      {sub && (
        <Typography variant="caption" sx={{ color: "text.secondary", display: "block" }} noWrap>{sub}</Typography>
      )}
    </Box>
  );
}

/** "avg / max" of a summary column (scaled), e.g. CPU in cores. */
function avgMax(summary: any, key: string, scale = 1, digits = 1, unit = ""): string {
  const s = summary?.[key];
  if (!s) return "-";
  return `${fmtNumber(s.avg / scale, digits)} / ${fmtNumber(s.max / scale, digits)}${unit}`;
}

/** Latest sample of a run being recorded, in one line. */
export function latestSampleText(latest: Record<string, any>, gpus: string[] = []): string {
  const parts = [`CPU ${fmtNumber(Number(latest.cpu) / 100)} cores`,
                 `RSS ${fmtNumber(latest.rss_gb, 2)} GiB`];
  if (latest.read_mbs !== "" && latest.read_mbs != null) {
    parts.push(`I/O ${fmtNumber(latest.read_mbs)} / ${fmtNumber(latest.write_mbs)} MB/s`);
  }
  for (const g of gpus) {
    parts.push(`GPU${g} ${fmtNumber(latest[`gpu${g}_util`], 0)}% ${fmtNumber(latest[`gpu${g}_mem_gb`])} GiB`);
  }
  return parts.join(" · ");
}

/** fill: grow the chart to the height of the parent (a flex column), for
 * the expanded dialog. */
export default function JobResourceUsage({ profiles, fill = false }: { profiles: JobProfileRun[]; fill?: boolean }) {
  const { theme } = useTheme();
  const dark = theme === "dark";
  const [selected, setSelected] = useState(profiles.length - 1);
  const profile = profiles[Math.min(selected, profiles.length - 1)];
  const summary = profile?.summary || {};
  const series = profile?.series || {};
  const gpus = profile?.gpus || [];

  const { data, layout } = useMemo(() => {
    const minutes = (series.time || []).map((t) => (t == null ? null : t / 60));
    const ink = dark ? "#e5e7eb" : "#334155";
    const grid = dark ? "rgba(255,255,255,0.12)" : "rgba(0,0,0,0.08)";
    const hasGpus = gpus.length > 0;
    // Stacked panels sharing the time axis: CPU, memory and (if any) GPUs
    const domains = hasGpus ? [[0.7, 1], [0.37, 0.63], [0, 0.3]] : [[0.55, 1], [0, 0.45]];
    const line = (name: string, y: any[], color: string, axis: string, dash?: string, hover = "%{y:.2f}") => ({
      x: minutes, y, name, type: "scatter", mode: "lines", yaxis: axis,
      line: { color, width: 1.5, dash }, connectgaps: false,
      hovertemplate: `${name}: ${hover}<extra></extra>`,
    });
    const traces: any[] = [
      line("CPU (cores)", (series.cpu || []).map((v) => (v == null ? null : v / 100)), "#2563eb", "y", undefined, "%{y:.1f}"),
      line("RSS (GiB)", series.rss_gb || [], "#dc2626", "y2"),
    ];
    gpus.forEach((g, i) => {
      const color = GPU_COLORS[i % GPU_COLORS.length];
      if (series[`gpu${g}_mem_gb`]) traces.push(line(`GPU${g} memory (GiB)`, series[`gpu${g}_mem_gb`], color, "y2", "dot"));
      if (series[`gpu${g}_util`]) traces.push(line(`GPU${g} util (%)`, series[`gpu${g}_util`], color, "y3", undefined, "%{y:.0f}"));
    });
    const axis = (title: string, domain: number[], extra: any = {}) => ({
      title: { text: title, font: { size: 11 } }, domain, gridcolor: grid, zerolinecolor: grid,
      rangemode: "tozero", tickfont: { size: 10 }, ...extra,
    });
    const lay: any = {
      height: fill ? undefined : hasGpus ? 330 : 250,
      autosize: fill,
      margin: { l: 55, r: 10, t: 5, b: 35 },
      paper_bgcolor: "rgba(0,0,0,0)", plot_bgcolor: "rgba(0,0,0,0)",
      font: { color: ink, size: 11 },
      showlegend: true,
      legend: { orientation: "h", y: -0.18, font: { size: 10 } },
      hovermode: "x unified",
      xaxis: { title: { text: "Minutes", font: { size: 11 } }, gridcolor: grid, anchor: hasGpus ? "y3" : "y2", tickfont: { size: 10 } },
      yaxis: axis("CPU (cores)", domains[0]),
      yaxis2: axis("Memory (GiB)", domains[1]),
    };
    if (hasGpus) lay.yaxis3 = axis("GPU (%)", domains[2], { range: [0, 105] });
    return { data: traces, layout: lay };
  }, [series, gpus, dark, fill]);

  if (!profile) return null;
  const s: any = summary;
  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 1.25, ...(fill ? { flex: 1, minHeight: 0 } : {}) }}>
      {profiles.length > 1 && (
        <Box sx={{ display: "flex", gap: 0.75, alignItems: "center", flexWrap: "wrap" }}>
          <Typography variant="caption" sx={{ color: "text.secondary" }}>Run</Typography>
          {profiles.map((p, i) => (
            <Chip key={p.run} size="small" label={p.run}
                  color={i === selected ? "primary" : "default"}
                  variant={i === selected ? "filled" : "outlined"}
                  onClick={() => setSelected(i)} />
          ))}
        </Box>
      )}
      <Box sx={{ display: "grid", gap: 1, gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))" }}>
        <Tile label="Duration" value={fmtDuration(s.duration)} sub={`${profile.samples ?? s.samples ?? "-"} samples, every ${profile.interval ?? "-"} s`} />
        <Tile label="CPU, avg / max" value={avgMax(s, "cpu", 100, 1, " cores")} />
        <Tile label="Memory (RSS), max" value={s.rss_gb ? `${fmtNumber(s.rss_gb.max, 2)} GiB` : "-"}
              sub={s.rss_gb ? `avg ${fmtNumber(s.rss_gb.avg, 2)} GiB` : undefined} />
        {s.read_gb != null && (
          <Tile label="I/O, read / written" value={`${fmtNumber(s.read_gb)} / ${fmtNumber(s.write_gb)} GB`} />
        )}
        {gpus.map((g) => (
          <Tile key={g} label={`GPU${g}, util avg / max`} value={avgMax(s, `gpu${g}_util`, 1, 0, "%")}
                sub={s[`gpu${g}_mem_gb`] ? `memory max ${fmtNumber(s[`gpu${g}_mem_gb`].max)} GiB` : undefined} />
        ))}
      </Box>
      {(series.time || []).length > 1 ? (
        <Box sx={fill ? { flex: 1, minHeight: 300 } : undefined}>
          <Plot data={data as any} layout={layout as any}
                config={{ displaylogo: false, displayModeBar: false, responsive: true }}
                style={{ width: "100%", height: fill ? "100%" : layout.height }} useResizeHandler />
        </Box>
      ) : (
        <Typography variant="body2" sx={{ color: "text.secondary" }}>Not enough samples to plot yet.</Typography>
      )}
      <Typography variant="caption" sx={{ color: "text.secondary" }}>
        {profile.latest
          ? `Run ${profile.run} still recording, last sample ${profile.latest.age ?? "?"} s ago. `
          : `Run ${profile.run}${profile.start ? `, ${profile.start}` : ""}${profile.end ? ` to ${profile.end}` : ""}. `}
        CPU and memory of the job processes; GPUs as seen in the node. {profile.file}
      </Typography>
    </Box>
  );
}
