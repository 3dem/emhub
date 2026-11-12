// src/components/viewers/VolumeViewerDialog.tsx
//
// The "volume" analyze viewer: a map or a mask output in a VolumeViewer, in
// a dialog like TableViewerDialog's. The host's decision gives the
// VolumeViewer pane content inline (`data`) or a request for it (`source`,
// loaded with the DataLoader; EMhub: /api/get_volume_viewer), and its
// viewerConfig sets the viewer: for a mask, its map with the mask over it.
import { Box, Chip, Dialog, DialogContent, DialogTitle, IconButton, Typography } from "@mui/material";
import { CloseIcon } from "@/icons/index";
import { useLoad } from "@/data/DataLoaderContext";
import type { VolumeViewerDecision } from "@/utils/analyze-viewer-decision";
import VolumeViewer from "./VolumeViewer";

type VolumeViewerDialogProps = {
  decision: VolumeViewerDecision;
  onClose: () => void;
  protocolLabel?: string;
};

/** The pane content of a response: {paneContent} or the pane itself. */
const paneOf = (r: any) => (r && typeof r === "object" && "paneContent" in r ? r.paneContent : r);

export default function VolumeViewerDialog({ decision, onClose, protocolLabel = "" }: VolumeViewerDialogProps) {
  const source = decision.data ? null : decision.source ?? null;
  const loaded = useLoad<unknown>(source?.path, source?.payload);
  const pane = decision.data ?? (loaded.status === "ready" ? paneOf(loaded.data) : null);

  let body;
  if (pane) {
    body = (
      <VolumeViewer key={JSON.stringify(source ?? null)} data={pane} height="fill" {...(pane.viewerConfig ?? {})} />
    );
  } else {
    body = (
      <Typography sx={{ m: "auto", color: loaded.status === "error" ? "error.main" : "text.secondary" }}>
        {loaded.status === "error" ? loaded.error.message : source ? "Loading…" : "No volume to show."}
      </Typography>
    );
  }

  return (
    <Dialog
      open
      onClose={(_e, reason) => reason !== "backdropClick" && onClose()}
      maxWidth={false}
      fullWidth
      PaperProps={{
        sx: {
          width: "92vw", maxWidth: "92vw", height: "92vh", maxHeight: "92vh", m: 0, borderRadius: 2.5,
          overflow: "hidden", display: "flex", flexDirection: "column", border: "1px solid var(--emf-slate-200)",
          backgroundColor: "var(--emf-white)", boxShadow: "0 24px 70px rgba(15,23,42,0.22)",
        },
      }}
      onDoubleClickCapture={(event) => event.stopPropagation()}
    >
      <DialogTitle
        component="div"
        sx={{
          minHeight: 58, px: 2.25, py: 1, display: "flex", alignItems: "center", gap: 1.25, flexShrink: 0,
          borderBottom: "1px solid #475569",
          background: "linear-gradient(135deg, #1f2937 0%, #334155 58%, #475569 100%)",
        }}
      >
        <Box sx={{ minWidth: 0, flex: 1 }}>
          <Box sx={{ display: "flex", alignItems: "center", gap: 1, minWidth: 0 }}>
            <Typography sx={{ color: "#fff", fontSize: "1.05rem", fontWeight: 700, overflow: "hidden",
                              textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {decision.title || pane?.title || "Volume"}
            </Typography>
            {decision.pointerClass ? (
              <Chip size="small" label={decision.pointerClass}
                    sx={{ height: 22, borderRadius: 1.25, color: "#e2e8f0", backgroundColor: "rgba(255,255,255,0.08)",
                          border: "1px solid rgba(255,255,255,0.16)", fontSize: "0.66rem", fontWeight: 600 }} />
            ) : null}
          </Box>
          {(pane?.title || protocolLabel) && (
            <Typography variant="caption"
                        sx={{ display: "block", mt: 0.35, color: "#cbd5e1", fontSize: "0.68rem", overflow: "hidden",
                              textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {[protocolLabel && `Protocol: ${protocolLabel}`, pane?.title].filter(Boolean).join(" · ")}
            </Typography>
          )}
        </Box>
        <IconButton size="small" onClick={onClose} aria-label="Close volume viewer"
                    sx={{ color: "#e2e8f0", border: "1px solid rgba(255,255,255,0.18)",
                          backgroundColor: "rgba(255,255,255,0.08)",
                          "&:hover": { color: "#fff", backgroundColor: "rgba(255,255,255,0.16)" } }}>
          <CloseIcon fontSize="small" />
        </IconButton>
      </DialogTitle>
      <DialogContent sx={{ p: 2, flex: 1, minWidth: 0, minHeight: 0, overflow: "auto", display: "flex",
                           flexDirection: "column" }}>
        {body}
      </DialogContent>
    </Dialog>
  );
}
