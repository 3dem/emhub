import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import type { ReactNode } from "react";
import toast from "react-hot-toast";
import {
  Box,
  CircularProgress,
  Divider,
  IconButton,
  List,
  ListItemButton,
  ListItemText,
  Paper,
  Slider,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogContentText,
  DialogActions,
  Button,
  Switch,
  FormControlLabel,
  Tabs,
  Tab,
  TextField,
  MenuItem,
  Chip,
  Alert,
} from "@mui/material";
import { HelpCircle, Layers as Layers3, Box as BoxIcon, Table as TableLucide } from "lucide-react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { useProjectService } from "@/ProjectServiceContext";
import type { Id, Coordinates3dTomogramPoints } from "@/services/ProjectService";
import { MetadataViewer } from "./metadata-viewer";
import ExternalViewersBar from "./ExternalViewersBar";

type Coords3dViewerProps = {
  projectId: Id;
  protocolId: Id;
  outputName: string;
  protocolLabel?: string;
  selectedTomogramId?: Id | null;
  onTomogramSelect?: (tomogram: TomogramItem) => void;
  hideTomogramList?: boolean;
  hideMetadataAction: boolean;
};

type Coords3dPoint = Coordinates3dTomogramPoints["coords"][number];
type Coords3dPointExt = Coords3dPoint & { radius?: number };

type TomogramItem = {
  tomoId: Id;
  label: string;
  name?: string;
  dims?: [number, number, number];
  voxelSize?: [number, number, number];
  nCoords?: number;
  tsId?: Id | null;
};

type ViewMode = "slice" | "map3d" | "metadata";
type SliceAxis = "x" | "y" | "z";
type RightPanelTab = "filters" | "appearance";
type PointColorMode3d = "fixed" | "class" | "score";
type SliceLayoutMode = "single" | "triple";

type SliceCircle = {
  key: string;
  pointId: string;
  sourceIndex: number;
  rawX: number;
  rawY: number;
  rawZ: number;
  x: number;
  y: number;
  radius: number;
  opacity: number;
  strokeWidth: number;
  dz: number;
};

const MAX_POINTS_DEFAULT = 50000;
const NEARBY_SLICE_RANGE = 10;
const MIN_NEARBY_SLICE_FACTOR = 0.25;
const DEBUG_SYNTHETIC_GRID = false;

const SLICE_SLIDER_THROTTLE_MS = 200;

const SLICE_PREVIEW_FORMAT = "webp" as const;

const ORTHO_AXIS_COLORS = {
  x: "#ef4444",
  y: "#22c55e",
  z: "#3b82f6",
} as const;


const POINT_COLOR_PALETTE: { label: string; value: string }[] = [
  { label: "Red", value: "#ef4444" },
  { label: "Green", value: "#22c55e" },
  { label: "Blue", value: "#3b82f6" },
  { label: "Yellow", value: "#eab308" },
  { label: "Cyan", value: "#06b6d4" },
  { label: "Magenta", value: "#ec4899" },
];

const TOMOGRAM_CMAP_OPTIONS = [
  "gray",
  "viridis",
  "magma",
  "plasma",
  "inferno",
  "cividis",
  "turbo",
];

const HELP_TEXT: Record<string, string> = {
  sliceIndex:
    "Select the tomogram slice index along the chosen axis. In 3D map mode, the same indices control the orthogonal cross-section planes.",
  sliceLayout:
    "Choose between a single XY slice or the orthogonal 3-views layout (XY, XZ, YZ).",
  classFilter:
    "Filter coordinates by their assigned class. Use All to show all classes together. Coordinates without class are grouped as unclassified.",
  scoreFilter:
    "Filter coordinates by numeric score/confidence. Points without score remain visible.",
  maxPoints:
    "Limit the number of points sent to the viewer. If more points are available, a strided downsampling is applied to preserve interactivity.",
  brightness:
    "Adjust slice brightness client-side. This only affects the displayed image overlay.",
  contrast:
    "Adjust slice contrast client-side. This only affects the displayed image overlay.",
  tomogramColormap:
    "Colormap used to render the tomogram slice images.",
  pointColor:
    "Choose the fixed color used for coordinate markers. In 3D mode, this applies when 3D color mode is set to Fixed.",
  pointSize:
    "Global size multiplier for coordinate circles in slices and for point sprites in the 3D map.",
  pointColorMode3d:
    "Choose how 3D points are colored: Fixed uses the selected color, Class uses a deterministic class-based palette, and Score maps numeric scores to a gradient.",
  pointOpacity3d:
    "Opacity of point sprites in the 3D map. Lower values help when many points overlap.",
  slicePlanes3d:
    "Show orthogonal slice planes in the 3D map. Their positions are synchronized with the X/Y/Z sliders.",
  slicePlanesOpacity3d:
    "Opacity of the slice planes drawn in the 3D map.",
  showBox3d:
    "Show the tomogram bounding box in the 3D map.",
  showAxes3d:
    "Show X/Y/Z axis guides in the 3D map.",
  syncPick3d:
    "When enabled, clicking a point in the 3D map updates the X/Y/Z slice indices to the selected coordinate.",
  pointSize3d:
    "Base sprite size for points in the 3D map before applying the global point size factor.",
};

function cloneCoordsPoints(points: Coords3dPointExt[]): Coords3dPointExt[] {
  // Ensure we never mutate the original points array
  return points.map((p) => ({ ...(p as any) }));
}

function clampCoord(v: number, dim: number) {
  const hi = Math.max(0, (Number.isFinite(dim) ? dim : 0) - 1);
  if (!Number.isFinite(v)) return 0;
  return Math.max(0, Math.min(hi, v));
}

function getSvgLocalPoint(
  clientX: number,
  clientY: number,
  el: SVGGraphicsElement,
): { x: number; y: number } | null {
  const ctm = el.getScreenCTM();
  if (!ctm) return null;
  const inv = ctm.inverse();
  const p = new DOMPoint(clientX, clientY).matrixTransform(inv);
  if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) return null;
  return { x: p.x, y: p.y };
}

function getSlicePlaneDims(
  dims: [number, number, number] | null,
  axis: SliceAxis,
): [number, number] | null {
  if (!dims) return null;
  const [dimX, dimY, dimZ] = dims;
  if (dimX <= 0 || dimY <= 0 || dimZ <= 0) return null;
  if (axis === "z") return [dimX, dimY];
  if (axis === "x") return [dimY, dimZ];
  return [dimX, dimZ];
}

function computeSlicePointsSvg(
  points: Coords3dPointExt[],
  axis: SliceAxis,
  sliceIndex: number | null,
  dims: [number, number, number] | null,
): SliceCircle[] {
  if (!points.length || sliceIndex == null || !dims) return [];

  const planeDims = getSlicePlaneDims(dims, axis);
  if (!planeDims) return [];

  const [width, height] = planeDims;
  const maxDim = Math.max(width, height);
  const baseR = maxDim > 0 ? Math.max(1, maxDim * 0.003) : 2;

  const radiiRaw = points
    .map((p) => Number((p as any).radius))
    .filter((v) => Number.isFinite(v) && v > 0);

  let minR = 0;
  let maxR = 0;
  if (radiiRaw.length > 0) {
    minR = Math.min(...radiiRaw);
    maxR = Math.max(...radiiRaw);
  }

  const hasVar =
    radiiRaw.length > 0 &&
    maxR > minR &&
    Number.isFinite(maxR) &&
    Number.isFinite(minR);

  const mapRadius = (raw?: number) => {
    if (!hasVar || raw === undefined || !Number.isFinite(raw) || raw <= 0) {
      return baseR;
    }
    const t = (raw - minR) / (maxR - minR);
    const tClamped = Math.max(0, Math.min(1, t));
    return baseR * (0.7 + 1.3 * tClamped);
  };

  const neighbors: SliceCircle[] = [];

  for (let idx = 0; idx < points.length; idx++) {
    const p: any = points[idx];
    const coordVal =
      axis === "x" ? Number(p.x) : axis === "y" ? Number(p.y) : Number(p.z);
    if (!Number.isFinite(coordVal)) continue;

    const coordInt = Math.round(coordVal);
    const dz = Math.abs(coordInt - sliceIndex);
    if (dz > NEARBY_SLICE_RANGE) continue;

    const zNorm = 1 - dz / (NEARBY_SLICE_RANGE + 1);
    const factor =
      MIN_NEARBY_SLICE_FACTOR + zNorm * (1 - MIN_NEARBY_SLICE_FACTOR);

    const rBase = mapRadius(p.radius);
    const rFinal = rBase * factor;
    const opacity = 0.3 + zNorm * 0.7;
    const strokeWidth = 0.6 + zNorm * 1.4;

    let cx = 0;
    let cy = 0;
    if (axis === "z") {
      cx = p.x;
      cy = p.y;
    } else if (axis === "x") {
      cx = p.y;
      cy = p.z;
    } else {
      cx = p.x;
      cy = p.z;
    }

    neighbors.push({
      key: String(p.id ?? `${idx}-${p.x}-${p.y}-${p.z}`),
      pointId: String(p.id ?? idx),
      sourceIndex: idx,
      rawX: Number(p.x),
      rawY: Number(p.y),
      rawZ: Number(p.z),
      x: cx,
      y: cy,
      radius: rFinal,
      opacity,
      strokeWidth,
      dz,
    });
  }

  neighbors.sort((a, b) => b.dz - a.dz);
  return neighbors;
}

