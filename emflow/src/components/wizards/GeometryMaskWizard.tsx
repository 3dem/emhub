// A binary mask made of geometric shapes (server:
// emwrap.base.wizards.GeometryMaskWizard, emw-geometry-mask): the list of
// shapes (sphere, cylinder, box) and the editor of the current one (center,
// Euler angles and sizes, in px and degrees) and the soft edge of the mask
// (px) on the left; the input volume
// (or the mask alone, without volume) with the mask over it in a
// VolumeViewer on the right. The mask is computed by the server (preview, on
// the box downscaled to at most 128 px) on Re-calculate.
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  Box, Button, IconButton, List, ListItemButton, ListItemText, MenuItem, TextField, Tooltip, Typography,
} from "@mui/material";
import type { VolumeMask } from "@/components/viewers/VolumeViewer";
import { PlusIcon, TrashBinIcon } from "../../icons";
import type { WizardComponentProps } from "./WizardDialog";
import { PreviewViewer, RecalculateControls, useWizardPreview } from "./WizardPreview";
import { fmt, num } from "./MaskCreateWizard";

const SHAPES = ["sphere", "cylinder", "box"] as const;
type ShapeKind = (typeof SHAPES)[number];
const CENTER = ["center_x", "center_y", "center_z"] as const;
const ANGLES = ["rot", "tilt", "psi"] as const;
const SIZES: Record<ShapeKind, string[]> = {
  sphere: ["radius"],
  cylinder: ["radius", "height"],
  box: ["size_x", "size_y", "size_z"],
};
const LABELS: Record<string, string> = {
  center_x: "X", center_y: "Y", center_z: "Z", rot: "Rot", tilt: "Tilt", psi: "Psi",
  radius: "Radius", height: "Height", size_x: "Size X", size_y: "Size Y", size_z: "Size Z",
};
// Width of the labels on the left of the rows of fields
const LABEL_WIDTH = 64;
// The dialog body: the window but the dialog margins (64), title and
// actions (113) and the body padding (32)
const ROW_HEIGHT = "calc(100vh - 212px)";
const NUMBERS = [...CENTER, ...ANGLES, "radius", "height", "size_x", "size_y", "size_z"];

// The typed text of each number of a shape (an unfinished number is kept)
type ShapeTexts = { shape: ShapeKind } & Record<string, string>;

const toTexts = (s: Record<string, any>): ShapeTexts => ({
  shape: (SHAPES as readonly string[]).includes(s.shape) ? s.shape : "sphere",
  ...Object.fromEntries(NUMBERS.map((k) => [k, fmt(typeof s[k] === "number" ? s[k] : num(String(s[k] ?? "")), 6)])),
});

/** The shape as sent to the server: the numbers of its kind only. */
const toValues = (t: ShapeTexts) => {
  const out: Record<string, any> = { shape: t.shape };
  [...CENTER, ...ANGLES, ...SIZES[t.shape]].forEach((k) => { out[k] = num(t[k]) ?? ""; });
  return out;
};

const describe = (t: ShapeTexts) => {
  const sizes = SIZES[t.shape].map((k) => `${LABELS[k].replace("Size ", "")}=${t[k] || "?"}`).join(" ");
  return { primary: `${t.shape[0].toUpperCase()}${t.shape.slice(1)} ${sizes}`,
           secondary: `(${CENTER.map((k) => t[k] || "·").join(", ")})  ${ANGLES.map((k) => t[k] || "0").join("/")}°` };
};

