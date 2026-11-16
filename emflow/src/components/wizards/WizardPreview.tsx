// Shared parts of the wizards with a preview computed by the server (e.g.
// MaskCreateWizard, PyTomTemplateWizard): the Re-calculate button and its
// status, and the VolumeViewer pane with a loading overlay.
import { useRef, useState, type ReactNode } from "react";
import { Alert, Box, Button, CircularProgress, Typography } from "@mui/material";
import VolumeViewer, { type VolumeViewerProps } from "@/components/viewers/VolumeViewer";
import type { WizardComponentProps } from "./WizardDialog";

type Status = { computing: boolean; warnings: string[]; errors: string[] };

/** The data of the last preview (the first one came with the wizard), for
 * the values of the form: `outdated` when they changed since, `recalculate`
 * asks for a new one (the answer of an older request is ignored). */
export function useWizardPreview<V>(values: V, data: Record<string, any>,
                                    preview: WizardComponentProps["preview"]) {
  const [shown, setShown] = useState<Record<string, any>>(data);
  const [computed, setComputed] = useState(values);
  const [status, setStatus] = useState<Status>({ computing: false, warnings: [], errors: [] });
  const outdated = JSON.stringify(computed) !== JSON.stringify(values);
  const counter = useRef(0);

  const recalculate = async () => {
    if (!preview) return;
    const id = ++counter.current;
    const asked = values;
    setStatus((s) => ({ ...s, computing: true }));
    const res = await preview(asked as any).catch((e) => ({ errors: [String(e?.message ?? e)] }) as any);
    if (id !== counter.current) return;
    if (res?.errors?.length) {
      setStatus({ computing: false, warnings: [], errors: res.errors });
      return;
    }
    setShown((d) => ({ ...d, ...(res?.data ?? {}) }));
    setComputed(asked);
    setStatus({ computing: false, warnings: res?.warnings ?? [], errors: [] });
  };
  return { data: shown, outdated, status, recalculate };
}

/** Re-calculate: greyed out until a value changes, then vivid; with the
 * status line (`done`: shown when the preview is up to date) and alerts. */
export function RecalculateControls({ outdated, status, recalculate, disabled, done }: {
  outdated: boolean; status: Status; recalculate: () => void; disabled?: boolean; done?: ReactNode;
}) {
  return (
    <>
      <Button variant={outdated ? "contained" : "outlined"} color={outdated ? "warning" : "primary"}
              size="small" onClick={recalculate}
              disabled={disabled || !outdated || status.computing}
              startIcon={status.computing ? <CircularProgress size={14} color="inherit" /> : undefined}
              sx={{ textTransform: "none", alignSelf: "flex-start" }}>
        {status.computing ? "Calculating…" : "Re-calculate"}
      </Button>
      <Typography variant="body2" color="text.secondary" aria-live="polite">
        {status.computing ? "Computing…"
          : outdated ? "The values changed: Re-calculate to update the view." : done}
      </Typography>
      {status.errors.map((e, i) => <Alert key={`e${i}`} severity="error">{e}</Alert>)}
      {status.warnings.map((w, i) => <Alert key={`w${i}`} severity="warning">{w}</Alert>)}
    </>
  );
}

/** The VolumeViewer (3D volume first, and Slices) of the preview, with a
 * loading overlay while it is computed. */
export function PreviewViewer({ computing, ...props }: { computing: boolean } & VolumeViewerProps) {
  return (
    <Box sx={{ flex: "1 1 520px", minWidth: 0, position: "relative" }}>
      {computing && (
        <Box role="status"
             sx={{ position: "absolute", inset: 0, zIndex: 2, display: "flex", alignItems: "center",
                   justifyContent: "center", gap: 1.5, backgroundColor: "rgba(255,255,255,0.55)",
                   borderRadius: 1 }}>
          <CircularProgress size={28} />
          <Typography variant="body2">Loading the preview…</Typography>
        </Box>
      )}
      {props.data?.density ? (
        <VolumeViewer
          tabs={{ slices: true, view3d: false, volume3d: true }}
          initialTab="volume3d"
          tools={{ particles: false, select: false, crosshair: false }}
          viewSize={420}
          debug={false}
          {...props}
        />
      ) : (
        <Alert severity="info">The host sent no density of the map to show.</Alert>
      )}
    </Box>
  );
}
