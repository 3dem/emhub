// src/components/viewers/volume/DensityPanel.tsx
//
// Side panel of the "3D volume" tab: the histogram of the voxel values (in
// the units of the map, from the host) with the threshold on it (click or
// drag to move it), the threshold, the share of voxels it encloses, the
// opacity, color and the detail of the grid. Beside the scene its two groups
// (threshold and dark density; surface options) are stacked; below it
// (`width`) they are two columns, so the panel is about half as high.
import { useLayoutEffect, useRef, type PointerEvent as ReactPointerEvent } from "react";
import styles from "../VolumeViewer.module.css";
import type { VolumeDensity } from "./volumeMath";

type Histogram = NonNullable<VolumeDensity["histogram"]>;

export type DensityOptions = {
  threshold: number;
  below: boolean;
  opacity: number;
  color: string;
  /** Hide the blobs of fewer grid voxels (0: off). */
  dust: number;
  /** Smooth the surface (display only). */
  smooth: boolean;
};

/** Dust sizes (grid voxels) of the slider. */
const DUST_SIZES = [2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000];

/** Detail levels: the most voxels of the binned grid. */
export const DETAILS: [number, string][] = [
  [1_000_000, "Low (≤ 1 M voxels)"],
  [2_000_000, "Medium (≤ 2 M voxels)"],
  [8_000_000, "High (≤ 8 M voxels)"],
];

/** Counts of the grid the surface is computed from (or of the full volume). */
function surfaceCounts(h: Histogram) {
  const shown = h.shown?.length === h.counts.length;
  return {
    counts: shown ? h.shown! : h.counts,
    below: (shown ? h.shownBelow : h.below) ?? 0,
    above: (shown ? h.shownAbove : h.above) ?? 0,
  };
}

/** Share (0-1) of the voxels above (or below) `t`, interpolated in its bin. */
export function enclosedFraction(h: Histogram, t: number, below: boolean): number {
  const { counts, below: nb, above: na } = surfaceCounts(h);
  const [lo, hi] = h.range;
  const total = counts.reduce((s, c) => s + c, 0) + nb + na;
  if (!total) return 0;
  const B = counts.length;
  const u = ((t - lo) / (hi - lo)) * B;
  let under = nb;
  for (let i = 0; i < B; i++) {
    if (u >= i + 1) under += counts[i];
    else if (u > i) under += counts[i] * (u - i);
  }
  if (u >= B) under += na;
  return below ? under / total : 1 - under / total;
}

/** The threshold that encloses `frac` of the voxels (above it, or below). */
export function levelForFraction(h: Histogram, frac: number, below: boolean): number {
  const { counts, below: nb, above: na } = surfaceCounts(h);
  const [lo, hi] = h.range;
  const total = counts.reduce((s, c) => s + c, 0) + nb + na;
  const B = counts.length;
  const want = (below ? frac : 1 - frac) * total;
  let acc = nb;
  for (let i = 0; i < B; i++) {
    if (acc + counts[i] >= want) {
      const k = counts[i] ? (want - acc) / counts[i] : 0;
      return lo + ((i + Math.max(0, Math.min(1, k))) / B) * (hi - lo);
    }
    acc += counts[i];
  }
  return hi;
}

/** 4 significant digits, without exponent for usual map values. */
export function fmt(v: number): string {
  if (!isFinite(v)) return "–";
  const a = Math.abs(v);
  if (a !== 0 && (a < 1e-3 || a >= 1e5)) return v.toExponential(3);
  return String(Number(v.toPrecision(4)));
}

const W = 236, H = 92;