export default function GeometryMaskWizard({ inputs, data, onChange, preview }: WizardComponentProps) {
  const [shapes, setShapes] = useState<ShapeTexts[]>(() => (inputs.shapes ?? []).map(toTexts));
  const [current, setCurrent] = useState(0);
  // The selected shape stays visible when the list scrolls (short windows)
  const listRef = useRef<HTMLUListElement>(null);
  useEffect(() => {
    listRef.current?.querySelector(".Mui-selected")?.scrollIntoView({ block: "nearest" });
  }, [current, shapes.length]);
  // Width (px) of the raised cosine soft edge outside the shapes
  const [softEdge, setSoftEdge] = useState(() => fmt(inputs.soft_edge ?? 0, 6));
  const values = useMemo(() => ({ shapes: shapes.map(toValues), soft_edge: num(softEdge) ?? 0 }),
    [shapes, softEdge]);
  const { data: shown, outdated, status, recalculate } = useWizardPreview(values, data, preview);
  useEffect(() => {
    onChange(values);
    // onChange is a new function on each render of the dialog
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [values]);

  const defaults: Record<string, Record<string, any>> = data.defaults ?? {};
  const edited = shapes[current];
  const update = (changes: Partial<ShapeTexts>) =>
    setShapes((list) => list.map((s, i) => (i === current ? { ...s, ...changes } as ShapeTexts : s)));
  // A new kind keeps the center and angles, and takes the default sizes
  const setKind = (kind: ShapeKind) => update({
    ...Object.fromEntries(SIZES[kind].map((k) => [k, edited[k] || toTexts(defaults[kind] ?? {})[k]])),
    shape: kind,
  });
  const addShape = () => {
    const kind = edited?.shape ?? "sphere";
    setShapes((list) => [...list, toTexts(defaults[kind] ?? { shape: kind })]);
    setCurrent(shapes.length);
  };
  const removeShape = (index: number) => {
    setShapes((list) => list.filter((_s, i) => i !== index));
    setCurrent((c) => Math.max(0, c > index || c === shapes.length - 1 ? c - 1 : c));
  };

  // The sizes also show their length in Å (with a pixel size)
  const toAngstroms = (text: string) => {
    const v = num(text ?? "");
    return data.angpix && v != null ? `${fmt(v * data.angpix)} Å` : undefined;
  };
  const angstroms = (name: string) => toAngstroms(edited[name]);
  const field = (name: string, inAngstroms = false) => (
    <TextField key={name} label={LABELS[name]} size="small" value={edited[name] ?? ""} sx={{ flex: 1 }}
               helperText={inAngstroms ? angstroms(name) ?? " " : undefined}
               onChange={(e) => update({ [name]: e.target.value })} />
  );
  // A row of fields with its label on the left (saves a line per group)
  const labeled = (label: string, children: ReactNode, title?: string) => (
    <Box sx={{ display: "flex", gap: 1, alignItems: "flex-start" }}>
      <Typography variant="caption" color="text.secondary" title={title}
                  sx={{ flex: `0 0 ${LABEL_WIDTH}px`, pt: 1, lineHeight: 1.2 }}>{label}</Typography>
      {children}
    </Box>
  );
  const row = (label: string, names: readonly string[], inAngstroms = false, title?: string) =>
    labeled(label, <>{names.map((n) => field(n, inAngstroms))}</>, title);

  const volume = data.volume ?? null;
  const dims: [number, number, number] = data.dimensions;
  const mask = shown.mask ?? null;
  const fraction: number | null = shown.mask_fraction ?? null;
  // Without a volume, the viewer shows the mask itself
  const viewerData = useMemo(() => ({
    dimensions: dims,
    voxelSize: data.angpix ?? undefined,
    density: volume ? volume.density ?? null : mask,
  }), [dims, data.angpix, volume, mask]);
  const viewerMask = useMemo<VolumeMask | null>(
    () => (volume && mask ? { type: "map", density: mask, threshold: 0.5, label: "geometry" } : null),
    [volume, mask]);

  return (
    // The height of the dialog body, so the viewer fills it and nothing scrolls
    <Box sx={{ display: "flex", gap: 2, alignItems: "stretch", height: ROW_HEIGHT, minHeight: 420 }}>
      {/* Only the list of shapes shrinks (and scrolls) in short windows */}
      <Box sx={{ flex: "0 0 330px", display: "flex", flexDirection: "column", gap: 0.75, overflowY: "auto", pt: 0.5,
                 "& > *": { flexShrink: 0 } }}>
        <Typography variant="body2" noWrap title={volume?.path}>
          {volume ? <><b>Map:</b> {volume.path}</> : <b>Box</b>}
        </Typography>
        <Typography variant="caption" color="text.secondary" sx={{ mt: -1 }}>
          {dims.join(" × ")} px{data.angpix ? `, ${fmt(data.angpix)} Å/px` : ""}
          {(data.binning ?? 1) > 1 ? `, preview binned ${data.binning}×` : ""}
        </Typography>

        <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <Typography variant="subtitle2" title="The mask is the union of the shapes">
            Shapes ({shapes.length})
          </Typography>
          <Button size="small" startIcon={<PlusIcon />} onClick={addShape} sx={{ textTransform: "none" }}>
            Add shape
          </Button>
        </Box>
        {/* Many shapes scroll inside the list */}
        <List dense disablePadding ref={listRef}
              sx={{ flex: "0 1 auto", flexShrink: "1 !important", minHeight: 44, maxHeight: 140, overflow: "auto",
                    border: 1, borderColor: "divider", borderRadius: 1 }}>
          {shapes.map((s, i) => {
            const { primary, secondary } = describe(s);
            return (
              <ListItemButton key={i} selected={i === current} onClick={() => setCurrent(i)} sx={{ pr: 0.5, py: 0 }}>
                <ListItemText primary={`${i + 1}. ${primary}`} secondary={secondary} sx={{ my: 0.25 }}
                              primaryTypographyProps={{ fontSize: 13 }} secondaryTypographyProps={{ fontSize: 11 }} />
                <Tooltip title="Remove the shape">
                  <IconButton size="small" aria-label={`Remove shape ${i + 1}`}
                              onClick={(e) => { e.stopPropagation(); removeShape(i); }}>
                    <TrashBinIcon />
                  </IconButton>
                </Tooltip>
              </ListItemButton>
            );
          })}
          {shapes.length === 0 && (
            <Typography variant="body2" color="text.secondary" sx={{ p: 1 }}>No shapes: add one.</Typography>
          )}
        </List>

        {edited && (
          <>
            {labeled(`Shape ${current + 1}`,
              <TextField select size="small" value={edited.shape} sx={{ flex: 1 }}
                         inputProps={{ "aria-label": "Shape" }}
                         onChange={(e) => setKind(e.target.value as ShapeKind)}>
                {SHAPES.map((k) => <MenuItem key={k} value={k}>{k}</MenuItem>)}
              </TextField>)}
            {row("Center (px)", CENTER)}
            {row("Angles (°)", ANGLES, false, "Euler angles rot, tilt, psi (ZYZ, as Relion)")}
            {row("Size (px)", SIZES[edited.shape], true,
              edited.shape === "cylinder" ? "The height is along the rotated Z" : undefined)}
          </>
        )}

        {labeled("Soft edge (px)",
          <TextField size="small" value={softEdge} sx={{ flex: 1 }}
                     inputProps={{ "aria-label": "Soft edge (px)" }}
                     title="Raised cosine outside the shapes, as Relion's width_soft_edge; 0: a binary mask"
                     onChange={(e) => setSoftEdge(e.target.value)}
                     helperText={[toAngstroms(softEdge), "0: binary"].filter(Boolean).join(", ")} />)}

        {/* Re-calculate and its status on one line, the alerts below */}
        <Box sx={{ display: "flex", alignItems: "center", gap: 1, flexWrap: "wrap",
                   "& .MuiAlert-root": { flexBasis: "100%" } }}>
          <RecalculateControls outdated={outdated} status={status} recalculate={recalculate}
                               disabled={!preview || shapes.length === 0}
                               done={fraction != null ? `Mask: ${(fraction * 100).toFixed(2)}% of the box` : ""} />
        </Box>
      </Box>

      {/* A new box needs a new viewer; it fills the height of the row */}
      <PreviewViewer key={dims.join("x")} computing={status.computing} data={viewerData} mask={viewerMask}
                     height="fill" />
    </Box>
  );
}
