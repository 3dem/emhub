import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MutableRefObject,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
  type UIEventHandler,
} from "react";
import {
  Box,
  Button,
  Checkbox,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  FormControlLabel,
  InputAdornment,
  InputLabel,
  Menu,
  MenuItem,
  ListItemText,
  ListItemIcon,
  Divider,
  Paper,
  Select,
  TextField,
  type SelectChangeEvent,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Typography,
  Tooltip,
  IconButton,
} from "@mui/material";
import {
  LayoutGrid,
  TableIcon,
  Check,
  ColumnsSettingsIcon,
  List,
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  RefreshCcw,
  Plus,
  Filter,
  Hash,
  Search,
  Sigma,
  Bookmark,
  LineChart as PlotterIcon,
} from "lucide-react";
import type {
  MetadataCell,
  MetadataColumn,
  MetadataRow,
  MetadataTableInfo,
  MetadataTableSchema,
} from "@/types/metadata";
import { CloseIcon } from "@/icons";
import { useProjectService } from "@/ProjectServiceContext";
import { MetadataPlotterDialog } from "./metadata-plotter-dialog";
type MetadataViewerProps = {
  projectId: number;
  protocolId: number;
  outputName: string;
  onClose?: () => void;
  embedded?: boolean;
};

type ViewMode = "table" | "gallery";

type SelectedImageCell = {
  rowIndexInTable: number;
  columnName: string;
};

type MetadataColumnWithVisibility = MetadataColumn & {
  visible?: boolean;
};

type ColumnSettings = {
  visible: boolean;
  renderAsImage: boolean;
};

type ImageCacheEntry = {
  url: string;
  revoke: () => void;
};

type MetadataWindowResponse = MetadataRow[] | { rows?: MetadataRow[]; offset?: number };

type ImageJobResult = { url: string; revoke: () => void };

interface ImageJob {
  run: () => Promise<ImageJobResult>;
  onSuccess: (result: ImageJobResult) => void;
  onError: (error: unknown) => void;
  isCancelled: () => boolean;
}

type IndexRange = {
  start: number;
  end: number;
};

type RowSelectionState = {
  /**
   * baseMode="none": ranges are selected ranges
   * baseMode="all": ranges are excluded ranges
   */
  baseMode: "none" | "all";
  ranges: IndexRange[];
  anchorIndex: number | null;
};

type RowId = string | number;

type RowIdKey = string;

type SelectionMode = "index" | "ids";

type ContextMenuState =
  | {
    kind: "row";
    mouseX: number;
    mouseY: number;
    rowIndex: number;
    rowId: RowId | null;
  }
  | {
    kind: "header";
    mouseX: number;
    mouseY: number;
    columnName: string;
  }
  | null;

type CriteriaOperator =
  | "equals"
  | "notEquals"
  | "gt"
  | "gte"
  | "lt"
  | "lte"
  | "between"
  | "contains"
  | "startsWith"
  | "endsWith"
  | "regex"
  | "isEmpty"
  | "isNotEmpty"
  | "isImage"
  | "isNotImage";

type SelectionScope = "allRows" | "currentSelection";
type SelectionSetOp = "replace" | "add" | "remove" | "intersect";

type SelectionDialogState =
  | { open: false }
  | {
    open: true;
    kind: "range";
    title: string;
    startValue: string; // oneBasedInclusive
    endValue: string; // oneBasedInclusive
  }
  | {
    open: true;
    kind: "indexCompare";
    title: string;
    mode: "gte" | "lte" | "gt" | "lt";
    value: string; // oneBased
  }
  | {
    open: true;
    kind: "criteria";
    title: string;
    columnName: string;
    operator: CriteriaOperator;
    value1: string;
    value2: string;
    caseSensitive: boolean;
    treatAsNumber: boolean;
    negate: boolean;
    scope: SelectionScope;
    setOp: SelectionSetOp;
  };

type MetadataImageCellProps = {
  projectId: number;
  protocolId: number;
  outputName: string;
  tableName: string;
  rowIndexInTable: number;
  columnName: string;
  cell: { kind: "image"; path: string };
  size: number;
  isSelected?: boolean;
  onClick?: (event: ReactMouseEvent<HTMLDivElement>) => void;
  scrollRootRef: MutableRefObject<HTMLDivElement | null>;
  imageCacheRef: MutableRefObject<Map<string, ImageCacheEntry>>;
};

type SortDirection = "asc" | "desc";

type SortState = {
  columnName: string | null;
  direction: SortDirection;
};

type MetadataTablePanelProps = {
  schema: MetadataTableSchema | null;
  totalRows: number;
  visibleColumns: MetadataColumnWithVisibility[];
  columnSettings: Record<string, ColumnSettings>;
  rowHeight: number;
  rowSizeForScroll: number;
  imageThumbSize: number;
  imageColMinWidth: number;
  tableMinWidth?: number;
  windowRows: MetadataRow[];
  windowOffset: number;
  windowLoading: boolean;
  windowError: string | null;
  topSpacerHeight: number;
  bottomSpacerHeight: number;
  hasData: boolean;
  scrollRef: MutableRefObject<HTMLDivElement | null>;
  handleScroll: UIEventHandler<HTMLDivElement>;
  isRowSelected: (rowIndex: number, rowId: RowId | null) => boolean;
  onPrimaryRowClick: (
    rowIndex: number,
    rowId: RowId | null,
    event: ReactMouseEvent<Element>,
  ) => void;
  onRowContextMenu: (
    rowIndex: number,
    rowId: RowId | null,
    event: ReactMouseEvent<Element>,
  ) => void;
  onHeaderContextMenu: (
    column: MetadataColumnWithVisibility,
    event: ReactMouseEvent<Element>,
  ) => void;
  selectedImageCell: SelectedImageCell | null;
  setSelectedRowIndex: (value: number | null) => void;
  setSelectedImageCell: (value: SelectedImageCell | null) => void;
  projectId: number;
  protocolId: number;
  outputName: string;
  selectedTable: string;
  imageCacheRef: MutableRefObject<Map<string, ImageCacheEntry>>;
  sortBy: string | null;
  sortAsc: boolean;
  onToggleSort: (column: MetadataColumnWithVisibility) => void;
  matrixColumnNames: Set<string>;
};

type MetadataGalleryPanelProps = {
  schema: MetadataTableSchema | null;
  firstImageColumn: MetadataColumnWithVisibility | null;
  galleryRows: MetadataRow[];
  galleryLoading: boolean;
  galleryError: string | null;
  galleryScrollRef: MutableRefObject<HTMLDivElement | null>;
  handleGalleryScroll: UIEventHandler<HTMLDivElement>;
  isRowSelected: (rowIndex: number, rowId: RowId | null) => boolean;
  onPrimaryRowClick: (
    rowIndex: number,
    rowId: RowId | null,
    event: ReactMouseEvent<Element>,
  ) => void;
  selectedImageCell: SelectedImageCell | null;
  setSelectedRowIndex: (value: number | null) => void;
  setSelectedImageCell: (value: SelectedImageCell | null) => void;
  projectId: number;
  protocolId: number;
  outputName: string;
  selectedTable: string;
  imageCacheRef: MutableRefObject<Map<string, ImageCacheEntry>>;
  showSizeLabel: boolean;
  sizeColumn: MetadataColumnWithVisibility | null;
  imageThumbSize: number;
  galleryBaseOffset: number;
};

type ColumnsDialogProps = {
  open: boolean;
  onClose: () => void;
  onApply: () => void;
  allColumns: MetadataColumnWithVisibility[];
  columnSettings: Record<string, ColumnSettings>;
  draftColumnSettings: Record<string, ColumnSettings> | null;
  updateDraftColumnSettings: (colName: string, partial: Partial<ColumnSettings>) => void;
};

type MetadataActionDialogState = {
  open: boolean;
  actionLabel: string;
};

type MetadataActionRequestPayload = {
  action: string;
  subsetName: string;
  rowIds: Array<string | number>;
  projectId: number;
  protocolId: number;
  outputName: string;
  tableName: string;
};

/* ======================= Constants ======================= */

const BASE_THUMB_SIZE = 200;
const NORMAL_ROW_HEIGHT = 32;
const IMAGE_ROW_PADDING = 16;
const EXTRA_BUFFER_ROWS = 10;
const MIN_TABLE_WINDOW_ROWS = 60;

const MAX_VIRTUAL_SCROLL_HEIGHT = 30_000_000;

const ROW_INDEX_COL_WIDTH = 52;
const MIN_TEXT_COL_WIDTH = 140;
const MATRIX_COL_MIN_WIDTH = 250;
const IMAGE_COL_PADDING = 24;

const MIN_THUMB_SIZE = 80;
const MAX_THUMB_SIZE = 640;
const ZOOM_STEP_PERCENT = 25;
const ZOOM_APPLY_DEBOUNCE_MS = 300;
const ZOOM_MIN_PERCENT = Math.round((MIN_THUMB_SIZE / BASE_THUMB_SIZE) * 100);
const ZOOM_MAX_PERCENT = Math.round((MAX_THUMB_SIZE / BASE_THUMB_SIZE) * 100);

const GALLERY_PAGE_SIZE = 80;
const SELECTION_IDS_SCAN_PAGE_SIZE = 500;

const MAX_CONCURRENT_IMAGE_REQUESTS = 4;
const MAX_IMAGE_CACHE_ENTRIES = 400;
const IMAGE_LAZY_ROOT_MARGIN = "600px 0px";

const METADATA_IMAGE_PRIMARY_FORMAT = "webp";
const METADATA_IMAGE_FALLBACK_FORMAT = "png";
const METADATA_IMAGE_CACHE_VARIANT = "webp-png-fallback";

const HEADER_BG = "#f3f4f6";

const DIALOG_HEADER_BG = "#e5e7eb";
const DIALOG_ROW_ODD_BG = "#f9fafb";
const DIALOG_ROW_EVEN_BG = "#ffffff";

const DEFAULT_SUBSET_NAME = "create subset";

const baseCellSx = {
  padding: "4px 8px",
  whiteSpace: "nowrap" as const,
  textOverflow: "ellipsis" as const,
  overflow: "hidden" as const,
  borderBottom: "1px solid rgba(148,163,184,0.25)",
  fontSize: "0.75rem",
  lineHeight: 1.4,
};

const headerCellSx = {
  ...baseCellSx,
  fontWeight: 600,
  background: HEADER_BG,
  color: "#0f172a",
  position: "sticky" as const,
  top: 0,
  zIndex: 1,
};

const headerColumnDialogSx = {
  px: 2,
  py: 1.25,
  display: "flex",
  alignItems: "center",
  gap: 1.5,
  background: "linear-gradient(180deg, #0b1220 0%, #0a0f1e 100%)",
  color: "#e5e7eb",
  borderBottom: "1px solid rgba(255,255,255,0.06)",
};

const closeBtnSx = {
  ml: "auto",
  color: "#e5e7eb",
  border: "1px solid rgba(255,255,255,0.18)",
  background: "rgba(255,255,255,0.06)",
  "&:hover": {
    background: "rgba(255,255,255,0.12)",
    borderColor: "rgba(255,255,255,0.28)",
  },
};

/* ======================= Global image queue ======================= */

const imageJobQueue: ImageJob[] = [];
let activeImageJobs = 0;

function pruneCancelledImageJobs() {
  for (let i = imageJobQueue.length - 1; i >= 0; i -= 1) {
    if (imageJobQueue[i].isCancelled()) {
      imageJobQueue.splice(i, 1);
    }
  }
}

function scheduleNextImageJob() {
  pruneCancelledImageJobs();

  while (activeImageJobs < MAX_CONCURRENT_IMAGE_REQUESTS) {
    const job = imageJobQueue.shift();
    if (!job) return;

    if (job.isCancelled()) {
      continue;
    }

    activeImageJobs += 1;

    void (async () => {
      try {
        const result = await job.run();

        if (!job.isCancelled()) {
          job.onSuccess(result);
        } else {
          result.revoke();
        }
      } catch (error) {
        if (!job.isCancelled()) {
          job.onError(error);
        }
      } finally {
        activeImageJobs = Math.max(0, activeImageJobs - 1);
        scheduleNextImageJob();
      }
    })();
  }
}

function enqueueImageJob(job: ImageJob) {
  pruneCancelledImageJobs();
  imageJobQueue.push(job);
  scheduleNextImageJob();
}

/* ======================= Generic helpers ======================= */

function getErrorMessage(error: unknown, fallbackMessage: string): string {
  if (typeof error === "object" && error && "message" in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string" && message.trim()) return message;
  }
  return fallbackMessage;
}

function parseWindowResponse(response: MetadataWindowResponse): {
  rows: MetadataRow[];
  offset?: number;
} {
  if (Array.isArray(response)) {
    return { rows: response };
  }

  return {
    rows: Array.isArray(response.rows) ? response.rows : [],
    offset: typeof response.offset === "number" ? response.offset : undefined,
  };
}

function formatCellValue(value: MetadataCell): ReactNode {
  if (value === null || value === undefined) return "";
  if (typeof value === "number") return value;
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "string") return value;

  if (typeof value === "object" && "kind" in value) {
    if ((value as { kind?: string }).kind === "matrix") {
      const matrixValue = (value as { value?: unknown }).value;

      if (Array.isArray(matrixValue) && matrixValue.length > 0) {
        if (Array.isArray(matrixValue[0])) {
          return `matrix ${matrixValue.length}×${matrixValue[0].length}`;
        }

        return `matrix [${matrixValue.length}]`;
      }

      return "matrix";
    }

    if ((value as { kind?: string }).kind === "image") {
      return "[image]";
    }
  }

  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function formatGallerySizeLabel(value: MetadataCell | undefined): string | null {
  if (value === null || value === undefined || value === "") return null;

  let count: number | null = null;

  if (typeof value === "number" && Number.isFinite(value)) {
    count = value;
  } else if (typeof value === "string") {
    const parsed = Number(value.trim());
    if (Number.isFinite(parsed)) {
      count = parsed;
    }
  }

  if (count === null) return null;

  const normalizedCount = Math.max(0, Math.trunc(count));
  return normalizedCount === 1 ? "1 item" : `${normalizedCount} items`;
}

type MatrixCellValue = Extract<MetadataCell, { kind: "matrix" }>;

function isMatrixCell(cell: MetadataCell): cell is MatrixCellValue {
  return typeof cell === "object" && cell !== null && (cell as any).kind === "matrix";
}


function normalizeMatrix1d(value: unknown): Array<number | string> | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  if (Array.isArray(value[0])) return null;

  return value.map((v) => {
    if (typeof v === "number" && Number.isFinite(v)) return v;
    if (typeof v === "string") return v;
    return String(v);
  });
}


function normalizeMatrix2d(value: unknown): Array<Array<number | string>> | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  if (!Array.isArray(value[0])) return null;

  const rows = value.slice(0, 4).map((row) => (Array.isArray(row) ? row.slice(0, 4) : []));
  if (!rows.length) return null;

  return rows.map((row) =>
    row.map((v) => {
      if (typeof v === "number" && Number.isFinite(v)) return v;
      if (typeof v === "string") return v;
      return String(v);
    }),
  );
}

function buildPrettyVectorText(values: Array<number | string>, maxItems = 4): string {
  const visible = values.slice(0, maxItems).map((v) => formatMatrixEntry(v));
  const suffix = values.length > maxItems ? ", …" : "";
  return `[ ${visible.join(", ")}${suffix} ]`;
}

function VectorInlineCell({ values }: { values: Array<number | string> }) {
  const text = buildPrettyVectorText(values);

  return (
    <Box
      sx={{
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
        fontSize: "0.72rem",
        lineHeight: 1.25,
        whiteSpace: "nowrap",
        color: "#0f172a",
        px: 1,
        py: 0.75,
        borderRadius: 1.5,
        border: "1px solid rgba(148,163,184,0.25)",
        backgroundColor: "rgba(248,250,252,0.9)",
        fontVariantNumeric: "tabular-nums",
        overflow: "hidden",
        textOverflow: "ellipsis",
        maxWidth: "100%",
      }}
    >
      {text}
    </Box>
  );
}

function formatMatrixEntry(v: number | string): string {
  if (typeof v === "number") {
    // compactNumberFormattingForTinyMatrices
    const abs = Math.abs(v);
    if (abs !== 0 && (abs >= 1000 || abs < 0.001)) return v.toExponential(2);
    return Number.isInteger(v) ? String(v) : v.toFixed(3).replace(/\.?0+$/, "");
  }
  return v;
}

function buildPrettyMatrixText(matrix: Array<Array<number | string>>): string {
  // buildPrettyMatrixTextAlignColumnsWithBrackets
  const formatted = matrix.map((row) => row.map((v) => formatMatrixEntry(v)));

  const cols = Math.max(1, ...formatted.map((r) => r.length));
  const colWidths = Array.from({ length: cols }, (_, c) =>
    Math.max(1, ...formatted.map((r) => (r[c] ?? "").length)),
  );

  const rowLines = formatted.map((row) => {
    const padded = Array.from({ length: cols }, (_, c) => {
      const cell = row[c] ?? "";
      return cell.toString().padStart(colWidths[c], " ");
    }).join(" ");

    return `[ ${padded} ]`;
  });

  return [...rowLines].join("\n");
}

function MatrixInlineCell({ matrix }: { matrix: Array<Array<number | string>> }) {
  const text = buildPrettyMatrixText(matrix);

  return (
    <Box
      sx={{
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
        fontSize: "0.72rem",
        lineHeight: 1.25,
        whiteSpace: "pre",
        color: "#0f172a",
        px: 1,
        py: 0.75,
        borderRadius: 1.5,
        border: "1px solid rgba(148,163,184,0.25)",
        backgroundColor: "rgba(248,250,252,0.9)",
        fontVariantNumeric: "tabular-nums",
      }}
    >
      {text}
    </Box>
  );
}


function rowIdToKey(rowId: RowId): RowIdKey {
  // normalizeRowIdKeyAcrossStringAndNumber
  return `k:${String(rowId).trim()}`;
}

