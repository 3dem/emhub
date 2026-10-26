import { Box, Typography } from "@mui/material";

import type {
    TableViewerGridContent,
    TableViewerGridLayout,
    TableViewerGridSlot,
    TableViewerPaneContent,
} from "@/services/ProjectService";
import TableViewerGenericContentView, {
    isGenericTableViewerContent,
} from "./table-viewer-generic-content";

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
}: {
    slot: TableViewerGridSlot;
    content?: TableViewerPaneContent;
}) {
    const title = content?.title;

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
            {title && (
                <Typography
                    sx={{
                        px: 1.25,
                        py: 0.5,
                        fontSize: "0.72rem",
                        fontWeight: 600,
                        color: "#334155",
                        borderBottom: "1px solid #eef2f7",
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        flexShrink: 0,
                    }}
                >
                    {title}
                </Typography>
            )}

            <Box sx={{ flex: 1, minHeight: 0, overflow: "hidden" }}>
                {!content ? null : isGenericTableViewerContent(content) ? (
                    // The title is shown in the cell header
                    <TableViewerGenericContentView
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
 * (see TableViewerGridLayout).
 */
export default function TableViewerGrid({
    content,
}: {
    content: TableViewerGridContent;
}) {
    const layout = GRID_LAYOUTS[content.layout] ?? GRID_LAYOUTS["2x2"];
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
                    key={slot}
                    slot={slot}
                    content={content.cells[slot]}
                />
            ))}
        </Box>
    );
}
