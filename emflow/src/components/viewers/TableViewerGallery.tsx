// src/components/viewers/TableViewerGallery.tsx
//
// The gallery view of a table viewer (TableViewerData.gallery), e.g. the 3D
// classes of a Relion iteration: a card per row with a section of a small
// grid of its volume, drawn here from the density the host sends per row,
// its selection checkbox (the table's selection column) and a button for
// its default action (the 3D volume in the viewer pane). The view settings
// (axis, slice, card size) apply to every card; a card's own slider moves
// only that card until the shared slice or axis changes.
import { useEffect, useRef, useState, type MouseEvent } from "react";
import {
    Box,
    Checkbox,
    CircularProgress,
    IconButton,
    Slider,
    ToggleButton,
    ToggleButtonGroup,
    Tooltip,
    Typography,
} from "@mui/material";
import { Box as CubeIcon } from "lucide-react";

import type {
    TableViewerCell,
    TableViewerGallery as GallerySpec,
    TableViewerRow,
} from "@/services/ProjectService";
import type { Axis, VolumeDensity } from "./volume/volumeMath";
import {
    densitySlice,
    prepareDensity,
} from "./volume/densityGrid";

export type GalleryViewState = {
    /** The gallery is shown instead of the table. */
    show: boolean;
    axis: Axis;
    /** Card width (px). */
    size: number;
    /** Shared slice, as a fraction of the axis (0.5: the central one). */
    slice: number;
};

const GALLERY_SIZES = [140, 190, 260];

export function initialGalleryState(spec?: GallerySpec): GalleryViewState {
    return {
        show: Boolean(spec?.default),
        axis: "z",
        size: GALLERY_SIZES[1],
        slice: 0.5,
    };
}

/** "{cellId}" of a gallery title or footer, replaced by the row's cells. */
function fillGalleryTemplate(
    template: string,
    cells: Record<string, TableViewerCell>,
): string {
    return template.replace(/\{(\w+)\}/g, (_, id: string) => {
        const v = cells[id];
        if (v === null || v === undefined || v === "") return "–";
        return typeof v === "number" ? v.toLocaleString() : String(v);
    });
}

type DensityResult = { density?: VolumeDensity; error?: string };

type TableViewerGalleryProps = {
    gallery: GallerySpec;
    rows: TableViewerRow[];
    state: GalleryViewState;
    onStateChange: (state: GalleryViewState) => void;
    /** The density of a row's card (the host's gallery action), cached. */
    loadDensity: (row: TableViewerRow) => Promise<VolumeDensity>;
    selectedRowId: string | number | null;
    /** The row's default action (as a row click). */
    onOpen: (row: TableViewerRow) => void;
    /** The selection column (first boolean edit column), if any. */
    selection: {
        isChecked: (row: TableViewerRow) => boolean;
        onToggle: (event: MouseEvent<HTMLButtonElement>, row: TableViewerRow) => void;
    } | null;
    onContextMenu: (event: MouseEvent<HTMLElement>, row: TableViewerRow) => void;
};

const toggleSx = {
    "& .MuiToggleButton-root": {
        height: 26,
        px: 1,
        fontSize: "0.7rem",
        textTransform: "none",
        color: "var(--emf-slate-600)",
        borderColor: "var(--emf-border-soft)",
        "&.Mui-selected": {
            color: "var(--emf-teal-800)",
            backgroundColor: "var(--emf-teal-110)",
        },
    },
};

