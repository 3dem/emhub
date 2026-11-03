// src/components/viewers/volume/MaskPanel.tsx
//
// The mask options of VolumeViewer's 3D volume tab, in a panel opened by the
// Mask button of its toolbar: show/hide, color, opacity and, for a sphere,
// its diameter in voxels (px) and in Å.
import { useState } from "react";
import styles from "../VolumeViewer.module.css";

export type MaskOptions = {
  show: boolean;
  /** CSS hex. */
  color: string;
  /** 0-1. */
  opacity: number;
  /** Sphere diameter in voxels. */
  diameterPx: number;
};

type Props = MaskOptions & {
  kind: "sphere" | "map";
  label?: string;
  /** Å per voxel (null: unknown, the diameter is only in px). */
  angpix: number | null;
  /** Largest diameter of the slider (voxels). */
  maxPx: number;
  /** Loading or error of a map mask (null: shown). */
  status?: string | null;
  onChange: (patch: Partial<MaskOptions>) => void;
};

const fmt = (v: number) => String(Math.round(v * 10) / 10);

export default function MaskPanel(props: Props) {
  const { show, color, opacity, diameterPx, angpix, onChange } = props;
  // Typed text of both diameter fields: each one updates the other
  const [pxText, setPxText] = useState(fmt(diameterPx));
  const [aText, setAText] = useState(angpix ? fmt(diameterPx * angpix) : "");
  const setPx = (px: number, from?: "px" | "a") => {
    if (from !== "px") setPxText(fmt(px));
    if (from !== "a" && angpix) setAText(fmt(px * angpix));
    onChange({ diameterPx: px });
  };

  return (
    <div className={styles.panel} role="dialog" aria-label="Mask">
      <label className={styles.panelRow}>
        <input type="checkbox" checked={show} onChange={(e) => onChange({ show: e.target.checked })} />
        Show mask{props.label ? ` (${props.label})` : props.kind === "sphere" ? " (sphere)" : ""}
        <input type="color" className={styles.panelColor} value={color} disabled={!show}
               title="Color of the mask" onChange={(e) => onChange({ color: e.target.value })} />
      </label>
      {props.status && <div className={styles.panelSub}>{props.status}</div>}

      <fieldset className={styles.panelGroup} disabled={!show}>
        <div className={styles.panelSub}>
          <span>Opacity: {Math.round(opacity * 100)}%</span>
          <input type="range" min={5} max={100} step={1} value={Math.round(opacity * 100)}
                 onChange={(e) => onChange({ opacity: Number(e.target.value) / 100 })} />
        </div>
      </fieldset>

      {props.kind === "sphere" && (
        <fieldset className={styles.panelGroup} disabled={!show}>
          <legend>Diameter</legend>
          <div className={styles.panelDiameter}>
            <label>
              <input type="number" min={1} step="any" value={pxText} aria-label="Diameter in voxels"
                     onChange={(e) => {
                       setPxText(e.target.value);
                       const v = Number(e.target.value);
                       if (v > 0) setPx(v, "px");
                     }} />
              px
            </label>
            {angpix ? (
              <label>
                <input type="number" min={0} step="any" value={aText} aria-label="Diameter in Å"
                       onChange={(e) => {
                         setAText(e.target.value);
                         const v = Number(e.target.value);
                         if (v > 0) setPx(v / angpix, "a");
                       }} />
                Å
              </label>
            ) : <span>(voxel size unknown)</span>}
          </div>
          <input type="range" className={styles.panelSlider} min={1} max={Math.max(2, Math.round(props.maxPx))}
                 step={1} value={Math.round(diameterPx)} aria-label="Diameter"
                 onChange={(e) => setPx(Number(e.target.value))} />
        </fieldset>
      )}
    </div>
  );
}
