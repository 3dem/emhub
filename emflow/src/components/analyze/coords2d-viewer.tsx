import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type WheelEvent as ReactWheelEvent,
} from "react";

import {
  Alert,
  Box,
  Button,
  ButtonGroup,
  Checkbox,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  Divider,
  IconButton,
  ListItemIcon,
  Menu,
  MenuItem,
  Paper,
  Slider,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Tooltip,
  Typography,
} from "@mui/material";
import {
  AlertTriangle,
  BarChart3,
  Circle,
  Contrast,
  Eraser,
  FileText,
  Grid3X3,
  Hand,
  ImageMinus,
  LocateFixed,
  Plus,
  RotateCcw,
  Save,
  SlidersHorizontal,
  Sparkles,
  Square,
  Table2,
  Trash2,
  Waves,
  Wrench,
  X,
} from "lucide-react";
import { useProjectService } from "@/ProjectServiceContext";
import type {
  Coords2dMicrograph,
  Coords2dPoint,
  Id,
  ObjectUrlResult,
} from "@/services/ProjectService";

type Coords2dViewerProps = {
  projectId: number;
  protocolId: number;
  protocolLabel: string;
  outputName: string;
  onClose?: () => void;
};

type ViewerPoint = Coords2dPoint & {
  id: Id;
  micId: Id;
  x: number;
  y: number;
  isNew?: boolean;
};

type ViewTransform = {
  scale: number;
  offsetX: number;
  offsetY: number;
};

type Bounds2d = {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
};

type ToolMode = "pan" | "pick" | "erase";
type ShapeMode = "circle" | "square";
type ConfirmationAction = "close" | "create-output" | null;

type ImageFilters = {
  enhanceContrast: boolean;
  gaussianBlur: boolean;
  invertContrast: boolean;
};

type ParticleCrop = {
  pointId: string;
  rowIndex: number;
  url: string;
  x: number;
  y: number;
};

type DragState = {
  type: "none" | "pan" | "point" | "erase";
  active: boolean;
  moved: boolean;
  x: number;
  y: number;
  offsetX: number;
  offsetY: number;
  pointId: string | null;
  micKey: string;
  startWorldX: number;
  startWorldY: number;
  initialPointX: number;
  initialPointY: number;
  initialPoint: ViewerPoint | null;
};

type ParticleCropCacheEntry = {
  signature: string;
  url: string;
};

type MicrographImageCacheEntry = ObjectUrlResult & {
  image: HTMLImageElement;
  usedAt: number;
};

type PendingPointMove = {
  micKey: string;
  pointId: string;
  point: ViewerPoint;
};

type HistogramImageData = {
  imageData: ImageData;
  width: number;
  height: number;
};

const DEFAULT_BOX_SIZE = 50;
const MIN_BOX_SIZE = 10;
const MAX_BOX_SIZE = 240;
const PARTICLE_GALLERY_SIZE = 74;

const PANEL_BORDER = "1px solid rgba(148,163,184,0.4)";
const VIEWER_BG = "#f8fafc";
const HEADER_BG = "#f3f4f6";
const TOOLBAR_BG = "rgba(248,250,252,0.95)";
const CANVAS_OUTER_BG = "#e5e7eb";
const CANVAS_BG = "#d1d5db";
const ROW_SELECTED = "rgba(219,234,254,0.95)";
const ROW_SELECTED_HOVER = "rgba(191,219,254,0.95)";
const ROW_SELECTED_TEXT = "#0f172a";
const DEFAULT_PICK_COLOR = "#06b6d4";

const VIEWER_TEXT_SX = {
  "& .MuiButton-root": {
    textTransform: "none",
  },
  "& .MuiChip-label": {
    textTransform: "none",
  },
  "& .MuiTableCell-root": {
    textTransform: "none",
  },
};

const THUMBNAIL_SIZE = 72;
const THUMBNAIL_CONCURRENCY = 6;
const THUMBNAIL_FLUSH_SIZE = 12;
const PARTICLE_CROP_BATCH_SIZE = 40;

const MICROGRAPH_IMAGE_SIZE = 2200;
const MICROGRAPH_IMAGE_CACHE_LIMIT = 4;


function createDragState(): DragState {
  return {
    type: "none",
    active: false,
    moved: false,
    x: 0,
    y: 0,
    offsetX: 0,
    offsetY: 0,
    pointId: null,
    micKey: "",
    startWorldX: 0,
    startWorldY: 0,
    initialPointX: 0,
    initialPointY: 0,
    initialPoint: null,
  };
}

function toStringId(value: Id): string {
  return String(value ?? "");
}

function formatNumber(value: number | null | undefined, digits = 1): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "-";
  return value.toFixed(digits).replace(/\.?0+$/, "");
}

function basename(value: string): string {
  const clean = value.trim();
  if (!clean) return "Untitled";
  return clean.split(/[\\/]/).filter(Boolean).pop() ?? clean;
}

function normalizeObjectUrl(raw: ObjectUrlResult | string | null | undefined): ObjectUrlResult | null {
  if (!raw) return null;

  if (typeof raw === "string") {
    return {
      url: raw,
      revoke: () => URL.revokeObjectURL(raw),
    };
  }

  return raw;
}

function getMicrographLabel(micrograph: Coords2dMicrograph): string {
  const label = String(micrograph.label ?? "").trim();
  if (label) return basename(label);

  const fileName = String(micrograph.fileName ?? "").trim();
  if (fileName) return basename(fileName);

  return `Micrograph ${String(micrograph.id)}`;
}

function getPointId(point: Coords2dPoint, fallbackIndex: number): string {
  return String(point.id ?? `${point.micId}:${fallbackIndex}`);
}

