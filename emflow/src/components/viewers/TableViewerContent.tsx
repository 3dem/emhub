import { Box } from "@mui/material";
import Plot from "@/lib/plot";
import { normalizeTitles } from "./Plot";

import type { TableViewerPaneContent } from "@/services/ProjectService";
import ImageSlider from "./ImageSlider";

/**
 * Pane content kinds that are rendered generically (not bound to a
 * built-in ScipionWeb viewer). Hosts such as EMhub return these from
 * resolveTableViewerAction to show plots, text, images or slice sliders.
 */
export type TableViewerGenericContent = Extract<
    TableViewerPaneContent,
    { kind: "text" | "html" | "iframe" | "image" | "plotly" | "imageSlider" }
>;

const GENERIC_KINDS = new Set<string>([
    "text",
    "html",
    "iframe",
    "image",
    "plotly",
    "imageSlider",
]);

export function isGenericTableViewerContent(
    content: TableViewerPaneContent,
): content is TableViewerGenericContent {
    return GENERIC_KINDS.has(content.kind);
}

export default function TableViewerContent({
    content,
    fit = false,
}: {
    content: TableViewerGenericContent;
    /** Fit to the container (right pane, grid cells): image sliders shrink
     * to it, plots use compact margins. */
    fit?: boolean;
}) {
    switch (content.kind) {
        case "text":
            return (
                <Box
                    component="pre"
                    sx={{
                        m: 0,
                        p: 2,
                        height: "100%",
                        overflow: "auto",
                        fontFamily:
                            "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
                        fontSize: "0.75rem",
                        lineHeight: 1.45,
                        whiteSpace: "pre-wrap",
                        wordBreak: "break-word",
                    }}
                >
                    {content.text}
                </Box>
            );
        case "html":
            return (
                <Box
                    sx={{ p: 2, overflow: "auto", height: "100%" }}
                    dangerouslySetInnerHTML={{ __html: content.html }}
                />
            );
        case "iframe":
            return (
                <Box
                    component="iframe"
                    src={content.src}
                    title={content.title ?? "Viewer"}
                    sx={{ border: 0, width: "100%", height: "100%", minHeight: 0 }}
                />
            );
        case "image":
            return (
                <Box
                    sx={{
                        p: 2,
                        height: "100%",
                        overflow: "auto",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                    }}
                >
                    <Box
                        component="img"
                        src={content.src}
                        alt={content.alt ?? content.title ?? "Preview"}
                        sx={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain" }}
                    />
                </Box>
            );
        case "plotly": {
            const backendLayout = (content.figure.layout ?? {}) as Record<string, unknown>;
            const backendMargin = (backendLayout.margin ?? {}) as Record<string, number>;
            return (
                <Box sx={{ p: 1, height: "100%", minHeight: 0 }}>
                    <Plot
                        data={(content.figure.data as any[]) ?? []}
                        layout={{
                            ...normalizeTitles(backendLayout),
                            autosize: true,
                            // Fitted (grid cells): small margins and font,
                            // so the plot area is not squeezed
                            margin: fit
                                ? {
                                    l: 52,
                                    r: 8,
                                    t: content.title ? 32 : 8,
                                    b: 40,
                                }
                                : {
                                    l: backendMargin.l ?? 72,
                                    r: backendMargin.r ?? 16,
                                    t: content.title ? 40 : (backendMargin.t ?? 16),
                                    b: backendMargin.b ?? 56,
                                },
                            ...(fit ? { font: { size: 10 } } : {}),
                            title: normalizeTitles({ title: content.title ?? backendLayout.title }).title,
                        }}
                        config={{
                            ...(content.figure.config as Record<string, unknown> | undefined),
                            responsive: true,
                            displaylogo: false,
                        }}
                        style={{ width: "100%", height: "100%" }}
                        useResizeHandler
                    />
                </Box>
            );
        }
        case "imageSlider":
            return (
                <Box sx={{ height: "100%", minHeight: 0 }}>
                    <ImageSlider content={content} fit={fit} />
                </Box>
            );
    }
}
