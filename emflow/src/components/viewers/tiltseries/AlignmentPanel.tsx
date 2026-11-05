// src/components/viewers/tiltseries/AlignmentPanel.tsx
//
// The alignment of TiltSeriesViewer, in a panel opened by the Alignment
// button of the toolbar (as VolumeViewer's particles panel): the alignment
// applied, three radio buttons applied on click (none, global, or global +
// local when the tilt series has a local alignment; only none without an
// alignment), and what is drawn: the tilt axis, the local deformation as
// arrows and the plot.
import { useId } from "react";
import styles from "../VolumeViewer.module.css";
import type { View } from "./alignment";

export type AlignmentOptions = {
  showAxis: boolean;
  /** The local deformation of the tilt as arrows. */
  showField: boolean;
  showPlot: boolean;
};

type Props = AlignmentOptions & {
  /** The tilt series has a global alignment (and a pixel size). */
  canAlign: boolean;
  /** The tilt series has a local alignment the viewer can draw. */
  hasLocal: boolean;
  /** Its description, e.g. "spline 3 × 3". */
  localLabel: string;
  /** The alignment applied: none ("raw"), global or global + local ("both"). */
  view: View;
  onView: (v: View) => void;
  /** The arrows are drawn this many times larger. */
  fieldScale: number;
  /** There is something to plot. */
  canPlot: boolean;
  onChange: (patch: Partial<AlignmentOptions>) => void;
};

export default function AlignmentPanel(props: Props) {
  const { view, showAxis, showField, showPlot, canAlign, hasLocal, onView, onChange } = props;
  const group = useId();   // one radio group per viewer (a grid has several)
  const noAlign = "The tilt series STAR has no alignment (rlnTomoZRot, rlnTomoX/YShiftAngst) or no pixel size";
  const noLocal = "The tilt series STAR has no local alignment (rlnTomoDeformationCoefficients)";
  const radio = (v: View, label: string, enabled: boolean, title?: string) => (
    <label className={styles.panelRow} style={enabled ? undefined : { opacity: 0.5 }} title={enabled ? undefined : title}>
      <input type="radio" name={group} checked={view === v} disabled={!enabled}
             onChange={() => onView(v)} />
      {label}
    </label>
  );
  return (
    <div className={styles.panel} role="dialog" aria-label="Alignment">
      {/* Applied on click; zoom and ruler are cleared between none and aligned */}
      <fieldset className={styles.panelGroup}>
        <legend>Alignment</legend>
        {radio("raw", "None (as acquired)", true)}
        {radio("global", "Global (rotation and shifts)", canAlign, noAlign)}
        {radio("both",
               `Global + local${hasLocal ? ` (${props.localLabel})` : canAlign ? ": not in this tilt series" : ""}`,
               hasLocal, canAlign ? noLocal : noAlign)}
      </fieldset>
      <fieldset className={styles.panelGroup}>
        <legend>Show</legend>
        <label className={styles.panelRow}>
          <input type="checkbox" checked={showAxis} onChange={(e) => onChange({ showAxis: e.target.checked })} />
          Tilt axis
        </label>
        {hasLocal && (
          <label className={styles.panelRow}>
            <input type="checkbox" checked={showField} onChange={(e) => onChange({ showField: e.target.checked })} />
            Local deformation (arrows ×{props.fieldScale})
          </label>
        )}
        {props.canPlot && (
          <label className={styles.panelRow}>
            <input type="checkbox" checked={showPlot} onChange={(e) => onChange({ showPlot: e.target.checked })} />
            Plot: alignment and neighbour correlation
          </label>
        )}
      </fieldset>
    </div>
  );
}
