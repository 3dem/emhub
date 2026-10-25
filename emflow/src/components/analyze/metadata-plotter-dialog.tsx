// src/components/analyze/MetadataPlotterDialog.tsx
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MutableRefObject,
  type MouseEvent as ReactMouseEvent,
} from "react";
import {
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  FormControl,
  FormControlLabel,
  IconButton,
  InputLabel,
  MenuItem,
  Paper,
  Radio,
  RadioGroup,
  Select,
  Slider,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import {
  Plus,
  BarChart3,
  ScatterChart as ScatterChartIcon,
  LineChart as LineChartIcon,
  Trash2,
  Check,
} from "lucide-react";
import {
  ResponsiveContainer,
  LineChart as ReLineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RechartsTooltip,
  BarChart as ReBarChart,
  Bar,
  ScatterChart as ReScatterChart,
  Scatter,
  ReferenceArea,
  Customized,
} from "recharts";

import type { MetadataCell, MetadataColumn, MetadataRow, MetadataTableSchema } from "@/types/metadata";
import { CloseIcon } from "@/icons";

type RowId = string | number;

type PlotType = "plot" | "histogram" | "scatter";
type AxisKey = "__rowIndex__" | string;

type ImageFreeBackdrop = {
  sx: Record<string, any>;
};

type MetadataWindowResponse = MetadataRow[] | { rows?: MetadataRow[]; offset?: number };

type ProjectServiceLike = {
  fetchMetadataTableWindow: (
    projectId: number,
    protocolId: number,
    outputName: string,
    tableName: string,
    params: {
      offset: number;
      limit: number;
      selectionOnly: boolean;
      sortBy?: string;
      asc?: boolean;
    },
  ) => Promise<MetadataWindowResponse>;
  runMetadataTableAction: (
    projectId: number,
    protocolId: number,
    outputName: string,
    tableName: string,
    body: {
      action: string;
      subsetName: string;
      ids: Array<string | number>;
    },
  ) => Promise<any>;
};

type PlotRow = {
  rowId: RowId;
  rowIndex: number;
  values: Record<string, number | null>;
};

type PolygonPoint = { x: number; y: number };
type Domain = { min: number; max: number };
type ChartOffset = { left: number; top: number; width: number; height: number };

type MetadataPlotterDialogProps = {
  open: boolean;
  onClose: () => void;

  projectId: number;
  protocolId: number;
  outputName: string;
  selectedTable: string;

  schema: MetadataTableSchema | null;
  totalRows: number;

  allColumns: MetadataColumn[];
  schemaActions: string[];

  sortBy: string | null;
  sortAsc: boolean;

  svcRef: MutableRefObject<ProjectServiceLike>;

  isRowSelectedInViewer: (rowIndex: number, rowId: RowId | null) => boolean;
  viewerSelectedCount: number;
};

function parseWindowResponse(
  response: MetadataWindowResponse,
): { rows: MetadataRow[]; offset?: number } {
  if (Array.isArray(response)) return { rows: response };
  return {
    rows: Array.isArray(response.rows) ? response.rows : [],
    offset: typeof response.offset === "number" ? response.offset : undefined,
  };
}

function normalizeRowId(raw: unknown): RowId | null {
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : null;
  if (typeof raw === "string") {
    const s = raw.trim();
    if (!s) return null;
    if (/^-?\d+$/.test(s)) {
      const n = Number(s);
      if (Number.isSafeInteger(n)) return n;
    }
    return s;
  }
  return null;
}

function resolveRowId(schema: MetadataTableSchema | null, row: MetadataRow): RowId | null {
  // preferBackendRowIdIfPresent
  const backendRowId = normalizeRowId((row as any)?.rowId);
  if (backendRowId != null) return backendRowId;

  // fallbackIdColumn
  if (schema) {
    const columns = (schema.columns ?? []) as MetadataColumn[];
    const idColumn =
      columns.find((c) => c.name === "id") ??
      columns.find((c) => (c.name || "").toLowerCase() === "id");
    if (idColumn) {
      const candidate = row.values?.[idColumn.index];
      const normalized = normalizeRowId(candidate);
      if (normalized != null) return normalized;
    }
  }

  return normalizeRowId((row as any)?.id);
}

function tryCellToNumber(cell: MetadataCell): number | null {
  if (cell === null || cell === undefined) return null;
  if (typeof cell === "number") return Number.isFinite(cell) ? cell : null;
  if (typeof cell === "boolean") return cell ? 1 : 0;

  if (typeof cell === "string") {
    const s = cell.trim();
    if (!s) return null;
    const n = Number(s.replace(",", "."));
    return Number.isFinite(n) ? n : null;
  }

  return null;
}

function isXAxisEligibleColumn(col: MetadataColumn): boolean {
  const rt = String((col as any).rendererType || "").toLowerCase();
  return rt === "int" || rt === "float" || rt === "double" || rt === "number";
}

function isPlotEligibleColumn(col: MetadataColumn): boolean {
  const rt = String((col as any).rendererType || "").toLowerCase();
  return rt === "int" || rt === "float" || rt === "double" || rt === "number" || rt === "bool";
}

function clampRange(minValue: number, maxValue: number, a: number, b: number): [number, number] {
  const lo = Math.max(minValue, Math.min(a, b));
  const hi = Math.min(maxValue, Math.max(a, b));
  return [lo, hi];
}

function isPointInPolygon(point: PolygonPoint, polygon: PolygonPoint[]): boolean {
  // pointInPolygonRayCasting
  if (polygon.length < 3) return false;

  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].x;
    const yi = polygon[i].y;
    const xj = polygon[j].x;
    const yj = polygon[j].y;

    const intersect =
      yi > point.y !== yj > point.y &&
      point.x < ((xj - xi) * (point.y - yi)) / (yj - yi + 1e-12) + xi;

    if (intersect) inside = !inside;
  }

  return inside;
}

function buildHistogram(values: Array<{ rowId: RowId; v: number }>, binCount: number) {
  if (values.length === 0) {
    return {
      bins: [] as Array<{ binStart: number; binEnd: number; binMid: number; count: number }>,
      min: 0,
      max: 1,
    };
  }

  let min = values[0].v;
  let max = values[0].v;
  for (const item of values) {
    min = Math.min(min, item.v);
    max = Math.max(max, item.v);
  }
  if (min === max) max = min + 1;

  const safeBinCount = Math.max(5, Math.min(200, binCount));
  const binWidth = (max - min) / safeBinCount;

  const counts = new Array(safeBinCount).fill(0) as number[];
  for (const item of values) {
    const idx = Math.min(safeBinCount - 1, Math.max(0, Math.floor((item.v - min) / binWidth)));
    counts[idx] += 1;
  }

  const bins = counts.map((count, idx) => {
    const binStart = min + idx * binWidth;
    const binEnd = binStart + binWidth;
    const binMid = (binStart + binEnd) / 2;
    return { binStart, binEnd, binMid, count };
  });

  return { bins, min, max };
}

function formatNumberCompact(v: number) {
  if (!Number.isFinite(v)) return "";
  if (Math.abs(v) >= 1e6) return v.toExponential(2);
  if (Math.abs(v) >= 1000) return v.toFixed(0);
  if (Math.abs(v) >= 10) return v.toFixed(2);
  return v.toFixed(4);
}

function PlotTypeIcon({ plotType }: { plotType: PlotType }) {
  if (plotType === "histogram") return <BarChart3 size={16} />;
  if (plotType === "scatter") return <ScatterChartIcon size={16} />;
  return <LineChartIcon size={16} />;
}

function padDomain(domain: Domain, ratio: number): Domain {
  // padDomainByRatio
  const span = domain.max - domain.min;
  if (!Number.isFinite(span) || Math.abs(span) < 1e-12) {
    return { min: domain.min - 1, max: domain.max + 1 };
  }
  const pad = span * ratio;
  return { min: domain.min - pad, max: domain.max + pad };
}

function mapValueToPx(params: {
  value: number;
  domain: Domain;
  plotStart: number;
  plotSize: number;
  invert?: boolean;
}): number | null {
  // mapValueToPx
  const { value, domain, plotStart, plotSize, invert } = params;

  const den = domain.max - domain.min;
  if (!Number.isFinite(den) || Math.abs(den) < 1e-12) return null;

  const tRaw = (value - domain.min) / den;
  const t = Math.max(0, Math.min(1, tRaw));

  if (invert) return plotStart + (1 - t) * plotSize;
  return plotStart + t * plotSize;
}