export default function Coords3dViewer({
  projectId,
  protocolId,
  outputName,
  selectedTomogramId,
  onTomogramSelect,
  hideTomogramList = false,
  hideMetadataAction = false,
}: Coords3dViewerProps) {
  const svc = useProjectService();

  const projectIdNum = useMemo(() => Number(projectId), [projectId]);
  const protocolIdNum = useMemo(() => Number(protocolId), [protocolId]);

  const canOpenMetadata = useMemo(() => {
    return Number.isFinite(projectIdNum) && Number.isFinite(protocolIdNum);
  }, [projectIdNum, protocolIdNum]);

  const [tomos, setTomos] = useState<TomogramItem[]>([]);
  const [tomosLoading, setTomosLoading] = useState(false);
  const [tomosError, setTomosError] = useState<string | null>(null);
  const [selectedTomoId, setSelectedTomoId] = useState<Id | null>(null);

  const [pointsData, setPointsData] = useState<Coordinates3dTomogramPoints | null>(null);
  const [pointsLoading, setPointsLoading] = useState(false);
  const [pointsError, setPointsError] = useState<string | null>(null);

  const [coordsDraft, setCoordsDraft] = useState<Coords3dPointExt[]>([]);
  const [coordsDirty, setCoordsDirty] = useState<boolean>(false);

  type TomoDraftEntry = {
    tomoId: Id;
    base: Coords3dPointExt[];
    draft: Coords3dPointExt[];
    dirty: boolean;
    scoreRange: [number, number] | null;
  };

  const coordsByTomoRef = useRef<Map<string, TomoDraftEntry>>(new Map());
  const [hasAnyDirty, setHasAnyDirty] = useState<boolean>(false);

  const [saveDialogOpen, setSaveDialogOpen] = useState<boolean>(false);
  const [saveBusy, setSaveBusy] = useState<boolean>(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const [editMode, setEditMode] = useState<boolean>(false);

  const newPointSeqRef = useRef(0);
  const dragRef = useRef<{ pointId: string; axis: "x" | "y" | "z"; pointerId: number } | null>(
    null,
  );

  const [viewMode, setViewMode] = useState<ViewMode>("slice");
  const [sliceLayoutMode, setSliceLayoutMode] = useState<SliceLayoutMode>("single");

  const [maxPoints, setMaxPoints] = useState<number>(MAX_POINTS_DEFAULT);
  const [selectedClass, setSelectedClass] = useState<string>("all");
  const [scoreRange, setScoreRange] = useState<[number, number] | null>(null);

  const [brightness, setBrightness] = useState<number>(1.0);
  const [contrast, setContrast] = useState<number>(1.0);
  const [tomogramColormap, setTomogramColormap] = useState<string>("gray");
  const [debugGrid, setDebugGrid] = useState<boolean>(DEBUG_SYNTHETIC_GRID);

  const [pointColor, setPointColor] = useState<string>("#ef4444");
  const [pointSizeFactor, setPointSizeFactor] = useState<number>(1.0);

  const [pointColorMode3d, setPointColorMode3d] = useState<PointColorMode3d>("class");
  const [pointOpacity3d, setPointOpacity3d] = useState<number>(0.9);
  const [pointSize3d, setPointSize3d] = useState<number>(5.5);
  const [showSlicePlanes3d, setShowSlicePlanes3d] = useState<boolean>(true);
  const [slicePlanesOpacity3d, setSlicePlanesOpacity3d] = useState<number>(0.22);
  const [showBox3d, setShowBox3d] = useState<boolean>(true);
  const [showAxes3d, setShowAxes3d] = useState<boolean>(true);
  const [syncPick3dToSlices, setSyncPick3dToSlices] = useState<boolean>(true);
  const [reset3dCameraNonce, setReset3dCameraNonce] = useState<number>(0);
  const [pickedPoint3d, setPickedPoint3d] = useState<Coords3dPointExt | null>(null);

  const [rightPanelTab, setRightPanelTab] = useState<RightPanelTab>("filters");

  const [helpKey, setHelpKey] = useState<string | null>(null);
  const [helpOpen, setHelpOpen] = useState(false);

  const [sliceIndex, setSliceIndex] = useState<number | null>(null);
  const [sliceImageUrl, setSliceImageUrl] = useState<string | null>(null);
  const [sliceError, setSliceError] = useState<string | null>(null);
  const [sliceLoading, setSliceLoading] = useState(false);
  const sliceAbortRef = useRef<AbortController | null>(null);
  const sliceReqIdRef = useRef(0);

  const [singleViewBox, setSingleViewBox] = useState<{ x: number; y: number; w: number; h: number } | null>(
    null,
  );
  const [isSinglePanning, setIsSinglePanning] = useState<boolean>(false);
  const singlePanRef = useRef<{
    pointerId: number;
    clientX: number;
    clientY: number;
    startViewBox: { x: number; y: number; w: number; h: number };
  } | null>(null);
  const singleSuppressClickRef = useRef<boolean>(false);

  const [sliceIndexX, setSliceIndexX] = useState<number | null>(null);
  const [sliceIndexY, setSliceIndexY] = useState<number | null>(null);

  const [draggingSlice, setDraggingSlice] = useState<null | "z" | "x" | "y">(null);

  const [displayedSliceIndexZ, setDisplayedSliceIndexZ] = useState<number | null>(null);
  const [displayedSliceIndexX, setDisplayedSliceIndexX] = useState<number | null>(null);
  const [displayedSliceIndexY, setDisplayedSliceIndexY] = useState<number | null>(null);

  const [sliceXImageUrl, setSliceXImageUrl] = useState<string | null>(null);
  const [sliceYImageUrl, setSliceYImageUrl] = useState<string | null>(null);
  const [sliceXError, setSliceXError] = useState<string | null>(null);
  const [sliceYError, setSliceYError] = useState<string | null>(null);
  const [sliceXLoading, setSliceXLoading] = useState(false);
  const [sliceYLoading, setSliceYLoading] = useState(false);
  const sliceXAbortRef = useRef<AbortController | null>(null);
  const sliceYAbortRef = useRef<AbortController | null>(null);
  const sliceXReqIdRef = useRef(0);
  const sliceYReqIdRef = useRef(0);

  const throttledSliceIndex = useThrottledValue(sliceIndex, SLICE_SLIDER_THROTTLE_MS);
  const throttledSliceIndexX = useThrottledValue(sliceIndexX, SLICE_SLIDER_THROTTLE_MS);
  const throttledSliceIndexY = useThrottledValue(sliceIndexY, SLICE_SLIDER_THROTTLE_MS);

  const effectiveSliceIndex =
    draggingSlice === "z" ? throttledSliceIndex : sliceIndex;

  const effectiveSliceIndexX =
    draggingSlice === "x" ? throttledSliceIndexX : sliceIndexX;

  const effectiveSliceIndexY =
    draggingSlice === "y" ? throttledSliceIndexY : sliceIndexY;


  const openHelp = (key: string) => {
    setHelpKey(key);
    setHelpOpen(true);
  };

  const computeHasAnyDirty = useCallback(() => {
    // computeHasAnyDirty
    for (const entry of coordsByTomoRef.current.values()) {
      if (entry.dirty) return true;
    }
    return false;
  }, []);

  const persistCurrentTomoDraft = useCallback(() => {
    // persistCurrentTomoDraft
    if (selectedTomoId == null) return;
    const key = String(selectedTomoId);
    const entry = coordsByTomoRef.current.get(key);
    if (!entry) return;

    coordsByTomoRef.current.set(key, {
      ...entry,
      draft: coordsDraft,
      dirty: coordsDirty,
      scoreRange,
    });

    setHasAnyDirty(coordsDirty ? true : computeHasAnyDirty());
  }, [coordsDraft, coordsDirty, computeHasAnyDirty, scoreRange, selectedTomoId]);

  const selectTomogram = useCallback(
    (tomogram: TomogramItem, notify = true) => {
      persistCurrentTomoDraft();
      setSelectedTomoId(tomogram.tomoId);

      if (notify) {
        onTomogramSelect?.(tomogram);
      }
    },
    [persistCurrentTomoDraft, onTomogramSelect],
  );

  const selectedTomoIdRef = useRef<Id | null>(null);
  useEffect(() => {
    // syncSelectedTomoIdRef
    selectedTomoIdRef.current = selectedTomoId;
  }, [selectedTomoId]);

  useEffect(() => {
    // syncDraftIntoCache
    // Important: do not depend on selectedTomoId directly, to avoid overwriting caches during tomogram switches
    // while coordsDraft still belongs to the previous selection.
    const activeTomoId = selectedTomoIdRef.current;
    if (activeTomoId == null) return;

    const key = String(activeTomoId);
    const entry = coordsByTomoRef.current.get(key);
    if (!entry) return;

    coordsByTomoRef.current.set(key, {
      ...entry,
      draft: coordsDraft,
      dirty: coordsDirty,
      scoreRange,
    });

    setHasAnyDirty(coordsDirty ? true : computeHasAnyDirty());
  }, [coordsDraft, coordsDirty, scoreRange, computeHasAnyDirty]);

  useEffect(() => {
    setBrightness(1.0);
    setContrast(1.0);
    setPickedPoint3d(null);
  }, [selectedTomoId, viewMode]);

  useEffect(() => {
    sliceAbortRef.current?.abort();
    sliceXAbortRef.current?.abort();
    sliceYAbortRef.current?.abort();

    setSliceError(null);
    setSliceXError(null);
    setSliceYError(null);

    setSliceLoading(false);
    setSliceXLoading(false);
    setSliceYLoading(false);

    setDraggingSlice(null);
  }, [selectedTomoId]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setTomosLoading(true);
        setTomosError(null);
        setTomos([]);
        setSelectedTomoId(null);
        coordsByTomoRef.current.clear();
        setHasAnyDirty(false);

        const raw = await (svc as any).listCoords3dTomograms(projectId, protocolId, outputName);
        if (cancelled) return;

        const items: TomogramItem[] = (raw || []).map((t: any) => {
          const id = t.tomoId ?? t.id;
          return {
            tomoId: id,
            label: String(t.label ?? id),
            name: t.name,
            dims: t.dims,
            voxelSize: t.voxelSize,
            nCoords: t.nCoords ?? t.n ?? t.count,
            tsId: t.tsId ?? t.tiltSeriesId ?? null,
          };
        });

        setTomos(items);
        if (items.length > 0) setSelectedTomoId(items[0].tomoId);
      } catch (e: any) {
        if (!cancelled) {
          setTomosError(e?.message || "Failed to load tomograms for coordinates");
        }
      } finally {
        if (!cancelled) setTomosLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [projectId, protocolId, outputName, svc]);

  useEffect(() => {
    if (selectedTomogramId == null || tomos.length === 0) return;

    const match = tomos.find((t) => {
      return (
        String(t.tomoId) === String(selectedTomogramId) ||
        String(t.tsId) === String(selectedTomogramId) ||
        String(t.label) === String(selectedTomogramId) ||
        String(t.name) === String(selectedTomogramId)
      );
    });

    if (match && String(match.tomoId) !== String(selectedTomoId)) {
      selectTomogram(match, false);
    }
  }, [selectedTomogramId, tomos, selectedTomoId, selectTomogram]);

  useEffect(() => {
    if (selectedTomoId == null) {
      setPointsData(null);
      setCoordsDraft([]);
      setCoordsDirty(false);
      setPointsError(null);
      return;
    }

    const cacheKey = String(selectedTomoId);
    const cached = coordsByTomoRef.current.get(cacheKey);
    if (cached) {
      setPointsData({ tomoId: cached.tomoId, coords: cached.draft as any });
      setCoordsDraft(cached.draft);
      setCoordsDirty(cached.dirty);
      setScoreRange(cached.scoreRange);
      setSelectedClass("all");
      setPickedPoint3d(null);
      setHasAnyDirty(computeHasAnyDirty());
      return;
    }

    let cancelled = false;
    (async () => {
      try {
        setPointsLoading(true);
        setPointsError(null);
        setPickedPoint3d(null);

        const data = await (svc as any).fetchCoords3dForTomogram(
          projectId,
          protocolId,
          outputName,
          selectedTomoId,
        );

        if (cancelled) return;

        let tomoIdOut: Id = selectedTomoId as Id;
        let rawPoints: any[] = [];

        if (Array.isArray(data)) {
          rawPoints = data;
          if (data.length > 0) {
            const c = (data[0] as any).tomoId;
            if (typeof c === "string" || typeof c === "number") tomoIdOut = c;
          }
        } else if (data && typeof data === "object") {
          const d: any = data;
          const candidate =
            d.tomoId ?? d.tomogramId ?? d.tomo_id ?? d.tomogram_id ?? selectedTomoId;
          if (typeof candidate === "string" || typeof candidate === "number") {
            tomoIdOut = candidate;
          }
          if (Array.isArray(d.coords)) rawPoints = d.coords;
          else if (Array.isArray(d.points)) rawPoints = d.points;
        }

        const coordsNorm = rawPoints
          .map((p: any, idx: number) => {
            const x = Number(p.x ?? p.X);
            const y = Number(p.y ?? p.Y);
            const z = Number(p.z ?? p.Z);
            if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
              return null;
            }

            const scoreVal =
              typeof p.score === "number" && Number.isFinite(p.score)
                ? p.score
                : typeof p.weight === "number" && Number.isFinite(p.weight)
                  ? p.weight
                  : typeof p.prob === "number" && Number.isFinite(p.prob)
                    ? p.prob
                    : undefined;

            const radius =
              typeof p.radius === "number" && Number.isFinite(p.radius)
                ? p.radius
                : undefined;

            return {
              id: p.id ?? idx,
              x,
              y,
              z,
              classId: p.classId ?? p.class ?? p.class_id,
              score: scoreVal,
              radius,
              matrix: p.matrix ?? [],
            } as Coords3dPointExt;
          })
          .filter((p): p is Coords3dPointExt => p !== null);

        const normalized: Coordinates3dTomogramPoints = {
          tomoId: tomoIdOut,
          coords: coordsNorm as any,
        };
        setPointsData(normalized);

        const scores = coordsNorm
          .map((p: any) => p.score)
          .filter((v: any): v is number => typeof v === "number" && Number.isFinite(v));

        const nextScoreRange =
          scores.length > 0
            ? ([Math.min(...scores), Math.max(...scores)] as [number, number])
            : null;

        const entry: TomoDraftEntry = {
          tomoId: tomoIdOut,
          base: cloneCoordsPoints(coordsNorm),
          draft: cloneCoordsPoints(coordsNorm),
          dirty: false,
          scoreRange: nextScoreRange,
        };

        coordsByTomoRef.current.set(cacheKey, entry);

        setCoordsDraft(entry.draft);
        setCoordsDirty(false);
        setScoreRange(nextScoreRange);
        setHasAnyDirty(computeHasAnyDirty());

        setSelectedClass("all");
      } catch (e: any) {
        if (!cancelled) setPointsError(e?.message || "Failed to load coordinates");
      } finally {
        if (!cancelled) setPointsLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [selectedTomoId, projectId, protocolId, outputName, svc, computeHasAnyDirty]);

  useEffect(() => {
    if (selectedTomogramId == null || tomos.length === 0) return;

    const match = tomos.find((t) => String(t.tomoId) === String(selectedTomogramId));
    if (match && String(match.tomoId) !== String(selectedTomoId)) {
      selectTomogram(match, false);
    }
  }, [selectedTomogramId, tomos, selectedTomoId, selectTomogram]);

  const classOptions = useMemo(() => {
    const set = new Set<string>();
    for (const p of (coordsDraft as any[]) || []) {
      const key =
        p?.classId === null || p?.classId === undefined
          ? "unclassified"
          : String(p.classId);
      set.add(key);
    }
    return ["all", ...Array.from(set).sort((a, b) => a.localeCompare(b))];
  }, [coordsDraft]);

  const scoreMinMax = useMemo(() => {
    if (!coordsDraft.length) return null;
    const scores = (coordsDraft as any[])
      .map((p) => p.score)
      .filter((v): v is number => typeof v === "number" && Number.isFinite(v));
    if (scores.length === 0) return null;
    return [Math.min(...scores), Math.max(...scores)] as [number, number];
  }, [coordsDraft]);

  const filteredPoints = useMemo<Coords3dPointExt[]>(() => {
    let pts = coordsDraft;

    if (selectedClass !== "all") {
      pts = pts.filter((p) => {
        const key =
          (p as any).classId === null || (p as any).classId === undefined
            ? "unclassified"
            : String((p as any).classId);
        return key === selectedClass;
      });
    }

    if (scoreRange) {
      const [lo, hi] = scoreRange;
      pts = pts.filter((p: any) => {
        if (typeof p.score !== "number" || !Number.isFinite(p.score)) return true;
        return p.score >= lo && p.score <= hi;
      });
    }

    if (maxPoints <= 0 || pts.length <= maxPoints) return pts;

    const step = Math.ceil(pts.length / maxPoints);
    const out: Coords3dPointExt[] = [];
    for (let i = 0; i < pts.length; i += step) out.push(pts[i]);
    return out;
  }, [coordsDraft, selectedClass, scoreRange, maxPoints]);

  const tomoMeta = useMemo(() => {
    if (!selectedTomoId) return null;
    return tomos.find((t) => String(t.tomoId) === String(selectedTomoId)) || null;
  }, [tomos, selectedTomoId]);

  const tomoDims = useMemo<[number, number, number] | null>(() => {
    const t = tomos.find((tt) => String(tt.tomoId) === String(selectedTomoId));
    if (t?.dims && Array.isArray(t.dims) && t.dims.length >= 3) {
      const x = Number(t.dims[0]) || 0;
      const y = Number(t.dims[1]) || 0;
      const z = Number(t.dims[2]) || 0;
      if (x > 0 && y > 0 && z > 0) return [x, y, z];
    }
    return null;
  }, [tomos, selectedTomoId]);

  const tomoDimsX = tomoDims ? tomoDims[0] : null;
  const tomoDimsY = tomoDims ? tomoDims[1] : null;
  const tomoDimsZ = tomoDims ? tomoDims[2] : null;

  const coordsReadyForSelectedTomo = useMemo(() => {
    if (!pointsData || selectedTomoId == null) return false;
    if (pointsData.tomoId == null) return true;
    return String(pointsData.tomoId) === String(selectedTomoId);
  }, [pointsData, selectedTomoId]);

  const tripleSliceGridFractions = useMemo(() => {
    if (!tomoDims) return null;

    const [dimX, dimY, dimZ] = tomoDims;

    const safeX = Math.max(1, Number(dimX) || 1);
    const safeY = Math.max(1, Number(dimY) || 1);
    const safeZ = Math.max(1, Number(dimZ) || 1);

    return {
      leftCol: safeX,
      rightCol: safeZ,
      topRow: safeZ,
      bottomRow: safeY,
    };
  }, [tomoDims]);

  const maxSliceZ = useMemo(() => {
    if (tomoDimsZ == null) return null;
    const zInt = Math.floor(Number(tomoDimsZ));
    if (!Number.isFinite(zInt) || zInt <= 0) return null;
    return Math.max(0, zInt - 1);
  }, [tomoDimsZ]);

  const maxSliceX = useMemo(() => {
    if (tomoDimsX == null) return null;
    const xInt = Math.floor(Number(tomoDimsX));
    if (!Number.isFinite(xInt) || xInt <= 0) return null;
    return Math.max(0, xInt - 1);
  }, [tomoDimsX]);

  const maxSliceY = useMemo(() => {
    if (tomoDimsY == null) return null;
    const yInt = Math.floor(Number(tomoDimsY));
    if (!Number.isFinite(yInt) || yInt <= 0) return null;
    return Math.max(0, yInt - 1);
  }, [tomoDimsY]);

  useEffect(() => {
    if (!coordsReadyForSelectedTomo) return;

    if (maxSliceZ == null) {
      setSliceIndex(null);
      return;
    }

    setSliceIndex(Math.round(maxSliceZ / 2));
  }, [coordsReadyForSelectedTomo, maxSliceZ]);

  useEffect(() => {
    if (!coordsReadyForSelectedTomo) return;

    if (maxSliceX == null) {
      setSliceIndexX(null);
      return;
    }

    setSliceIndexX(Math.round(maxSliceX / 2));
  }, [coordsReadyForSelectedTomo, maxSliceX]);

  useEffect(() => {
    if (!coordsReadyForSelectedTomo) return;

    if (maxSliceY == null) {
      setSliceIndexY(null);
      return;
    }

    setSliceIndexY(Math.round(maxSliceY / 2));
  }, [coordsReadyForSelectedTomo, maxSliceY]);

  useEffect(() => {
    if (!tomoDims) {
      setSingleViewBox(null);
      return;
    }

    // initSingleViewBoxToFullExtent
    setSingleViewBox((prev) => {
      const full = { x: 0, y: 0, w: tomoDims[0], h: tomoDims[1] };
      if (!prev) return full;

      const w = clampFloatNum(prev.w, 20, full.w);
      const h = clampFloatNum(prev.h, 20, full.h);
      const x = clampFloatNum(prev.x, 0, Math.max(0, full.w - w));
      const y = clampFloatNum(prev.y, 0, Math.max(0, full.h - h));
      return { x, y, w, h };
    });
  }, [tomoDims]);

  const slicePoints = useMemo(() => {
    if (!filteredPoints.length || sliceIndex == null) return [];
    const target = sliceIndex;
    return filteredPoints.filter((p: any) => {
      if (typeof p.z !== "number" || !Number.isFinite(p.z)) return false;
      return Math.round(p.z) === target;
    });
  }, [filteredPoints, sliceIndex]);

  const overlaySliceIndexZ = sliceImageUrl ? displayedSliceIndexZ : sliceIndex;
  const overlaySliceIndexX = sliceXImageUrl ? displayedSliceIndexX : sliceIndexX;
  const overlaySliceIndexY = sliceYImageUrl ? displayedSliceIndexY : sliceIndexY;

  const slicePointsSvgZ = useMemo(
    () => computeSlicePointsSvg(filteredPoints, "z", overlaySliceIndexZ, tomoDims),
    [filteredPoints, overlaySliceIndexZ, tomoDims],
  );

  const slicePointsSvgX = useMemo(
    () => computeSlicePointsSvg(filteredPoints, "x", overlaySliceIndexX, tomoDims),
    [filteredPoints, overlaySliceIndexX, tomoDims],
  );

  const slicePointsSvgY = useMemo(
    () => computeSlicePointsSvg(filteredPoints, "y", overlaySliceIndexY, tomoDims),
    [filteredPoints, overlaySliceIndexY, tomoDims],
  );

  const totalCoords = coordsDraft.length;



  const effectiveTomoId: Id | null = useMemo(() => {
    if (
      selectedTomoId !== undefined &&
      selectedTomoId !== null &&
      (typeof selectedTomoId === "string" || typeof selectedTomoId === "number")
    ) {
      return selectedTomoId as Id;
    }
    return null;
  }, [selectedTomoId]);

  const canShowExternalViewers = Boolean(
    effectiveTomoId != null &&
    selectedTomoId != null &&
    tomoMeta != null &&
    tomoDims != null &&
    pointsData != null &&
    coordsReadyForSelectedTomo &&
    !tomosLoading &&
    !pointsLoading &&
    !tomosError &&
    !pointsError,
  );

  const buildSliceFetchOptions = useCallback(
    (axis: SliceAxis, _isDragging: boolean, signal: AbortSignal) => ({
      axis,
      cmap: tomogramColormap,
      format: SLICE_PREVIEW_FORMAT,
      normalize: "minmax",
      scale: 1,
      signal,
    }),
    [tomogramColormap],
  );

  useEffect(() => {
    const needZSlice = viewMode === "slice" || viewMode === "map3d";
    const shouldSkipForDebug = viewMode === "slice" && debugGrid;

    if (!needZSlice || shouldSkipForDebug) {
      sliceAbortRef.current?.abort();
      setSliceLoading(false);
      return;
    }

    if (
      !pointsData ||
      !coordsReadyForSelectedTomo ||
      effectiveTomoId == null ||
      effectiveSliceIndex == null ||
      maxSliceZ == null ||
      maxSliceZ < 0
    ) {
      setSliceError(null);
      setSliceLoading(false);
      return;
    }

    const clamped = Math.max(0, Math.min(effectiveSliceIndex, maxSliceZ));

    sliceAbortRef.current?.abort();
    const controller = new AbortController();
    sliceAbortRef.current = controller;
    const reqId = ++sliceReqIdRef.current;

    (async () => {
      try {
        setSliceLoading(true);
        setSliceError(null);

        const result = await (svc as any).fetchCoords3dTomogramSliceObjectUrl(
          projectId,
          protocolId,
          outputName,
          effectiveTomoId,
          clamped,
          buildSliceFetchOptions("z", draggingSlice === "z", controller.signal),
        );

        if (controller.signal.aborted || sliceReqIdRef.current !== reqId) {
          if (result?.revoke) {
            try {
              result.revoke();
            } catch {
              // ignore
            }
          }
          return;
        }

        const nextUrl = result?.url ?? null;
        setSliceImageUrl(nextUrl);
        if (nextUrl) {
          setDisplayedSliceIndexZ(clamped);
        }
      } catch (e: any) {
        if (controller.signal.aborted || sliceReqIdRef.current !== reqId) return;
        setSliceError(e?.message || "Failed to load tomogram slice");
      } finally {
        if (sliceReqIdRef.current === reqId) setSliceLoading(false);
      }
    })();

    return () => {
      controller.abort();
    };
  }, [
    viewMode,
    debugGrid,
    pointsData,
    coordsReadyForSelectedTomo,
    effectiveTomoId,
    effectiveSliceIndex,
    draggingSlice,
    buildSliceFetchOptions,
    maxSliceZ,
    projectId,
    protocolId,
    outputName,
    svc,
  ]);

  useEffect(() => {
    const needXSlice =
      viewMode === "map3d" || (viewMode === "slice" && sliceLayoutMode === "triple");
    const shouldSkipForDebug = viewMode === "slice" && debugGrid;

    if (!needXSlice || shouldSkipForDebug) {
      sliceXAbortRef.current?.abort();
      setSliceXLoading(false);
      return;
    }

    if (
      !pointsData ||
      !coordsReadyForSelectedTomo ||
      effectiveTomoId == null ||
      effectiveSliceIndexX == null ||
      maxSliceX == null ||
      maxSliceX < 0
    ) {
      setSliceXError(null);
      setSliceXLoading(false);
      return;
    }

    const clamped = Math.max(0, Math.min(effectiveSliceIndexX, maxSliceX));

    sliceXAbortRef.current?.abort();
    const controller = new AbortController();
    sliceXAbortRef.current = controller;
    const reqId = ++sliceXReqIdRef.current;

    (async () => {
      try {
        setSliceXLoading(true);
        setSliceXError(null);

        const result = await (svc as any).fetchCoords3dTomogramSliceObjectUrl(
          projectId,
          protocolId,
          outputName,
          effectiveTomoId,
          clamped,
          buildSliceFetchOptions("x", draggingSlice === "x", controller.signal),
        );

        if (controller.signal.aborted || sliceXReqIdRef.current !== reqId) {
          if (result?.revoke) {
            try {
              result.revoke();
            } catch {
              // ignore
            }
          }
          return;
        }

        const nextUrl = result?.url ?? null;
        setSliceXImageUrl(nextUrl);
        if (nextUrl) {
          setDisplayedSliceIndexX(clamped);
        }
      } catch (e: any) {
        if (controller.signal.aborted || sliceXReqIdRef.current !== reqId) return;
        setSliceXError(e?.message || "Failed to load tomogram slice (X)");
      } finally {
        if (sliceXReqIdRef.current === reqId) setSliceXLoading(false);
      }
    })();

    return () => {
      controller.abort();
    };
  }, [
    viewMode,
    sliceLayoutMode,
    debugGrid,
    pointsData,
    coordsReadyForSelectedTomo,
    effectiveTomoId,
    effectiveSliceIndexX,
    draggingSlice,
    buildSliceFetchOptions,
    maxSliceX,
    projectId,
    protocolId,
    outputName,
    svc,
  ]);

  useEffect(() => {
    const needYSlice =
      viewMode === "map3d" || (viewMode === "slice" && sliceLayoutMode === "triple");
    const shouldSkipForDebug = viewMode === "slice" && debugGrid;

    if (!needYSlice || shouldSkipForDebug) {
      sliceYAbortRef.current?.abort();
      setSliceYLoading(false);
      return;
    }

    if (
      !pointsData ||
      !coordsReadyForSelectedTomo ||
      effectiveTomoId == null ||
      effectiveSliceIndexY == null ||
      maxSliceY == null ||
      maxSliceY < 0
    ) {
      setSliceYError(null);
      setSliceYLoading(false);
      return;
    }

    const clamped = Math.max(0, Math.min(effectiveSliceIndexY, maxSliceY));

    sliceYAbortRef.current?.abort();
    const controller = new AbortController();
    sliceYAbortRef.current = controller;
    const reqId = ++sliceYReqIdRef.current;

    (async () => {
      try {
        setSliceYLoading(true);
        setSliceYError(null);

        const result = await (svc as any).fetchCoords3dTomogramSliceObjectUrl(
          projectId,
          protocolId,
          outputName,
          effectiveTomoId,
          clamped,
          buildSliceFetchOptions("y", draggingSlice === "y", controller.signal),
        );

        if (controller.signal.aborted || sliceYReqIdRef.current !== reqId) {
          if (result?.revoke) {
            try {
              result.revoke();
            } catch {
              // ignore
            }
          }
          return;
        }

        const nextUrl = result?.url ?? null;
        setSliceYImageUrl(nextUrl);
        if (nextUrl) {
          setDisplayedSliceIndexY(clamped);
        }
      } catch (e: any) {
        if (controller.signal.aborted || sliceYReqIdRef.current !== reqId) return;
        setSliceYError(e?.message || "Failed to load tomogram slice (Y)");
      } finally {
        if (sliceYReqIdRef.current === reqId) setSliceYLoading(false);
      }
    })();

    return () => {
      controller.abort();
    };
  }, [
    viewMode,
    sliceLayoutMode,
    debugGrid,
    pointsData,
    coordsReadyForSelectedTomo,
    effectiveTomoId,
    effectiveSliceIndexY,
    draggingSlice,
    buildSliceFetchOptions, ,
    maxSliceY,
    projectId,
    protocolId,
    outputName,
    svc,
  ]);

  const hotkeyScopeRef = useRef<HTMLDivElement | null>(null);
  const singleSvgRef = useRef<SVGSVGElement | null>(null);
  const lastViewerInteractAtRef = useRef<number>(0);

  const markViewerActive = useCallback(() => {
    lastViewerInteractAtRef.current = Date.now();
    const el = hotkeyScopeRef.current;
    if (!el) return;
    try {
      el.focus({ preventScroll: true } as any);
    } catch {
      try {
        el.focus();
      } catch {
        // ignore
      }
    }
  }, []);

  const handlePickPoint3d = useCallback(
    (
      p: Coords3dPointExt | null,
      mappedSliceIndices?: { x: number; y: number; z: number },
    ) => {
      markViewerActive();
      setPickedPoint3d(p);
      if (!p || !syncPick3dToSlices) return;

      const targetZ = mappedSliceIndices?.z ?? Math.round(Number((p as any).z));
      const targetX = mappedSliceIndices?.x ?? Math.round(Number((p as any).x));
      const targetY = mappedSliceIndices?.y ?? Math.round(Number((p as any).y));

      if (maxSliceZ != null) {
        setSliceIndex(clampInt(targetZ, 0, maxSliceZ));
      }
      if (maxSliceX != null) {
        setSliceIndexX(clampInt(targetX, 0, maxSliceX));
      }
      if (maxSliceY != null) {
        setSliceIndexY(clampInt(targetY, 0, maxSliceY));
      }
    },
    [markViewerActive, syncPick3dToSlices, maxSliceX, maxSliceY, maxSliceZ],
  );

  const showXAxisSlider =
    viewMode === "map3d" || (viewMode === "slice" && sliceLayoutMode === "triple");
  const showYAxisSlider =
    viewMode === "map3d" || (viewMode === "slice" && sliceLayoutMode === "triple");

  const hasVisibleViewerContent =
    viewMode === "map3d"
      ? pointsData != null && coordsDraft.length > 0
      : viewMode === "slice" &&
      !debugGrid &&
      (
        (sliceLayoutMode === "single" && !!sliceImageUrl) ||
        (sliceLayoutMode === "triple" && (!!sliceImageUrl || !!sliceXImageUrl || !!sliceYImageUrl))
      );

  const [delayedPointsLoading, setDelayedPointsLoading] = useState(false);

  useEffect(() => {
    if (!pointsLoading) {
      setDelayedPointsLoading(false);
      return;
    }

    if (!hasVisibleViewerContent) {
      setDelayedPointsLoading(true);
      return;
    }

    const timer = window.setTimeout(() => {
      setDelayedPointsLoading(true);
    }, 180);

    return () => {
      window.clearTimeout(timer);
    };
  }, [pointsLoading, hasVisibleViewerContent]);

  const viewerLoadingVisible =
    pointsLoading && (!hasVisibleViewerContent || delayedPointsLoading);

  const pickedPointKey = useMemo(() => {
    const id = (pickedPoint3d as any)?.id;
    return id == null ? null : String(id);
  }, [pickedPoint3d]);

  const createNewPointId = () => {
    newPointSeqRef.current += 1;
    return `new-${Date.now()}-${newPointSeqRef.current}`;
  };

  const buildSavePayload = useCallback(() => {
    // buildSavePayload
    persistCurrentTomoDraft();

    const tomograms: Array<{ tomoId: Id; coords: any[] }> = [];
    for (const entry of coordsByTomoRef.current.values()) {
      if (!entry.dirty) continue;

      const coords = entry.draft.map((p: any) => ({
        id: p?.id,
        x: Number(p?.x),
        y: Number(p?.y),
        z: Number(p?.z),
        score:
          typeof p?.score === "number" && Number.isFinite(p.score) ? p.score : undefined,
        radius:
          typeof p?.radius === "number" && Number.isFinite(p.radius) ? p.radius : undefined,
        classId: p?.classId,
        tomoId: entry.tomoId,
        matrix: p?.matrix,
      }));

      tomograms.push({ tomoId: entry.tomoId, coords });
    }

    return { tomograms };
  }, [persistCurrentTomoDraft]);

  const openSaveDialog = useCallback(() => {
    // openSaveDialog
    if (!hasAnyDirty || saveBusy) return;
    setSaveError(null);
    setSaveDialogOpen(true);
  }, [hasAnyDirty, saveBusy]);

  const restoreOriginalCoords = useCallback(() => {
    // restoreOriginalCoords
    if (selectedTomoId == null) return;
    const key = String(selectedTomoId);
    const entry = coordsByTomoRef.current.get(key);
    if (!entry) return;

    const snap = cloneCoordsPoints(entry.base);
    coordsByTomoRef.current.set(key, { ...entry, draft: snap, dirty: false });

    setCoordsDraft(snap);
    setCoordsDirty(false);
    setPickedPoint3d(null);

    setHasAnyDirty(computeHasAnyDirty());
  }, [computeHasAnyDirty, selectedTomoId]);

  const saveChanges = useCallback(async () => {
    const payload = buildSavePayload();
    if (!payload.tomograms.length) {
      setSaveDialogOpen(false);
      setHasAnyDirty(false);
      return;
    }

    setSaveBusy(true);
    setSaveError(null);

    try {
      await svc.createCoords3dOutputFromPoints(projectId, protocolId, outputName, payload);

      for (const entry of coordsByTomoRef.current.values()) {
        if (!entry.dirty) continue;
        entry.base = cloneCoordsPoints(entry.draft);
        entry.dirty = false;
      }

      setCoordsDirty(false);
      setHasAnyDirty(false);
      setSaveDialogOpen(false);
      toast.success("The new output has been created successfully.");
    } catch (e: any) {
      setSaveError(e?.message || "Failed to save changes.");
    } finally {
      setSaveBusy(false);
    }
  }, [buildSavePayload, outputName, projectId, protocolId, svc]);

  const removePointById = useCallback((pointId: string) => {
    setCoordsDraft((prev) => prev.filter((p: any) => String(p?.id) !== String(pointId)));
    setCoordsDirty(true);
    setPickedPoint3d((prev) => {
      if (!prev) return prev;
      return String((prev as any).id) === String(pointId) ? null : prev;
    });
  }, []);

  useEffect(() => {
    const isEditableTarget = (el: HTMLElement | null) => {
      if (!el) return false;
      const tag = el.tagName?.toUpperCase?.() ?? "";
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
      return Boolean((el as any).isContentEditable);
    };

    const isActionKey = (key: string) => {
      return (
        key === "Delete" ||
        key === "Backspace" ||
        key === " " ||
        key === "Space" ||
        key === "Spacebar"
      );
    };

    const swallowEvent = (ev: KeyboardEvent) => {
      // keepHotkeysInsideViewer
      ev.preventDefault();
      ev.stopPropagation();
      ev.stopImmediatePropagation();
    };

    const onKeyDownCapture = (ev: KeyboardEvent) => {
      if (!isHotkeyWindowActive(hotkeyScopeRef.current, lastViewerInteractAtRef.current, document.activeElement as HTMLElement | null)) return;
      if (!isActionKey(ev.key)) return;

      const active = document.activeElement as HTMLElement | null;
      if (isEditableTarget(active)) return;

      swallowEvent(ev);

      if (!pickedPoint3d) return;
      removePointById(String((pickedPoint3d as any).id));
      markViewerActive();
    };

    const onKeyUpCapture = (ev: KeyboardEvent) => {
      if (!isHotkeyWindowActive(hotkeyScopeRef.current, lastViewerInteractAtRef.current, document.activeElement as HTMLElement | null)) return;
      if (!isActionKey(ev.key)) return;

      const active = document.activeElement as HTMLElement | null;
      if (isEditableTarget(active)) return;

      swallowEvent(ev);
      markViewerActive();
    };

    window.addEventListener("keydown", onKeyDownCapture, true);
    window.addEventListener("keyup", onKeyUpCapture, true);

    return () => {
      window.removeEventListener("keydown", onKeyDownCapture, true);
      window.removeEventListener("keyup", onKeyUpCapture, true);
    };
  }, [pickedPoint3d, removePointById, markViewerActive]);

  const addPointFromSlice = useCallback(
    (axis: "x" | "y" | "z", localX: number, localY: number) => {
      if (!editMode) return;
      if (!tomoDims) return;

      const [dimX, dimY, dimZ] = tomoDims;

      const id = createNewPointId();

      let x = 0;
      let y = 0;
      let z = 0;

      if (axis === "z") {
        if (sliceIndex == null) return;
        x = clampCoord(localX, dimX);
        y = clampCoord(localY, dimY);
        z = clampCoord(sliceIndex, dimZ);
      } else if (axis === "y") {
        if (sliceIndexY == null) return;
        x = clampCoord(localX, dimX);
        y = clampCoord(sliceIndexY, dimY);
        z = clampCoord(localY, dimZ);
      } else {
        if (sliceIndexX == null) return;
        x = clampCoord(sliceIndexX, dimX);
        y = clampCoord(localX, dimY);
        z = clampCoord(localY, dimZ);
      }

      const nextClassId =
        selectedClass === "all" || selectedClass === "unclassified" ? undefined : selectedClass;

      const newPoint: Coords3dPointExt = {
        id,
        x,
        y,
        z,
        classId: nextClassId,
      } as any;

      setCoordsDraft((prev) => [...prev, newPoint]);
      setCoordsDirty(true);
      handlePickPoint3d(newPoint, { x: Math.round(x), y: Math.round(y), z: Math.round(z) });
    },
    [editMode, tomoDims, sliceIndex, sliceIndexX, sliceIndexY, selectedClass, handlePickPoint3d],
  );

  const updatePointFromSlice = useCallback(
    (pointId: string, axis: "x" | "y" | "z", localX: number, localY: number) => {
      if (!editMode) return;
      if (!tomoDims) return;

      const [dimX, dimY, dimZ] = tomoDims;

      let patch: Partial<Coords3dPointExt> | null = null;

      if (axis === "z") {
        if (sliceIndex == null) return;
        patch = {
          x: clampCoord(localX, dimX),
          y: clampCoord(localY, dimY),
          z: clampCoord(sliceIndex, dimZ),
        };
      } else if (axis === "y") {
        if (sliceIndexY == null) return;
        patch = {
          x: clampCoord(localX, dimX),
          y: clampCoord(sliceIndexY, dimY),
          z: clampCoord(localY, dimZ),
        };
      } else {
        if (sliceIndexX == null) return;
        patch = {
          x: clampCoord(sliceIndexX, dimX),
          y: clampCoord(localX, dimY),
          z: clampCoord(localY, dimZ),
        };
      }

      if (!patch) return;

      setCoordsDraft((prev) =>
        prev.map((p: any) => (String(p?.id) === String(pointId) ? { ...p, ...patch } : p)),
      );
      setCoordsDirty(true);

      setPickedPoint3d((prev) => {
        if (!prev) return prev;
        if (String((prev as any).id) !== String(pointId)) return prev;
        return { ...(prev as any), ...patch } as any;
      });
    },
    [editMode, tomoDims, sliceIndex, sliceIndexX, sliceIndexY],
  );

  const handleSliceCirclePick = useCallback(
    (circle: SliceCircle) => {
      markViewerActive();
      const hit = filteredPoints.find((pt: any) => String(pt?.id) === String(circle.pointId));
      if (!hit) return;

      handlePickPoint3d(hit, {
        x: Math.round(Number((hit as any).x)),
        y: Math.round(Number((hit as any).y)),
        z: Math.round(Number((hit as any).z)),
      });
    },
    [filteredPoints, handlePickPoint3d, markViewerActive],
  );

  const clampSingleViewBox = useCallback(
    (vb: { x: number; y: number; w: number; h: number }) => {
      if (!tomoDims) return vb;
      const fullW = tomoDims[0];
      const fullH = tomoDims[1];

      const minSize = 20;
      const w = clampFloatNum(vb.w, minSize, fullW);
      const h = clampFloatNum(vb.h, minSize, fullH);

      const x = clampFloatNum(vb.x, 0, Math.max(0, fullW - w));
      const y = clampFloatNum(vb.y, 0, Math.max(0, fullH - h));
      return { x, y, w, h };
    },
    [tomoDims],
  );

  const handleSingleSliceWheel = useCallback(
    (e: React.WheelEvent<SVGSVGElement>) => {
      markViewerActive();
      if (!singleViewBox || !tomoDims) return;

      // preventPageScrollWhileZooming
      e.preventDefault();
      e.stopPropagation();

      const local = getSvgLocalPoint(e.clientX, e.clientY, e.currentTarget as any);
      if (!local) return;

      const zoomIntensity = 0.0015;
      const delta = e.deltaY;
      const factor = Math.exp(delta * zoomIntensity);

      const newW = singleViewBox.w * factor;
      const newH = singleViewBox.h * factor;

      const tx = (local.x - singleViewBox.x) / Math.max(1e-6, singleViewBox.w);
      const ty = (local.y - singleViewBox.y) / Math.max(1e-6, singleViewBox.h);

      const next = clampSingleViewBox({
        x: local.x - tx * newW,
        y: local.y - ty * newH,
        w: newW,
        h: newH,
      });

      setSingleViewBox(next);
    },
    [markViewerActive, singleViewBox, tomoDims, clampSingleViewBox],
  );

  const handleSingleSliceDoubleClick = useCallback((e?: React.MouseEvent<SVGSVGElement>) => {
    e?.preventDefault();
    e?.stopPropagation();
    markViewerActive();
    if (!tomoDimsX || !tomoDimsY) return;

    singlePanRef.current = null;
    setIsSinglePanning(false);

    setSingleViewBox(
      clampSingleViewBox({
        x: 0,
        y: 0,
        w: tomoDimsX,
        h: tomoDimsY,
      }),
    );

    singleSuppressClickRef.current = true;
    window.setTimeout(() => {
      singleSuppressClickRef.current = false;
    }, 0);
  }, [markViewerActive, tomoDimsX, tomoDimsY, clampSingleViewBox]);

  const handleSingleSlicePointerDown = useCallback(
    (e: React.PointerEvent<SVGSVGElement>) => {
      markViewerActive();
      if (!singleViewBox) return;

      const isLeft = e.button === 0;
      const isRight = e.button === 2;
      const isMiddle = e.button === 1;
      const panAllowed = editMode ? isRight || isMiddle : isLeft || isRight || isMiddle;
      if (!panAllowed) {
        // preventReactFlowNodeSelectionOnSimpleClicks
        e.stopPropagation();
        return;
      }

      // preventContextMenuAndDragConflicts
      e.preventDefault();
      e.stopPropagation();

      singleSuppressClickRef.current = false;
      singlePanRef.current = {
        pointerId: e.pointerId,
        clientX: e.clientX,
        clientY: e.clientY,
        startViewBox: singleViewBox,
      };

      setIsSinglePanning(true);

      try {
        (e.currentTarget as any).setPointerCapture?.(e.pointerId);
      } catch {
        // ignore
      }
    },
    [markViewerActive, singleViewBox, editMode],
  );

  const handleSingleSlicePointerMove = useCallback(
    (e: React.PointerEvent<SVGSVGElement>) => {
      const pan = singlePanRef.current;
      if (!pan || pan.pointerId !== e.pointerId) return;

      const localStart = getSvgLocalPoint(pan.clientX, pan.clientY, e.currentTarget as any);
      const localNow = getSvgLocalPoint(e.clientX, e.clientY, e.currentTarget as any);
      if (!localStart || !localNow) return;

      const dx = localNow.x - localStart.x;
      const dy = localNow.y - localStart.y;

      const movedClient =
        Math.abs(e.clientX - pan.clientX) + Math.abs(e.clientY - pan.clientY);
      if (movedClient > 3) singleSuppressClickRef.current = true;

      const next = clampSingleViewBox({
        x: pan.startViewBox.x - dx,
        y: pan.startViewBox.y - dy,
        w: pan.startViewBox.w,
        h: pan.startViewBox.h,
      });

      setSingleViewBox(next);
    },
    [clampSingleViewBox],
  );

  const handleSingleSlicePointerUp = useCallback((e: React.PointerEvent<SVGSVGElement>) => {
    const pan = singlePanRef.current;
    if (!pan || pan.pointerId !== e.pointerId) return;

    singlePanRef.current = null;
    setIsSinglePanning(false);

    try {
      (e.currentTarget as any).releasePointerCapture?.(e.pointerId);
    } catch {
      // ignore
    }

    // releaseSuppressFlagSoon
    window.setTimeout(() => {
      singleSuppressClickRef.current = false;
    }, 0);
  }, []);

  const handleSingleSliceContextMenu = useCallback((e: React.MouseEvent<SVGSVGElement>) => {
    if (!editMode && !singlePanRef.current) return;
    e.preventDefault();
    e.stopPropagation();
  }, [editMode]);

  const onPointPointerDown = useCallback(
    (circle: SliceCircle, axis: "x" | "y" | "z") =>
      (e: React.PointerEvent<SVGCircleElement>) => {
        e.stopPropagation();
        if (!editMode) return;

        try {
          (e.currentTarget as any).setPointerCapture?.(e.pointerId);
        } catch {
          // ignore
        }

        dragRef.current = {
          pointId: circle.pointId,
          axis,
          pointerId: e.pointerId,
        };
      },
    [editMode],
  );

  const onPointPointerMove = useCallback(
    (e: React.PointerEvent<SVGCircleElement>) => {
      const drag = dragRef.current;
      if (!drag) return;
      if (drag.pointerId !== e.pointerId) return;

      const local = getSvgLocalPoint(e.clientX, e.clientY, e.currentTarget as any);
      if (!local) return;

      updatePointFromSlice(drag.pointId, drag.axis, local.x, local.y);
    },
    [updatePointFromSlice],
  );

  const onPointPointerUp = useCallback((e: React.PointerEvent<SVGCircleElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    if (drag.pointerId !== e.pointerId) return;

    dragRef.current = null;

    try {
      (e.currentTarget as any).releasePointerCapture?.(e.pointerId);
    } catch {
      // ignore
    }
  }, []);

  return (
    <>
      <Box
        ref={hotkeyScopeRef}
        tabIndex={0}
        onPointerDownCapture={() => markViewerActive()}
        sx={{
          display: "flex",
          height: "100%",
          width: "100%",
          minHeight: 0,
          minWidth: 0,
          overflow: "hidden",
        }}
      >
        <Box
          sx={{
            width: 270,
            borderRight: "1px solid #e5e7eb",
            display: hideTomogramList ? "none" : "flex",
            flexDirection: "column",
            minHeight: 0,
            overflow: "hidden",
            bgcolor: "background.paper",
          }}
        >
          <Box sx={{ p: 1.5, flexShrink: 0 }}>
            <Typography variant="subtitle2">Tomograms</Typography>
            <Typography variant="caption" color="text.secondary">
              {tomosLoading ? "" : `${tomos.length} item(s)`}
            </Typography>
          </Box>
          <Divider />
          <Box sx={{ flex: 1, minHeight: 0, overflow: "auto" }}>
            {tomosLoading ? (
              <Box sx={{ p: 2, display: "flex", gap: 1, alignItems: "center" }}>
                <CircularProgress size={18} />
                <Typography variant="body2">Loading tomograms…</Typography>
              </Box>
            ) : tomosError ? (
              <Box sx={{ p: 2 }}>
                <Typography variant="body2" color="error">
                  {tomosError}
                </Typography>
              </Box>
            ) : tomos.length === 0 ? (
              <Box sx={{ p: 2 }}>
                <Typography variant="body2" color="text.secondary">
                  No tomograms for this coordinates set.
                </Typography>
              </Box>
            ) : (
              <List dense disablePadding>
                {tomos.map((t) => {
                  const selected =
                    selectedTomoId != null && String(selectedTomoId) === String(t.tomoId);
                  const isDirty = Boolean(coordsByTomoRef.current.get(String(t.tomoId))?.dirty);
                  return (
                    <ListItemButton
                      key={String(t.tomoId)}
                      selected={selected}
                      onClick={() => selectTomogram(t)}
                      sx={{ px: 1.5, py: 1 }}
                    >
                      <ListItemText
                        primaryTypographyProps={{ variant: "body2", noWrap: true }}
                        secondaryTypographyProps={{
                          variant: "caption",
                          color: "text.secondary",
                          noWrap: true,
                        }}
                        primary={t.label}

                      />
                    </ListItemButton>
                  );
                })}
              </List>
            )}
          </Box>
        </Box>

        <Box
          sx={{
            flex: 1,
            display: "flex",
            flexDirection: "column",
            minWidth: 0,
            minHeight: 0,
            overflow: "hidden",
          }}
        >
          <Paper
            elevation={0}
            square
            sx={{ p: 0.75, borderBottom: "1px solid #e5e7eb", flexShrink: 0 }}
          >
            <Box
              sx={{
                display: "grid",
                gridTemplateColumns: "1fr auto",
                alignItems: "center",
                columnGap: 1.5,
                rowGap: 0.75,
              }}
            >
              <Box sx={{ display: "flex", alignItems: "center", gap: 1, flexWrap: "wrap" }}>
                <ToggleButtonGroup
                  size="small"
                  exclusive
                  value={viewMode}
                  onChange={(_, v) => v && setViewMode(v)}
                >
                  <ToggleButton value="slice">
                    <Box sx={{ display: "inline-flex", alignItems: "center", gap: 0.5 }}>
                      <Layers3 size={14} />
                      Slices
                    </Box>
                  </ToggleButton>
                  <ToggleButton value="map3d">
                    <Box sx={{ display: "inline-flex", alignItems: "center", gap: 0.5 }}>
                      <BoxIcon size={14} />
                      3D Map
                    </Box>
                  </ToggleButton>

                  {!hideMetadataAction ? (
                    <ToggleButton value="metadata" disabled={!canOpenMetadata}>
                      <Box sx={{ display: "inline-flex", alignItems: "center", gap: 0.5 }}>
                        <TableLucide size={14} />
                        Metadata
                      </Box>
                    </ToggleButton>
                  ) : null}
                </ToggleButtonGroup>

                {viewMode === "map3d" && (
                  <Button
                    size="small"
                    variant="outlined"
                    onClick={() => setReset3dCameraNonce((n) => n + 1)}
                    sx={{ textTransform: "none" }}
                  >
                    Reset 3D camera
                  </Button>
                )}
              </Box>

              <Box
                sx={{
                  display: "flex",
                  alignItems: "center",
                  gap: 1,
                  justifyContent: "flex-end",
                  flexWrap: "wrap",
                }}
              >
                {canShowExternalViewers && (
                  <ExternalViewersBar
                    projectId={projectId}
                    protocolId={protocolId}
                    outputName={outputName}
                    objectId={effectiveTomoId}
                    objectKind="coords3dTomogram"
                  />
                )}

                <Chip
                  size="small"
                  variant="outlined"
                  label={`Total ${totalCoords.toLocaleString("en-US")}`}
                />
                {filteredPoints.length !== totalCoords && (
                  <Chip
                    size="small"
                    variant="outlined"
                    label={`Shown ${filteredPoints.length.toLocaleString("en-US")}`}
                  />
                )}
                {viewMode === "slice" && (
                  <Chip
                    size="small"
                    variant="outlined"
                    label={sliceLayoutMode === "single" ? "Single view" : "3 views"}
                  />
                )}
                {viewMode === "map3d" && pickedPoint3d && (
                  <Chip
                    size="small"
                    variant="outlined"
                    label={`Pick (${fmtCoord((pickedPoint3d as any).x)}, ${fmtCoord(
                      (pickedPoint3d as any).y,
                    )}, ${fmtCoord((pickedPoint3d as any).z)})`}
                  />
                )}

                {hasAnyDirty && (
                  <Chip
                    size="small"
                    color="warning"
                    variant="filled"
                    label="Unsaved changes"
                  />
                )}

                <Button
                  size="small"
                  variant="contained"
                  disabled={!hasAnyDirty || saveBusy}
                  onClick={openSaveDialog}
                  sx={{ textTransform: "none" }}
                >
                  {saveBusy ? <CircularProgress size={14} sx={{ mr: 1 }} /> : null}
                  Save
                </Button>

                <Button
                  size="small"
                  variant="outlined"
                  disabled={!coordsDirty}
                  onClick={restoreOriginalCoords}
                  sx={{ textTransform: "none" }}
                >
                  Restore
                </Button>

                {pickedPoint3d && (
                  <Button
                    size="small"
                    variant="outlined"
                    color="error"
                    onClick={() => removePointById(String((pickedPoint3d as any).id))}
                    sx={{ textTransform: "none" }}
                  >
                    Remove picked
                  </Button>
                )}
              </Box>
            </Box>
          </Paper>

          <Box
            sx={{
              flex: 1,
              display: "flex",
              minHeight: 0,
              minWidth: 0,
              overflow: "hidden",
            }}
          >
            <Box
              sx={{
                flex: 1,
                display: "flex",
                flexDirection: "column",
                minHeight: 0,
                minWidth: 0,
                overflow: "hidden",
              }}
            >
              <Box
                sx={{
                  flex: 1,
                  minHeight: 0,
                  display: "flex",
                  alignItems: "stretch",
                  justifyContent: "stretch",
                  p: viewMode === "metadata" ? 0 : 1,
                  bgcolor: (theme) => (theme.palette.mode === "dark" ? "#0b1220" : "#f8fafc"),
                }}
              >
                {viewMode === "metadata" ? (
                  <Box sx={{ width: "100%", height: "100%", minHeight: 0, minWidth: 0 }}>
                    {canOpenMetadata ? (
                      <MetadataViewer
                        projectId={projectIdNum}
                        protocolId={protocolIdNum}
                        outputName={outputName}
                        embedded={true}
                        onClose={() => setViewMode("slice")}
                      />
                    ) : (
                      <Box sx={{ m: "auto", px: 2 }}>
                        <Typography variant="body2" color="text.secondary" align="center">
                          Metadata view requires numeric projectId/protocolId.
                        </Typography>
                      </Box>
                    )}
                  </Box>
                ) : viewerLoadingVisible ? (
                  <Box sx={{ m: "auto", display: "flex", gap: 1, alignItems: "center" }}>
                    <CircularProgress size={18} />
                    <Typography variant="body2">Loading coordinates…</Typography>
                  </Box>
                ) : pointsError ? (
                  <Box sx={{ m: "auto" }}>
                    <Typography variant="body2" color="error">
                      {pointsError}
                    </Typography>
                  </Box>
                ) : selectedTomoId == null ? (
                  <Box sx={{ m: "auto" }}>
                    <Typography variant="body2" color="text.secondary">
                      Select a tomogram to view its coordinates.
                    </Typography>
                  </Box>
                ) : !pointsData || totalCoords === 0 ? (
                  <Box sx={{ m: "auto" }}>
                    <Typography variant="body2" color="text.secondary">
                      No coordinates for this tomogram.
                    </Typography>
                  </Box>
                ) : viewMode === "map3d" ? (
                  !tomoDims ? (
                    <Box sx={{ m: "auto" }}>
                      <Typography variant="body2" color="text.secondary">
                        Tomogram dimensions are required for 3D map mode. Make sure dims are
                        provided as [X, Y, Z].
                      </Typography>
                    </Box>
                  ) : (
                    <Coords3dMap3dView
                      dims={tomoDims}
                      voxelSize={tomoMeta?.voxelSize}
                      points={filteredPoints}
                      sliceIndexZ={sliceIndex}
                      sliceIndexX={sliceIndexX}
                      sliceIndexY={sliceIndexY}
                      sliceImageUrlZ={sliceImageUrl}
                      sliceImageUrlX={sliceXImageUrl}
                      sliceImageUrlY={sliceYImageUrl}
                      pointColor={pointColor}
                      pointSizeFactor={pointSizeFactor}
                      pointSize3d={pointSize3d}
                      pointOpacity3d={pointOpacity3d}
                      pointColorMode3d={pointColorMode3d}
                      showSlicePlanes3d={showSlicePlanes3d}
                      slicePlanesOpacity3d={slicePlanesOpacity3d}
                      showBox3d={showBox3d}
                      showAxes3d={showAxes3d}
                      resetCameraNonce={reset3dCameraNonce}
                      onPickPoint={handlePickPoint3d}
                      pickedPoint={pickedPoint3d}
                    />
                  )
                ) : sliceLayoutMode === "triple" ? (
                  !tomoDims ||
                    maxSliceZ == null ||
                    maxSliceX == null ||
                    maxSliceY == null ||
                    sliceIndex == null ||
                    sliceIndexX == null ||
                    sliceIndexY == null ? (
                    <Box sx={{ m: "auto" }}>
                      <Typography variant="body2" color="text.secondary">
                        Tomogram dimensions are not available for orthogonal views.
                      </Typography>
                    </Box>
                  ) : (
                    <Box
                      sx={{
                        width: "100%",
                        height: "100%",
                        minWidth: 0,
                        minHeight: 0,
                        display: "grid",
                        gridTemplateColumns: tripleSliceGridFractions
                          ? `minmax(0, ${tripleSliceGridFractions.leftCol}fr) minmax(0, ${tripleSliceGridFractions.rightCol}fr)`
                          : "minmax(0, 1.15fr) minmax(0, 1fr)",
                        gridTemplateRows: tripleSliceGridFractions
                          ? `minmax(0, ${tripleSliceGridFractions.topRow}fr) minmax(0, ${tripleSliceGridFractions.bottomRow}fr)`
                          : "minmax(0, 0.8fr) minmax(0, 1.2fr)",
                        gap: 1,
                        gridTemplateAreas: `"y ." "z x"`,
                      }}
                    >
                      <Box sx={{ gridArea: "y", minWidth: 0, minHeight: 0 }}>
                        <SlicePanelCard title="Y View · XZ" accent={ORTHO_AXIS_COLORS.y}>
                          {!tomoDimsX || !tomoDimsZ ? (
                            <CenteredHint text="XZ plane dimensions are not available." />
                          ) : sliceYLoading && !sliceYImageUrl && !debugGrid ? (
                            <CenteredProgress text="Loading Y slice…" />
                          ) : sliceYError && !debugGrid ? (
                            <CenteredError text={sliceYError} />
                          ) : !sliceYImageUrl && !debugGrid ? (
                            <CenteredHint text="No Y slice image." />
                          ) : (
                            <svg
                              viewBox={`0 0 ${tomoDimsX} ${tomoDimsZ}`}
                              preserveAspectRatio="xMidYMid meet"
                              style={{ width: "100%", height: "100%", display: "block" }}
                              onClick={(e) => {
                                if (!editMode) return;
                                const local = getSvgLocalPoint(
                                  e.clientX,
                                  e.clientY,
                                  e.currentTarget as any,
                                );
                                if (!local) return;
                                addPointFromSlice("y", local.x, local.y);
                              }}
                            >
                              {debugGrid ? (
                                <SyntheticGrid width={tomoDimsX} height={tomoDimsZ} />
                              ) : (
                                <image
                                  href={sliceYImageUrl ?? undefined}
                                  x={0}
                                  y={0}
                                  width={tomoDimsX}
                                  height={tomoDimsZ}
                                  preserveAspectRatio="none"
                                  style={{
                                    filter: `brightness(${brightness}) contrast(${contrast})`,
                                  }}
                                />
                              )}
                              {sliceIndexX != null && (
                                <line
                                  x1={sliceIndexX}
                                  y1={0}
                                  x2={sliceIndexX}
                                  y2={tomoDimsZ}
                                  stroke={ORTHO_AXIS_COLORS.x}
                                  strokeWidth={1.2}
                                  opacity={0.95}
                                />
                              )}
                              {sliceIndex != null && (
                                <line
                                  x1={0}
                                  y1={sliceIndex}
                                  x2={tomoDimsX}
                                  y2={sliceIndex}
                                  stroke={ORTHO_AXIS_COLORS.z}
                                  strokeWidth={1.2}
                                  opacity={0.95}
                                />
                              )}
                              {slicePointsSvgY.map((p) => {
                                const isPicked =
                                  pickedPointKey != null &&
                                  String(p.pointId) === String(pickedPointKey);
                                const hitStroke = Math.max(10, p.strokeWidth * 10);

                                return (
                                  <g key={p.key}>
                                    <circle
                                      cx={p.x}
                                      cy={p.y}
                                      r={p.radius * 2.2 * pointSizeFactor}
                                      fill="none"
                                      stroke="transparent"
                                      strokeWidth={hitStroke}
                                      pointerEvents="stroke"
                                      style={{ cursor: editMode ? "move" : "pointer" }}
                                      onClick={(ev) => {
                                        ev.stopPropagation();
                                        handleSliceCirclePick(p);
                                      }}
                                      onPointerDown={onPointPointerDown(p, "y")}
                                      onPointerMove={onPointPointerMove}
                                      onPointerUp={onPointPointerUp}
                                      onPointerCancel={onPointPointerUp}
                                    />

                                    <circle
                                      cx={p.x}
                                      cy={p.y}
                                      r={p.radius * 2.2 * pointSizeFactor}
                                      fill="none"
                                      stroke={isPicked ? "#f59e0b" : pointColor}
                                      strokeWidth={
                                        isPicked ? Math.max(2, p.strokeWidth * 2.2) : p.strokeWidth
                                      }
                                      opacity={isPicked ? 1 : p.opacity}
                                      pointerEvents="none"
                                    />

                                    {isPicked && (
                                      <circle
                                        cx={p.x}
                                        cy={p.y}
                                        r={Math.max(2.2, p.radius * 0.65 * pointSizeFactor)}
                                        fill="#f59e0b"
                                        opacity={0.95}
                                        pointerEvents="none"
                                      />
                                    )}
                                  </g>
                                );
                              })}
                            </svg>
                          )}
                        </SlicePanelCard>
                      </Box>

                      <Box sx={{ gridArea: "z", minWidth: 0, minHeight: 0 }}>
                        <SlicePanelCard title="Z View · XY" accent="#3b82f6">
                          {!tomoDimsX || !tomoDimsY ? (
                            <CenteredHint text="XY plane dimensions are not available." />
                          ) : sliceLoading && !sliceImageUrl && !debugGrid ? (
                            <CenteredProgress text="Loading Z slice…" />
                          ) : sliceError && !debugGrid ? (
                            <CenteredError text={sliceError} />
                          ) : !sliceImageUrl && !debugGrid ? (
                            <CenteredHint text="No Z slice image." />
                          ) : (
                            <svg
                              viewBox={
                                singleViewBox
                                  ? `${singleViewBox.x} ${singleViewBox.y} ${singleViewBox.w} ${singleViewBox.h}`
                                  : `0 0 ${tomoDimsX} ${tomoDimsY}`
                              }
                              preserveAspectRatio="xMidYMid meet"
                              style={{
                                width: "100%",
                                height: "100%",
                                display: "block",
                                cursor: isSinglePanning ? "grabbing" : editMode ? "crosshair" : "grab",
                                touchAction: "none",
                              }}
                              onWheel={handleSingleSliceWheel}
                              onPointerDown={handleSingleSlicePointerDown}
                              onPointerMove={handleSingleSlicePointerMove}
                              onPointerUp={handleSingleSlicePointerUp}
                              onPointerCancel={handleSingleSlicePointerUp}
                              onContextMenu={handleSingleSliceContextMenu}
                              onClick={(e) => {
                                if (singleSuppressClickRef.current) return;
                                if (!editMode) return;
                                const local = getSvgLocalPoint(
                                  e.clientX,
                                  e.clientY,
                                  e.currentTarget as any,
                                );
                                if (!local) return;
                                addPointFromSlice("z", local.x, local.y);
                              }}
                            >
                              {debugGrid ? (
                                <SyntheticGrid width={tomoDimsX} height={tomoDimsY} />
                              ) : (
                                <image
                                  href={sliceImageUrl ?? undefined}
                                  x={0}
                                  y={0}
                                  width={tomoDimsX}
                                  height={tomoDimsY}
                                  preserveAspectRatio="none"
                                  style={{
                                    filter: `brightness(${brightness}) contrast(${contrast})`,
                                  }}
                                />
                              )}
                              {sliceIndexX != null && (
                                <line
                                  x1={sliceIndexX}
                                  y1={0}
                                  x2={sliceIndexX}
                                  y2={tomoDimsY}
                                  stroke={ORTHO_AXIS_COLORS.x}
                                  strokeWidth={1.2}
                                  opacity={0.95}
                                />
                              )}
                              {sliceIndexY != null && (
                                <line
                                  x1={0}
                                  y1={sliceIndexY}
                                  x2={tomoDimsX}
                                  y2={sliceIndexY}
                                  stroke="#22c55e"
                                  strokeWidth={1.2}
                                  opacity={0.95}
                                />
                              )}
                              {slicePointsSvgZ.map((p) => {
                                const isPicked =
                                  pickedPointKey != null &&
                                  String(p.pointId) === String(pickedPointKey);
                                const hitStroke = Math.max(10, p.strokeWidth * 10);

                                return (
                                  <g key={p.key}>
                                    <circle
                                      cx={p.x}
                                      cy={p.y}
                                      r={p.radius * 2.2 * pointSizeFactor}
                                      fill="none"
                                      stroke="transparent"
                                      strokeWidth={hitStroke}
                                      pointerEvents="stroke"
                                      style={{ cursor: editMode ? "move" : "pointer" }}
                                      onClick={(ev) => {
                                        ev.stopPropagation();
                                        handleSliceCirclePick(p);
                                      }}
                                      onPointerDown={onPointPointerDown(p, "z")}
                                      onPointerMove={onPointPointerMove}
                                      onPointerUp={onPointPointerUp}
                                      onPointerCancel={onPointPointerUp}
                                    />

                                    <circle
                                      cx={p.x}
                                      cy={p.y}
                                      r={p.radius * 2.2 * pointSizeFactor}
                                      fill="none"
                                      stroke={isPicked ? "#f59e0b" : pointColor}
                                      strokeWidth={
                                        isPicked ? Math.max(2, p.strokeWidth * 2.2) : p.strokeWidth
                                      }
                                      opacity={isPicked ? 1 : p.opacity}
                                      pointerEvents="none"
                                    />

                                    {isPicked && (
                                      <circle
                                        cx={p.x}
                                        cy={p.y}
                                        r={Math.max(2.2, p.radius * 0.65 * pointSizeFactor)}
                                        fill="#f59e0b"
                                        opacity={0.95}
                                        pointerEvents="none"
                                      />
                                    )}
                                  </g>
                                );
                              })}
                            </svg>
                          )}
                        </SlicePanelCard>
                      </Box>

                      <Box sx={{ gridArea: "x", minWidth: 0, minHeight: 0 }}>
                        <SlicePanelCard title="X View · YZ" accent="#ef4444">
                          {!tomoDimsY || !tomoDimsZ ? (
                            <CenteredHint text="YZ plane dimensions are not available." />
                          ) : sliceXLoading && !sliceXImageUrl && !debugGrid ? (
                            <CenteredProgress text="Loading X slice…" />
                          ) : sliceXError && !debugGrid ? (
                            <CenteredError text={sliceXError} />
                          ) : !sliceXImageUrl && !debugGrid ? (
                            <CenteredHint text="No X slice image." />
                          ) : (
                            <svg
                              viewBox={`0 0 ${tomoDimsZ} ${tomoDimsY}`}
                              preserveAspectRatio="xMidYMid meet"
                              style={{ width: "100%", height: "100%", display: "block" }}
                            >
                              <g
                                transform={`translate(${tomoDimsZ}, 0) rotate(90)`}
                                onClick={(e) => {
                                  if (!editMode) return;
                                  e.stopPropagation();
                                  const local = getSvgLocalPoint(
                                    e.clientX,
                                    e.clientY,
                                    e.currentTarget as any,
                                  );
                                  if (!local) return;
                                  addPointFromSlice("x", local.x, local.y);
                                }}
                              >
                                {debugGrid ? (
                                  <SyntheticGrid width={tomoDimsY} height={tomoDimsZ} />
                                ) : (
                                  <image
                                    href={sliceXImageUrl ?? undefined}
                                    x={0}
                                    y={0}
                                    width={tomoDimsY}
                                    height={tomoDimsZ}
                                    preserveAspectRatio="none"
                                    style={{
                                      filter: `brightness(${brightness}) contrast(${contrast})`,
                                    }}
                                  />
                                )}
                                {sliceIndexY != null && (
                                  <line
                                    x1={sliceIndexY}
                                    y1={0}
                                    x2={sliceIndexY}
                                    y2={tomoDimsZ}
                                    stroke="#22c55e"
                                    strokeWidth={1.2}
                                    opacity={0.95}
                                  />
                                )}
                                {sliceIndex != null && (
                                  <line
                                    x1={0}
                                    y1={sliceIndex}
                                    x2={tomoDimsY}
                                    y2={sliceIndex}
                                    stroke={ORTHO_AXIS_COLORS.z}
                                    strokeWidth={1.2}
                                    opacity={0.95}
                                  />
                                )}
                                {slicePointsSvgX.map((p) => {
                                  const isPicked =
                                    pickedPointKey != null &&
                                    String(p.pointId) === String(pickedPointKey);
                                  const hitStroke = Math.max(10, p.strokeWidth * 10);

                                  return (
                                    <g key={p.key}>
                                      <circle
                                        cx={p.x}
                                        cy={p.y}
                                        r={p.radius * 2.2 * pointSizeFactor}
                                        fill="none"
                                        stroke="transparent"
                                        strokeWidth={hitStroke}
                                        pointerEvents="stroke"
                                        style={{ cursor: editMode ? "move" : "pointer" }}
                                        onClick={(ev) => {
                                          ev.stopPropagation();
                                          handleSliceCirclePick(p);
                                        }}
                                        onPointerDown={onPointPointerDown(p, "x")}
                                        onPointerMove={onPointPointerMove}
                                        onPointerUp={onPointPointerUp}
                                        onPointerCancel={onPointPointerUp}
                                      />

                                      <circle
                                        cx={p.x}
                                        cy={p.y}
                                        r={p.radius * 2.2 * pointSizeFactor}
                                        fill="none"
                                        stroke={isPicked ? "#f59e0b" : pointColor}
                                        strokeWidth={
                                          isPicked
                                            ? Math.max(2, p.strokeWidth * 2.2)
                                            : p.strokeWidth
                                        }
                                        opacity={isPicked ? 1 : p.opacity}
                                        pointerEvents="none"
                                      />

                                      {isPicked && (
                                        <circle
                                          cx={p.x}
                                          cy={p.y}
                                          r={Math.max(2.2, p.radius * 0.65 * pointSizeFactor)}
                                          fill="#f59e0b"
                                          opacity={0.95}
                                          pointerEvents="none"
                                        />
                                      )}
                                    </g>
                                  );
                                })}
                              </g>
                            </svg>
                          )}
                        </SlicePanelCard>
                      </Box>
                    </Box>
                  )
                ) : (
                  <Box
                    sx={{
                      flex: 1,
                      minHeight: 0,
                      minWidth: 0,
                      display: "flex",
                    }}
                  >
                    <FullSlicePanel title="Z View · XY" accent="#3b82f6">
                      {sliceLoading && !sliceImageUrl && !debugGrid ? (
                        <CenteredProgress text="Loading tomogram slice…" />
                      ) : sliceError && !debugGrid ? (
                        <CenteredError text={sliceError} />
                      ) : maxSliceZ == null || sliceIndex == null || !tomoDimsX || !tomoDimsY ? (
                        <CenteredHint text="Tomogram dimensions are not available." />
                      ) : !sliceImageUrl && !debugGrid ? (
                        <CenteredHint text="No slice image." />
                      ) : (
                        <svg
                          ref={singleSvgRef}
                          viewBox={
                            singleViewBox
                              ? `${singleViewBox.x} ${singleViewBox.y} ${singleViewBox.w} ${singleViewBox.h}`
                              : `0 0 ${tomoDimsX} ${tomoDimsY}`
                          }
                          preserveAspectRatio="xMidYMid meet"
                          style={{
                            width: "100%",
                            height: "100%",
                            display: "block",
                            touchAction: "none",
                            cursor: isSinglePanning ? "grabbing" : editMode ? "crosshair" : "grab",
                          }}
                          onWheel={handleSingleSliceWheel}
                          onPointerDown={handleSingleSlicePointerDown}
                          onPointerMove={handleSingleSlicePointerMove}
                          onPointerUp={handleSingleSlicePointerUp}
                          onPointerCancel={handleSingleSlicePointerUp}
                          onContextMenu={handleSingleSliceContextMenu}
                          onDoubleClick={handleSingleSliceDoubleClick}
                          onClick={(e) => {
                            e.stopPropagation();
                            markViewerActive();
                            if (singleSuppressClickRef.current) return;
                            if (!editMode) {
                              setPickedPoint3d(null);
                              return;
                            }
                            const local = getSvgLocalPoint(
                              e.clientX,
                              e.clientY,
                              e.currentTarget as any,
                            );
                            if (!local) return;
                            addPointFromSlice("z", local.x, local.y);
                          }}
                        >
                          {debugGrid ? (
                            <SyntheticGrid width={tomoDimsX} height={tomoDimsY} />
                          ) : (
                            <image
                              href={sliceImageUrl ?? undefined}
                              x={0}
                              y={0}
                              width={tomoDimsX}
                              height={tomoDimsY}
                              preserveAspectRatio="none"
                              style={{
                                filter: `brightness(${brightness}) contrast(${contrast})`,
                              }}
                            />
                          )}
                          {slicePointsSvgZ.map((p) => {
                            const isPicked =
                              pickedPointKey != null &&
                              String(p.pointId) === String(pickedPointKey);
                            const hitStroke = Math.max(10, p.strokeWidth * 10);

                            return (
                              <g key={p.key}>
                                <circle
                                  cx={p.x}
                                  cy={p.y}
                                  r={p.radius * 2.2 * pointSizeFactor}
                                  fill="none"
                                  stroke="transparent"
                                  strokeWidth={hitStroke}
                                  pointerEvents="stroke"
                                  style={{ cursor: editMode ? "move" : "pointer" }}
                                  onClick={(ev) => {
                                    ev.stopPropagation();
                                    handleSliceCirclePick(p);
                                  }}
                                  onPointerDown={onPointPointerDown(p, "z")}
                                  onPointerMove={onPointPointerMove}
                                  onPointerUp={onPointPointerUp}
                                  onPointerCancel={onPointPointerUp}
                                />

                                <circle
                                  cx={p.x}
                                  cy={p.y}
                                  r={p.radius * 2.2 * pointSizeFactor}
                                  fill="none"
                                  stroke={isPicked ? "#f59e0b" : pointColor}
                                  strokeWidth={
                                    isPicked ? Math.max(2, p.strokeWidth * 2.2) : p.strokeWidth
                                  }
                                  opacity={isPicked ? 1 : p.opacity}
                                  pointerEvents="none"
                                />

                                {isPicked && (
                                  <circle
                                    cx={p.x}
                                    cy={p.y}
                                    r={Math.max(2.2, p.radius * 0.65 * pointSizeFactor)}
                                    fill="#f59e0b"
                                    opacity={0.95}
                                    pointerEvents="none"
                                  />
                                )}
                              </g>
                            );
                          })}
                        </svg>
                      )}
                    </FullSlicePanel>
                  </Box>
                )}
              </Box>

              {viewMode !== "metadata" && !(viewMode === "slice" && sliceLayoutMode === "triple") && (
                <Divider />
              )}

              {viewMode !== "metadata" && !(viewMode === "slice" && sliceLayoutMode === "triple") && (
                <Box
                  sx={{
                    p: 1,
                    display: "flex",
                    gap: 2,
                    flexWrap: "wrap",
                    alignItems: "center",
                    flexShrink: 0,
                  }}
                >
                  {tomoMeta && (
                    <MetaItem label="Tomogram" value={tomoMeta.label ?? String(selectedTomoId)} />
                  )}
                  {tomoDims && (
                    <MetaItem label="Dims" value={`${tomoDims[0]} × ${tomoDims[1]} × ${tomoDims[2]}`} />
                  )}
                  <MetaItem label="Points" value={totalCoords.toLocaleString("en-US")} />
                  {filteredPoints.length !== totalCoords && (
                    <MetaItem label="Shown" value={filteredPoints.length.toLocaleString("en-US")} />
                  )}
                  {viewMode === "slice" && sliceIndex != null && maxSliceZ != null && (
                    <MetaItem label="Slice (Z)" value={`${sliceIndex + 1} / ${maxSliceZ + 1}`} />
                  )}
                  {showXAxisSlider && sliceIndexX != null && maxSliceX != null && (
                    <MetaItem label="Slice (X)" value={`${sliceIndexX + 1} / ${maxSliceX + 1}`} />
                  )}
                  {showYAxisSlider && sliceIndexY != null && maxSliceY != null && (
                    <MetaItem label="Slice (Y)" value={`${sliceIndexY + 1} / ${maxSliceY + 1}`} />
                  )}
                  {viewMode === "slice" && slicePoints.length > 0 && (
                    <MetaItem label="Slice points" value={slicePoints.length.toLocaleString("en-US")} />
                  )}
                  {viewMode === "map3d" && pickedPoint3d && (
                    <MetaItem
                      label="Picked"
                      value={`${fmtCoord((pickedPoint3d as any).x)}, ${fmtCoord(
                        (pickedPoint3d as any).y,
                      )}, ${fmtCoord((pickedPoint3d as any).z)}`}
                    />
                  )}
                </Box>
              )}
            </Box>

            {viewMode !== "metadata" && (
              <>
                <Divider orientation="vertical" flexItem />
                <Box
                  sx={{
                    flexBasis: 340,
                    flexShrink: 0,
                    minWidth: 340,
                    maxWidth: 340,
                    p: 1.25,
                    display: "flex",
                    flexDirection: "column",
                    bgcolor: "background.paper",
                    gap: 1,
                    minHeight: 0,
                    overflow: "hidden",
                  }}
                >
                  <Tabs
                    value={rightPanelTab}
                    onChange={(_, v) => setRightPanelTab(v as RightPanelTab)}
                    variant="fullWidth"
                    sx={{ minHeight: 36 }}
                  >
                    <Tab value="filters" label="Filters" sx={{ fontSize: "0.75rem", minHeight: 36, py: 0.5 }} />
                    <Tab value="appearance" label="Appearance" sx={{ fontSize: "0.75rem", minHeight: 36, py: 0.5 }} />
                  </Tabs>

                  <Box
                    sx={{
                      flex: 1,
                      minHeight: 0,
                      overflowY: "auto",
                      overflowX: "hidden",
                      pr: 1,
                      pb: 2,
                      mt: 0.5,
                      display: "flex",
                      flexDirection: "column",
                      gap: 1.5,
                    }}
                  >
                    <Divider />

                    {rightPanelTab === "filters" ? (
                      <Box sx={{ display: "flex", flexDirection: "column", gap: 1.5, ml: 1 }}>
                        <Typography variant="subtitle2">Filters</Typography>

                        {viewMode === "slice" && (
                          <Box sx={{ display: "flex", flexDirection: "column", gap: 0.5 }}>
                            <Box sx={{ display: "inline-flex", alignItems: "center", gap: 0.5 }}>
                              <Typography variant="caption" color="text.secondary">
                                Slice layout
                              </Typography>
                              <IconButton size="small" onClick={() => openHelp("sliceLayout")}>
                                <HelpCircle size={14} />
                              </IconButton>
                            </Box>
                            <ToggleButtonGroup
                              size="small"
                              exclusive
                              fullWidth
                              value={sliceLayoutMode}
                              onChange={(_, v) => v && setSliceLayoutMode(v)}
                            >
                              <ToggleButton value="single">Single</ToggleButton>
                              <ToggleButton value="triple">3 Views</ToggleButton>
                            </ToggleButtonGroup>
                          </Box>
                        )}

                        {viewMode === "slice" && (
                          <FormControlLabel
                            control={
                              <Switch size="small" checked={editMode} onChange={(_, checked) => setEditMode(checked)} />
                            }
                            label="Edit points (add/move)"
                            sx={{ mt: 0.25, "& .MuiFormControlLabel-label": { fontSize: "0.8rem" } }}
                          />
                        )}

                        {viewMode === "slice" && (
                          <FormControlLabel
                            control={
                              <Switch size="small" checked={debugGrid} onChange={(_, checked) => setDebugGrid(checked)} />
                            }
                            label="Debug synthetic grid"
                            sx={{ mt: 0.25, "& .MuiFormControlLabel-label": { fontSize: "0.75rem" } }}
                          />
                        )}

                        <Box sx={{ display: "flex", flexDirection: "column", gap: 1 }}>
                          <Typography variant="caption" color="text.secondary">
                            {viewMode === "map3d" ? "Slices / planes" : "Slices"}
                          </Typography>

                          <SliderField
                            label="Slice (Z)"
                            helpKey="sliceIndex"
                            openHelp={openHelp}
                            value={sliceIndex}
                            max={maxSliceZ}
                            onChange={(v) => {
                              setDraggingSlice("z");
                              setSliceIndex(v);
                            }}
                            onChangeCommitted={(v) => {
                              setSliceIndex(v);
                              setDraggingSlice((current) => current === "z" ? null : current);
                            }}
                            axisColor={ORTHO_AXIS_COLORS.z}
                          />

                          {showXAxisSlider && (
                            <SliderField
                              label="Slice (X)"
                              helpKey="sliceIndex"
                              openHelp={openHelp}
                              value={sliceIndexX}
                              max={maxSliceX}
                              onChange={(v) => {
                                setDraggingSlice("x");
                                setSliceIndexX(v);
                              }}
                              onChangeCommitted={(v) => {
                                setSliceIndexX(v);
                                setDraggingSlice((current) => current === "x" ? null : current);
                              }}
                              axisColor={ORTHO_AXIS_COLORS.x}
                            />
                          )}

                          {showYAxisSlider && (
                            <SliderField
                              label="Slice (Y)"
                              helpKey="sliceIndex"
                              openHelp={openHelp}
                              value={sliceIndexY}
                              max={maxSliceY}
                              onChange={(v) => {
                                setDraggingSlice("y");
                                setSliceIndexY(v);
                              }}
                              onChangeCommitted={(v) => {
                                setSliceIndexY(v);
                                setDraggingSlice((current) => current === "y" ? null : current);
                              }}
                              axisColor={ORTHO_AXIS_COLORS.y}
                            />
                          )}
                        </Box>

                        <Divider />

                        <Box sx={{ display: "flex", flexDirection: "column", gap: 0.5 }}>
                          <Box sx={{ display: "inline-flex", alignItems: "center", gap: 0.5 }}>
                            <Typography variant="caption" color="text.secondary">
                              Class filter
                            </Typography>
                            <IconButton size="small" onClick={() => openHelp("classFilter")}>
                              <HelpCircle size={14} />
                            </IconButton>
                          </Box>
                          <TextField
                            size="small"
                            select
                            value={selectedClass}
                            onChange={(e) => setSelectedClass(e.target.value)}
                            SelectProps={{ MenuProps: { disablePortal: true } }}
                          >
                            {classOptions.map((opt) => (
                              <MenuItem key={opt} value={opt}>
                                {opt === "all" ? "All" : opt}
                              </MenuItem>
                            ))}
                          </TextField>
                        </Box>

                        <Box sx={{ display: "flex", flexDirection: "column", gap: 0.5 }}>
                          <Box sx={{ display: "inline-flex", alignItems: "center", gap: 0.5 }}>
                            <Typography variant="caption" color="text.secondary">
                              Score range
                            </Typography>
                            <IconButton size="small" onClick={() => openHelp("scoreFilter")}>
                              <HelpCircle size={14} />
                            </IconButton>
                          </Box>
                          {scoreMinMax ? (
                            <>
                              <Slider
                                size="small"
                                value={scoreRange ?? [scoreMinMax[0], scoreMinMax[1]]}
                                min={scoreMinMax[0]}
                                max={scoreMinMax[1]}
                                step={(scoreMinMax[1] - scoreMinMax[0]) / 200 || 0.001}
                                onChange={(_, v) => setScoreRange(v as [number, number])}
                                valueLabelDisplay="auto"
                                valueLabelFormat={(v) => (v as number).toFixed(3)}
                              />
                              <Box sx={{ display: "flex", justifyContent: "space-between" }}>
                                <Typography variant="caption" color="text.secondary">
                                  {scoreMinMax[0].toFixed(3)}
                                </Typography>
                                <Typography variant="caption" color="text.secondary">
                                  {scoreMinMax[1].toFixed(3)}
                                </Typography>
                              </Box>
                            </>
                          ) : (
                            <Typography variant="caption" color="text.secondary">
                              No numeric scores available.
                            </Typography>
                          )}
                        </Box>

                        <Box sx={{ display: "flex", flexDirection: "column", gap: 0.5 }}>
                          <Box sx={{ display: "inline-flex", alignItems: "center", gap: 0.5 }}>
                            <Typography variant="caption" color="text.secondary">
                              Max points
                            </Typography>
                            <IconButton size="small" onClick={() => openHelp("maxPoints")}>
                              <HelpCircle size={14} />
                            </IconButton>
                          </Box>
                          <Slider
                            size="small"
                            value={maxPoints}
                            min={1000}
                            max={200000}
                            step={1000}
                            onChange={(_, v) => setMaxPoints(v as number)}
                            valueLabelDisplay="auto"
                            valueLabelFormat={(v) =>
                              (v as number).toLocaleString("en-US", { maximumFractionDigits: 0 })
                            }
                          />
                        </Box>

                      </Box>
                    ) : (
                      <Box sx={{ display: "flex", flexDirection: "column", gap: 1.5, ml: 1 }}>
                        <Typography variant="subtitle2">Appearance</Typography>

                        <Box sx={{ display: "flex", flexDirection: "column", gap: 0.5 }}>
                          <Box sx={{ display: "inline-flex", alignItems: "center", gap: 0.5 }}>
                            <Typography variant="caption" color="text.secondary">
                              Tomogram colormap
                            </Typography>
                            <IconButton size="small" onClick={() => openHelp("tomogramColormap")}>
                              <HelpCircle size={14} />
                            </IconButton>
                          </Box>
                          <TextField
                            size="small"
                            select
                            value={tomogramColormap}
                            onChange={(e) => setTomogramColormap(e.target.value)}
                            SelectProps={{ MenuProps: { disablePortal: true } }}
                          >
                            {TOMOGRAM_CMAP_OPTIONS.map((cm) => (
                              <MenuItem key={cm} value={cm}>
                                {cm}
                              </MenuItem>
                            ))}
                          </TextField>
                        </Box>

                        <Box sx={{ display: "flex", flexDirection: "column", gap: 0.5 }}>
                          <Box sx={{ display: "inline-flex", alignItems: "center", gap: 0.5 }}>
                            <Typography variant="caption" color="text.secondary">
                              Point color
                            </Typography>
                            <IconButton size="small" onClick={() => openHelp("pointColor")}>
                              <HelpCircle size={14} />
                            </IconButton>
                          </Box>
                          <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.75 }}>
                            {POINT_COLOR_PALETTE.map((c) => {
                              const isSelected = c.value === pointColor;
                              return (
                                <Box
                                  key={c.value}
                                  onClick={() => setPointColor(c.value)}
                                  sx={{
                                    width: 20,
                                    height: 20,
                                    borderRadius: "50%",
                                    cursor: "pointer",
                                    border: isSelected ? "2px solid #111827" : "1px solid #d1d5db",
                                    boxShadow: isSelected ? 1 : "none",
                                    backgroundColor: c.value,
                                  }}
                                  title={c.label}
                                />
                              );
                            })}
                          </Box>
                        </Box>

                        <Box sx={{ display: "flex", flexDirection: "column", gap: 0.5 }}>
                          <Box sx={{ display: "inline-flex", alignItems: "center", gap: 0.5 }}>
                            <Typography variant="caption" color="text.secondary">
                              Point size (global)
                            </Typography>
                            <IconButton size="small" onClick={() => openHelp("pointSize")}>
                              <HelpCircle size={14} />
                            </IconButton>
                          </Box>
                          <Slider size="small" value={pointSizeFactor} min={0.3} max={3} step={0.05} onChange={(_, v) => setPointSizeFactor(v as number)} valueLabelDisplay="auto" valueLabelFormat={(v) => `${(v as number).toFixed(2)}×`} />
                        </Box>

                        {viewMode === "slice" && (
                          <>
                            <Divider />
                            <Box sx={{ display: "flex", flexDirection: "column", gap: 1 }}>
                              <Box
                                sx={{
                                  display: "flex",
                                  justifyContent: "space-between",
                                  alignItems: "center",
                                }}
                              >
                                <Typography variant="caption" color="text.secondary">
                                  Slice intensity
                                </Typography>
                                <Button
                                  size="small"
                                  onClick={() => {
                                    setBrightness(1.0);
                                    setContrast(1.0);
                                  }}
                                >
                                  Reset
                                </Button>
                              </Box>

                              <Box sx={{ display: "flex", flexDirection: "column", gap: 0.5 }}>
                                <Box sx={{ display: "inline-flex", alignItems: "center", gap: 0.5 }}>
                                  <Typography variant="caption" color="text.secondary">
                                    Brightness
                                  </Typography>
                                  <IconButton size="small" onClick={() => openHelp("brightness")}>
                                    <HelpCircle size={14} />
                                  </IconButton>
                                </Box>
                                <Slider
                                  size="small"
                                  value={brightness}
                                  min={0.3}
                                  max={2.5}
                                  step={0.05}
                                  onChange={(_, v) => setBrightness(v as number)}
                                  valueLabelDisplay="auto"
                                  valueLabelFormat={(v) => `${Math.round((v as number) * 100)}%`}
                                />
                              </Box>

                              <Box sx={{ display: "flex", flexDirection: "column", gap: 0.5 }}>
                                <Box sx={{ display: "inline-flex", alignItems: "center", gap: 0.5 }}>
                                  <Typography variant="caption" color="text.secondary">
                                    Contrast
                                  </Typography>
                                  <IconButton size="small" onClick={() => openHelp("contrast")}>
                                    <HelpCircle size={14} />
                                  </IconButton>
                                </Box>
                                <Slider
                                  size="small"
                                  value={contrast}
                                  min={0.3}
                                  max={2.5}
                                  step={0.05}
                                  onChange={(_, v) => setContrast(v as number)}
                                  valueLabelDisplay="auto"
                                  valueLabelFormat={(v) => `${Math.round((v as number) * 100)}%`}
                                />
                              </Box>
                            </Box>
                          </>
                        )}

                        {viewMode === "map3d" && (
                          <>
                            <Divider />
                            <Box sx={{ display: "flex", flexDirection: "column", gap: 0.5 }}>
                              <Box sx={{ display: "inline-flex", alignItems: "center", gap: 0.5 }}>
                                <Typography variant="caption" color="text.secondary">
                                  3D color mode
                                </Typography>
                                <IconButton size="small" onClick={() => openHelp("pointColorMode3d")}>
                                  <HelpCircle size={14} />
                                </IconButton>
                              </Box>
                              <TextField size="small" select value={pointColorMode3d} onChange={(e) => setPointColorMode3d(e.target.value as PointColorMode3d)} SelectProps={{ MenuProps: { disablePortal: true } }}>
                                <MenuItem value="fixed">Fixed</MenuItem>
                                <MenuItem value="class">Class</MenuItem>
                                <MenuItem value="score">Score</MenuItem>
                              </TextField>
                            </Box>

                            <Box sx={{ display: "flex", flexDirection: "column", gap: 0.5 }}>
                              <Box sx={{ display: "inline-flex", alignItems: "center", gap: 0.5 }}>
                                <Typography variant="caption" color="text.secondary">
                                  3D point size
                                </Typography>
                                <IconButton size="small" onClick={() => openHelp("pointSize3d")}>
                                  <HelpCircle size={14} />
                                </IconButton>
                              </Box>
                              <Slider size="small" value={pointSize3d} min={1} max={18} step={0.25} onChange={(_, v) => setPointSize3d(v as number)} valueLabelDisplay="auto" />
                            </Box>

                            <Box sx={{ display: "flex", flexDirection: "column", gap: 0.5 }}>
                              <Box sx={{ display: "inline-flex", alignItems: "center", gap: 0.5 }}>
                                <Typography variant="caption" color="text.secondary">
                                  3D point opacity
                                </Typography>
                                <IconButton size="small" onClick={() => openHelp("pointOpacity3d")}>
                                  <HelpCircle size={14} />
                                </IconButton>
                              </Box>
                              <Slider size="small" value={pointOpacity3d} min={0.05} max={1} step={0.02} onChange={(_, v) => setPointOpacity3d(v as number)} valueLabelDisplay="auto" valueLabelFormat={(v) => `${Math.round((v as number) * 100)}%`} />
                            </Box>

                            <Divider />

                            <FormControlLabel control={<Switch size="small" checked={showSlicePlanes3d} onChange={(_, checked) => setShowSlicePlanes3d(checked)} />} label="Show slice planes" sx={{ "& .MuiFormControlLabel-label": { fontSize: "0.8rem" } }} />

                            <IconRowHelp label="Plane opacity" onHelp={() => openHelp("slicePlanesOpacity3d")} />
                            <Slider size="small" value={slicePlanesOpacity3d} min={0.03} max={0.65} step={0.01} onChange={(_, v) => setSlicePlanesOpacity3d(v as number)} disabled={!showSlicePlanes3d} valueLabelDisplay="auto" valueLabelFormat={(v) => `${Math.round((v as number) * 100)}%`} />

                            <FormControlLabel control={<Switch size="small" checked={showBox3d} onChange={(_, checked) => setShowBox3d(checked)} />} label="Show volume box" sx={{ "& .MuiFormControlLabel-label": { fontSize: "0.8rem" } }} />
                            <FormControlLabel control={<Switch size="small" checked={showAxes3d} onChange={(_, checked) => setShowAxes3d(checked)} />} label="Show axes" sx={{ "& .MuiFormControlLabel-label": { fontSize: "0.8rem" } }} />
                            <FormControlLabel control={<Switch size="small" checked={syncPick3dToSlices} onChange={(_, checked) => setSyncPick3dToSlices(checked)} />} label="Sync 3D click to slices" sx={{ "& .MuiFormControlLabel-label": { fontSize: "0.8rem" } }} />

                            <Button size="small" variant="outlined" onClick={() => setReset3dCameraNonce((n) => n + 1)} sx={{ textTransform: "none", mt: 0.25 }}>
                              Reset 3D camera
                            </Button>
                          </>
                        )}
                      </Box>
                    )}
                  </Box>
                </Box>
              </>
            )}
          </Box>
        </Box>
      </Box>
      <Dialog
        open={saveDialogOpen}
        onClose={() => {
          if (saveBusy) return;
          setSaveDialogOpen(false);
        }}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>Save changes</DialogTitle>
        <DialogContent sx={{ pt: 1.5 }}>
          <DialogContentText sx={{ mb: 1.5 }}>
            This will create a new coordinates output from your modified tomograms. Continue?
          </DialogContentText>

          {saveError && (
            <Alert severity="error" sx={{ mt: 1.5 }}>
              {saveError}
            </Alert>
          )}
        </DialogContent>
        <DialogActions>
          <Button
            onClick={() => setSaveDialogOpen(false)}
            disabled={saveBusy}
            sx={{ textTransform: "none" }}
          >
            Cancel
          </Button>
          <Button
            onClick={saveChanges}
            disabled={saveBusy}
            variant="contained"
            sx={{ textTransform: "none" }}
          >
            {saveBusy ? <CircularProgress size={16} sx={{ mr: 1 }} /> : null}
            Save
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={helpOpen} onClose={() => setHelpOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle>
          {helpKey === "sliceIndex"
            ? "Slice index"
            : helpKey === "sliceLayout"
              ? "Slice layout"
              : helpKey === "classFilter"
                ? "Class filter"
                : helpKey === "scoreFilter"
                  ? "Score range"
                  : helpKey === "maxPoints"
                    ? "Max points"
                    : helpKey === "brightness"
                      ? "Brightness"
                      : helpKey === "contrast"
                        ? "Contrast"
                        : helpKey === "pointColor"
                          ? "Point color"
                          : helpKey === "pointSize"
                            ? "Point size"
                            : helpKey === "pointColorMode3d"
                              ? "3D color mode"
                              : helpKey === "pointOpacity3d"
                                ? "3D point opacity"
                                : helpKey === "slicePlanes3d"
                                  ? "Slice planes"
                                  : helpKey === "slicePlanesOpacity3d"
                                    ? "Slice plane opacity"
                                    : helpKey === "showBox3d"
                                      ? "Show box"
                                      : helpKey === "showAxes3d"
                                        ? "Show axes"
                                        : helpKey === "syncPick3d"
                                          ? "Sync 3D pick"
                                          : helpKey === "pointSize3d"
                                            ? "3D point size"
                                            : "Help"}
        </DialogTitle>
        <DialogContent>
          <DialogContentText>{helpKey ? HELP_TEXT[helpKey] ?? "No help available." : ""}</DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setHelpOpen(false)} autoFocus>
            Close
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}

function SliderField({
  label,
  helpKey,
  openHelp,
  value,
  max,
  onChange,
  onChangeCommitted,
  axisColor,
}: {
  label: string;
  helpKey: string;
  openHelp: (key: string) => void;
  value: number | null;
  max: number | null;
  onChange: (v: number) => void;
  onChangeCommitted?: (v: number) => void;
  axisColor?: string;
}) {
  const normalizeSliderValue = (v: number | number[]) =>
    Array.isArray(v) ? v[0] : v;
  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 0.5 }}>
      <Box sx={{ display: "inline-flex", alignItems: "center", gap: 0.5 }}>
        <Typography variant="caption" color="text.secondary">
          {label}
        </Typography>
        <IconButton size="small" onClick={() => openHelp(helpKey)}>
          <HelpCircle size={14} />
        </IconButton>
      </Box>
      {max != null && value != null ? (
        <>
          <Slider
            size="small"
            value={Math.min(value, max)}
            min={0}
            max={max}
            step={1}
            onChange={(_, v) => onChange(normalizeSliderValue(v as number | number[]))}
            onChangeCommitted={(_, v) => {
              onChangeCommitted?.(normalizeSliderValue(v as number | number[]));
            }}
            valueLabelDisplay="auto"
            valueLabelFormat={(v) => String((v as number) + 1)}
            sx={
              axisColor
                ? {
                  color: axisColor,
                  "& .MuiSlider-rail": {
                    opacity: 0.22,
                  },
                  "& .MuiSlider-thumb": {
                    boxShadow: `0 0 0 4px ${axisColor}22`,
                  },
                  "& .MuiSlider-thumb:hover": {
                    boxShadow: `0 0 0 7px ${axisColor}26`,
                  },
                  "& .MuiSlider-valueLabel": {
                    color: axisColor,
                  },
                }
                : undefined
            }
          />
          <Box sx={{ display: "flex", justifyContent: "space-between" }}>
            <Typography variant="caption" color="text.secondary">
              1
            </Typography>
            <Typography variant="caption" color="text.secondary">
              {max + 1}
            </Typography>
          </Box>
        </>
      ) : (
        <Typography variant="caption" color="text.secondary">
          Slice range not available.
        </Typography>
      )}
    </Box>
  );
}

