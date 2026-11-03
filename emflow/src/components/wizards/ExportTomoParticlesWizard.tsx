// Box and pixel size of the tomography particles exported from the
// tilt-series (server: emwrap.base.wizards.ExportTomoParticlesWizard).
// Input pane: tilt-series pixel size (read-only) and input box; output pane:
// pixel size and box. The binning factor relates the pixel sizes
// (out = in * binning); the box sizes are independent, the squares show
// both boxes at the same scale in A. The particle diameter (A, editable)
// is the reference circle; the server gives the form value or half of the
// input box, and an empty field also falls back to half of the input box.
import { useEffect, useState } from "react";
import { Box, Button, TextField, Tooltip, Typography } from "@mui/material";
import type { WizardComponentProps } from "./WizardDialog";

const SQUARE_SIZE = 150; // px of the largest box in the squares

function toNumber(text: string): number | null {
  const v = parseFloat(text);
  return Number.isFinite(v) ? v : null;
}

function fmt(value: number | null | undefined, digits = 3): string {
  if (value == null || !Number.isFinite(value)) return "";
  return String(Number(value.toFixed(digits)));
}

type BoxSquareProps = {
  boxAngst: number | null;
  otherBoxAngst: number | null; // the box of the other pane (dashed)
  diameter: number | null;
  scale: number; // px per A
};

