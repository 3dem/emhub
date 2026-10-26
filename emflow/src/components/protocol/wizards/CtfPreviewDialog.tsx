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

type CtfPreviewDialogProps = {
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
    autoDownsampling: boolean;
    autoDownsampleValue: number | null;

    lowFreq: number;
    lowFreqMin: number;
    lowFreqMax: number;

    highFreq: number;
    highFreqMin: number;
    highFreqMax: number;

    freqStep: number;
    samplingRate: number | null;
    showInAngstroms: boolean;

    downsampleParamName: string;
    lowFreqParamName: string;
    highFreqParamName: string;

    onClose: () => void;
    onConfirm: () => void;

    onDownsampleChange: (value: number) => void;
    onDownsampleCommit?: (value: number) => void;

    onLowFreqChange: (value: number) => void;
    onLowFreqCommit?: (value: number) => void;

    onHighFreqChange: (value: number) => void;
    onHighFreqCommit?: (value: number) => void;
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

const psdOuterBg = "#a9a9a9";
const psdInnerBg = "#9d9d9d";
const psdGridColor = "rgba(255,255,255,0.22)";
const psdAxisColor = "rgba(40,40,40,0.58)";
const psdTickColor = "rgba(25,25,25,0.72)";
const psdRingColor = "rgb(0, 255, 255)";
const psdRingHaloColor = "rgba(255,255,255,0.34)";

const plotFrame = {
    left: 15,
    top: 5,
    size: 76,
};

function hasText(value: string | null | undefined): boolean {
    return Boolean(String(value ?? "").trim());
}

function clamp(value: number, min: number, max: number): number {
    return Math.min(Math.max(value, min), max);
}

function formatFrequencyValue(
    value: number,
    samplingRate: number | null,
    showInAngstroms: boolean,
): { digitalText: string; angstromText: string } {
    const safeValue = Number.isFinite(value) ? value : 0;
    const digitalText = `${safeValue.toFixed(2)} rad/Å`;

    if (!showInAngstroms || !samplingRate || samplingRate <= 0 || safeValue <= 0) {
        return {
            digitalText,
            angstromText: "—",
        };
    }

    return {
        digitalText,
        angstromText: `${safeValue.toFixed(1)} Å`,
    };
}

function formatAxisTick(value: number): string {
    if (Math.abs(value) < 1e-9) {
        return "0.0";
    }
    return value.toFixed(1);
}

function buildAxisTickValues(axisMax: number): number[] {
    const half = axisMax / 2;
    return [-axisMax, -half, 0, half, axisMax];
}

export default function CtfPreviewDialog({
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
    autoDownsampling,
    autoDownsampleValue,
    lowFreq,
    lowFreqMin,
    lowFreqMax,
    highFreq,
    highFreqMin,
    highFreqMax,
    freqStep,
    samplingRate,
    showInAngstroms,
    downsampleParamName,
    lowFreqParamName,
    highFreqParamName,
    onClose,
    onConfirm,
    onDownsampleChange,
    onDownsampleCommit,
    onLowFreqChange,
    onLowFreqCommit,
    onHighFreqChange,
    onHighFreqCommit,
}: CtfPreviewDialogProps) {
    const [localDownsample, setLocalDownsample] = React.useState(downsample);
    const [localDownsampleText, setLocalDownsampleText] = React.useState(String(downsample));
    const [localLowFreq, setLocalLowFreq] = React.useState(lowFreq);
    const [localHighFreq, setLocalHighFreq] = React.useState(highFreq);

    React.useEffect(() => {
        setLocalDownsample(downsample);
        setLocalDownsampleText(String(downsample));
    }, [downsample]);

    React.useEffect(() => {
        setLocalLowFreq(lowFreq);
    }, [lowFreq]);

    React.useEffect(() => {
        setLocalHighFreq(highFreq);
    }, [highFreq]);

    const commitDownsample = React.useCallback(
        (value: number) => {
            const nextValue = Math.max(downsampleMin, Math.min(value, downsampleMax));
            setLocalDownsample(nextValue);
            setLocalDownsampleText(String(nextValue));
            onDownsampleChange(nextValue);

            if (Math.abs(nextValue - downsample) > 1e-9) {
                onDownsampleCommit?.(nextValue);
            }
        },
        [
            downsample,
            downsampleMin,
            downsampleMax,
            onDownsampleChange,
            onDownsampleCommit,
        ],
    );

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

    const lowFreqLabel = formatFrequencyValue(localLowFreq, samplingRate, showInAngstroms);
    const highFreqLabel = formatFrequencyValue(localHighFreq, samplingRate, showInAngstroms);

    const axisMax = React.useMemo(() => {
        const rawMax = Math.max(localLowFreq, localHighFreq, 0.4);
        return Math.ceil(rawMax / 0.2) * 0.2;
    }, [localLowFreq, localHighFreq]);

    const axisTicks = React.useMemo(() => buildAxisTickValues(axisMax), [axisMax]);

    const plotCenterX = plotFrame.left + plotFrame.size / 2;
    const plotCenterY = plotFrame.top + plotFrame.size / 2;
    const plotHalf = plotFrame.size / 2;

    const lowRingRadius = React.useMemo(() => {
        if (axisMax <= 0) return 0;
        return clamp((localLowFreq / axisMax) * plotHalf, 0, plotHalf);
    }, [localLowFreq, axisMax, plotHalf]);

    const highRingRadius = React.useMemo(() => {
        if (axisMax <= 0) return 0;
        return clamp((localHighFreq / axisMax) * plotHalf, 0, plotHalf);
    }, [localHighFreq, axisMax, plotHalf]);

    const showLoadingOverlay = previewLoading;
    const loadingLabel = "Updating preview...";

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
                    {showLoadingOverlay && (
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
                                    {loadingLabel}
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
                                        sx={{
                                            position: "relative",
                                            width: "100%",
                                            maxWidth: 360,
                                            alignSelf: "center",
                                            aspectRatio: "1 / 1",
                                            backgroundColor: psdOuterBg,
                                            border: "1px solid rgba(70,70,70,0.10)",
                                            boxShadow: "inset 0 1px 0 rgba(255,255,255,0.08)",
                                        }}
                                    >
                                        <Box
                                            component="img"
                                            src={psdPreviewUrl}
                                            alt="PSD preview"
                                            sx={{
                                                position: "absolute",
                                                left: `${plotFrame.left}%`,
                                                top: `${plotFrame.top}%`,
                                                width: `${plotFrame.size}%`,
                                                height: `${plotFrame.size}%`,
                                                objectFit: "fill",
                                                display: "block",
                                                userSelect: "none",
                                                backgroundColor: psdInnerBg,
                                            }}
                                        />

                                        <Box
                                            component="svg"
                                            viewBox="0 0 100 100"
                                            preserveAspectRatio="none"
                                            sx={{
                                                position: "absolute",
                                                inset: 0,
                                                width: "100%",
                                                height: "100%",
                                                pointerEvents: "none",
                                                overflow: "visible",
                                            }}
                                        >
                                            <rect
                                                x={plotFrame.left}
                                                y={plotFrame.top}
                                                width={plotFrame.size}
                                                height={plotFrame.size}
                                                fill="none"
                                                stroke={psdAxisColor}
                                                strokeWidth="0.35"
                                            />

                                            {axisTicks.map((tickValue) => {
                                                const normalized = (tickValue + axisMax) / (2 * axisMax);
                                                const x = plotFrame.left + normalized * plotFrame.size;
                                                const y = plotFrame.top + (1 - normalized) * plotFrame.size;
                                                const isCenter = Math.abs(tickValue) < 1e-9;

                                                return (
                                                    <React.Fragment key={`grid-${tickValue}`}>
                                                        <line
                                                            x1={x}
                                                            y1={plotFrame.top}
                                                            x2={x}
                                                            y2={plotFrame.top + plotFrame.size}
                                                            stroke={psdGridColor}
                                                            strokeWidth={isCenter ? 0.34 : 0.22}
                                                        />
                                                        <line
                                                            x1={plotFrame.left}
                                                            y1={y}
                                                            x2={plotFrame.left + plotFrame.size}
                                                            y2={y}
                                                            stroke={psdGridColor}
                                                            strokeWidth={isCenter ? 0.34 : 0.22}
                                                        />

                                                        <text
                                                            x={plotFrame.left - 1.6}
                                                            y={y + 0.95}
                                                            textAnchor="end"
                                                            fontSize="2.8"
                                                            fill={psdTickColor}
                                                            fontFamily="sans-serif"
                                                        >
                                                            {formatAxisTick(tickValue)}
                                                        </text>

                                                        <text
                                                            x={x}
                                                            y={plotFrame.top + plotFrame.size + 3.4}
                                                            textAnchor="middle"
                                                            fontSize="2.8"
                                                            fill={psdTickColor}
                                                            fontFamily="sans-serif"
                                                        >
                                                            {formatAxisTick(tickValue)}
                                                        </text>
                                                    </React.Fragment>
                                                );
                                            })}

                                            <circle
                                                cx={plotCenterX}
                                                cy={plotCenterY}
                                                r={lowRingRadius}
                                                fill="none"
                                                stroke={psdRingHaloColor}
                                                strokeWidth="1.45"
                                            />
                                            <circle
                                                cx={plotCenterX}
                                                cy={plotCenterY}
                                                r={lowRingRadius}
                                                fill="none"
                                                stroke={psdRingColor}
                                                strokeWidth="0.62"
                                            />

                                            <circle
                                                cx={plotCenterX}
                                                cy={plotCenterY}
                                                r={highRingRadius}
                                                fill="none"
                                                stroke={psdRingHaloColor}
                                                strokeWidth="1.45"
                                            />
                                            <circle
                                                cx={plotCenterX}
                                                cy={plotCenterY}
                                                r={highRingRadius}
                                                fill="none"
                                                stroke={psdRingColor}
                                                strokeWidth="0.62"
                                            />
                                        </Box>
                                    </Box>
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
                                display: "grid",
                                gridTemplateColumns: {
                                    xs: "1fr",
                                    md: "160px minmax(0, 1fr)",
                                },
                                gap: 2,
                                alignItems: "start",
                            }}
                        >
                            <Box>
                                <Typography
                                    variant="body2"
                                    sx={{
                                        mb: 0.8,
                                        fontWeight: 600,
                                    }}
                                >
                                    {downsampleParamName || "Downsample"}
                                </Typography>

                                <TextField
                                    size="small"
                                    fullWidth
                                    value={localDownsampleText}
                                    onChange={(e) => {
                                        setLocalDownsampleText(e.target.value);
                                    }}
                                    onBlur={() => {
                                        const parsed = Number(localDownsampleText);
                                        if (Number.isFinite(parsed)) {
                                            commitDownsample(parsed);
                                        } else {
                                            setLocalDownsampleText(String(localDownsample));
                                        }
                                    }}
                                    onKeyDown={(e) => {
                                        if (e.key === "Enter") {
                                            const parsed = Number(localDownsampleText);
                                            if (Number.isFinite(parsed)) {
                                                commitDownsample(parsed);
                                            } else {
                                                setLocalDownsampleText(String(localDownsample));
                                            }
                                        }
                                    }}
                                />
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
                                <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1 }}>
                                    Frequencies
                                </Typography>

                                <Box sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
                                    <Box
                                        sx={{
                                            display: "grid",
                                            gridTemplateColumns: {
                                                xs: "1fr",
                                                md: "90px minmax(0, 1fr) 180px",
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
                                            onChange={(_, value) => setLocalLowFreq(Number(value))}
                                            onChangeCommitted={(_, value) => commitLowFreq(Number(value))}
                                            valueLabelDisplay="auto"
                                        />

                                        <Typography variant="body2" sx={{ textAlign: { xs: "left", md: "right" } }}>
                                            {lowFreqLabel.digitalText} | {lowFreqLabel.angstromText}
                                        </Typography>
                                    </Box>

                                    <Box
                                        sx={{
                                            display: "grid",
                                            gridTemplateColumns: {
                                                xs: "1fr",
                                                md: "90px minmax(0, 1fr) 180px",
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
                                            onChange={(_, value) => setLocalHighFreq(Number(value))}
                                            onChangeCommitted={(_, value) => commitHighFreq(Number(value))}
                                            valueLabelDisplay="auto"
                                        />

                                        <Typography variant="body2" sx={{ textAlign: { xs: "left", md: "right" } }}>
                                            {highFreqLabel.digitalText} | {highFreqLabel.angstromText}
                                        </Typography>
                                    </Box>

                                    <Box
                                        sx={{
                                            display: "grid",
                                            gridTemplateColumns: {
                                                xs: "1fr",
                                                md: "90px minmax(0, 1fr) 180px",
                                            },
                                            gap: 1.5,
                                            alignItems: "center",
                                        }}
                                    >
                                        <Typography variant="body2">
                                            Auto down
                                        </Typography>

                                        <Slider
                                            min={downsampleMin}
                                            max={downsampleMax}
                                            step={downsampleStep}
                                            value={localDownsample}
                                            onChange={(_, value) => {
                                                const nextValue = Number(value);
                                                setLocalDownsample(nextValue);
                                                setLocalDownsampleText(String(nextValue));
                                            }}
                                            onChangeCommitted={(_, value) => commitDownsample(Number(value))}
                                            valueLabelDisplay="auto"
                                        />

                                        <Typography variant="body2" sx={{ textAlign: { xs: "left", md: "right" } }}>
                                            {autoDownsampling && autoDownsampleValue != null
                                                ? `${autoDownsampleValue.toFixed(3)}`
                                                : "manual"}
                                        </Typography>
                                    </Box>

                                    {samplingRate != null && (
                                        <Typography variant="caption" sx={{ color: "text.secondary" }}>
                                            Sampling rate: {samplingRate} Å/pix
                                        </Typography>
                                    )}
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