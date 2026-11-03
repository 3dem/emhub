// Parameters of a 3D mask created from a map (server:
// emwrap.base.wizards.MaskCreateWizard, e.g. emw-relion-mask_create): the
// initial threshold, lowpass, extend, soft edge and invert on the left, and
// the map in a VolumeViewer (3D volume first, and Slices) with a tentative
// mask over it on the right. The tentative mask is computed by the server
// (preview, numpy on the map downscaled to about 100 px) a moment after the
// values stop changing; it is only a guide, the job runs relion_mask_create.
import { useEffect, useMemo, useRef, useState } from "react";
import { Alert, Box, Checkbox, FormControlLabel, Slider, TextField, Typography } from "@mui/material";
import VolumeViewer, { type VolumeMask } from "@/components/viewers/VolumeViewer";
import type { WizardComponentProps } from "./WizardDialog";

const PREVIEW_DELAY_MS = 400;

type Values = {
  threshold: number | null;
  lowpass: number | null;
  extend: number;
  soft_edge: number;
  invert: boolean;
};

const num = (text: string): number | null => {
  const v = parseFloat(text);
  return Number.isFinite(v) ? v : null;
};
const fmt = (v: number | null | undefined, digits = 4) =>
  v == null || !Number.isFinite(v) ? "" : String(Number(v.toPrecision(digits)));