function ChartOffsetProbe(props: { onOffset: (offset: ChartOffset | null) => void }) {
  const { onOffset } = props;

  return (
    <Customized
      component={(chartProps: any) => {
        const off = chartProps?.offset as ChartOffset | undefined;

        if (
          off &&
          typeof off.left === "number" &&
          typeof off.top === "number" &&
          typeof off.width === "number" &&
          typeof off.height === "number" &&
          Number.isFinite(off.left) &&
          Number.isFinite(off.top) &&
          Number.isFinite(off.width) &&
          Number.isFinite(off.height) &&
          off.width > 0 &&
          off.height > 0
        ) {
          onOffset(off);
        } else {
          onOffset(null);
        }

        return null;
      }}
    />
  );
}


function readChartOffsetFromDom(host: HTMLElement | null): ChartOffset | null {
  // readChartOffsetFromDomViaLargestClipRect
  if (!host) return null;

  const svg = host.querySelector("svg.recharts-surface") as SVGSVGElement | null;
  if (!svg) return null;

  const rects = Array.from(svg.querySelectorAll("defs clipPath rect")) as SVGRectElement[];
  if (rects.length === 0) return null;

  let best: ChartOffset | null = null;
  let bestArea = 0;

  for (const r of rects) {
    const x = Number(r.getAttribute("x"));
    const y = Number(r.getAttribute("y"));
    const w = Number(r.getAttribute("width"));
    const h = Number(r.getAttribute("height"));

    if (![x, y, w, h].every(Number.isFinite)) continue;
    if (w <= 0 || h <= 0) continue;

    const area = w * h;
    if (area > bestArea) {
      bestArea = area;
      best = { left: x, top: y, width: w, height: h };
    }
  }

  return best;
}

