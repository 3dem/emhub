// Mask of a volume (server: emwrap.base.wizards.VolumeMaskWizard): the
// volume in a VolumeViewer (3D volume first, and Slices without the select
// tool and the crosshair) with its mask over it, a
// mask map or, without one, a sphere of the given diameter. The mask options
// are in the viewer's mask panel; the sphere diameter chosen there (Å) is
// the output. The volumes (data.volume, data.mask) come with the request of
// their density, added by the host.
import { useMemo, useState } from "react";
import { Box, Typography } from "@mui/material";
import VolumeViewer, { type VolumeMask, type VolumeMaskState } from "@/components/viewers/VolumeViewer";
import type { WizardComponentProps } from "./WizardDialog";

type WizardVolume = {
  path: string;
  dimensions: [number, number, number];
  voxelSize: number | null;
  density?: { path: string; payload?: Record<string, unknown> };
};

const fmt = (v: number) => String(Math.round(v * 10) / 10);
const basename = (path: string) => path.split("/").pop() || path;
const dims = (v: WizardVolume) => v.dimensions.join(" × ");

export default function VolumeMaskWizard({ inputs, data, onChange }: WizardComponentProps) {
  const volume = data.volume as WizardVolume;
  const maskMap = (data.mask ?? null) as WizardVolume | null;
  const angpix = volume.voxelSize;
  const [state, setState] = useState<VolumeMaskState | null>(null);

  const viewerData = useMemo(() => ({
    dimensions: volume.dimensions,
    voxelSize: volume.voxelSize,
    density: volume.density ?? null,
  }), [volume]);
  const mask = useMemo<VolumeMask>(() => (maskMap?.density
    ? { type: "map", density: maskMap.density, label: basename(maskMap.path) }
    : { type: "sphere", diameter: inputs.diameter, ...(angpix ? {} : { diameterPx: inputs.diameter }) }),
  [maskMap, inputs.diameter, angpix]);

  const onMaskChange = (m: VolumeMaskState) => {
    setState(m);
    onChange({
      mask_type: m.type,
      // Without the voxel size the diameter is in px (as given)
      diameter: m.type === "sphere" ? m.diameter ?? m.diameterPx : inputs.diameter,
    });
  };

  const sphere = state?.type === "sphere" ? state : null;
  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 1 }}>
      <Typography variant="body2">
        <b>Map:</b> {volume.path} ({dims(volume)}{angpix ? `, ${fmt(angpix)} Å/px` : ""})
      </Typography>
      <Typography variant="body2">
        <b>Mask:</b>{" "}
        {maskMap ? `${maskMap.path} (${dims(maskMap)})`
          : sphere ? <>sphere of {angpix && sphere.diameter ? `${fmt(sphere.diameter)} Å · ` : ""}
              {fmt(sphere.diameterPx)} px diameter</>
          : "sphere"}
      </Typography>
      {!maskMap && (
        <Typography variant="caption" color="text.secondary">
          Change the diameter, color or opacity with the mask button of the viewer toolbar.
        </Typography>
      )}
      <VolumeViewer
        data={viewerData}
        tabs={{ slices: true, view3d: false, volume3d: true }}
        initialTab="volume3d"
        tools={{ particles: false, select: false, crosshair: false }}
        mask={mask}
        viewSize={420}
        debug={false}
        onMaskChange={onMaskChange}
      />
    </Box>
  );
}
