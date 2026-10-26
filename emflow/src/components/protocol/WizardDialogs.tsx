import {
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  MenuItem,
  TextField,
  Typography,
} from "@mui/material";
import { CloseIcon } from "@/icons";

import type {
  WizardDialogOption,
  WizardInputDialogField,
} from "./wizards/protocol_wizard_types";

type WizardOptionsDialogProps = {
  open: boolean;
  title: string;
  paramName: string;
  options: WizardDialogOption[];
  selectedValue: string;
  message: string;
  onClose: () => void;
  onConfirm: () => void;
  onSelectedValueChange: (value: string) => void;
};

type WizardInputDialogProps = {
  open: boolean;
  title: string;
  fields: WizardInputDialogField[];
  values: Record<string, string>;
  message: string;
  previewImageUrl: string;
  onClose: () => void;
  onConfirm: () => void;
  onValueChange: (fieldName: string, value: string) => void;
};

const wizardDialogPaperSx = {
  borderRadius: "22px",
  overflow: "hidden",
  border: "1px solid rgba(51, 61, 73, 0.14)",
  boxShadow: "0 24px 70px rgba(15, 23, 42, 0.24)",
  backgroundImage: "none",
};

const wizardDialogTitleSx = {
  m: 0,
  px: 2.5,
  py: 2,
  background: "linear-gradient(135deg, #333d49 0%, #3d4957 55%, #465567 100%)",
  color: "#ffffff",
  borderBottom: "1px solid rgba(255,255,255,0.08)",
};

const wizardDialogContentSx = {
  px: 2.5,
  py: 2.5,
  background: "linear-gradient(180deg, #f8fafc 0%, #f4f7fb 100%)",
  borderColor: "rgba(15,23,42,0.08)",
};

const wizardDialogActionsSx = {
  px: 2.5,
  py: 2,
  backgroundColor: "#ffffff",
  borderTop: "1px solid rgba(15,23,42,0.08)",
  justifyContent: "flex-end",
  gap: 1.25,
};

const wizardFieldSx = {
  "& .MuiOutlinedInput-root": {
    borderRadius: "14px",
    backgroundColor: "#ffffff",
    "& .MuiOutlinedInput-notchedOutline": {
      borderColor: "rgba(15,23,42,0.12)",
    },
  },
};

function hasText(value: string | null | undefined): boolean {
  return Boolean(String(value ?? "").trim());
}

function WizardHeader({
  title,
  onClose,
}: {
  title: string;
  onClose: () => void;
}) {
  return (
    <DialogTitle sx={wizardDialogTitleSx}>
      <Box
        sx={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 2,
        }}
      >
        <Typography
          component="span"
          sx={{
            fontSize: "1rem",
            fontWeight: 700,
            color: "inherit",
          }}
        >
          {title}
        </Typography>

        <IconButton
          onClick={onClose}
          size="small"
          sx={{
            color: "#e5e7eb",
            border: "1px solid rgba(255,255,255,0.14)",
            backgroundColor: "rgba(255,255,255,0.06)",
            "&:hover": {
              backgroundColor: "rgba(255,255,255,0.12)",
              borderColor: "rgba(255,255,255,0.22)",
            },
          }}
        >
          <CloseIcon fontSize="small" />
        </IconButton>
      </Box>
    </DialogTitle>
  );
}

