import {
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  Typography,
} from "@mui/material";

type ExecErrorDialogProps = {
  open: boolean;
  onClose: () => void;
  title: string;
  message: string;
};

export default function ExecErrorDialog({
  open,
  onClose,
  title,
  message,
}: ExecErrorDialogProps) {
  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth="md"
      fullWidth
      PaperProps={{
        sx: {
          borderRadius: 2,
          overflow: "hidden",
          boxShadow: "0 22px 70px rgba(15, 23, 42, 0.35)",
          border: "1px solid rgba(15, 23, 42, 0.12)",
        },
      }}
    >
      <DialogTitle
        sx={{
          px: 2.25,
          py: 1.6,
          bgcolor: "#333d49",
          color: "#f8fafc",
          display: "flex",
          alignItems: "center",
          gap: 1.25,
          fontWeight: 700,
          fontSize: "1rem",
        }}
      >
        <Box
          component="span"
          sx={{
            width: 10,
            height: 10,
            borderRadius: "50%",
            bgcolor: "#ef4444",
            boxShadow: "0 0 0 4px rgba(239, 68, 68, 0.18)",
            flex: "0 0 auto",
          }}
        />
        {title || "Execution error"}
      </DialogTitle>

      <DialogContent
        sx={{
          px: 2.5,
          py: 2,
          bgcolor: "#f8fafc",
        }}
      >
        <Typography
          variant="body2"
          sx={{
            mb: 1.5,
            mt:1.5,
            color: "#475569",
            fontWeight: 600,
          }}
        >
          The protocol could not be executed.
        </Typography>

        <Box
          sx={{
            maxHeight: "52vh",
            overflow: "auto",
            bgcolor: "#ffffff",
            border: "1px solid rgba(148, 163, 184, 0.45)",
            borderRadius: 1.5,
            px: 1.75,
            py: 1.5,
          }}
        >
          <Typography
            variant="body2"
            component="div"
            sx={{
              color: "#111827",
              fontSize: "0.9rem",
              lineHeight: 1.65,
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
            }}
          >
            {message || "No error details were provided by the backend."}
          </Typography>
        </Box>
      </DialogContent>

      <Divider />

      <DialogActions
        sx={{
          px: 2.25,
          py: 1.25,
          bgcolor: "#f8fafc",
        }}
      >
        <Button
          onClick={onClose}
          variant="contained"
          sx={{
            textTransform: "none",
            bgcolor: "#333d49",
            "&:hover": {
              bgcolor: "#25303b",
            },
          }}
        >
          Close
        </Button>
      </DialogActions>
    </Dialog>
  );
}