function BoxSquare({ boxAngst, otherBoxAngst, diameter, scale }: BoxSquareProps) {
  const size = SQUARE_SIZE + 20;
  const c = size / 2;
  const square = (angst: number | null, dashed: boolean) =>
    angst && angst > 0 ? (
      <rect
        x={c - (angst * scale) / 2}
        y={c - (angst * scale) / 2}
        width={angst * scale}
        height={angst * scale}
        fill={dashed ? "none" : "currentColor"}
        fillOpacity={dashed ? undefined : 0.08}
        stroke="currentColor"
        strokeWidth={dashed ? 1 : 2}
        strokeDasharray={dashed ? "4 3" : undefined}
        opacity={dashed ? 0.6 : 1}
      />
    ) : null;

  return (
    <Box sx={{ display: "flex", justifyContent: "center", color: "primary.main", mt: 1 }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label="Box size">
        {square(otherBoxAngst, true)}
        {square(boxAngst, false)}
        {diameter && diameter > 0 ? (
          <circle
            cx={c}
            cy={c}
            r={(diameter * scale) / 2}
            fill="none"
            stroke="#e67e22"
            strokeWidth={1.5}
          />
        ) : null}
      </svg>
    </Box>
  );
}

type PaneProps = {
  title: string;
  children: React.ReactNode;
};

function Pane({ title, children }: PaneProps) {
  return (
    <Box sx={{ flex: "1 1 260px", minWidth: 0, border: 1, borderColor: "divider", borderRadius: 2, p: 2 }}>
      <Typography sx={{ fontWeight: 600, mb: 1.5 }}>{title}</Typography>
      <Box sx={{ display: "flex", flexDirection: "column", gap: 1.5 }}>{children}</Box>
    </Box>
  );
}

export default function ExportTomoParticlesWizard({ inputs, data, onChange }: WizardComponentProps) {
  const inAngpix = Number(data.in_angpix) || 0;

  const [inBox, setInBox] = useState(fmt(inputs.in_box, 0));
  const [outBox, setOutBox] = useState(fmt(inputs.out_box, 0));
  const [outAngpix, setOutAngpix] = useState(fmt(inputs.out_angpix, 4));
  const [binning, setBinning] = useState(fmt(inputs.binning ?? (inputs.out_angpix / inAngpix), 4));
  const [diameterText, setDiameterText] = useState(fmt(inputs.diameter, 2));

  const inBoxN = toNumber(inBox);
  const outBoxN = toNumber(outBox);
  const outAngpixN = toNumber(outAngpix);
  const inBoxAngst = inBoxN != null ? inBoxN * inAngpix : null;
  const outBoxAngst = outBoxN != null && outAngpixN ? outBoxN * outAngpixN : null;

  // Particle diameter (A); empty: half of the input box
  const halfInBox = inBoxAngst && inBoxAngst > 0 ? inBoxAngst / 2 : null;
  const typedDiameter = toNumber(diameterText);
  const diameter = typedDiameter && typedDiameter > 0 ? typedDiameter : halfInBox;

  useEffect(() => {
    onChange({ in_box: inBoxN, out_box: outBoxN, out_angpix: outAngpixN, diameter });
  }, [inBox, outBox, outAngpix, diameter]); // eslint-disable-line react-hooks/exhaustive-deps

  // The pixel sizes are related by the binning factor
  const changeBinning = (text: string) => {
    setBinning(text);
    const b = toNumber(text);
    if (b && b > 0) setOutAngpix(fmt(inAngpix * b, 4));
  };

  const changeOutAngpix = (text: string) => {
    setOutAngpix(text);
    const a = toNumber(text);
    if (a && a > 0 && inAngpix) setBinning(fmt(a / inAngpix, 4));
  };

  // Output box with the same size in A as the input box
  const matchOutBox = () => {
    if (inBoxAngst && outAngpixN) setOutBox(fmt(Math.round(inBoxAngst / outAngpixN), 0));
  };

  const maxAngst = Math.max(inBoxAngst ?? 0, outBoxAngst ?? 0, diameter ?? 0);
  const scale = maxAngst > 0 ? SQUARE_SIZE / maxAngst : 0;

  const numberField = (label: string, value: string, onValue: (t: string) => void, unit: string, readOnly = false) => (
    <TextField
      size="small"
      type="number"
      label={label}
      value={value}
      onChange={(e) => onValue(e.target.value)}
      InputProps={{ readOnly, endAdornment: <Typography variant="caption" sx={{ ml: 1, whiteSpace: "nowrap" }}>{unit}</Typography> }}
      inputProps={{ min: 0, step: "any" }}
      disabled={readOnly}
      fullWidth
    />
  );

  const angstCaption = (angst: number | null) => (
    <Typography variant="caption" color="text.secondary">
      Box size: {angst != null ? `${fmt(angst, 1)} Å` : "-"}
    </Typography>
  );

  const ratio = inBoxAngst && outBoxAngst ? outBoxAngst / inBoxAngst : null;

  // Particle diameter at the pixel size of a pane
  const diameterCaption = (angpix: number | null) => (
    <Typography variant="caption" color="text.secondary">
      Particle diameter:{" "}
      {diameter && angpix ? `${fmt(diameter / angpix, 1)} px · ${fmt(diameter, 1)} Å` : "-"}
    </Typography>
  );

  return (
    <Box>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        {data.tomograms_count ?? "?"} tomograms from <code>{String(data.tomograms ?? "")}</code>
      </Typography>

      <Box sx={{ display: "flex", gap: 2, alignItems: "stretch", flexWrap: "wrap" }}>
        <Pane title="Input (tilt-series)">
          {numberField("Pixel size", fmt(inAngpix, 4), () => undefined, "Å/px", true)}
          {numberField("Box size", inBox, setInBox, "px")}
          {angstCaption(inBoxAngst)}
          {diameterCaption(inAngpix)}
          {scale > 0 && (
            <BoxSquare boxAngst={inBoxAngst} otherBoxAngst={outBoxAngst} diameter={diameter} scale={scale} />
          )}
        </Pane>

        <Box sx={{ flex: "0 0 150px", display: "flex", flexDirection: "column", justifyContent: "center", gap: 1 }}>
          {numberField("Binning", binning, changeBinning, "×")}
          <Typography variant="caption" color="text.secondary" sx={{ textAlign: "center", mb: 2 }}>
            output pixel size = input × binning
          </Typography>
          <Tooltip title="Reference circle (orange). Empty: half of the input box.">
            <span>
              <TextField
                size="small"
                type="number"
                label="Particle diameter"
                value={diameterText}
                placeholder={fmt(halfInBox, 1)}
                onChange={(e) => setDiameterText(e.target.value)}
                InputProps={{ endAdornment: <Typography variant="caption" sx={{ ml: 1 }}>Å</Typography> }}
                InputLabelProps={{ shrink: true }}
                inputProps={{ min: 0, step: "any" }}
                fullWidth
              />
            </span>
          </Tooltip>
        </Box>

        <Pane title="Output (particles)">
          {numberField("Pixel size", outAngpix, changeOutAngpix, "Å/px")}
          {numberField("Box size", outBox, setOutBox, "px")}
          <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 1 }}>
            {angstCaption(outBoxAngst)}
            <Tooltip title="Output box with the same size in Å as the input box">
              <span>
                <Button size="small" onClick={matchOutBox} disabled={!inBoxAngst || !outAngpixN} sx={{ textTransform: "none" }}>
                  Match input
                </Button>
              </span>
            </Tooltip>
          </Box>
          {diameterCaption(outAngpixN)}
          {scale > 0 && (
            <BoxSquare boxAngst={outBoxAngst} otherBoxAngst={inBoxAngst} diameter={diameter} scale={scale} />
          )}
        </Pane>
      </Box>

      {ratio != null && Math.abs(ratio - 1) > 0.01 && (
        <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 1.5 }}>
          The output box covers {fmt(ratio * 100, 0)}% of the input box side (dashed square: the other box).
        </Typography>
      )}
    </Box>
  );
}