function SlicePanelCard({
  title,
  accent,
  children,
}: {
  title: string;
  accent: string;
  children: ReactNode;
}) {
  return (
    <Paper
      elevation={0}
      sx={{
        minWidth: 0,
        minHeight: 0,
        height: "100%",
        display: "flex",
        flexDirection: "column",
        borderRadius: 2,
        overflow: "hidden",
        border: "1px solid",
        borderColor: "divider",
        boxShadow: "0 10px 30px rgba(2,6,23,0.08)",
        bgcolor: "background.paper",
        position: "relative",
      }}
    >
      <Box
        sx={{
          position: "absolute",
          top: 6,
          left: 6,
          zIndex: 2,
          px: 0.75,
          py: 0.35,
          borderRadius: 1,
          display: "inline-flex",
          alignItems: "center",
          gap: 0.6,
          bgcolor: "rgba(15,23,42,0.55)",
          color: "white",
          backdropFilter: "blur(3px)",
          border: `1px solid ${hexToRgba(accent, 0.35)}`,
          pointerEvents: "none",
        }}
      >
        <Box
          sx={{
            width: 7,
            height: 7,
            borderRadius: "50%",
            bgcolor: accent,
            boxShadow: `0 0 0 2px ${hexToRgba(accent, 0.22)}`,
            flexShrink: 0,
          }}
        />
        <Typography variant="caption" sx={{ color: "inherit", fontWeight: 700 }}>
          {title}
        </Typography>
      </Box>

      <Box
        sx={{
          flex: 1,
          minHeight: 0,
          minWidth: 0,
          display: "flex",
          alignItems: "stretch",
          justifyContent: "stretch",
          background:
            "radial-gradient(circle at 30% 20%, rgba(148,163,184,0.06), transparent 45%)",
        }}
      >
        {children}
      </Box>
    </Paper>
  );
}