function normalizeRowId(raw: unknown): RowId | null {
  // normalizeRowIdFromApi
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

function resolveMetadataRowId(_schema: MetadataTableSchema | null, row: MetadataRow): RowId | null {
  // preferBackendRowIdForStableSelectionAcrossSortingAndVirtualization
  const backendRowId = normalizeRowId((row as any)?.rowId);
  if (backendRowId != null) return backendRowId;

  // fallbackToIdColumnValueIfRowIdMissing
  if (_schema) {
    const columns = (_schema.columns ?? []) as MetadataColumnWithVisibility[];
    const idColumn =
      columns.find((c) => c.name === "id") ??
      columns.find((c) => (c.name || "").toLowerCase() === "id");

    if (idColumn) {
      const candidate = row.values?.[idColumn.index];
      const normalized = normalizeRowId(candidate);
      if (normalized != null) return normalized;
    }
  }

  // lastResortFallback
  return normalizeRowId((row as any)?.id);
}

function getSchemaActions(schema: MetadataTableSchema | null): string[] {
  if (!schema) return [];
  const rawActions = (schema as MetadataTableSchema & { actions?: unknown }).actions;
  if (!Array.isArray(rawActions)) return [];
  return rawActions.filter(
    (item): item is string => typeof item === "string" && item.trim().length > 0,
  );
}

function getOperatorLabel(op: CriteriaOperator): string {
  if (op === "equals") return "Equals";
  if (op === "notEquals") return "Not equals";
  if (op === "contains") return "Contains";
  if (op === "startsWith") return "Starts with";
  if (op === "endsWith") return "Ends with";
  if (op === "regex") return "Regex";
  if (op === "isEmpty") return "Is empty";
  if (op === "isNotEmpty") return "Is not empty";
  if (op === "isImage") return "Is image";
  if (op === "isNotImage") return "Is not image";
  if (op === "gt") return "Greater than";
  if (op === "gte") return "Greater or equal";
  if (op === "lt") return "Less than";
  if (op === "lte") return "Less or equal";
  if (op === "between") return "Between";
  return op;
}

function getSetOpLabel(op: SelectionSetOp): string {
  if (op === "replace") return "Replace selection";
  if (op === "add") return "Add to selection";
  if (op === "remove") return "Remove from selection";
  return "Intersect with selection";
}

function getScopeLabel(scope: SelectionScope): string {
  if (scope === "allRows") return "All rows";
  return "Current selection only";
}

/* ======================= Selection helpers ======================= */

function useProjectServiceRef() {
  const svc = useProjectService();
  const svcRef = useRef(svc);

  useEffect(() => {
    // keepServiceRefUpdated
    svcRef.current = svc;
  }, [svc]);

  return svcRef;
}

function indicesToRanges(indices: number[]): IndexRange[] {
  // indicesToRangesMerged
  if (indices.length === 0) return [];

  const sorted = Array.from(new Set(indices)).sort((a, b) => a - b);
  const ranges: IndexRange[] = [];

  let start = sorted[0];
  let end = sorted[0];

  for (let i = 1; i < sorted.length; i += 1) {
    const v = sorted[i];
    if (v === end + 1) {
      end = v;
    } else {
      ranges.push({ start, end });
      start = v;
      end = v;
    }
  }

  ranges.push({ start, end });
  return ranges;
}

function selectionStateToSelectedRanges(selectionState: RowSelectionState, totalRows: number): IndexRange[] {
  // selectionStateToSelectedRanges
  const base = mergeRanges(selectionState.ranges);

  if (selectionState.baseMode === "none") {
    return base;
  }

  // baseMode="all": selected = [0..totalRows-1] minus excluded(base)
  if (totalRows <= 0) return [];

  const selected: IndexRange[] = [];
  let cursor = 0;

  for (const ex of base) {
    if (cursor < ex.start) {
      selected.push({ start: cursor, end: ex.start - 1 });
    }
    cursor = ex.end + 1;
    if (cursor >= totalRows) break;
  }

  if (cursor <= totalRows - 1) {
    selected.push({ start: cursor, end: totalRows - 1 });
  }

  return selected;
}

function intersectRanges(a: IndexRange[], b: IndexRange[]): IndexRange[] {
  // intersectRanges
  const out: IndexRange[] = [];
  let i = 0;
  let j = 0;

  while (i < a.length && j < b.length) {
    const A = a[i];
    const B = b[j];

    const start = Math.max(A.start, B.start);
    const end = Math.min(A.end, B.end);

    if (start <= end) out.push({ start, end });

    if (A.end < B.end) i += 1;
    else j += 1;
  }

  return out;
}

function subtractRanges(base: IndexRange[], remove: IndexRange[]): IndexRange[] {
  // subtractRanges
  const out: IndexRange[] = [];
  let j = 0;

  for (const A of base) {
    let cursor = A.start;

    while (j < remove.length && remove[j].end < cursor) j += 1;

    let k = j;
    while (k < remove.length && remove[k].start <= A.end) {
      const R = remove[k];

      if (R.start > cursor) {
        out.push({ start: cursor, end: Math.min(A.end, R.start - 1) });
      }

      cursor = Math.max(cursor, R.end + 1);
      if (cursor > A.end) break;

      k += 1;
    }

    if (cursor <= A.end) {
      out.push({ start: cursor, end: A.end });
    }
  }

  return out;
}

function clampIndex(value: number, minValue: number, maxValue: number): number {
  if (value < minValue) return minValue;
  if (value > maxValue) return maxValue;
  return value;
}

function normalizeRange(start: number, end: number): IndexRange {
  return start <= end ? { start, end } : { start: end, end: start };
}

function mergeRanges(ranges: IndexRange[]): IndexRange[] {
  if (!ranges.length) return [];

  const sorted = [...ranges].sort((a, b) => a.start - b.start || a.end - b.end);
  const merged: IndexRange[] = [{ ...sorted[0] }];

  for (let index = 1; index < sorted.length; index += 1) {
    const current = sorted[index];
    const last = merged[merged.length - 1];

    if (current.start <= last.end + 1) {
      last.end = Math.max(last.end, current.end);
    } else {
      merged.push({ ...current });
    }
  }

  return merged;
}

function addRangeToRanges(ranges: IndexRange[], nextRange: IndexRange): IndexRange[] {
  return mergeRanges([...ranges, nextRange]);
}

function isIndexInRanges(ranges: IndexRange[], index: number): boolean {
  for (const range of ranges) {
    if (index < range.start) return false;
    if (index <= range.end) return true;
  }
  return false;
}

function toggleSingleIndexInRanges(ranges: IndexRange[], index: number): IndexRange[] {
  const next: IndexRange[] = [];

  for (let rangeIndex = 0; rangeIndex < ranges.length; rangeIndex += 1) {
    const range = ranges[rangeIndex];

    if (index < range.start || index > range.end) {
      next.push({ ...range });
      continue;
    }

    if (range.start === range.end && range.start === index) {
      // removeExactSingleRange
    } else if (index === range.start) {
      next.push({ start: range.start + 1, end: range.end });
    } else if (index === range.end) {
      next.push({ start: range.start, end: range.end - 1 });
    } else {
      next.push({ start: range.start, end: index - 1 });
      next.push({ start: index + 1, end: range.end });
    }

    for (let tailIndex = rangeIndex + 1; tailIndex < ranges.length; tailIndex += 1) {
      next.push({ ...ranges[tailIndex] });
    }

    return next;
  }

  return addRangeToRanges(next, { start: index, end: index });
}

function countIndicesInRanges(ranges: IndexRange[]): number {
  let total = 0;
  for (const range of ranges) {
    total += range.end - range.start + 1;
  }
  return total;
}

function isRowIndexSelected(selectionState: RowSelectionState, rowIndex: number): boolean {
  const inRanges = isIndexInRanges(selectionState.ranges, rowIndex);
  return selectionState.baseMode === "all" ? !inRanges : inRanges;
}

function getSelectionCount(selectionState: RowSelectionState, totalRows: number): number {
  const covered = countIndicesInRanges(selectionState.ranges);
  if (selectionState.baseMode === "all") {
    return Math.max(0, totalRows - covered);
  }
  return covered;
}

function createEmptySelectionState(): RowSelectionState {
  return {
    baseMode: "none",
    ranges: [],
    anchorIndex: null,
  };
}

function parsePositiveInt(value: string): number | null {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return null;
  if (parsed <= 0) return null;
  return parsed;
}

function isCellEmpty(cell: MetadataCell): boolean {
  if (cell === null || cell === undefined) return true;
  if (cell === "") return true;
  return false;
}

function isImageCell(cell: MetadataCell): boolean {
  return (
    typeof cell === "object" &&
    !!cell &&
    "kind" in (cell as any) &&
    (cell as any).kind === "image"
  );
}

function cellToComparableString(cell: MetadataCell): string {
  if (cell === null || cell === undefined) return "";
  if (typeof cell === "string") return cell;
  if (typeof cell === "number") return String(cell);
  if (typeof cell === "boolean") return cell ? "true" : "false";

  if (typeof cell === "object" && cell && "kind" in (cell as any)) {
    const kind = (cell as any).kind;
    if (kind === "image") return "[image]";
    if (kind === "matrix") return "[matrix]";
  }

  try {
    return JSON.stringify(cell);
  } catch {
    return String(cell);
  }
}

function cellToNumber(cell: MetadataCell): number | null {
  if (cell === null || cell === undefined) return null;
  if (typeof cell === "number") return Number.isFinite(cell) ? cell : null;

  if (typeof cell === "string") {
    const parsed = parseNumberInput(cell);
    return parsed;
  }

  return null;
}

function parseNumberInput(raw: string): number | null {
  // parseNumberInputSupportsCommaDecimal
  const trimmed = raw.trim();
  if (!trimmed) return null;

  const noSpaces = trimmed.replace(/\s+/g, "");

  // If both "," and "." exist, assume "," is thousands separator: "1,234.56"
  if (noSpaces.includes(",") && noSpaces.includes(".")) {
    const n = Number(noSpaces.replace(/,/g, ""));
    return Number.isFinite(n) ? n : null;
  }

  // If only "," exists, treat as decimal separator: "1,23"
  if (noSpaces.includes(",") && !noSpaces.includes(".")) {
    const n = Number(noSpaces.replace(",", "."));
    return Number.isFinite(n) ? n : null;
  }

  const n = Number(noSpaces);
  return Number.isFinite(n) ? n : null;
}

function clampZoomPercent(value: number): number {
  if (!Number.isFinite(value)) return 100;
  return Math.min(ZOOM_MAX_PERCENT, Math.max(ZOOM_MIN_PERCENT, Math.round(value)));
}

function isNumericOperator(op: CriteriaOperator): boolean {
  return op === "gt" || op === "gte" || op === "lt" || op === "lte" || op === "between";
}

function evaluateCriteria(
  cell: MetadataCell,
  operator: CriteriaOperator,
  value1: string,
  value2: string,
  options: { caseSensitive: boolean; treatAsNumber: boolean; negate: boolean },
): boolean {
  const { caseSensitive, treatAsNumber, negate } = options;

  const evalBase = (): boolean => {
    if (operator === "isEmpty") return isCellEmpty(cell);
    if (operator === "isNotEmpty") return !isCellEmpty(cell);
    if (operator === "isImage") return isImageCell(cell);
    if (operator === "isNotImage") return !isImageCell(cell);

    if (isNumericOperator(operator)) {
      if (!treatAsNumber) return false;

      const cellNum = cellToNumber(cell);
      if (cellNum == null) return false;

      const v1 = parseNumberInput(value1);
      if (v1 == null) return false;

      if (operator === "between") {
        const v2 = parseNumberInput(value2);
        if (v2 == null) return false;
        const min = Math.min(v1, v2);
        const max = Math.max(v1, v2);
        return cellNum >= min && cellNum <= max;
      }

      if (operator === "gt") return cellNum > v1;
      if (operator === "gte") return cellNum >= v1;
      if (operator === "lt") return cellNum < v1;
      return cellNum <= v1;
    }

    const cellStrRaw = cellToComparableString(cell).trim();
    const v1Raw = value1.trim();
    const a = caseSensitive ? cellStrRaw : cellStrRaw.toLowerCase();
    const b1 = caseSensitive ? v1Raw : v1Raw.toLowerCase();

    if (operator === "equals") return a === b1;
    if (operator === "notEquals") return a !== b1;
    if (operator === "contains") return a.includes(b1);
    if (operator === "startsWith") return a.startsWith(b1);
    if (operator === "endsWith") return a.endsWith(b1);

    if (operator === "regex") {
      try {
        const re = new RegExp(value1, caseSensitive ? "" : "i");
        return re.test(cellStrRaw);
      } catch {
        return false;
      }
    }

    return false;
  };

  const result = evalBase();
  return negate ? !result : result;
}

function applySetOperationToIdMaps(params: {
  prevKeys: Set<RowIdKey>;
  prevMap: Map<RowIdKey, RowId>;
  matchKeys: Set<RowIdKey>;
  matchMap: Map<RowIdKey, RowId>;
  setOp: SelectionSetOp;
}): { keys: Set<RowIdKey>; map: Map<RowIdKey, RowId> } {
  const { prevKeys, prevMap, matchKeys, matchMap, setOp } = params;

  if (setOp === "replace") {
    return { keys: new Set(matchKeys), map: new Map(matchMap) };
  }

  if (setOp === "add") {
    const keys = new Set(prevKeys);
    const map = new Map(prevMap);
    for (const key of matchKeys) {
      keys.add(key);
      const id = matchMap.get(key);
      if (id != null) map.set(key, id);
    }
    return { keys, map };
  }

  if (setOp === "remove") {
    const keys = new Set<RowIdKey>();
    const map = new Map<RowIdKey, RowId>();
    for (const key of prevKeys) {
      if (!matchKeys.has(key)) {
        keys.add(key);
        const id = prevMap.get(key);
        if (id != null) map.set(key, id);
      }
    }
    return { keys, map };
  }

  // intersect
  const keys = new Set<RowIdKey>();
  const map = new Map<RowIdKey, RowId>();
  for (const key of prevKeys) {
    if (matchKeys.has(key)) {
      keys.add(key);
      const id = prevMap.get(key) ?? matchMap.get(key);
      if (id != null) map.set(key, id);
    }
  }
  return { keys, map };
}

/* ======================= Cache helpers ======================= */

function getImageCacheEntry(
  cache: Map<string, ImageCacheEntry>,
  key: string,
): ImageCacheEntry | null {
  const entry = cache.get(key);
  if (!entry) return null;

  cache.delete(key);
  cache.set(key, entry);
  return entry;
}

function setImageCacheEntry(
  cache: Map<string, ImageCacheEntry>,
  key: string,
  entry: ImageCacheEntry,
) {
  const existing = cache.get(key);
  if (existing && existing !== entry) {
    existing.revoke();
  }

  cache.delete(key);
  cache.set(key, entry);

  while (cache.size > MAX_IMAGE_CACHE_ENTRIES) {
    const oldestKey = cache.keys().next().value as string | undefined;
    if (!oldestKey) break;

    const oldestEntry = cache.get(oldestKey);
    cache.delete(oldestKey);
    if (oldestEntry) {
      oldestEntry.revoke();
    }
  }
}

/* ======================= Shared hooks ======================= */

function useIsMountedRef() {
  const isMountedRef = useRef(true);

  useEffect(() => {
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  return isMountedRef;
}

function useElementSize<T extends Element>(ref: { current: T | null }, refreshKey?: unknown) {
  const [size, setSize] = useState({ width: 0, height: 0 });

  useEffect(() => {
    const element = ref.current;

    if (!element) {
      setSize({ width: 0, height: 0 });
      return;
    }

    const resizeObserver = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect;
      if (!rect) return;
      setSize((prev) => {
        if (prev.width === rect.width && prev.height === rect.height) {
          return prev;
        }

        return { width: rect.width, height: rect.height };
      });
    });

    resizeObserver.observe(element);

    return () => {
      resizeObserver.disconnect();
    };
  }, [ref, refreshKey]);

  return size;
}

function useImageCache() {
  const imageCacheRef = useRef<Map<string, ImageCacheEntry>>(new Map());

  const clearImageCache = useCallback(() => {
    for (const [, entry] of imageCacheRef.current) {
      entry.revoke();
    }
    imageCacheRef.current.clear();
  }, []);

  useEffect(() => {
    return () => {
      clearImageCache();
    };
  }, [clearImageCache]);

  return { imageCacheRef, clearImageCache };
}

/* ======================= Data hooks ======================= */

function useMetadataTables(
  projectId: number,
  protocolId: number,
  outputName: string,
  isMountedRef: MutableRefObject<boolean>,
) {
  const [tables, setTables] = useState<MetadataTableInfo[] | null>(null);
  const [tablesLoading, setTablesLoading] = useState(false);
  const [tablesError, setTablesError] = useState<string | null>(null);
  const [selectedTable, setSelectedTable] = useState<string | "">("");
  const svcRef = useProjectServiceRef();

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        setTablesLoading(true);
        setTablesError(null);

        const list = await svcRef.current.fetchOutputMetadataTables(projectId, protocolId, outputName);
        if (cancelled || !isMountedRef.current) return;

        const safeList = list || [];
        setTables(safeList);

        setSelectedTable((prev) => {
          if (!safeList.length) return "";
          if (prev && safeList.some((table) => table.name === prev)) return prev;
          return safeList[0].name;
        });
      } catch (error) {
        if (cancelled || !isMountedRef.current) return;

        setTables([]);
        setTablesError(getErrorMessage(error, "Failed to load metadata tables"));
        setSelectedTable("");
      } finally {
        if (!cancelled && isMountedRef.current) {
          setTablesLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [projectId, protocolId, outputName, isMountedRef, svcRef]);

  return {
    tables,
    tablesLoading,
    tablesError,
    selectedTable,
    setSelectedTable,
  };
}

function useMetadataSchema(
  projectId: number,
  protocolId: number,
  outputName: string,
  selectedTable: string,
  isMountedRef: MutableRefObject<boolean>,
) {
  const [schema, setSchema] = useState<MetadataTableSchema | null>(null);
  const [schemaLoading, setSchemaLoading] = useState(false);
  const [schemaError, setSchemaError] = useState<string | null>(null);
  const svcRef = useProjectServiceRef();

  useEffect(() => {
    if (!selectedTable) {
      setSchema(null);
      setSchemaLoading(false);
      setSchemaError(null);
      return;
    }

    let cancelled = false;

    void (async () => {
      try {
        setSchemaLoading(true);
        setSchemaError(null);

        const nextSchema = await svcRef.current.fetchMetadataTableSchema(
          projectId,
          protocolId,
          outputName,
          selectedTable,
        );

        if (cancelled || !isMountedRef.current) return;
        setSchema(nextSchema);
      } catch (error) {
        if (cancelled || !isMountedRef.current) return;

        setSchema(null);
        setSchemaError(getErrorMessage(error, "Failed to load metadata schema"));
      } finally {
        if (!cancelled && isMountedRef.current) {
          setSchemaLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [projectId, protocolId, outputName, selectedTable, isMountedRef, svcRef]);

  return {
    schema,
    setSchema,
    schemaLoading,
    schemaError,
    setSchemaError,
  };
}

function useColumnSettings(schema: MetadataTableSchema | null, selectedTable: string) {
  const [columnSettings, setColumnSettings] = useState<Record<string, ColumnSettings>>({});

  useEffect(() => {
    if (!schema) {
      setColumnSettings({});
      return;
    }

    setColumnSettings((prev) => {
      const next: Record<string, ColumnSettings> = {};
      const columns = (schema.columns ?? []) as MetadataColumnWithVisibility[];

      for (const column of columns) {
        const previousEntry = prev[column.name];
        const defaultVisible = column.visible !== false;
        const defaultRenderAsImage = column.rendererType === "image";

        next[column.name] = {
          visible: previousEntry?.visible ?? defaultVisible,
          renderAsImage: previousEntry?.renderAsImage ?? defaultRenderAsImage,
        };
      }

      return next;
    });
  }, [schema, selectedTable]);

  return { columnSettings, setColumnSettings };
}

function useVirtualTableWindow(params: {
  projectId: number;
  protocolId: number;
  outputName: string;
  selectedTable: string;
  schema: MetadataTableSchema | null;
  totalRows: number;
  viewMode: ViewMode;
  rowHeight: number;
  rowSizeForScroll: number;
  desiredWindowSize: number;
  scrollRef: MutableRefObject<HTMLDivElement | null>;
  isMountedRef: MutableRefObject<boolean>;
  sortBy: string | null;
  sortAsc: boolean;
}) {
  const {
    projectId,
    protocolId,
    outputName,
    selectedTable,
    schema,
    totalRows,
    viewMode,
    rowHeight,
    rowSizeForScroll,
    desiredWindowSize,
    scrollRef,
    isMountedRef,
    sortBy,
    sortAsc,
  } = params;

  const [windowRows, setWindowRows] = useState<MetadataRow[]>([]);
  const [windowOffset, setWindowOffset] = useState(0);
  const [windowLoading, setWindowLoading] = useState(false);
  const [windowError, setWindowError] = useState<string | null>(null);

  const windowRequestInFlightRef = useRef(false);
  const pendingWindowOffsetRef = useRef<number | null>(null);
  const inFlightOffsetRef = useRef<number | null>(null); // preventDuplicateFetchOnSameOffset
  const windowEpochRef = useRef(0);
  const viewModeRef = useRef<ViewMode>(viewMode);
  const hasWindowRowsRef = useRef(false);
  const latestWindowTargetRef = useRef(0);

  useEffect(() => {
    viewModeRef.current = viewMode;
  }, [viewMode]);

  const desiredWindowSizeRef = useRef(desiredWindowSize);
  const svcRef = useProjectServiceRef();

  useEffect(() => {
    desiredWindowSizeRef.current = desiredWindowSize;
  }, [desiredWindowSize]);

  const invalidateWindowState = useCallback((options?: { keepRows?: boolean }) => {
    windowEpochRef.current += 1;
    windowRequestInFlightRef.current = false;
    pendingWindowOffsetRef.current = null;
    inFlightOffsetRef.current = null;
    latestWindowTargetRef.current = 0;

    setWindowLoading(false);
    setWindowError(null);

    if (!options?.keepRows) {
      hasWindowRowsRef.current = false;
      setWindowRows([]);
      setWindowOffset(0);
    }
  }, []);

  const loadWindow = useCallback(
    async (requestedOffset: number) => {
      if (!selectedTable || totalRows <= 0) return;

      const limit = desiredWindowSizeRef.current || 60;
      const maxOffset = Math.max(0, totalRows - limit);
      const clampedOffset = Math.min(Math.max(0, requestedOffset), maxOffset);

      latestWindowTargetRef.current = clampedOffset;

      if (windowRequestInFlightRef.current) {
        // avoidQueuingSameOffsetTwice
        if (inFlightOffsetRef.current === clampedOffset) {
          return;
        }
        if (pendingWindowOffsetRef.current === clampedOffset) {
          return;
        }
        pendingWindowOffsetRef.current = clampedOffset;
        return;
      }

      const requestEpoch = windowEpochRef.current;
      const showLoading = !hasWindowRowsRef.current;

      windowRequestInFlightRef.current = true;
      inFlightOffsetRef.current = clampedOffset; // trackInFlightOffset

      if (showLoading) {
        setWindowLoading(true);
      }

      setWindowError(null);

      try {
        const response = (await svcRef.current.fetchMetadataTableWindow(
          projectId,
          protocolId,
          outputName,
          selectedTable,
          {
            offset: clampedOffset,
            limit,
            selectionOnly: false,
            sortBy: sortBy ?? undefined,
            asc: sortBy ? sortAsc : undefined,
          },
        )) as MetadataWindowResponse;

        if (!isMountedRef.current || requestEpoch !== windowEpochRef.current) {
          return;
        }

        const parsed = parseWindowResponse(response);

        if (clampedOffset !== latestWindowTargetRef.current) {
          return;
        }

        hasWindowRowsRef.current = parsed.rows.length > 0;
        setWindowRows(parsed.rows);
        setWindowOffset(parsed.offset ?? clampedOffset);
      } catch (error) {
        if (!isMountedRef.current || requestEpoch !== windowEpochRef.current) {
          return;
        }

        if (clampedOffset !== latestWindowTargetRef.current) {
          return;
        }

        hasWindowRowsRef.current = false;
        setWindowRows([]);
        setWindowError(getErrorMessage(error, "Failed to load rows"));
      } finally {
        if (!isMountedRef.current || requestEpoch !== windowEpochRef.current) {
          return;
        }

        const pendingOffset = pendingWindowOffsetRef.current;
        pendingWindowOffsetRef.current = null;

        const shouldLoadPending =
          pendingOffset != null &&
          pendingOffset === latestWindowTargetRef.current &&
          totalRows > 0;

        windowRequestInFlightRef.current = false;
        inFlightOffsetRef.current = null;

        if (showLoading && !shouldLoadPending) {
          setWindowLoading(false);
        }

        if (shouldLoadPending) {
          void loadWindow(pendingOffset);
        }
      }
    },
    [
      isMountedRef,
      outputName,
      projectId,
      protocolId,
      selectedTable,
      totalRows,
      svcRef,
      sortBy,
      sortAsc,
    ],
  );

  useEffect(() => {
    invalidateWindowState({ keepRows: true });

    if (!schema || !selectedTable || totalRows === 0) return;
    if (viewModeRef.current === "table") {
      void loadWindow(0);
    }
  }, [schema, selectedTable, totalRows, sortBy, sortAsc, loadWindow, invalidateWindowState]);


  useEffect(() => {
    if (
      viewMode !== "table" ||
      !schema ||
      !selectedTable ||
      totalRows <= 0 ||
      windowRows.length > 0 ||
      windowLoading ||
      windowError
    ) {
      return;
    }

    const container = scrollRef.current;
    const scrollTop = container?.scrollTop ?? 0;
    const effectiveRowSize = rowSizeForScroll || rowHeight || NORMAL_ROW_HEIGHT;
    const firstVisible = Math.floor(scrollTop / effectiveRowSize);

    const limit = desiredWindowSizeRef.current || 60;
    const buffer = Math.floor(limit / 3);
    const maxOffset = Math.max(0, totalRows - limit);

    let targetOffset = firstVisible - buffer;
    if (targetOffset < 0) targetOffset = 0;
    if (targetOffset > maxOffset) targetOffset = maxOffset;

    void loadWindow(targetOffset);
  }, [
    viewMode,
    schema,
    selectedTable,
    totalRows,
    windowRows.length,
    windowLoading,
    windowError,
    rowSizeForScroll,
    rowHeight,
    scrollRef,
    loadWindow,
  ]);

  const handleScroll = useCallback<UIEventHandler<HTMLDivElement>>(
    (event) => {
      if (!schema || !selectedTable || totalRows === 0) return;

      const effectiveRowSize = rowSizeForScroll || rowHeight || NORMAL_ROW_HEIGHT;
      if (effectiveRowSize <= 0) return;

      const element = event.currentTarget;
      const firstVisible = Math.floor(element.scrollTop / effectiveRowSize);

      const limit = desiredWindowSizeRef.current || windowRows.length || 60;
      const buffer = Math.floor(limit / 3);
      const maxOffset = Math.max(0, totalRows - limit);

      let targetOffset = firstVisible - buffer;
      if (targetOffset < 0) targetOffset = 0;
      if (targetOffset > maxOffset) targetOffset = maxOffset;

      const distance = Math.abs(targetOffset - windowOffset);
      if (distance < Math.max(5, Math.floor(buffer / 2))) {
        return;
      }

      void loadWindow(targetOffset);
    },
    [
      schema,
      selectedTable,
      totalRows,
      rowSizeForScroll,
      rowHeight,
      windowRows.length,
      windowOffset,
      loadWindow,
    ],
  );

  const jumpToRowIndex = useCallback(
    (rowIndex: number) => {
      if (!schema || !selectedTable || totalRows <= 0) return;

      const effectiveRowSize = rowSizeForScroll || rowHeight || NORMAL_ROW_HEIGHT;
      const limit = desiredWindowSizeRef.current || windowRows.length || 60;
      const buffer = Math.floor(limit / 3);
      const maxOffset = Math.max(0, totalRows - limit);

      const safeRowIndex = Math.min(Math.max(0, rowIndex), Math.max(0, totalRows - 1));

      let targetOffset = safeRowIndex - buffer;
      if (targetOffset < 0) targetOffset = 0;
      if (targetOffset > maxOffset) targetOffset = maxOffset;

      const container = scrollRef.current;
      if (container && effectiveRowSize > 0) {
        container.scrollTop = safeRowIndex * effectiveRowSize;
      }

      void loadWindow(targetOffset);
    },
    [
      schema,
      selectedTable,
      totalRows,
      rowSizeForScroll,
      rowHeight,
      windowRows.length,
      scrollRef,
      loadWindow,
    ],
  );

  return {
    windowRows,
    windowOffset,
    windowLoading,
    windowError,
    handleScroll,
    invalidateWindowState,
    jumpToRowIndex,
  };
}

function useMetadataGalleryRows(params: {
  projectId: number;
  protocolId: number;
  outputName: string;
  selectedTable: string;
  schema: MetadataTableSchema | null;
  totalRows: number;
  viewMode: ViewMode;
  isMountedRef: MutableRefObject<boolean>;
  sortBy: string | null;
  sortAsc: boolean;
  anchorRowIndex: number | null;
}) {
  const {
    projectId,
    protocolId,
    outputName,
    selectedTable,
    schema,
    totalRows,
    viewMode,
    isMountedRef,
    sortBy,
    sortAsc,
  } = params;

  const [galleryRows, setGalleryRows] = useState<MetadataRow[]>([]);
  const [galleryNextOffset, setGalleryNextOffset] = useState(0);
  const [galleryLoading, setGalleryLoading] = useState(false);
  const [galleryError, setGalleryError] = useState<string | null>(null);
  const [galleryHasMore, setGalleryHasMore] = useState(false);

  const [galleryBaseOffset, setGalleryBaseOffset] = useState(0);
  const galleryBaseOffsetRef = useRef(0);

  useEffect(() => {
    // keepGalleryBaseOffsetRefUpdated
    galleryBaseOffsetRef.current = galleryBaseOffset;
  }, [galleryBaseOffset]);

  const galleryRequestInFlightRef = useRef(false);
  const galleryEpochRef = useRef(0);
  const svcRef = useProjectServiceRef();

  const invalidateGalleryState = useCallback(() => {
    galleryEpochRef.current += 1;
    galleryRequestInFlightRef.current = false;
    setGalleryRows([]);
    setGalleryNextOffset(0);
    setGalleryLoading(false);
    setGalleryError(null);
    setGalleryHasMore(false);
    setGalleryBaseOffset(0);
  }, []);

  const loadGalleryChunk = useCallback(
    async (offset: number) => {
      if (!selectedTable || !schema || totalRows === 0) return;
      if (galleryRequestInFlightRef.current) return;

      const remaining = totalRows - offset;
      if (remaining <= 0) {
        setGalleryHasMore(false);
        return;
      }

      const limit = Math.min(GALLERY_PAGE_SIZE, remaining);
      const requestEpoch = galleryEpochRef.current;

      galleryRequestInFlightRef.current = true;
      setGalleryLoading(true);
      setGalleryError(null);

      try {
        const response = (await svcRef.current.fetchMetadataTableWindow(
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
        )) as MetadataWindowResponse;

        if (!isMountedRef.current || requestEpoch !== galleryEpochRef.current) {
          return;
        }

        const parsed = parseWindowResponse(response);

        const baseOffset = galleryBaseOffsetRef.current;
        setGalleryRows((prev) => (offset === baseOffset ? parsed.rows : [...prev, ...parsed.rows]));

        const nextOffset = offset + parsed.rows.length;
        setGalleryNextOffset(nextOffset);
        setGalleryHasMore(nextOffset < totalRows);
      } catch (error) {
        if (!isMountedRef.current || requestEpoch !== galleryEpochRef.current) {
          return;
        }

        setGalleryError(getErrorMessage(error, "Failed to load gallery images"));
      } finally {
        if (!isMountedRef.current || requestEpoch !== galleryEpochRef.current) {
          return;
        }

        setGalleryLoading(false);
        galleryRequestInFlightRef.current = false;
      }
    },
    [
      isMountedRef,
      outputName,
      projectId,
      protocolId,
      schema,
      selectedTable,
      totalRows,
      svcRef,
      sortBy,
      sortAsc,
    ],
  );

  useEffect(() => {
    invalidateGalleryState();

    if (!schema || !selectedTable || totalRows === 0) return;
    if (viewMode !== "gallery") return;

    const maxIndex = Math.max(0, totalRows - 1);
    const safeAnchor =
      params.anchorRowIndex == null ? 0 : clampIndex(params.anchorRowIndex, 0, maxIndex);

    const buffer = Math.floor(GALLERY_PAGE_SIZE / 2);
    const maxStartOffset = Math.max(0, totalRows - GALLERY_PAGE_SIZE);

    let startOffset = safeAnchor - buffer;
    if (startOffset < 0) startOffset = 0;
    if (startOffset > maxStartOffset) startOffset = maxStartOffset;

    setGalleryBaseOffset(startOffset);
    void loadGalleryChunk(startOffset);
  }, [
    schema,
    selectedTable,
    totalRows,
    viewMode,
    sortBy,
    sortAsc,
    params.anchorRowIndex,
    invalidateGalleryState,
    loadGalleryChunk,
  ]);

  useEffect(() => {
    if (
      viewMode === "gallery" &&
      schema &&
      selectedTable &&
      totalRows > 0 &&
      galleryRows.length === 0 &&
      !galleryLoading &&
      !galleryError
    ) {
      void loadGalleryChunk(galleryBaseOffsetRef.current);
    }
  }, [
    viewMode,
    schema,
    selectedTable,
    totalRows,
    galleryRows.length,
    galleryLoading,
    galleryError,
    loadGalleryChunk,
  ]);

  const handleGalleryScroll = useCallback<UIEventHandler<HTMLDivElement>>(
    (event) => {
      if (!galleryHasMore || galleryLoading) return;

      const element = event.currentTarget;
      if (element.scrollTop + element.clientHeight >= element.scrollHeight - 400) {
        void loadGalleryChunk(galleryNextOffset);
      }
    },
    [galleryHasMore, galleryLoading, galleryNextOffset, loadGalleryChunk],
  );

  return {
    galleryRows,
    galleryLoading,
    galleryError,
    galleryHasMore,
    handleGalleryScroll,
    invalidateGalleryState,
    galleryBaseOffset,
  };
}

function useRowSelection(totalRows: number) {
  const [selectionState, setSelectionState] = useState<RowSelectionState>(createEmptySelectionState());

  const setSelectionRanges = useCallback((ranges: IndexRange[]) => {
    // setSelectionRangesReplace
    const merged = mergeRanges(ranges);
    setSelectionState({
      baseMode: "none",
      ranges: merged,
      anchorIndex: merged.length ? merged[0].start : null,
    });
  }, []);


  const isRowSelected = useCallback(
    (rowIndex: number) => isRowIndexSelected(selectionState, rowIndex),
    [selectionState],
  );

  const selectedCount = useMemo(
    () => getSelectionCount(selectionState, totalRows),
    [selectionState, totalRows],
  );

  const clearSelection = useCallback(() => {
    setSelectionState(createEmptySelectionState());
  }, []);

  const selectOnly = useCallback((rowIndex: number) => {
    setSelectionState({
      baseMode: "none",
      ranges: [{ start: rowIndex, end: rowIndex }],
      anchorIndex: rowIndex,
    });
  }, []);

  const handlePrimaryRowClick = useCallback(
    (rowIndex: number, event: ReactMouseEvent<Element>) => {
      if (totalRows <= 0) return;

      const maxIndex = Math.max(0, totalRows - 1);
      const safeIndex = clampIndex(rowIndex, 0, maxIndex);

      const isToggle = event.ctrlKey || event.metaKey;
      const isRange = event.shiftKey;

      setSelectionState((prev) => {
        const anchor = prev.anchorIndex ?? safeIndex;

        if (isRange) {
          const nextRange = normalizeRange(anchor, safeIndex);

          if (isToggle && prev.baseMode === "none") {
            return {
              ...prev,
              ranges: addRangeToRanges(prev.ranges, nextRange),
              anchorIndex: anchor,
            };
          }

          return {
            baseMode: "none",
            ranges: [nextRange],
            anchorIndex: anchor,
          };
        }

        if (isToggle) {
          return {
            ...prev,
            ranges: toggleSingleIndexInRanges(prev.ranges, safeIndex),
            anchorIndex: safeIndex,
          };
        }

        return {
          baseMode: "none",
          ranges: [{ start: safeIndex, end: safeIndex }],
          anchorIndex: safeIndex,
        };
      });
    },
    [totalRows],
  );

  const selectAll = useCallback(() => {
    setSelectionState((prev) => ({
      baseMode: "all",
      ranges: [],
      anchorIndex: prev.anchorIndex,
    }));
  }, []);

  const selectFromHere = useCallback(
    (rowIndex: number) => {
      if (totalRows <= 0) return;
      const maxIndex = Math.max(0, totalRows - 1);
      const safeIndex = clampIndex(rowIndex, 0, maxIndex);

      setSelectionState({
        baseMode: "none",
        ranges: [{ start: safeIndex, end: maxIndex }],
        anchorIndex: safeIndex,
      });
    },
    [totalRows],
  );

  const selectToHere = useCallback(
    (rowIndex: number) => {
      if (totalRows <= 0) return;
      const maxIndex = Math.max(0, totalRows - 1);
      const safeIndex = clampIndex(rowIndex, 0, maxIndex);

      setSelectionState({
        baseMode: "none",
        ranges: [{ start: 0, end: safeIndex }],
        anchorIndex: safeIndex,
      });
    },
    [totalRows],
  );

  const invertSelection = useCallback(() => {
    setSelectionState((prev) => ({
      ...prev,
      baseMode: prev.baseMode === "all" ? "none" : "all",
    }));
  }, []);

  const selectRange = useCallback(
    (startIndex: number, endIndex: number) => {
      if (totalRows <= 0) return;
      const maxIndex = Math.max(0, totalRows - 1);

      const safeStart = clampIndex(startIndex, 0, maxIndex);
      const safeEnd = clampIndex(endIndex, 0, maxIndex);

      const range = normalizeRange(safeStart, safeEnd);

      setSelectionState({
        baseMode: "none",
        ranges: [range],
        anchorIndex: range.start,
      });
    },
    [totalRows],
  );

  const selectIndexCompare = useCallback(
    (mode: "gte" | "lte" | "gt" | "lt", valueOneBased: number) => {
      if (totalRows <= 0) return;
      const maxIndex = Math.max(0, totalRows - 1);

      const v = clampIndex(valueOneBased - 1, 0, maxIndex);

      if (mode === "gte") {
        setSelectionState({ baseMode: "none", ranges: [{ start: v, end: maxIndex }], anchorIndex: v });
        return;
      }

      if (mode === "gt") {
        const start = clampIndex(v + 1, 0, maxIndex);
        setSelectionState({
          baseMode: "none",
          ranges: [{ start, end: maxIndex }],
          anchorIndex: start,
        });
        return;
      }

      if (mode === "lte") {
        setSelectionState({ baseMode: "none", ranges: [{ start: 0, end: v }], anchorIndex: v });
        return;
      }

      const end = clampIndex(v - 1, 0, maxIndex);
      setSelectionState({ baseMode: "none", ranges: [{ start: 0, end }], anchorIndex: end });
    },
    [totalRows],
  );

  return {
    selectionState,
    isRowSelected,
    selectedCount,
    clearSelection,
    selectOnly,
    handlePrimaryRowClick,
    selectAll,
    selectFromHere,
    selectToHere,
    invertSelection,
    selectRange,
    selectIndexCompare,
    setSelectionRanges,
  };
}

/* ======================= UI subcomponents ======================= */

function MetadataImageCell({
  projectId,
  protocolId,
  outputName,
  tableName,
  rowIndexInTable,
  columnName,
  cell,
  size,
  isSelected = false,
  onClick,
  scrollRootRef,
  imageCacheRef,
}: MetadataImageCellProps) {
  const rootRef = useRef<HTMLDivElement | null>(null);

  const [isVisible, setIsVisible] = useState(false);
  const [thumbUrl, setThumbUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const svcRef = useProjectServiceRef();

  const imageCacheKey = useMemo(
    () =>
      [
        projectId,
        protocolId,
        outputName,
        tableName,
        columnName,
        cell.path,
        size,
        METADATA_IMAGE_CACHE_VARIANT,
      ].join("|"),
    [
      cell.path,
      columnName,
      outputName,
      projectId,
      protocolId,
      size,
      tableName,
    ],
  );

  useEffect(() => {
    setIsVisible(false);
  }, [imageCacheKey]);

  useEffect(() => {
    const element = rootRef.current;
    if (!element) return;

    if (typeof IntersectionObserver === "undefined") {
      setIsVisible(true);
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (!entry?.isIntersecting) return;

        setIsVisible(true);
        observer.disconnect();
      },
      {
        root: scrollRootRef.current,
        rootMargin: IMAGE_LAZY_ROOT_MARGIN,
        threshold: 0.01,
      },
    );

    observer.observe(element);

    return () => {
      observer.disconnect();
    };
  }, [imageCacheKey, scrollRootRef]);

  useEffect(() => {
    const cache = imageCacheRef.current;

    const cached = getImageCacheEntry(cache, imageCacheKey);
    if (cached) {
      setThumbUrl(cached.url);
      setError(null);
      setLoading(false);
      return;
    }

    if (!isVisible) {
      setThumbUrl(null);
      setError(null);
      setLoading(false);
      return;
    }

    let cancelled = false;
    const abortController = new AbortController();

    setThumbUrl(null);
    setLoading(true);
    setError(null);

    const job: ImageJob = {
      isCancelled: () => cancelled,
      run: async () => {
        const baseOptions = {
          size,
          applyTransform: false,
          inline: true,
          signal: abortController.signal,
        };

        try {
          return await svcRef.current.fetchMetadataImageCellObjectUrl(
            projectId,
            protocolId,
            outputName,
            tableName,
            rowIndexInTable,
            columnName,
            {
              ...baseOptions,
              format: METADATA_IMAGE_PRIMARY_FORMAT,
            },
          );
        } catch (error) {
          if (abortController.signal.aborted) {
            throw error;
          }

          return svcRef.current.fetchMetadataImageCellObjectUrl(
            projectId,
            protocolId,
            outputName,
            tableName,
            rowIndexInTable,
            columnName,
            {
              ...baseOptions,
              format: METADATA_IMAGE_FALLBACK_FORMAT,
            },
          );
        }
      },
      onSuccess: ({ url, revoke }) => {
        if (cancelled) {
          revoke();
          return;
        }

        setImageCacheEntry(imageCacheRef.current, imageCacheKey, { url, revoke });
        setThumbUrl(url);
        setError(null);
        setLoading(false);
      },
      onError: (requestError) => {
        if (cancelled) return;
        setError(getErrorMessage(requestError, "Failed to load image"));
        setLoading(false);
      },
    };

    enqueueImageJob(job);

    return () => {
      cancelled = true;
      abortController.abort();
    };
  }, [
    columnName,
    imageCacheKey,
    imageCacheRef,
    isVisible,
    outputName,
    projectId,
    protocolId,
    rowIndexInTable,
    size,
    tableName,
    svcRef,
  ]);

  const borderColor = isSelected ? "#2563eb" : "rgba(148,163,184,0.6)";

  const handleClick = (event: ReactMouseEvent<HTMLDivElement>) => {
    if (!onClick) return;
    event.stopPropagation();
    onClick(event);
  };

  return (
    <Box
      ref={rootRef}
      onClick={handleClick}
      sx={{
        cursor: "pointer",
        width: size,
        height: size,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        borderRadius: 1,
        border: `1px solid ${borderColor}`,
        overflow: "hidden",
        bgcolor: thumbUrl ? "#111827" : "transparent",
      }}
    >
      {loading ? (
        <CircularProgress size={18} />
      ) : error ? (
        <Typography variant="caption" color="error" sx={{ p: 1, textAlign: "center" }}>
          img error
        </Typography>
      ) : thumbUrl ? (
        <img
          src={thumbUrl}
          alt={cell.path}
          style={{
            width: "100%",
            height: "100%",
            objectFit: "contain",
            display: "block",
          }}
        />
      ) : null}
    </Box>
  );
}

const MetadataTablePanel = memo(function MetadataTablePanel({
  schema,
  totalRows,
  visibleColumns,
  columnSettings,
  rowHeight,
  rowSizeForScroll,
  imageThumbSize,
  imageColMinWidth,
  tableMinWidth,
  windowRows,
  windowOffset,
  windowLoading,
  windowError,
  topSpacerHeight,
  bottomSpacerHeight,
  hasData,
  scrollRef,
  handleScroll,
  isRowSelected,
  onPrimaryRowClick,
  onRowContextMenu,
  onHeaderContextMenu,
  selectedImageCell,
  setSelectedRowIndex,
  setSelectedImageCell,
  projectId,
  protocolId,
  outputName,
  selectedTable,
  imageCacheRef,
  sortBy,
  sortAsc,
  onToggleSort,
  matrixColumnNames,
}: MetadataTablePanelProps) {
  if (!schema || totalRows <= 0) return null;

  return (
    <Paper
      variant="outlined"
      sx={{
        mt: 0,
        minHeight: 0,
        maxHeight: "none",
        minWidth: 840,
        flex: "1 1 auto",
        flexShrink: 1,
        overflow: "hidden",
        position: "relative",
        display: "flex",
        flexDirection: "column",
        borderColor: "rgba(148,163,184,0.4)",
        backgroundColor: "background.paper",
      }}
    >
      <TableContainer
        ref={scrollRef}
        onScroll={handleScroll}
        sx={{
          flex: 1,
          minHeight: 0,
          overflow: "auto",
        }}
      >
        <Table
          size="small"
          stickyHeader
          sx={{
            minWidth: tableMinWidth || 700,
            tableLayout: "fixed",
            borderCollapse: "collapse",
            borderSpacing: 0,
          }}
        >
          <TableHead>
            <TableRow>
              <TableCell
                sx={{
                  ...headerCellSx,
                  width: ROW_INDEX_COL_WIDTH,
                  minWidth: ROW_INDEX_COL_WIDTH,
                  maxWidth: ROW_INDEX_COL_WIDTH,
                  textAlign: "right",
                  pr: 1,
                  left: 0,
                  zIndex: 3,
                  borderRight: "1px solid rgba(148,163,184,0.6)",
                }}
              >
                #
              </TableCell>

              {visibleColumns.map((column) => {
                const label = column.alias || column.name;
                const isSortable = Boolean(column.sortable);
                const isActive = !!sortBy && sortBy === column.name;
                const isMatrixColumn = matrixColumnNames.has(column.name);
                const colWidth = isMatrixColumn
                  ? MATRIX_COL_MIN_WIDTH
                  : column.rendererType === "image"
                    ? imageColMinWidth
                    : MIN_TEXT_COL_WIDTH;

                const iconNode = !isSortable ? null : isActive ? (
                  sortAsc ? (
                    <ArrowUp size={14} />
                  ) : (
                    <ArrowDown size={14} />
                  )
                ) : (
                  <ArrowUpDown size={14} />
                );

                const tooltipTitle = !isSortable
                  ? ""
                  : isActive
                    ? `Sorted ${sortAsc ? "ascending" : "descending"}`
                    : "Sort";

                return (
                  <TableCell
                    key={column.name}
                    onClick={() => {
                      if (!isSortable) return;
                      onToggleSort(column);
                    }}
                    onContextMenu={(event) => {
                      onHeaderContextMenu(column, event);
                    }}
                    sx={{
                      ...headerCellSx,
                      minWidth: colWidth,
                      width: colWidth,
                      cursor: isSortable ? "pointer" : "default",
                      userSelect: "none",
                    }}
                  >
                    <Box sx={{ display: "flex", alignItems: "center", gap: 0.75, minWidth: 0 }}>
                      <Box
                        sx={{
                          flex: 1,
                          minWidth: 0,
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                        }}
                      >
                        {label}
                      </Box>

                      {isSortable && (
                        <Tooltip title={tooltipTitle}>
                          <Box
                            sx={{
                              display: "flex",
                              alignItems: "center",
                              color: isActive ? "#1d4ed8" : "rgba(15,23,42,0.55)",
                            }}
                            onClick={(event) => {
                              event.stopPropagation();
                              onToggleSort(column);
                            }}
                          >
                            {iconNode}
                          </Box>
                        </Tooltip>
                      )}
                    </Box>
                  </TableCell>
                );
              })}
            </TableRow>
          </TableHead>

          <TableBody>
            {topSpacerHeight > 0 && (
              <TableRow style={{ height: topSpacerHeight }}>
                <TableCell
                  colSpan={visibleColumns.length + 1}
                  sx={{ padding: 0, borderBottom: "none" }}
                />
              </TableRow>
            )}

            {windowRows.map((row, rowIndexInWindow) => {
              const displayRowIndex = windowOffset + rowIndexInWindow;
              const rowId = resolveMetadataRowId(schema, row);
              const isHighlightedRow = isRowSelected(displayRowIndex, rowId);

              return (
                <TableRow
                  key={rowId ?? `${windowOffset}-${rowIndexInWindow}`}
                  hover
                  onMouseDown={(event) => {
                    // preventBrowserTextSelectionDuringShiftRangeSelection
                    if (event.shiftKey) {
                      event.preventDefault();
                    }
                  }}
                  onClick={(event) => {
                    onPrimaryRowClick(displayRowIndex, rowId, event);
                    setSelectedRowIndex(displayRowIndex);
                    setSelectedImageCell(null);
                  }}
                  onContextMenu={(event) => {
                    onRowContextMenu(displayRowIndex, rowId, event);
                  }}
                  sx={{
                    height: rowHeight,
                    backgroundColor: isHighlightedRow
                      ? "rgba(219,234,254,0.9)"
                      : "background.paper",
                    transition: "background-color 120ms ease-out",
                    "&:hover": {
                      backgroundColor: isHighlightedRow
                        ? "rgba(191,219,254,0.95)"
                        : "rgba(248,250,252,1)",
                    },
                    "&:hover td": {
                      transition: "background-color 120ms ease-out",
                    },
                    "& > td": {
                      borderRight: "1px solid rgba(148,163,184,0.25)",
                    },
                    "& > td:last-of-type": {
                      borderRight: "none",
                    },
                  }}
                >
                  <TableCell
                    sx={{
                      ...baseCellSx,
                      height: rowHeight,
                      width: ROW_INDEX_COL_WIDTH,
                      minWidth: ROW_INDEX_COL_WIDTH,
                      maxWidth: ROW_INDEX_COL_WIDTH,
                      textAlign: "right",
                      pr: 1,
                      position: "sticky",
                      left: 0,
                      zIndex: 2,
                      borderRight: "1px solid rgba(148,163,184,0.3)",
                      backgroundColor: HEADER_BG,
                    }}
                  >
                    {displayRowIndex + 1}
                  </TableCell>

                  {visibleColumns.map((column) => {
                    const cellValue = row.values[column.index];
                    const isImageColumn = column.rendererType === "image";
                    const renderAsImage =
                      isImageColumn && (columnSettings[column.name]?.renderAsImage ?? true);

                    const isSelectedImage =
                      !!selectedImageCell &&
                      isImageColumn &&
                      renderAsImage &&
                      selectedImageCell.rowIndexInTable === displayRowIndex &&
                      selectedImageCell.columnName === column.name;

                    const cellWidth =
                      matrixColumnNames.has(column.name)
                        ? MATRIX_COL_MIN_WIDTH
                        : column.rendererType === "image"
                          ? imageColMinWidth : MIN_TEXT_COL_WIDTH;


                    if (
                      renderAsImage &&
                      cellValue &&
                      typeof cellValue === "object" &&
                      (cellValue as { kind?: string }).kind === "image"
                    ) {
                      const imageCell = cellValue as { kind: "image"; path: string };

                      return (
                        <TableCell
                          key={column.name}
                          sx={{
                            ...baseCellSx,
                            height: rowHeight,
                            verticalAlign: "middle",
                            width: cellWidth,
                            minWidth: cellWidth,
                            maxWidth: cellWidth,
                            padding: 0,
                            backgroundColor: isHighlightedRow
                              ? "rgba(219,234,254,0.9)"
                              : "background.paper",
                          }}
                        >
                          <Box
                            sx={{
                              // centerImageInCell
                              width: "100%",
                              height: "100%",
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "center",
                              padding: "4px 8px",
                            }}
                          >
                            <MetadataImageCell
                              projectId={projectId}
                              protocolId={protocolId}
                              outputName={outputName}
                              tableName={selectedTable}
                              rowIndexInTable={displayRowIndex}
                              columnName={column.name}
                              cell={imageCell}
                              size={imageThumbSize}
                              isSelected={isSelectedImage}
                              onClick={(event) => {
                                onPrimaryRowClick(displayRowIndex, rowId, event);
                                setSelectedRowIndex(displayRowIndex);
                                setSelectedImageCell({
                                  rowIndexInTable: displayRowIndex,
                                  columnName: column.name,
                                });
                              }}
                              scrollRootRef={scrollRef}
                              imageCacheRef={imageCacheRef}
                            />
                          </Box>
                        </TableCell>
                      );
                    }

                    if (isMatrixCell(cellValue as MetadataCell)) {
                      const rawMatrixValue = (cellValue as { value?: unknown }).value;
                      const vectorValue = normalizeMatrix1d(rawMatrixValue);
                      const matrixValue = normalizeMatrix2d(rawMatrixValue);

                      return (
                        <TableCell
                          key={column.name}
                          sx={{
                            ...baseCellSx,
                            height: rowHeight,
                            verticalAlign: "middle",
                            width: Math.max(MIN_TEXT_COL_WIDTH, 260),
                            minWidth: Math.max(MIN_TEXT_COL_WIDTH, 260),
                            maxWidth: Math.max(MIN_TEXT_COL_WIDTH, 260),
                            whiteSpace: "normal",
                            overflow: "visible",
                            textOverflow: "clip",
                            backgroundColor: isHighlightedRow ? "rgba(219,234,254,0.9)" : "background.paper",
                            textAlign: "center",
                          }}
                        >
                          <Box
                            sx={{
                              width: "100%",
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "center",
                            }}
                          >
                            <Box sx={{ display: "inline-block", maxWidth: "100%" }}>
                              {vectorValue ? (
                                <VectorInlineCell values={vectorValue} />
                              ) : matrixValue ? (
                                <MatrixInlineCell matrix={matrixValue} />
                              ) : (
                                <Typography variant="caption" color="text.secondary">
                                  matrix
                                </Typography>
                              )}
                            </Box>
                          </Box>
                        </TableCell>
                      );
                    }

                    return (
                      <TableCell
                        key={column.name}
                        sx={{
                          ...baseCellSx,
                          height: rowHeight,
                          verticalAlign: "middle",
                          width: cellWidth,
                          minWidth: cellWidth,
                          maxWidth: cellWidth,
                          backgroundColor: isHighlightedRow
                            ? "rgba(219,234,254,0.9)"
                            : "background.paper",
                          textAlign: "right"
                        }}
                        title={typeof cellValue === "string" ? cellValue : undefined}
                      >
                        {formatCellValue(cellValue as MetadataCell)}
                      </TableCell>
                    );
                  })}
                </TableRow>
              );
            })}

            {bottomSpacerHeight > 0 && (
              <TableRow style={{ height: bottomSpacerHeight }}>
                <TableCell
                  colSpan={visibleColumns.length + 1}
                  sx={{ padding: 0, borderBottom: "none" }}
                />
              </TableRow>
            )}
          </TableBody>
        </Table>
      </TableContainer>

      {windowLoading && hasData && (
        <Box
          sx={{
            position: "absolute",
            right: 8,
            bottom: 8,
            zIndex: 4,
            py: 0.5,
            px: 1,
            display: "flex",
            alignItems: "center",
            gap: 0.75,
            border: "1px solid rgba(148,163,184,0.4)",
            borderRadius: 1,
            backgroundColor: "background.paper",
            boxShadow: "0 1px 3px rgba(15,23,42,0.12)",
            pointerEvents: "none",
          }}
        >
          <CircularProgress size={14} />
          <Typography variant="caption" color="text.secondary">
            Loading rows…
          </Typography>
        </Box>
      )}

      {windowError && (
        <Box
          sx={{
            py: 0.5,
            px: 1.5,
            borderTop: "1px solid rgba(148,163,184,0.4)",
          }}
        >
          <Typography variant="caption" color="error">
            {windowError}
          </Typography>
        </Box>
      )}
    </Paper>
  );
});

const MetadataGalleryPanel = memo(function MetadataGalleryPanel({
  schema,
  firstImageColumn,
  galleryRows,
  galleryLoading,
  galleryError,
  galleryScrollRef,
  handleGalleryScroll,
  isRowSelected,
  onPrimaryRowClick,
  selectedImageCell,
  setSelectedRowIndex,
  setSelectedImageCell,
  projectId,
  protocolId,
  outputName,
  selectedTable,
  imageCacheRef,
  showSizeLabel,
  sizeColumn,
  imageThumbSize,
  galleryBaseOffset,
}: MetadataGalleryPanelProps) {
  return (
    <Paper
      variant="outlined"
      sx={{
        mt: 0,
        minHeight: 0,
        maxHeight: "none",
        minWidth: 840,
        flex: "1 1 auto",
        flexShrink: 1,
        overflow: "hidden",
        display: "flex",
        flexDirection: "column",
        borderColor: "rgba(148,163,184,0.4)",
        backgroundColor: "background.paper",
      }}
    >
      <Box
        ref={galleryScrollRef}
        onScroll={handleGalleryScroll}
        sx={{
          flex: 1,
          minHeight: 0,
          overflow: "auto",
        }}
      >
        {!firstImageColumn && (
          <Box
            sx={{
              py: 4,
              px: 3,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Typography variant="body2" color="text.secondary">
              This table has no image columns to display in gallery mode.
            </Typography>
          </Box>
        )}

        {firstImageColumn && (
          <Box
            sx={{
              p: 1,
              display: "grid",
              gridTemplateColumns: `repeat(auto-fill, minmax(${Math.max(170, imageThumbSize + 10)}px, 1fr))`,
              gap: 0,
            }}
          >
            {galleryRows.map((row, index) => {
              const globalRowIndex = galleryBaseOffset + index;
              const rowId = resolveMetadataRowId(schema, row);

              const cellValue = row.values[firstImageColumn.index];
              const isImageCellValue =
                cellValue &&
                typeof cellValue === "object" &&
                (cellValue as { kind?: string }).kind === "image";

              const imageCell = isImageCellValue
                ? (cellValue as { kind: "image"; path: string })
                : null;

              const isSelected = isRowSelected(globalRowIndex, rowId);

              const isFocusedImageCell =
                !!selectedImageCell &&
                selectedImageCell.rowIndexInTable === globalRowIndex &&
                selectedImageCell.columnName === firstImageColumn.name;

              const sizeLabel =
                showSizeLabel && sizeColumn
                  ? formatGallerySizeLabel(row.values[sizeColumn.index])
                  : null;

              return (
                <Box
                  key={rowId ?? row.id ?? `${index}`}
                  data-row-index={globalRowIndex}
                  onClick={(event) => {
                    onPrimaryRowClick(globalRowIndex, rowId, event);
                    setSelectedRowIndex(globalRowIndex);
                    if (imageCell) {
                      setSelectedImageCell({
                        rowIndexInTable: globalRowIndex,
                        columnName: firstImageColumn.name,
                      });
                    } else {
                      setSelectedImageCell(null);
                    }
                  }}
                  sx={{
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    gap: 0.5,
                    p: 0.75,
                    borderRadius: 1.5,
                    border: isSelected
                      ? "2px dashed #dc2626"
                      : "1px solid rgba(148,163,184,0.45)",
                    background: isSelected ? "rgba(254,226,226,0.55)" : "#f9fafb",
                    boxShadow: isSelected ? "0 0 0 1px rgba(220,38,38,0.25)" : "none",
                    transition:
                      "background-color 120ms ease-out, border-color 120ms ease-out, box-shadow 120ms ease-out",
                    cursor: "pointer",
                  }}
                >
                  {imageCell ? (
                    <MetadataImageCell
                      projectId={projectId}
                      protocolId={protocolId}
                      outputName={outputName}
                      tableName={selectedTable}
                      rowIndexInTable={globalRowIndex}
                      columnName={firstImageColumn.name}
                      cell={imageCell}
                      size={imageThumbSize}
                      isSelected={isFocusedImageCell || isSelected}
                      scrollRootRef={galleryScrollRef}
                      imageCacheRef={imageCacheRef}
                    />
                  ) : (
                    <Box
                      aria-hidden="true"
                      sx={{
                        width: imageThumbSize,
                        height: imageThumbSize,
                      }}
                    />
                  )}

                  <Box sx={{ minHeight: 18 }}>
                    {sizeLabel && (
                      <Typography variant="caption" color="text.secondary">
                        {sizeLabel}
                      </Typography>
                    )}
                  </Box>
                </Box>
              );
            })}
          </Box>
        )}

        {galleryLoading && (
          <Box
            sx={{
              py: 1,
              px: 2,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 1,
            }}
          >
            <CircularProgress size={16} />
            <Typography variant="caption" color="text.secondary">
              Loading images…
            </Typography>
          </Box>
        )}

        {galleryError && (
          <Box sx={{ py: 1, px: 2 }}>
            <Typography variant="caption" color="error">
              {galleryError}
            </Typography>
          </Box>
        )}

        {!galleryLoading && firstImageColumn && galleryRows.length === 0 && !galleryError && (
          <Box
            sx={{
              py: 4,
              px: 3,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Typography variant="body2" color="text.secondary">
              No images to display yet.
            </Typography>
          </Box>
        )}
      </Box>
    </Paper >
  );
});

function ColumnsDialog({
  open,
  onClose,
  onApply,
  allColumns,
  columnSettings,
  draftColumnSettings,
  updateDraftColumnSettings,
}: ColumnsDialogProps) {
  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth="sm"
      fullWidth
      BackdropProps={{
        sx: { backgroundColor: "transparent" },
      }}
    >
      <DialogTitle sx={headerColumnDialogSx}>
        Columns
        <IconButton
          onClick={onClose}
          aria-label="Close columns dialog"
          size="small"
          sx={closeBtnSx}
        >
          <CloseIcon fontSize="small" />
        </IconButton>
      </DialogTitle>

      <DialogContent dividers>
        <Table size="small">
          <TableHead>
            <TableRow sx={{ backgroundColor: DIALOG_HEADER_BG }}>
              <TableCell sx={{ fontWeight: 600, fontSize: "0.8rem" }}>Label</TableCell>
              <TableCell align="center" sx={{ fontWeight: 600, fontSize: "0.8rem" }}>
                Visible
              </TableCell>
              <TableCell align="center" sx={{ fontWeight: 600, fontSize: "0.8rem" }}>
                Render
              </TableCell>
            </TableRow>
          </TableHead>

          <TableBody>
            {allColumns.map((column, index) => {
              const draft = draftColumnSettings?.[column.name];
              const current = columnSettings[column.name];

              const effectiveVisible =
                draft?.visible ?? current?.visible ?? (column.visible !== false);

              const canRender = column.rendererType === "image";
              const effectiveRenderAsImage =
                draft?.renderAsImage ??
                current?.renderAsImage ??
                (column.rendererType === "image");

              return (
                <TableRow
                  key={column.name}
                  sx={{
                    backgroundColor: index % 2 === 0 ? DIALOG_ROW_EVEN_BG : DIALOG_ROW_ODD_BG,
                  }}
                >
                  <TableCell sx={{ fontSize: "0.8rem" }}>
                    {column.alias || column.name}
                  </TableCell>

                  <TableCell align="center">
                    <Checkbox
                      size="small"
                      checked={effectiveVisible}
                      onChange={(event) =>
                        updateDraftColumnSettings(column.name, {
                          visible: event.target.checked,
                        })
                      }
                    />
                  </TableCell>

                  <TableCell align="center">
                    <Checkbox
                      size="small"
                      checked={canRender && effectiveRenderAsImage}
                      disabled={!canRender}
                      onChange={(event) =>
                        updateDraftColumnSettings(column.name, {
                          renderAsImage: event.target.checked,
                        })
                      }
                    />
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </DialogContent>

      <DialogActions>
        <Button
          variant="contained"
          startIcon={<CloseIcon />}
          onClick={onClose}
          sx={{ textTransform: "none" }}
          color="error"
        >
          Close
        </Button>

        <Button
          variant="contained"
          startIcon={<Check size={16} />}
          onClick={onApply}
          sx={{ textTransform: "none" }}
        >
          Ok
        </Button>
      </DialogActions>
    </Dialog>
  );
}

/* ======================= Main component ======================= */

export function MetadataViewer({ projectId, protocolId, outputName, onClose, embedded = false }: MetadataViewerProps) {
  const isMountedRef = useIsMountedRef();
  const svcRef = useProjectServiceRef();

  const [viewMode, setViewMode] = useState<ViewMode>("table");

  const [sortState, setSortState] = useState<SortState>({
    columnName: null,
    direction: "asc",
  });

  const sortBy = sortState.columnName;
  const sortAsc = sortState.direction === "asc";

  const [selectionMode, setSelectionMode] = useState<SelectionMode>("index");
  const [selectedRowIdKeys, setSelectedRowIdKeys] = useState<Set<RowIdKey>>(() => new Set());
  const selectedRowIdValuesRef = useRef<Map<RowIdKey, RowId>>(new Map());

  const [selectedRowIndex, setSelectedRowIndex] = useState<number | null>(null);
  const [selectedImageCell, setSelectedImageCell] = useState<SelectedImageCell | null>(null);

  const [columnsDialogOpen, setColumnsDialogOpen] = useState(false);
  const [draftColumnSettings, setDraftColumnSettings] =
    useState<Record<string, ColumnSettings> | null>(null);

  const [contextMenu, setContextMenu] = useState<ContextMenuState>(null);

  const [selectionDialog, setSelectionDialog] = useState<SelectionDialogState>({ open: false });
  const [selectionBusy, setSelectionBusy] = useState(false);
  const [selectionProgress, setSelectionProgress] = useState<{ done: number; total: number } | null>(
    null,
  );
  const [selectionDialogError, setSelectionDialogError] = useState<string | null>(null);

  const [actionDialogState, setActionDialogState] = useState<MetadataActionDialogState>({
    open: false,
    actionLabel: "",
  });
  const [subsetName, setSubsetName] = useState(DEFAULT_SUBSET_NAME);
  const [actionSubmitting, setActionSubmitting] = useState(false);
  const [actionDialogError, setActionDialogError] = useState<string | null>(null);

  const [sortInProgress, setSortInProgress] = useState(false);
  const [plotterOpen, setPlotterOpen] = useState(false);

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const galleryScrollRef = useRef<HTMLDivElement | null>(null);
  const { height: viewportHeight } = useElementSize(scrollRef, viewMode);

  const { imageCacheRef, clearImageCache } = useImageCache();

  const [galleryAnchorRowIndex, setGalleryAnchorRowIndex] = useState<number | null>(null);
  const pendingGalleryScrollIndexRef = useRef<number | null>(null);

  const focusedRowIndex = useMemo(() => {
    return selectedImageCell?.rowIndexInTable ?? selectedRowIndex ?? null;
  }, [selectedImageCell, selectedRowIndex]);

  const prevViewModeRef = useRef<ViewMode>(viewMode);


  const { tables, tablesLoading, tablesError, selectedTable, setSelectedTable } = useMetadataTables(
    projectId,
    protocolId,
    outputName,
    isMountedRef,
  );

  const { schema, setSchema, schemaLoading, schemaError, setSchemaError } = useMetadataSchema(
    projectId,
    protocolId,
    outputName,
    selectedTable,
    isMountedRef,
  );

  const { columnSettings, setColumnSettings } = useColumnSettings(schema, selectedTable);

  const tableInfo = useMemo<MetadataTableInfo | null>(() => {
    if (!tables || !selectedTable) return null;
    return tables.find((table) => table.name === selectedTable) || null;
  }, [tables, selectedTable]);

  const totalRows = tableInfo?.rowCount ?? 0;

  const {
    selectionState,
    isRowSelected: isRowSelectedByIndex,
    selectedCount: selectedCountByIndex,
    clearSelection,
    selectOnly,
    handlePrimaryRowClick: handlePrimaryRowClickByIndex,
    selectAll,
    selectFromHere,
    selectToHere,
    invertSelection,
    selectRange,
    selectIndexCompare,
    setSelectionRanges,
  } = useRowSelection(totalRows);

  const allColumns: MetadataColumnWithVisibility[] = useMemo(
    () => (schema?.columns ?? []) as MetadataColumnWithVisibility[],
    [schema],
  );

  const visibleColumns: MetadataColumnWithVisibility[] = useMemo(
    () =>
      allColumns.filter((column) => {
        const settings = columnSettings[column.name];
        if (settings) return settings.visible;
        return column.visible !== false;
      }),
    [allColumns, columnSettings],
  );

  const imageColumns = useMemo(
    () =>
      visibleColumns.filter((column) => {
        if (column.rendererType !== "image") return false;
        const settings = columnSettings[column.name];
        return settings?.renderAsImage ?? true;
      }),
    [visibleColumns, columnSettings],
  );

  const hasImageColumns = imageColumns.length > 0;
  const firstImageColumn = imageColumns[0] ?? null;

  const [zoomInputPercent, setZoomInputPercent] = useState<number>(100);
  const [zoomPercent, setZoomPercent] = useState<number>(100);
  const zoomApplyTimeoutRef = useRef<number | null>(null);

  const imageThumbSize = useMemo(() => {
    const scaled = Math.round((BASE_THUMB_SIZE * zoomPercent) / 100);
    return Math.min(MAX_THUMB_SIZE, Math.max(MIN_THUMB_SIZE, scaled));
  }, [zoomPercent]);

  useEffect(() => {
    return () => {
      if (zoomApplyTimeoutRef.current != null) {
        window.clearTimeout(zoomApplyTimeoutRef.current);
        zoomApplyTimeoutRef.current = null;
      }
    };
  }, []);

  const imageColMinWidth = useMemo(() => imageThumbSize + IMAGE_COL_PADDING, [imageThumbSize]);

  const zoomEnabled = useMemo(() => {
    if (!hasImageColumns) return false;
    return selectedImageCell != null;
  }, [hasImageColumns, selectedImageCell]);

  const applyZoomPercent = useCallback((value: number, immediate = false) => {
    const nextZoomPercent = clampZoomPercent(value);

    setZoomInputPercent(nextZoomPercent);

    if (zoomApplyTimeoutRef.current != null) {
      window.clearTimeout(zoomApplyTimeoutRef.current);
      zoomApplyTimeoutRef.current = null;
    }

    if (immediate) {
      setZoomPercent(nextZoomPercent);
      return;
    }

    zoomApplyTimeoutRef.current = window.setTimeout(() => {
      setZoomPercent(nextZoomPercent);
      zoomApplyTimeoutRef.current = null;
    }, ZOOM_APPLY_DEBOUNCE_MS);
  }, []);

  const [goToIdInput, setGoToIdInput] = useState<string>("");
  const [goToBusy, setGoToBusy] = useState(false);
  const [goToError, setGoToError] = useState<string | null>(null);
  const goToTimeoutRef = useRef<number | null>(null);
  const goToEpochRef = useRef(0);

  useEffect(() => {
    return () => {
      if (goToTimeoutRef.current != null) {
        window.clearTimeout(goToTimeoutRef.current);
        goToTimeoutRef.current = null;
      }
    };
  }, []);

  const galleryInfoColumns = useMemo(() => {
    const rawColumns = schema?.additionalInfoColumns;
    if (!Array.isArray(rawColumns)) return [];

    return rawColumns.filter(
      (columnName): columnName is string =>
        typeof columnName === "string" && columnName.trim().length > 0,
    );
  }, [schema?.additionalInfoColumns]);

  const sizeColumn = useMemo(() => {
    if (!allColumns.length) return null;

    const canUseSizeColumn =
      galleryInfoColumns.length === 0 || galleryInfoColumns.includes("_size");

    if (!canUseSizeColumn) return null;

    return allColumns.find((item) => item.name === "_size") ?? null;
  }, [allColumns, galleryInfoColumns]);

  const schemaActions = useMemo(() => getSchemaActions(schema), [schema]);

  const isPropertiesTable = useMemo(() => {
    const tableName = (selectedTable || "").trim().toLowerCase();
    const alias = (tableInfo?.alias || "").trim().toLowerCase();

    return tableName === "properties" || alias === "properties";
  }, [selectedTable, tableInfo]);

  const metadataActions = useMemo(() => {
    if (isPropertiesTable) return [];
    return schemaActions;
  }, [isPropertiesTable, schemaActions]);

  const hasMetadataActions = metadataActions.length > 0;

  const showSizeLabel = !!sizeColumn;

  const rowHeight = hasImageColumns ? imageThumbSize + IMAGE_ROW_PADDING : NORMAL_ROW_HEIGHT;

  const virtualContentHeight = useMemo(() => {
    if (!totalRows || !rowHeight) return 0;
    const fullHeight = totalRows * rowHeight;
    return fullHeight > MAX_VIRTUAL_SCROLL_HEIGHT ? MAX_VIRTUAL_SCROLL_HEIGHT : fullHeight;
  }, [totalRows, rowHeight]);

  const pixelsPerRow = useMemo(() => {
    if (!totalRows || !rowHeight) return rowHeight || NORMAL_ROW_HEIGHT;
    if (!virtualContentHeight) return rowHeight;
    return virtualContentHeight / totalRows;
  }, [virtualContentHeight, totalRows, rowHeight]);

  const rowSizeForScroll = useMemo(
    () => pixelsPerRow || rowHeight || NORMAL_ROW_HEIGHT,
    [pixelsPerRow, rowHeight],
  );

  useEffect(() => {
    if (viewMode === "gallery" && !hasImageColumns) {
      setViewMode("table");
    }
  }, [viewMode, hasImageColumns]);

  const desiredWindowSize = useMemo(() => {
    if (!rowHeight || viewportHeight <= 0) {
      return MIN_TABLE_WINDOW_ROWS;
    }

    const approxVisible = Math.ceil(viewportHeight / rowHeight);
    const calculatedWindowSize =
      approxVisible * 2 + EXTRA_BUFFER_ROWS;

    return Math.max(
      MIN_TABLE_WINDOW_ROWS,
      calculatedWindowSize,
    );
  }, [viewportHeight, rowHeight]);

  const {
    windowRows,
    windowOffset,
    windowLoading,
    windowError,
    handleScroll,
    invalidateWindowState,
    jumpToRowIndex,
  } = useVirtualTableWindow({
    projectId,
    protocolId,
    outputName,
    selectedTable,
    schema,
    totalRows,
    viewMode,
    rowHeight,
    rowSizeForScroll,
    desiredWindowSize,
    scrollRef,
    isMountedRef,
    sortBy,
    sortAsc,
  });

  const {
    galleryRows,
    galleryLoading,
    galleryError,
    handleGalleryScroll,
    invalidateGalleryState,
    galleryBaseOffset,
  } = useMetadataGalleryRows({
    projectId,
    protocolId,
    outputName,
    selectedTable,
    schema,
    totalRows,
    viewMode,
    isMountedRef,
    sortBy,
    sortAsc,
    anchorRowIndex: viewMode === "gallery" ? galleryAnchorRowIndex : null,
  });

  const lastImageThumbSizeRef = useRef(imageThumbSize);

  useEffect(() => {
    if (lastImageThumbSizeRef.current === imageThumbSize) return;
    lastImageThumbSizeRef.current = imageThumbSize;

    if (focusedRowIndex == null) return;

    if (viewMode === "table") {
      window.requestAnimationFrame(() => {
        jumpToRowIndex(focusedRowIndex);
      });
      return;
    }

    if (viewMode === "gallery") {
      setGalleryAnchorRowIndex(focusedRowIndex);
      pendingGalleryScrollIndexRef.current = focusedRowIndex;
    }
  }, [focusedRowIndex, imageThumbSize, jumpToRowIndex, viewMode]);

  const [matrixColumnNames, setMatrixColumnNames] = useState<Set<string>>(() => new Set());
  const matrixColumnNamesRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    // detectMatrixColumnsFromLoadedWindowRowsAndKeepSticky
    if (!schema || windowRows.length === 0) return;

    const next = new Set(matrixColumnNamesRef.current);
    let changed = false;

    for (const col of allColumns) {
      if (next.has(col.name)) continue;

      for (const row of windowRows) {
        const cell = row.values?.[col.index] as MetadataCell;
        if (cell && isMatrixCell(cell)) {
          next.add(col.name);
          changed = true;
          break;
        }
      }
    }

    if (changed) {
      matrixColumnNamesRef.current = next;
      setMatrixColumnNames(new Set(next));
    }
  }, [schema, windowRows, allColumns]);

  const topSpacerHeight = totalRows > 0 ? windowOffset * rowSizeForScroll : 0;

  const bottomSpacerHeight =
    totalRows > 0
      ? Math.max(0, (totalRows - windowOffset - windowRows.length) * rowSizeForScroll)
      : 0;

  const hasData = !!schema && totalRows > 0;

  const tableMinWidth = useMemo(() => {
    if (!schema) return undefined;

    const colsWidth = visibleColumns.reduce((acc, column) => {
      if (matrixColumnNames.has(column.name)) return acc + MATRIX_COL_MIN_WIDTH;
      if (column.rendererType === "image") return acc + imageColMinWidth;
      return acc + MIN_TEXT_COL_WIDTH;
    }, 0);

    return ROW_INDEX_COL_WIDTH + colsWidth;
  }, [schema, visibleColumns, matrixColumnNames, imageColMinWidth]);

  const clearIdSelection = useCallback(() => {
    selectedRowIdValuesRef.current.clear();
    setSelectedRowIdKeys(new Set());
  }, []);

  const effectiveSelectedCount = useMemo(() => {
    return selectionMode === "ids" ? selectedRowIdKeys.size : selectedCountByIndex;
  }, [selectionMode, selectedRowIdKeys, selectedCountByIndex]);

  const isRowSelected = useCallback(
    (rowIndex: number, rowId: RowId | null) => {
      if (selectionMode === "ids") {
        if (rowId == null) return false;
        return selectedRowIdKeys.has(rowIdToKey(rowId));
      }
      return isRowSelectedByIndex(rowIndex);
    },
    [selectionMode, selectedRowIdKeys, isRowSelectedByIndex],
  );

  const resetSelection = useCallback(() => {
    clearSelection();
    clearIdSelection();
    setSelectionMode("index");
    setSelectedRowIndex(null);
    setSelectedImageCell(null);
  }, [clearIdSelection, clearSelection]);

  const resetSort = useCallback(() => {
    setSortState({ columnName: null, direction: "asc" });
  }, []);

  const goToItemById = useCallback(
    async (rawValue?: string) => {
      if (!schema || !selectedTable || totalRows <= 0) return;

      const value = (rawValue ?? goToIdInput).trim();
      if (!value) return;

      const targetId = normalizeRowId(value);
      if (targetId == null) {
        setGoToError("Invalid id");
        return;
      }

      goToEpochRef.current += 1;
      const epoch = goToEpochRef.current;

      setGoToBusy(true);
      setGoToError(null);

      try {
        // Ensure table mode so scrollRef is relevant
        if (viewMode !== "table") {
          setViewMode("table");
        }

        const targetKey = rowIdToKey(targetId);

        const columns = (schema.columns ?? []) as MetadataColumnWithVisibility[];
        const idColumn =
          columns.find((c) => c.name === "id") ??
          columns.find((c) => (c.name || "").toLowerCase() === "id");

        const idColumnIndex = typeof idColumn?.index === "number" ? idColumn.index : null;

        const pageSize = Math.max(200, SELECTION_IDS_SCAN_PAGE_SIZE);

        for (let offset = 0; offset < totalRows; offset += pageSize) {
          if (!isMountedRef.current || goToEpochRef.current !== epoch) return;

          const response = (await svcRef.current.fetchMetadataTableWindow(
            projectId,
            protocolId,
            outputName,
            selectedTable,
            {
              offset,
              limit: Math.min(pageSize, totalRows - offset),
              selectionOnly: false,
              sortBy: sortBy ?? undefined,
              asc: sortBy ? sortAsc : undefined,
            },
          )) as MetadataWindowResponse;

          const parsed = parseWindowResponse(response);
          const actualOffset = parsed.offset ?? offset;

          for (let i = 0; i < parsed.rows.length; i += 1) {
            const row = parsed.rows[i];
            const globalRowIndex = actualOffset + i;

            const resolved = resolveMetadataRowId(schema, row);
            const resolvedKey = resolved != null ? rowIdToKey(resolved) : null;

            let idColKey: string | null = null;
            let idColValue: RowId | null = null;

            if (idColumnIndex != null) {
              const candidate = normalizeRowId(row.values?.[idColumnIndex]);
              if (candidate != null) {
                idColValue = candidate;
                idColKey = rowIdToKey(candidate);
              }
            }

            if (resolvedKey === targetKey || idColKey === targetKey) {
              const chosenRowId = resolved ?? idColValue ?? targetId;
              const chosenKey = rowIdToKey(chosenRowId);

              // Set stable selection (ids)
              clearSelection();
              selectedRowIdValuesRef.current.clear();
              selectedRowIdValuesRef.current.set(chosenKey, chosenRowId);
              setSelectedRowIdKeys(new Set([chosenKey]));
              setSelectionMode("ids");

              setSelectedRowIndex(globalRowIndex);
              setSelectedImageCell(null);

              jumpToRowIndex(globalRowIndex);
              setGoToError(null);
              return;
            }
          }
        }

        setGoToError("Item not found");
      } catch (error) {
        setGoToError(getErrorMessage(error, "Failed to go to item"));
      } finally {
        if (isMountedRef.current && goToEpochRef.current === epoch) {
          setGoToBusy(false);
        }
      }
    },
    [
      schema,
      selectedTable,
      totalRows,
      goToIdInput,
      viewMode,
      svcRef,
      projectId,
      protocolId,
      outputName,
      sortBy,
      sortAsc,
      isMountedRef,
      clearSelection,
      jumpToRowIndex,
    ],
  );

  const scheduleGoTo = useCallback(
    (nextValue: string) => {
      if (goToTimeoutRef.current) {
        window.clearTimeout(goToTimeoutRef.current);
        goToTimeoutRef.current = null;
      }

      if (!nextValue.trim()) return;

      goToTimeoutRef.current = window.setTimeout(() => {
        void goToItemById(nextValue);
      }, 450);
    },
    [goToItemById],
  );


  const materializeSingleIndexSelectionToIds = useCallback(async (): Promise<boolean> => {
    // materializeSingleIndexSelectionToIds
    if (!schema || !selectedTable) return false;
    if (selectionState.baseMode !== "none") return false;
    if (selectionState.ranges.length !== 1) return false;

    const range = selectionState.ranges[0];
    if (range.start !== range.end) return false;

    const targetIndex = range.start;

    // tryFromCurrentWindowFirst
    if (targetIndex >= windowOffset && targetIndex < windowOffset + windowRows.length) {
      const row = windowRows[targetIndex - windowOffset];
      const rowId = resolveMetadataRowId(schema, row);
      if (rowId == null) return false;

      const key = rowIdToKey(rowId);
      selectedRowIdValuesRef.current.clear();
      selectedRowIdValuesRef.current.set(key, rowId);
      setSelectedRowIdKeys(new Set([key]));
      setSelectionMode("ids");
      return true;
    }

    // fallbackFetchSingleRowByIndex
    try {
      const response = (await svcRef.current.fetchMetadataTableWindow(
        projectId,
        protocolId,
        outputName,
        selectedTable,
        {
          offset: targetIndex,
          limit: 1,
          selectionOnly: false,
          sortBy: sortBy ?? undefined,
          asc: sortBy ? sortAsc : undefined,
        },
      )) as MetadataWindowResponse;

      const parsed = parseWindowResponse(response);
      const row = parsed.rows[0];
      if (!row) return false;

      const rowId = resolveMetadataRowId(schema, row);
      if (rowId == null) return false;

      const key = rowIdToKey(rowId);
      selectedRowIdValuesRef.current.clear();
      selectedRowIdValuesRef.current.set(key, rowId);
      setSelectedRowIdKeys(new Set([key]));
      setSelectionMode("ids");
      return true;
    } catch {
      return false;
    }
  }, [
    schema,
    selectedTable,
    selectionState,
    windowOffset,
    windowRows,
    svcRef,
    projectId,
    protocolId,
    outputName,
    sortBy,
    sortAsc,
  ]);

  const ensureStableSelectionBeforeSort = useCallback(async () => {
    // ensureStableSelectionBeforeSort
    if (selectionMode === "ids") return;
    if (selectedCountByIndex <= 0) return;

    const ok = await materializeSingleIndexSelectionToIds();
    if (ok) return;
  }, [materializeSingleIndexSelectionToIds, selectedCountByIndex, selectionMode]);

  const applyToggleSort = useCallback((column: MetadataColumnWithVisibility) => {
    // applyToggleSort
    if (!column.sortable) return;

    setSortState((prev) => {
      if (prev.columnName !== column.name) {
        return { columnName: column.name, direction: "asc" };
      }
      return {
        columnName: column.name,
        direction: prev.direction === "asc" ? "desc" : "asc",
      };
    });
  }, []);

  const toggleSortForColumn = useCallback(
    (column: MetadataColumnWithVisibility) => {
      // toggleSortForColumn
      if (!column.sortable) return;
      if (sortInProgress) return;

      void (async () => {
        setSortInProgress(true);
        try {
          await ensureStableSelectionBeforeSort();
          applyToggleSort(column);
        } finally {
          setSortInProgress(false);
        }
      })();
    },
    [applyToggleSort, ensureStableSelectionBeforeSort, sortInProgress],
  );

  useEffect(() => {
    // keepSortValid
    if (!sortBy) return;

    const col = allColumns.find((c) => c.name === sortBy);
    if (!col || !col.sortable) {
      setSortState({ columnName: null, direction: "asc" });
    }
  }, [allColumns, sortBy]);

  useEffect(() => {
    // resetScrollOnSortChange
    const el = scrollRef.current;
    if (el) el.scrollTop = 0;

    const galleryEl = galleryScrollRef.current;
    if (galleryEl) galleryEl.scrollTop = 0;

    setSelectedImageCell(null);
    setSelectedRowIndex(null);
  }, [sortBy, sortAsc]);

  const activeSortLabel = useMemo(() => {
    if (!sortBy) return null;
    const col = allColumns.find((c) => c.name === sortBy);
    return col?.alias || col?.name || sortBy;
  }, [allColumns, sortBy]);

  const closeContextMenu = useCallback(() => {
    setContextMenu(null);
  }, []);

  const selectionBusyRef = useRef(selectionBusy);
  useEffect(() => {
    // keepSelectionBusyRefUpdated
    selectionBusyRef.current = selectionBusy;
  }, [selectionBusy]);

  const actionSubmittingRef = useRef(actionSubmitting);
  useEffect(() => {
    // keepActionSubmittingRefUpdated
    actionSubmittingRef.current = actionSubmitting;
  }, [actionSubmitting]);

  useEffect(() => {
    const prev = prevViewModeRef.current;
    if (prev === viewMode) return;

    prevViewModeRef.current = viewMode;

    if (viewMode === "gallery") {
      if (focusedRowIndex != null) {
        setGalleryAnchorRowIndex(focusedRowIndex);
        pendingGalleryScrollIndexRef.current = focusedRowIndex;
      } else {
        setGalleryAnchorRowIndex(0);
      }
      return;
    }

    if (viewMode === "table") {
      window.requestAnimationFrame(() => {
        window.requestAnimationFrame(() => {
          if (focusedRowIndex != null) {
            jumpToRowIndex(focusedRowIndex);
            return;
          }

          const container = scrollRef.current;
          if (container) {
            container.scrollTop = 0;
          }

          jumpToRowIndex(0);
        });
      });
    }
  }, [viewMode, focusedRowIndex, jumpToRowIndex]);


  useEffect(() => {
    if (viewMode !== "gallery") return;

    const targetIndex = pendingGalleryScrollIndexRef.current;
    if (targetIndex == null) return;

    const container = galleryScrollRef.current;
    if (!container) return;

    const selector = `[data-row-index="${targetIndex}"]`;
    const el = container.querySelector(selector) as HTMLElement | null;

    if (!el) return;

    el.scrollIntoView({ block: "center", inline: "nearest" });
    pendingGalleryScrollIndexRef.current = null;
  }, [viewMode, galleryRows.length, galleryBaseOffset, imageThumbSize]);

  const focusRowAfterSelection = useCallback(
    (rowIndex: number | null) => {
      if (rowIndex == null) return;

      setSelectedRowIndex(rowIndex);
      setSelectedImageCell(null);

      if (viewMode === "table") {
        jumpToRowIndex(rowIndex);
        return;
      }

      if (viewMode === "gallery") {
        setGalleryAnchorRowIndex(rowIndex);
        pendingGalleryScrollIndexRef.current = rowIndex;
      }
    },
    [jumpToRowIndex, viewMode],
  );

  const closeSelectionDialog = useCallback(() => {
    // closeSelectionDialogStable
    if (selectionBusyRef.current) return;
    setSelectionDialog({ open: false });
    setSelectionDialogError(null);
    setSelectionProgress(null);
  }, []);

  const closeActionDialog = useCallback(() => {
    // closeActionDialogStable
    if (actionSubmittingRef.current) return;
    setActionDialogState({ open: false, actionLabel: "" });
    setSubsetName(DEFAULT_SUBSET_NAME);
    setActionDialogError(null);
  }, []);

  const openActionDialog = useCallback((actionLabel: string) => {
    setActionDialogState({ open: true, actionLabel });
    setSubsetName(DEFAULT_SUBSET_NAME);
    setActionDialogError(null);
  }, []);

  const handlePrimaryRowClick = useCallback(
    (rowIndex: number, rowId: RowId | null, event: ReactMouseEvent<Element>) => {
      // handlePrimaryRowClick
      handlePrimaryRowClickByIndex(rowIndex, event);

      if (event.shiftKey) {
        setSelectionMode("index");
        clearIdSelection();
        return;
      }

      if (rowId == null) {
        setSelectionMode("index");
        clearIdSelection();
        return;
      }

      const key = rowIdToKey(rowId);

      setSelectionMode("ids");
      setSelectedRowIdKeys((prev) => {
        const next = new Set(prev);
        const map = selectedRowIdValuesRef.current;

        const isToggle = event.ctrlKey || event.metaKey;

        if (isToggle) {
          if (next.has(key)) {
            next.delete(key);
            map.delete(key);
          } else {
            next.add(key);
            map.set(key, rowId);
          }
          return next;
        }

        next.clear();
        map.clear();
        next.add(key);
        map.set(key, rowId);
        return next;
      });
    },
    [clearIdSelection, handlePrimaryRowClickByIndex],
  );

  const handleTableRowContextMenu = useCallback(
    (rowIndex: number, rowId: RowId | null, event: ReactMouseEvent<Element>) => {
      event.preventDefault();
      event.stopPropagation();

      if (selectionMode === "ids" && rowId != null) {
        const key = rowIdToKey(rowId);
        if (!selectedRowIdKeys.has(key)) {
          selectedRowIdValuesRef.current.clear();
          selectedRowIdValuesRef.current.set(key, rowId);
          setSelectedRowIdKeys(new Set([key]));
        }
      } else {
        if (!isRowSelectedByIndex(rowIndex)) {
          selectOnly(rowIndex);
        }
      }

      setSelectedRowIndex(rowIndex);
      setSelectedImageCell(null);

      setContextMenu({
        kind: "row",
        mouseX: event.clientX + 2,
        mouseY: event.clientY - 6,
        rowIndex,
        rowId,
      });
    },
    [isRowSelectedByIndex, selectOnly, selectionMode, selectedRowIdKeys],
  );

  const handleHeaderContextMenu = useCallback(
    (column: MetadataColumnWithVisibility, event: ReactMouseEvent<Element>) => {
      event.preventDefault();
      event.stopPropagation();

      setContextMenu({
        kind: "header",
        mouseX: event.clientX + 2,
        mouseY: event.clientY - 6,
        columnName: column.name,
      });
    },
    [],
  );

  const handleTableChange = useCallback(
    (event: SelectChangeEvent<string>) => {
      const value = event.target.value;

      setSelectedTable(value);
      setSchema(null);
      setSchemaError(null);

      invalidateWindowState();
      invalidateGalleryState();
      resetSelection();
      resetSort();
      clearImageCache();
      closeContextMenu();
      closeSelectionDialog();
      closeActionDialog();
    },
    [
      clearImageCache,
      closeActionDialog,
      closeContextMenu,
      closeSelectionDialog,
      invalidateGalleryState,
      invalidateWindowState,
      resetSelection,
      resetSort,
      setSchema,
      setSchemaError,
      setSelectedTable,
    ],
  );

  useEffect(() => {
    resetSelection();
    closeContextMenu();
    closeSelectionDialog();
    closeActionDialog();
    resetSort();
  }, [
    projectId,
    protocolId,
    outputName,
  ]);

  const openColumnsDialog = useCallback(() => {
    if (!schema) return;

    const columns = (schema.columns ?? []) as MetadataColumnWithVisibility[];
    const draft: Record<string, ColumnSettings> = {};

    for (const column of columns) {
      const current =
        columnSettings[column.name] ?? {
          visible: column.visible !== false,
          renderAsImage: column.rendererType === "image",
        };

      draft[column.name] = { ...current };
    }

    setDraftColumnSettings(draft);
    setColumnsDialogOpen(true);
  }, [schema, columnSettings]);

  const closeColumnsDialog = useCallback(() => {
    setColumnsDialogOpen(false);
    setDraftColumnSettings(null);
  }, []);

  const applyColumnsDialog = useCallback(() => {
    if (draftColumnSettings) {
      setColumnSettings(draftColumnSettings);
    }
    setColumnsDialogOpen(false);
    setDraftColumnSettings(null);
  }, [draftColumnSettings, setColumnSettings]);

  const updateDraftColumnSettings = useCallback(
    (columnName: string, partial: Partial<ColumnSettings>) => {
      setDraftColumnSettings((prev) => {
        if (!prev) return prev;

        const current = prev[columnName] ?? {
          visible: true,
          renderAsImage: false,
        };

        return {
          ...prev,
          [columnName]: {
            ...current,
            ...partial,
          },
        };
      });
    },
    [],
  );

  const resolveSelectedRowIds = useCallback(async (): Promise<Array<string | number>> => {
    // resolveSelectedRowIds
    if (selectionMode === "ids") {
      return Array.from(selectedRowIdValuesRef.current.values());
    }

    if (!selectedTable || !schema || totalRows <= 0) {
      return [];
    }

    if (selectedCountByIndex <= 0) {
      return [];
    }

    const rowIds: Array<string | number> = [];

    for (let offset = 0; offset < totalRows; offset += SELECTION_IDS_SCAN_PAGE_SIZE) {
      const response = (await svcRef.current.fetchMetadataTableWindow(
        projectId,
        protocolId,
        outputName,
        selectedTable,
        {
          offset,
          limit: Math.min(SELECTION_IDS_SCAN_PAGE_SIZE, totalRows - offset),
          selectionOnly: false,
          sortBy: sortBy ?? undefined,
          asc: sortBy ? sortAsc : undefined,
        },
      )) as MetadataWindowResponse;

      const parsed = parseWindowResponse(response);
      const actualOffset = parsed.offset ?? offset;

      for (let rowIndex = 0; rowIndex < parsed.rows.length; rowIndex += 1) {
        const globalRowIndex = actualOffset + rowIndex;

        if (!isRowIndexSelected(selectionState, globalRowIndex)) {
          continue;
        }

        const rowId = resolveMetadataRowId(schema, parsed.rows[rowIndex]);
        if (rowId != null) {
          rowIds.push(rowId);
        }
      }
    }

    return rowIds;
  }, [
    selectionMode,
    selectedTable,
    schema,
    totalRows,
    selectedCountByIndex,
    svcRef,
    projectId,
    protocolId,
    outputName,
    sortBy,
    sortAsc,
    selectionState,
  ]);

  const invokeMetadataAction = useCallback(
    async (payload: MetadataActionRequestPayload) => {
      // invokeMetadataAction
      const action = (payload.action || "").trim();
      if (!action) {
        throw new Error("Missing action");
      }

      const ids = payload.rowIds ?? [];
      if (!Array.isArray(ids) || ids.length === 0) {
        throw new Error("Missing selected row ids");
      }

      const subsetNameValue = (payload.subsetName || "").trim();

      return svcRef.current.runMetadataTableAction(
        payload.projectId,
        payload.protocolId,
        payload.outputName,
        payload.tableName,
        {
          action,
          subsetName: subsetNameValue,
          ids,
        },
      );
    },
    [svcRef],
  );

  const handleAcceptAction = useCallback(async () => {
    // handleAcceptAction
    if (!schema || !selectedTable || !actionDialogState.actionLabel) {
      return;
    }

    const safeSubsetName = subsetName.trim() || DEFAULT_SUBSET_NAME;

    try {
      setActionSubmitting(true);
      setActionDialogError(null);

      const rowIds = await resolveSelectedRowIds();

      if (rowIds.length === 0) {
        throw new Error("No selected rows with valid ids were found");
      }

      const result = await invokeMetadataAction({
        action: actionDialogState.actionLabel,
        subsetName: safeSubsetName,
        rowIds,
        projectId,
        protocolId,
        outputName,
        tableName: selectedTable,
      });

      const success =
        typeof (result as any)?.success === "boolean" ? (result as any).success : true;

      if (!success) {
        const msg =
          (result as any)?.message ||
          (Array.isArray((result as any)?.errors) ? (result as any).errors.join("\n") : "") ||
          "Action did not generate a new subset";
        setActionDialogError(msg);
        return;
      }

      setActionDialogState({ open: false, actionLabel: "" });
      setSubsetName(DEFAULT_SUBSET_NAME);
      setActionDialogError(null);
    } catch (error) {
      setActionDialogError(getErrorMessage(error, "Failed to execute action"));
    } finally {
      if (isMountedRef.current) {
        setActionSubmitting(false);
      }
    }
  }, [
    schema,
    selectedTable,
    actionDialogState.actionLabel,
    subsetName,
    resolveSelectedRowIds,
    invokeMetadataAction,
    projectId,
    protocolId,
    outputName,
    isMountedRef,
  ]);

  const materializeIndexSelectionToIds = useCallback(async () => {
    // materializeIndexSelectionToIds
    if (selectionMode === "ids") return;
    if (!schema || !selectedTable || totalRows <= 0) return;
    if (selectedCountByIndex <= 0) return;

    setSelectionBusy(true);
    setSelectionDialogError(null);
    setSelectionProgress({ done: 0, total: selectedCountByIndex });

    const nextKeys = new Set<RowIdKey>();
    const nextMap = new Map<RowIdKey, RowId>();
    let done = 0;

    try {
      for (let offset = 0; offset < totalRows; offset += SELECTION_IDS_SCAN_PAGE_SIZE) {
        const response = (await svcRef.current.fetchMetadataTableWindow(
          projectId,
          protocolId,
          outputName,
          selectedTable,
          {
            offset,
            limit: Math.min(SELECTION_IDS_SCAN_PAGE_SIZE, totalRows - offset),
            selectionOnly: false,
            sortBy: sortBy ?? undefined,
            asc: sortBy ? sortAsc : undefined,
          },
        )) as MetadataWindowResponse;

        const parsed = parseWindowResponse(response);
        const actualOffset = parsed.offset ?? offset;

        for (let i = 0; i < parsed.rows.length; i += 1) {
          const globalRowIndex = actualOffset + i;
          if (!isRowIndexSelected(selectionState, globalRowIndex)) continue;

          const rowId = resolveMetadataRowId(schema, parsed.rows[i]);
          if (rowId == null) continue;

          const key = rowIdToKey(rowId);
          if (!nextKeys.has(key)) {
            nextKeys.add(key);
            nextMap.set(key, rowId);
            done += 1;
          }
        }

        setSelectionProgress({ done, total: selectedCountByIndex });
      }

      selectedRowIdValuesRef.current = nextMap;
      setSelectedRowIdKeys(nextKeys);
      setSelectionMode("ids");

      clearSelection();
      setSelectedRowIndex(null);
      setSelectedImageCell(null);
    } catch (error) {
      setSelectionDialogError(getErrorMessage(error, "Failed to freeze selection"));
    } finally {
      if (isMountedRef.current) {
        setSelectionBusy(false);
        setSelectionProgress(null);
      }
    }
  }, [
    selectionMode,
    schema,
    selectedTable,
    totalRows,
    selectedCountByIndex,
    svcRef,
    projectId,
    protocolId,
    outputName,
    sortBy,
    sortAsc,
    selectionState,
    clearSelection,
    isMountedRef,
  ]);

  const runColumnCriteriaSelection = useCallback(async () => {
    // runColumnCriteriaSelection
    // trackFirstMatchedRowForAutoFocus
    let firstMatchIndex: number | null = null;
    if (selectionBusyRef.current) return;
    if (!schema || !selectedTable || totalRows <= 0) return;
    if (!selectionDialog.open || selectionDialog.kind !== "criteria") return;

    const column = allColumns.find((c) => c.name === selectionDialog.columnName);
    if (!column) {
      setSelectionDialogError("Selected column not found");
      return;
    }

    if (isNumericOperator(selectionDialog.operator) && !selectionDialog.treatAsNumber) {
      setSelectionDialogError("Numeric operators require 'Compare as: Number'");
      return;
    }

    const prevKeys = selectedRowIdKeys;
    const prevMap = selectedRowIdValuesRef.current;

    const targetScopeTotal =
      selectionDialog.scope === "allRows"
        ? totalRows
        : selectionMode === "ids"
          ? prevKeys.size
          : selectedCountByIndex;

    setSelectionBusy(true);
    setSelectionDialogError(null);
    setSelectionProgress({ done: 0, total: Math.max(0, targetScopeTotal) });

    const matchKeys = new Set<RowIdKey>();
    const matchMap = new Map<RowIdKey, RowId>();
    const matchedIndices: number[] = [];

    let done = 0;
    let remainingIdsToScan = selectionDialog.scope === "currentSelection" && selectionMode === "ids"
      ? prevKeys.size
      : null;

    const shouldIncludeRow = (globalRowIndex: number, rowId: RowId | null): boolean => {
      if (selectionDialog.scope === "allRows") return true;

      if (selectionMode === "ids") {
        if (rowId == null) return false;
        return prevKeys.has(rowIdToKey(rowId));
      }

      return isRowIndexSelected(selectionState, globalRowIndex);
    };

    const offsetsToScan: Array<{ offset: number; limit: number }> = [];

    if (selectionDialog.scope === "currentSelection" && selectionMode === "index" && selectionState.baseMode === "none") {
      const merged = mergeRanges(selectionState.ranges);
      for (const range of merged) {
        let offset = range.start;
        while (offset <= range.end) {
          const limit = Math.min(SELECTION_IDS_SCAN_PAGE_SIZE, range.end - offset + 1);
          offsetsToScan.push({ offset, limit });
          offset += limit;
        }
      }
    } else {
      for (let offset = 0; offset < totalRows; offset += SELECTION_IDS_SCAN_PAGE_SIZE) {
        offsetsToScan.push({
          offset,
          limit: Math.min(SELECTION_IDS_SCAN_PAGE_SIZE, totalRows - offset),
        });
      }
    }

    try {
      for (const { offset, limit } of offsetsToScan) {
        const response = (await svcRef.current.fetchMetadataTableWindow(
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
        )) as MetadataWindowResponse;

        const parsed = parseWindowResponse(response);
        const actualOffset = parsed.offset ?? offset;

        for (let i = 0; i < parsed.rows.length; i += 1) {
          const row = parsed.rows[i];
          const globalRowIndex = actualOffset + i;
          const rowId = resolveMetadataRowId(schema, row);

          if (!shouldIncludeRow(globalRowIndex, rowId)) continue;

          if (selectionDialog.scope === "currentSelection") {
            done += 1;
          } else {
            // allRows progress uses fetched scan position for smoother UI
            done = Math.min(totalRows, globalRowIndex + 1);
          }

          if (remainingIdsToScan != null && selectionMode === "ids" && rowId != null) {
            const key = rowIdToKey(rowId);
            if (prevKeys.has(key)) {
              remainingIdsToScan -= 1;
            }
          }

          const cell = row.values?.[column.index] as MetadataCell;

          const ok = evaluateCriteria(cell, selectionDialog.operator, selectionDialog.value1, selectionDialog.value2, {
            caseSensitive: selectionDialog.caseSensitive,
            treatAsNumber: selectionDialog.treatAsNumber,
            negate: selectionDialog.negate,
          });

          if (!ok) continue;

          if (firstMatchIndex == null || globalRowIndex < firstMatchIndex) {
            firstMatchIndex = globalRowIndex;
          }

          if (rowId == null) {
            matchedIndices.push(globalRowIndex);
            continue;
          }

          const key = rowIdToKey(rowId);
          if (!matchKeys.has(key)) {
            matchKeys.add(key);
            matchMap.set(key, rowId);
          }
        }

        setSelectionProgress({ done, total: Math.max(0, targetScopeTotal) });

        if (remainingIdsToScan != null && remainingIdsToScan <= 0) {
          break;
        }
      }

      if (matchKeys.size === 0 && matchedIndices.length > 0) {
        // fallbackToIndexSelectionWhenNoRowIds
        const matchedRanges = indicesToRanges(matchedIndices);

        const prevRanges =
          selectionMode === "index"
            ? selectionStateToSelectedRanges(selectionState, totalRows)
            : [];

        let nextRanges: IndexRange[] = matchedRanges;

        if (selectionDialog.setOp === "add") {
          nextRanges = mergeRanges([...prevRanges, ...matchedRanges]);
        } else if (selectionDialog.setOp === "intersect") {
          nextRanges = intersectRanges(prevRanges, matchedRanges);
        } else if (selectionDialog.setOp === "remove") {
          nextRanges = subtractRanges(prevRanges, matchedRanges);
        }

        setSelectionMode("index");
        clearIdSelection();
        setSelectionRanges(nextRanges);

        const firstSelected = nextRanges.length ? nextRanges[0].start : null;
        focusRowAfterSelection(firstSelected);

        closeSelectionDialog();
        closeContextMenu();
        return;
      }

      if (matchKeys.size === 0) {
        setSelectionDialogError("No rows matched the criteria.");
        return;
      }

      const applied = applySetOperationToIdMaps({
        prevKeys,
        prevMap,
        matchKeys,
        matchMap,
        setOp: selectionDialog.setOp,
      });

      selectedRowIdValuesRef.current = applied.map;
      setSelectedRowIdKeys(applied.keys);
      setSelectionMode("ids");

      clearSelection();
      if (selectionDialog.setOp !== "remove") {
        focusRowAfterSelection(firstMatchIndex);
      }

      closeSelectionDialog();
      closeContextMenu();
    } catch (error) {
      setSelectionDialogError(getErrorMessage(error, "Failed to apply selection criteria"));
    } finally {
      if (isMountedRef.current) {
        setSelectionBusy(false);
        setSelectionProgress(null);
      }
    }
  }, [
    schema,
    selectedTable,
    totalRows,
    selectionDialog,
    allColumns,
    svcRef,
    projectId,
    protocolId,
    outputName,
    sortBy,
    sortAsc,
    selectedRowIdKeys,
    selectionMode,
    selectedCountByIndex,
    selectionState,
    clearSelection,
    closeSelectionDialog,
    closeContextMenu,
    isMountedRef,
  ]);

  const openCriteriaDialogForColumn = useCallback(
    (params: {
      columnName: string;
      operator?: CriteriaOperator;
      treatAsNumber?: boolean;
    }) => {
      const operator = params.operator ?? "equals";
      const numeric = isNumericOperator(operator);
      const treatAsNumber = params.treatAsNumber ?? (numeric ? true : false);

      setSelectionDialog({
        open: true,
        kind: "criteria",
        title: "Select where…",
        columnName: params.columnName,
        operator,
        value1: "",
        value2: "",
        caseSensitive: false,
        treatAsNumber,
        negate: false,
        scope: "allRows",
        setOp: "replace",
      });
      setSelectionDialogError(null);
    },
    [],
  );

  const contextMenuColumnLabel = useMemo(() => {
    if (!contextMenu || contextMenu.kind !== "header") return null;
    const col = allColumns.find((c) => c.name === contextMenu.columnName);
    return col?.alias || col?.name || contextMenu.columnName;
  }, [allColumns, contextMenu]);

  const selectionDialogColumnLabel = useMemo(() => {
    if (!selectionDialog.open || selectionDialog.kind !== "criteria") return null;

    const column = allColumns.find((item) => item.name === selectionDialog.columnName);
    return column?.alias || column?.name || selectionDialog.columnName;
  }, [allColumns, selectionDialog]);

  return (
    <Box
      sx={{
        display: "flex",
        flexDirection: "column",
        flex: 1,
        flexShrink: 1,
        minHeight: 0,
        minWidth: 0,
        height: "100%",
        overflow: "hidden",
        mt: 0
      }}
    >
      {/* Header */}
      <Box
        className="ml-4 mr-4 p-1 border rounded-lg shadow-sm bg-white dark:bg-gray-800 flex items-center gap-1"
        sx={{
          display: "flex",
          alignItems: "center",
          gap: 2,
          mb: 1.5,
          flexWrap: "wrap",
          flexShrink: 0,
        }}
      >
        <Box
          className="ml-0 mr-4 p-0 border rounded-lg shadow-sm bg-white dark:bg-gray-800 flex items-center"
          sx={{
            display: "flex",
            alignItems: "center",
            gap: 0.5,
            minWidth: 96,
            px: 1,
            py: 0.5,
          }}
        >
          <Typography variant="caption" sx={{ mr: 0.5, color: "text.secondary", fontWeight: 500 }}>
            View mode:
          </Typography>

          <Tooltip title="Table">
            <span>
              <IconButton
                size="small"
                color={viewMode === "table" ? "primary" : "default"}
                onClick={() => setViewMode("table")}
              >
                <TableIcon size={16} />
              </IconButton>
            </span>
          </Tooltip>

          <Tooltip
            title={
              hasImageColumns
                ? "Gallery"
                : "Gallery view is only available when the table has image columns"
            }
          >
            <span>
              <IconButton
                size="small"
                color={viewMode === "gallery" ? "primary" : "default"}
                disabled={!hasImageColumns}
                onClick={() => {
                  if (!hasImageColumns) return;
                  setViewMode("gallery");
                }}
              >
                <LayoutGrid size={16} />
              </IconButton>
            </span>
          </Tooltip>

          <Divider
            orientation="vertical"
            flexItem
            sx={{ mx: 1, borderColor: "rgba(148,163,184,0.6)" }}
          />

          {viewMode === "table" && schema && (
            <Tooltip title="Manage columns">
              <span>
                <IconButton size="small" onClick={openColumnsDialog}>
                  <ColumnsSettingsIcon size={16} />
                </IconButton>
              </span>
            </Tooltip>
          )}

          {viewMode === "table" && schema && (
            <Tooltip title="Plotter">
              <span>
                <IconButton
                  size="small"
                  onClick={() => setPlotterOpen(true)}
                  disabled={!schema || totalRows <= 0}
                >
                  <PlotterIcon size={16} />
                </IconButton>
              </span>
            </Tooltip>
          )}

          {viewMode === "gallery" && schema && (
            <Tooltip title="Manage columns">
              <span>
                <IconButton disabled size="small">
                  <ColumnsSettingsIcon size={16} />
                </IconButton>
              </span>
            </Tooltip>
          )}
        </Box>

        <Box sx={{ flex: 1, display: "flex", justifyContent: "center", alignItems: "center", gap: 1, flexWrap: "wrap", }}>
          <FormControl size="small" sx={{ minWidth: 240, mt: 1 }}>
            <InputLabel id="metadata-table-select-label">Metadata table</InputLabel>
            <Select
              labelId="metadata-table-select-label"
              label="Metadata table"
              value={selectedTable}
              onChange={handleTableChange}
              disabled={tablesLoading || !tables || tables.length === 0}
              renderValue={(value) => {
                if (!value) return "";
                const table = tables?.find((item) => item.name === value);
                const label = table?.alias || table?.name || value;

                return (
                  <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                    <TableIcon size={16} />
                    <span>{label}</span>
                  </Box>
                );
              }}
            >
              {tables?.map((table) => {
                const label = table.alias || table.name;
                return (
                  <MenuItem key={table.name} value={table.name}>
                    <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                      <TableIcon size={14} />
                      <span>{label}</span>
                    </Box>
                  </MenuItem>
                );
              })}
            </Select>
          </FormControl>

          <Tooltip title="Zoom in %">
            <span>
              <TextField
                size="small"
                type="number"
                label="Zoom"
                value={zoomInputPercent}
                onChange={(e) => {
                  const raw = Number(e.target.value);
                  if (!Number.isFinite(raw)) return;
                  applyZoomPercent(raw, false);
                }}
                onBlur={() => {
                  applyZoomPercent(zoomInputPercent, true);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    applyZoomPercent(zoomInputPercent, true);
                  }
                }}
                disabled={!zoomEnabled}
                sx={{ width: 120 }}
                inputProps={{ step: ZOOM_STEP_PERCENT, min: ZOOM_MIN_PERCENT, max: ZOOM_MAX_PERCENT }}
                InputProps={{
                  startAdornment: (
                    <InputAdornment position="start">
                      <Search size={16} />
                    </InputAdornment>
                  ),
                }}
              />
            </span>
          </Tooltip>

          <Tooltip title={goToError ?? "Go to item"}>
            <span>
              <TextField
                size="small"
                type="number"
                label="Go to item"
                value={goToIdInput}
                onChange={(e) => {
                  const next = e.target.value;
                  setGoToIdInput(next);
                  setGoToError(null);
                  scheduleGoTo(next);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    void goToItemById();
                  }
                }}
                onBlur={() => {
                  void goToItemById();
                }}
                disabled={!schema || !selectedTable || totalRows <= 0 || goToBusy}
                error={!!goToError}
                sx={{ width: 150 }}
                inputProps={{ step: 1, min: 0 }}
                InputProps={{
                  startAdornment: (
                    <InputAdornment position="start">
                      <Hash size={16} />
                    </InputAdornment>
                  ),
                  endAdornment: goToBusy ? (
                    <InputAdornment position="end">
                      <CircularProgress size={14} />
                    </InputAdornment>
                  ) : null,
                }}
              />
            </span>
          </Tooltip>


        </Box>

        <Box
          className="mr-2"
          sx={{
            display: "flex",
            gap: 1,
            alignItems: "center",
            flexWrap: "wrap",
            justifyContent: "flex-end",
            minWidth: 240,
          }}
        >
          <Typography variant="caption" color="text.secondary">
            Output: <strong>{outputName}</strong>
          </Typography>
          <Typography variant="caption" color="text.secondary">
            Rows: <strong>{totalRows}</strong>
          </Typography>
          <Typography variant="caption" color="text.secondary">
            Selected: <strong>{effectiveSelectedCount}</strong>
          </Typography>
        </Box>
      </Box>

      <Box
        sx={{
          flex: "1 1 auto",
          minHeight: 0,
          minWidth: 0,
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
        }}
      >

        {tablesLoading && (
          <Box sx={{ display: "flex", gap: 1, alignItems: "center", mb: 1 }}>
            <CircularProgress size={16} />
            <Typography variant="body2">Loading tables…</Typography>
          </Box>
        )}

        {tablesError && (
          <Typography variant="body2" color="error" sx={{ mb: 1 }}>
            {tablesError}
          </Typography>
        )}

        {!tablesLoading && !tablesError && tables && tables.length === 0 && (
          <Typography variant="body2" color="text.secondary">
            No metadata tables for this output.
          </Typography>
        )}

        {selectedTable && schemaLoading && !schema && (
          <Box sx={{ display: "flex", gap: 1, alignItems: "center", mt: 2 }}>
            <CircularProgress size={18} />
            <Typography variant="body2">Loading schema…</Typography>
          </Box>
        )}

        {selectedTable && schemaError && (
          <Typography variant="body2" color="error" sx={{ mt: 2 }}>
            {schemaError}
          </Typography>
        )}

        {selectedTable && schema && totalRows === 0 && (
          <Typography variant="body2" color="text.secondary" sx={{ mt: 2 }}>
            This table has no rows.
          </Typography>
        )}

        {viewMode === "table" && (
          <MetadataTablePanel
            schema={schema}
            totalRows={totalRows}
            visibleColumns={visibleColumns}
            columnSettings={columnSettings}
            rowHeight={rowHeight}
            rowSizeForScroll={rowSizeForScroll}
            imageThumbSize={imageThumbSize}
            imageColMinWidth={imageColMinWidth}
            tableMinWidth={tableMinWidth}
            windowRows={windowRows}
            windowOffset={windowOffset}
            windowLoading={windowLoading}
            windowError={windowError}
            topSpacerHeight={topSpacerHeight}
            bottomSpacerHeight={bottomSpacerHeight}
            hasData={hasData}
            scrollRef={scrollRef}
            handleScroll={handleScroll}
            isRowSelected={isRowSelected}
            onPrimaryRowClick={handlePrimaryRowClick}
            onRowContextMenu={handleTableRowContextMenu}
            onHeaderContextMenu={handleHeaderContextMenu}
            selectedImageCell={selectedImageCell}
            setSelectedRowIndex={setSelectedRowIndex}
            setSelectedImageCell={setSelectedImageCell}
            projectId={projectId}
            protocolId={protocolId}
            outputName={outputName}
            selectedTable={selectedTable}
            imageCacheRef={imageCacheRef}
            sortBy={sortBy}
            sortAsc={sortAsc}
            onToggleSort={toggleSortForColumn}
            matrixColumnNames={matrixColumnNames}
          />
        )}

        {viewMode === "gallery" && selectedTable && schema && totalRows > 0 && (
          <MetadataGalleryPanel
            schema={schema}
            firstImageColumn={firstImageColumn}
            galleryRows={galleryRows}
            galleryLoading={galleryLoading}
            galleryError={galleryError}
            galleryScrollRef={galleryScrollRef}
            handleGalleryScroll={handleGalleryScroll}
            isRowSelected={isRowSelected}
            onPrimaryRowClick={handlePrimaryRowClick}
            selectedImageCell={selectedImageCell}
            setSelectedRowIndex={setSelectedRowIndex}
            setSelectedImageCell={setSelectedImageCell}
            projectId={projectId}
            protocolId={protocolId}
            outputName={outputName}
            selectedTable={selectedTable}
            imageCacheRef={imageCacheRef}
            showSizeLabel={showSizeLabel}
            sizeColumn={sizeColumn}
            imageThumbSize={imageThumbSize}
            galleryBaseOffset={galleryBaseOffset}
          />
        )}
      </Box>

      {/* Footer */}
      <Paper
        variant="outlined"
        sx={{
          mt: 0,
          p: 1,
          flexShrink: 0,
          borderColor: "rgba(148,163,184,0.4)",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 1,
          flexWrap: "wrap",
          background:
            "linear-gradient(180deg, rgba(248,250,252,0.95) 0%, rgba(241,245,249,0.95) 100%)",
        }}
      >
        <Box sx={{ display: "flex", alignItems: "center", gap: 1, flexWrap: "wrap" }}>
          <Typography
            variant="caption"
            sx={{
              color: "#334155",
              px: 1,
              py: 0.5,
              borderRadius: 1,
              backgroundColor: "rgba(148,163,184,0.12)",
              border: "1px solid rgba(148,163,184,0.22)",
            }}
          >
            Selected rows: <strong>{effectiveSelectedCount}</strong>
          </Typography>

          <Typography
            variant="caption"
            sx={{
              color: "#334155",
              px: 1,
              py: 0.5,
              borderRadius: 1,
              backgroundColor: "rgba(148,163,184,0.12)",
              border: "1px solid rgba(148,163,184,0.22)",
            }}
          >
            Sort: <strong>{activeSortLabel ?? "default"}</strong>
            {activeSortLabel ? ` (${sortAsc ? "asc" : "desc"})` : ""}
          </Typography>

          {sortInProgress && (
            <Typography variant="caption" color="text.secondary">
              Sorting…
            </Typography>
          )}

          {selectionBusy && (
            <Typography variant="caption" color="text.secondary">
              Selecting…
            </Typography>
          )}
        </Box>

        <Box
          sx={{
            display: "flex",
            alignItems: "center",
            gap: 1,
            flexWrap: "wrap",
            justifyContent: "flex-end",
            ml: "auto",
          }}
        >
          {hasMetadataActions &&
            metadataActions.map((actionLabel) => (
              <Button
                key={actionLabel}
                size="small"
                variant="contained"
                startIcon={<Plus size={14} />}
                onClick={() => openActionDialog(actionLabel)}
                disabled={!schema || effectiveSelectedCount <= 0 || actionSubmitting}
                sx={{
                  textTransform: "none",
                  fontWeight: 600,
                  color: "#e2e8f0",
                  border: "1px solid rgba(255,255,255,0.08)",
                  background: "linear-gradient(180deg, #1e293b 0%, #0f172a 100%)",
                  boxShadow:
                    "0 1px 2px rgba(15,23,42,0.25), inset 0 1px 0 rgba(255,255,255,0.06)",
                  "&:hover": {
                    background: "linear-gradient(180deg, #334155 0%, #1e293b 100%)",
                    boxShadow:
                      "0 2px 6px rgba(15,23,42,0.28), inset 0 1px 0 rgba(255,255,255,0.08)",
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
            ))}


          {!embedded && (
            <Button
              size="small"
              variant="contained"
              color="error"
              startIcon={<CloseIcon />}
              onClick={() => {
                onClose?.();
              }}
              disabled={!onClose}
              sx={{
                textTransform: "none",
                fontWeight: 600,
                boxShadow: "0 1px 3px rgba(127,29,29,0.25)",
              }}
            >
              Close
            </Button>
          )}
        </Box>
      </Paper>

      {columnsDialogOpen && (
        <ColumnsDialog
          open={columnsDialogOpen}
          onClose={closeColumnsDialog}
          onApply={applyColumnsDialog}
          allColumns={allColumns}
          columnSettings={columnSettings}
          draftColumnSettings={draftColumnSettings}
          updateDraftColumnSettings={updateDraftColumnSettings}
        />
      )}

      {plotterOpen && (
        <MetadataPlotterDialog
          open={plotterOpen}
          onClose={() => setPlotterOpen(false)}
          projectId={projectId}
          protocolId={protocolId}
          outputName={outputName}
          selectedTable={selectedTable}
          schema={schema}
          totalRows={totalRows}
          allColumns={allColumns}
          schemaActions={schemaActions}
          sortBy={sortBy}
          sortAsc={sortAsc}
          svcRef={svcRef as any}
          isRowSelectedInViewer={isRowSelected}
          viewerSelectedCount={effectiveSelectedCount}
        />
      )}

      {/* Context menu (direct, small typography) */}
      <Menu
        open={!!contextMenu}
        onClose={closeContextMenu}
        anchorReference="anchorPosition"
        anchorPosition={
          contextMenu ? { top: contextMenu.mouseY, left: contextMenu.mouseX } : undefined
        }
        transformOrigin={{ horizontal: "left", vertical: "top" }}
        PaperProps={{
          sx: {
            "& .MuiMenuItem-root": { fontSize: "0.78rem", py: 0.6 },
            "& .MuiListItemIcon-root": { minWidth: 26 },
            "& .MuiListItemText-primary": { fontSize: "0.78rem" },
            minWidth: 260,
          },
        }}
        MenuListProps={{ dense: true, sx: { py: 0.25 } }}
      >
        {contextMenu?.kind === "row" && (
          <>
            <MenuItem
              onClick={() => {
                setSelectionMode("index");
                clearIdSelection();
                selectAll();
                closeContextMenu();
              }}
            >
              <ListItemIcon>
                <List size={16} />
              </ListItemIcon>
              <ListItemText primary="All" />
            </MenuItem>

            <MenuItem
              onClick={() => {
                resetSelection();
                closeContextMenu();
              }}
            >
              <ListItemIcon>
                <CloseIcon fontSize="small" />
              </ListItemIcon>
              <ListItemText primary="Clear selection" />
            </MenuItem>

            <MenuItem
              onClick={() => {
                void materializeIndexSelectionToIds();
                closeContextMenu();
              }}
              disabled={selectionMode === "ids" || selectedCountByIndex <= 0 || !schema}
            >
              <ListItemIcon>
                <Bookmark size={16} />
              </ListItemIcon>
              <ListItemText primary="Freeze selection (ids)" />
            </MenuItem>

            <Divider />

            <MenuItem
              onClick={() => {
                setSelectionMode("index");
                clearIdSelection();
                selectFromHere(contextMenu.rowIndex);
                closeContextMenu();
              }}
            >
              <ListItemIcon>
                <ArrowDown size={16} />
              </ListItemIcon>
              <ListItemText primary="From here" />
            </MenuItem>

            <MenuItem
              onClick={() => {
                setSelectionMode("index");
                clearIdSelection();
                selectToHere(contextMenu.rowIndex);
                closeContextMenu();
              }}
            >
              <ListItemIcon>
                <ArrowUp size={16} />
              </ListItemIcon>
              <ListItemText primary="To here" />
            </MenuItem>

            <MenuItem
              onClick={() => {
                setSelectionMode("index");
                clearIdSelection();
                invertSelection();
                closeContextMenu();
              }}
            >
              <ListItemIcon>
                <RefreshCcw size={16} />
              </ListItemIcon>
              <ListItemText primary="Invert selection" />
            </MenuItem>
          </>
        )}

        {contextMenu?.kind === "header" && (
          <>
            <MenuItem disabled sx={{ opacity: 0.9 }}>
              <ListItemText primary={`Column: ${contextMenuColumnLabel ?? contextMenu.columnName}`} />
            </MenuItem>

            <Divider />

            <MenuItem
              onClick={() => {
                openCriteriaDialogForColumn({ columnName: contextMenu.columnName });
                closeContextMenu();
              }}
            >
              <ListItemIcon>
                <Filter size={16} />
              </ListItemIcon>
              <ListItemText primary="Select where…" />
            </MenuItem>

            <MenuItem
              onClick={() => {
                openCriteriaDialogForColumn({
                  columnName: contextMenu.columnName,
                  operator: "contains",
                });
                closeContextMenu();
              }}
            >
              <ListItemIcon>
                <Filter size={16} />
              </ListItemIcon>
              <ListItemText primary="Contains…" />
            </MenuItem>

            <MenuItem
              onClick={() => {
                openCriteriaDialogForColumn({
                  columnName: contextMenu.columnName,
                  operator: "gt",
                  treatAsNumber: true,
                });
                closeContextMenu();
              }}
            >
              <ListItemIcon>
                <Sigma size={16} />
              </ListItemIcon>
              <ListItemText primary="Greater than…" />
            </MenuItem>

            <MenuItem
              onClick={() => {
                openCriteriaDialogForColumn({
                  columnName: contextMenu.columnName,
                  operator: "lt",
                  treatAsNumber: true,
                });
                closeContextMenu();
              }}
            >
              <ListItemIcon>
                <Sigma size={16} />
              </ListItemIcon>
              <ListItemText primary="Less than…" />
            </MenuItem>

            <MenuItem
              onClick={() => {
                openCriteriaDialogForColumn({
                  columnName: contextMenu.columnName,
                  operator: "between",
                  treatAsNumber: true,
                });
                closeContextMenu();
              }}
            >
              <ListItemIcon>
                <Sigma size={16} />
              </ListItemIcon>
              <ListItemText primary="Between…" />
            </MenuItem>

            <Divider />

            <MenuItem
              onClick={() => {
                resetSelection();
                closeContextMenu();
              }}
            >
              <ListItemIcon>
                <CloseIcon fontSize="small" />
              </ListItemIcon>
              <ListItemText primary="Clear selection" />
            </MenuItem>
          </>
        )}
      </Menu>

      {/* Selection dialog */}
      <Dialog
        open={selectionDialog.open}
        onClose={(_event, reason) => {
          if (selectionBusy) return;
          if (reason === "backdropClick") return;
          closeSelectionDialog();
        }}
        maxWidth="md"
        fullWidth
        PaperProps={{
          sx: {
            borderRadius: 3,
            overflow: "hidden",
            border: "1px solid rgba(15,23,42,0.08)",
            boxShadow: "0 24px 52px rgba(15,23,42,0.22), 0 10px 20px rgba(15,23,42,0.12)",
          },
        }}
      >
        <DialogTitle
          sx={{
            px: 2,
            py: 1.45,
            display: "flex",
            alignItems: "center",
            gap: 1.25,
            background: "linear-gradient(135deg, #0f172a 0%, #1e293b 55%, #334155 100%)",
            color: "#e2e8f0",
            borderBottom: "1px solid rgba(255,255,255,0.08)",
          }}
        >
          <Box
            sx={{
              width: 34,
              height: 34,
              borderRadius: 2,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              background: "rgba(255,255,255,0.10)",
              border: "1px solid rgba(255,255,255,0.16)",
              color: "#e0f2fe",
              flexShrink: 0,
            }}
          >
            <Filter size={18} />
          </Box>

          <Box sx={{ minWidth: 0, flex: 1 }}>
            <Typography
              variant="subtitle1"
              sx={{
                fontWeight: 800,
                lineHeight: 1.15,
                color: "#f8fafc",
              }}
            >
              {selectionDialog.open ? selectionDialog.title : "Selection"}
            </Typography>

            <Typography
              variant="caption"
              sx={{
                color: "rgba(226,232,240,0.82)",
                display: "block",
                mt: 0.25,
              }}
            >
              Build a stable row selection from metadata values, ranges, or row positions
            </Typography>
          </Box>

          <IconButton
            size="small"
            onClick={closeSelectionDialog}
            disabled={selectionBusy}
            aria-label="Close selection dialog"
            sx={{
              color: "#e2e8f0",
              border: "1px solid rgba(255,255,255,0.18)",
              background: "rgba(255,255,255,0.06)",
              "&:hover": {
                background: "rgba(255,255,255,0.12)",
                borderColor: "rgba(255,255,255,0.28)",
              },
              "&.Mui-disabled": {
                color: "rgba(226,232,240,0.4)",
                borderColor: "rgba(255,255,255,0.08)",
              },
            }}
          >
            <CloseIcon fontSize="small" />
          </IconButton>
        </DialogTitle>

        <DialogContent
          dividers
          sx={{
            p: 0,
            background:
              "linear-gradient(180deg, rgba(248,250,252,0.98) 0%, rgba(241,245,249,0.92) 100%)",
          }}
        >
          <Box
            sx={{
              p: 2.25,
              display: "flex",
              flexDirection: "column",
              gap: 1.5,
            }}
          >
            {selectionDialogError && (
              <Box sx={{ mb: 1.5 }}>
                <Typography variant="body2" color="error" sx={{ fontWeight: 600 }}>
                  {selectionDialogError}
                </Typography>
              </Box>
            )}

            {selectionProgress && (
              <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 1 }}>
                Selecting… {selectionProgress.done}/{selectionProgress.total}
              </Typography>
            )}

            {selectionDialog.open && selectionDialog.kind === "range" && (
              <Box sx={{ display: "flex", gap: 1.5 }}>
                <TextField
                  label="Start (row #)"
                  size="small"
                  value={selectionDialog.startValue}
                  onChange={(e) =>
                    setSelectionDialog((prev) =>
                      prev.open && prev.kind === "range" ? { ...prev, startValue: e.target.value } : prev,
                    )
                  }
                  disabled={selectionBusy}
                  fullWidth
                />
                <TextField
                  label="End (row #)"
                  size="small"
                  value={selectionDialog.endValue}
                  onChange={(e) =>
                    setSelectionDialog((prev) =>
                      prev.open && prev.kind === "range" ? { ...prev, endValue: e.target.value } : prev,
                    )
                  }
                  disabled={selectionBusy}
                  fullWidth
                />
              </Box>
            )}

            {selectionDialog.open && selectionDialog.kind === "indexCompare" && (
              <TextField
                label="Row #"
                size="small"
                value={selectionDialog.value}
                onChange={(e) =>
                  setSelectionDialog((prev) =>
                    prev.open && prev.kind === "indexCompare" ? { ...prev, value: e.target.value } : prev,
                  )
                }
                disabled={selectionBusy}
                fullWidth
              />
            )}

            {selectionDialog.open && selectionDialog.kind === "criteria" && (
              <Box sx={{ display: "flex", flexDirection: "column", gap: 1.5 }}>
                <Paper
                  variant="outlined"
                  sx={{
                    p: 1.5,
                    borderRadius: 2.5,
                    borderColor: "rgba(15,23,42,0.08)",
                    background: "rgba(255,255,255,0.86)",
                    boxShadow: "0 1px 2px rgba(15,23,42,0.04)",
                  }}
                >
                  <Typography
                    variant="caption"
                    sx={{
                      color: "text.secondary",
                      fontWeight: 700,
                      textTransform: "uppercase",
                      letterSpacing: 0.4,
                      display: "block",
                      mb: 0.75,
                    }}
                  >
                    Target column
                  </Typography>

                  <Box sx={{ display: "flex", alignItems: "center", gap: 1, flexWrap: "wrap" }}>
                    <Box
                      sx={{
                        px: 1.25,
                        py: 0.65,
                        borderRadius: 999,
                        bgcolor: "rgba(14,165,233,0.10)",
                        color: "#075985",
                        border: "1px solid rgba(14,165,233,0.20)",
                        fontSize: "0.8rem",
                        fontWeight: 800,
                        maxWidth: "100%",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                      }}
                    >
                      {selectionDialogColumnLabel ?? selectionDialog.columnName}
                    </Box>

                    <Typography variant="caption" color="text.secondary">
                      Criteria will be evaluated against this metadata column.
                    </Typography>
                  </Box>
                </Paper>

                <Paper
                  variant="outlined"
                  sx={{
                    p: 1.5,
                    borderRadius: 2.5,
                    borderColor: "rgba(15,23,42,0.08)",
                    background: "rgba(255,255,255,0.92)",
                    boxShadow: "0 1px 2px rgba(15,23,42,0.04)",
                  }}
                >
                  <Typography
                    variant="caption"
                    sx={{
                      color: "text.secondary",
                      fontWeight: 700,
                      textTransform: "uppercase",
                      letterSpacing: 0.4,
                      display: "block",
                      mb: 1.25,
                    }}
                  >
                    Criteria
                  </Typography>

                  <Box sx={{ display: "flex", gap: 1.5, flexWrap: "wrap" }}>
                    <FormControl size="small" sx={{ minWidth: 240, flex: 1 }}>
                      <InputLabel id="criteria-operator-label">Operator</InputLabel>
                      <Select
                        labelId="criteria-operator-label"
                        label="Operator"
                        value={selectionDialog.operator}
                        onChange={(e) => {
                          const nextOp = e.target.value as CriteriaOperator;
                          setSelectionDialog((prev) =>
                            prev.open && prev.kind === "criteria"
                              ? {
                                ...prev,
                                operator: nextOp,
                                treatAsNumber: isNumericOperator(nextOp) ? true : prev.treatAsNumber,
                              }
                              : prev,
                          );
                        }}
                        disabled={selectionBusy}
                      >
                        <MenuItem value="equals">Equals</MenuItem>
                        <MenuItem value="notEquals">Not equals</MenuItem>
                        <Divider />
                        <MenuItem value="contains">Contains</MenuItem>
                        <MenuItem value="startsWith">Starts with</MenuItem>
                        <MenuItem value="endsWith">Ends with</MenuItem>
                        <MenuItem value="regex">Regex</MenuItem>
                        <Divider />
                        <MenuItem value="isEmpty">Is empty</MenuItem>
                        <MenuItem value="isNotEmpty">Is not empty</MenuItem>
                        <MenuItem value="isImage">Is image</MenuItem>
                        <MenuItem value="isNotImage">Is not image</MenuItem>
                        <Divider />
                        <MenuItem value="gt">Greater than</MenuItem>
                        <MenuItem value="gte">Greater or equal</MenuItem>
                        <MenuItem value="lt">Less than</MenuItem>
                        <MenuItem value="lte">Less or equal</MenuItem>
                        <MenuItem value="between">Between</MenuItem>
                      </Select>
                    </FormControl>

                    <FormControl size="small" sx={{ minWidth: 220, flex: 1 }}>
                      <InputLabel id="criteria-type-label">Compare as</InputLabel>
                      <Select
                        labelId="criteria-type-label"
                        label="Compare as"
                        value={selectionDialog.treatAsNumber ? "number" : "text"}
                        onChange={(e) =>
                          setSelectionDialog((prev) =>
                            prev.open && prev.kind === "criteria"
                              ? { ...prev, treatAsNumber: e.target.value === "number" }
                              : prev,
                          )
                        }
                        disabled={selectionBusy}
                      >
                        <MenuItem value="text">Text</MenuItem>
                        <MenuItem value="number">Number</MenuItem>
                      </Select>
                    </FormControl>
                  </Box>

                  <Box sx={{ display: "flex", gap: 1.5, flexWrap: "wrap", mt: 1.5 }}>
                    <TextField
                      label="Value"
                      size="small"
                      value={selectionDialog.value1}
                      onChange={(e) =>
                        setSelectionDialog((prev) =>
                          prev.open && prev.kind === "criteria" ? { ...prev, value1: e.target.value } : prev,
                        )
                      }
                      disabled={
                        selectionBusy ||
                        ["isEmpty", "isNotEmpty", "isImage", "isNotImage"].includes(selectionDialog.operator)
                      }
                      sx={{ flex: 1, minWidth: 240 }}
                    />

                    <TextField
                      label="Value 2"
                      size="small"
                      value={selectionDialog.value2}
                      onChange={(e) =>
                        setSelectionDialog((prev) =>
                          prev.open && prev.kind === "criteria" ? { ...prev, value2: e.target.value } : prev,
                        )
                      }
                      disabled={selectionBusy || selectionDialog.operator !== "between"}
                      sx={{ flex: 1, minWidth: 240 }}
                    />
                  </Box>
                </Paper>

                <Paper
                  variant="outlined"
                  sx={{
                    p: 1.5,
                    borderRadius: 2.5,
                    borderColor: "rgba(15,23,42,0.08)",
                    background: "rgba(255,255,255,0.92)",
                    boxShadow: "0 1px 2px rgba(15,23,42,0.04)",
                  }}
                >
                  <Typography
                    variant="caption"
                    sx={{
                      color: "text.secondary",
                      fontWeight: 700,
                      textTransform: "uppercase",
                      letterSpacing: 0.4,
                      display: "block",
                      mb: 1.25,
                    }}
                  >
                    Selection behavior
                  </Typography>

                  <Box sx={{ display: "flex", gap: 1.5, flexWrap: "wrap" }}>
                    <FormControl size="small" sx={{ minWidth: 220, flex: 1 }}>
                      <InputLabel id="criteria-setop-label">Apply as</InputLabel>
                      <Select
                        labelId="criteria-setop-label"
                        label="Apply as"
                        value={selectionDialog.setOp}
                        onChange={(e) =>
                          setSelectionDialog((prev) =>
                            prev.open && prev.kind === "criteria"
                              ? { ...prev, setOp: e.target.value as SelectionSetOp }
                              : prev,
                          )
                        }
                        disabled={selectionBusy}
                      >
                        <MenuItem value="replace">{getSetOpLabel("replace")}</MenuItem>
                        <MenuItem value="add">{getSetOpLabel("add")}</MenuItem>
                        <MenuItem value="remove">{getSetOpLabel("remove")}</MenuItem>
                        <MenuItem value="intersect">{getSetOpLabel("intersect")}</MenuItem>
                      </Select>
                    </FormControl>

                    <FormControl size="small" sx={{ minWidth: 220, flex: 1 }}>
                      <InputLabel id="criteria-scope-label">Scope</InputLabel>
                      <Select
                        labelId="criteria-scope-label"
                        label="Scope"
                        value={selectionDialog.scope}
                        onChange={(e) =>
                          setSelectionDialog((prev) =>
                            prev.open && prev.kind === "criteria"
                              ? { ...prev, scope: e.target.value as SelectionScope }
                              : prev,
                          )
                        }
                        disabled={selectionBusy}
                      >
                        <MenuItem value="allRows">{getScopeLabel("allRows")}</MenuItem>
                        <MenuItem value="currentSelection">{getScopeLabel("currentSelection")}</MenuItem>
                      </Select>
                    </FormControl>

                    <FormControl size="small" sx={{ minWidth: 220, flex: 1 }}>
                      <InputLabel id="criteria-case-label">Case</InputLabel>
                      <Select
                        labelId="criteria-case-label"
                        label="Case"
                        value={selectionDialog.caseSensitive ? "sensitive" : "insensitive"}
                        onChange={(e) =>
                          setSelectionDialog((prev) =>
                            prev.open && prev.kind === "criteria"
                              ? { ...prev, caseSensitive: e.target.value === "sensitive" }
                              : prev,
                          )
                        }
                        disabled={selectionBusy}
                      >
                        <MenuItem value="insensitive">Case-insensitive</MenuItem>
                        <MenuItem value="sensitive">Case-sensitive</MenuItem>
                      </Select>
                    </FormControl>
                  </Box>

                  <Box sx={{ display: "flex", alignItems: "center", mt: 1.25 }}>
                    <FormControlLabel
                      control={
                        <Checkbox
                          size="small"
                          checked={selectionDialog.negate}
                          onChange={(e) =>
                            setSelectionDialog((prev) =>
                              prev.open && prev.kind === "criteria"
                                ? { ...prev, negate: e.target.checked }
                                : prev,
                            )
                          }
                          disabled={selectionBusy}
                        />
                      }
                      label={
                        <Typography variant="caption" sx={{ fontWeight: 700 }}>
                          Negate criteria
                        </Typography>
                      }
                    />
                  </Box>
                </Paper>

                <Box
                  sx={{
                    borderRadius: 2.5,
                    px: 1.5,
                    py: 1.15,
                    border: "1px solid rgba(14,165,233,0.18)",
                    background: "linear-gradient(135deg, rgba(14,165,233,0.08), rgba(59,130,246,0.06))",
                  }}
                >
                  <Typography variant="caption" color="text.secondary">
                    Result will use <strong>row ids</strong> for stable selection across sorting.
                  </Typography>

                  <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 0.25 }}>
                    Operator: <strong>{getOperatorLabel(selectionDialog.operator)}</strong>, Apply as:{" "}
                    <strong>{getSetOpLabel(selectionDialog.setOp)}</strong>, Scope:{" "}
                    <strong>{getScopeLabel(selectionDialog.scope)}</strong>
                  </Typography>
                </Box>
              </Box>
            )}
          </Box>
        </DialogContent>

        <DialogActions
          sx={{
            px: 2.25,
            py: 1.5,
            gap: 1,
            background: "#f8fafc",
            borderTop: "1px solid rgba(15,23,42,0.08)",
          }}
        >
          <Button
            variant="outlined"
            onClick={closeSelectionDialog}
            disabled={selectionBusy}
            sx={{
              textTransform: "none",
              fontWeight: 700,
              borderRadius: 2,
            }}
          >
            Cancel
          </Button>

          <Button
            variant="contained"
            onClick={async () => {
              setSelectionDialogError(null);
              if (selectionBusyRef.current) return;
              if (!selectionDialog.open) return;

              if (selectionDialog.kind === "range") {
                const start = parsePositiveInt(selectionDialog.startValue);
                const end = parsePositiveInt(selectionDialog.endValue);
                if (start == null || end == null) {
                  setSelectionDialogError("Start/end must be positive integers");
                  return;
                }

                setSelectionMode("index");
                clearIdSelection();
                selectRange(start - 1, end - 1);
                focusRowAfterSelection(start - 1);
                closeSelectionDialog();
                closeContextMenu();
                return;
              }

              await runColumnCriteriaSelection();
            }}
            disabled={selectionBusy}
            sx={{
              textTransform: "none",
              fontWeight: 800,
              px: 2.25,
              borderRadius: 2,
              boxShadow: "0 8px 18px rgba(37,99,235,0.22)",
            }}
          >
            {selectionBusy ? "Applying…" : "Apply"}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Action dialog */}
      <Dialog
        open={actionDialogState.open}
        onClose={(_event, reason) => {
          if (actionSubmitting) return;
          if (reason === "backdropClick") return;
          closeActionDialog();
        }}
        maxWidth="sm"
        fullWidth
        PaperProps={{
          sx: {
            borderRadius: 3,
            overflow: "hidden",
            border: "1px solid rgba(15,23,42,0.08)",
            boxShadow: "0 20px 40px rgba(15,23,42,0.18), 0 8px 16px rgba(15,23,42,0.10)",
          },
        }}
      >
        <DialogTitle
          sx={{
            px: 2,
            py: 1.4,
            display: "flex",
            alignItems: "center",
            gap: 1.25,
            background: "linear-gradient(135deg, #0f172a 0%, #1e293b 55%, #334155 100%)",
            color: "#e2e8f0",
            borderBottom: "1px solid rgba(255,255,255,0.08)",
          }}
        >
          <Box sx={{ minWidth: 0, flex: 1 }}>
            <Typography
              variant="subtitle1"
              sx={{
                fontWeight: 700,
                lineHeight: 1.15,
                color: "#f8fafc",
              }}
            >
              {actionDialogState.actionLabel || "Action"}
            </Typography>
            <Typography
              variant="caption"
              sx={{
                color: "rgba(226,232,240,0.82)",
                display: "block",
                mt: 0.25,
              }}
            >
              Create subset from selected rows
            </Typography>
          </Box>

          <IconButton
            size="small"
            onClick={closeActionDialog}
            disabled={actionSubmitting}
            aria-label="Close action dialog"
            sx={{
              color: "#e2e8f0",
              border: "1px solid rgba(255,255,255,0.18)",
              background: "rgba(255,255,255,0.06)",
              "&:hover": {
                background: "rgba(255,255,255,0.12)",
                borderColor: "rgba(255,255,255,0.28)",
              },
              "&.Mui-disabled": {
                color: "rgba(226,232,240,0.4)",
                borderColor: "rgba(255,255,255,0.08)",
              },
            }}
          >
            <CloseIcon fontSize="small" />
          </IconButton>
        </DialogTitle>

        <DialogContent
          dividers
          sx={{
            px: 2,
            py: 2,
            background:
              "linear-gradient(180deg, rgba(248,250,252,0.96) 0%, rgba(241,245,249,0.96) 100%)",
          }}
        >
          <Box sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
            <TextField
              autoFocus
              label="Subset name"
              value={subsetName}
              onChange={(event) => setSubsetName(event.target.value)}
              fullWidth
              size="small"
              disabled={actionSubmitting}
              placeholder={DEFAULT_SUBSET_NAME}
              helperText="Name used to create the subset in the backend."
              onKeyDown={(event) => {
                if (event.key === "Enter" && !actionSubmitting && effectiveSelectedCount > 0) {
                  event.preventDefault();
                  handleAcceptAction();
                }
              }}
              sx={{
                "& .MuiOutlinedInput-root": {
                  borderRadius: 2,
                  backgroundColor: "#fff",
                },
              }}
            />

            {actionDialogError && (
              <Box
                sx={{
                  borderRadius: 2,
                  px: 1.25,
                  py: 1,
                  border: "1px solid rgba(239,68,68,0.25)",
                  backgroundColor: "rgba(254,242,242,0.9)",
                }}
              >
                <Typography variant="body2" color="error" sx={{ fontWeight: 500 }}>
                  {actionDialogError}
                </Typography>
              </Box>
            )}
          </Box>
        </DialogContent>

        <DialogActions
          sx={{
            px: 2,
            py: 1.25,
            justifyContent: "space-between",
            gap: 1,
            backgroundColor: "rgba(248,250,252,0.72)",
            borderTop: "1px solid rgba(148,163,184,0.18)",
          }}
        >
          <Typography variant="caption" color="text.secondary">
            {effectiveSelectedCount > 0
              ? `${effectiveSelectedCount} row${effectiveSelectedCount === 1 ? "" : "s"} selected`
              : "No rows selected"}
          </Typography>

          <Box sx={{ display: "flex", gap: 1 }}>
            <Button
              variant="outlined"
              startIcon={<CloseIcon />}
              onClick={closeActionDialog}
              disabled={actionSubmitting}
              sx={{
                textTransform: "none",
                borderRadius: 2,
                fontWeight: 600,
                borderColor: "rgba(148,163,184,0.35)",
                color: "#334155",
                "&:hover": {
                  borderColor: "rgba(100,116,139,0.55)",
                  backgroundColor: "rgba(148,163,184,0.06)",
                },
              }}
            >
              Cancel
            </Button>

            <Button
              variant="contained"
              startIcon={
                actionSubmitting ? <CircularProgress size={14} color="inherit" /> : <Check size={16} />
              }
              onClick={handleAcceptAction}
              disabled={actionSubmitting || effectiveSelectedCount <= 0}
              sx={{
                textTransform: "none",
                borderRadius: 2,
                fontWeight: 700,
                minWidth: 118,
                color: "#e2e8f0",
                border: "1px solid rgba(255,255,255,0.06)",
                background: "linear-gradient(180deg, #2563eb 0%, #1d4ed8 55%, #1e40af 100%)",
                boxShadow: "0 8px 18px rgba(37,99,235,0.22), inset 0 1px 0 rgba(255,255,255,0.12)",
                "&:hover": {
                  background: "linear-gradient(180deg, #3b82f6 0%, #2563eb 55%, #1d4ed8 100%)",
                  boxShadow: "0 10px 20px rgba(37,99,235,0.28), inset 0 1px 0 rgba(255,255,255,0.14)",
                },
                "&.Mui-disabled": {
                  color: "rgba(226,232,240,0.55)",
                  background: "rgba(30,64,175,0.35)",
                  borderColor: "rgba(148,163,184,0.18)",
                },
              }}
            >
              {actionSubmitting ? "Creating..." : "Accept"}
            </Button>
          </Box>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