export function WizardOptionsDialog({
  open,
  title,
  paramName,
  options,
  selectedValue,
  message,
  onClose,
  onConfirm,
  onSelectedValueChange,
}: WizardOptionsDialogProps) {
  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth="sm"
      fullWidth
      PaperProps={{ sx: wizardDialogPaperSx }}
    >
      <WizardHeader title={title || "Wizard result"} onClose={onClose} />

      <DialogContent dividers sx={wizardDialogContentSx}>
        <Box sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
          {hasText(message) && (
            <Typography
              variant="body2"
              sx={{
                color: "text.secondary",
                lineHeight: 1.6,
              }}
            >
              {message}
            </Typography>
          )}

          <TextField
            select
            fullWidth
            size="small"
            label={title || paramName}
            value={selectedValue}
            onChange={(e) => onSelectedValueChange(String(e.target.value))}
            sx={wizardFieldSx}
          >
            {options.map((option) => (
              <MenuItem key={option.value} value={option.value}>
                {option.label}
              </MenuItem>
            ))}
          </TextField>
        </Box>
      </DialogContent>

      <DialogActions sx={wizardDialogActionsSx}>
        <Button
          onClick={onClose}
          variant="outlined"
          sx={{
            textTransform: "none",
            borderRadius: "12px",
            px: 2,
            fontWeight: 600,
          }}
        >
          Cancel
        </Button>

        <Button
          variant="contained"
          onClick={onConfirm}
          sx={{
            textTransform: "none",
            borderRadius: "12px",
            px: 2.25,
            fontWeight: 700,
          }}
        >
          Apply
        </Button>
      </DialogActions>
    </Dialog>
  );
}

export function WizardInputDialog({
  open,
  title,
  fields,
  values,
  message,
  previewImageUrl,
  onClose,
  onConfirm,
  onValueChange,
}: WizardInputDialogProps) {
  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth="sm"
      fullWidth
      PaperProps={{ sx: wizardDialogPaperSx }}
    >
      <WizardHeader title={title || "Wizard input"} onClose={onClose} />

      <DialogContent dividers sx={wizardDialogContentSx}>
        <Box sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
          {hasText(message) && (
            <Typography
              variant="body2"
              sx={{
                color: "text.secondary",
                lineHeight: 1.6,
              }}
            >
              {message}
            </Typography>
          )}

          {hasText(previewImageUrl) && (
            <Box
              sx={{
                borderRadius: "14px",
                overflow: "hidden",
                border: "1px solid rgba(15,23,42,0.10)",
                backgroundColor: "#ffffff",
                p: 1,
              }}
            >
              <Box
                component="img"
                src={previewImageUrl}
                alt="Wizard preview"
                sx={{
                  display: "block",
                  width: "100%",
                  maxHeight: 320,
                  objectFit: "contain",
                  borderRadius: "10px",
                }}
              />
            </Box>
          )}

          {fields.map((field) => {
            const fieldName = String(field?.name ?? "").trim();
            if (!fieldName) return null;

            const fieldValue = values[fieldName] ?? "";

            if (field.kind === "select") {
              return (
                <TextField
                  key={fieldName}
                  select
                  fullWidth
                  size="small"
                  label={field.label || fieldName}
                  value={fieldValue}
                  onChange={(e) => onValueChange(fieldName, String(e.target.value))}
                  sx={wizardFieldSx}
                >
                  {(field.options ?? []).map((option) => (
                    <MenuItem key={option.value} value={option.value}>
                      {option.label}
                    </MenuItem>
                  ))}
                </TextField>
              );
            }

            return (
              <TextField
                key={fieldName}
                fullWidth
                size="small"
                type={field.kind === "number" ? "number" : "text"}
                label={field.label || fieldName}
                value={fieldValue}
                onChange={(e) => onValueChange(fieldName, e.target.value)}
                inputProps={
                  field.kind === "number"
                    ? {
                        min: field.min,
                        max: field.max,
                        step: field.step ?? 1,
                      }
                    : undefined
                }
                sx={wizardFieldSx}
              />
            );
          })}
        </Box>
      </DialogContent>

      <DialogActions sx={wizardDialogActionsSx}>
        <Button
          onClick={onClose}
          variant="outlined"
          sx={{
            textTransform: "none",
            borderRadius: "12px",
            px: 2,
            fontWeight: 600,
          }}
        >
          Cancel
        </Button>

        <Button
          variant="contained"
          onClick={onConfirm}
          sx={{
            textTransform: "none",
            borderRadius: "12px",
            px: 2.25,
            fontWeight: 700,
          }}
        >
          Apply
        </Button>
      </DialogActions>
    </Dialog>
  );
}