export default function TableViewerGallery({
    gallery,
    rows,
    state,
    onStateChange,
    loadDensity,
    selectedRowId,
    onOpen,
    selection,
    onContextMenu,
}: TableViewerGalleryProps) {
    const set = (patch: Partial<GalleryViewState>) => onStateChange({ ...state, ...patch });

    return (
        <Box sx={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
            {/* View settings of every card */}
            <Box
                sx={{
                    px: 2,
                    py: 0.75,
                    display: "flex",
                    alignItems: "center",
                    gap: 1.5,
                    flexWrap: "wrap",
                    borderBottom: "1px solid var(--emf-gray-200)",
                    backgroundColor: "var(--emf-white)",
                }}
            >
                <ToggleButtonGroup
                    size="small"
                    exclusive
                    value={state.axis}
                    onChange={(_, axis: Axis | null) => axis && set({ axis })}
                    sx={toggleSx}
                >
                    {(["z", "y", "x"] as Axis[]).map((a) => (
                        <ToggleButton key={a} value={a}>{a.toUpperCase()}</ToggleButton>
                    ))}
                </ToggleButtonGroup>
                <Tooltip title="Slice of every class (each card's slider moves only that one)">
                    <Slider
                        size="small"
                        min={0}
                        max={1}
                        step={0.01}
                        value={state.slice}
                        onChange={(_, v) => set({ slice: v as number })}
                        aria-label="Slice of every card"
                        sx={{ width: 120, color: "var(--emf-teal-600)" }}
                    />
                </Tooltip>
                <Box sx={{ flex: 1 }} />
                <ToggleButtonGroup
                    size="small"
                    exclusive
                    value={state.size}
                    onChange={(_, size: number | null) => size && set({ size })}
                    sx={toggleSx}
                >
                    {GALLERY_SIZES.map((s, i) => (
                        <ToggleButton key={s} value={s}>{["S", "M", "L"][i]}</ToggleButton>
                    ))}
                </ToggleButtonGroup>
            </Box>

            <Box
                sx={{
                    flex: 1,
                    minHeight: 0,
                    overflow: "auto",
                    p: 1.5,
                    display: "grid",
                    gridTemplateColumns: `repeat(auto-fill, minmax(${state.size}px, 1fr))`,
                    gap: 1.25,
                    alignContent: "start",
                    gridAutoRows: "max-content",
                    backgroundColor: "var(--emf-slate-50)",
                }}
            >
                {rows.map((row) => (
                    <GalleryCard
                        key={row.id}
                        row={row}
                        gallery={gallery}
                        state={state}
                        loadDensity={loadDensity}
                        selected={selectedRowId === row.id}
                        onOpen={onOpen}
                        selection={selection}
                        onContextMenu={onContextMenu}
                    />
                ))}
                {rows.length === 0 && (
                    <Typography sx={{ gridColumn: "1 / -1", textAlign: "center", mt: 4, fontSize: "0.8rem", color: "var(--emf-slate-400)" }}>
                        No items
                    </Typography>
                )}
            </Box>
        </Box>
    );
}

function GalleryCard({
    row,
    gallery,
    state,
    loadDensity,
    selected,
    onOpen,
    selection,
    onContextMenu,
}: {
    row: TableViewerRow;
    gallery: GallerySpec;
    state: GalleryViewState;
    loadDensity: (row: TableViewerRow) => Promise<VolumeDensity>;
    selected: boolean;
    onOpen: (row: TableViewerRow) => void;
    selection: TableViewerGalleryProps["selection"];
    onContextMenu: (event: MouseEvent<HTMLElement>, row: TableViewerRow) => void;
}) {
    const [result, setResult] = useState<DensityResult | null>(null);
    useEffect(() => {
        let alive = true;
        loadDensity(row)
            .then(async (density) => {
                await prepareDensity(density);
                if (alive) setResult({ density });
            })
            .catch((error) => {
                if (alive) setResult({ error: error instanceof Error ? error.message : String(error) });
            });
        return () => {
            alive = false;
        };
    }, [row, loadDensity]);

    const density = result?.density;
    const n = density ? { x: density.shape[2], y: density.shape[1], z: density.shape[0] }[state.axis] : 0;
    // This card's own slice (grid index), until the shared one changes
    const [own, setOwn] = useState<number | null>(null);
    useEffect(() => setOwn(null), [state.axis, state.slice]);
    const index = own ?? Math.round(state.slice * Math.max(0, n - 1));

    const canvasRef = useRef<HTMLCanvasElement>(null);
    useEffect(() => {
        const canvas = canvasRef.current;
        if (!density || !canvas) return;
        const f = density.binning || 1;
        const src = densitySlice(density, state.axis, Math.floor((index + 0.5) * f));
        canvas.width = src.width;
        canvas.height = src.height;
        canvas.getContext("2d")!.drawImage(src, 0, 0);
    }, [density, state.axis, index]);

    const checked = selection ? selection.isChecked(row) : true;
    const title = fillGalleryTemplate(gallery.title, row.cells);
    const footer = gallery.footer ? fillGalleryTemplate(gallery.footer, row.cells) : null;

    return (
        <Box
            onClick={() => onOpen(row)}
            onContextMenu={(event) => onContextMenu(event, row)}
            sx={{
                minWidth: 0,
                display: "flex",
                flexDirection: "column",
                borderRadius: 1.5,
                overflow: "hidden",
                cursor: "pointer",
                backgroundColor: "var(--emf-white)",
                border: selected
                    ? "2px solid var(--emf-teal-600)"
                    : "1px solid var(--emf-gray-200)",
                m: selected ? 0 : "1px",
                opacity: checked ? 1 : 0.5,
                transition: "opacity 120ms, box-shadow 120ms",
                // The image keeps its square, the footer its line
                "& > *": { flexShrink: 0 },
                "&:hover": { boxShadow: "0 2px 8px rgba(15,23,42,0.12)" },
            }}
        >
            {/* Header: selection, title and the 3D volume */}
            <Box
                sx={{
                    display: "flex",
                    alignItems: "center",
                    gap: 0.25,
                    px: 0.5,
                    minHeight: 30,
                    backgroundColor: "var(--emf-teal-150)",
                    borderBottom: "1px solid var(--emf-teal-border-strong)",
                }}
            >
                {selection && (
                    <Checkbox
                        size="small"
                        checked={checked}
                        onClick={(event) => {
                            event.stopPropagation();
                            selection.onToggle(event, row);
                        }}
                        inputProps={{ "aria-label": `Select ${title}` }}
                        sx={{ p: 0.5, "& .MuiSvgIcon-root": { fontSize: 17 } }}
                    />
                )}
                <Typography
                    sx={{
                        flex: 1,
                        minWidth: 0,
                        pl: selection ? 0 : 0.75,
                        fontSize: "0.76rem",
                        fontWeight: 700,
                        color: "var(--emf-teal-800)",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                    }}
                >
                    {title}
                </Typography>
                {row.defaultAction && (
                    <Tooltip title={`Open the ${row.defaultAction.label} in the viewer`}>
                        <IconButton
                            size="small"
                            onClick={(event) => {
                                event.stopPropagation();
                                onOpen(row);
                            }}
                            sx={{ p: 0.5, color: "var(--emf-teal-700)" }}
                        >
                            <CubeIcon size={15} strokeWidth={1.8} />
                        </IconButton>
                    </Tooltip>
                )}
            </Box>

            {/* The section of the volume */}
            <Box
                sx={{
                    position: "relative",
                    aspectRatio: "1 / 1",
                    backgroundColor: "#000",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                }}
            >
                {density ? (
                    <canvas
                        ref={canvasRef}
                        style={{ width: "100%", height: "100%", objectFit: "contain", display: "block" }}
                    />
                ) : result?.error ? (
                    <Typography sx={{ px: 1, fontSize: "0.68rem", color: "var(--emf-slate-300)", textAlign: "center" }}>
                        {result.error}
                    </Typography>
                ) : (
                    <CircularProgress size={18} sx={{ color: "var(--emf-slate-400)" }} />
                )}
                {density && (
                    <Typography
                        sx={{
                            position: "absolute",
                            top: 3,
                            right: 5,
                            fontSize: "0.62rem",
                            color: "rgba(255,255,255,0.75)",
                            pointerEvents: "none",
                        }}
                    >
                        {state.axis.toUpperCase()} {index + 1}/{n}
                    </Typography>
                )}
            </Box>

            {density && n > 1 && (
                <Box sx={{ px: 1.25, height: 22, display: "flex", alignItems: "center" }} onClick={(e) => e.stopPropagation()}>
                    <Slider
                        size="small"
                        min={0}
                        max={n - 1}
                        value={index}
                        onChange={(_, v) => setOwn(v as number)}
                        aria-label={`Slice of ${title}`}
                        sx={{ color: "var(--emf-teal-600)", py: 0.5, "& .MuiSlider-thumb": { width: 10, height: 10 } }}
                    />
                </Box>
            )}

            {footer && (
                <Typography
                    title={footer}
                    sx={{
                        px: 0.75,
                        py: 0.5,
                        fontSize: "0.68rem",
                        color: "var(--emf-slate-600)",
                        textAlign: "center",
                        borderTop: "1px solid var(--emf-gray-200)",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                    }}
                >
                    {footer}
                </Typography>
            )}
        </Box>
    );
}
