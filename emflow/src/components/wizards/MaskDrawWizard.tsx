// Draw or correct one mask per tomogram with contours (server:
// emwrap.base.wizards.MaskDrawWizard, emw-mask-draw): the tomograms of the
// input set on the left, in its order, with their status (input mask, drawn,
// none) and the flag of emw-mask-predict; the drawing of the selected one
// below them (mode, contours, borders). On the right, the
// tomogram in a VolumeViewer (its pane, loaded from the host's request) with
// its input mask and the mask drawing tools (their own box in the Slices
// tab): contours on Z sections, the lower and upper borders of the lamella
// as lines on Y / X sections; the region of the contours is filled (orange:
// added, red: subtracted) and the sections are shaded outside the borders.
// The wizard only draws: the masks are computed by the job, in parallel.
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Alert, Box, Button, Chip, CircularProgress, IconButton, List, ListItemButton, ListItemText, MenuItem,
  TextField, Tooltip, Typography,
} from "@mui/material";
import VolumeViewer, {
  type SliceBorder, type SliceDrawing, type VolumeViewerHandle,
} from "@/components/viewers/VolumeViewer";
import { useLoad } from "@/data/DataLoaderContext";
import { TrashBinIcon } from "../../icons";
import type { WizardComponentProps } from "./WizardDialog";

type Mode = "draw" | "add" | "subtract" | "keep" | "none";
/** A contour as the server takes it (the tools draw on Z; those on other
 * axes, typed in the table, are kept). */
type Contour = { axis: "x" | "y" | "z"; index: number; points: [number, number][] };
/** The drawing of a tomogram, as the server takes it. */
type Drawing = {
  mode: Mode;
  contours: Contour[];
  borders: SliceBorder[];
};
type Tomogram = {
  name: string;
  path: string;
  mask: string | null;
  dimensions: [number, number, number];
  angpix: number | null;
  flag: boolean | null;
  confidence: Record<string, any> | null;
  pane: { path: string; payload?: unknown };
};

const MODES: { id: Mode; label: string; help: string; base?: boolean }[] = [
  { id: "draw", label: "Draw", help: "The region of the contours (the input mask is replaced)" },
  { id: "add", label: "Add", help: "The input mask plus the region of the contours", base: true },
  { id: "subtract", label: "Subtract", help: "The input mask without the region of the contours", base: true },
  { id: "keep", label: "Keep", help: "The input mask, only cut to the borders", base: true },
  { id: "none", label: "No mask", help: "No mask for this tomogram" },
];
const CONTOUR_MODES: Mode[] = ["draw", "add", "subtract"];
// The dialog body: the window but the dialog margins, title and actions
const ROW_HEIGHT = "calc(100vh - 212px)";
const SIDE_LABEL = { low: "Lower", high: "Upper" };

// The fill of the region of the contours in the viewer: what they add to the
// mask (draw, add) or remove from it (subtract)
const FILLS: Partial<Record<Mode, string>> = { draw: "#ff9f1c", add: "#ff9f1c", subtract: "#ff3b30" };

const toSlice = (d: Drawing | undefined): SliceDrawing => ({
  contours: (d?.contours ?? []).filter((c) => c.axis === "z").map((c) => ({ z: c.index, points: c.points })),
  borders: d?.borders ?? [],
  fill: d ? FILLS[d.mode] ?? null : FILLS.draw,
});
const isEmpty = (d: Drawing | undefined) =>
  !d || (d.mode === "keep" && !d.borders.length);
const emptyDrawing = (t: Tomogram): Drawing =>
  ({ mode: t.mask ? "keep" : "draw", contours: [], borders: [] });

function status(t: Tomogram, d: Drawing | undefined): string {
  if (isEmpty(d)) return t.mask ? "input mask" : "no mask";
  if (d!.mode === "none") return "no mask (drawn)";
  const n = d!.contours.length, b = d!.borders.length;
  return [MODES.find((m) => m.id === d!.mode)?.label.toLowerCase(),
          n ? `${n} contour${n > 1 ? "s" : ""}` : "", b ? `${b} border line${b > 1 ? "s" : ""}` : ""]
    .filter(Boolean).join(", ");
}

function flagText(c: Record<string, any> | null): string {
  if (!c) return "";
  const parts = [`mask ${(Number(c.fraction ?? 0) * 100).toFixed(1)}% of the tomogram`];
  if (c.uncertain_ratio != null) parts.push(`uncertain ratio ${Number(c.uncertain_ratio).toFixed(2)}`);
  if (c.disagreement != null) parts.push(`folds disagreement ${Number(c.disagreement).toFixed(2)}`);
  return `Flagged by emw-mask-predict: ${parts.join(", ")}`;
}