function FullSlicePanel({
  title,
  accent,
  children,
}: {
  title: string;
  accent: string;
  children: ReactNode;
}) {
  return (
    <Paper
      elevation={0}
      sx={{
        width: "100%",
        height: "100%",
        minWidth: 0,
        minHeight: 0,
        borderRadius: 2,
        overflow: "hidden",
        border: "1px solid",
        borderColor: "divider",
        boxShadow: "0 12px 30px rgba(2,6,23,0.08)",
        bgcolor: "background.paper",
        position: "relative",
      }}
    >
      <Box
        sx={{
          position: "absolute",
          top: 6,
          left: 6,
          zIndex: 2,
          px: 0.75,
          py: 0.35,
          borderRadius: 1,
          display: "inline-flex",
          alignItems: "center",
          gap: 0.6,
          bgcolor: "rgba(15,23,42,0.55)",
          color: "white",
          backdropFilter: "blur(3px)",
          border: `1px solid ${hexToRgba(accent, 0.35)}`,
          pointerEvents: "none",
        }}
      >
        <Box
          sx={{
            width: 7,
            height: 7,
            borderRadius: "50%",
            bgcolor: accent,
            boxShadow: `0 0 0 2px ${hexToRgba(accent, 0.22)}`,
            flexShrink: 0,
          }}
        />
        <Typography variant="caption" sx={{ color: "inherit", fontWeight: 700 }}>
          {title}
        </Typography>
      </Box>

      <Box
        sx={{
          width: "100%",
          height: "100%",
          minWidth: 0,
          minHeight: 0,
          display: "flex",
          alignItems: "stretch",
          justifyContent: "stretch",
        }}
      >
        {children}
      </Box>
    </Paper>
  );
}