function HistogramPlot({ h, binned, threshold, below, color, onThreshold }: {
  h: Histogram;
  /** Also draw the counts of the binned grid. */
  binned: boolean;
  threshold: number;
  below: boolean;
  color: string;
  onThreshold: (t: number) => void;
}) {
  const [lo, hi] = h.range;
  const ref = useRef<SVGSVGElement>(null);
  const dragging = useRef(false);
  // Log counts, each curve to its own maximum (the grids have other sizes)
  const path = (counts: number[], closed: boolean) => {
    const top = Math.log1p(Math.max(1, ...counts));
    const B = counts.length;
    let d = closed ? `M0,${H}` : "";
    counts.forEach((c, i) => {
      const y = H - (Math.log1p(c) / top) * (H - 4);
      d += `${d ? "L" : "M"}${(i / B) * W},${y}L${((i + 1) / B) * W},${y}`;
    });
    return closed ? `${d}L${W},${H}Z` : d;
  };
  const x = Math.max(0, Math.min(W, ((threshold - lo) / (hi - lo)) * W));
  const pick = (e: ReactPointerEvent<SVGSVGElement>) => {
    const r = ref.current!.getBoundingClientRect();
    const k = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
    onThreshold(lo + k * (hi - lo));
  };
  return (
    <svg ref={ref} className={styles.hist} viewBox={`0 0 ${W} ${H}`} width={W} height={H}
         onPointerDown={(e) => { dragging.current = true; e.currentTarget.setPointerCapture(e.pointerId); pick(e); }}
         onPointerMove={(e) => { if (dragging.current) pick(e); }}
         onPointerUp={() => { dragging.current = false; }}>
      <title>Click or drag to set the threshold</title>
      <rect x={below ? 0 : x} width={below ? x : W - x} y={0} height={H} fill={color} opacity={0.14} />
      <path d={path(h.counts, true)} className={styles.histFull} />
      {binned && h.shown && <path d={path(h.shown!, false)} className={styles.histShown} />}
      <line x1={x} x2={x} y1={0} y2={H} className={styles.histThr} />
    </svg>
  );
}

type Props = DensityOptions & {
  density: VolumeDensity;
  /** Full volume [X, Y, Z]. */
  dims: [number, number, number];
  /** Detail (max voxels) when the host can send other grids. */
  detail?: number;
  onDetail?: (maxVoxels: number) => void;
  loading?: boolean;
  /** Blobs hidden as dust. */
  hidden?: number;
  onChange: (patch: Partial<DensityOptions>) => void;
  /** Most height (it scrolls when longer). */
  maxHeight?: number;
  /** Below the scene: this width, the two groups side by side. */
  width?: number;
  /** The height the panel needs to show without scrolling. */
  onHeight?: (height: number) => void;
};

