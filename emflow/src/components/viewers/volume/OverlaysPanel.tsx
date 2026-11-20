// src/components/viewers/volume/OverlaysPanel.tsx
//
// Authors: Daniel Marchan (danielmarchan3@gmail.com)
//
// The maps of VolumeViewer's 3D volume tab, in a panel opened by the Maps
// button of its toolbar: a compact row per map (the volume first, then each
// overlay: another map on the same box, e.g. the references of a 3D
// classification) with its checkbox, color swatch, short name (the full one
// in its tooltip) and opacity. The header links the thresholds (on by
// default: every overlay
// encloses the same share of its voxels as the volume at its threshold, so
// maps of other scales show at a comparable size); unlinked, each overlay
// gets a threshold slider under its row. The panel is never higher than
// `maxHeight` (the 3D view): it scrolls inside.
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

export type OverlayItem = OverlayOptions & {
  /** Short name ("Class 2"). */
  label: string;
  /** Full name, in the tooltip (e.g. the file). */
  description?: string;
  /** Decoded map, null while it loads (or if it failed). */
  density: VolumeDensity | null;
  /** Loading or error of the map (null: shown). */
  status: string | null;
  /** The threshold it takes now (linked or its own). */
  current: number | null;
};

type Props = {
  /** Short name, full name, color and show of the volume itself. */
  mainLabel: string;
  mainDescription?: string;
  mainColor: string;
  showMain: boolean;
  items: OverlayItem[];
  linked: boolean;
  /** Enclose the values below the threshold (the volume's dark density). */
  below: boolean;
  /** Most height (px): the panel scrolls inside. */
  maxHeight?: number;
  onShowMain: (show: boolean) => void;
  onLinked: (linked: boolean) => void;
  onChange: (index: number, patch: Partial<OverlayOptions>) => void;
};

const pct = (f: number) => `${(f * 100).toFixed(f < 0.01 ? 2 : 1)}%`;

export default function OverlaysPanel(props: Props) {
  const { items, linked, below, onChange } = props;

  return (
    <div className={`${styles.panel} ${styles.layers}`} role="dialog" aria-label="Maps"
         style={props.maxHeight ? { maxHeight: props.maxHeight } : undefined}>
      <div className={styles.layersHead}>
        <span className={styles.layersTitle}>Maps</span>
        <button type="button" className={styles.layersIconBtn} aria-pressed={linked}
                data-active={linked || undefined} onClick={() => props.onLinked(!linked)}
                title={linked ? "Thresholds linked: every map encloses the same share of its voxels as the "
                                + "volume (click to set each one)"
                              : "Thresholds set per map (click to link them to the volume's)"}>
          {linked ? <Link2 size={14} /> : <Unlink size={14} />}
        </button>
      </div>

      <div className={styles.layersRow} title={props.mainDescription ?? props.mainLabel}>
        <input type="checkbox" checked={props.showMain} aria-label={`Show ${props.mainLabel}`}
               onChange={(e) => props.onShowMain(e.target.checked)} />
        <span className={styles.layersSwatch} style={{ background: props.mainColor }}
              title="Color, threshold and opacity of the volume: in the side panel" />
        <span className={styles.layersName}>{props.mainLabel}</span>
        <span className={styles.layersOpacity} />
      </div>

      {items.map((o, i) => {
        const h = o.density?.histogram;
        const range = h?.range ?? o.density?.valueRange ?? null;
        const enclosed = h && o.current !== null ? enclosedFraction(h, o.current, below) : null;
        return (
          <div key={i} className={styles.layersItem} data-hidden={!o.show || undefined}>
            <div className={styles.layersRow} title={o.description ?? o.label}>
              <input type="checkbox" checked={o.show} aria-label={`Show ${o.label}`}
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
            {!linked && o.density && range && (
              <div className={styles.layersSub}
                   title={o.current !== null ? `Threshold ${fmt(o.current)}`
                     + (enclosed !== null ? `, ${pct(enclosed)} of the voxels` : "") : undefined}>
                <input type="range" min={range[0]} max={range[1]} step={(range[1] - range[0]) / 500}
                       value={o.threshold ?? o.current ?? range[0]} disabled={!o.show}
                       aria-label={`Threshold of ${o.label}`}
                       onChange={(e) => onChange(i, { threshold: Number(e.target.value) })} />
                {enclosed !== null && <span>{pct(enclosed)}</span>}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
