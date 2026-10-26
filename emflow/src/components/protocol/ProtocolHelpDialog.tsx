import { Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, IconButton } from "@mui/material";
import { CloseIcon } from "../../icons";
import renderRichHelpText from "./HelpText";

type ProtocolHelpDialogProps = {
  open: boolean;
  onClose: () => void;
  text: string;
  title?: string;
};

export default function ProtocolHelpDialog({
  open,
  onClose,
  text,
  title = "Help",
}: ProtocolHelpDialogProps) {
  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth="sm"
      fullWidth
      slotProps={{
        backdrop: {
          sx: { backgroundColor: "transparent" },
        },
      }}
      PaperProps={{
        sx: {
          borderRadius: 4,
          overflow: "hidden",
          border: "1px solid",
          borderColor: "divider",
          boxShadow: "0 18px 50px rgba(0,0,0,0.35)",
        },
      }}
    >
      <DialogTitle
        sx={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          backgroundColor: "#333d49",
          color: "white",
          px: 2,
          py: 1.5,
          boxSizing: "border-box",
          m: 0,
        }}
      >
        <Box sx={{ minWidth: 0, pr: 1 }}>
          <Box
            component="div"
            sx={{
              fontWeight: 600,
              fontSize: 16,
              lineHeight: 1.2,
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {title}
          </Box>
        </Box>

        <IconButton
          onClick={onClose}
          aria-label="Close"
          size="small"
          sx={{
            color: "white",
            borderRadius: 1,
            "&:hover": { backgroundColor: "rgba(255,255,255,0.10)" },
            "&:focus-visible": { outline: "2px solid rgba(255,255,255,0.55)", outlineOffset: 2 },
          }}
        >
          <CloseIcon fontSize="small" />
        </IconButton>
      </DialogTitle>

      <DialogContent sx={{ px: 2, py: 1.5 }}>
        <Box sx={{ maxHeight: "60vh", overflow: "auto", pr: 0.5 }}>
          {renderRichHelpText(text)}
        </Box>
      </DialogContent>

      <DialogActions
        sx={{
          justifyContent: "center",
          px: 2,
          py: 1.5,
          borderTop: "1px solid",
          borderColor: "divider",
          backgroundColor: "background.paper",
        }}
      >
        <Button
          variant="outlined"
          onClick={onClose}
          sx={{ textTransform: "none", minWidth: 112 }}
        >
          Close
        </Button>
      </DialogActions>
    </Dialog>
  );
}