import { Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, Typography } from "@mui/material";

type ValidationErrorsDialogProps = {
  open: boolean;
  onClose: () => void;
  errors: string[];
};

export default function ValidationErrorsDialog({
  open,
  onClose,
  errors,
}: ValidationErrorsDialogProps) {
  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth="sm"
      fullWidth
      PaperProps={{
        sx: {
          borderRadius: 3,
          boxShadow: "0px 10px 25px rgba(0, 0, 0, 0.25)",
        },
      }}
    >
      <DialogTitle
        sx={{
          display: "flex",
          alignItems: "center",
          gap: 1.5,
          fontWeight: "bold",
          color: "#d32f2f",
          fontSize: "1.1rem",
          borderBottom: "1px solid ",
          pb: 1,
        }}
      >
        <Box
          sx={{
            width: 32,
            height: 32,
            borderRadius: "50%",
            backgroundColor: "#f8d7da",
            color: "#d32f2f",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontWeight: "bold",
          }}
        >
          !
        </Box>
        Validation Errors
      </DialogTitle>

      <DialogContent
        dividers
        sx={{
          maxHeight: "300px",
          overflowY: "auto",
          backgroundColor: "#fff8f8",
          borderTop: "1px solid #f0f0f0",
          borderBottom: "1px solid #f0f0f0",
          p: 2.5,
        }}
      >
        {errors.length > 0 ? (
          <Box
            component="ul"
            sx={{
              listStyle: "none",
              pl: 0,
              m: 0,
              color: "#b00020",
              fontSize: "0.9rem",
            }}
          >
            {errors.map((err, i) => {
              const parts = err.split(/(\*\*[^*]+\*\*)/g);
              return (
                <Box
                  key={i}
                  component="li"
                  sx={{
                    display: "flex",
                    alignItems: "flex-start",
                    mb: 1.2,
                  }}
                >
                  <Box
                    component="span"
                    sx={{
                      color: "#d32f2f",
                      fontWeight: "bold",
                      mr: 1.2,
                      fontSize: "1rem",
                      lineHeight: "1rem",
                    }}
                  >
                    •
                  </Box>
                  <Typography
                    variant="body2"
                    sx={{
                      color: "#333",
                      lineHeight: 1.5,
                      fontSize: "0.9rem",
                    }}
                  >
                    {parts.map((p, j) =>
                      p.startsWith("**") && p.endsWith("**") ? (
                        <strong key={j}>{p.slice(2, -2)}</strong>
                      ) : (
                        p
                      )
                    )}
                  </Typography>
                </Box>
              );
            })}
          </Box>
        ) : (
          <Typography variant="body2" sx={{ color: "#555" }}>
            No validation details provided.
          </Typography>
        )}
      </DialogContent>

      <DialogActions
        sx={{
          p: 2,
          justifyContent: "flex-end",
          backgroundColor: "#fafafa",
          borderTop: "1px solid #eee",
        }}
      >
        <Button
          onClick={onClose}
          variant="contained"
          color="error"
          sx={{
            textTransform: "none",
            px: 3,
            borderRadius: 2,
            fontWeight: "bold",
            boxShadow: "none",
            "&:hover": {
              backgroundColor: "#c62828",
            },
          }}
        >
          Close
        </Button>
      </DialogActions>
    </Dialog>
  );
}