export default function DensityPanel(props: Props) {
  const { density: d, threshold, below, opacity, color, onChange } = props;
  const h = d.histogram;
  const s = d.stats;
  const [nz, ny, nx] = d.shape;
  const lo = h?.range[0] ?? d.valueRange[0];
  const hi = h?.range[1] ?? d.valueRange[1];
  const step = Number(((hi - lo) / 400).toPrecision(2)) || 0.001;
  const sigma = s && s.std > 0 ? (threshold - s.mean) / s.std : null;
  const frac = h ? enclosedFraction(h, threshold, below) : null;

  // Its natural height (scrollHeight also counts what is scrolled out)
  const root = useRef<HTMLDivElement>(null);
  const onHeight = props.onHeight;
  useLayoutEffect(() => {
    if (root.current && onHeight) onHeight(root.current.scrollHeight);
  });

  const cols = props.width !== undefined;
  return (
    <div ref={root} className={cols ? `${styles.isoPanel} ${styles.isoCols}` : styles.isoPanel}
         style={{ maxHeight: props.maxHeight, width: props.width }}>
      <div className={styles.isoGroup}>
        {h ? (
          <>
            <HistogramPlot h={h} binned={d.binning > 1} threshold={threshold} below={below} color={color}
                           onThreshold={(t) => onChange({ threshold: t })} />
            <div className={styles.histAxis}><span>{fmt(lo)}</span><span>{fmt(hi)}</span></div>
            <div className={styles.histLegend}>
              <span><i className={styles.keyFull} /> Full volume</span>
              {d.binning > 1 && h.shown && <span><i className={styles.keyShown} /> Scaled grid (surface)</span>}
            </div>
          </>
        ) : <div className={styles.msg}>No histogram from the host.</div>}

        <label className={styles.panelSelect}>
          <span>Threshold</span>
          <input type="number" className={styles.isoNumber} value={Number(threshold.toPrecision(5))} step={step}
                 onChange={(e) => { const v = Number(e.target.value); if (isFinite(v) && e.target.value !== "") onChange({ threshold: v }); }} />
        </label>
        <input type="range" className={styles.isoRange} min={lo} max={hi} step={step} value={threshold}
               onChange={(e) => onChange({ threshold: Number(e.target.value) })} />
        <div className={styles.isoNote}>
          {sigma !== null && <>{sigma >= 0 ? "mean + " : "mean − "}{Math.abs(sigma).toFixed(2)} σ</>}
          {frac !== null && <>{sigma !== null && " · "}encloses {(frac * 100).toPrecision(2)}% of the voxels</>}
        </div>
        <label className={styles.panelRow} title="Linked to the Invert button of the toolbar">
          <input type="checkbox" checked={below} onChange={(e) => onChange({ below: e.target.checked })} />
          Dark density (enclose values below)
        </label>
      </div>

      <div className={styles.isoGroup}>
        <label className={styles.panelRow}>
          <input type="checkbox" checked={props.dust > 0}
                 onChange={(e) => onChange({ dust: e.target.checked ? 20 : 0 })} />
          Hide dust{props.dust > 0 && props.hidden ? ` (${props.hidden} blobs)` : ""}
        </label>
        {props.dust > 0 && (
          <div className={styles.panelSub}>
            <span>Blobs smaller than {props.dust} voxels</span>
            <input type="range" min={0} max={DUST_SIZES.length - 1} step={1}
                   value={DUST_SIZES.reduce((b, v, i) => (Math.abs(v - props.dust) < Math.abs(DUST_SIZES[b] - props.dust) ? i : b), 0)}
                   onChange={(e) => onChange({ dust: DUST_SIZES[Number(e.target.value)] })} />
          </div>
        )}
        <label className={styles.panelRow}>
          <input type="checkbox" checked={props.smooth} onChange={(e) => onChange({ smooth: e.target.checked })} />
          Smooth the surface (display only)
        </label>

        <label className={styles.panelSelect}>
          <span>Opacity</span>
          <input type="range" min={5} max={100} step={1} value={Math.round(opacity * 100)} style={{ flex: 1, minWidth: 0 }}
                 onChange={(e) => onChange({ opacity: Number(e.target.value) / 100 })} />
          <span className={styles.isoValue}>{Math.round(opacity * 100)}%</span>
        </label>

        <label className={styles.panelSelect}>
          <span>Color</span>
          <input type="color" className={styles.panelColor} style={{ marginLeft: 0 }} value={color}
                 onChange={(e) => onChange({ color: e.target.value })} />
        </label>

        {props.onDetail && (
          <label className={styles.panelSelect}>
            <span>Detail</span>
            <select value={props.detail} disabled={props.loading}
                    onChange={(e) => props.onDetail!(Number(e.target.value))}>
              {DETAILS.map(([v, label]) => <option key={v} value={v}>{label}</option>)}
            </select>
          </label>
        )}

        <div className={styles.isoNote}>
          {props.loading ? "Loading the grid…" : (
            <>
              Grid {nx} × {ny} × {nz}
              {d.binning > 1
                ? <> ({d.method ?? `binned ×${d.binning}`} from {props.dims.join(" × ")})</>
                : " (full resolution)"}
            </>
          )}
          {s && <><br />Full volume: min {fmt(s.min)}, max {fmt(s.max)}, mean {fmt(s.mean)}, σ {fmt(s.std)}</>}
        </div>
      </div>
    </div>
  );
}
