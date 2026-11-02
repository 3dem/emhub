import { useState } from "react";
import { Box, IconButton, Tooltip, Typography } from "@mui/material";
import CloseFullscreenIcon from "@mui/icons-material/CloseFullscreen";
import OpenInFullIcon from "@mui/icons-material/OpenInFull";

import type {
    TableViewerGridContent,
    TableViewerGridLayout,
    TableViewerGridSlot,
    TableViewerPaneContent,
} from "@/services/ProjectService";
import TableViewerContent, {
    isGenericTableViewerContent,
} from "./TableViewerContent";

// CSS grid areas of each layout (slot names are the area names)
const GRID_LAYOUTS: Record<
    TableViewerGridLayout,
    { areas: string[]; slots: TableViewerGridSlot[] }
> = {
    "2x2": {
        areas: ["topLeft topRight", "bottomLeft bottomRight"],
        slots: ["topLeft", "topRight", "bottomLeft", "bottomRight"],
    },
    cols: {
        areas: ["left right"],
        slots: ["left", "right"],
    },
    rows: {
        areas: ["top", "bottom"],
        slots: ["top", "bottom"],
    },
    "span-top": {
        areas: ["top top", "bottomLeft bottomRight"],
        slots: ["top", "bottomLeft", "bottomRight"],
    },
    "span-bottom": {
        areas: ["topLeft topRight", "bottom bottom"],
        slots: ["topLeft", "topRight", "bottom"],
    },
    "span-left": {
        areas: ["left topRight", "left bottomRight"],
        slots: ["left", "topRight", "bottomRight"],
    },
    "span-right": {
        areas: ["topLeft right", "bottomLeft right"],
        slots: ["topLeft", "bottomLeft", "right"],
    },
};

function GridCellMessage({ message }: { message: string }) {
    return (
        <Box
            sx={{
                height: "100%",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                px: 2,
            }}
        >
            <Typography
                variant="body2"
                sx={{
                    color: "#94a3b8",
                    textAlign: "center",
                    fontSize: "0.76rem",
                }}
            >
                {message}
            </Typography>
        </Box>
    );
}

function GridCell({
    slot,
    content,
    expanded,
    onToggleExpand,
}: {
    slot: TableViewerGridSlot;
    content?: TableViewerPaneContent;
    expanded: boolean;
    onToggleExpand: () => void;
}) {
    const title = content?.title;
    const expandLabel = expanded ? "Collapse" : "Expand";

    return (
        <Box
            sx={{
                gridArea: slot,
                minWidth: 0,
                minHeight: 0,
                display: "flex",
                flexDirection: "column",
                backgroundColor: "#ffffff",
                border: "1px solid #e2e8f0",
                borderRadius: 1,
                overflow: "hidden",
            }}
        >
            <Box
                sx={{
                    display: "flex",
                    alignItems: "center",
                    pl: 1.25,
                    pr: 0.25,
                    minHeight: 26,
                    borderBottom: "1px solid #eef2f7",
                    flexShrink: 0,
                }}
            >
                <Typography
                    sx={{
                        flex: 1,
                        minWidth: 0,
                        fontSize: "0.72rem",
                        fontWeight: 600,
                        color: "#334155",
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                    }}
                >
                    {title}
                </Typography>
                <Tooltip title={expandLabel}>
                    <IconButton
                        size="small"
                        aria-label={expandLabel}
                        onClick={onToggleExpand}
                        sx={{ p: 0.4, color: "#64748b" }}
                    >
                        {expanded ? (
                            <CloseFullscreenIcon sx={{ fontSize: 14 }} />
                        ) : (
                            <OpenInFullIcon sx={{ fontSize: 14 }} />
                        )}
                    </IconButton>
                </Tooltip>
            </Box>

            <Box sx={{ flex: 1, minHeight: 0, overflow: "hidden" }}>
                {!content ? null : isGenericTableViewerContent(content) ? (
                    // The title is shown in the cell header
                    <TableViewerContent
                        content={{ ...content, title: undefined }}
                        fit
                    />
                ) : content.kind === "empty" ? (
                    <GridCellMessage
                        message={content.message ?? "No content."}
                    />
                ) : (
                    <GridCellMessage
                        message={`Viewer '${content.kind}' is not supported in a grid.`}
                    />
                )}
            </Box>
        </Box>
    );
}

/**
 * Up to 4 panes in a 2 x 2 grid, a pane may span two columns or two rows
 * (see TableViewerGridLayout). Each pane can be expanded to the whole grid.
 * Pass expandedSlot / onExpandedSlotChange to keep the expanded pane when the
 * grid content changes (e.g. another row); otherwise it is kept internally.
 */
export default function TableViewerGrid({
    content,
    expandedSlot,
    onExpandedSlotChange,
}: {
    content: TableViewerGridContent;
    expandedSlot?: TableViewerGridSlot | null;
    onExpandedSlotChange?: (slot: TableViewerGridSlot | null) => void;
}) {
    const [ownExpandedSlot, setOwnExpandedSlot] =
        useState<TableViewerGridSlot | null>(null);
    const isControlled = onExpandedSlotChange !== undefined;
    const requestedSlot = isControlled ? expandedSlot ?? null : ownExpandedSlot;
    const setExpandedSlot = isControlled
        ? onExpandedSlotChange
        : setOwnExpandedSlot;

    const fullLayout = GRID_LAYOUTS[content.layout] ?? GRID_LAYOUTS["2x2"];
    // A slot not in this layout (another grid) shows the whole grid
    const expanded =
        requestedSlot && fullLayout.slots.includes(requestedSlot)
            ? requestedSlot
            : null;
    const layout = expanded
        ? { areas: [expanded], slots: [expanded] }
        : fullLayout;
    const nCols = layout.areas[0].split(" ").length;

    return (
        <Box
            sx={{
                height: "100%",
                minHeight: 0,
                p: 1,
                display: "grid",
                gap: 1,
                gridTemplateAreas: layout.areas
                    .map((row) => `"${row}"`)
                    .join(" "),
                gridTemplateColumns: `repeat(${nCols}, minmax(0, 1fr))`,
                gridTemplateRows: `repeat(${layout.areas.length}, minmax(0, 1fr))`,
                backgroundColor: "#f6f7fb",
            }}
        >
            {layout.slots.map((slot) => (
                <GridCell
                    // Remount when expanding/collapsing so plots fit the new size
                    key={`${slot}-${expanded ? "expanded" : "grid"}`}
                    slot={slot}
                    content={content.cells[slot]}
                    expanded={expanded === slot}
                    onToggleExpand={() =>
                        setExpandedSlot(expanded === slot ? null : slot)
                    }
                />
            ))}
        </Box>
    );
}
