import * as React from "react";
import {
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  List,
  ListItemButton,
  ListItemText,
  Slider,
  Typography,
} from "@mui/material";
import { CloseIcon } from "@/icons";

import type { MaskRadiusDialogItem } from "./protocol_wizard_types";

type MaskRadiiDialogProps = {
  open: boolean;
  title: string;
  innerRadius: number;
  outerRadius: number;
  innerMin: number;
  outerMin: number;
  max: number;
  step: number;
  innerRadiusAngstrom: number | null;
  outerRadiusAngstrom: number | null;
  samplingRate: number | null;
  selectedIndex: number;
  items: MaskRadiusDialogItem[];
  message: string;
  previewUrl: string | null;
  previewCaption: string;
  previewSourceWidth: number | null;
  previewSourceHeight: number | null;
  primaryParamName: string;
  secondaryParamName: string;
  onClose: () => void;
  onConfirm: () => void;
  onInnerRadiusChange: (value: number) => void;
  onInnerRadiusCommit?: (value: number) => void;
  onOuterRadiusChange: (value: number) => void;
  onOuterRadiusCommit?: (value: number) => void;
  onSelectedIndexChange: (value: number) => void;
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

function hasText(value: string | null | undefined): boolean {
  return Boolean(String(value ?? "").trim());
}

export default function MaskRadiiDialog({
  open,
  title,
  innerRadius,
  outerRadius,
  innerMin,
  outerMin,
  max,
  step,
  innerRadiusAngstrom,
  outerRadiusAngstrom,
  samplingRate,
  selectedIndex,
  items,
  message,
  previewUrl,
  previewCaption,
  previewSourceWidth,
  previewSourceHeight,
  primaryParamName,
  secondaryParamName,
  onClose,
  onConfirm,
  onInnerRadiusChange,
  onInnerRadiusCommit,
  onOuterRadiusChange,
  onOuterRadiusCommit,
  onSelectedIndexChange,
}: MaskRadiiDialogProps) {
  const previewRef = React.useRef<HTMLDivElement | null>(null);
  const imageRef = React.useRef<HTMLImageElement | null>(null);

  const [renderSize, setRenderSize] = React.useState({ width: 0, height: 0 });

  const updateRenderSize = React.useCallback(() => {
    const node = imageRef.current;
    if (!node) return;

    const rect = node.getBoundingClientRect();
    setRenderSize({
      width: rect.width,
      height: rect.height,
    });
  }, []);

  React.useLayoutEffect(() => {
    updateRenderSize();

    const node = imageRef.current;
    if (!node || typeof ResizeObserver === "undefined") return;

    const observer = new ResizeObserver(() => updateRenderSize());
    observer.observe(node);

    return () => observer.disconnect();
  }, [previewUrl, updateRenderSize]);

  React.useEffect(() => {
    const node = previewRef.current;
    if (!node) return;

    const handleWheel = (event: WheelEvent) => {
      event.preventDefault();

      const delta = event.deltaY < 0 ? step : -step;
      const nextOuter = Math.max(
        Math.max(outerMin, innerRadius),
        Math.min(max, outerRadius + delta),
      );

      if (nextOuter !== outerRadius) {
        onOuterRadiusChange(nextOuter);
        onOuterRadiusCommit?.(nextOuter);
      }
    };

    node.addEventListener("wheel", handleWheel, { passive: false });

    return () => {
      node.removeEventListener("wheel", handleWheel);
    };
  }, [
    innerRadius,
    outerRadius,
    outerMin,
    max,
    step,
    onOuterRadiusChange,
    onOuterRadiusCommit,
  ]);

  const overlayScale =
    previewSourceWidth &&
    previewSourceHeight &&
    renderSize.width > 0 &&
    renderSize.height > 0
      ? Math.min(
          renderSize.width / previewSourceWidth,
          renderSize.height / previewSourceHeight,
        )
      : 1;

  const innerOverlayRadius = Math.max(
    1,
    Math.min(
      innerRadius * overlayScale,
      Math.min(renderSize.width, renderSize.height) / 2,
    ),
  );

  const outerOverlayRadius = Math.max(
    innerOverlayRadius,
    Math.min(
      outerRadius * overlayScale,
      Math.min(renderSize.width, renderSize.height) / 2,
    ),
  );

  const overlayCx = renderSize.width / 2;
  const overlayCy = renderSize.height / 2;

  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth="lg"
      fullWidth
      PaperProps={{
        sx: {
          ...wizardDialogPaperSx,
          maxHeight: "90vh",
        },
      }}
    >
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
            {title || "Wizard"}
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

      <DialogContent
        dividers
        sx={{
          ...wizardDialogContentSx,
          display: "flex",
          flexDirection: "column",
          gap: 2,
        }}
      >
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

        <Box
          sx={{
            display: "grid",
            gridTemplateColumns: {
              xs: "1fr",
              md: "220px minmax(0, 1fr)",
            },
            gap: 2,
            minHeight: 0,
          }}
        >
          <Box
            sx={{
              borderRadius: "16px",
              border: "1px solid rgba(15,23,42,0.10)",
              backgroundColor: "#ffffff",
              overflow: "hidden",
              minHeight: 0,
            }}
          >
            <Box
              sx={{
                px: 1.5,
                py: 1,
                borderBottom: "1px solid rgba(15,23,42,0.08)",
                backgroundColor: "rgba(248,250,252,0.9)",
              }}
            >
              <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
                Particles
              </Typography>
            </Box>

            <List
              dense
              sx={{
                maxHeight: 420,
                overflowY: "auto",
                py: 0.5,
              }}
            >
              {items.map((item) => (
                <ListItemButton
                  key={item.id}
                  selected={item.index === selectedIndex}
                  onClick={() => onSelectedIndexChange(item.index)}
                  sx={{
                    mx: 0.75,
                    my: 0.25,
                    borderRadius: "10px",
                  }}
                >
                  <ListItemText
                    primary={item.label}
                    primaryTypographyProps={{
                      fontSize: "0.82rem",
                      fontWeight: item.index === selectedIndex ? 700 : 500,
                    }}
                  />
                </ListItemButton>
              ))}
            </List>
          </Box>

          <Box
            sx={{
              display: "flex",
              flexDirection: "column",
              gap: 1.5,
              minWidth: 0,
            }}
          >
            <Box
              ref={previewRef}
              sx={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                minHeight: 420,
                borderRadius: "16px",
                border: "1px solid rgba(15,23,42,0.10)",
                backgroundColor: "#d7d7d7",
                overflow: "hidden",
                p: 1.5,
              }}
            >
              {previewUrl ? (
                <Box
                  sx={{
                    position: "relative",
                    display: "inline-block",
                    lineHeight: 0,
                    maxWidth: "100%",
                  }}
                >
                  <Box
                    component="img"
                    ref={imageRef}
                    src={previewUrl}
                    alt="Mask radii preview"
                    onLoad={updateRenderSize}
                    sx={{
                      display: "block",
                      maxWidth: "100%",
                      maxHeight: 420,
                      objectFit: "contain",
                      userSelect: "none",
                    }}
                  />

                  {renderSize.width > 0 && renderSize.height > 0 && (
                    <Box
                      component="svg"
                      viewBox={`0 0 ${renderSize.width} ${renderSize.height}`}
                      sx={{
                        position: "absolute",
                        inset: 0,
                        width: "100%",
                        height: "100%",
                        pointerEvents: "none",
                        overflow: "visible",
                      }}
                    >
                      <circle
                        cx={overlayCx}
                        cy={overlayCy}
                        r={outerOverlayRadius}
                        fill="rgba(255, 90, 90, 0.12)"
                        stroke="rgb(255, 90, 90)"
                        strokeWidth="2.5"
                      />
                      <circle
                        cx={overlayCx}
                        cy={overlayCy}
                        r={innerOverlayRadius}
                        fill="rgba(59, 130, 246, 0.10)"
                        stroke="rgb(59, 130, 246)"
                        strokeWidth="2.5"
                      />
                      <circle
                        cx={overlayCx}
                        cy={overlayCy}
                        r={2.5}
                        fill="white"
                      />
                    </Box>
                  )}
                </Box>
              ) : (
                <Typography variant="body2" sx={{ color: "text.secondary" }}>
                  Preview not available yet.
                </Typography>
              )}
            </Box>

            <Box
              sx={{
                px: 1,
                py: 0.5,
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                gap: 2,
                flexWrap: "wrap",
              }}
            >
              <Typography variant="caption" sx={{ color: "text.secondary" }}>
                {previewCaption || "Central slice"}
              </Typography>

              <Typography variant="caption" sx={{ color: "text.secondary" }}>
                {samplingRate && samplingRate > 0
                  ? `Sampling rate: ${samplingRate} Å/pix`
                  : "Sampling rate not available"}
              </Typography>
            </Box>

            <Box
              sx={{
                px: 1,
                pt: 0.5,
                display: "grid",
                gridTemplateColumns: {
                  xs: "1fr",
                  md: "minmax(0, 1fr) auto",
                },
                gap: 2,
                alignItems: "center",
              }}
            >
              <Box sx={{ px: 1 }}>
                <Typography variant="caption" sx={{ color: "text.secondary" }}>
                  {primaryParamName}
                </Typography>
                <Slider
                  min={innerMin}
                  max={Math.max(innerMin, outerRadius)}
                  step={step}
                  value={innerRadius}
                  onChange={(_, value) => onInnerRadiusChange(Number(value))}
                  onChangeCommitted={(_, value) =>
                    onInnerRadiusCommit?.(Number(value))
                  }
                  valueLabelDisplay="auto"
                />
              </Box>

              <Box
                sx={{
                  minWidth: 140,
                  display: "flex",
                  flexDirection: "column",
                  alignItems: { xs: "flex-start", md: "flex-end" },
                }}
              >
                <Typography variant="body2" sx={{ fontWeight: 700 }}>
                  {innerRadius} pix
                </Typography>
                <Typography variant="caption" sx={{ color: "text.secondary" }}>
                  {innerRadiusAngstrom != null ? `${innerRadiusAngstrom} Å` : "—"}
                </Typography>
              </Box>
            </Box>

            <Box
              sx={{
                px: 1,
                pb: 0.5,
                display: "grid",
                gridTemplateColumns: {
                  xs: "1fr",
                  md: "minmax(0, 1fr) auto",
                },
                gap: 2,
                alignItems: "center",
              }}
            >
              <Box sx={{ px: 1 }}>
                <Typography variant="caption" sx={{ color: "text.secondary" }}>
                  {secondaryParamName}
                </Typography>
                <Slider
                  min={Math.max(outerMin, innerRadius)}
                  max={max}
                  step={step}
                  value={outerRadius}
                  onChange={(_, value) => onOuterRadiusChange(Number(value))}
                  onChangeCommitted={(_, value) =>
                    onOuterRadiusCommit?.(Number(value))
                  }
                  valueLabelDisplay="auto"
                />
              </Box>

              <Box
                sx={{
                  minWidth: 140,
                  display: "flex",
                  flexDirection: "column",
                  alignItems: { xs: "flex-start", md: "flex-end" },
                }}
              >
                <Typography variant="body2" sx={{ fontWeight: 700 }}>
                  {outerRadius} pix
                </Typography>
                <Typography variant="caption" sx={{ color: "text.secondary" }}>
                  {outerRadiusAngstrom != null ? `${outerRadiusAngstrom} Å` : "—"}
                </Typography>
              </Box>
            </Box>
          </Box>
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
          Select
        </Button>
      </DialogActions>
    </Dialog>
  );
}