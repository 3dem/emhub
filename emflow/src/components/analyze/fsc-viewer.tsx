import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type RefObject,
} from "react";
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Divider,
  FormControlLabel,
  Paper,
  Stack,
  Switch,
  Typography,
} from "@mui/material";
import { useTheme as useMuiTheme } from "@mui/material/styles";
import { useProjectService } from "@/ProjectServiceContext";

type Id = string | number;

type FscViewerProps = {
  projectId: Id;
  protocolId: Id;
  outputName: string;
};

type FscRow = {
  label: string;
  resolution: number | null;
  x: number[];
  y: number[];
};

type SeriesPoint = {
  x: number;
  y: number;
};

type SeriesData = {
  key: string;
  label: string;
  resolution0143: number | null;
  points: SeriesPoint[];
};

const palette = [
  "#2563eb",
  "#dc2626",
  "#16a34a",
  "#d97706",
  "#7c3aed",
  "#0891b2",
  "#db2777",
  "#65a30d",
  "#ea580c",
  "#0f766e",
];

function getErrorMessage(error: unknown, fallbackMessage: string): string {
  if (typeof error === "object" && error && "message" in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string" && message.trim()) return message;
  }
  return fallbackMessage;
}

function formatNumber(value: number | null | undefined, digits = 3): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return value.toFixed(digits);
}

function formatResolution(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value) || value <= 0) return "—";
  if (value >= 100) return `${value.toFixed(0)} Å`;
  if (value >= 10) return `${value.toFixed(1)} Å`;
  return `${value.toFixed(2)} Å`;
}

function formatTickLabel(x: number): string {
  if (!Number.isFinite(x) || x <= 0) return "";
  const resolution = 1 / x;
  if (!Number.isFinite(resolution) || resolution > 999) return "";
  return resolution.toFixed(1);
}

function normalizeFscRowsPayload(payload: unknown): {
  rows: FscRow[];
  threshold: number;
} {
  const fallbackThreshold = 0.143;

  const rawRows = Array.isArray(payload)
    ? payload
    : Array.isArray((payload as { rows?: unknown[] } | null)?.rows)
      ? ((payload as { rows?: unknown[] }).rows ?? [])
      : [];

  const threshold =
    typeof (payload as { threshold?: unknown } | null)?.threshold === "number" &&
      Number.isFinite((payload as { threshold?: number }).threshold)
      ? Number((payload as { threshold?: number }).threshold)
      : fallbackThreshold;

  const rows: FscRow[] = rawRows
    .map((item, index) => {
      const labelRaw =
        typeof (item as { label?: unknown } | null)?.label === "string"
          ? String((item as { label?: string }).label)
          : `FSC ${index + 1}`;

      const resolutionRaw = (item as { resolution?: unknown } | null)?.resolution;
      const resolution =
        typeof resolutionRaw === "number" &&
          Number.isFinite(resolutionRaw) &&
          resolutionRaw > 0
          ? resolutionRaw
          : null;

      const xRaw = Array.isArray((item as { x?: unknown[] } | null)?.x)
        ? ((item as { x?: unknown[] }).x ?? [])
        : [];
      const yRaw = Array.isArray((item as { y?: unknown[] } | null)?.y)
        ? ((item as { y?: unknown[] }).y ?? [])
        : [];

      const n = Math.min(xRaw.length, yRaw.length);
      const x: number[] = [];
      const y: number[] = [];

      for (let i = 0; i < n; i += 1) {
        const xv = Number(xRaw[i]);
        const yv = Number(yRaw[i]);
        if (!Number.isFinite(xv) || !Number.isFinite(yv)) continue;
        x.push(xv);
        y.push(yv);
      }

      if (!x.length) return null;

      return {
        label: labelRaw.trim() || `FSC ${index + 1}`,
        resolution,
        x,
        y,
      } satisfies FscRow;
    })
    .filter((item): item is FscRow => item !== null);

  return { rows, threshold };
}

