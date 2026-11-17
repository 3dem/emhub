// src/components/viewers/volume/CoordinateSetsBar.tsx
//
// The sets of the particles of VolumeViewer, when the coordinates have
// several (e.g. kept / duplicates, or A - B / B - A / A & B): one line with,
// per set, whether it is shown, its color, label and count; and, when the
// host can recompute the sets (CoordinatesRecompute), the input of the value
// they depend on (a distance), applied with Enter or when it loses focus.
import { useEffect, useState } from "react";
import styles from "./CoordinateSetsBar.module.css";
import type { CoordinateSet, CoordinatesRecompute } from "./volumeMath";

type Props = {
  sets: CoordinateSet[];
  /** Particles of each set (index of `sets`). */
  counts: number[];
  shown: boolean[];
  colors: string[];
  recompute?: CoordinatesRecompute | null;
  /** Value of the current sets. */
  value?: number | null;
  /** Loading, or the error of the last recompute. */
  status?: string | null;
  loading?: boolean;
  onShown: (index: number, shown: boolean) => void;
  onColor: (index: number, color: string) => void;
  onValue: (value: number) => void;
};

export default function CoordinateSetsBar(props: Props) {
  const { sets, counts, shown, colors, recompute, value } = props;
  const [text, setText] = useState(value != null ? String(value) : "");
  useEffect(() => { setText(value != null ? String(value) : ""); }, [value]);

  const apply = () => {
    const v = Number(text);
    if (!text.trim() || !Number.isFinite(v) || v <= (recompute?.min ?? 0)) {
      setText(value != null ? String(value) : "");
      return;
    }
    if (v !== value) props.onValue(v);
  };

  return (
    <div className={styles.bar} role="group" aria-label="Particle sets">
      {sets.map((s, i) => s.hidden ? null : (
        <label key={s.id ?? i} className={styles.set} title={`Show the ${s.label} particles`}>
          <input type="checkbox" checked={shown[i] ?? true} onChange={(e) => props.onShown(i, e.target.checked)} />
          <input type="color" className={styles.color} value={colors[i] ?? s.color}
                 title={`Color of the ${s.label} particles`}
                 onChange={(e) => props.onColor(i, e.target.value)} />
          <span className={styles.label}>{s.label}</span>
          <span className={styles.count}>{counts[i] ?? 0}</span>
        </label>
      ))}
      {recompute && (
        <label className={styles.value} title="Recompute the sets for this value (Enter)">
          <span>{recompute.label ?? "Distance"}</span>
          <input type="number" className={styles.input} value={text}
                 min={recompute.min ?? 0} step={recompute.step ?? "any"}
                 onChange={(e) => setText(e.target.value)}
                 onBlur={apply}
                 onKeyDown={(e) => {
                   if (e.key === "Enter") apply();
                   if (e.key === "Escape") setText(value != null ? String(value) : "");
                 }} />
          {recompute.unit && <span>{recompute.unit}</span>}
        </label>
      )}
      {props.status && (
        <span className={props.loading ? styles.status : `${styles.status} ${styles.error}`} role="status">
          {props.status}
        </span>
      )}
    </div>
  );
}
