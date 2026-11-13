// src/components/viewers/volume/DenoisePanel.tsx
//
// The denoise options of VolumeViewer, in a panel opened by the Denoise
// button of the Slices and 3D planes toolbars: on/off and the sigma of the
// Gaussian low-pass (voxels). Zoomed sections are filtered by the host on
// their full-resolution voxels, the rest (slice images, 3D planes) here.
import styles from "../VolumeViewer.module.css";

export type DenoiseOptions = {
  on: boolean;
  /** Gaussian sigma, voxels. */
  sigma: number;
};

type Props = DenoiseOptions & {
  onChange: (patch: Partial<DenoiseOptions>) => void;
};

export default function DenoisePanel({ on, sigma, onChange }: Props) {
  return (
    <div className={styles.panel} role="dialog" aria-label="Denoise">
      <label className={styles.panelRow}>
        <input type="checkbox" checked={on} onChange={(e) => onChange({ on: e.target.checked })} />
        Denoise (Gaussian low-pass)
      </label>
      <fieldset className={styles.panelGroup} disabled={!on}>
        <div className={styles.panelSub} title="Standard deviation of the Gaussian, in voxels: larger is smoother">
          <span>Sigma: {sigma.toFixed(1)} voxels</span>
          <input type="range" min={0.5} max={4} step={0.5} value={sigma}
                 onChange={(e) => onChange({ sigma: Number(e.target.value) })} />
        </div>
      </fieldset>
      <div className={styles.panelNote}>Slices and 3D planes. The contrast is kept.</div>
    </div>
  );
}
