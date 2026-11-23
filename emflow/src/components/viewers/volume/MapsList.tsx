// src/components/viewers/volume/MapsList.tsx
//
// Authors: Daniel Marchan (danielmarchan3@gmail.com)
//
// The maps of VolumeViewer's 3D volume tab when it has overlays (other maps
// on the same box, e.g. the references of a 3D classification), in the side
// panel instead of the histogram and threshold of a single map
// (DensityPanel's `maps`): a row per map (the volume first, then each
// overlay) with its checkbox, color swatch, short name (the full one in its
// tooltip) and opacity, and under it its threshold slider with the share of
// the voxels it encloses. Each slider moves only its map (each map starts
// at the same share of its voxels as the volume). The header can link the
// thresholds: every map then encloses the same share of its voxels, so maps
// of other scales show at a comparable size, and any slider moves them all.
import { Link2, Unlink } from "lucide-react";
import styles from "../VolumeViewer.module.css";
import { enclosedFraction, fmt } from "./DensityPanel";
import type { VolumeDensity } from "./volumeMath";

/** The options of an overlay chosen by the user. */
export type OverlayOptions = {
  show: boolean;
  /** CSS hex. */
  color: string;
  /** 0-1. */
  opacity: number;
  /** Threshold in its map units (used when the thresholds are not linked;
   * null until the map is loaded). */
  threshold: number | null;
};

/** A map of the list (the volume or an overlay). */
export type MapItem = {
  /** Short name ("Class 2"). */
  label: string;
  /** Full name, in the tooltip (e.g. the file). */
  description?: string;
  show: boolean;
  color: string;
  opacity: number;
  /** Decoded map, null while it loads (or if it failed). */
  density: VolumeDensity | null;
  /** Loading or error of the map (null: shown). */
  status: string | null;
  /** The threshold it takes now (linked or its own). */
  current: number | null;
};

export type MapPatch = Partial<Pick<OverlayOptions, "show" | "color" | "opacity">> & { threshold?: number };

type Props = {
  /** The volume first, then the overlays. */
  items: MapItem[];
  linked: boolean;
  /** Enclose the values below the threshold (the volume's dark density). */
  below: boolean;
  onLinked: (linked: boolean) => void;
  /** index in items (0: the volume). */
  onChange: (index: number, patch: MapPatch) => void;
  /** Most maps shown at a time (tiled): the others can not be checked. */
  maxShown?: number;
};

const pct = (f: number) => `${(f * 100).toFixed(f < 0.01 ? 2 : 1)}%`;

export default function MapsList({ items, linked, below, onLinked, onChange, maxShown }: Props) {
  const full = maxShown !== undefined && items.filter((o) => o.show).length >= maxShown;
  return (
    <div className={styles.mapsList}>
      <div className={styles.layersHead}>
        <span className={styles.layersTitle}>Maps</span>
        <button type="button" className={styles.layersIconBtn} aria-pressed={linked}
                data-active={linked || undefined} onClick={() => onLinked(!linked)}
                title={linked ? "Thresholds linked: every map encloses the same share of its voxels "
                                + "(click to set each one)"
                              : "Thresholds set per map (click to link them)"}>
          {linked ? <Link2 size={14} /> : <Unlink size={14} />}
        </button>
      </div>

      {items.map((o, i) => {
        const h = o.density?.histogram;
        const range = h?.range ?? o.density?.valueRange ?? null;
        const enclosed = h && o.current !== null ? enclosedFraction(h, o.current, below) : null;
        return (
          <div key={i} className={styles.layersItem} data-hidden={!o.show || undefined}>
            <div className={styles.layersRow} title={o.description ?? o.label}>
              <input type="checkbox" checked={o.show} aria-label={`Show ${o.label}`}
                     disabled={!o.show && full}
                     title={!o.show && full ? `At most ${maxShown} maps side by side: hide one first` : undefined}
                     onChange={(e) => onChange(i, { show: e.target.checked })} />
              <label className={styles.layersSwatch} style={{ background: o.color }} title={`Color of ${o.label}`}>
                <input type="color" value={o.color} onChange={(e) => onChange(i, { color: e.target.value })} />
              </label>
              <span className={styles.layersName}>{o.label}</span>
              {o.density ? (
                <input type="range" className={styles.layersOpacity} min={5} max={100} step={1}
                       value={Math.round(o.opacity * 100)} disabled={!o.show}
                       title={`Opacity: ${Math.round(o.opacity * 100)}%`} aria-label={`Opacity of ${o.label}`}
                       onChange={(e) => onChange(i, { opacity: Number(e.target.value) / 100 })} />
              ) : (
                <span className={styles.layersStatus} title={o.status ?? undefined}>{o.status ? "…" : ""}</span>
              )}
            </div>
            {o.status && !o.density && o.status.startsWith("Could") && (
              <div className={styles.layersSub}>{o.status}</div>
            )}
            {o.density && range && (
              <div className={styles.layersSub}
                   title={o.current !== null ? `Threshold ${fmt(o.current)}`
                     + (enclosed !== null ? `, ${pct(enclosed)} of the voxels` : "") : undefined}>
                <input type="range" min={range[0]} max={range[1]} step={(range[1] - range[0]) / 500}
                       value={o.current ?? range[0]} disabled={!o.show}
                       aria-label={`Threshold of ${o.label}`}
                       onChange={(e) => onChange(i, { threshold: Number(e.target.value) })} />
                {enclosed !== null && <span className={styles.mapsPct}>{pct(enclosed)}</span>}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
