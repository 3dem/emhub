// src/components/viewers/PdfViewerDialog.tsx
//
// The "pdf" analyze viewer: a PDF output (e.g. a Relion logfile.pdf) in a
// dialog like VolumeViewerDialog's. The browser renders the file at the url
// of the host's decision (EMhub: /api/get_pdf_file) in an iframe, with its
// own PDF viewer (pages, zoom, search, print), so no PDF library is needed.
// The url is only the iframe src: the file is not fetched by emflow.
// When the browser can not show PDFs inline (navigator.pdfViewerEnabled is
// false, e.g. Chrome set to download PDFs), the iframe would only show an
// "Open" placeholder, so the dialog offers to open or download it instead.
import { useState } from "react";
import { Box, Button, Chip, Dialog, DialogContent, DialogTitle, IconButton, Tooltip, Typography } from "@mui/material";
import { Download, ExternalLink } from "lucide-react";
import { CloseIcon } from "@/icons/index";
import type { PdfViewerDecision } from "@/utils/analyze-viewer-decision";

type PdfViewerDialogProps = {
  decision: PdfViewerDecision;
  onClose: () => void;
  protocolLabel?: string;
};

const headerButtonSx = {
  color: "#e2e8f0", border: "1px solid rgba(255,255,255,0.18)", backgroundColor: "rgba(255,255,255,0.08)",
  "&:hover": { color: "#fff", backgroundColor: "rgba(255,255,255,0.16)" },
};

export default function PdfViewerDialog({ decision, onClose, protocolLabel = "" }: PdfViewerDialogProps) {
  const [loaded, setLoaded] = useState(false);
  const title = decision.title || "PDF";
  // undefined in older browsers: assume they can show it
  const inlineViewer = typeof navigator === "undefined" || navigator.pdfViewerEnabled !== false;

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
              {title}
            </Typography>
            <Chip size="small" label={decision.pointerClass || "PdfFile"}
                  sx={{ height: 22, borderRadius: 1.25, color: "#e2e8f0", backgroundColor: "rgba(255,255,255,0.08)",
                        border: "1px solid rgba(255,255,255,0.16)", fontSize: "0.66rem", fontWeight: 600 }} />
          </Box>
          {protocolLabel && (
            <Typography variant="caption"
                        sx={{ display: "block", mt: 0.35, color: "#cbd5e1", fontSize: "0.68rem", overflow: "hidden",
                              textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {`Protocol: ${protocolLabel}`}
            </Typography>
          )}
        </Box>
        <Tooltip title="Open in a new tab">
          <IconButton size="small" component="a" href={decision.url} target="_blank" rel="noopener noreferrer"
                      aria-label="Open PDF in a new tab" sx={headerButtonSx}>
            <ExternalLink size={16} />
          </IconButton>
        </Tooltip>
        <IconButton size="small" onClick={onClose} aria-label="Close PDF viewer" sx={headerButtonSx}>
          <CloseIcon fontSize="small" />
        </IconButton>
      </DialogTitle>
      <DialogContent sx={{ p: 0, flex: 1, minWidth: 0, minHeight: 0, overflow: "hidden", display: "flex",
                           flexDirection: "column", position: "relative", backgroundColor: "#525659" }}>
        {inlineViewer ? (
          <>
            {!loaded && (
              <Typography sx={{ position: "absolute", inset: 0, m: "auto", height: "fit-content", textAlign: "center",
                                color: "#e2e8f0" }}>
                Loading…
              </Typography>
            )}
            <Box
              component="iframe"
              src={decision.url}
              title={title}
              onLoad={() => setLoaded(true)}
              sx={{ border: 0, width: "100%", flex: 1, minHeight: 0, display: "block" }}
            />
          </>
        ) : (
          <Box sx={{ m: "auto", maxWidth: 460, px: 3, textAlign: "center", color: "#e2e8f0" }}>
            <Typography sx={{ fontWeight: 600, mb: 1 }}>This browser does not display PDF files inline</Typography>
            <Typography variant="body2" sx={{ color: "#cbd5e1", mb: 2.5 }}>
              It is set to download PDF files (in Chrome: Settings, Privacy and security, Site settings,
              PDF documents). Open the file in a new tab or download it.
            </Typography>
            <Box sx={{ display: "flex", gap: 1.5, justifyContent: "center" }}>
              <Button variant="contained" size="small" startIcon={<ExternalLink size={16} />}
                      component="a" href={decision.url} target="_blank" rel="noopener noreferrer">
                Open in a new tab
              </Button>
              <Button variant="outlined" size="small" startIcon={<Download size={16} />}
                      component="a" href={decision.url} download
                      sx={{ color: "#e2e8f0", borderColor: "rgba(255,255,255,0.4)" }}>
                Download
              </Button>
            </Box>
          </Box>
        )}
      </DialogContent>
    </Dialog>
  );
}