function CenteredProgress({ text }: { text: string }) {
  return (
    <Box sx={{ m: "auto", display: "flex", gap: 1, alignItems: "center" }}>
      <CircularProgress size={18} />
      <Typography variant="body2">{text}</Typography>
    </Box>
  );
}

function CenteredError({ text }: { text: string }) {
  return (
    <Box sx={{ m: "auto", px: 1 }}>
      <Typography variant="body2" color="error" align="center">
        {text}
      </Typography>
    </Box>
  );
}

function CenteredHint({ text }: { text: string }) {
  return (
    <Box sx={{ m: "auto", px: 1 }}>
      <Typography variant="body2" color="text.secondary" align="center">
        {text}
      </Typography>
    </Box>
  );
}

function IconRowHelp({
  label,
  onHelp,
}: {
  label: string;
  onHelp: () => void;
}) {
  return (
    <Box sx={{ display: "inline-flex", alignItems: "center", gap: 0.5 }}>
      <Typography variant="caption" color="text.secondary">
        {label}
      </Typography>
      <IconButton size="small" onClick={onHelp}>
        <HelpCircle size={14} />
      </IconButton>
    </Box>
  );
}

function MetaItem({ label, value }: { label: string; value: string }) {
  return (
    <Box sx={{ display: "flex", gap: 0.5, alignItems: "baseline" }}>
      <Typography variant="caption" color="text.secondary">
        {label}:
      </Typography>
      <Typography variant="caption">{value}</Typography>
    </Box>
  );
}

