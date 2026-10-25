import {
    Box,
    Chip,
    Dialog,
    DialogContent,
    DialogTitle,
    IconButton,
    Typography,
} from "@mui/material";

import { CloseIcon } from "@/icons";
import type {
    TableViewerContext,
    TableViewerData,
} from "@/services/ProjectService";
import TableViewerPane from "./table-viewer-pane";

type TableViewerDialogProps = {
    open: boolean;
    onClose: () => void;
    context: TableViewerContext;
    table: TableViewerData;
    title?: string;
    protocolLabel?: string;
};

export default function TableViewerDialog({
    open,
    onClose,
    context,
    table,
    title,
    protocolLabel = "",
}: TableViewerDialogProps) {
    const resolvedTitle =
        title ||
        table.title ||
        context.outputName;

    const handleClose = (
        _event: object,
        reason:
            | "backdropClick"
            | "escapeKeyDown",
    ) => {
        if (
            reason ===
            "backdropClick"
        ) {
            return;
        }

        onClose();
    };

    return (
        <Dialog
            open={open}
            onClose={handleClose}
            maxWidth={false}
            fullWidth
            PaperProps={{
                sx: {
                    width: "96vw",
                    maxWidth: "96vw",
                    height: "94vh",
                    maxHeight: "94vh",
                    minHeight: 650,
                    m: 0,
                    borderRadius: 2.5,
                    overflow: "hidden",
                    display: "flex",
                    flexDirection: "column",
                    border:
                        "1px solid #dbe2ea",
                    backgroundColor:
                        "#ffffff",
                    boxShadow:
                        "0 24px 70px rgba(15,23,42,0.22)",
                },
            }}
            onDoubleClickCapture={(
                event,
            ) => {
                event.stopPropagation();
            }}
        >
            <DialogTitle
                component="div"
                sx={{
                    minHeight: 66,
                    px: 2.25,
                    py: 1.25,
                    display: "flex",
                    alignItems: "center",
                    gap: 1.25,
                    flexShrink: 0,
                    borderBottom:
                        "1px solid #475569",
                    background:
                        "linear-gradient(135deg, #1f2937 0%, #334155 58%, #475569 100%)",
                    boxShadow:
                        "0 1px 0 rgba(255,255,255,0.05)",
                }}
            >
                <Box
                    sx={{
                        minWidth: 0,
                        flex: 1,
                    }}
                >
                    <Box
                        sx={{
                            display: "flex",
                            alignItems:
                                "center",
                            gap: 1,
                            minWidth: 0,
                        }}
                    >
                        <Typography
                            sx={{
                                color: "#ffffff",
                                fontSize:
                                    "1.05rem",
                                lineHeight: 1.2,
                                fontWeight: 700,
                                overflow:
                                    "hidden",
                                textOverflow:
                                    "ellipsis",
                                whiteSpace:
                                    "nowrap",
                            }}
                        >
                            {resolvedTitle}
                        </Typography>

                        {context.pointerClass ? (
                            <Chip
                                size="small"
                                label={
                                    context.pointerClass
                                }
                                sx={{
                                    height: 22,
                                    borderRadius:
                                        1.25,
                                    color:
                                        "#e2e8f0",
                                    backgroundColor:
                                        "rgba(255,255,255,0.08)",
                                    border:
                                        "1px solid rgba(255,255,255,0.16)",
                                    fontSize:
                                        "0.66rem",
                                    fontWeight:
                                        600,
                                }}
                            />
                        ) : null}
                    </Box>

                    {protocolLabel ? (
                        <Typography
                            variant="caption"
                            sx={{
                                display: "block",
                                mt: 0.35,
                                color: "#cbd5e1",
                                fontSize:
                                    "0.68rem",
                                overflow:
                                    "hidden",
                                textOverflow:
                                    "ellipsis",
                                whiteSpace:
                                    "nowrap",
                            }}
                        >
                            Protocol:{" "}
                            {protocolLabel}
                        </Typography>
                    ) : null}
                </Box>

                <IconButton
                    size="small"
                    onClick={onClose}
                    aria-label="Close table viewer"
                    sx={{
                        color: "#e2e8f0",
                        border:
                            "1px solid rgba(255,255,255,0.18)",
                        backgroundColor:
                            "rgba(255,255,255,0.08)",

                        "&:hover": {
                            color: "#ffffff",
                            backgroundColor:
                                "rgba(255,255,255,0.16)",
                            borderColor:
                                "rgba(255,255,255,0.28)",
                        },
                    }}
                >
                    <CloseIcon fontSize="small" />
                </IconButton>
            </DialogTitle>

            <DialogContent
                sx={{
                    p: 0,
                    flex: 1,
                    minWidth: 0,
                    minHeight: 0,
                    overflow: "hidden",
                    display: "flex",
                }}
            >
                <TableViewerPane
                    context={context}
                    table={table}
                />
            </DialogContent>
        </Dialog>
    );
}