function buildSeries(rows: FscRow[]): SeriesData[] {
  return rows
    .map((row, index) => {
      const n = Math.min(row.x.length, row.y.length);
      const points: SeriesPoint[] = [];

      for (let i = 0; i < n; i += 1) {
        const x = Number(row.x[i]);
        const y = Number(row.y[i]);
        if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
        points.push({ x, y });
      }

      points.sort((a, b) => a.x - b.x);

      return {
        key: `${index}-${row.label}`,
        label: row.label,
        resolution0143: row.resolution,
        points,
      } satisfies SeriesData;
    })
    .filter((series) => series.points.length > 0);
}

function buildPolyline(
  points: SeriesPoint[],
  mapX: (x: number) => number,
  mapY: (y: number) => number,
): string {
  return points.map((point) => `${mapX(point.x)},${mapY(point.y)}`).join(" ");
}

function buildTicks(minValue: number, maxValue: number, count: number): number[] {
  if (!Number.isFinite(minValue) || !Number.isFinite(maxValue)) return [];
  if (minValue === maxValue) return [minValue];

  const ticks: number[] = [];
  const step = (maxValue - minValue) / Math.max(1, count - 1);

  for (let index = 0; index < count; index += 1) {
    ticks.push(minValue + step * index);
  }

  return ticks;
}

function estimateThresholdCrossingFrequency(
  points: SeriesPoint[],
  threshold: number,
): number | null {
  if (points.length < 2) return null;

  for (let index = 1; index < points.length; index += 1) {
    const prev = points[index - 1];
    const curr = points[index];

    const prevDelta = prev.y - threshold;
    const currDelta = curr.y - threshold;

    if (prevDelta === 0) return prev.x;
    if (currDelta === 0) return curr.x;

    if ((prevDelta > 0 && currDelta < 0) || (prevDelta < 0 && currDelta > 0)) {
      const denom = curr.y - prev.y;
      if (!Number.isFinite(denom) || denom === 0) return curr.x;
      const t = (threshold - prev.y) / denom;
      return prev.x + t * (curr.x - prev.x);
    }
  }

  return null;
}

function getDisplayedResolution(series: SeriesData, threshold: number): number | null {
  if (Math.abs(threshold - 0.143) < 1e-9 && series.resolution0143) {
    return series.resolution0143;
  }

  const frequency = estimateThresholdCrossingFrequency(series.points, threshold);
  if (frequency == null || !Number.isFinite(frequency) || frequency <= 0) return null;
  return 1 / frequency;
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}

async function svgToPngBlob(svgElement: SVGSVGElement, outWidth = 2000): Promise<Blob> {
  const serializer = new XMLSerializer();
  const svgString = serializer.serializeToString(svgElement);

  const viewBox = svgElement.viewBox.baseVal;
  const sourceWidth = viewBox?.width || 1000;
  const sourceHeight = viewBox?.height || 520;
  const outHeight = Math.round((outWidth / sourceWidth) * sourceHeight);

  const svgBlob = new Blob([svgString], {
    type: "image/svg+xml;charset=utf-8",
  });
  const svgUrl = URL.createObjectURL(svgBlob);

  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error("Failed to render SVG"));
      img.src = svgUrl;
    });

    const canvas = document.createElement("canvas");
    canvas.width = outWidth;
    canvas.height = outHeight;

    const ctx = canvas.getContext("2d");
    if (!ctx) {
      throw new Error("Canvas context is not available");
    }

    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, outWidth, outHeight);
    ctx.drawImage(image, 0, 0, outWidth, outHeight);

    const blob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob((value) => resolve(value), "image/png");
    });

    if (!blob) {
      throw new Error("Failed to create PNG blob");
    }

    return blob;
  } finally {
    URL.revokeObjectURL(svgUrl);
  }
}