function SyntheticGrid({ width, height }: { width: number; height: number }) {
  const maxLines = 12;
  const stepX = width > 0 ? Math.max(1, Math.floor(width / maxLines)) : 1;
  const stepY = height > 0 ? Math.max(1, Math.floor(height / maxLines)) : 1;

  const elements: ReactNode[] = [];

  for (let x = 0; x <= width; x += stepX) {
    elements.push(
      <line
        key={`v-${x}`}
        x1={x}
        y1={0}
        x2={x}
        y2={height}
        stroke="#9ca3af"
        strokeWidth={0.5}
        opacity={0.6}
      />,
    );
  }

  for (let y = 0; y <= height; y += stepY) {
    elements.push(
      <line
        key={`h-${y}`}
        x1={0}
        y1={y}
        x2={width}
        y2={y}
        stroke="#9ca3af"
        strokeWidth={0.5}
        opacity={0.6}
      />,
    );
  }

  const r = Math.max(width, height) * 0.015;
  elements.push(
    <circle key="origin" cx={0} cy={0} r={r} fill="#ef4444" opacity={0.9} />,
  );
  elements.push(
    <circle key="corner" cx={width} cy={height} r={r} fill="#22c55e" opacity={0.9} />,
  );

  return <>{elements}</>;
}

type Coords3dMap3dViewProps = {
  dims: [number, number, number];
  voxelSize?: [number, number, number];
  points: Coords3dPointExt[];
  sliceIndexZ: number | null;
  sliceIndexX: number | null;
  sliceIndexY: number | null;
  sliceImageUrlZ?: string | null;
  sliceImageUrlX?: string | null;
  sliceImageUrlY?: string | null;
  pointColor: string;
  pointSizeFactor: number;
  pointSize3d: number;
  pointOpacity3d: number;
  pointColorMode3d: PointColorMode3d;
  showSlicePlanes3d: boolean;
  slicePlanesOpacity3d: number;
  showBox3d: boolean;
  showAxes3d: boolean;
  resetCameraNonce: number;
  pickedPoint?: Coords3dPointExt | null;
  onPickPoint?: (
    p: Coords3dPointExt | null,
    mappedSliceIndices?: { x: number; y: number; z: number },
  ) => void;
};

