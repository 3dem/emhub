// src/components/viewers/volume/CoordinateSetsBar.tsx
//
// The sets of the particles of VolumeViewer, when the coordinates have
// several (e.g. kept / duplicates / near edge, or A - B / B - A / A & B):
// one group per set with whether it is shown, its color, label and count
// and, when the host can recompute the sets (CoordinatesRecompute), the
// input of the value that decides that set (e.g. the distance of the
// duplicates, the distance to the edges), applied with Enter or when it
// loses focus. Inputs of no set are drawn after the sets.
import { useEffect, useState } from "react";
import styles from "./CoordinateSetsBar.module.css";
import type { CoordinateSet, CoordinatesRecomputeInput } from "./volumeMath";

type Props = {
  sets: CoordinateSet[];
  /** Particles of each set (index of `sets`). */
  counts: number[];
  shown: boolean[];
  colors: string[];
  /** Inputs of the recompute (none: the sets are fixed). */
  inputs?: CoordinatesRecomputeInput[];
  /** Values of the current sets, by input id. */
  values?: Record<string, number>;
  /** Loading, or the error of the last recompute. */
  status?: string | null;
  loading?: boolean;
  onShown: (index: number, shown: boolean) => void;
  onColor: (index: number, color: string) => void;
  onValues: (values: Record<string, number>) => void;
};

function ValueInput(props: {
  input: CoordinatesRecomputeInput;
  value: number | undefined;
  onValue: (value: number) => void;
}) {
  const { input, value } = props;
  const [text, setText] = useState(value != null ? String(value) : "");
  useEffect(() => { setText(value != null ? String(value) : ""); }, [value]);
  const min = input.min ?? 0;

  const apply = () => {
    const v = Number(text);
    if (!text.trim() || !Number.isFinite(v) || v < min) {
      setText(value != null ? String(value) : "");
      return;
    }
    if (v !== value) props.onValue(v);
  };

  return (
    <label className={styles.value}
           title={`${input.title ?? input.label ?? input.id} (Enter to recompute)`}>
      {input.label && <span className={styles.valueLabel}>{input.label}</span>}
      <input type="number" className={styles.input} value={text}
             min={min} step={input.step ?? "any"}
             aria-label={input.title ?? input.label ?? input.id}
             onChange={(e) => setText(e.target.value)}
             onBlur={apply}
             onKeyDown={(e) => {
               if (e.key === "Enter") apply();
               if (e.key === "Escape") setText(value != null ? String(value) : "");
             }} />
      {input.unit && <span className={styles.unit}>{input.unit}</span>}
    </label>
  );
}

export default function CoordinateSetsBar(props: Props) {
  const { sets, counts, shown, colors, inputs = [], values = {} } = props;
  const valueInput = (input: CoordinatesRecomputeInput) => (
    <ValueInput key={input.id} input={input} value={values[input.id]}
                onValue={(v) => props.onValues({ ...values, [input.id]: v })} />
  );
  const setIds = new Set(sets.filter((s) => !s.hidden).map((s) => s.id));
  const loose = inputs.filter((input) => !input.set || !setIds.has(input.set));

  return (
    <div className={styles.bar} role="group" aria-label="Particle sets">
      {sets.map((s, i) => {
        if (s.hidden) return null;
        const own = inputs.filter((input) => input.set && input.set === s.id);
        const color = colors[i] ?? s.color;
        return (
          <span key={s.id ?? i} className={styles.group}
                style={{ borderLeftColor: color }}>
            <label className={styles.set} title={`Show the ${s.label} particles`}>
              <input type="checkbox" checked={shown[i] ?? true}
                     onChange={(e) => props.onShown(i, e.target.checked)} />
              <input type="color" className={styles.color} value={color}
                     title={`Color of the ${s.label} particles`}
                     onClick={(e) => e.stopPropagation()}
                     onChange={(e) => props.onColor(i, e.target.value)} />
              <span className={styles.label}>{s.label}</span>
              <span className={styles.count}>{counts[i] ?? 0}</span>
            </label>
            {own.map(valueInput)}
          </span>
        );
      })}
      {loose.map(valueInput)}
      {props.status && (
        <span className={props.loading ? styles.status : `${styles.status} ${styles.error}`} role="status">
          {props.status}
        </span>
      )}
    </div>
  );
}