function FscPlot({
  svgRef,
  seriesList,
  visibleKeys,
  threshold0143,
  show0143,
}: {
  svgRef: RefObject<SVGSVGElement | null>;
  seriesList: SeriesData[];
  visibleKeys: Set<string>;
  threshold0143: number;
  show0143: boolean;
}) {

  const theme = useMuiTheme();
  const plotBg = theme.palette.background.paper;
  const gridColor = theme.palette.divider;
  const textColor = theme.palette.text.secondary;
  const axisColor = theme.palette.text.primary;
  const primaryColor = theme.palette.primary.main;

  const width = 1000;
  const height = 520;
  const margin = { top: 24, right: 24, bottom: 52, left: 68 };
  const innerWidth = width - margin.left - margin.right;
  const innerHeight = height - margin.top - margin.bottom;

  const visibleSeries = seriesList.filter((series) => visibleKeys.has(series.key));
  const domainSeries = visibleSeries.length ? visibleSeries : seriesList;

  const allX = domainSeries.flatMap((series) => series.points.map((point) => point.x));
  const allY = domainSeries.flatMap((series) => series.points.map((point) => point.y));

  const minX = Math.min(...allX);
  const maxX = Math.max(...allX);

  const domainXMin = Number.isFinite(minX) ? minX : 0;
  const domainXMax = Number.isFinite(maxX) && maxX > domainXMin ? maxX : domainXMin + 1;

  const rawMinY = allY.length ? Math.min(...allY) : 0;
  const rawMaxY = allY.length ? Math.max(...allY) : 1;

  const domainYMin =
    rawMinY < 0 ? Math.max(-0.25, Math.floor((rawMinY - 0.02) * 20) / 20) : 0;
  const domainYMax = Math.max(1.0, Math.ceil((rawMaxY + 0.02) * 20) / 20);

  const mapX = (x: number) =>
    margin.left + ((x - domainXMin) / (domainXMax - domainXMin)) * innerWidth;

  const mapY = (y: number) =>
    margin.top + (1 - (y - domainYMin) / (domainYMax - domainYMin)) * innerHeight;

  const xTicks = buildTicks(domainXMin, domainXMax, 7);

  const yTicksBase = buildTicks(domainYMin, domainYMax, 6);
  const yTicks = Array.from(
    new Set(
      [
        ...yTicksBase,
        show0143 ? threshold0143 : null,
      ]
        .filter((value): value is number => value != null && Number.isFinite(value))
        .map((value) => Number(value.toFixed(3))),
    ),
  ).sort((a, b) => a - b);

  const legendSeries = visibleSeries;
  const legendWidth = 220;
  const legendItemHeight = 18;
  const legendHeight = Math.max(38, 16 + legendSeries.length * legendItemHeight + 10);
  const legendX = width - margin.right - legendWidth;
  const legendY = margin.top + 8;

  return (
    <Box sx={{ width: "100%", height: "100%", minHeight: 420 }}>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${width} ${height}`}
        width="100%"
        height="100%"
        preserveAspectRatio="none"
      >
        <rect x={0} y={0} width={width} height={height} fill={plotBg} />

        {yTicks.map((tick) => {
          const isThreshold = Math.abs(tick - threshold0143) < 1e-9;

          return (
            <g key={`y-${tick}`}>
              <line
                x1={margin.left}
                y1={mapY(tick)}
                x2={width - margin.right}
                y2={mapY(tick)}
                stroke={isThreshold ? "#cbd5e1" : "#e2e8f0"}
                strokeDasharray={isThreshold ? "6 4" : "3 3"}
              />
              <text
                x={margin.left - 10}
                y={mapY(tick) + 4}
                fontSize="12"
                textAnchor="end"
                fill={textColor}
              >
                {tick.toFixed(3).replace(/0+$/, "").replace(/\.$/, "")}
              </text>
            </g>
          );
        })}

        {xTicks.map((tick) => (
          <g key={`x-${tick}`}>
            <line
              x1={mapX(tick)}
              y1={margin.top}
              x2={mapX(tick)}
              y2={height - margin.bottom}
              stroke={gridColor}
              strokeDasharray="3 3"
            />
            <text
              x={mapX(tick)}
              y={height - margin.bottom + 20}
              fontSize="12"
              textAnchor="middle"
              fill={textColor}
            >
              {formatTickLabel(tick)}
            </text>
          </g>
        ))}

        <line
          x1={margin.left}
          y1={height - margin.bottom}
          x2={width - margin.right}
          y2={height - margin.bottom}
          stroke={axisColor}
          strokeWidth="1.5"
        />
        <line
          x1={margin.left}
          y1={margin.top}
          x2={margin.left}
          y2={height - margin.bottom}
          stroke={axisColor}
          strokeWidth="1.5"
        />

        {show0143 && (
          <>
            <line
              x1={margin.left}
              y1={mapY(threshold0143)}
              x2={width - margin.right}
              y2={mapY(threshold0143)}
              stroke={primaryColor}
              strokeWidth="1.5"
              strokeDasharray="8 6"
            />
            <text
              x={width - margin.right - 6}
              y={mapY(threshold0143) - 6}
              fontSize="11"
              textAnchor="end"
              fill={primaryColor}
            >
              {threshold0143.toFixed(3)}
            </text>
          </>
        )}

        {visibleSeries.map((series, index) => (
          <polyline
            key={series.key}
            fill="none"
            stroke={palette[index % palette.length]}
            strokeWidth="2.5"
            points={buildPolyline(series.points, mapX, mapY)}
          />
        ))}

        <g transform={`translate(${legendX}, ${legendY})`}>
          <rect
            x={0}
            y={0}
            width={legendWidth}
            height={legendHeight}
            rx={8}
            ry={8}
            fill={plotBg}
            stroke={gridColor}
          />
          {legendSeries.length === 0 ? (
            <text x={12} y={24} fontSize="12" fill={textColor}>
              No visible curves
            </text>
          ) : (
            legendSeries.map((series, index) => {
              const resolutionText = formatResolution(series.resolution0143);
              return (
                <g
                  key={`legend-${series.key}`}
                  transform={`translate(10, ${18 + index * legendItemHeight})`}
                >
                  <line
                    x1={0}
                    y1={-4}
                    x2={18}
                    y2={-4}
                    stroke={palette[index % palette.length]}
                    strokeWidth="2.5"
                  />
                  <text x={24} y={0} fontSize="12" stroke={axisColor}>
                    {`${series.label} (${resolutionText})`}
                  </text>
                </g>
              );
            })
          )}
        </g>

        <text
          x={(margin.left + width - margin.right) / 2}
          y={height - 12}
          fontSize="13"
          textAnchor="middle"
          stroke={axisColor}
        >
          Resolution (Å)
        </text>

        <text
          transform={`translate(18 ${(margin.top + height - margin.bottom) / 2}) rotate(-90)`}
          fontSize="13"
          textAnchor="middle"
          fill={axisColor}
        >
          FSC
        </text>
      </svg>
    </Box>
  );
}

function FscViewer({ projectId, protocolId, outputName }: FscViewerProps) {
  const svc = useProjectService();
  const svgRef = useRef<SVGSVGElement | null>(null);

  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [rows, setRows] = useState<FscRow[]>([]);
  const [threshold0143, setThreshold0143] = useState(0.143);
  const [show0143, setShow0143] = useState(true);
  const [hiddenKeys, setHiddenKeys] = useState<string[]>([]);
  const [downloading, setDownloading] = useState<"png" | "svg" | null>(null);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        setLoading(true);
        setErrorMessage(null);

        const payload = await svc.fetchFscRows(projectId, protocolId, outputName);
        const normalized = normalizeFscRowsPayload(payload);

        if (cancelled) return;

        setRows(normalized.rows);
        setThreshold0143(normalized.threshold);
      } catch (error) {
        if (cancelled) return;
        setRows([]);
        setThreshold0143(0.143);
        setErrorMessage(getErrorMessage(error, "Failed to load FSC rows."));
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [svc, projectId, protocolId, outputName]);

  const seriesList = useMemo(() => buildSeries(rows), [rows]);

  useEffect(() => {
    setHiddenKeys((current) =>
      current.filter((key) => seriesList.some((series) => series.key === key)),
    );
  }, [seriesList]);

  const visibleKeys = useMemo(() => {
    const hidden = new Set(hiddenKeys);
    return new Set(
      seriesList.filter((series) => !hidden.has(series.key)).map((series) => series.key),
    );
  }, [hiddenKeys, seriesList]);

  const totalPoints = useMemo(() => {
    return rows.reduce((acc, row) => acc + Math.min(row.x.length, row.y.length), 0);
  }, [rows]);

  const visibleCount = visibleKeys.size;

  const estimates = useMemo(() => {
    return seriesList.map((series) => ({
      key: series.key,
      label: series.label,
      at0143: getDisplayedResolution(series, threshold0143),
      resolution0143: series.resolution0143,
      points: series.points.length,
      visible: visibleKeys.has(series.key),
    }));
  }, [seriesList, threshold0143, visibleKeys]);

  const toggleSeries = useCallback((key: string) => {
    setHiddenKeys((current) =>
      current.includes(key)
        ? current.filter((item) => item !== key)
        : [...current, key],
    );
  }, []);

  const showAll = useCallback(() => {
    setHiddenKeys([]);
  }, []);

  const hideAll = useCallback(() => {
    setHiddenKeys(seriesList.map((series) => series.key));
  }, [seriesList]);

  const showOnly = useCallback((key: string) => {
    setHiddenKeys(seriesList.filter((series) => series.key !== key).map((series) => series.key));
  }, [seriesList]);

  const downloadSvg = useCallback(async () => {
    if (!svgRef.current) return;

    try {
      setDownloading("svg");
      const serializer = new XMLSerializer();
      const svgString = serializer.serializeToString(svgRef.current);
      const blob = new Blob([svgString], {
        type: "image/svg+xml;charset=utf-8",
      });
      downloadBlob(blob, `${outputName || "fsc"}-plot.svg`);
    } finally {
      setDownloading(null);
    }
  }, [outputName]);

  const downloadPng = useCallback(async () => {
    if (!svgRef.current) return;

    try {
      setDownloading("png");
      const blob = await svgToPngBlob(svgRef.current, 2200);
      downloadBlob(blob, `${outputName || "fsc"}-plot.png`);
    } finally {
      setDownloading(null);
    }
  }, [outputName]);

  if (loading) {
    return (
      <Box sx={{ height: "100%", display: "grid", placeItems: "center" }}>
        <Stack spacing={1} alignItems="center">
          <CircularProgress size={28} />
          <Typography variant="body2" color="text.secondary">
            Loading FSC viewer...
          </Typography>
        </Stack>
      </Box>
    );
  }

  if (errorMessage) {
    return (
      <Box sx={{ p: 2 }}>
        <Alert severity="error">{errorMessage}</Alert>
      </Box>
    );
  }

  if (!rows.length) {
    return (
      <Box sx={{ p: 2 }}>
        <Alert severity="info">No FSC curves were returned for this output.</Alert>
      </Box>
    );
  }

  if (!seriesList.length) {
    return (
      <Box sx={{ p: 2 }}>
        <Alert severity="warning">The FSC rows could not be plotted.</Alert>
      </Box>
    );
  }

  return (
    <Box
      sx={{
        height: "100%",
        minHeight: 0,
        display: "grid",
        gridTemplateColumns: { xs: "1fr", lg: "1fr 340px" },
        gap: 1.5,
        p: 1.5,
        bgcolor: "background.default",
      }}
    >
      <Paper
        variant="outlined"
        sx={{
          minHeight: 0,
          display: "flex",
          flexDirection: "column",
          borderRadius: 2,
          overflow: "hidden",
        }}
      >
        <Box
          sx={{
            px: 1.5,
            py: 1.25,
            borderBottom: "1px solid",
            borderColor: "divider",
            display: "flex",
            flexWrap: "wrap",
            gap: 1,
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap">
            <Typography variant="subtitle2" sx={{ fontWeight: 700, mr: 1 }}>
              FSC curves
            </Typography>

            <Chip size="small" label={`${visibleCount}/${seriesList.length} visible`} />
            <Chip size="small" label={`${totalPoints} points`} />
            <Chip size="small" variant="outlined" label={`Threshold ${threshold0143.toFixed(3)}`} />
          </Stack>

          <Stack direction="row" spacing={1}>
            <Button size="small" variant="outlined" onClick={downloadSvg} disabled={downloading !== null}>
              {downloading === "svg" ? "Exporting..." : "SVG"}
            </Button>
            <Button size="small" variant="outlined" onClick={downloadPng} disabled={downloading !== null}>
              {downloading === "png" ? "Exporting..." : "PNG"}
            </Button>
          </Stack>
        </Box>

        <Box sx={{ flex: 1, minHeight: 420, p: 1 }}>
          <FscPlot
            svgRef={svgRef}
            seriesList={seriesList}
            visibleKeys={visibleKeys}
            threshold0143={threshold0143}
            show0143={show0143}
          />
        </Box>
      </Paper>

      <Paper
        variant="outlined"
        sx={{
          minHeight: 0,
          display: "flex",
          flexDirection: "column",
          borderRadius: 2,
          overflow: "hidden",
        }}
      >
        <Box sx={{ p: 1.5, borderBottom: "1px solid", borderColor: "divider" }}>
          <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
            Controls
          </Typography>
        </Box>

        <Box sx={{ p: 1.5, overflow: "auto", minHeight: 0 }}>
          <Stack spacing={1.5}>
            <FormControlLabel
              control={
                <Switch
                  checked={show0143}
                  onChange={(event) => setShow0143(event.target.checked)}
                />
              }
              label={`Show ${threshold0143.toFixed(3)} threshold`}
            />

            <Stack direction="row" spacing={1}>
              <Button size="small" variant="outlined" onClick={showAll}>
                Show all
              </Button>
              <Button size="small" variant="outlined" onClick={hideAll}>
                Hide all
              </Button>
            </Stack>

            <Divider />

            <Stack spacing={1}>
              {estimates.map((item, index) => (
                <Paper
                  key={item.key}
                  variant="outlined"
                  sx={{
                    p: 1,
                    borderRadius: 1.5,
                    bgcolor: item.visible ? "background.paper" : "action.hover",
                  }}
                >
                  <Stack spacing={1}>
                    <Stack direction="row" spacing={1} alignItems="center">
                      <Box
                        sx={{
                          width: 10,
                          height: 10,
                          borderRadius: "999px",
                          bgcolor: palette[index % palette.length],
                          flex: "0 0 auto",
                        }}
                      />
                      <Typography
                        variant="body2"
                        sx={{ fontWeight: 700, flex: 1, minWidth: 0 }}
                        noWrap
                        title={item.label}
                      >
                        {item.label}
                      </Typography>
                    </Stack>

                    <Stack direction="row" spacing={1} flexWrap="wrap">
                      <Chip size="small" label={formatResolution(item.at0143)} />
                      <Chip size="small" variant="outlined" label={`${item.points} pts`} />
                    </Stack>

                    <Stack direction="row" spacing={1} alignItems="center">
                      <FormControlLabel
                        sx={{ m: 0 }}
                        control={
                          <Switch
                            checked={item.visible}
                            onChange={() => toggleSeries(item.key)}
                            size="small"
                          />
                        }
                        label={
                          <Typography variant="caption">
                            {item.visible ? "Visible" : "Hidden"}
                          </Typography>
                        }
                      />
                      <Button
                        size="small"
                        variant="text"
                        onClick={() => showOnly(item.key)}
                      >
                        Only
                      </Button>
                    </Stack>
                  </Stack>
                </Paper>
              ))}
            </Stack>

            <Typography variant="caption" color="text.secondary">
              X axis is always displayed as resolution (Å), while the plot spacing still uses the original spatial frequency values.
            </Typography>
          </Stack>
        </Box>
      </Paper>
    </Box>
  );
}

export default memo(FscViewer);