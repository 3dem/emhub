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
    Typography,
} from "@mui/material";
import { CloseIcon } from "@/icons";

import type { MaskRadiusDialogItem } from "./protocol_wizard_types";

type FilterPreviewDialogProps = {
    open: boolean;
    title: string;
    message: string;

    items: MaskRadiusDialogItem[];
    selectedIndex: number;
    onSelectedIndexChange: (value: number) => void;

    originalPreviewUrl: string | null;
    filteredPreviewUrl: string | null;
    previewLoading: boolean;

    lowFreq: number;
    lowFreqMin: number;
    lowFreqMax: number;

    highFreq: number;
    highFreqMin: number;
    highFreqMax: number;

    decay: number;
    decayMin: number;
    decayMax: number;

    freqStep: number;
    unitLabel: string;
    filterMode: string;

    lowFreqParamName: string;
    highFreqParamName: string;
    decayParamName: string;

    onClose: () => void;
    onConfirm: () => void;

    onLowFreqChange: (value: number) => void;
    onLowFreqCommit?: (value: number) => void;

    onHighFreqChange: (value: number) => void;
    onHighFreqCommit?: (value: number) => void;

    onDecayChange: (value: number) => void;
    onDecayCommit?: (value: number) => void;
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

export default function FilterPreviewDialog({
    open,
    title,
    message,
    items,
    selectedIndex,
    onSelectedIndexChange,
    originalPreviewUrl,
    filteredPreviewUrl,
    previewLoading,
    lowFreq,
    lowFreqMin,
    lowFreqMax,
    highFreq,
    highFreqMin,
    highFreqMax,
    decay,
    decayMin,
    decayMax,
    freqStep,
    unitLabel,
    filterMode,
    lowFreqParamName,
    highFreqParamName,
    decayParamName,
    onClose,
    onConfirm,
    onLowFreqChange,
    onLowFreqCommit,
    onHighFreqChange,
    onHighFreqCommit,
    onDecayChange,
    onDecayCommit,
}: FilterPreviewDialogProps) {
    const [localLowFreq, setLocalLowFreq] = React.useState(lowFreq);
    const [localHighFreq, setLocalHighFreq] = React.useState(highFreq);
    const [localDecay, setLocalDecay] = React.useState(decay);
    const [pendingPreview, setPendingPreview] = React.useState(false);

    React.useEffect(() => {
        setLocalLowFreq(lowFreq);
    }, [lowFreq]);

    React.useEffect(() => {
        setLocalHighFreq(highFreq);
    }, [highFreq]);

    React.useEffect(() => {
        setLocalDecay(decay);
    }, [decay]);

    React.useEffect(() => {
        setPendingPreview(false);
    }, [
        originalPreviewUrl,
        filteredPreviewUrl,
        lowFreq,
        highFreq,
        decay,
    ]);

    React.useEffect(() => {
        if (!open) {
            setPendingPreview(false);
        }
    }, [open]);

    const commitLowFreq = React.useCallback(
        (value: number) => {
            const nextValue = Math.max(lowFreqMin, Math.min(value, lowFreqMax));
            setLocalLowFreq(nextValue);
            onLowFreqChange(nextValue);
            onLowFreqCommit?.(nextValue);
        },
        [lowFreqMin, lowFreqMax, onLowFreqChange, onLowFreqCommit],
    );

    const commitHighFreq = React.useCallback(
        (value: number) => {
            const nextValue = Math.max(highFreqMin, Math.min(value, highFreqMax));
            setLocalHighFreq(nextValue);
            onHighFreqChange(nextValue);
            onHighFreqCommit?.(nextValue);
        },
        [highFreqMin, highFreqMax, onHighFreqChange, onHighFreqCommit],
    );

    const commitDecay = React.useCallback(
        (value: number) => {
            const nextValue = Math.max(decayMin, Math.min(value, decayMax));
            setLocalDecay(nextValue);
            onDecayChange(nextValue);
            onDecayCommit?.(nextValue);
        },
        [decayMin, decayMax, onDecayChange, onDecayCommit],
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
                                {originalPreviewUrl ? (
                                    <Box
                                        component="img"
                                        key={originalPreviewUrl ?? "original-preview"}
                                        src={originalPreviewUrl}
                                        alt="Original preview"
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
                                        Original preview not available.
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
                                    Image
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
                                {filteredPreviewUrl ? (
                                    <Box
                                        component="img"
                                        key={filteredPreviewUrl ?? "filtered-preview"}
                                        src={filteredPreviewUrl}
                                        alt="Filtered preview"
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
                                        Filtered preview not available.
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
                                    Filtered
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
                            <Box
                                sx={{
                                    display: "flex",
                                    alignItems: "baseline",
                                    justifyContent: "space-between",
                                    gap: 2,
                                    mb: 1.25,
                                    flexWrap: "wrap",
                                }}
                            >
                                <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
                                    Frequencies {unitLabel ? `(${unitLabel})` : ""}
                                </Typography>

                                {hasText(filterMode) && (
                                    <Typography variant="caption" sx={{ color: "text.secondary" }}>
                                        Mode: {filterMode}
                                    </Typography>
                                )}
                            </Box>

                            <Box sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
                                <Box
                                    sx={{
                                        display: "grid",
                                        gridTemplateColumns: {
                                            xs: "1fr",
                                            md: "100px minmax(0, 1fr) 140px",
                                        },
                                        gap: 1.5,
                                        alignItems: "center",
                                    }}
                                >
                                    <Typography variant="body2">
                                        {lowFreqParamName || "Low freq"}
                                    </Typography>

                                    <Slider
                                        min={lowFreqMin}
                                        max={lowFreqMax}
                                        step={freqStep}
                                        value={localLowFreq}
                                        onChange={(_, value) => {
                                            const nextValue = Number(value);
                                            setPendingPreview(true);
                                            armPendingTimeout();
                                            setLocalLowFreq(nextValue);
                                            scheduleCommit(() => commitLowFreq(nextValue));
                                        }}
                                        valueLabelDisplay="auto"
                                    />

                                    <Typography variant="body2" sx={{ textAlign: { xs: "left", md: "right" } }}>
                                        {formatNumber(localLowFreq)}
                                    </Typography>
                                </Box>

                                <Box
                                    sx={{
                                        display: "grid",
                                        gridTemplateColumns: {
                                            xs: "1fr",
                                            md: "100px minmax(0, 1fr) 140px",
                                        },
                                        gap: 1.5,
                                        alignItems: "center",
                                    }}
                                >
                                    <Typography variant="body2">
                                        {highFreqParamName || "High freq"}
                                    </Typography>

                                    <Slider
                                        min={highFreqMin}
                                        max={highFreqMax}
                                        step={freqStep}
                                        value={localHighFreq}
                                        onChange={(_, value) => {
                                            const nextValue = Number(value);
                                            setPendingPreview(true);
                                            armPendingTimeout();
                                            setLocalHighFreq(nextValue);
                                            scheduleCommit(() => commitHighFreq(nextValue));
                                        }}
                                        valueLabelDisplay="auto"
                                    />

                                    <Typography variant="body2" sx={{ textAlign: { xs: "left", md: "right" } }}>
                                        {formatNumber(localHighFreq)}
                                    </Typography>
                                </Box>

                                <Box
                                    sx={{
                                        display: "grid",
                                        gridTemplateColumns: {
                                            xs: "1fr",
                                            md: "100px minmax(0, 1fr) 140px",
                                        },
                                        gap: 1.5,
                                        alignItems: "center",
                                    }}
                                >
                                    <Typography variant="body2">
                                        {decayParamName || "Decay"}
                                    </Typography>

                                    <Slider
                                        min={decayMin}
                                        max={decayMax}
                                        step={freqStep}
                                        value={localDecay}
                                        onChange={(_, value) => {
                                            const nextValue = Number(value);
                                            setPendingPreview(true);
                                            armPendingTimeout();
                                            setLocalDecay(nextValue);
                                            scheduleCommit(() => commitDecay(nextValue));
                                        }}
                                        valueLabelDisplay="auto"
                                    />

                                    <Typography variant="body2" sx={{ textAlign: { xs: "left", md: "right" } }}>
                                        {formatNumber(localDecay)}
                                    </Typography>
                                </Box>
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