function buildCanvasFilter(filters: ImageFilters): string {
  const items: string[] = [];

  if (filters.enhanceContrast) {
    items.push("contrast(220%)");
  }

  if (filters.gaussianBlur) {
    items.push("blur(0.5px)");
  }

  if (filters.invertContrast) {
    items.push("invert(1)");
  }

  return items.length ? items.join(" ") : "none";
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function makeParticleCropSignature(
  point: ViewerPoint,
  imageUrl: string | null,
  imageWorldSize: { width: number; height: number },
  boxSize: number,
  filters: ImageFilters,
): string {
  return [
    imageUrl ?? "",
    point.id,
    point.x.toFixed(2),
    point.y.toFixed(2),
    imageWorldSize.width,
    imageWorldSize.height,
    boxSize,
    filters.enhanceContrast ? "c1" : "c0",
    filters.gaussianBlur ? "b1" : "b0",
    filters.invertContrast ? "i1" : "i0",
  ].join(":");
}

function makeParticleCropUrl(
  image: HTMLImageElement,
  point: ViewerPoint,
  imageWorldSize: { width: number; height: number },
  boxSize: number,
  filters: ImageFilters,
  outputSize = PARTICLE_GALLERY_SIZE,
): string {
  const sourceScaleX = image.naturalWidth / imageWorldSize.width;
  const sourceScaleY = image.naturalHeight / imageWorldSize.height;

  const sourceSizeX = Math.max(1, boxSize * sourceScaleX);
  const sourceSizeY = Math.max(1, boxSize * sourceScaleY);

  const rawSourceX = (point.x - boxSize / 2) * sourceScaleX;
  const rawSourceY = (point.y - boxSize / 2) * sourceScaleY;

  const sourceX = clamp(rawSourceX, 0, Math.max(0, image.naturalWidth - 1));
  const sourceY = clamp(rawSourceY, 0, Math.max(0, image.naturalHeight - 1));

  const safeSourceWidth = Math.min(sourceSizeX, image.naturalWidth - sourceX);
  const safeSourceHeight = Math.min(sourceSizeY, image.naturalHeight - sourceY);

  const canvas = document.createElement("canvas");
  canvas.width = outputSize;
  canvas.height = outputSize;

  const ctx = canvas.getContext("2d");
  if (!ctx || safeSourceWidth <= 0 || safeSourceHeight <= 0) {
    return "";
  }

  ctx.fillStyle = "#111827";
  ctx.fillRect(0, 0, outputSize, outputSize);
  ctx.filter = buildCanvasFilter(filters);
  ctx.imageSmoothingEnabled = true;

  ctx.drawImage(
    image,
    sourceX,
    sourceY,
    safeSourceWidth,
    safeSourceHeight,
    0,
    0,
    outputSize,
    outputSize,
  );

  return canvas.toDataURL("image/png");
}

function getBounds(
  points: ViewerPoint[],
  imageWorldSize: { width: number; height: number } | null,
  boxSize: number,
): Bounds2d {
  const maxPointX = Math.max(1, ...points.map((point) => point.x + boxSize));
  const maxPointY = Math.max(1, ...points.map((point) => point.y + boxSize));

  if (imageWorldSize) {
    return {
      minX: 0,
      minY: 0,
      maxX: Math.max(imageWorldSize.width, maxPointX),
      maxY: Math.max(imageWorldSize.height, maxPointY),
    };
  }

  if (!points.length) {
    return {
      minX: 0,
      minY: 0,
      maxX: 1,
      maxY: 1,
    };
  }

  const minX = Math.min(...points.map((point) => point.x));
  const minY = Math.min(...points.map((point) => point.y));
  const maxX = Math.max(...points.map((point) => point.x));
  const maxY = Math.max(...points.map((point) => point.y));
  const padX = Math.max(boxSize, (maxX - minX) * 0.05);
  const padY = Math.max(boxSize, (maxY - minY) * 0.05);

  return {
    minX: minX - padX,
    minY: minY - padY,
    maxX: maxX + padX,
    maxY: maxY + padY,
  };
}

function computeFitTransform(bounds: Bounds2d, size: { width: number; height: number }): ViewTransform {
  const worldWidth = Math.max(1, bounds.maxX - bounds.minX);
  const worldHeight = Math.max(1, bounds.maxY - bounds.minY);
  const scale = Math.max(
    0.0001,
    Math.min((size.width - 32) / worldWidth, (size.height - 32) / worldHeight),
  );

  return {
    scale,
    offsetX: (size.width - worldWidth * scale) / 2,
    offsetY: (size.height - worldHeight * scale) / 2,
  };
}

function buildFilteredImageData(image: HTMLImageElement, filters: ImageFilters): HistogramImageData | null {
  const canvas = document.createElement("canvas");
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;

  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;

  ctx.filter = buildCanvasFilter(filters);
  ctx.drawImage(image, 0, 0);

  try {
    return {
      imageData: ctx.getImageData(0, 0, canvas.width, canvas.height),
      width: canvas.width,
      height: canvas.height,
    };
  } catch {
    return null;
  }
}

function buildHistogramFromImageData(bundle: HistogramImageData): number[] {
  const histogram = new Array(256).fill(0);
  const { imageData, width, height } = bundle;
  const data = imageData.data;
  const targetSamples = 500000;
  const step = Math.max(1, Math.ceil(Math.sqrt((width * height) / targetSamples)));

  for (let y = 0; y < height; y += step) {
    for (let x = 0; x < width; x += step) {
      const idx = (y * width + x) * 4;
      const value = Math.round((data[idx] + data[idx + 1] + data[idx + 2]) / 3);
      histogram[clamp(value, 0, 255)] += 1;
    }
  }

  return histogram;
}

function calculateAverageIntensity(
  bundle: HistogramImageData,
  point: ViewerPoint,
  imageWorldSize: { width: number; height: number },
  boxSize: number,
): number {
  const { imageData, width, height } = bundle;
  const data = imageData.data;

  const scaleX = width / imageWorldSize.width;
  const scaleY = height / imageWorldSize.height;

  const left = clamp(Math.floor((point.x - boxSize / 2) * scaleX), 0, width - 1);
  const right = clamp(Math.ceil((point.x + boxSize / 2) * scaleX), 0, width);
  const top = clamp(Math.floor((point.y - boxSize / 2) * scaleY), 0, height - 1);
  const bottom = clamp(Math.ceil((point.y + boxSize / 2) * scaleY), 0, height);

  let sum = 0;
  let count = 0;

  for (let y = top; y < bottom; y += 1) {
    for (let x = left; x < right; x += 1) {
      const idx = (y * width + x) * 4;
      sum += (data[idx] + data[idx + 1] + data[idx + 2]) / 3;
      count += 1;
    }
  }

  return count > 0 ? sum / count : 0;
}

function HistogramChart({
  histogram,
  range,
}: {
  histogram: number[];
  range: [number, number];
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");

    if (!canvas || !ctx) return;

    const width = 560;
    const height = 310;
    const ratio = window.devicePixelRatio || 1;

    canvas.width = width * ratio;
    canvas.height = height * ratio;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;

    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.clearRect(0, 0, width, height);

    const margin = {
      left: 54,
      right: 18,
      top: 18,
      bottom: 42,
    };

    const plotWidth = width - margin.left - margin.right;
    const plotHeight = height - margin.top - margin.bottom;

    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, width, height);

    ctx.strokeStyle = "#475569";
    ctx.lineWidth = 1;
    ctx.strokeRect(margin.left, margin.top, plotWidth, plotHeight);

    const maxValue = Math.max(1, ...histogram);
    const xScale = plotWidth / 255;
    const yScale = plotHeight / maxValue;

    ctx.beginPath();
    histogram.forEach((value, index) => {
      const x = margin.left + index * xScale;
      const y = margin.top + plotHeight - value * yScale;

      if (index === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.strokeStyle = "#1976d2";
    ctx.lineWidth = 2;
    ctx.stroke();

    const drawRangeLine = (value: number) => {
      const x = margin.left + clamp(value, 0, 255) * xScale;

      ctx.save();
      ctx.beginPath();
      ctx.setLineDash([5, 4]);
      ctx.moveTo(x, margin.top);
      ctx.lineTo(x, margin.top + plotHeight);
      ctx.strokeStyle = "#ef4444";
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.restore();
    };

    drawRangeLine(range[0]);
    drawRangeLine(range[1]);

    ctx.fillStyle = "#111827";
    ctx.font = "13px sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("Pixel Value", margin.left + plotWidth / 2, height - 10);

    ctx.save();
    ctx.translate(14, margin.top + plotHeight / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.textAlign = "center";
    ctx.fillText("Frequency", 0, 0);
    ctx.restore();

    ctx.fillStyle = "#334155";
    ctx.font = "12px sans-serif";
    ctx.textAlign = "center";
    [0, 50, 100, 150, 200, 250].forEach((tick) => {
      const x = margin.left + tick * xScale;
      ctx.fillText(String(tick), x, margin.top + plotHeight + 18);
    });

    ctx.textAlign = "right";
    [0, 0.25, 0.5, 0.75, 1].forEach((ratioValue) => {
      const value = Math.round(maxValue * ratioValue);
      const y = margin.top + plotHeight - value * yScale;
      ctx.fillText(String(value), margin.left - 8, y + 4);
    });
  }, [histogram, range]);

  return <canvas ref={canvasRef} />;
}

type MicrographTableRowProps = {
  micrograph: Coords2dMicrograph;
  index: number;
  selected: boolean;
  thumbnailUrl?: string;
  updated: boolean;
  onSelect: (micId: Id) => void;
};

const MicrographTableRow = memo(function MicrographTableRow({
  micrograph,
  index,
  selected,
  thumbnailUrl,
  updated,
  onSelect,
}: MicrographTableRowProps) {
  const micKey = toStringId(micrograph.id);
  const label = getMicrographLabel(micrograph);

  return (
    <TableRow
      hover
      selected={selected}
      onClick={() => onSelect(micrograph.id)}
      sx={{
        cursor: "pointer",
        "&.Mui-selected td": {
          bgcolor: ROW_SELECTED,
          color: ROW_SELECTED_TEXT,
        },
        "&.Mui-selected:hover td": {
          bgcolor: ROW_SELECTED_HOVER,
        },
      }}
    >
      <TableCell>{micrograph.index ?? index + 1}</TableCell>

      <TableCell>
        {thumbnailUrl ? (
          <Box
            component="img"
            src={thumbnailUrl}
            alt={label}
            sx={{
              width: 46,
              height: 34,
              objectFit: "cover",
              display: "block",
              border: "1px solid rgba(15,23,42,0.25)",
              bgcolor: "#111827",
            }}
          />
        ) : (
          <Box
            sx={{
              width: 46,
              height: 34,
              bgcolor: "rgba(15,23,42,0.18)",
              border: "1px solid rgba(15,23,42,0.25)",
            }}
          />
        )}
      </TableCell>

      <TableCell>{label}</TableCell>

      <TableCell align="center">{micrograph.particles ?? 0}</TableCell>

      <TableCell align="center">{updated ? "Yes" : "No"}</TableCell>
    </TableRow>
  );
});

function Coords2dViewer({
  projectId,
  protocolId,
  protocolLabel,
  outputName,
  onClose,
}: Coords2dViewerProps) {
  const service = useProjectService();

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const canvasWrapRef = useRef<HTMLDivElement | null>(null);
  const nextPointIdRef = useRef(1);
  const dragRef = useRef<DragState>(createDragState());
  const particleRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const visiblePointsRef = useRef<ViewerPoint[]>([]);
  const baseVisiblePointsRef = useRef<ViewerPoint[]>([]);
  const deletedPointIdsRef = useRef<Set<string>>(new Set());
  const previewHiddenPointIdsRef = useRef<Set<string>>(new Set());
  const erasedDuringDragRef = useRef<Set<string>>(new Set());
  const particleCropCacheRef = useRef<Record<string, ParticleCropCacheEntry>>({});
  const cropUpdateFrameRef = useRef<number | null>(null);
  const pointMoveFrameRef = useRef<number | null>(null);
  const pendingPointMoveRef = useRef<PendingPointMove | null>(null);
  const histogramImageDataRef = useRef<HistogramImageData | null>(null);

  const transformFrameRef = useRef<number | null>(null);
  const pendingTransformRef = useRef<ViewTransform | null>(null);

  const micrographsLoadKeyRef = useRef("");
  const thumbnailSourceKeyRef = useRef("");
  const thumbnailLoadKeyRef = useRef("");
  const thumbnailUrlsRef = useRef<Record<string, string>>({});
  const thumbnailObjectUrlsRef = useRef<Record<string, ObjectUrlResult>>({});

  const imageCacheSourceKeyRef = useRef("");
  const imageObjectUrlCacheRef = useRef<Record<string, MicrographImageCacheEntry>>({});

  const [micrographs, setMicrographs] = useState<Coords2dMicrograph[]>([]);
  const [selectedMicId, setSelectedMicId] = useState<Id | null>(null);
  const [pointsByMicId, setPointsByMicId] = useState<Record<string, ViewerPoint[]>>({});
  const [originalPointsByMicId, setOriginalPointsByMicId] = useState<Record<string, ViewerPoint[]>>({});
  const [thumbnailUrls, setThumbnailUrls] = useState<Record<string, string>>({});

  const [boxSize, setBoxSize] = useState(DEFAULT_BOX_SIZE);
  const [totalPicks, setTotalPicks] = useState(0);
  const [loadingMicrographs, setLoadingMicrographs] = useState(true);
  const [loadingCoordinates, setLoadingCoordinates] = useState(false);
  const [loadingImage, setLoadingImage] = useState(false);
  const [imageLoadAttempted, setImageLoadAttempted] = useState(false);
  const [creatingOutput, setCreatingOutput] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const [selectedPointId, setSelectedPointId] = useState<string | null>(null);
  const [shapeMode, setShapeMode] = useState<ShapeMode>("circle");
  const [toolMode, setToolMode] = useState<ToolMode>("pan");
  const [pickColor, setPickColor] = useState(DEFAULT_PICK_COLOR);
  const [deletedPointIds, setDeletedPointIds] = useState<Set<string>>(() => new Set());
  const [previewHiddenPointIds, setPreviewHiddenPointIds] = useState<Set<string>>(() => new Set());
  const [updatedMicIds, setUpdatedMicIds] = useState<Set<string>>(() => new Set());

  const [filtersAnchorEl, setFiltersAnchorEl] = useState<HTMLElement | null>(null);
  const [toolsAnchorEl, setToolsAnchorEl] = useState<HTMLElement | null>(null);
  const [windowsAnchorEl, setWindowsAnchorEl] = useState<HTMLElement | null>(null);

  const [filters, setFilters] = useState<ImageFilters>({
    enhanceContrast: false,
    gaussianBlur: false,
    invertContrast: false,
  });

  const [particlesOpen, setParticlesOpen] = useState(false);
  const [particleCropVersion, setParticleCropVersion] = useState(0);

  const [histogramOpen, setHistogramOpen] = useState(false);
  const [histogramComputing, setHistogramComputing] = useState(false);
  const [histogramData, setHistogramData] = useState<number[]>(() => new Array(256).fill(0));
  const [histogramRange, setHistogramRange] = useState<[number, number]>([0, 255]);

  const [confirmationAction, setConfirmationAction] = useState<ConfirmationAction>(null);

  const [size, setSize] = useState({ width: 800, height: 600 });
  const [transform, setTransform] = useState<ViewTransform>({
    scale: 1,
    offsetX: 0,
    offsetY: 0,
  });

  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [image, setImage] = useState<HTMLImageElement | null>(null);

  const selectedMicKey = useMemo(() => {
    return selectedMicId === null || selectedMicId === undefined ? "" : toStringId(selectedMicId);
  }, [selectedMicId]);

  const selectedMicrograph = useMemo(() => {
    if (!selectedMicKey) return null;
    return micrographs.find((micrograph) => toStringId(micrograph.id) === selectedMicKey) ?? null;
  }, [micrographs, selectedMicKey]);

  const currentPoints = useMemo(() => {
    if (!selectedMicKey) return [];
    return pointsByMicId[selectedMicKey] ?? [];
  }, [pointsByMicId, selectedMicKey]);

  const baseVisiblePoints = useMemo(() => {
    return currentPoints.filter((point, index) => {
      const pointId = getPointId(point, index);
      return !deletedPointIds.has(pointId);
    });
  }, [currentPoints, deletedPointIds]);

  const visiblePoints = useMemo(() => {
    return baseVisiblePoints.filter((point, index) => {
      const pointId = getPointId(point, index);
      return !previewHiddenPointIds.has(pointId);
    });
  }, [baseVisiblePoints, previewHiddenPointIds]);

  const selectedPoint = useMemo(() => {
    if (!selectedPointId) return null;
    return visiblePoints.find((point, index) => getPointId(point, index) === selectedPointId) ?? null;
  }, [selectedPointId, visiblePoints]);

  const hasUnsavedChanges = updatedMicIds.size > 0;

  useEffect(() => {
    visiblePointsRef.current = visiblePoints;
  }, [visiblePoints]);

  useEffect(() => {
    baseVisiblePointsRef.current = baseVisiblePoints;
  }, [baseVisiblePoints]);

  useEffect(() => {
    deletedPointIdsRef.current = deletedPointIds;
  }, [deletedPointIds]);

  useEffect(() => {
    previewHiddenPointIdsRef.current = previewHiddenPointIds;
  }, [previewHiddenPointIds]);

  useEffect(() => {
    thumbnailUrlsRef.current = thumbnailUrls;
  }, [thumbnailUrls]);

  useEffect(() => {
    return () => {
      if (cropUpdateFrameRef.current !== null) {
        cancelAnimationFrame(cropUpdateFrameRef.current);
      }

      if (pointMoveFrameRef.current !== null) {
        cancelAnimationFrame(pointMoveFrameRef.current);
      }

      if (transformFrameRef.current !== null) {
        cancelAnimationFrame(transformFrameRef.current);
      }

      Object.values(thumbnailObjectUrlsRef.current).forEach((item) => {
        item.revoke?.();
      });

      thumbnailObjectUrlsRef.current = {};

      Object.values(imageObjectUrlCacheRef.current).forEach((item) => {
        item.revoke?.();
      });

      imageObjectUrlCacheRef.current = {};
    };
  }, []);

  useEffect(() => {
    const loadKey = `${projectId}:${protocolId}:${outputName}`;
    if (micrographsLoadKeyRef.current === loadKey) return;

    micrographsLoadKeyRef.current = loadKey;

    let cancelled = false;

    async function loadMicrographs() {
      setLoadingMicrographs(true);
      setError(null);
      setSuccessMessage(null);

      try {
        const result = await service.listCoords2dMicrographs(projectId, protocolId, outputName);

        if (cancelled) return;

        const nextMicrographs = result.micrographs ?? [];
        setMicrographs(nextMicrographs);
        setTotalPicks(result.totalPicks ?? 0);

        if (result.boxSize && Number.isFinite(result.boxSize)) {
          setBoxSize(Math.max(MIN_BOX_SIZE, Math.min(MAX_BOX_SIZE, Number(result.boxSize))));
        }

        const firstMicId = nextMicrographs[0]?.id ?? null;
        setSelectedMicId(firstMicId);
      } catch (err) {
        micrographsLoadKeyRef.current = "";

        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load 2D coordinate micrographs");
        }
      } finally {
        if (!cancelled) setLoadingMicrographs(false);
      }
    }

    void loadMicrographs();

    return () => {
      cancelled = true;
    };
  }, [service, projectId, protocolId, outputName]);

  useEffect(() => {
    if (!micrographs.length) return;

    const sourceKey = `${projectId}:${protocolId}:${outputName}`;
    const idsKey = micrographs.map((micrograph) => toStringId(micrograph.id)).join("|");
    const loadKey = `${sourceKey}:${idsKey}`;

    if (thumbnailSourceKeyRef.current !== sourceKey) {
      Object.values(thumbnailObjectUrlsRef.current).forEach((item) => {
        item.revoke?.();
      });

      thumbnailObjectUrlsRef.current = {};
      thumbnailUrlsRef.current = {};
      thumbnailLoadKeyRef.current = "";
      thumbnailSourceKeyRef.current = sourceKey;
      setThumbnailUrls({});
    }

    if (thumbnailLoadKeyRef.current === loadKey) return;
    thumbnailLoadKeyRef.current = loadKey;

    let cancelled = false;

    async function loadThumbnails() {
      const directUrls: Record<string, string> = {};

      for (const micrograph of micrographs) {
        const micKey = toStringId(micrograph.id);
        if (!micKey) continue;

        if (micrograph.thumbnailUrl) {
          directUrls[micKey] = micrograph.thumbnailUrl;
        }
      }

      if (Object.keys(directUrls).length > 0) {
        setThumbnailUrls((current) => {
          const next = { ...current, ...directUrls };
          thumbnailUrlsRef.current = next;
          return next;
        });
      }

      const pendingMicrographs = micrographs.filter((micrograph) => {
        const micKey = toStringId(micrograph.id);
        if (!micKey) return false;
        if (micrograph.thumbnailUrl) return false;
        if (thumbnailUrlsRef.current[micKey]) return false;
        if (thumbnailObjectUrlsRef.current[micKey]) return false;

        return true;
      });

      if (!pendingMicrographs.length) return;

      let cursor = 0;
      let pendingUrls: Record<string, string> = {};

      const flushPendingUrls = () => {
        const keys = Object.keys(pendingUrls);
        if (!keys.length) return;

        const patch = pendingUrls;
        pendingUrls = {};

        setThumbnailUrls((current) => {
          const next = {
            ...current,
            ...patch,
          };

          thumbnailUrlsRef.current = next;
          return next;
        });
      };

      async function worker() {
        while (!cancelled && cursor < pendingMicrographs.length) {
          const micrograph = pendingMicrographs[cursor];
          cursor += 1;

          const micKey = toStringId(micrograph.id);
          if (!micKey) continue;

          try {
            const result = normalizeObjectUrl(
              await service.fetchCoords2dMicrographThumbnailObjectUrl(
                projectId,
                protocolId,
                outputName,
                micrograph.id,
                { size: THUMBNAIL_SIZE, format: "png" },
              ),
            );

            if (!result || cancelled) continue;

            thumbnailObjectUrlsRef.current[micKey] = result;
            pendingUrls[micKey] = result.url;

            if (Object.keys(pendingUrls).length >= THUMBNAIL_FLUSH_SIZE) {
              flushPendingUrls();
            }
          } catch {
            continue;
          }
        }
      }

      await Promise.all(
        Array.from(
          { length: Math.min(THUMBNAIL_CONCURRENCY, pendingMicrographs.length) },
          () => worker(),
        ),
      );

      if (!cancelled) {
        flushPendingUrls();
      }
    }

    void loadThumbnails();

    return () => {
      cancelled = true;
    };
  }, [service, projectId, protocolId, outputName, micrographs]);

  useEffect(() => {
    if (!selectedMicKey || selectedMicId === null || selectedMicId === undefined) return;
    if (pointsByMicId[selectedMicKey]) return;

    let cancelled = false;

    async function loadCoordinates() {
      setLoadingCoordinates(true);
      setError(null);

      try {
        const points = await service.fetchCoords2dForMicrograph(
          projectId,
          protocolId,
          outputName,
          selectedMicId,
        );

        if (cancelled) return;

        const normalizedPoints = (points ?? []).map((point, index) => ({
          ...point,
          id: point.id ?? `${selectedMicKey}:${index}`,
          micId: point.micId ?? selectedMicId,
          x: Number(point.x),
          y: Number(point.y),
        }));

        setPointsByMicId((current) => ({
          ...current,
          [selectedMicKey]: normalizedPoints,
        }));

        setOriginalPointsByMicId((current) => {
          if (current[selectedMicKey]) return current;

          return {
            ...current,
            [selectedMicKey]: normalizedPoints.map((point) => ({ ...point })),
          };
        });
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load 2D coordinates");
        }
      } finally {
        if (!cancelled) setLoadingCoordinates(false);
      }
    }

    void loadCoordinates();

    return () => {
      cancelled = true;
    };
  }, [
    service,
    projectId,
    protocolId,
    outputName,
    selectedMicId,
    selectedMicKey,
    pointsByMicId,
  ]);

  useEffect(() => {
    const sourceKey = `${projectId}:${protocolId}:${outputName}`;

    if (imageCacheSourceKeyRef.current !== sourceKey) {
      Object.values(imageObjectUrlCacheRef.current).forEach((item) => {
        item.revoke?.();
      });

      imageObjectUrlCacheRef.current = {};
      imageCacheSourceKeyRef.current = sourceKey;
    }

    if (selectedMicId === null || selectedMicId === undefined) {
      setImageUrl(null);
      setImage(null);
      setLoadingImage(false);
      setImageLoadAttempted(false);
      return;
    }

    const micKey = toStringId(selectedMicId);
    const cached = imageObjectUrlCacheRef.current[micKey];

    if (cached) {
      cached.usedAt = Date.now();

      setImageUrl(cached.url);
      setImage(cached.image);
      setLoadingImage(false);
      setImageLoadAttempted(true);
      setPreviewHiddenPointIds(new Set());
      setHistogramOpen(false);
      return;
    }

    let cancelled = false;
    let objectUrl: ObjectUrlResult | null = null;
    let storedInCache = false;

    setImageUrl(null);
    setImage(null);
    setLoadingImage(true);
    setImageLoadAttempted(false);
    setPreviewHiddenPointIds(new Set());
    setHistogramOpen(false);
    setError(null);

    async function loadImage() {
      try {
        objectUrl = normalizeObjectUrl(
          await service.fetchCoords2dMicrographImageObjectUrl(
            projectId,
            protocolId,
            outputName,
            selectedMicId,
            { size: MICROGRAPH_IMAGE_SIZE, format: "png" },
          ),
        );

        if (!objectUrl) {
          if (!cancelled) {
            setImageUrl(null);
            setImage(null);
            setImageLoadAttempted(true);
            setLoadingImage(false);
          }

          return;
        }

        if (cancelled) {
          objectUrl.revoke?.();
          return;
        }

        const img = new Image();

        img.onload = () => {
          if (!objectUrl) return;

          if (cancelled) {
            objectUrl.revoke?.();
            return;
          }

          const cache = imageObjectUrlCacheRef.current;

          cache[micKey] = {
            ...objectUrl,
            image: img,
            usedAt: Date.now(),
          };

          storedInCache = true;

          const entries = Object.entries(cache);

          if (entries.length > MICROGRAPH_IMAGE_CACHE_LIMIT) {
            entries
              .sort(([, first], [, second]) => first.usedAt - second.usedAt)
              .slice(0, entries.length - MICROGRAPH_IMAGE_CACHE_LIMIT)
              .forEach(([key, entry]) => {
                entry.revoke?.();
                delete cache[key];
              });
          }

          setImageUrl(objectUrl.url);
          setImage(img);
          setImageLoadAttempted(true);
          setLoadingImage(false);
        };

        img.onerror = () => {
          if (objectUrl && !storedInCache) {
            objectUrl.revoke?.();
          }

          if (cancelled) return;

          setImageUrl(null);
          setImage(null);
          setImageLoadAttempted(true);
          setLoadingImage(false);
          setError("The micrograph image returned by the backend could not be decoded.");
        };

        img.src = objectUrl.url;
      } catch (err) {
        if (!cancelled) {
          setImageUrl(null);
          setImage(null);
          setImageLoadAttempted(true);
          setLoadingImage(false);
          setError(err instanceof Error ? err.message : "Failed to load micrograph image");
        }
      }
    }

    void loadImage();

    return () => {
      cancelled = true;

      if (objectUrl && !storedInCache) {
        objectUrl.revoke?.();
      }
    };
  }, [service, projectId, protocolId, outputName, selectedMicId]);

  useEffect(() => {
    const node = canvasWrapRef.current;
    if (!node) return;

    const updateSize = () => {
      const rect = node.getBoundingClientRect();

      const nextWidth = Math.max(1, Math.floor(rect.width));
      const nextHeight = Math.max(1, Math.floor(rect.height));

      setSize((current) => {
        if (current.width === nextWidth && current.height === nextHeight) {
          return current;
        }

        return {
          width: nextWidth,
          height: nextHeight,
        };
      });
    };

    updateSize();

    const observer = new ResizeObserver(updateSize);
    observer.observe(node);

    return () => observer.disconnect();
  }, []);

  const imageWorldSize = useMemo(() => {
    if (!selectedMicrograph && !image) return null;

    const width =
      Number(selectedMicrograph?.width) > 0
        ? Number(selectedMicrograph?.width)
        : image?.naturalWidth ?? 0;

    const height =
      Number(selectedMicrograph?.height) > 0
        ? Number(selectedMicrograph?.height)
        : image?.naturalHeight ?? 0;

    if (!width || !height) return null;

    return { width, height };
  }, [image, selectedMicrograph]);

  const activeImageFilter = useMemo(() => {
    return buildCanvasFilter(filters);
  }, [filters]);

  const bounds = useMemo(() => {
    return getBounds(visiblePoints, imageWorldSize, boxSize);
  }, [boxSize, imageWorldSize, visiblePoints]);

  const fitView = useCallback(() => {
    setTransform(computeFitTransform(bounds, size));
  }, [bounds, size]);

    useEffect(() => {
    if (!selectedMicKey || loadingCoordinates) return;

    const nextBounds = getBounds(visiblePointsRef.current, imageWorldSize, boxSize);
    setTransform(computeFitTransform(nextBounds, size));
  }, [selectedMicKey, imageUrl, size.width, size.height, imageWorldSize, boxSize, loadingCoordinates]);

  const worldToScreen = useCallback(
    (x: number, y: number) => ({
      x: (x - bounds.minX) * transform.scale + transform.offsetX,
      y: (y - bounds.minY) * transform.scale + transform.offsetY,
    }),
    [bounds.minX, bounds.minY, transform.offsetX, transform.offsetY, transform.scale],
  );

  const screenToWorld = useCallback(
    (x: number, y: number) => ({
      x: (x - transform.offsetX) / transform.scale + bounds.minX,
      y: (y - transform.offsetY) / transform.scale + bounds.minY,
    }),
    [bounds.minX, bounds.minY, transform.offsetX, transform.offsetY, transform.scale],
  );

  const findPointAt = useCallback(
    (screenX: number, screenY: number): string | null => {
      const world = screenToWorld(screenX, screenY);
      const safeScale = Math.max(0.0001, transform.scale);
      const radiusWorld = Math.max(boxSize / 2, 8 / safeScale);
      const radiusWorldSq = radiusWorld * radiusWorld;

      let bestId: string | null = null;
      let bestDistanceSq = Number.POSITIVE_INFINITY;

      visiblePointsRef.current.forEach((point, index) => {
        const pointId = getPointId(point, index);
        if (deletedPointIdsRef.current.has(pointId)) return;
        if (previewHiddenPointIdsRef.current.has(pointId)) return;

        const dx = point.x - world.x;
        if (Math.abs(dx) > radiusWorld) return;

        const dy = point.y - world.y;
        if (Math.abs(dy) > radiusWorld) return;

        const distanceSq = dx * dx + dy * dy;

        if (distanceSq <= radiusWorldSq && distanceSq < bestDistanceSq) {
          bestDistanceSq = distanceSq;
          bestId = pointId;
        }
      });

      return bestId;
    },
    [boxSize, screenToWorld, transform.scale],
  );

  const particleCrops = useMemo<ParticleCrop[]>(() => {
    return visiblePoints
      .map((point, index) => {
        const pointId = getPointId(point, index);
        const cached = particleCropCacheRef.current[pointId];

        return {
          pointId,
          rowIndex: index,
          url: cached?.url ?? "",
          x: point.x,
          y: point.y,
        };
      })
      .filter((crop) => Boolean(crop.url));
  }, [particleCropVersion, visiblePoints]);

  useEffect(() => {
    if (!particlesOpen || !image || !imageWorldSize) return;

    let cancelled = false;
    let cursor = 0;

    const points = visiblePointsRef.current;
    const nextCache: Record<string, ParticleCropCacheEntry> = {};

    const processBatch = () => {
      if (cancelled) return;

      const end = Math.min(points.length, cursor + PARTICLE_CROP_BATCH_SIZE);

      for (; cursor < end; cursor += 1) {
        const point = points[cursor];
        const pointId = getPointId(point, cursor);
        const signature = makeParticleCropSignature(point, imageUrl, imageWorldSize, boxSize, filters);
        const cached = particleCropCacheRef.current[pointId];

        if (cached?.signature === signature) {
          nextCache[pointId] = cached;
          continue;
        }

        const url = makeParticleCropUrl(image, point, imageWorldSize, boxSize, filters);
        if (!url) continue;

        nextCache[pointId] = {
          signature,
          url,
        };
      }

      particleCropCacheRef.current = nextCache;
      setParticleCropVersion((current) => current + 1);

      if (cursor < points.length) {
        requestAnimationFrame(processBatch);
      }
    };

    requestAnimationFrame(processBatch);

    return () => {
      cancelled = true;
    };
  }, [
    boxSize,
    deletedPointIds.size,
    filters,
    image,
    imageUrl,
    imageWorldSize,
    particlesOpen,
    previewHiddenPointIds.size,
    selectedMicKey,
    visiblePoints.length,
  ]);

  useEffect(() => {
    if (!particlesOpen || !selectedPointId) return;

    const node = particleRefs.current[selectedPointId];
    if (!node) return;

    node.scrollIntoView({
      block: "nearest",
      inline: "nearest",
      behavior: "smooth",
    });
  }, [particleCrops.length, particlesOpen, selectedPointId]);

  const scheduleParticleCropUpdate = useCallback(
    (pointId: string, point: ViewerPoint) => {
      if (!particlesOpen || !image || !imageWorldSize) return;

      if (cropUpdateFrameRef.current !== null) {
        cancelAnimationFrame(cropUpdateFrameRef.current);
      }

      cropUpdateFrameRef.current = requestAnimationFrame(() => {
        cropUpdateFrameRef.current = null;

        const signature = makeParticleCropSignature(point, imageUrl, imageWorldSize, boxSize, filters);
        const url = makeParticleCropUrl(image, point, imageWorldSize, boxSize, filters);
        if (!url) return;

        particleCropCacheRef.current = {
          ...particleCropCacheRef.current,
          [pointId]: {
            signature,
            url,
          },
        };

        setParticleCropVersion((current) => current + 1);
      });
    },
    [boxSize, filters, image, imageUrl, imageWorldSize, particlesOpen],
  );

  const schedulePointMove = useCallback(
    (micKey: string, pointId: string, point: ViewerPoint) => {
      pendingPointMoveRef.current = {
        micKey,
        pointId,
        point,
      };

      scheduleParticleCropUpdate(pointId, point);

      if (pointMoveFrameRef.current !== null) return;

      pointMoveFrameRef.current = requestAnimationFrame(() => {
        pointMoveFrameRef.current = null;

        const pendingMove = pendingPointMoveRef.current;
        pendingPointMoveRef.current = null;

        if (!pendingMove) return;

        setPointsByMicId((current) => {
          const points = current[pendingMove.micKey];
          if (!points) return current;

          return {
            ...current,
            [pendingMove.micKey]: points.map((candidate, index) => {
              if (getPointId(candidate, index) !== pendingMove.pointId) return candidate;

              return {
                ...candidate,
                x: pendingMove.point.x,
                y: pendingMove.point.y,
              };
            }),
          };
        });
      });
    },
    [scheduleParticleCropUpdate],
  );

  const updateHistogramPreview = useCallback(
    (range: [number, number]) => {
      const bundle = histogramImageDataRef.current;
      if (!bundle || !imageWorldSize) return;

      const [minValue, maxValue] = range;
      const nextHiddenIds = new Set<string>();

      baseVisiblePointsRef.current.forEach((point, index) => {
        const pointId = getPointId(point, index);
        const average = calculateAverageIntensity(bundle, point, imageWorldSize, boxSize);

        if (average < minValue || average > maxValue) {
          nextHiddenIds.add(pointId);
        }
      });

      previewHiddenPointIdsRef.current = nextHiddenIds;
      setPreviewHiddenPointIds(nextHiddenIds);
    },
    [boxSize, imageWorldSize],
  );

  const openPowerHistogram = useCallback(() => {
    setToolsAnchorEl(null);

    if (!image || !imageWorldSize) {
      setError("No micrograph image available to build the histogram.");
      return;
    }

    setHistogramOpen(true);
    setHistogramComputing(true);
    setHistogramRange([0, 255]);
    setPreviewHiddenPointIds(new Set());

    requestAnimationFrame(() => {
      const bundle = buildFilteredImageData(image, filters);

      if (!bundle) {
        setHistogramComputing(false);
        setError("Could not build the histogram for the current micrograph.");
        return;
      }

      histogramImageDataRef.current = bundle;
      setHistogramData(buildHistogramFromImageData(bundle));
      setHistogramComputing(false);
    });
  }, [filters, image, imageWorldSize]);

  const closePowerHistogram = useCallback(() => {
    setHistogramOpen(false);
    histogramImageDataRef.current = null;
    setPreviewHiddenPointIds(new Set());
    previewHiddenPointIdsRef.current = new Set();
  }, []);

  const savePowerHistogram = useCallback(() => {
    if (!selectedMicId) {
      closePowerHistogram();
      return;
    }

    const idsToDelete = Array.from(previewHiddenPointIdsRef.current).filter(
      (pointId) => !deletedPointIdsRef.current.has(pointId),
    );

    if (idsToDelete.length > 0) {
      setDeletedPointIds((current) => {
        const next = new Set(current);
        idsToDelete.forEach((pointId) => next.add(pointId));
        deletedPointIdsRef.current = next;
        return next;
      });

      setSelectedPointId((current) => (current && idsToDelete.includes(current) ? null : current));

      setMicrographs((current) =>
        current.map((micrograph) => {
          if (toStringId(micrograph.id) !== toStringId(selectedMicId)) return micrograph;

          return {
            ...micrograph,
            particles: Math.max(0, Number(micrograph.particles ?? 0) - idsToDelete.length),
            updated: true,
          };
        }),
      );

      setTotalPicks((current) => Math.max(0, current - idsToDelete.length));
      setUpdatedMicIds((current) => new Set(current).add(toStringId(selectedMicId)));
    }

    closePowerHistogram();
  }, [closePowerHistogram, selectedMicId]);

  const resetCurrentMicrograph = useCallback(() => {
    setToolsAnchorEl(null);

    if (!selectedMicId || !selectedMicKey) return;

    const idsToDelete = baseVisiblePointsRef.current
      .map((point, index) => getPointId(point, index))
      .filter((pointId) => !deletedPointIdsRef.current.has(pointId));

    if (!idsToDelete.length) return;

    setDeletedPointIds((current) => {
      const next = new Set(current);
      idsToDelete.forEach((pointId) => next.add(pointId));
      deletedPointIdsRef.current = next;
      return next;
    });

    setPreviewHiddenPointIds(new Set());
    previewHiddenPointIdsRef.current = new Set();
    setSelectedPointId(null);

    setMicrographs((current) =>
      current.map((micrograph) => {
        if (toStringId(micrograph.id) !== selectedMicKey) return micrograph;

        return {
          ...micrograph,
          particles: 0,
          updated: true,
        };
      }),
    );

    setTotalPicks((current) => Math.max(0, current - idsToDelete.length));
    setUpdatedMicIds((current) => new Set(current).add(selectedMicKey));
  }, [selectedMicId, selectedMicKey]);

  const restoreCurrentMicrograph = useCallback(() => {
    setToolsAnchorEl(null);

    if (!selectedMicId || !selectedMicKey) return;

    const originalPoints = originalPointsByMicId[selectedMicKey] ?? [];
    const currentCount = baseVisiblePointsRef.current.length;
    const originalCount = originalPoints.length;

    setPointsByMicId((current) => ({
      ...current,
      [selectedMicKey]: originalPoints.map((point) => ({ ...point })),
    }));

    setDeletedPointIds((current) => {
      const next = new Set(current);

      currentPoints.forEach((point, index) => {
        next.delete(getPointId(point, index));
      });

      originalPoints.forEach((point, index) => {
        next.delete(getPointId(point, index));
      });

      deletedPointIdsRef.current = next;
      return next;
    });

    setPreviewHiddenPointIds(new Set());
    previewHiddenPointIdsRef.current = new Set();
    setSelectedPointId(null);

    setMicrographs((current) =>
      current.map((micrograph) => {
        if (toStringId(micrograph.id) !== selectedMicKey) return micrograph;

        return {
          ...micrograph,
          particles: originalCount,
          updated: false,
        };
      }),
    );

    setTotalPicks((current) => Math.max(0, current + originalCount - currentCount));

    setUpdatedMicIds((current) => {
      const next = new Set(current);
      next.delete(selectedMicKey);
      return next;
    });
  }, [currentPoints, originalPointsByMicId, selectedMicId, selectedMicKey]);

  const buildCreateOutputPayload = useCallback(() => {
    const micrographsPayload = Array.from(updatedMicIds)
      .map((micKey) => {
        const points = pointsByMicId[micKey] ?? [];

        const coordinates = points
          .filter((point, index) => {
            const pointId = getPointId(point, index);
            return !deletedPointIds.has(pointId);
          })
          .map((point) => ({
            id: point.id,
            micId: point.micId ?? micKey,
            x: Number(point.x),
            y: Number(point.y),
          }))
          .filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y));

        return {
          id: micKey,
          coordinates,
        };
      })
      .filter((item) => pointsByMicId[String(item.id)] !== undefined);

    return {
      boxSize,
      micrographs: micrographsPayload,
    };
  }, [boxSize, deletedPointIds, pointsByMicId, updatedMicIds]);

  const clearSavedState = useCallback(() => {
    const cleanedPointsByMicId: Record<string, ViewerPoint[]> = {};

    for (const [micKey, points] of Object.entries(pointsByMicId)) {
      cleanedPointsByMicId[micKey] = points
        .filter((point, index) => {
          const pointId = getPointId(point, index);
          return !deletedPointIds.has(pointId);
        })
        .map((point) => ({ ...point }));
    }

    setPointsByMicId(cleanedPointsByMicId);
    setOriginalPointsByMicId(cleanedPointsByMicId);
    setDeletedPointIds(new Set());
    deletedPointIdsRef.current = new Set();
    setPreviewHiddenPointIds(new Set());
    previewHiddenPointIdsRef.current = new Set();
    setUpdatedMicIds(new Set());

    setMicrographs((current) =>
      current.map((micrograph) => {
        const micKey = toStringId(micrograph.id);
        const loadedPoints = cleanedPointsByMicId[micKey];

        if (!loadedPoints && !micrograph.updated) {
          return micrograph;
        }

        return {
          ...micrograph,
          particles: loadedPoints ? loadedPoints.length : micrograph.particles,
          updated: false,
        };
      }),
    );
  }, [deletedPointIds, pointsByMicId]);

  const closeViewer = useCallback(() => {
    setParticlesOpen(false);
    setHistogramOpen(false);

    if (onClose) {
      onClose();
    }
  }, [onClose]);

  const requestCloseViewer = useCallback(() => {
    if (hasUnsavedChanges) {
      setConfirmationAction("close");
      return;
    }

    closeViewer();
  }, [closeViewer, hasUnsavedChanges]);

  const requestCreateOutput = useCallback(() => {
    setConfirmationAction("create-output");
  }, []);

  const confirmCreateOutput = useCallback(async () => {
    setCreatingOutput(true);
    setError(null);
    setSuccessMessage(null);

    try {
      const result = await service.createCoords2dOutputFromCurrentCoordinates(
        projectId,
        protocolId,
        outputName,
        buildCreateOutputPayload(),
      );

      clearSavedState();
      setConfirmationAction(null);

      setSuccessMessage(
        result.message || `The new set of coordinates has been created: ${result.outputName}`,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create coordinates output");
    } finally {
      setCreatingOutput(false);
    }
  }, [
    buildCreateOutputPayload,
    clearSavedState,
    outputName,
    projectId,
    protocolId,
    service,
  ]);

  const handleConfirmAction = useCallback(async () => {
    if (confirmationAction === "close") {
      setConfirmationAction(null);
      closeViewer();
      return;
    }

    if (confirmationAction === "create-output") {
      await confirmCreateOutput();
    }
  }, [closeViewer, confirmCreateOutput, confirmationAction]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");

    if (!canvas || !ctx) return;

    const ratio = window.devicePixelRatio || 1;

    canvas.width = Math.floor(size.width * ratio);
    canvas.height = Math.floor(size.height * ratio);
    canvas.style.width = `${size.width}px`;
    canvas.style.height = `${size.height}px`;

    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.clearRect(0, 0, size.width, size.height);

    ctx.fillStyle = CANVAS_BG;
    ctx.fillRect(0, 0, size.width, size.height);

    if (image && imageUrl && imageWorldSize) {
      const topLeft = worldToScreen(0, 0);
      const bottomRight = worldToScreen(imageWorldSize.width, imageWorldSize.height);

      ctx.save();
      ctx.filter = activeImageFilter;
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(
        image,
        topLeft.x,
        topLeft.y,
        bottomRight.x - topLeft.x,
        bottomRight.y - topLeft.y,
      );
      ctx.restore();
    } else {
      ctx.fillStyle = "#cbd5e1";
      ctx.fillRect(0, 0, size.width, size.height);
    }

    visiblePoints.forEach((point, index) => {
      const pointId = getPointId(point, index);
      const screen = worldToScreen(point.x, point.y);
      const radiusPx = Math.max(2, (boxSize / 2) * transform.scale);
      const selected = pointId === selectedPointId;

      ctx.strokeStyle = selected ? "#ffff00" : pickColor;
      ctx.lineWidth = selected ? 2.5 : 1.2;
      ctx.beginPath();

      if (shapeMode === "circle") {
        ctx.arc(screen.x, screen.y, radiusPx, 0, Math.PI * 2);
      } else {
        ctx.rect(screen.x - radiusPx, screen.y - radiusPx, radiusPx * 2, radiusPx * 2);
      }

      ctx.stroke();
    });
  }, [
    activeImageFilter,
    bounds.maxX,
    bounds.maxY,
    boxSize,
    image,
    imageUrl,
    imageWorldSize,
    pickColor,
    selectedPointId,
    shapeMode,
    size.height,
    size.width,
    transform.scale,
    visiblePoints,
    worldToScreen,
  ]);


  const handleSelectMicrograph = useCallback((micId: Id) => {
    setSelectedMicId(micId);
    setSelectedPointId(null);
  }, []);

  const toggleFilter = useCallback((key: keyof ImageFilters) => {
    setFilters((current) => ({
      ...current,
      [key]: !current[key],
    }));
  }, []);

  const markMicrographUpdated = useCallback((micId: Id) => {
    setSuccessMessage(null);
    setUpdatedMicIds((current) => new Set(current).add(toStringId(micId)));
  }, []);

  const updateMicrographParticleCount = useCallback((micId: Id, delta: number) => {
    const micKey = toStringId(micId);

    setMicrographs((current) =>
      current.map((micrograph) => {
        if (toStringId(micrograph.id) !== micKey) return micrograph;

        return {
          ...micrograph,
          particles: Math.max(0, Number(micrograph.particles ?? 0) + delta),
          updated: true,
        };
      }),
    );

    setTotalPicks((current) => Math.max(0, current + delta));
  }, []);

  const erasePointAt = useCallback(
    (screenX: number, screenY: number) => {
      if (!selectedMicId) return;

      const hitId = findPointAt(screenX, screenY);
      if (!hitId) return;
      if (erasedDuringDragRef.current.has(hitId)) return;
      if (deletedPointIdsRef.current.has(hitId)) return;

      erasedDuringDragRef.current.add(hitId);

      setDeletedPointIds((current) => {
        const next = new Set(current);
        next.add(hitId);
        deletedPointIdsRef.current = next;
        return next;
      });

      setSelectedPointId((current) => (current === hitId ? null : current));
      markMicrographUpdated(selectedMicId);
      updateMicrographParticleCount(selectedMicId, -1);
    },
    [findPointAt, markMicrographUpdated, selectedMicId, updateMicrographParticleCount],
  );

  const scheduleTransform = useCallback((nextTransform: ViewTransform) => {
    pendingTransformRef.current = nextTransform;

    if (transformFrameRef.current !== null) return;

    transformFrameRef.current = requestAnimationFrame(() => {
      transformFrameRef.current = null;

      const pendingTransform = pendingTransformRef.current;
      pendingTransformRef.current = null;

      if (!pendingTransform) return;

      setTransform(pendingTransform);
    });
  }, []);


  const handleWheel = useCallback(
    (event: ReactWheelEvent<HTMLCanvasElement>) => {
      if (toolMode !== "pan") return;

      event.preventDefault();

      const rect = event.currentTarget.getBoundingClientRect();
      const pointerX = event.clientX - rect.left;
      const pointerY = event.clientY - rect.top;
      const world = screenToWorld(pointerX, pointerY);
      const factor = event.deltaY < 0 ? 1.12 : 0.88;

      setTransform((current) => {
        const scale = Math.min(12, Math.max(0.02, current.scale * factor));

        return {
          scale,
          offsetX: pointerX - (world.x - bounds.minX) * scale,
          offsetY: pointerY - (world.y - bounds.minY) * scale,
        };
      });
    },
    [bounds.minX, bounds.minY, screenToWorld, toolMode],
  );

  const handleMouseDown = useCallback(
    (event: ReactMouseEvent<HTMLCanvasElement>) => {
      const rect = event.currentTarget.getBoundingClientRect();
      const pointerX = event.clientX - rect.left;
      const pointerY = event.clientY - rect.top;

      dragRef.current = createDragState();

      if (toolMode === "erase") {
        erasedDuringDragRef.current = new Set();
        erasePointAt(pointerX, pointerY);

        dragRef.current = {
          ...createDragState(),
          type: "erase",
          active: true,
          x: event.clientX,
          y: event.clientY,
        };
        return;
      }

      if (toolMode !== "pan") return;

      const hitId = findPointAt(pointerX, pointerY);
      if (hitId && selectedMicKey) {
        const point = visiblePoints.find((candidate, index) => getPointId(candidate, index) === hitId);
        if (!point) return;

        const world = screenToWorld(pointerX, pointerY);

        setSelectedPointId(hitId);

        dragRef.current = {
          type: "point",
          active: true,
          moved: false,
          x: event.clientX,
          y: event.clientY,
          offsetX: transform.offsetX,
          offsetY: transform.offsetY,
          pointId: hitId,
          micKey: selectedMicKey,
          startWorldX: world.x,
          startWorldY: world.y,
          initialPointX: point.x,
          initialPointY: point.y,
          initialPoint: point,
        };

        return;
      }

      dragRef.current = {
        type: "pan",
        active: true,
        moved: false,
        x: event.clientX,
        y: event.clientY,
        offsetX: transform.offsetX,
        offsetY: transform.offsetY,
        pointId: null,
        micKey: "",
        startWorldX: 0,
        startWorldY: 0,
        initialPointX: 0,
        initialPointY: 0,
        initialPoint: null,
      };
    },
    [
      erasePointAt,
      findPointAt,
      screenToWorld,
      selectedMicKey,
      toolMode,
      transform.offsetX,
      transform.offsetY,
      visiblePoints,
    ],
  );

  const handleMouseMove = useCallback(
    (event: ReactMouseEvent<HTMLCanvasElement>) => {
      const drag = dragRef.current;

      if (!drag.active) return;

      const dx = event.clientX - drag.x;
      const dy = event.clientY - drag.y;

      if (Math.abs(dx) + Math.abs(dy) > 3) {
        drag.moved = true;
      }

      if (drag.type === "erase") {
        const rect = event.currentTarget.getBoundingClientRect();
        erasePointAt(event.clientX - rect.left, event.clientY - rect.top);
        return;
      }

      if (drag.type === "point" && drag.pointId && drag.micKey && drag.initialPoint) {
        const rect = event.currentTarget.getBoundingClientRect();
        const pointerX = event.clientX - rect.left;
        const pointerY = event.clientY - rect.top;
        const world = screenToWorld(pointerX, pointerY);

        const deltaX = world.x - drag.startWorldX;
        const deltaY = world.y - drag.startWorldY;

        let nextX = drag.initialPointX + deltaX;
        let nextY = drag.initialPointY + deltaY;

        if (imageWorldSize) {
          nextX = clamp(nextX, 0, imageWorldSize.width);
          nextY = clamp(nextY, 0, imageWorldSize.height);
        }

        schedulePointMove(drag.micKey, drag.pointId, {
          ...drag.initialPoint,
          x: nextX,
          y: nextY,
        });

        return;
      }

      if (drag.type === "pan") {
        scheduleTransform({
          scale: transform.scale,
          offsetX: drag.offsetX + dx,
          offsetY: drag.offsetY + dy,
        });
      }
    },
    [erasePointAt, imageWorldSize, schedulePointMove, scheduleTransform, screenToWorld, transform.scale],
  );

  const handleMouseUp = useCallback(
    (event: ReactMouseEvent<HTMLCanvasElement>) => {
      const drag = dragRef.current;
      dragRef.current = createDragState();

      if (drag.type === "erase") {
        erasedDuringDragRef.current = new Set();
        return;
      }

      if (drag.type === "point") {
        if (drag.moved && selectedMicId) {
          markMicrographUpdated(selectedMicId);
        }

        return;
      }

      if (drag.type === "pan" && drag.moved) {
        return;
      }

      const rect = event.currentTarget.getBoundingClientRect();
      const clickX = event.clientX - rect.left;
      const clickY = event.clientY - rect.top;

      if (!selectedMicId || !selectedMicKey) return;

      if (toolMode === "pick") {
        const world = screenToWorld(clickX, clickY);
        const point: ViewerPoint = {
          id: `new:${selectedMicKey}:${nextPointIdRef.current++}`,
          micId: selectedMicId,
          x: imageWorldSize ? clamp(world.x, 0, imageWorldSize.width) : world.x,
          y: imageWorldSize ? clamp(world.y, 0, imageWorldSize.height) : world.y,
          isNew: true,
        };

        setPointsByMicId((current) => ({
          ...current,
          [selectedMicKey]: [...(current[selectedMicKey] ?? []), point],
        }));

        setSelectedPointId(toStringId(point.id));
        markMicrographUpdated(selectedMicId);
        updateMicrographParticleCount(selectedMicId, 1);
        return;
      }

      const hitId = findPointAt(clickX, clickY);
      setSelectedPointId(hitId);
    },
    [
      findPointAt,
      imageWorldSize,
      markMicrographUpdated,
      screenToWorld,
      selectedMicId,
      selectedMicKey,
      toolMode,
      updateMicrographParticleCount,
    ],
  );

  const handleCanvasMouseLeave = useCallback(() => {
    const drag = dragRef.current;

    if (drag.type === "point" && drag.moved && selectedMicId) {
      markMicrographUpdated(selectedMicId);
    }

    if (drag.type === "erase") {
      erasedDuringDragRef.current = new Set();
    }

    dragRef.current = createDragState();
  }, [markMicrographUpdated, selectedMicId]);

  const handleHistogramRangeChange = useCallback(
    (_event: Event, value: number | number[]) => {
      if (!Array.isArray(value)) return;

      const nextRange: [number, number] = [
        Math.round(value[0]),
        Math.round(value[1]),
      ];

      setHistogramRange(nextRange);
      updateHistogramPreview(nextRange);
    },
    [updateHistogramPreview],
  );

  const loading = loadingMicrographs || loadingCoordinates || loadingImage;
  const updatedCount = updatedMicIds.size;

  const confirmationTitle =
    confirmationAction === "close"
      ? "Close coordinates viewer?"
      : "Create coordinates output?";

  const confirmationDescription =
    confirmationAction === "close"
      ? "There are changes that could be saved. Do you really want to close the viewer?"
      : "A new SetOfCoordinates output will be created in the protocol using the coordinates currently visible in the viewer.";

  const confirmationConfirmLabel =
    confirmationAction === "close" ? "Close viewer" : "Create output";

  return (
    <Box
      sx={{
        height: "100%",
        display: "flex",
        flexDirection: "column",
        minHeight: 0,
        bgcolor: VIEWER_BG,
        position: "relative",
        ...VIEWER_TEXT_SX,
      }}
    >
      <Box
        sx={{
          px: 0.5,
          py: 0.25,
          display: "flex",
          alignItems: "center",
          gap: 0.25,
          borderBottom: PANEL_BORDER,
          bgcolor: "#f3f4f6",
        }}
      >
        <Button
          size="small"
          disabled
          startIcon={<FileText size={14} />}
          sx={{ minWidth: 42, color: "#111827" }}
        >
          File
        </Button>

        <Button
          size="small"
          startIcon={<SlidersHorizontal size={14} />}
          onClick={(event) => setFiltersAnchorEl(event.currentTarget)}
          sx={{ minWidth: 58, color: "#111827" }}
        >
          Filters
        </Button>

        <Button
          size="small"
          startIcon={<Wrench size={14} />}
          onClick={(event) => setToolsAnchorEl(event.currentTarget)}
          sx={{ minWidth: 50, color: "#111827" }}
        >
          Tools
        </Button>

        <Button
          size="small"
          startIcon={<Grid3X3 size={14} />}
          onClick={(event) => setWindowsAnchorEl(event.currentTarget)}
          sx={{ minWidth: 68, color: "#111827" }}
        >
          Window
        </Button>

        <Menu
          anchorEl={filtersAnchorEl}
          open={Boolean(filtersAnchorEl)}
          onClose={() => setFiltersAnchorEl(null)}
        >
          <MenuItem onClick={() => toggleFilter("enhanceContrast")}>
            <ListItemIcon>
              <Sparkles size={17} />
            </ListItemIcon>
            <Checkbox size="small" checked={filters.enhanceContrast} />
            Enhance contrast
          </MenuItem>

          <MenuItem onClick={() => toggleFilter("gaussianBlur")}>
            <ListItemIcon>
              <Waves size={17} />
            </ListItemIcon>
            <Checkbox size="small" checked={filters.gaussianBlur} />
            Gaussian blur
          </MenuItem>

          <MenuItem onClick={() => toggleFilter("invertContrast")}>
            <ListItemIcon>
              <Contrast size={17} />
            </ListItemIcon>
            <Checkbox size="small" checked={filters.invertContrast} />
            Invert contrast
          </MenuItem>
        </Menu>

        <Menu
          anchorEl={toolsAnchorEl}
          open={Boolean(toolsAnchorEl)}
          onClose={() => setToolsAnchorEl(null)}
        >
          <MenuItem onClick={openPowerHistogram}>
            <ListItemIcon>
              <BarChart3 size={17} />
            </ListItemIcon>
            Power histogram
          </MenuItem>

          <MenuItem onClick={resetCurrentMicrograph}>
            <ListItemIcon>
              <Trash2 size={17} />
            </ListItemIcon>
            Reset micrograph
          </MenuItem>

          <MenuItem onClick={restoreCurrentMicrograph}>
            <ListItemIcon>
              <RotateCcw size={17} />
            </ListItemIcon>
            Restore micrograph
          </MenuItem>
        </Menu>

        <Menu
          anchorEl={windowsAnchorEl}
          open={Boolean(windowsAnchorEl)}
          onClose={() => setWindowsAnchorEl(null)}
        >
          <MenuItem
            onClick={() => {
              setParticlesOpen(true);
              setWindowsAnchorEl(null);
            }}
          >
            <ListItemIcon>
              <ImageMinus size={17} />
            </ListItemIcon>
            Particles
          </MenuItem>
        </Menu>
      </Box>

      <Box
        sx={{
          px: 1,
          py: 0.75,
          display: "flex",
          alignItems: "center",
          gap: 1.25,
          borderBottom: PANEL_BORDER,
          bgcolor: HEADER_BG,
        }}
      >
        <Typography variant="body2" sx={{ fontWeight: 700 }}>
          Box size(px):
        </Typography>

        <Slider
          size="small"
          min={MIN_BOX_SIZE}
          max={MAX_BOX_SIZE}
          step={1}
          value={boxSize}
          onChange={(_, value) => setBoxSize(Array.isArray(value) ? value[0] : value)}
          sx={{ width: 260 }}
        />

        <Typography variant="body2" sx={{ minWidth: 42 }}>
          ({boxSize})
        </Typography>

        <Chip
          size="small"
          label={`Total micrograph: ${micrographs.length}`}
          sx={{ bgcolor: "#cfe8cf", border: "1px solid #9cc99c" }}
        />

        <Chip
          size="small"
          label={`Total picks: ${totalPicks}`}
          sx={{ bgcolor: "#c3d7df", border: "1px solid #91b2bf" }}
        />

        {updatedCount > 0 ? (
          <Chip size="small" color="warning" label={`Updated: ${updatedCount}`} />
        ) : null}

        <Box sx={{ flex: 1 }} />

        <Typography variant="caption" sx={{ color: "text.secondary" }}>
          {protocolLabel} · {outputName}
        </Typography>
      </Box>

      <Box
        sx={{
          px: 1,
          py: 0.75,
          display: "flex",
          alignItems: "center",
          gap: 1,
          borderBottom: PANEL_BORDER,
          bgcolor: TOOLBAR_BG,
        }}
      >
        <Typography variant="body2" sx={{ fontWeight: 700 }}>
          Shape:
        </Typography>

        <ButtonGroup size="small" variant="outlined">
          <Button
            variant={shapeMode === "circle" ? "contained" : "outlined"}
            onClick={() => setShapeMode("circle")}
          >
            <Circle size={16} />
          </Button>

          <Button
            variant={shapeMode === "square" ? "contained" : "outlined"}
            onClick={() => setShapeMode("square")}
          >
            <Square size={16} />
          </Button>
        </ButtonGroup>

        <Divider flexItem orientation="vertical" />

        <Typography variant="body2" sx={{ fontWeight: 700 }}>
          Color:
        </Typography>

        <Box
          component="input"
          type="color"
          value={pickColor}
          onChange={(event) => setPickColor((event.target as HTMLInputElement).value)}
          sx={{
            width: 34,
            height: 30,
            p: 0,
            border: PANEL_BORDER,
            bgcolor: "transparent",
          }}
        />

        <Divider flexItem orientation="vertical" />

        <Typography variant="body2" sx={{ fontWeight: 700 }}>
          Picker tools:
        </Typography>

        <ButtonGroup size="small" variant="outlined">
          <Tooltip title="Particle picker">
            <Button
              variant={toolMode === "pick" ? "contained" : "outlined"}
              onClick={() => setToolMode("pick")}
            >
              <Plus size={16} />
            </Button>
          </Tooltip>

          <Tooltip title="Eraser">
            <Button
              variant={toolMode === "erase" ? "contained" : "outlined"}
              onClick={() => setToolMode("erase")}
            >
              <Eraser size={16} />
            </Button>
          </Tooltip>
        </ButtonGroup>

        <Divider flexItem orientation="vertical" />

        <Typography variant="body2" sx={{ fontWeight: 700 }}>
          Navigate:
        </Typography>

        <ButtonGroup size="small" variant="outlined">
          <Tooltip title="Fit to display">
            <Button onClick={fitView}>
              <LocateFixed size={16} />
            </Button>
          </Tooltip>

          <Tooltip title="Click and drag to move">
            <Button
              variant={toolMode === "pan" ? "contained" : "outlined"}
              onClick={() => setToolMode("pan")}
            >
              <Hand size={16} />
            </Button>
          </Tooltip>
        </ButtonGroup>

        <Box sx={{ flex: 1 }} />

        {selectedPoint ? (
          <Typography variant="caption">
            x={formatNumber(selectedPoint.x)} y={formatNumber(selectedPoint.y)}
          </Typography>
        ) : null}
      </Box>

      {error ? (
        <Alert severity="error" sx={{ borderRadius: 0 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      ) : null}

      {successMessage ? (
        <Alert severity="success" sx={{ borderRadius: 0 }} onClose={() => setSuccessMessage(null)}>
          {successMessage}
        </Alert>
      ) : null}

      <Box sx={{ flex: 1, minHeight: 0, display: "flex" }}>
        <TableContainer
          component={Paper}
          square
          sx={{
            width: 520,
            borderRight: PANEL_BORDER,
            minHeight: 0,
            overflow: "auto",
          }}
        >
          <Table size="small" stickyHeader>
            <TableHead>
              <TableRow>
                <TableCell sx={{ bgcolor: HEADER_BG, fontWeight: 700, width: 58 }}>
                  Index
                </TableCell>

                <TableCell sx={{ bgcolor: HEADER_BG, fontWeight: 700, width: 72 }}>
                  Preview
                </TableCell>

                <TableCell sx={{ bgcolor: HEADER_BG, fontWeight: 700 }}>
                  File
                </TableCell>

                <TableCell
                  align="center"
                  sx={{ bgcolor: HEADER_BG, fontWeight: 700, width: 100 }}
                >
                  Particles
                </TableCell>

                <TableCell
                  align="center"
                  sx={{ bgcolor: HEADER_BG, fontWeight: 700, width: 92 }}
                >
                  Updated
                </TableCell>
              </TableRow>
            </TableHead>

            <TableBody>
              {micrographs.map((micrograph, index) => {
                const micKey = toStringId(micrograph.id);

                return (
                  <MicrographTableRow
                    key={micKey}
                    micrograph={micrograph}
                    index={index}
                    selected={micKey === selectedMicKey}
                    thumbnailUrl={thumbnailUrls[micKey]}
                    updated={updatedMicIds.has(micKey) || Boolean(micrograph.updated)}
                    onSelect={handleSelectMicrograph}
                  />
                );
              })}
            </TableBody>
          </Table>
        </TableContainer>

        <Box
          sx={{
            flex: 1,
            minWidth: 0,
            minHeight: 0,
            display: "flex",
            flexDirection: "column",
            bgcolor: VIEWER_BG,
          }}
        >
          <Box
            ref={canvasWrapRef}
            sx={{
              position: "relative",
              flex: 1,
              m: 1,
              minHeight: 0,
              overflow: "hidden",
              border: PANEL_BORDER,
              bgcolor: CANVAS_OUTER_BG,
            }}
          >
            <canvas
              ref={canvasRef}
              onWheel={handleWheel}
              onMouseDown={handleMouseDown}
              onMouseMove={handleMouseMove}
              onMouseUp={handleMouseUp}
              onMouseLeave={handleCanvasMouseLeave}
              style={{
                display: "block",
                width: "100%",
                height: "100%",
                cursor:
                  toolMode === "pan"
                    ? "grab"
                    : toolMode === "erase"
                      ? "crosshair"
                      : "copy",
              }}
            />

            {loading ? (
              <Box
                sx={{
                  position: "absolute",
                  inset: 0,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  bgcolor: "rgba(255,255,255,0.25)",
                  pointerEvents: "none",
                }}
              >
                <CircularProgress size={24} />
              </Box>
            ) : null}

            {loadingImage ? (
              <Box
                sx={{
                  position: "absolute",
                  left: 12,
                  bottom: 12,
                  px: 1,
                  py: 0.5,
                  bgcolor: "rgba(255,255,255,0.86)",
                  border: PANEL_BORDER,
                  pointerEvents: "none",
                }}
              >
                <Typography variant="caption">Loading micrograph image...</Typography>
              </Box>
            ) : null}

            {!loadingImage && imageLoadAttempted && !imageUrl ? (
              <Box
                sx={{
                  position: "absolute",
                  left: 12,
                  bottom: 12,
                  px: 1,
                  py: 0.5,
                  bgcolor: "rgba(255,255,255,0.86)",
                  border: PANEL_BORDER,
                  pointerEvents: "none",
                }}
              >
                <Typography variant="caption">
                  No micrograph image found. Coordinates are shown in coordinate space.
                </Typography>
              </Box>
            ) : null}
          </Box>

          <Box
            sx={{
              px: 2,
              py: 1,
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              borderTop: PANEL_BORDER,
              bgcolor: VIEWER_BG,
            }}
          >
            <Chip
              size="small"
              icon={<Table2 size={14} />}
              label={`${visiblePoints.length} particles in selected micrograph`}
              variant="outlined"
            />

            <Box sx={{ display: "flex", gap: 1 }}>
              <Button
                size="small"
                variant="outlined"
                startIcon={<X size={16} />}
                onClick={requestCloseViewer}
                disabled={creatingOutput}
              >
                Close
              </Button>

              <Button
                size="small"
                variant="contained"
                startIcon={creatingOutput ? <CircularProgress size={14} /> : <Plus size={16} />}
                onClick={requestCreateOutput}
                disabled={creatingOutput}
                sx={{
                  bgcolor: "#b22a2a",
                  "&:hover": { bgcolor: "#922020" },
                }}
              >
                {creatingOutput ? "Creating..." : "Coordinate"}
              </Button>
            </Box>
          </Box>
        </Box>
      </Box>

      {histogramOpen ? (
        <Paper
          elevation={8}
          sx={{
            width: 680,
            position: "fixed",
            left: 96,
            top: 96,
            zIndex: 1600,
            borderRadius: 1.5,
            overflow: "hidden",
            border: PANEL_BORDER,
            bgcolor: "#d7d7d7",
          }}
        >
          <Box
            sx={{
              px: 1,
              py: 0.75,
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              bgcolor: "#f3f4f6",
              borderBottom: PANEL_BORDER,
            }}
          >
            <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
              <BarChart3 size={17} />
              <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
                Power histogram
              </Typography>
            </Box>

            <IconButton size="small" onClick={closePowerHistogram}>
              <X size={16} />
            </IconButton>
          </Box>

          <Box sx={{ p: 1.25, bgcolor: "#ffffff" }}>
            {histogramComputing ? (
              <Box sx={{ height: 370, display: "flex", alignItems: "center", justifyContent: "center" }}>
                <CircularProgress size={26} />
              </Box>
            ) : (
              <>
                <Box sx={{ display: "flex", justifyContent: "center" }}>
                  <HistogramChart histogram={histogramData} range={histogramRange} />
                </Box>

                <Box sx={{ px: 7, display: "flex", alignItems: "center", gap: 2 }}>
                  <Slider
                    min={0}
                    max={255}
                    step={1}
                    value={histogramRange}
                    onChange={handleHistogramRangeChange}
                    valueLabelDisplay="auto"
                    sx={{ flex: 1 }}
                  />

                  <Typography variant="body2" sx={{ minWidth: 78 }}>
                    ({histogramRange[0]}, {histogramRange[1]})
                  </Typography>
                </Box>

                <Box
                  sx={{
                    mt: 1.25,
                    display: "flex",
                    justifyContent: "flex-end",
                    gap: 1,
                  }}
                >
                  <Button
                    size="small"
                    variant="outlined"
                    startIcon={<X size={16} />}
                    onClick={closePowerHistogram}
                  >
                    Close
                  </Button>

                  <Button
                    size="small"
                    variant="contained"
                    startIcon={<Save size={16} />}
                    onClick={savePowerHistogram}
                    sx={{
                      bgcolor: "#b22a2a",
                      "&:hover": { bgcolor: "#922020" },
                    }}
                  >
                    Save & Close
                  </Button>
                </Box>
              </>
            )}
          </Box>
        </Paper>
      ) : null}

      {particlesOpen ? (
        <Paper
          elevation={8}
          sx={{
            width: 250,
            maxHeight: "92vh",
            position: "fixed",
            right: 24,
            top: 24,
            zIndex: 1500,
            borderRadius: 1.5,
            overflow: "hidden",
            border: PANEL_BORDER,
            bgcolor: "#ffffff",
          }}
        >
          <Box
            sx={{
              px: 1,
              py: 0.75,
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              bgcolor: "#f3f4f6",
              borderBottom: PANEL_BORDER,
              cursor: "default",
            }}
          >
            <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
              Particles
            </Typography>

            <IconButton size="small" onClick={() => setParticlesOpen(false)}>
              <X size={16} />
            </IconButton>
          </Box>

          <Box
            sx={{
              p: 0.75,
              bgcolor: "#ffffff",
              overflow: "auto",
              maxHeight: "calc(92vh - 42px)",
            }}
          >
            {!image || !imageWorldSize ? (
              <Typography variant="body2" sx={{ color: "text.secondary", p: 1 }}>
                No micrograph image available.
              </Typography>
            ) : particleCrops.length === 0 ? (
              <Typography variant="body2" sx={{ color: "text.secondary", p: 1 }}>
                No particles in selected micrograph.
              </Typography>
            ) : (
              <Box
                sx={{
                  display: "grid",
                  gridTemplateColumns: "repeat(3, 1fr)",
                  gap: 0.75,
                }}
              >
                {particleCrops.map((crop) => {
                  const selected = crop.pointId === selectedPointId;

                  return (
                    <Box
                      key={crop.pointId}
                      ref={(node) => {
                        particleRefs.current[crop.pointId] = node as HTMLButtonElement | null;
                      }}
                      component="button"
                      type="button"
                      onClick={() => setSelectedPointId(crop.pointId)}
                      sx={{
                        width: PARTICLE_GALLERY_SIZE,
                        height: PARTICLE_GALLERY_SIZE,
                        p: 0,
                        border: selected ? "3px solid #ef4444" : "2px solid #4f46e5",
                        bgcolor: "#111827",
                        cursor: "pointer",
                        outline: "none",
                        display: "block",
                        overflow: "hidden",
                      }}
                    >
                      <Box
                        component="img"
                        src={crop.url}
                        alt={`Particle ${crop.rowIndex + 1}`}
                        sx={{
                          width: "100%",
                          height: "100%",
                          objectFit: "cover",
                          display: "block",
                        }}
                      />
                    </Box>
                  );
                })}
              </Box>
            )}
          </Box>
        </Paper>
      ) : null}

      <Dialog
        open={confirmationAction !== null}
        onClose={() => {
          if (!creatingOutput) setConfirmationAction(null);
        }}
        maxWidth="xs"
        fullWidth
      >
        <DialogTitle sx={{ display: "flex", alignItems: "center", gap: 1 }}>
          <AlertTriangle size={19} />
          {confirmationTitle}
        </DialogTitle>

        <DialogContent>
          <DialogContentText>{confirmationDescription}</DialogContentText>
        </DialogContent>

        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button
            variant="outlined"
            onClick={() => setConfirmationAction(null)}
            disabled={creatingOutput}
            sx={{ textTransform: "none" }}
          >
            Cancel
          </Button>

          <Button
            variant="contained"
            onClick={handleConfirmAction}
            disabled={creatingOutput}
            startIcon={creatingOutput ? <CircularProgress size={14} /> : undefined}
            sx={{
              textTransform: "none",
              bgcolor: confirmationAction === "create-output" ? "#b22a2a" : undefined,
              "&:hover": {
                bgcolor: confirmationAction === "create-output" ? "#922020" : undefined,
              },
            }}
          >
            {creatingOutput ? "Creating..." : confirmationConfirmLabel}
          </Button>
        </DialogActions>
      </Dialog>
    </Box >
  );
}

export default Coords2dViewer;