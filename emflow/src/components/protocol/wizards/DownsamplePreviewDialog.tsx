import * as React from "react";
import {
    Box,
    Button,
    CircularProgress,
    Dialog,
    DialogActions,
    DialogContent,
    DialogTitle,
    IconButton,
    List,
    ListItemButton,
    ListItemText,
    Slider,
    TextField,
    Typography,
} from "@mui/material";
import { CloseIcon } from "@/icons";

import type { MaskRadiusDialogItem } from "./protocol_wizard_types";

type DownsamplePreviewDialogProps = {
    open: boolean;
    title: string;
    message: string;

    items: MaskRadiusDialogItem[];
    selectedIndex: number;
    onSelectedIndexChange: (value: number) => void;

    micrographPreviewUrl: string | null;
    psdPreviewUrl: string | null;
    previewLoading: boolean;

    downsample: number;
    downsampleMin: number;
    downsampleMax: number;
    downsampleStep: number;
    downsampleParamName: string;

    onClose: () => void;
    onConfirm: () => void;

    onDownsampleChange: (value: number) => void;
    onDownsampleCommit?: (value: number) => void;
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

function formatNumber(value: number): string {
    if (!Number.isFinite(value)) return "0";
    if (Math.abs(value) >= 100) return value.toFixed(0);
    if (Math.abs(value) >= 10) return value.toFixed(1);
    return value.toFixed(2);
}

export default function DownsamplePreviewDialog({
    open,
    title,
    message,
    items,
    selectedIndex,
    onSelectedIndexChange,
    micrographPreviewUrl,
    psdPreviewUrl,
    previewLoading,
    downsample,
    downsampleMin,
    downsampleMax,
    downsampleStep,
    downsampleParamName,
    onClose,
    onConfirm,
    onDownsampleChange,
    onDownsampleCommit,
}: DownsamplePreviewDialogProps) {
    const [localDownsample, setLocalDownsample] = React.useState(downsample);
    const [localDownsampleText, setLocalDownsampleText] = React.useState(String(downsample));
    const [pendingPreview, setPendingPreview] = React.useState(false);

    React.useEffect(() => {
        setLocalDownsample(downsample);
        setLocalDownsampleText(String(downsample));
    }, [downsample]);

    React.useEffect(() => {
        setPendingPreview(false);
    }, [
        micrographPreviewUrl,
        psdPreviewUrl,
        downsample,
    ]);

    React.useEffect(() => {
        if (!open) {
            setPendingPreview(false);
        }
    }, [open]);

    const commitDownsample = React.useCallback(
        (value: number) => {
            const nextValue = Math.max(downsampleMin, Math.min(value, downsampleMax));
            setLocalDownsample(nextValue);
            setLocalDownsampleText(String(nextValue));
            onDownsampleChange(nextValue);
            onDownsampleCommit?.(nextValue);
        },
        [downsampleMin, downsampleMax, onDownsampleChange, onDownsampleCommit],
    );

    const debounceRef = React.useRef<number | null>(null);
    const pendingTimeoutRef = React.useRef<number | null>(null);

    const clearPendingTimeout = React.useCallback(() => {
        if (pendingTimeoutRef.current != null) {
            window.clearTimeout(pendingTimeoutRef.current);
            pendingTimeoutRef.current = null;
        }
    }, []);

    const armPendingTimeout = React.useCallback(() => {
        clearPendingTimeout();
        pendingTimeoutRef.current = window.setTimeout(() => {
            setPendingPreview(false);
            pendingTimeoutRef.current = null;
        }, 5000);
    }, [clearPendingTimeout]);

    const scheduleCommit = React.useCallback((fn: () => void) => {
        if (debounceRef.current != null) {
            window.clearTimeout(debounceRef.current);
        }

        debounceRef.current = window.setTimeout(() => {
            fn();
            debounceRef.current = null;
        }, 120);
    }, []);

    React.useEffect(() => {
        if (previewLoading) {
            armPendingTimeout();
        } else if (!pendingPreview) {
            clearPendingTimeout();
        }

        return () => {
            clearPendingTimeout();
        };
    }, [previewLoading, pendingPreview, armPendingTimeout, clearPendingTimeout]);

    React.useEffect(() => {
        return () => {
            if (debounceRef.current != null) {
                window.clearTimeout(debounceRef.current);
            }
            clearPendingTimeout();
        };
    }, [clearPendingTimeout]);

    const showLoading = pendingPreview || previewLoading;

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
                        position: "relative",
                        display: "grid",
                        gridTemplateColumns: {
                            xs: "1fr",
                            md: "170px minmax(0, 1fr)",
                        },
                        gap: 2,
                        minHeight: 0,
                    }}
                >
                    {showLoading && (
                        <Box
                            sx={{
                                position: "absolute",
                                inset: 0,
                                zIndex: 5,
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "center",
                                borderRadius: "18px",
                                backgroundColor: "rgba(248, 250, 252, 0.72)",
                                backdropFilter: "blur(2px)",
                            }}
                        >
                            <Box
                                sx={{
                                    px: 2.5,
                                    py: 1.75,
                                    borderRadius: "16px",
                                    backgroundColor: "rgba(255,255,255,0.94)",
                                    border: "1px solid rgba(15,23,42,0.08)",
                                    boxShadow: "0 10px 30px rgba(15,23,42,0.10)",
                                    display: "flex",
                                    alignItems: "center",
                                    gap: 1.25,
                                }}
                            >
                                <CircularProgress size={20} />
                                <Typography variant="body2" sx={{ fontWeight: 600 }}>
                                    Loading preview...
                                </Typography>
                            </Box>
                        </Box>
                    )}

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
                                Object
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
                                    onClick={() => {
                                        if (item.index === selectedIndex) return;
                                        setPendingPreview(true);
                                        armPendingTimeout();
                                        onSelectedIndexChange(item.index);
                                    }}
                                    sx={{
                                        mx: 0.75,
                                        my: 0.25,
                                        borderRadius: "10px",
                                        "&.Mui-selected": {
                                            backgroundColor: "rgba(51, 61, 73, 0.10)",
                                        },
                                        "&.Mui-selected:hover": {
                                            backgroundColor: "rgba(51, 61, 73, 0.16)",
                                        },
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
                            sx={{
                                display: "grid",
                                gridTemplateColumns: {
                                    xs: "1fr",
                                    md: "1fr 1fr",
                                },
                                gap: 2,
                                alignItems: "stretch",
                            }}
                        >
                            <Box
                                sx={{
                                    borderRadius: "16px",
                                    border: "1px solid rgba(15,23,42,0.10)",
                                    backgroundColor: "#d7d7d7",
                                    overflow: "hidden",
                                    p: 1,
                                    minHeight: 320,
                                    display: "flex",
                                    flexDirection: "column",
                                    justifyContent: "center",
                                }}
                            >
                                {micrographPreviewUrl ? (
                                    <Box
                                        component="img"
                                        key={micrographPreviewUrl ?? "micrograph-preview"}
                                        src={micrographPreviewUrl}
                                        alt="Micrograph preview"
                                        sx={{
                                            display: "block",
                                            width: "100%",
                                            maxHeight: 320,
                                            objectFit: "contain",
                                            userSelect: "none",
                                        }}
                                    />
                                ) : (
                                    <Typography variant="body2" sx={{ color: "text.secondary", textAlign: "center" }}>
                                        Micrograph preview not available.
                                    </Typography>
                                )}

                                <Typography
                                    variant="body2"
                                    sx={{
                                        textAlign: "center",
                                        mt: 1,
                                        fontWeight: 600,
                                    }}
                                >
                                    Micrograph
                                </Typography>
                            </Box>

                            <Box
                                sx={{
                                    borderRadius: "16px",
                                    border: "1px solid rgba(15,23,42,0.10)",
                                    backgroundColor: "#d7d7d7",
                                    overflow: "hidden",
                                    p: 1,
                                    minHeight: 320,
                                    display: "flex",
                                    flexDirection: "column",
                                    justifyContent: "center",
                                }}
                            >
                                {psdPreviewUrl ? (
                                    <Box
                                        component="img"
                                        key={psdPreviewUrl ?? "psd-preview"}
                                        src={psdPreviewUrl}
                                        alt="PSD preview"
                                        sx={{
                                            display: "block",
                                            width: "100%",
                                            maxHeight: 320,
                                            objectFit: "contain",
                                            userSelect: "none",
                                        }}
                                    />
                                ) : (
                                    <Typography variant="body2" sx={{ color: "text.secondary", textAlign: "center" }}>
                                        PSD preview not available.
                                    </Typography>
                                )}

                                <Typography
                                    variant="body2"
                                    sx={{
                                        textAlign: "center",
                                        mt: 1,
                                        fontWeight: 600,
                                    }}
                                >
                                    PSD
                                </Typography>
                            </Box>
                        </Box>

                        <Box
                            sx={{
                                borderRadius: "16px",
                                border: "1px solid rgba(15,23,42,0.10)",
                                backgroundColor: "#ffffff",
                                px: 2,
                                py: 1.5,
                            }}
                        >
                            <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1.25 }}>
                                Downsampling
                            </Typography>

                            <Box
                                sx={{
                                    display: "grid",
                                    gridTemplateColumns: {
                                        xs: "1fr",
                                        md: "160px minmax(0, 1fr) 140px",
                                    },
                                    gap: 1.5,
                                    alignItems: "center",
                                }}
                            >
                                <TextField
                                    size="small"
                                    label={downsampleParamName || "Downsample"}
                                    value={localDownsampleText}
                                    onChange={(e) => {
                                        setLocalDownsampleText(e.target.value);
                                    }}
                                    onBlur={() => {
                                        const parsed = Number(localDownsampleText);
                                        if (Number.isFinite(parsed)) {
                                            setPendingPreview(true);
                                            armPendingTimeout();
                                            commitDownsample(parsed);
                                        } else {
                                            setLocalDownsampleText(String(localDownsample));
                                        }
                                    }}
                                    onKeyDown={(e) => {
                                        if (e.key === "Enter") {
                                            const parsed = Number(localDownsampleText);
                                            if (Number.isFinite(parsed)) {
                                                setPendingPreview(true);
                                                armPendingTimeout();
                                                commitDownsample(parsed);
                                            } else {
                                                setLocalDownsampleText(String(localDownsample));
                                            }
                                        }
                                    }}
                                />

                                <Slider
                                    min={downsampleMin}
                                    max={downsampleMax}
                                    step={downsampleStep}
                                    value={localDownsample}
                                    onChange={(_, value) => {
                                        const nextValue = Number(value);
                                        setPendingPreview(true);
                                        armPendingTimeout();
                                        setLocalDownsample(nextValue);
                                        setLocalDownsampleText(String(nextValue));
                                        scheduleCommit(() => commitDownsample(nextValue));
                                    }}
                                    valueLabelDisplay="auto"
                                />

                                <Typography variant="body2" sx={{ textAlign: { xs: "left", md: "right" } }}>
                                    {formatNumber(localDownsample)}
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