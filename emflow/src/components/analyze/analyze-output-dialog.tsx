// src/components/analyze/analyze-output-dialog.tsx
import { memo, useMemo } from "react";
import { Box, Chip, Dialog, DialogContent, DialogTitle, IconButton, Typography } from "@mui/material";
import { ThemeProvider as MuiThemeProvider } from "@mui/material/styles";
import { useEmflowMuiTheme } from "@/widget/overlay";
import { useTheme as useScipionTheme } from "@/context/ThemeContext";
import { CloseIcon } from "@/icons";
import { MetadataViewer } from "./metadata-viewer";
import VolumeViewer from "./volume-viewer";
import Coords2dViewer from "./coords2d-viewer";
import IntegratedTomographyViewer from "./integrated-tomography-viewer";
import FscViewer from "./fsc-viewer";

type AnalyzeOutputRef = { paramClass: string; value: string; info: string };

type AnalyzeOutputDialogProps = {
  open: boolean;
  onClose: () => void;
  projectId: string | number;
  protocolId: string | number;
  protocolLabel: string;
  outputName: string;
  outputRaw: any | null;
};

function normalizedKind(k?: string) {
  return (k ?? "").replace(/\s+/g, "").toLowerCase();
}

function isVolumeKind(k?: string) {
  const s = normalizedKind(k);
  return s === "volume" || s === "volumemask" || s === "setofvolumes";
}

function isCoords2dKind(k?: string) {
  const s = normalizedKind(k);
  return s.includes("setofcoordinates") && !s.includes("setofcoordinates3d");
}

function isCoords3dKind(k?: string) {
  return normalizedKind(k).includes("setofcoordinates3d");
}

function isTiltSeriesKind(k?: string) {
  const s = normalizedKind(k);
  return s.includes("setoftiltseries") && s !== "setoftiltseriesm";
}

function isCTFTomoSeriesKind(k?: string) {
  return normalizedKind(k).includes("setofctftomoseries");
}


function isTomographyIntegratedKind(k?: string) {
  return isCoords3dKind(k) || isTiltSeriesKind(k) || isCTFTomoSeriesKind(k) || normalizedKind(k) === "setoftomograms";
}

function isSetOfFSCsKind(k?: string) {
  return normalizedKind(k).includes("setoffsc");
}

function isSetOfMetadataKind(k?: string) {
  if (!k) return false;
  const trimmed = k.replace(/\s+/g, "");
  if (!/^SetOf/i.test(trimmed) && !/^RelionSetOf/i.test(trimmed)) return false;
  return (
    !isVolumeKind(k) &&
    !isCoords2dKind(k) &&
    !isCoords3dKind(k) &&
    !isTiltSeriesKind(k) &&
    !isCTFTomoSeriesKind(k) &&
    !isSetOfFSCsKind(k)
  );
}

const dialogPaperSx = {
  borderRadius: 2,
  overflow: "hidden",
  border: "1px solid",
  borderColor: "divider",
  bgcolor: "background.paper",
  boxShadow: "0 10px 20px rgba(0,0,0,0.15), 0 6px 10px rgba(0,0,0,0.08)",
  display: "flex",
  flexDirection: "column",
  width: "93vw",
  maxWidth: "93vw",
  height: "97vh",
  maxHeight: "98vh",
  minHeight: 650,
};
const headerSx = {
  px: 2,
  py: 1.25,
  display: "flex",
  alignItems: "center",
  gap: 1.5,
  background: "linear-gradient(180deg, #0b1220 0%, #0a0f1e 100%)",
  color: "#e5e7eb",
  borderBottom: "1px solid rgba(255,255,255,0.06)",
  flexShrink: 0,
};

const closeBtnSx = {
  ml: "auto",
  color: "#e5e7eb",
  border: "1px solid rgba(255,255,255,0.18)",
  background: "rgba(255,255,255,0.06)",
  "&:hover": { background: "rgba(255,255,255,0.12)", borderColor: "rgba(255,255,255,0.28)" },
};

function toStringSafe(v: unknown): string {
  if (v == null) return "";
  try {
    return String(v);
  } catch {
    return "";
  }
}

function unwrapOutputRaw(raw: any): any {
  if (!raw || typeof raw !== "object") return raw;
  if (raw.pointerClass || raw._class || raw.class || raw.type) return raw;
  const entries = Object.entries(raw);
  if (entries.length === 1 && entries[0][1] && typeof entries[0][1] === "object") return entries[0][1];
  return raw;
}

function buildOutputRef(raw: any): AnalyzeOutputRef {
  const r = unwrapOutputRaw(raw);
  return {
    paramClass: toStringSafe(r?.paramClass),
    value: toStringSafe(r?.value ?? r?._objValue ?? ""),
    info: toStringSafe(r?.info),
  };
}