type AxisMapperMode =
  | "zeroBased"
  | "oneBased"
  | "bounds"
  | "normalized01"
  | "normalizedCentered";

type AxisMapper = {
  mode: AxisMapperMode;
  min: number;
  max: number;
  dim: number;
};

type PointMapper = {
  x: AxisMapper;
  y: AxisMapper;
  z: AxisMapper;
};

function Coords3dMap3dView({
  dims,
  voxelSize,
  points,
  sliceIndexZ,
  sliceIndexX,
  sliceIndexY,
  sliceImageUrlZ,
  sliceImageUrlX,
  sliceImageUrlY,
  pointColor,
  pointSizeFactor,
  pointSize3d,
  pointOpacity3d,
  pointColorMode3d,
  showSlicePlanes3d,
  slicePlanesOpacity3d,
  showBox3d,
  showAxes3d,
  resetCameraNonce,
  pickedPoint,
  onPickPoint,
}: Coords3dMap3dViewProps) {
  const mountRef = useRef<HTMLDivElement | null>(null);

  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const rootRef = useRef<THREE.Group | null>(null);

  const pointsRef = useRef<THREE.Points<THREE.BufferGeometry, THREE.PointsMaterial> | null>(
    null,
  );
  const pointsMaterialRef = useRef<THREE.PointsMaterial | null>(null);

  const pickedMarkerRef = useRef<THREE.Group | null>(null);

  const boxLineRef = useRef<THREE.LineSegments | null>(null);
  const axesGroupRef = useRef<THREE.Group | null>(null);

  const planeXRef = useRef<THREE.Mesh | null>(null);
  const planeYRef = useRef<THREE.Mesh | null>(null);
  const planeZRef = useRef<THREE.Mesh | null>(null);

  const planeEdgeXRef = useRef<THREE.LineSegments | null>(null);
  const planeEdgeYRef = useRef<THREE.LineSegments | null>(null);
  const planeEdgeZRef = useRef<THREE.LineSegments | null>(null);

  const raycasterRef = useRef(new THREE.Raycaster());
  const mouseNdcRef = useRef(new THREE.Vector2());
  const rawPointsRef = useRef<Coords3dPointExt[]>([]);
  const mapperRef = useRef<PointMapper | null>(null);
  const pickedIndexRef = useRef<number | null>(null);

  const planeTextureXRef = useRef<THREE.Texture | null>(null);
  const planeTextureYRef = useRef<THREE.Texture | null>(null);
  const planeTextureZRef = useRef<THREE.Texture | null>(null);
  const planeTextureLoadTokenRef = useRef({ x: 0, y: 0, z: 0 });

  const rafRef = useRef<number | null>(null);
  const resizeObserverRef = useRef<ResizeObserver | null>(null);
  const spriteTextureRef = useRef<THREE.Texture | null>(null);

  const [initError, setInitError] = useState<string | null>(null);
  const [mappingSummary, setMappingSummary] = useState<string>("");

  const dimsObj = useMemo(() => ({ x: dims[0], y: dims[1], z: dims[2] }), [dims]);

  const axisSigns = useMemo(
    () =>
      ({
        x: 1,
        y: -1,
        z: -1,
      }) as const,
    [],
  );

  const scaleVec = useMemo(() => {
    const spacing = voxelSize ?? [1, 1, 1];
    const dx = dimsObj.x * (spacing[0] ?? 1);
    const dy = dimsObj.y * (spacing[1] ?? 1);
    const dz = dimsObj.z * (spacing[2] ?? 1);
    const m = Math.max(dx, dy, dz) || 1;
    return new THREE.Vector3(dx / m, dy / m, dz / m);
  }, [dimsObj, voxelSize]);

  useEffect(() => {
    if (!mountRef.current || rendererRef.current) return;

    const mount = mountRef.current;
    let localPointerDownHandler: ((e: PointerEvent) => void) | null = null;

    try {
      const scene = new THREE.Scene();
      sceneRef.current = scene;

      const camera = new THREE.PerspectiveCamera(45, 1, 0.01, 100);
      camera.position.set(1.9, 1.35, 2.0);
      cameraRef.current = camera;

      const renderer = new THREE.WebGLRenderer({
        antialias: true,
        alpha: true,
        powerPreference: "high-performance",
      });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      renderer.setClearColor(0x000000, 0);
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      rendererRef.current = renderer;
      mount.appendChild(renderer.domElement);

      const controls = new OrbitControls(camera, renderer.domElement);
      controls.enableDamping = true;
      controls.dampingFactor = 0.08;
      controls.rotateSpeed = 0.8;
      controls.zoomSpeed = 0.9;
      controls.panSpeed = 0.8;
      controls.screenSpacePanning = true;
      controls.target.set(0, 0, 0);
      controls.update();
      controlsRef.current = controls;

      const root = new THREE.Group();
      rootRef.current = root;
      scene.add(root);

      scene.add(new THREE.AmbientLight(0xffffff, 0.65));
      const dir = new THREE.DirectionalLight(0xffffff, 0.55);
      dir.position.set(2, 2, 1.5);
      scene.add(dir);

      const boxGeom = new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1));
      const boxLine = new THREE.LineSegments(
        boxGeom,
        new THREE.LineBasicMaterial({
          color: 0x94a3b8,
          transparent: true,
          opacity: 0.9,
          depthWrite: false,
        }),
      );
      boxLine.renderOrder = 6;
      boxLineRef.current = boxLine;
      root.add(boxLine);

      const axesGroup = new THREE.Group();
      axesGroupRef.current = axesGroup;
      root.add(axesGroup);
      axesGroup.add(
        createAxisLine(
          new THREE.Vector3(-0.55, -0.55, -0.55),
          new THREE.Vector3(0.68, -0.55, -0.55),
          0xef4444,
        ),
      );
      axesGroup.add(
        createAxisLine(
          new THREE.Vector3(-0.55, -0.55, -0.55),
          new THREE.Vector3(-0.55, 0.68, -0.55),
          0x22c55e,
        ),
      );
      axesGroup.add(
        createAxisLine(
          new THREE.Vector3(-0.55, -0.55, -0.55),
          new THREE.Vector3(-0.55, -0.55, 0.68),
          0x3b82f6,
        ),
      );

      const planeMatX = new THREE.MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0.22,
        side: THREE.DoubleSide,
        depthWrite: false,
        depthTest: false,
      });
      const planeMatY = new THREE.MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0.22,
        side: THREE.DoubleSide,
        depthWrite: false,
        depthTest: false,
      });
      const planeMatZ = new THREE.MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0.22,
        side: THREE.DoubleSide,
        depthWrite: false,
        depthTest: false,
      });

      const planeX = new THREE.Mesh(new THREE.PlaneGeometry(1.002, 1.002), planeMatX);
      planeX.rotation.y = Math.PI / 2;
      planeX.renderOrder = 1;
      planeXRef.current = planeX;
      root.add(planeX);

      const planeY = new THREE.Mesh(new THREE.PlaneGeometry(1.002, 1.002), planeMatY);
      planeY.rotation.x = Math.PI / 2;
      planeY.renderOrder = 1;
      planeYRef.current = planeY;
      root.add(planeY);

      const planeZ = new THREE.Mesh(new THREE.PlaneGeometry(1.002, 1.002), planeMatZ);
      planeZ.renderOrder = 1;
      planeZRef.current = planeZ;
      root.add(planeZ);

      const edgeX = createPlaneEdges(0xef4444);
      edgeX.rotation.y = Math.PI / 2;
      edgeX.renderOrder = 2;
      planeEdgeXRef.current = edgeX;
      root.add(edgeX);

      const edgeY = createPlaneEdges(0x22c55e);
      edgeY.rotation.x = Math.PI / 2;
      edgeY.renderOrder = 2;
      planeEdgeYRef.current = edgeY;
      root.add(edgeY);

      const edgeZ = createPlaneEdges(0x3b82f6);
      edgeZ.renderOrder = 2;
      planeEdgeZRef.current = edgeZ;
      root.add(edgeZ);

      const spriteTexture = createCircleSpriteTexture();
      spriteTextureRef.current = spriteTexture;

      const pointsGeom = new THREE.BufferGeometry();
      const pointsMat = new THREE.PointsMaterial({
        size: 5.5,
        sizeAttenuation: false,
        vertexColors: true,
        transparent: true,
        opacity: 0.9,
        depthWrite: false,
        depthTest: true,
        map: spriteTexture,
        alphaTest: 0.08,
      });
      pointsMaterialRef.current = pointsMat;

      const pointsCloud = new THREE.Points(pointsGeom, pointsMat);
      pointsCloud.renderOrder = 5;
      pointsRef.current = pointsCloud;
      root.add(pointsCloud);

      const markerGroup = new THREE.Group();

      const markerSphere = new THREE.Mesh(
        new THREE.SphereGeometry(0.008, 8, 8),
        new THREE.MeshPhongMaterial({
          color: 0xf59e0b,
          specular: 0xffffff,
          shininess: 110,
          emissive: 0x000000,
          transparent: false,
          depthWrite: true,
          depthTest: true,
        }),
      );

      markerGroup.add(markerSphere);

      markerGroup.visible = false;
      markerGroup.renderOrder = 20;

      pickedMarkerRef.current = markerGroup;
      scene.add(markerGroup);

      const resize = () => {
        if (!rendererRef.current || !cameraRef.current || !mountRef.current) return;
        const w = mountRef.current.clientWidth;
        const h = mountRef.current.clientHeight;
        if (w <= 0 || h <= 0) return;
        rendererRef.current.setSize(w, h, false);
        cameraRef.current.aspect = w / h;
        cameraRef.current.updateProjectionMatrix();
      };

      resize();
      const ro = new ResizeObserver(() => resize());
      resizeObserverRef.current = ro;
      ro.observe(mount);

      localPointerDownHandler = (e: PointerEvent) => {
        if (e.button !== 0) return;
        e.stopPropagation();
        pickPointAtEvent(e);
      };
      renderer.domElement.addEventListener("pointerdown", localPointerDownHandler);

      const animate = () => {
        const rendererNow = rendererRef.current;
        const sceneNow = sceneRef.current;
        const cameraNow = cameraRef.current;
        const controlsNow = controlsRef.current;
        if (!rendererNow || !sceneNow || !cameraNow || !controlsNow) return;

        controlsNow.update();
        rendererNow.render(sceneNow, cameraNow);
        rafRef.current = requestAnimationFrame(animate);
      };
      animate();
    } catch (e: any) {
      setInitError(e?.message || "Failed to initialize 3D map");
    }

    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
      resizeObserverRef.current?.disconnect();

      const renderer = rendererRef.current;
      const scene = sceneRef.current;
      const controls = controlsRef.current;

      if (renderer && localPointerDownHandler) {
        renderer.domElement.removeEventListener("pointerdown", localPointerDownHandler);
      }

      if (pointsRef.current) {
        pointsRef.current.geometry.dispose();
      }
      pointsMaterialRef.current?.dispose();
      spriteTextureRef.current?.dispose();

      planeTextureXRef.current?.dispose();
      planeTextureYRef.current?.dispose();
      planeTextureZRef.current?.dispose();

      if (pickedMarkerRef.current) {
        pickedMarkerRef.current.traverse((obj) => {
          const anyObj = obj as any;
          if (anyObj.geometry?.dispose) {
            try {
              anyObj.geometry.dispose();
            } catch {
              // ignore
            }
          }
          if (anyObj.material) {
            const mat = anyObj.material;
            if (Array.isArray(mat)) {
              mat.forEach((m) => m?.dispose?.());
            } else {
              mat.dispose?.();
            }
          }
        });
      }
      if (boxLineRef.current) {
        boxLineRef.current.geometry.dispose();
        (boxLineRef.current.material as THREE.Material).dispose();
      }

      [planeXRef.current, planeYRef.current, planeZRef.current].forEach((m) => {
        if (!m) return;
        m.geometry.dispose();
        (m.material as THREE.Material).dispose();
      });

      [planeEdgeXRef.current, planeEdgeYRef.current, planeEdgeZRef.current].forEach((m) => {
        if (!m) return;
        m.geometry.dispose();
        (m.material as THREE.Material).dispose();
      });

      if (axesGroupRef.current) {
        axesGroupRef.current.traverse((obj) => {
          if ((obj as any).geometry?.dispose) {
            try {
              (obj as any).geometry.dispose();
            } catch {
              // ignore
            }
          }
          if ((obj as any).material) {
            const mat = (obj as any).material;
            if (Array.isArray(mat)) mat.forEach((mm) => mm?.dispose?.());
            else mat.dispose?.();
          }
        });
      }

      controls?.dispose();

      if (renderer && mountRef.current && renderer.domElement.parentElement === mountRef.current) {
        mountRef.current.removeChild(renderer.domElement);
      }
      renderer?.dispose();

      scene?.clear();

      rendererRef.current = null;
      sceneRef.current = null;
      cameraRef.current = null;
      controlsRef.current = null;
      rootRef.current = null;
      pointsRef.current = null;
      pointsMaterialRef.current = null;
      pickedMarkerRef.current = null;
      boxLineRef.current = null;
      axesGroupRef.current = null;
      planeXRef.current = null;
      planeYRef.current = null;
      planeZRef.current = null;
      planeEdgeXRef.current = null;
      planeEdgeYRef.current = null;
      planeEdgeZRef.current = null;
      spriteTextureRef.current = null;
      planeTextureXRef.current = null;
      planeTextureYRef.current = null;
      planeTextureZRef.current = null;
    };
  }, []);

  useEffect(() => {
    rootRef.current?.scale.copy(scaleVec);
  }, [scaleVec]);

  useEffect(() => {
    if (boxLineRef.current) boxLineRef.current.visible = showBox3d;
    if (axesGroupRef.current) axesGroupRef.current.visible = showAxes3d;
  }, [showBox3d, showAxes3d]);

  useEffect(() => {
    const px = planeXRef.current;
    const py = planeYRef.current;
    const pz = planeZRef.current;
    const ex = planeEdgeXRef.current;
    const ey = planeEdgeYRef.current;
    const ez = planeEdgeZRef.current;

    const planeVisibleX = showSlicePlanes3d && sliceIndexX != null;
    const planeVisibleY = showSlicePlanes3d && sliceIndexY != null;
    const planeVisibleZ = showSlicePlanes3d && sliceIndexZ != null;

    if (px) {
      px.visible = planeVisibleX;
      px.position.x = voxelToLocalZeroBasedSigned(sliceIndexX ?? 0, dimsObj.x, axisSigns.x);
      const mat = px.material as THREE.MeshBasicMaterial;
      mat.opacity = slicePlanesOpacity3d;
    }
    if (py) {
      py.visible = planeVisibleY;
      py.position.y = voxelToLocalZeroBasedSigned(sliceIndexY ?? 0, dimsObj.y, axisSigns.y);
      const mat = py.material as THREE.MeshBasicMaterial;
      mat.opacity = slicePlanesOpacity3d;
    }
    if (pz) {
      pz.visible = planeVisibleZ;
      pz.position.z = voxelToLocalZeroBasedSigned(sliceIndexZ ?? 0, dimsObj.z, axisSigns.z);
      const mat = pz.material as THREE.MeshBasicMaterial;
      mat.opacity = slicePlanesOpacity3d;
    }

    if (ex) {
      ex.visible = planeVisibleX;
      ex.position.x = voxelToLocalZeroBasedSigned(sliceIndexX ?? 0, dimsObj.x, axisSigns.x);
      ((ex.material as THREE.LineBasicMaterial).opacity = Math.max(
        0.25,
        Math.min(1, slicePlanesOpacity3d * 2.2),
      ));
    }
    if (ey) {
      ey.visible = planeVisibleY;
      ey.position.y = voxelToLocalZeroBasedSigned(sliceIndexY ?? 0, dimsObj.y, axisSigns.y);
      ((ey.material as THREE.LineBasicMaterial).opacity = Math.max(
        0.25,
        Math.min(1, slicePlanesOpacity3d * 2.2),
      ));
    }
    if (ez) {
      ez.visible = planeVisibleZ;
      ez.position.z = voxelToLocalZeroBasedSigned(sliceIndexZ ?? 0, dimsObj.z, axisSigns.z);
      ((ez.material as THREE.LineBasicMaterial).opacity = Math.max(
        0.25,
        Math.min(1, slicePlanesOpacity3d * 2.2),
      ));
    }
  }, [
    showSlicePlanes3d,
    slicePlanesOpacity3d,
    sliceIndexX,
    sliceIndexY,
    sliceIndexZ,
    dimsObj.x,
    dimsObj.y,
    dimsObj.z,
    axisSigns,
  ]);

  useEffect(() => {
    rawPointsRef.current = points;

    const cloud = pointsRef.current;
    if (!cloud) return;

    const mapper = buildPointMapper(points, dimsObj);
    mapperRef.current = mapper;
    setMappingSummary(
      `mapX:${mapper.x.mode} · mapY:${mapper.y.mode} · mapZ:${mapper.z.mode} · n=${points.length.toLocaleString("en-US")}`,
    );

    const n = points.length;
    const positions = new Float32Array(n * 3);
    const colors = new Float32Array(n * 3);

    let scoreMin = Infinity;
    let scoreMax = -Infinity;

    if (pointColorMode3d === "score") {
      for (const p of points as any[]) {
        const s = p?.score;
        if (typeof s === "number" && Number.isFinite(s)) {
          if (s < scoreMin) scoreMin = s;
          if (s > scoreMax) scoreMax = s;
        }
      }
      if (!Number.isFinite(scoreMin) || !Number.isFinite(scoreMax)) {
        scoreMin = 0;
        scoreMax = 1;
      }
    }

    const fixedColor = new THREE.Color(pointColor);

    for (let i = 0; i < n; i++) {
      const p: any = points[i];
      const x = Number(p.x);
      const y = Number(p.y);
      const z = Number(p.z);

      positions[i * 3 + 0] = mapPointAxisToLocalSigned(x, mapper.x, axisSigns.x);
      positions[i * 3 + 1] = mapPointAxisToLocalSigned(y, mapper.y, axisSigns.y);
      positions[i * 3 + 2] = mapPointAxisToLocalSigned(z, mapper.z, axisSigns.z);

      const c =
        pointColorMode3d === "fixed"
          ? fixedColor
          : pointColorMode3d === "class"
            ? classColorToThree(p.classId)
            : scoreColorToThree(p.score, scoreMin, scoreMax);

      colors[i * 3 + 0] = c.r;
      colors[i * 3 + 1] = c.g;
      colors[i * 3 + 2] = c.b;
    }

    const geom = cloud.geometry;
    geom.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geom.setAttribute("color", new THREE.BufferAttribute(colors, 3));

    if (n > 0) geom.computeBoundingSphere();
    else geom.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), 1);

    if (
      pickedIndexRef.current != null &&
      (pickedIndexRef.current < 0 || pickedIndexRef.current >= points.length)
    ) {
      pickedIndexRef.current = null;
      if (pickedMarkerRef.current) pickedMarkerRef.current.visible = false;
      onPickPoint?.(null);
    }
  }, [points, pointColor, pointColorMode3d, dimsObj, onPickPoint, axisSigns]);

  useEffect(() => {
    const mat = pointsMaterialRef.current;
    if (!mat) return;
    mat.opacity = pointOpacity3d;
    mat.size = Math.max(1.5, pointSize3d * Math.max(0.3, pointSizeFactor));
    mat.needsUpdate = true;
  }, [pointOpacity3d, pointSize3d, pointSizeFactor]);

  useEffect(() => {
    const rc = raycasterRef.current;
    rc.params.Points = { threshold: 0.028 };
  }, [pointSize3d, pointSizeFactor]);

  useEffect(() => {
    const cam = cameraRef.current;
    const ctrls = controlsRef.current;
    if (!cam || !ctrls) return;
    cam.position.set(1.9, 1.35, 2.0);
    ctrls.target.set(0, 0, 0);
    ctrls.update();
  }, [resetCameraNonce]);

  useEffect(() => {
    applyPlaneTexture({
      plane: planeZRef.current,
      url: sliceImageUrlZ ?? null,
      axis: "z",
      textureRef: planeTextureZRef,
      tokenRef: planeTextureLoadTokenRef,
    });
  }, [sliceImageUrlZ]);

  useEffect(() => {
    applyPlaneTexture({
      plane: planeYRef.current,
      url: sliceImageUrlY ?? null,
      axis: "y",
      textureRef: planeTextureYRef,
      tokenRef: planeTextureLoadTokenRef,
    });
  }, [sliceImageUrlY]);

  useEffect(() => {
    applyPlaneTexture({
      plane: planeXRef.current,
      url: sliceImageUrlX ?? null,
      axis: "x",
      textureRef: planeTextureXRef,
      tokenRef: planeTextureLoadTokenRef,
    });
  }, [sliceImageUrlX]);

  const pickPointAtEvent = (e: PointerEvent) => {
    const renderer = rendererRef.current;
    const camera = cameraRef.current;
    const cloud = pointsRef.current;
    const marker = pickedMarkerRef.current;
    const mapper = mapperRef.current;
    if (!renderer || !camera || !cloud || !marker || !mapper) return;

    const rect = renderer.domElement.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;

    mouseNdcRef.current.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    mouseNdcRef.current.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

    const rc = raycasterRef.current;
    rc.setFromCamera(mouseNdcRef.current, camera);

    const hits = rc.intersectObject(cloud, false);
    if (!hits.length) return;

    const hit = hits[0];
    const index = hit.index ?? null;
    if (index == null) return;

    const p = rawPointsRef.current[index];
    if (!p) return;

    pickedIndexRef.current = index;
    marker.visible = true;

    const localPickedPos = new THREE.Vector3(
      mapPointAxisToLocalSigned(Number((p as any).x), mapper.x, axisSigns.x),
      mapPointAxisToLocalSigned(Number((p as any).y), mapper.y, axisSigns.y),
      mapPointAxisToLocalSigned(Number((p as any).z), mapper.z, axisSigns.z),
    );

    const worldPickedPos = rootRef.current
      ? rootRef.current.localToWorld(localPickedPos.clone())
      : localPickedPos;

    marker.position.copy(worldPickedPos);

    const mappedSliceIndices = {
      x: pointAxisToNearestSliceIndex(Number((p as any).x), mapper.x),
      y: pointAxisToNearestSliceIndex(Number((p as any).y), mapper.y),
      z: pointAxisToNearestSliceIndex(Number((p as any).z), mapper.z),
    };

    onPickPoint?.(p, mappedSliceIndices);
  };

  useEffect(() => {
    const marker = pickedMarkerRef.current;
    const mapper = mapperRef.current;

    if (!marker) return;

    if (!pickedPoint || !mapper) {
      marker.visible = false;
      pickedIndexRef.current = null;
      return;
    }

    const raw = rawPointsRef.current;
    const idx = raw.findIndex((pp: any) => String(pp?.id) === String((pickedPoint as any).id));

    if (idx < 0) {
      marker.visible = false;
      pickedIndexRef.current = null;
      return;
    }

    pickedIndexRef.current = idx;
    marker.visible = true;

    const localPickedPos = new THREE.Vector3(
      mapPointAxisToLocalSigned(Number((pickedPoint as any).x), mapper.x, axisSigns.x),
      mapPointAxisToLocalSigned(Number((pickedPoint as any).y), mapper.y, axisSigns.y),
      mapPointAxisToLocalSigned(Number((pickedPoint as any).z), mapper.z, axisSigns.z),
    );

    const worldPickedPos = rootRef.current
      ? rootRef.current.localToWorld(localPickedPos.clone())
      : localPickedPos;

    marker.position.copy(worldPickedPos);
  }, [pickedPoint, axisSigns.x, axisSigns.y, axisSigns.z]);

  if (initError) {
    return (
      <Box sx={{ m: "auto" }}>
        <Typography variant="body2" color="error">
          {initError}
        </Typography>
      </Box>
    );
  }

  return (
    <Box
      sx={{
        width: "100%",
        height: "100%",
        minWidth: 0,
        minHeight: 0,
        position: "relative",
        borderRadius: 2,
        overflow: "hidden",
        border: "1px solid",
        borderColor: "divider",
        boxShadow: "0 12px 30px rgba(2,6,23,0.08)",
        bgcolor: "background.paper",
      }}
    >
      <Box
        ref={mountRef}
        sx={{
          width: "100%",
          height: "100%",
          minWidth: 0,
          minHeight: 0,
          "& canvas": {
            display: "block",
            width: "100% !important",
            height: "100% !important",
          },
        }}
      />

      <Box
        sx={{
          position: "absolute",
          top: 8,
          left: 8,
          px: 0.75,
          py: 0.45,
          borderRadius: 1,
          bgcolor: "rgba(0,0,0,0.55)",
          color: "common.white",
          pointerEvents: "none",
        }}
      >
        <Typography variant="caption" sx={{ color: "inherit" }}>
          3D map · drag orbit · wheel zoom · right drag pan · click point = sync slices
        </Typography>
      </Box>

      <Box
        sx={{
          position: "absolute",
          bottom: 8,
          left: 8,
          px: 0.75,
          py: 0.4,
          borderRadius: 1,
          bgcolor: "rgba(0,0,0,0.42)",
          color: "common.white",
          pointerEvents: "none",
          maxWidth: "80%",
        }}
      >
        <Typography variant="caption" sx={{ color: "inherit" }}>
          {mappingSummary}
        </Typography>
      </Box>
    </Box>
  );
}

