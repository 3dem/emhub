// src/components/viewers/volume/ParticlesPanel.tsx
//
// The particle options of VolumeViewer, in a panel opened by the Particles
// button of the toolbar: show/hide, all particles or only those near the
// planes (with the slab thickness) and, with a picking template, dots or the
// oriented template and its threshold.
import styles from "../VolumeViewer.module.css";

export type ParticleOptions = {
  partsOn: boolean;
  nearOnly: boolean;
  /** Slab half-thickness (voxels) of "near the planes". */
  tolerance: number;
  /** Show the oriented template instead of dots. */
  tmplOn: boolean;
  /** Template threshold (fraction of its maximum); null: the host's surface. */
  templateLevel: number | null;
  /** Color of the dots and the template, in both tabs (CSS hex). */
  color: string;
};

type Props = ParticleOptions & {
  count: number;
  /** A template can be shown (template + voxel size). */
  hasTemplate: boolean;
  /** Its density came too, so the threshold can change. */
  hasDensity: boolean;
  /** Only in 3D the template is drawn (the Slices tab always shows dots). */
  is3d: boolean;
  onChange: (patch: Partial<ParticleOptions>) => void;
};

export default function ParticlesPanel(props: Props) {
  const { count, partsOn, nearOnly, tolerance, tmplOn, templateLevel, color, onChange } = props;
  return (
    <div className={styles.panel} role="dialog" aria-label="Particles">
      <label className={styles.panelRow}>
        <input type="checkbox" checked={partsOn} onChange={(e) => onChange({ partsOn: e.target.checked })} />
        Show particles ({count})
        <input type="color" className={styles.panelColor} value={color} disabled={!partsOn}
               title="Color of the particles (dots and template, in both tabs)"
               onChange={(e) => onChange({ color: e.target.value })} />
      </label>

      <fieldset className={styles.panelGroup} disabled={!partsOn}>
        <label className={styles.panelSelect}>
          <span>Show</span>
          <select value={nearOnly ? "near" : "all"} onChange={(e) => onChange({ nearOnly: e.target.value === "near" })}>
            <option value="near">Near the {props.is3d ? "shown planes" : "sections"}</option>
            <option value="all">All</option>
          </select>
        </label>
        {nearOnly && (
          <div className={styles.panelSub}>
            <span>Distance: ± {tolerance} voxels</span>
            <input type="range" min={1} max={50} step={1} value={tolerance}
                   onChange={(e) => onChange({ tolerance: Number(e.target.value) })} />
          </div>
        )}
      </fieldset>

      {props.hasTemplate && (
        <fieldset className={styles.panelGroup} disabled={!partsOn}>
          <label className={styles.panelSelect}>
            <span>Draw as</span>
            <select value={tmplOn ? "template" : "dots"}
                    onChange={(e) => onChange({ tmplOn: e.target.value === "template" })}>
              <option value="dots">Dots</option>
              <option value="template">Template (oriented)</option>
            </select>
          </label>
          {!props.is3d && tmplOn && <div className={styles.panelSub}>The template is drawn in the 3D planes tab.</div>}
          {tmplOn && props.hasDensity && templateLevel != null && (
            <div className={styles.panelSub}>
              <span>Density threshold: {Math.round(templateLevel * 100)}% of the maximum</span>
              <input type="range" min={1} max={99} step={1} value={Math.round(templateLevel * 100)}
                     onChange={(e) => onChange({ templateLevel: Number(e.target.value) / 100 })} />
            </div>
          )}
        </fieldset>
      )}
    </div>
  );
}