export default function MaskCreateWizard({ inputs, data, onChange, preview }: WizardComponentProps) {
  const [values, setValues] = useState<Values>(() => ({
    threshold: inputs.threshold ?? null,
    lowpass: inputs.lowpass ?? null,
    extend: inputs.extend ?? 0,
    soft_edge: inputs.soft_edge ?? 0,
    invert: Boolean(inputs.invert),
  }));
  // Typed text of the number fields (an unfinished number is kept)
  const [texts, setTexts] = useState(() => ({
    threshold: fmt(values.threshold), lowpass: fmt(values.lowpass),
    extend: String(values.extend), soft_edge: String(values.soft_edge),
  }));
  const [mask, setMask] = useState<any>(data.mask ?? null);
  const [fraction, setFraction] = useState<number | null>(data.mask_fraction ?? null);
  const [status, setStatus] = useState<{ computing: boolean; warnings: string[]; errors: string[] }>(
    { computing: false, warnings: [], errors: [] });

  // A new tentative mask once the values stop changing (the first one came
  // with the wizard); an older answer is ignored
  const first = useRef(true);
  const counter = useRef(0);
  useEffect(() => {
    onChange(values);
    if (first.current) {
      first.current = false;
      return undefined;
    }
    if (!preview || values.threshold == null) return undefined;
    const id = ++counter.current;
    const timer = window.setTimeout(async () => {
      setStatus((s) => ({ ...s, computing: true }));
      const res = await preview(values).catch((e) => ({ errors: [String(e?.message ?? e)] }) as any);
      if (id !== counter.current) return;
      if (res?.errors?.length) {
        setStatus({ computing: false, warnings: [], errors: res.errors });
        return;
      }
      if (res?.data?.mask) setMask(res.data.mask);
      setFraction(res?.data?.mask_fraction ?? null);
      setStatus({ computing: false, warnings: res?.warnings ?? [], errors: [] });
    }, PREVIEW_DELAY_MS);
    return () => window.clearTimeout(timer);
    // onChange and preview are new functions on each render of the dialog
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [values]);

  const setText = (name: keyof typeof texts, text: string, value: number | null, integer = false) => {
    setTexts((t) => ({ ...t, [name]: text }));
    if (name === "lowpass") setValues((v) => ({ ...v, lowpass: value && value > 0 ? value : null }));
    else if (value != null) setValues((v) => ({ ...v, [name]: integer ? Math.round(value) : value }));
  };

  const volume = data.volume ?? {};
  const viewerData = useMemo(() => ({
    dimensions: volume.dimensions,
    voxelSize: volume.voxelSize,
    density: volume.density ?? null,
  }), [volume]);
  const viewerMask = useMemo<VolumeMask | null>(
    () => (mask ? { type: "map", density: mask, threshold: 0.5, label: "tentative" } : null), [mask]);
  // The 3D volume starts at the threshold of the mask
  const defaults = useMemo(() => ({ iso: { threshold: inputs.threshold ?? undefined, dust: 100 } }),
    [inputs.threshold]);

  const [lo, hi] = data.value_range ?? [0, 1];
  const binning = data.binning ?? 1;
  const dims = volume.dimensions as number[] | undefined;

  return (
    <Box sx={{ display: "flex", gap: 2, alignItems: "flex-start", flexWrap: "wrap" }}>
      <Box sx={{ flex: "0 0 260px", display: "flex", flexDirection: "column", gap: 1.5 }}>
        <Typography variant="body2" sx={{ wordBreak: "break-all" }}>
          <b>Map:</b> {volume.path}
          {dims ? ` (${dims.join(" × ")}${data.angpix ? `, ${fmt(data.angpix, 4)} Å/px` : ""})` : ""}
        </Typography>

        <TextField label="Initial threshold" size="small" value={texts.threshold}
                   onChange={(e) => setText("threshold", e.target.value, num(e.target.value))}
                   helperText={`Map values ${fmt(lo)} to ${fmt(hi)}`} />
        <Slider size="small" min={lo} max={hi} step={(hi - lo) / 400 || 0.001}
                value={values.threshold ?? lo} aria-label="Initial threshold"
                onChange={(_e, v) => setText("threshold", fmt(v as number), v as number)} />
        <TextField label="Lowpass (Å)" size="small" value={texts.lowpass} placeholder="none"
                   onChange={(e) => setText("lowpass", e.target.value, num(e.target.value))}
                   helperText="Applied before the threshold; empty: none" />
        <Box sx={{ display: "flex", gap: 1 }}>
          <TextField label="Extend (px)" size="small" value={texts.extend} type="number"
                     onChange={(e) => setText("extend", e.target.value, num(e.target.value), true)}
                     helperText="Negative: shrink" />
          <TextField label="Soft edge (px)" size="small" value={texts.soft_edge} type="number"
                     inputProps={{ min: 0 }}
                     onChange={(e) => setText("soft_edge", e.target.value, num(e.target.value), true)} />
        </Box>
        <FormControlLabel label="Invert the mask"
                          control={<Checkbox size="small" checked={values.invert}
                                             onChange={(e) => setValues((v) => ({ ...v, invert: e.target.checked }))} />} />

        <Typography variant="body2" color="text.secondary" aria-live="polite">
          {status.computing ? "Computing the mask…"
            : fraction != null ? `Tentative mask: ${(fraction * 100).toFixed(1)}% of the box` : ""}
        </Typography>
        {status.errors.map((e, i) => <Alert key={`e${i}`} severity="error">{e}</Alert>)}
        {status.warnings.map((w, i) => <Alert key={`w${i}`} severity="warning">{w}</Alert>)}
        <Typography variant="caption" color="text.secondary">
          A tentative mask, computed on the map downscaled
          {binning > 1 ? ` ${binning}× ` : " "}with approximate edges, to help choose the parameters.
          The job creates the mask with relion_mask_create.
        </Typography>
      </Box>

      <Box sx={{ flex: "1 1 520px", minWidth: 0 }}>
        {viewerData.density ? (
          <VolumeViewer
            data={viewerData}
            tabs={{ slices: true, view3d: false, volume3d: true }}
            initialTab="volume3d"
            tools={{ particles: false, select: false, crosshair: false }}
            defaults={defaults}
            mask={viewerMask}
            viewSize={420}
            debug={false}
          />
        ) : (
          <Alert severity="info">The host sent no density of the map to show.</Alert>
        )}
      </Box>
    </Box>
  );
}
