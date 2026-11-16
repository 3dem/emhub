// Template and mask of PyTom (server: emwrap.pytom.wizards.PyTomTemplateWizard,
// emw-pytom-create_template): the voxel sizes, output box and the template
// operations (center, invert, mirror), and the spherical mask (radius and
// sigma) on the left; the tentative template with the mask over it in a
// VolumeViewer on the right. Both are computed by the server (preview, numpy
// on the output box downscaled to about 100 px) on Re-calculate; they are a
// guide, the job runs pytom_create_template.py and pytom_create_mask.py.
import { useEffect, useMemo, useState } from "react";
import { Box, Checkbox, FormControlLabel, TextField, Typography } from "@mui/material";
import type { VolumeMask } from "@/components/viewers/VolumeViewer";
import type { WizardComponentProps } from "./WizardDialog";
import { PreviewViewer, RecalculateControls, useWizardPreview } from "./WizardPreview";
import { fmt, num } from "./MaskCreateWizard";

const NUMBERS = ["in_angpix", "out_angpix", "box", "radius", "sigma"] as const;
const FLAGS = ["center", "invert", "mirror"] as const;
type NumberName = (typeof NUMBERS)[number];
type FlagName = (typeof FLAGS)[number];

export default function PyTomTemplateWizard({ inputs, data, onChange, preview }: WizardComponentProps) {
  // Typed text of the number fields (an unfinished number is kept)
  const [texts, setTexts] = useState(() =>
    Object.fromEntries(NUMBERS.map((n) => [n, fmt(inputs[n], 6)])) as Record<NumberName, string>);
  const [flags, setFlags] = useState(() =>
    Object.fromEntries(FLAGS.map((n) => [n, Boolean(inputs[n])])) as Record<FlagName, boolean>);
  const values = useMemo(() => ({
    ...Object.fromEntries(NUMBERS.map((n) => [n, num(texts[n])])), ...flags,
  }) as Record<NumberName, number | null> & Record<FlagName, boolean>, [texts, flags]);
  const { data: shown, outdated, status, recalculate } = useWizardPreview(values, data, preview);
  useEffect(() => {
    onChange(values);
    // onChange is a new function on each render of the dialog
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [values]);

  const field = (name: NumberName, label: string, helperText?: string) => (
    <TextField label={label} size="small" value={texts[name]} helperText={helperText}
               onChange={(e) => setTexts((t) => ({ ...t, [name]: e.target.value }))} />
  );
  const flag = (name: FlagName, label: string) => (
    <FormControlLabel label={label}
                      control={<Checkbox size="small" checked={flags[name]}
                                         onChange={(e) => setFlags((f) => ({ ...f, [name]: e.target.checked }))} />} />
  );

  const input = data.input ?? {};
  const box: number = shown.box;
  const binning: number = shown.binning ?? 1;
  const viewerData = useMemo(() => ({
    dimensions: [box, box, box] as [number, number, number],
    voxelSize: shown.angpix,
    density: shown.template ?? null,
  }), [box, shown.angpix, shown.template]);
  const viewerMask = useMemo<VolumeMask | null>(
    () => (shown.mask ? { type: "map", density: shown.mask, threshold: 0.5, label: "PyTom mask" } : null),
    [shown.mask]);
  const pair = { display: "flex", gap: 1 };

  return (
    <Box sx={{ display: "flex", gap: 2, alignItems: "flex-start", flexWrap: "wrap" }}>
      <Box sx={{ flex: "0 0 260px", display: "flex", flexDirection: "column", gap: 1.5 }}>
        <Typography variant="body2" sx={{ wordBreak: "break-all" }}>
          <b>Map:</b> {input.path}
          {input.dimensions ? ` (${input.dimensions.join(" × ")}`
            + `${input.voxelSize ? `, ${fmt(input.voxelSize)} Å/px` : ""})` : ""}
        </Typography>
        <Typography variant="subtitle2">Template</Typography>
        <Box sx={pair}>
          {field("in_angpix", "Input voxel (Å)")}
          {field("out_angpix", "Output voxel (Å)")}
        </Box>
        {field("box", "Output box (px)",
          values.box && values.out_angpix ? `${fmt(values.box * values.out_angpix)} Å` : undefined)}
        <Box sx={{ display: "flex", flexWrap: "wrap" }}>
          {flag("center", "Center")}
          {flag("invert", "Invert")}
          {flag("mirror", "Mirror")}
        </Box>
        <Typography variant="subtitle2">Mask</Typography>
        <Box sx={pair}>
          {field("radius", "Radius (px)",
            values.radius && values.out_angpix ? `${fmt(values.radius * values.out_angpix)} Å` : undefined)}
          {field("sigma", "Sigma (px)", "Gaussian edge")}
        </Box>

        <RecalculateControls outdated={outdated} status={status} recalculate={recalculate}
                             disabled={!preview}
                             done={box ? `Template: ${box}³ px, ${fmt(shown.angpix)} Å/px` : ""} />
        <Typography variant="caption" color="text.secondary">
          A tentative template and mask, computed on the output box downscaled
          {binning > 1 ? ` ${binning}× ` : " "}to help choose the parameters.
          The job creates them with pytom_create_template.py and pytom_create_mask.py.
        </Typography>
      </Box>

      {/* A new box needs a new viewer */}
      <PreviewViewer key={`${box}/${binning}`} computing={status.computing}
                     data={viewerData} mask={viewerMask} />
    </Box>
  );
}