function ScatterLassoOverlay(props: {
  xDomain: Domain | null;
  yDomain: Domain | null;
  offset: ChartOffset | null;

  data: Array<{ rowId: RowId; x: number; y: number }>;

  polygon: PolygonPoint[];
  polygonClosed: boolean;

  onAddPoint: (p: PolygonPoint) => void;
  onClosePolygon: () => void;
  onClear: () => void;

  onSelectionPreview: (rowIds: Array<RowId>) => void;

  chartHostRef: MutableRefObject<HTMLDivElement | null>;
}) {
  const {
    xDomain,
    yDomain,
    offset,
    data,
    polygon,
    polygonClosed,
    onAddPoint,
    onClosePolygon,
    onClear,
    onSelectionPreview,
  } = props;

  const svgRef = useRef<SVGSVGElement | null>(null);
  const rafRef = useRef<number | null>(null);

  const polygonPath = useMemo(() => {
    if (polygon.length === 0) return "";
    const head = `M ${polygon[0].x} ${polygon[0].y}`;
    const tail = polygon
      .slice(1)
      .map((p) => `L ${p.x} ${p.y}`)
      .join(" ");
    return `${head} ${tail} ${polygonClosed ? "Z" : ""}`.trim();
  }, [polygon, polygonClosed]);

  const computeSelectionPreview = useCallback(() => {
    // computeSelectionPreviewFromRenderedPoints
    if (polygon.length < 3) {
      onSelectionPreview([]);
      return;
    }

    const overlaySvg = svgRef.current;
    const host = props.chartHostRef.current;

    if (!overlaySvg || !host) {
      onSelectionPreview([]);
      return;
    }

    const overlayRect = overlaySvg.getBoundingClientRect();
    const chartSvg = host.querySelector("svg.recharts-surface") as SVGSVGElement | null;

    if (!chartSvg) {
      onSelectionPreview([]);
      return;
    }

    const ctm = chartSvg.getScreenCTM();
    if (!ctm) {
      onSelectionPreview([]);
      return;
    }

    const circles = chartSvg.querySelectorAll("circle[data-row-id]");
    if (circles.length === 0) {
      onSelectionPreview([]);
      return;
    }

    const pt = chartSvg.createSVGPoint();
    const selected: RowId[] = [];

    circles.forEach((node) => {
      const el = node as SVGCircleElement;

      const idRaw = el.getAttribute("data-row-id");
      const rowId = normalizeRowId(idRaw);
      if (rowId == null) return;

      const cx = Number(el.getAttribute("cx"));
      const cy = Number(el.getAttribute("cy"));
      if (!Number.isFinite(cx) || !Number.isFinite(cy)) return;

      pt.x = cx;
      pt.y = cy;

      const sp = pt.matrixTransform(ctm);
      const x = sp.x - overlayRect.left;
      const y = sp.y - overlayRect.top;

      if (isPointInPolygon({ x, y }, polygon)) {
        selected.push(rowId);
      }
    });

    onSelectionPreview(Array.from(new Set(selected)));
  }, [onSelectionPreview, polygon, props.chartHostRef]);

  useEffect(() => {
    // throttleSelectionPreviewToAnimationFrame
    if (rafRef.current != null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }

    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      computeSelectionPreview();
    });

    return () => {
      if (rafRef.current != null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, [computeSelectionPreview]);

  const isInsidePlot = useCallback(
    (p: { x: number; y: number }) => {
      if (!offset) return true;
      return (
        p.x >= offset.left &&
        p.x <= offset.left + offset.width &&
        p.y >= offset.top &&
        p.y <= offset.top + offset.height
      );
    },
    [offset],
  );

  const getLocalPoint = useCallback((event: ReactMouseEvent) => {
    // getLocalPoint
    const svg = svgRef.current;
    if (!svg) return null;

    const rect = svg.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;

    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    return { x, y };
  }, []);

  const handlePointerDown = useCallback(
    (event: ReactMouseEvent<SVGRectElement>) => {
      // handlePointerDownAddPoint
      event.preventDefault();
      event.stopPropagation();

      if (polygonClosed) return;

      const p = getLocalPoint(event);
      if (!p) return;
      if (!isInsidePlot(p)) return;

      if (polygon.length >= 3) {
        const first = polygon[0];
        const dx = p.x - first.x;
        const dy = p.y - first.y;

        // closePolygonIfClickNearFirstPoint
        if (Math.hypot(dx, dy) <= 10) {
          onClosePolygon();
          return;
        }
      }

      onAddPoint(p);
    },
    [getLocalPoint, isInsidePlot, onAddPoint, onClosePolygon, polygon, polygonClosed],
  );

  const handleDoubleClick = useCallback(
    (event: ReactMouseEvent<SVGRectElement>) => {
      // handleDoubleClickClose
      event.preventDefault();
      event.stopPropagation();
      if (polygonClosed) return;
      if (polygon.length >= 3) onClosePolygon();
    },
    [onClosePolygon, polygon.length, polygonClosed],
  );

  return (
    <Box sx={{ position: "absolute", inset: 0, zIndex: 10, pointerEvents: "auto" }}>
      <svg ref={svgRef} width="100%" height="100%" style={{ display: "block" }}>
        <rect
          x={0}
          y={0}
          width="100%"
          height="100%"
          fill="transparent"
          pointerEvents="all"
          onMouseDown={handlePointerDown}
          onDoubleClick={handleDoubleClick}
          style={{ cursor: polygonClosed ? "default" : "crosshair" }}
        />

        {polygonPath && (
          <path
            d={polygonPath}
            fill={polygonClosed ? "rgba(148,163,184,0.22)" : "rgba(148,163,184,0.08)"}
            stroke="rgba(51,65,85,0.9)"
            strokeWidth={2}
            pointerEvents="none"
          />
        )}

        {polygon.map((p, idx) => (
          <circle
            key={`${idx}-${p.x}-${p.y}`}
            cx={p.x}
            cy={p.y}
            r={4}
            fill={idx === 0 ? "rgba(37,99,235,0.95)" : "rgba(15,23,42,0.85)"}
            pointerEvents="none"
          />
        ))}
      </svg>

      {/* Hidden action hooks (kept for keyboard wiring if you add later) */}
      <Box sx={{ display: "none" }}>
        <Button onClick={onClear} />
      </Box>
    </Box>
  );
}

export function MetadataPlotterDialog(props: MetadataPlotterDialogProps) {
  const {
    open,
    onClose,
    projectId,
    protocolId,
    outputName,
    selectedTable,
    schema,
    totalRows,
    allColumns,
    schemaActions,
    sortBy,
    sortAsc,
    svcRef,
    isRowSelectedInViewer,
    viewerSelectedCount,
  } = props;

  const xAxisCandidates = useMemo(() => allColumns.filter(isXAxisEligibleColumn), [allColumns]);
  const plotEligibleColumns = useMemo(() => allColumns.filter(isPlotEligibleColumn), [allColumns]);

  const [plotType, setPlotType] = useState<PlotType>("plot");
  const [xAxisKey, setXAxisKey] = useState<AxisKey>("__rowIndex__");
  const [limitRowsText, setLimitRowsText] = useState("100000");
  const [respectSelection, setRespectSelection] = useState(false);

  const [selectedSeries, setSelectedSeries] = useState<Set<string>>(() => new Set());

  const [plotRows, setPlotRows] = useState<PlotRow[]>([]);
  const [plotLoading, setPlotLoading] = useState(false);
  const [plotError, setPlotError] = useState<string | null>(null);

  const [selectionAxis, setSelectionAxis] = useState<"x" | "y">("y");
  const [selectionYKey, setSelectionYKey] = useState<string>("");

  const [selectionRange, setSelectionRange] = useState<[number, number] | null>(null);
  const [selectedFromPlot, setSelectedFromPlot] = useState<RowId[]>([]);

  const [lassoPolygon, setLassoPolygon] = useState<PolygonPoint[]>([]);
  const [lassoClosed, setLassoClosed] = useState(false);

  const [subsetName, setSubsetName] = useState("plot subset");
  const [subsetSubmitting, setSubsetSubmitting] = useState(false);
  const [subsetError, setSubsetError] = useState<string | null>(null);

  const [chartOffset, setChartOffset] = useState<ChartOffset | null>(null);
  const lastOffsetRef = useRef<ChartOffset | null>(null);

  const chartHostRef = useRef<HTMLDivElement | null>(null);

  const loadEpochRef = useRef(0);

  const plotterBackdropProps: ImageFreeBackdrop = useMemo(
    () => ({ sx: { backgroundColor: "transparent" } }),
    [],
  );

  const selectedSeriesArray = useMemo(() => Array.from(selectedSeries), [selectedSeries]);

  const effectiveLimitRows = useMemo(() => {
    const n = Number.parseInt(limitRowsText.trim(), 10);
    if (!Number.isFinite(n) || n <= 0) return Math.min(totalRows, 100000);
    return Math.min(totalRows, n);
  }, [limitRowsText, totalRows]);

  const activeYKey = useMemo(
    () => selectionYKey || selectedSeriesArray[0] || "",
    [selectionYKey, selectedSeriesArray],
  );

  const setChartOffsetStable = useCallback((off: ChartOffset | null) => {
    // setChartOffsetStableAvoidRenderLoops
    const prev = lastOffsetRef.current;
    const eq =
      (!prev && !off) ||
      (!!prev &&
        !!off &&
        Math.abs(prev.left - off.left) < 0.5 &&
        Math.abs(prev.top - off.top) < 0.5 &&
        Math.abs(prev.width - off.width) < 0.5 &&
        Math.abs(prev.height - off.height) < 0.5);

    if (eq) return;
    lastOffsetRef.current = off;
    setChartOffset(off);
  }, []);


  const clearLasso = useCallback(() => {
    // clearLasso
    setLassoPolygon([]);
    setLassoClosed(false);
    setSelectedFromPlot([]);
  }, []);

  const closeLasso = useCallback(() => {
    // closeLasso
    setLassoClosed((prev) => {
      if (prev) return prev;
      return lassoPolygon.length >= 3;
    });
  }, [lassoPolygon.length]);

  const ensureDefaultSeries = useCallback(() => {
    // ensureDefaultSeries
    if (selectedSeries.size > 0) return;

    const first = plotEligibleColumns[0]?.name;
    if (!first) return;

    setSelectedSeries(new Set([first]));
    setSelectionYKey(first);
  }, [plotEligibleColumns, selectedSeries.size]);

  const toggleSeries = useCallback(
    (colName: string) => {
      setSelectedSeries((prev) => {
        const next = new Set(prev);

        // enforceSingleSeriesForHistogramAndScatter
        if (plotType === "histogram" || plotType === "scatter") {
          if (next.has(colName)) next.delete(colName);
          else {
            next.clear();
            next.add(colName);
          }
          const only = Array.from(next)[0] ?? "";
          setSelectionYKey(only);
          return next;
        }

        if (next.has(colName)) next.delete(colName);
        else next.add(colName);

        const first = Array.from(next)[0] ?? "";
        if (!selectionYKey && first) setSelectionYKey(first);
        return next;
      });

      setSelectedFromPlot([]);
      setSubsetError(null);

      if (plotType === "scatter") {
        setChartOffset(null);
        clearLasso();
      }
    },
    [clearLasso, plotType, selectionYKey],
  );

  const closeDialog = useCallback(() => {
    // closeDialog
    onClose();
  }, [onClose]);

  useEffect(() => {
    if (!open) return;

    // initializeDefaultsOnOpen
    setPlotType("plot");
    setXAxisKey("__rowIndex__");
    setLimitRowsText("100000");
    setRespectSelection(false);

    setSubsetName("plot subset");
    setSubsetError(null);

    setSelectionAxis("y");
    setSelectionYKey("");

    setSelectedSeries(new Set());
    setPlotRows([]);
    setPlotError(null);

    setSelectionRange(null);
    setSelectedFromPlot([]);

    setChartOffset(null);
    lastOffsetRef.current = null;

    setLassoPolygon([]);
    setLassoClosed(false);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    ensureDefaultSeries();
  }, [open, ensureDefaultSeries]);

  const loadPlotRows = useCallback(async () => {
    // loadPlotRows
    if (!open) return;
    if (!schema || !selectedTable) return;
    if (totalRows <= 0) return;

    const epoch = loadEpochRef.current + 1;
    loadEpochRef.current = epoch;

    setPlotLoading(true);
    setPlotError(null);

    setSelectedFromPlot([]);
    setSubsetError(null);

    setChartOffset(null);
    lastOffsetRef.current = null;

    setLassoPolygon([]);
    setLassoClosed(false);

    try {
      const nextRows: PlotRow[] = [];
      const pageSize = 800;

      const wantSelectionOnly = respectSelection && viewerSelectedCount > 0;

      let offset = 0;
      let included = 0;

      while (offset < totalRows && included < effectiveLimitRows) {
        const limit = Math.min(pageSize, totalRows - offset);

        const response = await svcRef.current.fetchMetadataTableWindow(
          projectId,
          protocolId,
          outputName,
          selectedTable,
          {
            offset,
            limit,
            selectionOnly: false,
            sortBy: sortBy ?? undefined,
            asc: sortBy ? sortAsc : undefined,
          },
        );

        if (loadEpochRef.current !== epoch) return;

        const parsed = parseWindowResponse(response);
        const actualOffset = parsed.offset ?? offset;

        for (let i = 0; i < parsed.rows.length; i += 1) {
          if (included >= effectiveLimitRows) break;

          const row = parsed.rows[i];
          const globalRowIndex = actualOffset + i;
          const rowId = resolveRowId(schema, row);

          if (wantSelectionOnly) {
            if (!isRowSelectedInViewer(globalRowIndex, rowId)) continue;
          }

          const values: Record<string, number | null> = {};
          values.__rowIndex__ = globalRowIndex;

          for (const col of plotEligibleColumns) {
            const cell = row.values?.[col.index] as MetadataCell;
            values[col.name] = tryCellToNumber(cell);
          }

          if (rowId != null) {
            nextRows.push({ rowId, rowIndex: globalRowIndex, values });
            included += 1;
          }
        }

        offset += limit;
        if (parsed.rows.length === 0) break;
      }

      if (loadEpochRef.current !== epoch) return;

      setPlotRows(nextRows);
      setPlotError(null);
    } catch (err: any) {
      if (loadEpochRef.current !== epoch) return;
      setPlotRows([]);
      setPlotError(typeof err?.message === "string" ? err.message : "Failed to load plot data");
    } finally {
      if (loadEpochRef.current === epoch) setPlotLoading(false);
    }
  }, [
    effectiveLimitRows,
    isRowSelectedInViewer,
    open,
    outputName,
    projectId,
    protocolId,
    respectSelection,
    schema,
    selectedTable,
    sortAsc,
    sortBy,
    svcRef,
    totalRows,
    viewerSelectedCount,
    plotEligibleColumns,
  ]);

  useEffect(() => {
    if (!open) return;
    if (!schema || !selectedTable) return;
    void loadPlotRows();
  }, [open, schema, selectedTable, loadPlotRows]);

  const xDomainRaw = useMemo<Domain | null>(() => {
    const key = xAxisKey;
    if (plotRows.length === 0) return null;

    let min = Infinity;
    let max = -Infinity;

    for (const r of plotRows) {
      const v = key === "__rowIndex__" ? r.values.__rowIndex__ : r.values[key];
      if (v == null || !Number.isFinite(v)) continue;
      min = Math.min(min, v);
      max = Math.max(max, v);
    }

    if (!Number.isFinite(min) || !Number.isFinite(max)) return null;
    if (min === max) return { min, max: max + 1 };
    return { min, max };
  }, [plotRows, xAxisKey]);

  const yDomainActiveRaw = useMemo<Domain | null>(() => {
    const yKey = activeYKey;
    if (!yKey || plotRows.length === 0) return null;

    let min = Infinity;
    let max = -Infinity;

    for (const r of plotRows) {
      const v = r.values[yKey];
      if (v == null || !Number.isFinite(v)) continue;
      min = Math.min(min, v);
      max = Math.max(max, v);
    }

    if (!Number.isFinite(min) || !Number.isFinite(max)) return null;
    if (min === max) return { min, max: max + 1 };
    return { min, max };
  }, [plotRows, activeYKey]);

  const yDomainPlotRaw = useMemo<Domain | null>(() => {
    // yDomainAcrossSelectedSeriesForDisplay
    if (plotType !== "plot") return null;
    const series = selectedSeriesArray.length ? selectedSeriesArray : activeYKey ? [activeYKey] : [];
    if (!series.length || plotRows.length === 0) return null;

    let min = Infinity;
    let max = -Infinity;

    for (const r of plotRows) {
      for (const s of series) {
        const v = r.values[s];
        if (v == null || !Number.isFinite(v)) continue;
        min = Math.min(min, v);
        max = Math.max(max, v);
      }
    }

    if (!Number.isFinite(min) || !Number.isFinite(max)) return null;
    if (min === max) return { min, max: max + 1 };
    return { min, max };
  }, [activeYKey, plotRows, plotType, selectedSeriesArray]);

  const xDomain = useMemo(() => (xDomainRaw ? padDomain(xDomainRaw, 0.02) : null), [xDomainRaw]);
  const yDomainScatter = useMemo(
    () => (yDomainActiveRaw ? padDomain(yDomainActiveRaw, 0.03) : null),
    [yDomainActiveRaw],
  );
  const yDomainPlot = useMemo(
    () => (yDomainPlotRaw ? padDomain(yDomainPlotRaw, 0.03) : null),
    [yDomainPlotRaw],
  );

  const chartData = useMemo(() => {
    // buildChartDataForPlotAndScatter
    if (plotRows.length === 0) return [];

    const xKey = xAxisKey;
    const series = selectedSeriesArray;

    const out: Array<any> = [];
    for (const r of plotRows) {
      const xVal = xKey === "__rowIndex__" ? r.values.__rowIndex__ : r.values[xKey];
      if (xVal == null || !Number.isFinite(xVal)) continue;

      const rowObj: any = { rowId: r.rowId, x: xVal };

      if (plotType === "plot") {
        for (const s of series) {
          const yVal = r.values[s];
          rowObj[s] = yVal != null && Number.isFinite(yVal) ? yVal : null;
        }
      } else if (plotType === "scatter") {
        const yKey = series[0] || activeYKey;
        const yVal = yKey ? r.values[yKey] : null;
        rowObj.y = yVal != null && Number.isFinite(yVal) ? yVal : null;
      }

      out.push(rowObj);
    }

    return out;
  }, [plotRows, plotType, selectedSeriesArray, activeYKey, xAxisKey]);

  const histogram = useMemo(() => {
    // buildHistogramData
    if (plotType !== "histogram") return null;

    const colName = selectedSeriesArray[0] || activeYKey;
    if (!colName) {
      return {
        bins: [],
        min: 0,
        max: 1,
        colName: "",
        values: [] as Array<{ rowId: RowId; v: number }>,
      };
    }

    const values: Array<{ rowId: RowId; v: number }> = [];

    for (const r of plotRows) {
      const v = r.values[colName];
      if (v == null || !Number.isFinite(v)) continue;
      values.push({ rowId: r.rowId, v });
    }

    const { bins, min, max } = buildHistogram(values, 50);
    const dom = padDomain({ min, max }, 0.02);
    return { bins, min: dom.min, max: dom.max, colName, values };
  }, [plotRows, plotType, selectedSeriesArray, activeYKey]);

  const selectionDomain = useMemo<Domain | null>(() => {
    // selectionDomain
    if (plotType === "scatter") return null;

    if (plotType === "histogram") {
      if (!histogram) return null;
      return { min: histogram.min, max: histogram.max };
    }

    if (plotType === "plot") {
      if (selectionAxis === "x") return xDomain;
      // align Y selection scale with displayed Y axis (feels much more consistent)
      return yDomainPlot;
    }

    return null;
  }, [histogram, plotType, selectionAxis, xDomain, yDomainPlot]);


  useEffect(() => {
    // syncChartOffsetFromDomAsFallbackForAllChartTypes
    if (!open) return;

    let raf1: number | null = null;
    let raf2: number | null = null;

    const run = () => {
      const off = readChartOffsetFromDom(chartHostRef.current);
      if (off) setChartOffsetStable(off);
    };

    raf1 = requestAnimationFrame(() => {
      run();
      raf2 = requestAnimationFrame(run);
    });

    return () => {
      if (raf1 != null) cancelAnimationFrame(raf1);
      if (raf2 != null) cancelAnimationFrame(raf2);
    };
  }, [open, plotType, chartData.length, histogram?.bins.length, setChartOffsetStable]);

  useEffect(() => {
    // initializeSelectionRangeWhenNeeded
    if (!open) return;

    if (plotType === "scatter") {
      setSelectionRange(null);
      return;
    }

    if (!selectionDomain) {
      setSelectionRange(null);
      return;
    }

    setSelectionRange((prev) => {
      if (!prev) return [selectionDomain.min, selectionDomain.max];

      const lo = Math.min(prev[0], prev[1]);
      const hi = Math.max(prev[0], prev[1]);

      const clampedLo = Math.max(selectionDomain.min, Math.min(selectionDomain.max, lo));
      const clampedHi = Math.max(selectionDomain.min, Math.min(selectionDomain.max, hi));

      if (!Number.isFinite(clampedLo) || !Number.isFinite(clampedHi) || clampedLo === clampedHi) {
        return [selectionDomain.min, selectionDomain.max];
      }

      return [clampedLo, clampedHi];
    });
  }, [open, plotType, selectionDomain]);

  const computeSelectedFromRange = useCallback(() => {
    // computeSelectedFromRange
    if (plotType === "scatter") return;

    if (!selectionRange || !selectionDomain) {
      setSelectedFromPlot([]);
      return;
    }

    const [rawA, rawB] = selectionRange;
    const [a, b] = clampRange(selectionDomain.min, selectionDomain.max, rawA, rawB);

    if (plotType === "histogram") {
      const colName = histogram?.colName || selectedSeriesArray[0] || activeYKey;
      if (!colName) {
        setSelectedFromPlot([]);
        return;
      }

      const selected: RowId[] = [];
      for (const r of plotRows) {
        const v = r.values[colName];
        if (v == null || !Number.isFinite(v)) continue;
        if (v >= a && v <= b) selected.push(r.rowId);
      }
      setSelectedFromPlot(selected);
      return;
    }

    if (selectionAxis === "x") {
      const selected: RowId[] = [];
      for (const r of plotRows) {
        const xVal = xAxisKey === "__rowIndex__" ? r.values.__rowIndex__ : r.values[xAxisKey];
        if (xVal == null || !Number.isFinite(xVal)) continue;
        if (xVal >= a && xVal <= b) selected.push(r.rowId);
      }
      setSelectedFromPlot(selected);
      return;
    }

    // yAxisSelection (uses activeYKey values, but slider is aligned with displayed Y axis)
    const yKey = activeYKey;
    if (!yKey) {
      setSelectedFromPlot([]);
      return;
    }

    const selected: RowId[] = [];
    for (const r of plotRows) {
      const yVal = r.values[yKey];
      if (yVal == null || !Number.isFinite(yVal)) continue;
      if (yVal >= a && yVal <= b) selected.push(r.rowId);
    }
    setSelectedFromPlot(selected);
  }, [
    activeYKey,
    histogram,
    plotRows,
    plotType,
    selectedSeriesArray,
    selectionAxis,
    selectionDomain,
    selectionRange,
    xAxisKey,
  ]);

  useEffect(() => {
    if (!open) return;
    if (plotType === "scatter") return;
    computeSelectedFromRange();
  }, [open, plotType, computeSelectedFromRange]);

  const scatterPoints = useMemo(() => {
    if (plotType !== "scatter") return [];

    const pts: Array<{ rowId: RowId; x: number; y: number }> = [];
    for (const d of chartData) {
      const x = d.x as number;
      const y = d.y as number;
      const rowId = d.rowId as RowId | undefined;

      if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
      if (rowId == null) continue;

      pts.push({ rowId, x, y });
    }

    return pts;
  }, [chartData, plotType]);

  const selectedIdsUnique = useMemo(() => Array.from(new Set(selectedFromPlot)), [selectedFromPlot]);
  const selectionCount = selectedIdsUnique.length;

  const selectionIsFinal = plotType !== "scatter" || lassoClosed;
  const canCreateSubset =
    selectionIsFinal && selectionCount > 0 && schema && selectedTable && schemaActions.length > 0;

  const runSubsetAction = useCallback(
    async (actionLabel: string) => {
      // runSubsetAction
      if (!schema || !selectedTable) return;
      if (!selectionIsFinal) return;
      if (selectionCount <= 0) return;

      try {
        setSubsetSubmitting(true);
        setSubsetError(null);

        const safeName = subsetName.trim() || "plot subset";
        const ids = selectedIdsUnique as Array<string | number>;

        const result = await svcRef.current.runMetadataTableAction(
          projectId,
          protocolId,
          outputName,
          selectedTable,
          {
            action: actionLabel,
            subsetName: safeName,
            ids,
          },
        );

        const success = typeof (result as any)?.success === "boolean" ? (result as any).success : true;

        if (!success) {
          const msg =
            (result as any)?.message ||
            (Array.isArray((result as any)?.errors) ? (result as any).errors.join("\n") : "") ||
            "Action did not generate a new subset";
          setSubsetError(msg);
          return;
        }

        setSubsetError(null);
      } catch (err: any) {
        setSubsetError(typeof err?.message === "string" ? err.message : "Failed to create subset");
      } finally {
        setSubsetSubmitting(false);
      }
    },
    [
      outputName,
      projectId,
      protocolId,
      schema,
      selectedIdsUnique,
      selectedTable,
      selectionCount,
      selectionIsFinal,
      subsetName,
      svcRef,
    ],
  );

  const selectionSlider = useMemo(() => {
    if (plotType === "scatter") return null;
    if (!selectionRange || !selectionDomain) return null;

    const [min, max] = [selectionDomain.min, selectionDomain.max];
    const [a, b] = clampRange(min, max, selectionRange[0], selectionRange[1]);

    const stepBase = (max - min) / 300;
    const step = Number.isFinite(stepBase) && stepBase > 0 ? stepBase : undefined;

    return (
      <Slider
        value={[a, b]}
        onChange={(_e, v) => {
          const next = v as number[];
          if (next.length === 2) setSelectionRange([next[0], next[1]]);
        }}
        min={min}
        max={max}
        step={step}
        valueLabelDisplay="auto"
        valueLabelFormat={(v) => formatNumberCompact(Number(v))}
        size="small"
        sx={{ px: 0 }}
      />
    );
  }, [plotType, selectionDomain, selectionRange]);

  const leftPanelColumns = useMemo(() => {
    // buildColumnsListForLeftPanel
    return plotEligibleColumns.map((c, idx) => ({
      idx: idx + 1,
      name: c.name,
      label: c.alias || c.name,
      rendererType: String((c as any).rendererType || ""),
    }));
  }, [plotEligibleColumns]);

  const rightPlotTitle = useMemo(() => {
    if (!selectedTable) return "Plot";
    const base = selectedTable;
    if (plotType === "plot") return base;
    if (plotType === "histogram") return `${base} (histogram)`;
    return `${base} (scatter)`;
  }, [plotType, selectedTable]);

  const isXRangeMode = plotType === "histogram" || (plotType === "plot" && selectionAxis === "x");
  const isYRangeMode = plotType === "plot" && selectionAxis === "y";

  const selectedKeySet = useMemo(() => {
    // selectedKeySet
    const set = new Set<string>();
    for (const id of selectedIdsUnique) set.add(String(id));
    return set;
  }, [selectedIdsUnique]);

  const scatterPointShape = useCallback(
    (shapeProps: any) => {
      // scatterPointShape
      const cx = shapeProps?.cx as number | undefined;
      const cy = shapeProps?.cy as number | undefined;
      const payload = shapeProps?.payload as any;
      const rowId = payload?.rowId as RowId | undefined;

      if (!Number.isFinite(cx) || !Number.isFinite(cy)) return null;

      const key = rowId != null ? String(rowId) : "";
      const isSelected = !!key && selectedKeySet.has(key);

      const r = isSelected ? 4 : 2.5;

      return (
        <circle
          cx={cx}
          cy={cy}
          r={r}
          fill={isSelected ? "rgba(37,99,235,0.9)" : "rgba(15,23,42,0.50)"}
          stroke={isSelected ? "rgba(30,64,175,0.95)" : "none"}
          strokeWidth={isSelected ? 1 : 0}
          data-row-id={rowId != null ? String(rowId) : ""}
        />
      );
    },
    [selectedKeySet],
  );

  const seriesSummary = useMemo(() => {
    if (plotType === "scatter") {
      return selectedSeriesArray[0] ? `Y: ${selectedSeriesArray[0]}` : "";
    }
    if (plotType === "histogram") {
      return selectedSeriesArray[0] ? `Column: ${selectedSeriesArray[0]}` : "";
    }
    if (selectedSeriesArray.length === 0) return "";
    if (selectedSeriesArray.length <= 3) return `Series: ${selectedSeriesArray.join(", ")}`;
    return `Series: ${selectedSeriesArray.slice(0, 3).join(", ")} +${selectedSeriesArray.length - 3}`;
  }, [plotType, selectedSeriesArray]);

  return (
    <Dialog
      open={open}
      onClose={(_event, reason) => {
        if (reason === "backdropClick") return;
        closeDialog();
      }}
      maxWidth={false}
      BackdropProps={plotterBackdropProps as any}
      PaperProps={{
        sx: {
          width: 1200,
          maxWidth: "calc(100vw - 56px)",
          height: 760,
          maxHeight: "calc(100vh - 56px)",
          borderRadius: 3,
          overflow: "hidden",
          border: "1px solid rgba(15,23,42,0.10)",
          boxShadow: "0 24px 60px rgba(15,23,42,0.22), 0 10px 22px rgba(15,23,42,0.14)",
        },
      }}
    >
      <DialogTitle
        sx={{
          px: 2,
          py: 1.25,
          display: "flex",
          alignItems: "center",
          gap: 1.25,
          background: "linear-gradient(135deg, #0f172a 0%, #1e293b 55%, #334155 100%)",
          color: "#e2e8f0",
          borderBottom: "1px solid rgba(255,255,255,0.08)",
        }}
      >
        <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
          <PlotTypeIcon plotType={plotType} />
          <Typography variant="subtitle1" sx={{ fontWeight: 800, color: "#f8fafc" }}>
            Plotter
          </Typography>
        </Box>

        <Box sx={{ flex: 1, minWidth: 0 }} />

        <Tooltip title="Close">
          <IconButton
            size="small"
            onClick={closeDialog}
            sx={{
              color: "#e2e8f0",
              border: "1px solid rgba(255,255,255,0.18)",
              background: "rgba(255,255,255,0.06)",
              "&:hover": { background: "rgba(255,255,255,0.12)" },
            }}
          >
            <CloseIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      </DialogTitle>

      <DialogContent
        dividers
        sx={{
          p: 0,
          background: "linear-gradient(180deg, rgba(248,250,252,0.96) 0%, rgba(241,245,249,0.96) 100%)",
        }}
      >
        <Box sx={{ display: "flex", height: "100%" }}>
          {/* Left panel */}
          <Box
            sx={{
              width: 420,
              p: 2,
              borderRight: "1px solid rgba(148,163,184,0.20)",
              display: "flex",
              flexDirection: "column",
              gap: 1.5,
            }}
          >
            <Paper
              variant="outlined"
              sx={{
                p: 1.5,
                borderRadius: 2.5,
                borderColor: "rgba(148,163,184,0.25)",
                backgroundColor: "rgba(255,255,255,0.78)",
              }}
            >
              <Box sx={{ display: "flex", flexDirection: "column", gap: 1.25 }}>
                <FormControl size="small" fullWidth>
                  <InputLabel id="plotter-type-label">Type</InputLabel>
                  <Select
                    labelId="plotter-type-label"
                    label="Type"
                    value={plotType}
                    onChange={(e) => {
                      const next = e.target.value as PlotType;
                      setPlotType(next);

                      if (next === "histogram") setSelectionAxis("x");

                      if (next === "scatter" || next === "histogram") {
                        setSelectedSeries((prev) => {
                          const only = Array.from(prev)[0];
                          return only ? new Set([only]) : new Set();
                        });
                      }

                      setSelectedFromPlot([]);
                      setSubsetError(null);

                      setChartOffset(null);
                      lastOffsetRef.current = null;

                      clearLasso();
                      setSelectionRange(null);
                    }}
                    renderValue={(v) => {
                      const type = v as PlotType;
                      const label =
                        type === "plot" ? "Plot" : type === "histogram" ? "Histogram" : "Scatter";
                      return (
                        <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                          <PlotTypeIcon plotType={type} />
                          <span>{label}</span>
                        </Box>
                      );
                    }}
                  >
                    <MenuItem value="plot">
                      <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                        <LineChartIcon size={16} />
                        <span>Plot</span>
                      </Box>
                    </MenuItem>
                    <MenuItem value="histogram">
                      <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                        <BarChart3 size={16} />
                        <span>Histogram</span>
                      </Box>
                    </MenuItem>
                    <MenuItem value="scatter">
                      <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                        <ScatterChartIcon size={16} />
                        <span>Scatter</span>
                      </Box>
                    </MenuItem>
                  </Select>
                </FormControl>

                <FormControl size="small" fullWidth disabled={plotType === "histogram"}>
                  <InputLabel id="plotter-xaxis-label">X Axis</InputLabel>
                  <Select
                    labelId="plotter-xaxis-label"
                    label="X Axis"
                    value={xAxisKey}
                    onChange={(e) => {
                      setXAxisKey(e.target.value as AxisKey);
                      setSelectedFromPlot([]);
                      setSubsetError(null);

                      setChartOffset(null);
                      lastOffsetRef.current = null;

                      if (plotType === "scatter") clearLasso();
                      if (plotType === "plot" && selectionAxis === "x") setSelectionRange(null);
                    }}
                  >
                    <MenuItem value="__rowIndex__">Row index</MenuItem>
                    <Divider />
                    {xAxisCandidates.map((c) => (
                      <MenuItem key={c.name} value={c.name}>
                        {c.alias || c.name}
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>

                <TextField
                  label="Limit rows"
                  size="small"
                  value={limitRowsText}
                  onChange={(e) => setLimitRowsText(e.target.value)}
                  helperText="Loads at most N rows for plotting (after applying selection, if enabled)."
                />

                <FormControl component="fieldset">
                  <Typography
                    variant="caption"
                    sx={{ fontWeight: 800, color: "rgba(51,65,85,0.9)", mb: 0.25 }}
                  >
                    Plot selection?
                  </Typography>
                  <RadioGroup
                    row
                    value={respectSelection ? "yes" : "no"}
                    onChange={(e) => {
                      const next = e.target.value === "yes";
                      setRespectSelection(next);

                      setSelectedFromPlot([]);
                      setSubsetError(null);

                      setChartOffset(null);
                      lastOffsetRef.current = null;

                      clearLasso();
                      void loadPlotRows();
                    }}
                  >
                    <FormControlLabel
                      value="yes"
                      control={<Radio size="small" />}
                      label={
                        <Typography variant="caption" sx={{ fontWeight: 700 }}>
                          Yes
                        </Typography>
                      }
                    />
                    <FormControlLabel
                      value="no"
                      control={<Radio size="small" />}
                      label={
                        <Typography variant="caption" sx={{ fontWeight: 700 }}>
                          No
                        </Typography>
                      }
                    />
                  </RadioGroup>

                  {respectSelection && viewerSelectedCount <= 0 && (
                    <Typography variant="caption" color="text.secondary">
                      Viewer selection is empty; plot will behave like "No".
                    </Typography>
                  )}
                </FormControl>
              </Box>
            </Paper>

            <Paper
              variant="outlined"
              sx={{
                flex: 1,
                borderRadius: 2.5,
                borderColor: "rgba(148,163,184,0.25)",
                backgroundColor: "rgba(255,255,255,0.78)",
                display: "flex",
                flexDirection: "column",
                overflow: "hidden",
              }}
            >
              <Box
                sx={{
                  px: 1.5,
                  py: 1,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  borderBottom: "1px solid rgba(148,163,184,0.22)",
                  background:
                    "linear-gradient(180deg, rgba(248,250,252,1) 0%, rgba(241,245,249,1) 100%)",
                }}
              >
                <Typography variant="subtitle2" sx={{ fontWeight: 900, color: "rgba(15,23,42,0.9)" }}>
                  Columns
                </Typography>

                <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 700 }}>
                  {plotEligibleColumns.length} eligible
                </Typography>
              </Box>

              <TableContainer sx={{ flex: 1, overflow: "auto" }}>
                <Table size="small" stickyHeader sx={{ tableLayout: "fixed" }}>
                  <TableHead>
                    <TableRow>
                      <TableCell sx={{ fontWeight: 900, width: 52 }}>#</TableCell>
                      <TableCell sx={{ fontWeight: 900 }}>Label</TableCell>
                      <TableCell sx={{ fontWeight: 900, width: 78, textAlign: "center" }}>Plot</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {leftPanelColumns.map((row) => {
                      const checked = selectedSeries.has(row.name);
                      const disabled = plotType === "scatter" && row.name === xAxisKey;

                      return (
                        <TableRow
                          key={row.name}
                          hover
                          sx={{ "&:hover td": { backgroundColor: "rgba(248,250,252,1)" } }}
                        >
                          <TableCell>{row.idx}</TableCell>
                          <TableCell title={row.name}>
                            <Box sx={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
                              <Typography
                                variant="body2"
                                sx={{ fontSize: "0.82rem", fontWeight: 700, color: "#0f172a" }}
                              >
                                {row.label}
                              </Typography>
                              <Typography
                                variant="caption"
                                color="text.secondary"
                                sx={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}
                              >
                                {row.name} ({row.rendererType})
                              </Typography>
                            </Box>
                          </TableCell>
                          <TableCell align="center">
                            <input
                              type="checkbox"
                              checked={checked}
                              disabled={disabled}
                              onChange={() => toggleSeries(row.name)}
                              style={{ width: 16, height: 16 }}
                            />
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </TableContainer>

              <Box sx={{ px: 1.5, py: 1, borderTop: "1px solid rgba(148,163,184,0.22)" }}>
                <Typography variant="caption" color="text.secondary">
                  Plot uses one or more selected columns. Histogram uses exactly one column. Scatter uses exactly one Y column.
                </Typography>
              </Box>
            </Paper>
          </Box>

          {/* Right panel */}
          <Box sx={{ flex: 1, p: 2, display: "flex", flexDirection: "column", gap: 1.5, minWidth: 0 }}>
            <Paper
              variant="outlined"
              sx={{
                borderRadius: 2.5,
                borderColor: "rgba(148,163,184,0.25)",
                backgroundColor: "rgba(255,255,255,0.78)",
                overflow: "hidden",
                display: "flex",
                flexDirection: "column",
                minHeight: 560,
                minWidth: 0,
              }}
            >
              <Box
                sx={{
                  px: 1.5,
                  py: 1,
                  display: "flex",
                  alignItems: "center",
                  gap: 1,
                  borderBottom: "1px solid rgba(148,163,184,0.22)",
                  background:
                    "linear-gradient(180deg, rgba(248,250,252,1) 0%, rgba(241,245,249,1) 100%)",
                }}
              >
                <Typography variant="subtitle2" sx={{ fontWeight: 900, color: "rgba(15,23,42,0.92)" }}>
                  {rightPlotTitle}
                </Typography>

                {seriesSummary && (
                  <Typography
                    variant="caption"
                    sx={{
                      ml: 1,
                      fontWeight: 800,
                      color: "rgba(71,85,105,0.95)",
                      px: 1,
                      py: 0.35,
                      borderRadius: 2,
                      border: "1px solid rgba(148,163,184,0.25)",
                      background: "rgba(248,250,252,0.8)",
                      maxWidth: 420,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                    title={seriesSummary}
                  >
                    {seriesSummary}
                  </Typography>
                )}

                <Box sx={{ flex: 1 }} />

                {plotType === "plot" && (
                  <FormControl size="small" sx={{ minWidth: 120 }}>
                    <InputLabel id="plotter-selection-axis-label">Selection</InputLabel>
                    <Select
                      labelId="plotter-selection-axis-label"
                      label="Selection"
                      value={selectionAxis}
                      onChange={(e) => {
                        const next = e.target.value as "x" | "y";
                        setSelectionAxis(next);
                        setSelectedFromPlot([]);
                        setSubsetError(null);
                        setSelectionRange(null);

                        setChartOffset(null);
                        lastOffsetRef.current = null;
                      }}
                    >
                      <MenuItem value="y">Y range</MenuItem>
                      <MenuItem value="x">X range</MenuItem>
                    </Select>
                  </FormControl>
                )}

                {plotType === "plot" && selectionAxis === "y" && selectedSeriesArray.length > 1 && (
                  <FormControl size="small" sx={{ minWidth: 220 }}>
                    <InputLabel id="plotter-yseries-label">Y series</InputLabel>
                    <Select
                      labelId="plotter-yseries-label"
                      label="Y series"
                      value={activeYKey}
                      onChange={(e) => {
                        setSelectionYKey(e.target.value);
                        setSelectedFromPlot([]);
                        setSubsetError(null);
                        setSelectionRange(null);
                      }}
                    >
                      {selectedSeriesArray.map((s) => (
                        <MenuItem key={s} value={s}>
                          {s}
                        </MenuItem>
                      ))}
                    </Select>
                  </FormControl>
                )}

                {plotType === "scatter" && (
                  <>
                    <Tooltip title="Clear polygon">
                      <span>
                        <IconButton
                          size="small"
                          onClick={() => {
                            clearLasso();
                            setSubsetError(null);
                          }}
                        >
                          <Trash2 size={16} />
                        </IconButton>
                      </span>
                    </Tooltip>

                    <Tooltip
                      title={
                        lassoClosed
                          ? "Polygon is already closed."
                          : lassoPolygon.length < 3
                            ? "Add at least 3 points first."
                            : "Close polygon and finalize selection."
                      }
                    >
                      <span>
                        <IconButton
                          size="small"
                          onClick={closeLasso}
                          disabled={lassoClosed || lassoPolygon.length < 3}
                        >
                          <Check size={16} />
                        </IconButton>
                      </span>
                    </Tooltip>

                    <Tooltip
                      title={
                        lassoClosed
                          ? "Polygon is closed. You can create subsets."
                          : "Draw polygon to preview selection."
                      }
                    >
                      <Typography
                        variant="caption"
                        sx={{ fontWeight: 900, color: "rgba(51,65,85,0.9)", ml: 0.5 }}
                      >
                        {lassoClosed ? "Polygon: closed" : "Polygon: drawing"}
                      </Typography>
                    </Tooltip>
                  </>
                )}
              </Box>

              <Box
                sx={{
                  flex: 1,
                  minHeight: 0,
                  display: "flex",
                  flexDirection: "column",
                  p: 1.5,
                  gap: 1,
                  minWidth: 0,
                }}
              >
                {plotLoading && (
                  <Typography variant="body2" color="text.secondary">
                    Loading plot data…
                  </Typography>
                )}

                {plotError && (
                  <Typography variant="body2" color="error">
                    {plotError}
                  </Typography>
                )}

                {!plotLoading && !plotError && plotRows.length === 0 && (
                  <Typography variant="body2" color="text.secondary">
                    No data to plot.
                  </Typography>
                )}

                {!plotLoading && !plotError && plotRows.length > 0 && (
                  <>
                    <Box
                      sx={{
                        flex: 1,
                        minHeight: 0,
                        display: "grid",
                        gridTemplateColumns: isYRangeMode ? "76px 1fr" : "1fr",
                        gap: 1,
                        alignItems: "stretch",
                        minWidth: 0,
                      }}
                    >
                      {isYRangeMode && (
                        <Box sx={{ position: "relative", minHeight: 0 }}>
                          {selectionDomain && (
                            <Box
                              sx={{
                                position: "absolute",
                                left: "50%",
                                transform: "translateX(-50%)",
                                top: (chartOffset?.top ?? 34) as number,
                                height: (chartOffset?.height ?? 360) as number,
                                display: "flex",
                                alignItems: "stretch",
                              }}
                            >
                              <Slider
                                orientation="vertical"
                                value={selectionRange ?? [selectionDomain.min, selectionDomain.max]}
                                onChange={(_e, v) => {
                                  const next = v as number[];
                                  if (next.length === 2) setSelectionRange([next[0], next[1]]);
                                }}
                                min={selectionDomain.min}
                                max={selectionDomain.max}
                                step={(selectionDomain.max - selectionDomain.min) / 300}
                                valueLabelDisplay="auto"
                                valueLabelFormat={(v) => formatNumberCompact(Number(v))}
                                size="small"
                                sx={{ height: "97%" }}
                              />
                            </Box>
                          )}
                        </Box>
                      )}

                      <Paper
                        variant="outlined"
                        sx={{
                          borderRadius: 2.5,
                          borderColor: "rgba(148,163,184,0.22)",
                          backgroundColor: "#ffffff",
                          overflow: "hidden",
                          position: "relative",
                          display: "flex",
                          flexDirection: "column",
                          minWidth: 0,
                          minHeight: 0,
                        }}
                      >
                        <Box ref={chartHostRef} sx={{ position: "relative", flex: 1, minHeight: 420, minWidth: 0 }}>
                          {plotType === "plot" && (
                            <ResponsiveContainer width="100%" height="100%">
                              <ReLineChart
                                data={chartData}
                                margin={{ top: 10, right: 18, left: 6, bottom: 10 }}
                              >
                                <CartesianGrid strokeDasharray="3 3" />
                                <XAxis
                                  dataKey="x"
                                  type="number"
                                  tickFormatter={formatNumberCompact}
                                  domain={xDomain ? [xDomain.min, xDomain.max] : undefined}
                                />
                                <YAxis
                                  tickFormatter={formatNumberCompact}
                                  domain={yDomainPlot ? [yDomainPlot.min, yDomainPlot.max] : undefined}
                                />
                                <RechartsTooltip />
                                {selectedSeriesArray.map((s) => (
                                  <Line key={s} type="monotone" dataKey={s} dot={false} isAnimationActive={false} />
                                ))}

                                {selectionAxis === "x" && selectionRange && xDomain && (
                                  <ReferenceArea
                                    x1={Math.min(selectionRange[0], selectionRange[1])}
                                    x2={Math.max(selectionRange[0], selectionRange[1])}
                                    strokeOpacity={0.25}
                                  />
                                )}

                                {selectionAxis === "y" && selectionRange && yDomainPlot && (
                                  <ReferenceArea
                                    y1={Math.min(selectionRange[0], selectionRange[1])}
                                    y2={Math.max(selectionRange[0], selectionRange[1])}
                                    strokeOpacity={0.25}
                                  />
                                )}

                                <ChartOffsetProbe onOffset={setChartOffsetStable} />
                              </ReLineChart>
                            </ResponsiveContainer>
                          )}

                          {plotType === "histogram" && histogram && (
                            <ResponsiveContainer width="100%" height="100%">
                              <ReBarChart
                                data={histogram.bins}
                                margin={{ top: 10, right: 18, left: 6, bottom: 10 }}
                              >
                                <CartesianGrid strokeDasharray="3 3" />
                                <XAxis
                                  dataKey="binMid"
                                  type="number"
                                  tickFormatter={formatNumberCompact}
                                  domain={[histogram.min, histogram.max]}
                                />
                                <YAxis />
                                <RechartsTooltip />
                                <Bar dataKey="count" isAnimationActive={false} />

                                {selectionRange && (
                                  <ReferenceArea
                                    x1={Math.min(selectionRange[0], selectionRange[1])}
                                    x2={Math.max(selectionRange[0], selectionRange[1])}
                                    strokeOpacity={0.25}
                                  />
                                )}

                                <ChartOffsetProbe onOffset={setChartOffsetStable} />
                              </ReBarChart>
                            </ResponsiveContainer>
                          )}

                          {plotType === "scatter" && (
                            <>
                              <ResponsiveContainer width="100%" height="100%">
                                <ReScatterChart margin={{ top: 10, right: 18, left: 6, bottom: 10 }}>
                                  <CartesianGrid strokeDasharray="3 3" />
                                  <XAxis
                                    dataKey="x"
                                    type="number"
                                    tickFormatter={formatNumberCompact}
                                    domain={xDomain ? [xDomain.min, xDomain.max] : undefined}
                                  />
                                  <YAxis
                                    dataKey="y"
                                    type="number"
                                    tickFormatter={formatNumberCompact}
                                    domain={yDomainScatter ? [yDomainScatter.min, yDomainScatter.max] : undefined}
                                  />
                                  <RechartsTooltip />

                                  <Scatter
                                    name={selectedSeriesArray[0] || "Y"}
                                    data={scatterPoints}
                                    isAnimationActive={false}
                                    shape={scatterPointShape as any}
                                  />

                                  <ChartOffsetProbe onOffset={setChartOffsetStable} />
                                </ReScatterChart>
                              </ResponsiveContainer>

                              <ScatterLassoOverlay
                                xDomain={xDomain}
                                yDomain={yDomainScatter}
                                offset={chartOffset}
                                data={scatterPoints}
                                polygon={lassoPolygon}
                                polygonClosed={lassoClosed}
                                onAddPoint={(p) => {
                                  setLassoPolygon((prev) => [...prev, p]);
                                  setLassoClosed(false);
                                }}
                                onClosePolygon={closeLasso}
                                onClear={clearLasso}
                                onSelectionPreview={(rowIds) => setSelectedFromPlot(rowIds)}
                                chartHostRef={chartHostRef}
                              />
                            </>
                          )}
                        </Box>

                        {plotType !== "scatter" && isXRangeMode && (
                          <Box
                            sx={{
                              position: "relative",
                              height: 76,
                              borderTop: "1px solid rgba(148,163,184,0.18)",
                              background: "rgba(248,250,252,0.9)",
                            }}
                          >
                            <Box
                              sx={{
                                px: 2,
                                pt: 1,
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "space-between",
                                gap: 1,
                              }}
                            >
                              <Typography variant="caption" sx={{ fontWeight: 900, color: "rgba(51,65,85,0.9)" }}>
                                X Range
                              </Typography>

                              <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 800 }}>
                                {selectionDomain
                                  ? `${formatNumberCompact(selectionDomain.min)} → ${formatNumberCompact(selectionDomain.max)}`
                                  : "—"}
                              </Typography>
                            </Box>

                            <Box
                              sx={{
                                position: "absolute",
                                bottom: 12,
                                left: (() => {
                                  const inset = 8;
                                  const left = (chartOffset?.left ?? 16) + inset;
                                  return left;
                                })(),
                                width: (() => {
                                  const inset = 8;
                                  if (chartOffset) return `${Math.max(0, chartOffset.width - inset * 2)}px`;
                                  return "calc(100% - 64px)";
                                })(),
                              }}
                            >
                              {selectionSlider}
                            </Box>
                          </Box>
                        )}
                      </Paper>
                    </Box>

                    <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", mt: 0.5 }}>
                      <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 700 }}>
                        {plotRows.length} items plotted{" "}
                        {respectSelection && viewerSelectedCount > 0 ? "(selection)" : "(all)"}
                      </Typography>

                      <Typography variant="caption" sx={{ fontWeight: 900, color: "rgba(15,23,42,0.85)" }}>
                        {plotType === "scatter" && !lassoClosed ? "Preview: " : "Selected in plot: "}
                        {selectionCount}
                      </Typography>
                    </Box>

                    {plotType === "scatter" && !lassoClosed && selectionCount > 0 && (
                      <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 700 }}>
                        Close the polygon to finalize selection and enable subset creation.
                      </Typography>
                    )}

                    {subsetError && (
                      <Box
                        sx={{
                          borderRadius: 2,
                          px: 1.25,
                          py: 1,
                          border: "1px solid rgba(239,68,68,0.25)",
                          backgroundColor: "rgba(254,242,242,0.9)",
                        }}
                      >
                        <Typography variant="body2" color="error" sx={{ fontWeight: 600 }}>
                          {subsetError}
                        </Typography>
                      </Box>
                    )}

                    <Box sx={{ display: "flex", gap: 1, alignItems: "center", flexWrap: "wrap", mt: 0.5 }}>
                      <TextField
                        label="Subset name"
                        size="small"
                        value={subsetName}
                        onChange={(e) => setSubsetName(e.target.value)}
                        sx={{ minWidth: 260 }}
                        disabled={subsetSubmitting}
                      />

                      <Box sx={{ flex: 1 }} />

                      {schemaActions.map((actionLabel) => (
                        <Tooltip
                          key={actionLabel}
                          title={
                            plotType === "scatter" && !lassoClosed
                              ? "Close the polygon first."
                              : canCreateSubset
                                ? ""
                                : "No selection."
                          }
                        >
                          <span>
                            <Button
                              size="small"
                              variant="contained"
                              startIcon={<Plus size={14} />}
                              onClick={() => void runSubsetAction(actionLabel)}
                              disabled={!canCreateSubset || subsetSubmitting}
                              sx={{
                                textTransform: "none",
                                fontWeight: 800,
                                color: "#e2e8f0",
                                border: "1px solid rgba(255,255,255,0.08)",
                                background: "linear-gradient(180deg, #1e293b 0%, #0f172a 100%)",
                                boxShadow:
                                  "0 1px 2px rgba(15,23,42,0.25), inset 0 1px 0 rgba(255,255,255,0.06)",
                                "&:hover": {
                                  background: "linear-gradient(180deg, #334155 0%, #1e293b 100%)",
                                },
                                "&.Mui-disabled": {
                                  color: "rgba(226,232,240,0.55)",
                                  background: "rgba(15,23,42,0.35)",
                                  borderColor: "rgba(148,163,184,0.18)",
                                },
                              }}
                            >
                              {actionLabel}
                            </Button>
                          </span>
                        </Tooltip>
                      ))}

                      {schemaActions.length === 0 && (
                        <Typography variant="caption" color="text.secondary">
                          No actions available.
                        </Typography>
                      )}
                    </Box>
                  </>
                )}
              </Box>
            </Paper>

            <Paper
              variant="outlined"
              sx={{
                borderRadius: 2.5,
                borderColor: "rgba(148,163,184,0.25)",
                backgroundColor: "rgba(255,255,255,0.78)",
                p: 1.25,
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 1,
              }}
            >
              <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 700 }}>
                Tip: Sliders are aligned to the chart inner plotting area (same offset used by Recharts).
              </Typography>

              <Button
                size="small"
                variant="outlined"
                startIcon={<CloseIcon />}
                onClick={closeDialog}
                sx={{ textTransform: "none", fontWeight: 800, borderRadius: 2 }}
              >
                Close
              </Button>
            </Paper>
          </Box>
        </Box>
      </DialogContent>

      <DialogActions sx={{ display: "none" }} />
    </Dialog>
  );
}