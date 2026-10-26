import { useEffect, useMemo, useRef, useState } from "react";
import { Box, Button, CircularProgress, Typography } from "@mui/material";

import { useProjectService } from "@/ProjectServiceContext";
import AnalyzeOutputDialog from "@/components/analyze/analyze-output-dialog";

import TableViewerDialog from "@/components/analyze/table-viewer-dialog";
import type { AnalyzeViewerResolveDecision } from "@/services/ProjectService";
import { openExternalAnalyzeDecision } from "@/utils/analyze-viewer-decision";


type ProtocolOutputsPanelProps = {
    projectId: number | string | null;
    protocolId: number | string | null;
    protocolLabel?: string;
    outputsFromApi?: any[];
};

type NormalizedOutput = {
    name: string;
    infoText: string;
    raw: any;
};

export default function ProtocolOutputsPanel({
    projectId,
    protocolId,
    protocolLabel = "",
    outputsFromApi = [],
}: ProtocolOutputsPanelProps) {
    const svc = useProjectService();

    const projectIdStr = projectId != null ? String(projectId) : "";
    const protocolIdStr = protocolId != null ? String(protocolId) : "";

    const [selectedOutputIdx, setSelectedOutputIdx] = useState<number | null>(null);

    const [previewLoading, setPreviewLoading] = useState(false);
    const [previewError, setPreviewError] = useState<string | null>(null);
    const [previewData, setPreviewData] = useState<any>(null);

    const [sqliteTable, setSqliteTable] = useState<string | null>(null);
    const previewUrlRef = useRef<string | null>(null);

    const [analyzeOpen, setAnalyzeOpen] = useState(false);

    const [tableViewerState, setTableViewerState] = useState<
        Extract<
            AnalyzeViewerResolveDecision,
            {
                handled: true;
                viewer: "table";
            }
        > | null
    >(null);


    const normalizedOutputs = useMemo<NormalizedOutput[]>(() => {
        const arr = Array.isArray(outputsFromApi) ? outputsFromApi : [];
        return arr.map((entry: any, idx: number) => {
            const outputName = String(entry?.outputName ?? entry?.name ?? entry?._key ?? idx);
            const infoText = entry?.info ?? entry?.pointerClass ?? "";
            return { name: outputName, infoText, raw: entry };
        });
    }, [outputsFromApi]);

    const activeOutput = useMemo(() => {
        if (
            selectedOutputIdx == null ||
            selectedOutputIdx < 0 ||
            selectedOutputIdx >= normalizedOutputs.length
        ) {
            return null;
        }
        return normalizedOutputs[selectedOutputIdx];
    }, [selectedOutputIdx, normalizedOutputs]);

    useEffect(() => {
        if (normalizedOutputs.length === 0) {
            setSelectedOutputIdx(null);
            return;
        }

        setSelectedOutputIdx((prev) => {
            if (prev == null) return 0;
            if (prev >= 0 && prev < normalizedOutputs.length) return prev;
            return 0;
        });
    }, [normalizedOutputs]);

    useEffect(() => {
        setSqliteTable(null);
    }, [activeOutput?.name]);

    useEffect(() => {
        return () => {
            if (previewUrlRef.current) {
                URL.revokeObjectURL(previewUrlRef.current);
                previewUrlRef.current = null;
            }
        };
    }, []);

    useEffect(() => {
        if (!projectIdStr || !protocolIdStr) {
            setPreviewData(null);
            setPreviewError("Missing projectId or protocolId");
            setPreviewLoading(false);
            return;
        }

        if (!activeOutput) {
            setPreviewData(null);
            setPreviewError(null);
            setPreviewLoading(false);
            setSqliteTable(null);
            return;
        }

        let cancelled = false;
        const abortController = new AbortController();

        setPreviewLoading(true);
        setPreviewError(null);

        void (async () => {
            try {
                const res: any = await svc.fetchOutputPreview(
                    projectIdStr,
                    protocolIdStr,
                    activeOutput.name,
                    sqliteTable
                        ? { table: sqliteTable, signal: abortController.signal }
                        : { signal: abortController.signal }
                );

                if (cancelled) return;

                if ((res?.kind === "image" || res?.kind === "pdf" || res?.kind === "binary") && res.url) {
                    if (previewUrlRef.current) {
                        URL.revokeObjectURL(previewUrlRef.current);
                    }
                    previewUrlRef.current = res.url;
                }

                setPreviewData(res ?? null);
            } catch (err: any) {
                if (cancelled) return;
                setPreviewError(err?.message || "Failed to load preview");
                setPreviewData(null);
            } finally {
                if (!cancelled) {
                    setPreviewLoading(false);
                }
            }
        })();

        return () => {
            cancelled = true;
            abortController.abort();
        };
    }, [activeOutput, protocolIdStr, sqliteTable, svc, projectIdStr]);

    const handleAnalyzeResultsClick = async (e: React.MouseEvent<HTMLButtonElement>) => {
        e.preventDefault();
        e.stopPropagation();

        if (!activeOutput) return;

        const outputRaw = activeOutput.raw ?? null;
        const ctx = {
            projectId: projectIdStr,
            protocolId: protocolIdStr,
            protocolLabel,
            outputName: String(activeOutput.name ?? ""),
            outputRaw,
            pointerClass: String(outputRaw?.pointerClass ?? outputRaw?.paramClass ?? outputRaw?._class ?? ""),
        };

        const resolveAnalyzeViewer = (svc as any)?.resolveAnalyzeViewer;
        if (typeof resolveAnalyzeViewer === "function") {
            try {
                const res: AnalyzeViewerResolveDecision =
                    await resolveAnalyzeViewer(ctx);

                if (res.handled) {
                    if (res.viewer === "table") {
                        setTableViewerState(res);
                        return;
                    }

                    if (openExternalAnalyzeDecision(res, "_self")) {
                        return;
                    }
                }
            } catch (err) {
                console.warn("[ProtocolOutputsPanel] resolveAnalyzeViewer failed, falling back:", err);
            }
        }

        setAnalyzeOpen(true);
    };

    const previewContent = useMemo(() => {
        if (!activeOutput) {
            return (
                <Typography
                    variant="body2"
                    sx={{
                        color: "#6b7280",
                        fontSize: 12,
                        textAlign: "center",
                        py: 4,
                    }}
                >
                    Select an output on the left to preview it here.
                </Typography>
            );
        }

        if (previewLoading) {
            return (
                <Box
                    sx={{
                        display: "flex",
                        flexDirection: "column",
                        alignItems: "center",
                        justifyContent: "center",
                        gap: 1,
                    }}
                >
                    <CircularProgress size={20} />
                    <Typography variant="caption" sx={{ fontSize: "0.75rem", color: "#4b5563" }}>
                        Loading preview...
                    </Typography>
                </Box>
            );
        }

        if (previewError) {
            return (
                <Typography
                    variant="body2"
                    sx={{
                        color: "#dc2626",
                        fontSize: "0.75rem",
                        textAlign: "center",
                        whiteSpace: "pre-wrap",
                        wordBreak: "break-word",
                    }}
                >
                    {previewError}
                </Typography>
            );
        }

        if (previewData?.imageUrl) {
            return (
                <Box
                    sx={{
                        width: "100%",
                        flexShrink: 0,
                        display: "flex",
                        alignItems: "flex-start",
                        justifyContent: "center",
                    }}
                >
                    <img
                        src={previewData.imageUrl}
                        alt={activeOutput.name}
                        style={{
                            display: "block",
                            maxWidth: "100%",
                            height: "auto",
                            objectFit: "contain",
                        }}
                    />
                </Box>
            );
        }

        if (previewData?.text && !previewData?.kind) {
            return (
                <Box
                    sx={{
                        p: 2,
                        borderRadius: 2,
                        backgroundColor: "#fff",
                        border: "1px solid #e5e7eb",
                        boxShadow: "0 2px 4px rgba(0,0,0,0.05)",
                        maxWidth: "100%",
                        maxHeight: "100%",
                        overflowY: "auto",
                        whiteSpace: "pre-wrap",
                        wordBreak: "break-word",
                        fontSize: ".75rem",
                        lineHeight: 1.4,
                        color: "#111827",
                    }}
                >
                    {previewData.text}
                </Box>
            );
        }

        switch (previewData?.kind) {
            case "image":
                return (
                    <Box sx={{ width: "100%", display: "flex", justifyContent: "center", alignItems: "flex-start" }}>
                        <img
                            src={previewData.url}
                            alt={activeOutput.name}
                            style={{
                                display: "block",
                                maxWidth: "100%",
                                height: "auto",
                            }}
                        />
                    </Box>
                );

            case "pdf":
                return (
                    <Box
                        sx={{
                            width: "100%",
                            height: "100%",
                            borderRadius: 2,
                            overflow: "hidden",
                            border: "1px solid #e5e7eb",
                            backgroundColor: "#fff",
                        }}
                    >
                        <object data={previewData.url} type="application/pdf" width="100%" height="100%">
                            <Box sx={{ p: 2 }}>
                                <Typography variant="body2" sx={{ mb: 1 }}>
                                    PDF preview not supported by your browser.
                                </Typography>
                                <a href={previewData.downloadUrl} target="_blank" rel="noreferrer">
                                    Open PDF
                                </a>
                            </Box>
                        </object>
                    </Box>
                );

            case "table": {
                const cols: string[] = previewData.data?.columns || [];
                const rows: any[] = previewData.data?.rows || [];

                return (
                    <Box
                        sx={{
                            width: "100%",
                            maxHeight: "100%",
                            overflow: "auto",
                            backgroundColor: "#fff",
                            border: "1px solid #e5e7eb",
                            borderRadius: 2,
                        }}
                    >
                        <table
                            style={{
                                width: "100%",
                                borderCollapse: "collapse",
                                fontSize: "0.75rem",
                            }}
                        >
                            <thead
                                style={{
                                    position: "sticky",
                                    top: 0,
                                    background: "#f3f4f6",
                                }}
                            >
                                <tr>
                                    {cols.map((c) => (
                                        <th
                                            key={c}
                                            style={{
                                                textAlign: "left",
                                                padding: "6px 8px",
                                                borderBottom: "1px solid #e5e7eb",
                                            }}
                                        >
                                            {c}
                                        </th>
                                    ))}
                                </tr>
                            </thead>
                            <tbody>
                                {rows.map((r, i) => (
                                    <tr key={i} style={{ borderBottom: "1px solid #f3f4f6" }}>
                                        {cols.map((c) => (
                                            <td
                                                key={c}
                                                style={{
                                                    padding: "6px 8px",
                                                    verticalAlign: "top",
                                                    whiteSpace: "nowrap",
                                                }}
                                            >
                                                {String(r[c] ?? "")}
                                            </td>
                                        ))}
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </Box>
                );
            }

            case "sqlite": {
                const mode = previewData.meta?.mode;

                if (mode === "tables") {
                    const tables: string[] = previewData.data?.tables || [];
                    return (
                        <Box
                            sx={{
                                width: "100%",
                                backgroundColor: "#fff",
                                border: "1px solid #e5e7eb",
                                borderRadius: 2,
                                p: 1,
                            }}
                        >
                            <Typography variant="caption" sx={{ color: "#6b7280" }}>
                                Tables
                            </Typography>
                            <Box
                                sx={{
                                    mt: 1,
                                    display: "grid",
                                    gridTemplateColumns: "repeat(auto-fill,minmax(160px,1fr))",
                                    gap: 0.5,
                                }}
                            >
                                {tables.map((t) => (
                                    <Button
                                        key={t}
                                        size="small"
                                        variant="outlined"
                                        sx={{
                                            textTransform: "none",
                                            justifyContent: "flex-start",
                                        }}
                                        onClick={() => setSqliteTable(t)}
                                    >
                                        {t}
                                    </Button>
                                ))}
                            </Box>
                        </Box>
                    );
                }

                const cols: string[] =
                    previewData.data?.columns || previewData.meta?.columnsHeader?.split(",") || [];
                const rows: any[] = previewData.data?.rows || [];

                return (
                    <Box
                        sx={{
                            width: "100%",
                            maxHeight: "100%",
                            overflow: "auto",
                            backgroundColor: "#fff",
                            border: "1px solid #e5e7eb",
                            borderRadius: 2,
                        }}
                    >
                        <Box
                            sx={{
                                p: 1,
                                display: "flex",
                                gap: 1,
                                alignItems: "center",
                                borderBottom: "1px solid #eee",
                            }}
                        >
                            <Button
                                size="small"
                                onClick={() => setSqliteTable(null)}
                                sx={{ textTransform: "none" }}
                            >
                                Back to tables
                            </Button>
                            <Typography variant="caption" sx={{ color: "#6b7280" }}>
                                {rows.length} rows {previewData.meta?.rowCount ? `(server: ${previewData.meta.rowCount})` : ""}
                            </Typography>
                        </Box>

                        <table
                            style={{
                                width: "100%",
                                borderCollapse: "collapse",
                                fontSize: "0.75rem",
                            }}
                        >
                            <thead
                                style={{
                                    position: "sticky",
                                    top: 0,
                                    background: "#f3f4f6",
                                }}
                            >
                                <tr>
                                    {cols.map((c) => (
                                        <th
                                            key={c}
                                            style={{
                                                textAlign: "left",
                                                padding: "6px 8px",
                                                borderBottom: "1px solid #e5e7eb",
                                            }}
                                        >
                                            {c}
                                        </th>
                                    ))}
                                </tr>
                            </thead>
                            <tbody>
                                {rows.map((r, i) => (
                                    <tr key={i} style={{ borderBottom: "1px solid #f3f4f6" }}>
                                        {cols.map((c) => (
                                            <td
                                                key={c}
                                                style={{
                                                    padding: "6px 8px",
                                                    verticalAlign: "top",
                                                    whiteSpace: "nowrap",
                                                }}
                                            >
                                                {String(r[c] ?? "")}
                                            </td>
                                        ))}
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </Box>
                );
            }

            case "archive": {
                const entries: Array<{
                    name: string;
                    isDir?: boolean;
                    size?: number;
                    compressedSize?: number;
                }> = previewData.data?.entries || [];

                return (
                    <Box
                        sx={{
                            width: "100%",
                            backgroundColor: "#fff",
                            border: "1px solid #e5e7eb",
                            borderRadius: 2,
                            p: 1,
                        }}
                    >
                        <Typography variant="caption" sx={{ color: "#6b7280" }}>
                            Archive entries
                        </Typography>
                        <Box
                            sx={{
                                mt: 1,
                                maxHeight: "100%",
                                overflow: "auto",
                            }}
                        >
                            {entries.map((e, i) => (
                                <Box
                                    key={i}
                                    sx={{
                                        display: "flex",
                                        gap: 1,
                                        py: 0.5,
                                        borderBottom: "1px dashed #f3f4f6",
                                    }}
                                >
                                    <Typography
                                        variant="body2"
                                        sx={{
                                            fontSize: "0.75rem",
                                            color: e.isDir ? "#111827" : "#374151",
                                        }}
                                    >
                                        {e.name}
                                    </Typography>
                                    {!e.isDir && (
                                        <Typography variant="caption" sx={{ color: "#6b7280" }}>
                                            {typeof e.size === "number" ? `• ${e.size} B` : ""}
                                            {typeof e.compressedSize === "number" ? ` (compressed ${e.compressedSize} B)` : ""}
                                        </Typography>
                                    )}
                                </Box>
                            ))}
                        </Box>
                    </Box>
                );
            }

            case "text":
                return (
                    <Box
                        sx={{
                            p: 2,
                            borderRadius: 2,
                            backgroundColor: "#fff",
                            border: "1px solid #e5e7eb",
                            boxShadow: "0 2px 4px rgba(0,0,0,0.05)",
                            maxWidth: "100%",
                            maxHeight: "100%",
                            overflowY: "auto",
                            whiteSpace: "pre-wrap",
                            wordBreak: "break-word",
                            fontSize: "0.75rem",
                            lineHeight: 1.4,
                            color: "#111827",
                        }}
                    >
                        {previewData.text}
                    </Box>
                );

            case "binary":
                return (
                    <Box
                        sx={{
                            width: "100%",
                            borderRadius: 2,
                            backgroundColor: "#fff",
                            border: "1px solid #e5e7eb",
                            p: 2,
                        }}
                    >
                        <Typography variant="body2" sx={{ mb: 1 }}>
                            Binary file preview is not available.
                        </Typography>
                        <Typography
                            variant="caption"
                            sx={{
                                color: "#6b7280",
                                display: "block",
                                mb: 1,
                            }}
                        >
                            {previewData.meta?.mime || "application/octet-stream"} • {previewData.meta?.sizeBytes ?? "?"} bytes
                        </Typography>
                        <Button
                            size="small"
                            variant="outlined"
                            href={previewData.downloadUrl}
                            sx={{ textTransform: "none" }}
                        >
                            Download
                        </Button>
                    </Box>
                );

            default:
                if (previewData) {
                    return (
                        <Box
                            sx={{
                                width: "100%",
                                maxHeight: "100%",
                                overflowY: "auto",
                                border: "2px dashed #e5e7eb",
                                borderRadius: 2,
                                backgroundColor: "#fff",
                                textAlign: "left",
                                p: 2,
                                fontSize: "0.7rem",
                                lineHeight: 1.4,
                                fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
                                color: "#1f2937",
                                wordBreak: "break-word",
                                whiteSpace: "pre-wrap",
                            }}
                        >
                            {JSON.stringify(previewData, null, 2)}
                        </Box>
                    );
                }

                return (
                    <Box
                        sx={{
                            width: "100%",
                            minHeight: "100%",
                            maxHeight: "100%",
                            border: "2px dashed #e5e7eb",
                            borderRadius: 2,
                            backgroundColor: "#fff",
                            display: "flex",
                            flexDirection: "column",
                            alignItems: "center",
                            justifyContent: "center",
                            textAlign: "center",
                            px: 2,
                            py: 3,
                            color: "#6b7280",
                            fontSize: "0.8rem",
                            lineHeight: 1.4,
                            wordBreak: "break-word",
                        }}
                    >
                        <Typography
                            variant="body2"
                            sx={{
                                color: "#4b5563",
                                fontSize: "0.75rem",
                                mb: 1,
                                lineHeight: 1.4,
                            }}
                        >
                            Preview for "{activeOutput.name}".
                        </Typography>
                    </Box>
                );
        }
    }, [activeOutput, previewLoading, previewError, previewData]);

    return (
        <>
            <Box
                sx={{
                    display: "flex",
                    flexDirection: "row",
                    gap: 2,
                    flex: 1,
                    minHeight: 0,
                }}
            >
                <Box
                    sx={{
                        flex: "0 0 45%",
                        maxWidth: "45%",
                        minWidth: 0,
                        minHeight: 0,
                        backgroundColor: "#fff",
                        borderRadius: 2,
                        boxShadow: "0px 2px 6px rgba(0,0,0,0.1)",
                        border: "1px solid #e5e7eb",
                        display: "flex",
                        flexDirection: "column",
                        overflow: "hidden",
                    }}
                >
                    <Box
                        sx={{
                            px: 1.5,
                            py: 1,
                            borderBottom: "1px solid #e5e7eb",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "space-between",
                        }}
                    >
                        <Typography
                            variant="subtitle2"
                            sx={{
                                fontWeight: 600,
                                fontSize: "0.8rem",
                                color: "#111827",
                            }}
                        >
                            Outputs
                        </Typography>
                        <Typography
                            variant="caption"
                            sx={{
                                color: "#6b7280",
                                fontSize: "0.7rem",
                            }}
                        >
                            {normalizedOutputs.length} items
                        </Typography>
                    </Box>

                    <Box
                        sx={{
                            flex: 1,
                            minHeight: 0,
                            overflowY: "auto",
                            p: 1,
                        }}
                    >
                        {normalizedOutputs.length === 0 ? (
                            <Typography
                                variant="body2"
                                sx={{
                                    color: "#6b7280",
                                    fontSize: "0.8rem",
                                    textAlign: "center",
                                    py: 4,
                                }}
                            >
                                No outputs for this protocol.
                            </Typography>
                        ) : (
                            normalizedOutputs.map((o, idx) => (
                                <Box
                                    key={idx}
                                    onClick={() => setSelectedOutputIdx(idx)}
                                    sx={{
                                        cursor: "pointer",
                                        userSelect: "none",
                                        borderRadius: 1.5,
                                        border: "1px solid transparent",
                                        px: 1,
                                        py: 1,
                                        mb: 1,
                                        backgroundColor: selectedOutputIdx === idx ? "#eef2ff" : "transparent",
                                        borderColor: selectedOutputIdx === idx ? "#6366f1" : "transparent",
                                        "&:hover": {
                                            backgroundColor: selectedOutputIdx === idx ? "#eef2ff" : "#f9fafb",
                                            borderColor: selectedOutputIdx === idx ? "#6366f1" : "#e5e7eb",
                                        },
                                    }}
                                >
                                    <Typography
                                        variant="body2"
                                        sx={{
                                            color: "#111827",
                                            fontSize: "0.7rem",
                                            fontWeight: selectedOutputIdx === idx ? 600 : 500,
                                            lineHeight: 1.4,
                                            wordBreak: "break-word",
                                            whiteSpace: "pre-wrap",
                                        }}
                                    >
                                        {o.infoText}
                                    </Typography>
                                </Box>
                            ))
                        )}
                    </Box>
                </Box>

                <Box
                    sx={{
                        flex: "1 1 0",
                        minWidth: 0,
                        minHeight: 0,
                        backgroundColor: "#fff",
                        borderRadius: 2,
                        boxShadow: "0px 2px 6px rgba(0,0,0,0.1)",
                        border: "1px solid #e5e7eb",
                        display: "flex",
                        flexDirection: "column",
                        overflow: "hidden",
                    }}
                >
                    <Box
                        sx={{
                            px: 1.5,
                            py: 1,
                            borderBottom: "1px solid #e5e7eb",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "space-between",
                            gap: 1,
                        }}
                    >
                        <Typography
                            variant="subtitle2"
                            sx={{ fontWeight: 600, fontSize: "0.8rem", color: "#111827" }}
                        >
                            Preview
                        </Typography>

                        <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                            <Button
                                size="small"
                                variant="contained"
                                disabled={!activeOutput}
                                onClick={handleAnalyzeResultsClick}
                                sx={{
                                    textTransform: "none",
                                    ml: 1,
                                    backgroundColor: "#333d49",
                                    "&:hover": { backgroundColor: "#596472ff" },
                                }}
                            >
                                Analyze results
                            </Button>
                        </Box>
                    </Box>

                    <Box
                        sx={{
                            flex: 1,
                            minHeight: 0,
                            overflowY: "auto",
                            overflowX: "hidden",
                            p: 1,
                            pb: 6,
                            backgroundColor: "#f9fafb",
                            display: "flex",
                            justifyContent: "center",
                            alignItems: "flex-start",
                        }}
                    >
                        {previewContent}
                    </Box>
                </Box>
            </Box>

            <AnalyzeOutputDialog
                open={analyzeOpen}
                onClose={() => setAnalyzeOpen(false)}
                projectId={Number(projectId)}
                protocolId={Number(protocolId)}
                protocolLabel={protocolLabel}
                outputName={activeOutput?.name || ""}
                outputRaw={activeOutput?.raw ?? null}
            />
            {tableViewerState && (
                <TableViewerDialog
                    open
                    onClose={() => setTableViewerState(null)}
                    context={tableViewerState.context}
                    table={tableViewerState.table}
                    title={tableViewerState.title}
                    protocolLabel={protocolLabel}
                />
            )}

        </>

    );
}