function applyPlaneTexture(args: {
  plane: THREE.Mesh | null;
  url: string | null;
  axis: "x" | "y" | "z";
  textureRef: React.MutableRefObject<THREE.Texture | null>;
  tokenRef: React.MutableRefObject<{ x: number; y: number; z: number }>;
}) {
  const { plane, url, axis, textureRef, tokenRef } = args;
  if (!plane) return;

  const material = plane.material as THREE.MeshBasicMaterial;

  const disposeOld = () => {
    if (textureRef.current) {
      material.map = null;
      textureRef.current.dispose();
      textureRef.current = null;
      material.needsUpdate = true;
    }
  };

  if (!url) {
    disposeOld();
    return;
  }

  const currentToken = ++tokenRef.current[axis];
  const loader = new THREE.TextureLoader();

  loader.load(
    url,
    (tex) => {
      if (tokenRef.current[axis] !== currentToken) {
        tex.dispose();
        return;
      }

      disposeOld();

      tex.colorSpace = THREE.SRGBColorSpace;
      tex.minFilter = THREE.LinearFilter;
      tex.magFilter = THREE.LinearFilter;
      tex.wrapS = THREE.ClampToEdgeWrapping;
      tex.wrapT = THREE.ClampToEdgeWrapping;
      tex.generateMipmaps = false;

      tex.center.set(0.5, 0.5);
      tex.rotation = 0;

      if (axis === "x") {
        tex.rotation = -Math.PI / 2;
      }

      material.map = tex;
      material.color.set(0xffffff);
      material.needsUpdate = true;
      textureRef.current = tex;
    },
    undefined,
    () => {
      // ignore texture loading errors
    },
  );
}

function createAxisLine(a: THREE.Vector3, b: THREE.Vector3, colorHex: number) {
  const geom = new THREE.BufferGeometry().setFromPoints([a, b]);
  const mat = new THREE.LineBasicMaterial({
    color: colorHex,
    transparent: true,
    opacity: 0.95,
    depthWrite: false,
  });
  return new THREE.Line(geom, mat);
}

function createPlaneEdges(colorHex: number) {
  const geom = new THREE.EdgesGeometry(new THREE.PlaneGeometry(1.004, 1.004));
  const mat = new THREE.LineBasicMaterial({
    color: colorHex,
    transparent: true,
    opacity: 0.55,
    depthWrite: false,
    depthTest: false,
  });
  return new THREE.LineSegments(geom, mat);
}

function createCircleSpriteTexture(): THREE.Texture {
  const size = 64;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");

  if (!ctx) {
    const tex = new THREE.Texture();
    tex.needsUpdate = true;
    return tex;
  }

  const cx = size / 2;
  const cy = size / 2;
  const r = size * 0.34;

  ctx.clearRect(0, 0, size, size);

  const grad = ctx.createRadialGradient(cx, cy, r * 0.1, cx, cy, r);
  grad.addColorStop(0, "rgba(255,255,255,1)");
  grad.addColorStop(0.78, "rgba(255,255,255,0.98)");
  grad.addColorStop(1, "rgba(255,255,255,0)");

  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = "rgba(255,255,255,0.85)";
  ctx.lineWidth = 1.0;
  ctx.beginPath();
  ctx.arc(cx, cy, r * 0.92, 0, Math.PI * 2);
  ctx.stroke();

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

function buildPointMapper(
  points: Coords3dPointExt[],
  dims: { x: number; y: number; z: number },
): PointMapper {
  const xs = points.map((p: any) => Number(p.x)).filter(Number.isFinite);
  const ys = points.map((p: any) => Number(p.y)).filter(Number.isFinite);
  const zs = points.map((p: any) => Number(p.z)).filter(Number.isFinite);

  return {
    x: chooseAxisMapper(xs, dims.x),
    y: chooseAxisMapper(ys, dims.y),
    z: chooseAxisMapper(zs, dims.z),
  };
}

function chooseAxisMapper(values: number[], dim: number): AxisMapper {
  if (!values.length || !Number.isFinite(dim) || dim <= 1) {
    return { mode: "zeroBased", min: 0, max: Math.max(1, dim - 1), dim: Math.max(2, dim) };
  }

  let inZero = 0;
  let inOne = 0;
  let inNorm01 = 0;
  let inNormCentered = 0;
  let min = Infinity;
  let max = -Infinity;

  for (const v of values) {
    if (v >= -0.5 && v <= dim - 0.5) inZero++;
    if (v >= 0.5 && v <= dim + 0.5) inOne++;
    if (v >= -0.1 && v <= 1.1) inNorm01++;
    if (v >= -0.6 && v <= 0.6) inNormCentered++;
    if (v < min) min = v;
    if (v > max) max = v;
  }

  const n = values.length;
  const fracZero = inZero / n;
  const fracOne = inOne / n;
  const fracNorm01 = inNorm01 / n;
  const fracNormCentered = inNormCentered / n;
  const span = Math.max(1e-6, max - min);

  if (dim > 4) {
    if (min >= -0.1 && max <= 1.1 && fracNorm01 > 0.9) {
      return { mode: "normalized01", min: 0, max: 1, dim };
    }
    if (min >= -0.6 && max <= 0.6 && fracNormCentered > 0.9) {
      return { mode: "normalizedCentered", min: -0.5, max: 0.5, dim };
    }
  }

  if (fracZero >= 0.85 && fracZero >= fracOne + 0.08) {
    if (dim > 4 && span < 2.0 && fracNorm01 > 0.8) {
      return { mode: "normalized01", min: 0, max: 1, dim };
    }
    return { mode: "zeroBased", min: 0, max: dim - 1, dim };
  }

  if (fracOne >= 0.9 && fracOne >= fracZero + 0.15 && min >= 0.5) {
    return { mode: "oneBased", min: 1, max: dim, dim };
  }

  if (fracZero >= 0.7 || fracOne >= 0.7) {
    return { mode: "zeroBased", min: 0, max: dim - 1, dim };
  }

  const margin = span * 0.03;
  return { mode: "bounds", min: min - margin, max: max + margin, dim };
}

function mapPointAxisToLocal(v: number, mapper: AxisMapper): number {
  if (!Number.isFinite(v)) return 0;
  if (mapper.mode === "zeroBased") {
    return voxelToLocalZeroBased(v, mapper.dim);
  }
  if (mapper.mode === "oneBased") {
    return voxelToLocalOneBased(v, mapper.dim);
  }
  if (mapper.mode === "normalized01") {
    return clampFloatNum(v, 0, 1) - 0.5;
  }
  if (mapper.mode === "normalizedCentered") {
    return clampFloatNum(v + 0.5, 0, 1) - 0.5;
  }

  const denom = Math.max(1e-6, mapper.max - mapper.min);
  const t = (v - mapper.min) / denom;
  return clampFloatNum(t, 0, 1) - 0.5;
}

function applyAxisSignToLocal(localValue: number, axisSign: number): number {
  return axisSign < 0 ? -localValue : localValue;
}

function voxelToLocalZeroBasedSigned(v: number, dim: number, axisSign: number): number {
  return applyAxisSignToLocal(voxelToLocalZeroBased(v, dim), axisSign);
}

function mapPointAxisToLocalSigned(v: number, mapper: AxisMapper, axisSign: number): number {
  return applyAxisSignToLocal(mapPointAxisToLocal(v, mapper), axisSign);
}

function pointAxisToNearestSliceIndex(v: number, mapper: AxisMapper): number {
  if (!Number.isFinite(v)) return 0;
  const local = mapPointAxisToLocal(v, mapper);
  return localToNearestVoxelIndex(local, mapper.dim);
}

function localToNearestVoxelIndex(local: number, dim: number): number {
  if (!Number.isFinite(local)) return 0;
  if (!Number.isFinite(dim) || dim <= 1) return 0;
  const t = clampFloatNum(local + 0.5, 0, 1);
  return clampInt(Math.round(t * dim - 0.5), 0, Math.max(0, dim - 1));
}

function voxelToLocalZeroBased(v: number, dim: number): number {
  if (!Number.isFinite(v)) return 0;
  if (!Number.isFinite(dim) || dim <= 1) return 0;
  const t = (Number(v) + 0.5) / Number(dim);
  return clampFloatNum(t, 0, 1) - 0.5;
}

function voxelToLocalOneBased(v: number, dim: number): number {
  if (!Number.isFinite(v)) return 0;
  if (!Number.isFinite(dim) || dim <= 1) return 0;
  const t = (Number(v) - 0.5) / Number(dim);
  return clampFloatNum(t, 0, 1) - 0.5;
}

function classColorToThree(classId: any): THREE.Color {
  if (classId === null || classId === undefined) return new THREE.Color("#9ca3af");
  const key = String(classId);
  let h = 0;
  for (let i = 0; i < key.length; i++) {
    h = (h * 31 + key.charCodeAt(i)) >>> 0;
  }
  const hue = (h % 360) / 360;
  const c = new THREE.Color();
  c.setHSL(hue, 0.78, 0.56);
  return c;
}

function scoreColorToThree(score: any, min: number, max: number): THREE.Color {
  if (typeof score !== "number" || !Number.isFinite(score)) {
    return new THREE.Color("#94a3b8");
  }

  const denom = max > min ? max - min : 1;
  const t = clampFloatNum((score - min) / denom, 0, 1);

  const stops = [
    { t: 0.0, c: new THREE.Color("#3b82f6") },
    { t: 0.25, c: new THREE.Color("#06b6d4") },
    { t: 0.5, c: new THREE.Color("#22c55e") },
    { t: 0.75, c: new THREE.Color("#eab308") },
    { t: 1.0, c: new THREE.Color("#ef4444") },
  ];

  for (let i = 0; i < stops.length - 1; i++) {
    const a = stops[i];
    const b = stops[i + 1];
    if (t >= a.t && t <= b.t) {
      const u = (t - a.t) / Math.max(1e-6, b.t - a.t);
      return a.c.clone().lerp(b.c, u);
    }
  }

  return stops[stops.length - 1].c.clone();
}

function fmtCoord(v: any) {
  const n = Number(v);
  if (!Number.isFinite(n)) return "–";
  return Number.isInteger(n) ? String(n) : n.toFixed(2);
}

function clampFloatNum(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v));
}

function clampInt(v: number, lo: number, hi: number) {
  if (!Number.isFinite(v)) return lo;
  return Math.max(lo, Math.min(hi, Math.round(v)));
}

function hexToRgba(hex: string, alpha: number) {
  const h = hex.replace("#", "");
  const normalized =
    h.length === 3
      ? h
        .split("")
        .map((c) => c + c)
        .join("")
      : h;
  const num = parseInt(normalized, 16);
  const r = (num >> 16) & 255;
  const g = (num >> 8) & 255;
  const b = num & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function isHotkeyWindowActive(
  scopeEl: HTMLElement | null,
  lastInteractAt: number,
  activeEl: HTMLElement | null,
): boolean {
  if (!scopeEl) return false;

  if (activeEl && scopeEl.contains(activeEl)) return true;

  // Do not steal global hotkeys while typing in an input/textarea/contenteditable element.
  if (
    activeEl &&
    (activeEl.tagName === "INPUT" ||
      activeEl.tagName === "TEXTAREA" ||
      (activeEl as any).isContentEditable)
  ) {
    return false;
  }

  // Grace window: after interacting with the viewer, keep hotkeys routed here briefly,
  // even if focus is temporarily stolen by the surrounding ReactFlow node.
  const graceMs = 2500;
  const now = performance.now();
  return now - lastInteractAt < graceMs;
}


function useThrottledValue<T>(value: T, delayMs: number): T {
  const [throttled, setThrottled] = useState<T>(value);
  const lastExecutedRef = useRef<number>(0);
  const timeoutRef = useRef<number | null>(null);

  useEffect(() => {
    const now = performance.now();
    const elapsed = now - lastExecutedRef.current;

    const runNow = () => {
      lastExecutedRef.current = performance.now();
      setThrottled(value);
    };

    if (elapsed >= delayMs) {
      runNow();
      if (timeoutRef.current != null) {
        window.clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
    } else {
      if (timeoutRef.current != null) window.clearTimeout(timeoutRef.current);
      const remaining = delayMs - elapsed;
      timeoutRef.current = window.setTimeout(() => {
        runNow();
        timeoutRef.current = null;
      }, remaining);
    }

    return () => {
      if (timeoutRef.current != null) {
        window.clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
    };
  }, [value, delayMs]);

  return throttled;
}