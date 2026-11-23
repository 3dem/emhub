// src/components/viewers/volume/OverlaysPanel.tsx
//
// Authors: Daniel Marchan (danielmarchan3@gmail.com)
//
// The display of the maps of VolumeViewer's 3D volume tab (the volume and
// its overlays: other maps on the same box, e.g. the references of a 3D
// classification), in a panel opened by the Maps button of its toolbar:
// Overlay draws them over each other; Tile draws each shown map alone in a
// cell of a grid, all with the same camera (they turn and zoom together),
// to compare them side by side. Each map is shown or hidden, colored and
// given its threshold in the side panel (MapsList). Tiled, at most
// TILE_MAX maps are shown.
export const TILE_MAX = TILE_CELLS_MAX;

import styles from "../VolumeViewer.module.css";
import { TILE_CELLS_MAX, type IsoLayout } from "./IsoSurfaceScene";

type Props = {
  layout: IsoLayout;
  onLayout: (layout: IsoLayout) => void;
};

const OPTIONS: { id: IsoLayout; label: string; note: string }[] = [
  { id: "overlay", label: "Overlay", note: "The maps over each other" },
  { id: "tile", label: "Tile", note: `Each map in its cell (at most ${TILE_MAX})` },
];

export default function OverlaysPanel({ layout, onLayout }: Props) {
  return (
    <div className={`${styles.panel} ${styles.layers} ${styles.display}`} role="dialog" aria-label="Display of the maps">
      <div className={styles.layersHead}>
        <span className={styles.layersTitle}>Display</span>
      </div>
      <div role="radiogroup" aria-label="Display of the maps">
        {OPTIONS.map((o) => (
          <label key={o.id} className={styles.displayOption}>
            <input type="radio" name="vv-maps-layout" checked={layout === o.id}
                   onChange={() => onLayout(o.id)} />
            <span>
              <span className={styles.displayLabel}>{o.label}</span>
              <span className={styles.displayNote}>{o.note}</span>
            </span>
          </label>
        ))}
      </div>
    </div>
  );
}

