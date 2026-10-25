import {
  Box,
  CircularProgress,
  Dialog,
  DialogContent,
  DialogTitle,
  Typography,
} from "@mui/material";

type WizardLoadingDialogProps = {
  open: boolean;
  title?: string;
  message?: string;
};

export default function WizardLoadingDialog({
  open,
  title = "Opening wizard",
  message = "Preparing preview...",
}: WizardLoadingDialogProps) {
  return (
    <Dialog
      open={open}
      maxWidth="xs"
      fullWidth
      PaperProps={{
        sx: {
          borderRadius: "20px",
          overflow: "hidden",
          border: "1px solid rgba(51, 61, 73, 0.14)",
          boxShadow: "0 24px 70px rgba(15, 23, 42, 0.24)",
          backgroundImage: "none",
        },
      }}
    >
      <DialogTitle
        sx={{
          m: 0,
          px: 2.5,
          py: 2,
          background: "linear-gradient(135deg, #333d49 0%, #3d4957 55%, #465567 100%)",
          color: "#ffffff",
          borderBottom: "1px solid rgba(255,255,255,0.08)",
        }}
      >
        {title}
      </DialogTitle>

      <DialogContent
        sx={{
          px: 2.5,
          py: 3,
          display: "flex",
          alignItems: "center",
          gap: 1.5,
          background: "linear-gradient(180deg, #f8fafc 0%, #f4f7fb 100%)",
        }}
      >
        <CircularProgress size={22} />
        <Box>
          <Typography variant="body2" sx={{ fontWeight: 700 }}>
            {message}
          </Typography>
          <Typography variant="caption" sx={{ color: "text.secondary" }}>
            This may take a few seconds the first time.
          </Typography>
        </Box>
      </DialogContent>
    </Dialog>
  );
}