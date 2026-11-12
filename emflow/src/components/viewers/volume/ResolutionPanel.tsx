// src/components/viewers/volume/ResolutionPanel.tsx
//
// The local resolution coloring of VolumeViewer (3D volume and Slices), in a
// panel opened by the resolution button of their toolbars: on/off and a
// slider for the max of the color scale (the values above it are gray),
// between the min and max values of the map, the selected value over its
// thumb.
import styles from "../VolumeViewer.module.css";

/** Values of a resolution map (map units, without the values <= 0 nor the
 * fill outside its mask). */
export type ResolutionStats = {
  min: number;
  max: number;
  /** The value below the highest 5% (the default max of the scale). */
  p95: number;
};

type Props = {
  show: boolean;
  onShow: (show: boolean) => void;
  label?: string;
  unit: string;
  /** null while the map loads. */
  stats: ResolutionStats | null;
  /** Loading or error of the map (null: loaded). */
  status: string | null;
  /** Max of the color scale (map units). */
  maxValue: number | null;
  onMaxValue: (value: number) => void;
};

const fmt = (v: number) => (Math.abs(v) >= 100 ? v.toFixed(0) : v.toFixed(2));

export default function ResolutionPanel(props: Props) {
  const { show, stats, unit, maxValue } = props;
  const value = stats ? (maxValue ?? stats.p95) : null;
  // Position of the thumb (0-1), for the value over it
  const at = stats && value != null ? (value - stats.min) / (stats.max - stats.min || 1) : 0;

  return (
    <div className={styles.panel} role="dialog" aria-label="Local resolution">
      <label className={styles.panelRow}>
        <input type="checkbox" checked={show} onChange={(e) => props.onShow(e.target.checked)} />
        Local resolution{props.label ? ` (${props.label})` : ""}
      </label>
      {props.status && <div className={styles.panelSub}>{props.status}</div>}

      {stats && value != null && (
        <fieldset className={styles.panelGroup} disabled={!show}>
          {/* Grid: the value over the slider's column, min and max beside it */}
          <div className={styles.panelRange}>
            <span />
            <div className={styles.panelRangeValue}>
              {/* Over the thumb (14 px wide: its center moves 14 px less) */}
              <b style={{ left: `calc(${at * 100}% + ${(0.5 - at) * 14}px)` }}>{fmt(value)} {unit}</b>
            </div>
            <span />
            <span>{fmt(stats.min)}</span>
            <input type="range" min={stats.min} max={stats.max}
                   step={Math.max((stats.max - stats.min) / 500, 0.01)} value={value}
                   aria-label={`Max of the color scale (${unit})`} aria-valuetext={`${fmt(value)} ${unit}`}
                   onChange={(e) => props.onMaxValue(Number(e.target.value))} />
            <span>{fmt(stats.max)}</span>
          </div>
        </fieldset>
      )}
    </div>
  );
}