export default function MaskDrawWizard({ inputs, data, onChange }: WizardComponentProps) {
  const tomograms: Tomogram[] = data.tomograms ?? [];
  const [drawings, setDrawings] = useState<Record<string, Drawing>>(() =>
    Object.fromEntries(Object.entries(inputs.drawings ?? {}).map(([k, d]: [string, any]) =>
      [k, { borders: [], contours: [], ...d }])));
  const [current, setCurrent] = useState(() => {
    // The first drawn one, else the first one
    const i = tomograms.findIndex((t) => inputs.drawings?.[t.name]);
    return Math.max(0, i);
  });
  const viewer = useRef<VolumeViewerHandle>(null);
  const listRef = useRef<HTMLUListElement>(null);
  useEffect(() => {
    listRef.current?.querySelector(".Mui-selected")?.scrollIntoView({ block: "nearest" });
  }, [current]);
  useEffect(() => {
    onChange({ drawings });
    // onChange is a new function on each render of the dialog
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drawings]);

  const t = tomograms[current];
  const drawing = t ? drawings[t.name] : undefined;

  const update = (name: string, d: Drawing | null) =>
    setDrawings((all) => {
      const next = { ...all };
      if (d) next[name] = d; else delete next[name];
      return next;
    });
  /** A change of the contours or borders in the viewer. */
  const onDrawing = (s: SliceDrawing) => {
    if (!t) return;
    const d = drawing ?? emptyDrawing(t);
    const contours: Contour[] = [...d.contours.filter((c) => c.axis !== "z"),
      ...s.contours.map((c) => ({ axis: "z" as const, index: c.z, points: c.points }))];
    let mode = d.mode;
    // Contours make a mask; without them, the input mask (cut to the borders)
    if (contours.length && mode === "keep") mode = "draw";
    if (!contours.length && t.mask && CONTOUR_MODES.includes(mode)) mode = "keep";
    update(t.name, { ...d, mode, contours, borders: s.borders });
  };

  const pane = useLoad<any>(t?.pane?.path, t?.pane?.payload);
  const content = pane.status === "ready" ? (pane.data?.paneContent ?? pane.data) : null;
  const sliceDrawing = useMemo(() => toSlice(drawing), [drawing]);
  const drawnCount = tomograms.filter((x) => !isEmpty(drawings[x.name])).length;
  const go = (i: number) => setCurrent(Math.max(0, Math.min(tomograms.length - 1, i)));

  if (!t) return <Alert severity="info">The input set has no tomograms.</Alert>;
  const mode = drawing?.mode ?? emptyDrawing(t).mode;
  const hint = isEmpty(drawing)
    ? (t.mask ? "The input mask: draw to change it." : "No mask: draw contours on Z sections (contour tool).")
    : drawing!.mode === "none" ? "This tomogram will have no mask."
      : CONTOUR_MODES.includes(drawing!.mode) && !drawing!.contours.length
        ? "Draw at least one contour on a Z section."
        : "The mask is computed when the job runs.";

  return (
    <Box sx={{ display: "flex", gap: 2, alignItems: "stretch", height: ROW_HEIGHT, minHeight: 420 }}>
      <Box sx={{ flex: "0 0 320px", display: "flex", flexDirection: "column", gap: 0.75, minHeight: 0,
                 "& > *": { flexShrink: 0 } }}>
        <Typography variant="subtitle2">
          Tomograms ({tomograms.length}), drawn: {drawnCount}
        </Typography>
        {/* The list takes the room left; the drawing of the selected one stays below */}
        <List dense disablePadding ref={listRef}
              sx={{ flex: "1 1 auto", flexShrink: "1 !important", minHeight: 80, overflow: "auto",
                    border: 1, borderColor: "divider", borderRadius: 1 }}>
          {tomograms.map((x, i) => (
            <ListItemButton key={x.name} selected={i === current} onClick={() => go(i)} sx={{ py: 0, pr: 0.5 }}>
              <ListItemText primary={x.name} secondary={status(x, drawings[x.name])} sx={{ my: 0.25 }}
                            primaryTypographyProps={{ fontSize: 13, noWrap: true }}
                            secondaryTypographyProps={{ fontSize: 11 }} />
              {x.flag && (
                <Tooltip title={flagText(x.confidence)}>
                  <Chip label="flagged" size="small" color="warning" variant="outlined"
                        sx={{ height: 18, fontSize: 10 }} />
                </Tooltip>
              )}
            </ListItemButton>
          ))}
        </List>

        <Box sx={{ display: "flex", gap: 1, alignItems: "center" }}>
          <Button size="small" onClick={() => go(current - 1)} disabled={current === 0}
                  sx={{ textTransform: "none" }}>Previous</Button>
          <Typography variant="body2" sx={{ flex: 1, textAlign: "center" }} noWrap title={t.path}>
            <b>{t.name}</b>
          </Typography>
          <Button size="small" onClick={() => go(current + 1)} disabled={current === tomograms.length - 1}
                  sx={{ textTransform: "none" }}>Next</Button>
        </Box>
        <Typography variant="caption" color="text.secondary" sx={{ mt: -0.75 }} noWrap
                    title={t.mask ?? undefined}>
          {t.dimensions.join(" × ")} px{t.angpix ? `, ${t.angpix.toFixed(2)} Å/px` : ""}
          {" · "}{t.mask ? `input mask: ${t.mask.split("/").pop()}` : "no input mask"}
        </Typography>

        <TextField select size="small" label="Mode" value={mode}
                   helperText={MODES.find((m) => m.id === mode)?.help}
                   // A smaller font than the default fields (as the list)
                   sx={{ "& .MuiSelect-select": { fontSize: 13, py: 0.75 },
                         "& .MuiFormHelperText-root": { fontSize: 11, mx: 0.5 } }}
                   onChange={(e) => update(t.name, { ...(drawing ?? emptyDrawing(t)), mode: e.target.value as Mode })}>
          {MODES.map((m) => (
            <MenuItem key={m.id} value={m.id} disabled={m.base && !t.mask} sx={{ fontSize: 13 }}>{m.label}</MenuItem>
          ))}
        </TextField>

        <Typography variant="caption" color="text.secondary">
          Contours ({drawing?.contours.length ?? 0}) and borders ({drawing?.borders.length ?? 0}): click one to go to its slice
        </Typography>
        <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.5, maxHeight: 72, overflow: "auto" }}>
          {(drawing?.contours ?? []).map((c) => (
            <Chip key={`${c.axis}${c.index}`} size="small" label={`${c.axis.toUpperCase()} ${c.index} · ${c.points.length} pts`}
                  onClick={() => viewer.current?.setPosition({ [c.axis]: c.index })}
                  onDelete={() => update(t.name, { ...drawing!, contours: drawing!.contours.filter((k) => k !== c) })} />
          ))}
          {(drawing?.borders ?? []).map((b, i) => (
            <Chip key={`b${i}`} size="small" variant="outlined"
                  label={`${SIDE_LABEL[b.side]} · ${b.axis.toUpperCase()} ${b.index}`}
                  onClick={() => viewer.current?.setPosition({ [b.axis]: b.index })}
                  onDelete={() => onDrawing({ ...sliceDrawing, borders: sliceDrawing.borders.filter((_k, j) => j !== i) })} />
          ))}
        </Box>

        <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
          <Tooltip title="Forget the drawing of this tomogram: its input mask (or none)">
            <span>
              <IconButton size="small" aria-label="Revert to the input mask" disabled={isEmpty(drawing)}
                          onClick={() => update(t.name, null)}>
                <TrashBinIcon />
              </IconButton>
            </span>
          </Tooltip>
          <Typography variant="body2" color="text.secondary" aria-live="polite" sx={{ flex: 1 }}>
            {hint}
          </Typography>
        </Box>
      </Box>

      <Box sx={{ flex: "1 1 520px", minWidth: 0, position: "relative" }}>
        {pane.status === "error" ? (
          <Alert severity="error">Could not load {t.name}: {pane.error.message}</Alert>
        ) : !content ? (
          <Box sx={{ display: "flex", alignItems: "center", gap: 1, p: 2 }}>
            <CircularProgress size={20} /><Typography variant="body2">Loading {t.name}…</Typography>
          </Box>
        ) : (
          // A new tomogram needs a new viewer; it fills the height of the row
          <VolumeViewer key={t.name} ref={viewer} data={content} {...(content.viewerConfig ?? {})}
                        height="fill" initialTab="slices" initialTool="contour"
                        drawing={sliceDrawing} onDrawing={onDrawing} />
        )}
      </Box>
    </Box>
  );
}
