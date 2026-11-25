// src/components/viewers/volume/DrawPanel.tsx
//
// The mask drawing tools of VolumeViewer's Slices tab (with a host
// `onDrawing`, e.g. MaskDrawWizard), in their own box in the free cell
// right of the Y section: the contour tool (Z sections), the border tool
// (lamella borders, Y / X sections) and the move tool (the whole drawing,
// any section): one line each (what it is for and on which sections), its
// instructions in a tooltip (the help icon, also the button's title) to
// keep the box small; and what is drawn.
import { CircleHelp, Move, PenTool, SeparatorHorizontal } from "lucide-react";
import type { ReactNode } from "react";
import styles from "../VolumeViewer.module.css";
import type { Mode } from "./VolumeSlices";
import type { SliceDrawing } from "./maskDrawing";

type Tool = "contour" | "border" | "move";

type Props = {
  mode: Mode;
  drawing: SliceDrawing | null;
  /** Choose a tool (the active one again: none). */
  onTool: (t: Tool) => void;
};

export default function DrawPanel({ mode, drawing, onTool }: Props) {
  const borders = drawing?.borders ?? [];
  const count = (side: string) => borders.filter((b) => b.side === side).length;
  const tool = (t: Tool, icon: ReactNode, label: string, where: string, help: string) => (
    <button type="button" className={`${styles.drawTool} ${mode === t ? styles.active : ""}`}
            aria-pressed={mode === t} onClick={() => onTool(t)} title={help}>
      <span className={styles.drawToolHead}>
        {icon}<b>{label}</b><span>{where}</span>
        <CircleHelp size={13} className={styles.drawToolHelp} aria-label={`Help: ${help}`} />
      </span>
    </button>
  );
  return (
    <div className={styles.drawPanel} role="group" aria-label="Mask drawing">
      <div className={styles.drawTitle}>Mask drawing</div>
      {tool("contour", <PenTool size={14} />, "Contours", "Z slices",
            "Click points around the region, click the first one to close. Drag a point to move it, right-click to remove it.")}
      {tool("border", <SeparatorHorizontal size={14} />, "Lamella borders", "Y / X slices",
            "Click the start and the end of the lower and of the upper border. Drag an end, right-click a line to remove it.")}
      {tool("move", <Move size={14} />, "Move mask", "all slices",
            "Drag on any slice to move all the contours and borders together. Undo goes back step by step.")}
      <div className={styles.drawCounts}>
        {drawing?.contours.length ?? 0} contours · borders: lower {count("low")}, upper {count("high")}
      </div>
    </div>
  );
}