function AnalyzeOutputDialog({ open, onClose, projectId, protocolId, protocolLabel, outputName, outputRaw }: AnalyzeOutputDialogProps) {
  const { theme: appTheme } = useScipionTheme();

  const muiTheme = useEmflowMuiTheme({ palette: { mode: appTheme } });

  const pointerClass = useMemo(() => {
    const r = unwrapOutputRaw(outputRaw);
    return toStringSafe(r?._class || r?.pointerClass || r?.class || r?.type);
  }, [outputRaw]);

  const outputRef = useMemo(() => buildOutputRef(outputRaw), [outputRaw]);
  const projectIdNum = useMemo(() => Number(projectId), [projectId]);
  const protocolIdNum = useMemo(() => Number(protocolId), [protocolId]);

  const body = useMemo(() => {

    if (isTomographyIntegratedKind(pointerClass)) {
      return (
        <IntegratedTomographyViewer
          projectId={projectIdNum}
          protocolId={protocolIdNum}
          protocolLabel={protocolLabel}
          outputName={outputName}
          pointerClass={pointerClass}
        />
      );
    }

    if (isVolumeKind(pointerClass)) {
      return <VolumeViewer
        projectId={projectIdNum}
        protocolId={protocolIdNum}
        protocolLabel={protocolLabel}
        outputName={outputName}
        pointerClass={pointerClass} />;
    }

    if (isCoords2dKind(pointerClass)) {
      return (
        <Coords2dViewer
          projectId={projectIdNum}
          protocolId={protocolIdNum}
          protocolLabel={protocolLabel}
          outputName={outputName}
          onClose={onClose}
        />
      );
    }

    if (isSetOfMetadataKind(pointerClass)) {
      return <MetadataViewer projectId={projectIdNum} protocolId={protocolIdNum} outputName={outputName} onClose={onClose} />;
    }

    if (isSetOfFSCsKind(pointerClass)) {
      return <FscViewer projectId={projectIdNum} protocolId={protocolIdNum} outputName={outputName} />;
    }

    return (
      <Box sx={{ p: 2 }}>
        <Typography variant="subtitle2" sx={{ mb: 1 }}>No specialized viewer yet for this output type.</Typography>
        <Typography variant="body2" sx={{ color: "text.secondary" }}>
          Output: <strong>{outputName}</strong><br />
          Class: <code>{pointerClass || "(unknown)"}</code><br />
          ParamClass: <code>{outputRef.paramClass || "(unknown)"}</code>
        </Typography>
      </Box>
    );
  }, [pointerClass, outputName, projectIdNum, protocolIdNum, protocolLabel, outputRef.paramClass, onClose]);

  const handleDialogClose = (_event: object, reason: "backdropClick" | "escapeKeyDown") => {
    if (reason === "backdropClick") return;
    onClose();
  };

  return (
    <MuiThemeProvider theme={muiTheme}>
      <Dialog
        open={open}
        onClose={handleDialogClose}
        maxWidth={false}
        fullWidth
        PaperProps={{ sx: dialogPaperSx }}
        onDoubleClickCapture={(event) => {
          event.stopPropagation();
        }}
      >
        <DialogTitle component="div" sx={headerSx}>
          <Box sx={{ display: "flex", flexDirection: "column", minWidth: 0, gap: 0.25, flex: 1 }}>
            <Box sx={{ display: "flex", alignItems: "baseline", gap: 1, minWidth: 0 }}>
              <Typography variant="subtitle1" sx={{ color: "#f3f4f6", fontWeight: 600, letterSpacing: 0.2, overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis" }}>
                Analyze Result - {outputName}
              </Typography>
              {pointerClass ? <Chip size="small" label={pointerClass} sx={{ height: 22, color: "#e5e7eb", bgcolor: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.18)", "& .MuiChip-label": { px: 1, py: 0.25 } }} /> : null}
            </Box>
            <Typography variant="caption" sx={{ color: "rgba(229,231,235,0.78)", overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis" }}>
              Protocol: {String(protocolLabel)}
            </Typography>
          </Box>
          <IconButton onClick={onClose} aria-label="Close analyze dialog" size="small" sx={closeBtnSx}>
            <CloseIcon fontSize="small" />
          </IconButton>
        </DialogTitle>
        <DialogContent dividers={false} sx={{ p: 0, display: "flex", flex: 1, minHeight: 0, minWidth: 0, overflow: "hidden" }}>
          <Box sx={{ flex: 1, minHeight: 0, minWidth: 0, overflow: "hidden" }}>{body}</Box>
        </DialogContent>
      </Dialog>
    </MuiThemeProvider>
  );
}

export default memo(AnalyzeOutputDialog);
