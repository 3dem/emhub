// src/components/tags/TagsDialog.tsx
import React, { useMemo } from "react";
import { Dialog, DialogTitle, DialogContent, DialogActions, Button } from "@mui/material";
import { useTheme as useAppTheme } from "@/context/ThemeContext";
import "./tag-dark-overrides.css";

type TagsDialogProps = {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: React.ReactNode;
};

function getDialogPalette(mode: "light" | "dark") {
  if (mode === "dark") {
    return {
      paperBg: "#0f172a",
      contentBg: "#0f172a",
      actionsBg: "rgba(15,23,42,0.98)",
      text: "#e5e7eb",
      border: "rgba(148,163,184,0.24)",
      divider: "rgba(148,163,184,0.18)",
      backdrop: "rgba(2,6,23,0.42)",
      closeText: "#f8fafc",
      closeBorder: "rgba(148,163,184,0.38)",
      closeBg: "rgba(51,65,85,0.82)",
      closeHoverBg: "rgba(71,85,105,0.92)",
      closeHoverBorder: "rgba(203,213,225,0.48)",
      closeShadow: "0 1px 2px rgba(0,0,0,0.28)",
      shadow: "0 24px 70px rgba(0,0,0,0.62)",
    };
  }

  return {
    paperBg: "#ffffff",
    contentBg: "#ffffff",
    actionsBg: "#f8fafc",
    text: "#111827",
    border: "rgba(203,213,225,0.95)",
    divider: "rgba(226,232,240,0.95)",
    backdrop: "rgba(15,23,42,0.12)",
    closeText: "#334155",
    closeBorder: "rgba(100,116,139,0.42)",
    closeBg: "#ffffff",
    closeHoverBg: "#f1f5f9",
    closeHoverBorder: "rgba(71,85,105,0.45)",
    closeShadow: "none",
    shadow: "0 18px 50px rgba(15,23,42,0.18)",
  };
}

export default function TagsDialog({ open, onClose, title, children }: TagsDialogProps) {
  const { theme } = useAppTheme();
  const palette = useMemo(() => getDialogPalette(theme), [theme]);

  return (
    <Dialog
      sx={{
        "& .MuiDialog-paper": {
          overflow: "visible",
          borderRadius: 4,
          border: "1px solid",
          borderColor: palette.border,
          backgroundImage: "none",
          backgroundColor: palette.paperBg,
          color: palette.text,
          boxShadow: palette.shadow,
        },
        "& .MuiDialogTitle-root": {
          borderTopLeftRadius: 16,
          borderTopRightRadius: 16,
          backgroundColor: "#333d49",
          color: "#ffffff",
          fontWeight: 700,
          fontSize: 16,
          px: 2,
          py: 1.5,
        },
        "& .MuiDialogContent-root": {
          borderBottomLeftRadius: 0,
          borderBottomRightRadius: 0,
          borderColor: palette.divider,
          backgroundColor: palette.contentBg,
          color: palette.text,
        },
        "& .MuiDialogActions-root": {
          borderTop: "1px solid",
          borderColor: palette.divider,
          backgroundColor: palette.actionsBg,
          px: 2,
          py: 1.5,
        },
      }}
      slotProps={{
        backdrop: {
          sx: {
            backgroundColor: palette.backdrop,
            backdropFilter: "blur(2px)",
          },
        },
      }}
      open={open}
      onClose={onClose}
      fullWidth
      maxWidth="md"
      // disableEnforceFocusToAvoidFocusTrapLoop
      disableEnforceFocus
      // disableAutoFocusToAvoidFocusTrapLoop
      disableAutoFocus
      // disableRestoreFocusToAvoidFocusTrapLoop
      disableRestoreFocus
    >
      <DialogTitle>{title ?? "Tags"}</DialogTitle>

      <DialogContent
        className="tags-dialog-content"
        dividers
        sx={{
          // overflowVisibleToAvoidAutocompleteClippingWhenDisablePortalIsUsedSomewhere
          overflow: "visible",
          textTransform: "none",
        }}
      >
        {children}
      </DialogContent>

      <DialogActions>
        <Button
          className="tags-dialog-close-button"
          onClick={onClose}
          variant="outlined"
          disableElevation
          sx={{
            borderRadius: 2,
            textTransform: "none",
            minWidth: 112,
            color: palette.closeText,
            borderColor: palette.closeBorder,
            backgroundColor: palette.closeBg,
            boxShadow: palette.closeShadow,
            fontWeight: 600,
            "&:hover": {
              backgroundColor: palette.closeHoverBg,
              borderColor: palette.closeHoverBorder,
              boxShadow: palette.closeShadow,
            },
          }}
        >
          Close
        </Button>
      </DialogActions>
    </Dialog>
  );
}
