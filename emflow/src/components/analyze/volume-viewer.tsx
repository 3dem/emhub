import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import {
  Box,
  Typography,
  CircularProgress,
  List,
  ListItemButton,
  ListItemText,
  Divider,
  ToggleButtonGroup,
  ToggleButton,
  TextField,
  MenuItem,
  Button,
  Paper,
  Slider,
  IconButton,
  Popover,
  Tooltip,
} from "@mui/material";
import { styled } from "@mui/material/styles";
import Plot from "@/lib/plot";
import { useProjectService } from "@/ProjectServiceContext";
import { ZoomIn, Layers3, HelpCircle, BoxIcon, Table as TableLucide, Pause, Play } from "lucide-react";
import MeshVolumeView, { type MeshCameraState } from "./mesh-volume-view";
import GpuVolumeView from "./gpu-volume-view";
import useVolumeRegions from "./use-volume-regions";
import {
  buildVolumeSliceOverlayDataUrl,
  type VolumeRenderData,
} from "./volume-color-utils";
import type { VolumeSurfaceMesh } from "@/services/ProjectService";
import { MetadataViewer } from "./metadata-viewer";
import ExternalViewersBar from "./ExternalViewersBar";

type VolumeViewerProps = {
  projectId: string | number;
  protocolId: string | number;
  outputName: string;
  protocolLabel?: string;
  pointerClass?: string;
  selectedVolumeId?: string | number | null;
  onVolumeSelect?: (volume: VolumeLite) => void;
  hideVolumeList?: boolean;
  hideMetadataAction?: boolean;
  active?: boolean;
};

type VolumeLite = {
  id: string | number;
  label?: string;
  name?: string;
  tomoId?: string | number | null;
  tsId?: string | number | null;
};

type HistogramData = {
  binEdges: number[];
  counts: number[];
};

type ViewMode = "slices" | "map3d" | "metadata";
type ThrMode = "percentile" | "absolute";
type RightTab = "ctrl" | "hist";
type Interp2d = "nearest" | "linear" | "high";
type RenderMode3d = "volume" | "surface" | "mesh";
type MeshColorMode3d = "solid" | "density" | "components";
type SliceLayoutMode = "single" | "triple";

type SliceImageState = {
  url: string | null;
  loading: boolean;
  error: string | null;
};

const DEFAULT_AXIS: "z" | "y" | "x" = "z";
const CMAP_OPTIONS = [
  "gray",
  "viridis",
  "magma",
  "plasma",
  "inferno",
  "cividis",
  "turbo",
];

const SURFACE_MAX_TRIANGLES = 500000;
const SURFACE_REQUEST_TIMEOUT_MS = 30000;
const SLICE_SLIDER_THROTTLE_MS = 80;

const SLICE_PREVIEW_MAX_SIDE = 768;
const SLICE_PREVIEW_FORMAT = "webp" as const;
const SLICE_PREVIEW_QUALITY = 75;

const SLICE_DRAG_PREVIEW_MAX_SIDE = 512;
const SLICE_DRAG_PREVIEW_QUALITY = 70;

const SLICE_WINDOW_LOW_QUANTILE = 0.005;
const SLICE_WINDOW_HIGH_QUANTILE = 0.995;

const ORTHO_AXIS_COLORS = {
  x: "#ef4444",
  y: "#22c55e",
  z: "#3b82f6",
} as const;

const HELP_TEXT: Record<string, string> = {
  maxDim3d:
    "3D rendering quality. Higher quality uses more data and may take longer to load.",
  method3d:
    "Downsampling method for interactive 3D rendering. Stride is the fastest option. None preserves the original grid only when the volume is already within the safe interactive limit.",
  colorMode3d:
    "Solid uses one surface color. Density colors the surface from its local intensity values. Components assigns a different color to each disconnected geometric region.",
  colormap3d:
    "Colormap used by Solid and Density modes. Components generates its own colors.",
  opacity3d:
    "Opacity of the volume along the ray. Higher values make the map more solid.",
  thrMode:
    "Threshold mode. Percentile uses histogram percentiles; Absolute uses real intensity values.",
  thrPct:
    "Percentile threshold range (0–100). The map is rendered between these percentiles.",
  thrAbs:
    "Absolute intensity threshold range. Voxels outside this range are suppressed.",
  surfaceCount:
    "Number of isosurfaces in Plotly fallback. Does not affect GPU raycasting.",
  sliceColorOverlay:
    "Overlay the raw slice with the same volumetric color modes used by the 3D viewer.",
  volumeWindow3d:
    "Percentile window used by GPU volume rendering. Narrower high-percentile windows emphasize stronger densities.",
  isoRenderMode3d:
    "Surface loads a real marching-cubes mesh, closer to Chimera/EMAN. Volume renders the density field by GPU raycasting.",
  axis: "Slice axis. Z/Y/X correspond to the 3D volume axes.",
  sliceLayout:
    "Single shows one slice view at a time. Triple shows synchronized orthogonal Z/Y/X views at once.",
  sliceIndex: "Slice index along the selected axis.",
  sliceIndexZ: "Z slice index (XY plane).",
  sliceIndexY: "Y slice index (XZ plane).",
  sliceIndexX: "X slice index (YZ plane).",
  colormap2d: "Colormap used for 2D slice rendering.",
  histogram: "Shows the intensity distribution of the selected volume.",
  interp2d:
    "Interpolation when zooming slices. Nearest for pixel look, Linear for smooth, High for best smoothing.",
  sharpen2d:
    "Applies a light 3×3 sharpening filter to the current slice (frontend only).",
  brightness2d:
    "Adjust brightness for slice display only (percentage around 100% neutral). Does not refetch the slice.",
  contrast2d:
    "Adjust contrast for slice display only (percentage around 100% neutral). Does not refetch the slice.",
  pan2d:
    "Pan single-view slices with Ctrl+drag or middle mouse. Reset with Fit.",
  zoom2d:
    "Mouse wheel zooms single-view slices. Double-click fits and resets pan.",
  surfaceLevel3d:
    "Absolute iso level for the marching-cubes surface. Leave it empty to let the backend choose an automatic level.",
  hideDust3d:
    "Removes small disconnected surface fragments. Standard is a good default for cryo-EM maps; turn it off when small isolated densities are scientifically relevant.",
  surfaceSmoothing3d:
    "Smooths the displayed surface while preserving its overall volume. It does not modify the original cryo-EM map.",
};

const SliceSlider = styled(Slider)(({ theme }) => ({
  height: 2,
  paddingTop: 14,
  paddingBottom: 30,
  "& .MuiSlider-thumb": { width: 14, height: 14 },
  "& .MuiSlider-valueLabel": {
    top: "unset",
    bottom: -26,
    transform: "translateY(0) scale(1)",
    background: "transparent",
    color: theme.palette.text.secondary,
    fontSize: "0.75rem",
    fontWeight: 500,
    "&:before": { display: "none" },
  },
  "& .MuiSlider-valueLabel.MuiSlider-valueLabelOpen": {
    transform: "translateY(0) scale(1)",
  },
}));

export default function VolumeViewer({
  projectId,
  protocolId,
  outputName,
  pointerClass,
  selectedVolumeId,
  onVolumeSelect,
  hideVolumeList = false,
  hideMetadataAction = false,
  active = true,
}: VolumeViewerProps) {
  const svc = useProjectService();

  const projectIdNum = useMemo(() => Number(projectId), [projectId]);
  const protocolIdNum = useMemo(() => Number(protocolId), [protocolId]);
  const pClass = useMemo(() => String(pointerClass), [pointerClass]);

  const canOpenMetadata = useMemo(() => {
    return Number.isFinite(projectIdNum) && Number.isFinite(protocolIdNum);
  }, [projectIdNum, protocolIdNum]);

  const [loadingList, setLoadingList] = useState(true);
  const [listError, setListError] = useState<string | null>(null);
  const [volumes, setVolumes] = useState<VolumeLite[]>([]);
  const [selectedId, setSelectedId] = useState<string | number | null>(null);

  const [metaLoading, setMetaLoading] = useState(false);
  const [metaError, setMetaError] = useState<string | null>(null);
  const [meta, setMeta] = useState<any>(null);
  const [metaVolumeId, setMetaVolumeId] = useState<string | number | null>(null);

  const [histogram, setHistogram] = useState<HistogramData | null>(null);
  const [histLoading, setHistLoading] = useState(false);
  const [histError, setHistError] = useState<string | null>(null);
  const [showHistogram, setShowHistogram] = useState(false);

  const [viewMode, setViewMode] = useState<ViewMode>("slices");
  const [rightTab, setRightTab] = useState<RightTab>("ctrl");

  const [sliceLayoutMode, setSliceLayoutMode] =
    useState<SliceLayoutMode>("triple");

  const [axis, setAxis] = useState<"z" | "y" | "x">(DEFAULT_AXIS);
  const [sliceIndex, setSliceIndex] = useState(0);
  const throttledSliceIndex = useThrottledValue(sliceIndex, SLICE_SLIDER_THROTTLE_MS);

  const [sliceIndexZ, setSliceIndexZ] = useState(0);
  const [sliceIndexY, setSliceIndexY] = useState(0);
  const [sliceIndexX, setSliceIndexX] = useState(0);

  const [draggingSlice, setDraggingSlice] = useState<null | "single" | "z" | "y" | "x">(null);

  const throttledSliceIndexZ = useThrottledValue(sliceIndexZ, SLICE_SLIDER_THROTTLE_MS);
  const throttledSliceIndexY = useThrottledValue(sliceIndexY, SLICE_SLIDER_THROTTLE_MS);
  const throttledSliceIndexX = useThrottledValue(sliceIndexX, SLICE_SLIDER_THROTTLE_MS);

  const effectiveSliceIndex =
    draggingSlice === "single" ? throttledSliceIndex : sliceIndex;

  const effectiveSliceIndexZ =
    draggingSlice === "z" ? throttledSliceIndexZ : sliceIndexZ;

  const effectiveSliceIndexY =
    draggingSlice === "y" ? throttledSliceIndexY : sliceIndexY;

  const effectiveSliceIndexX =
    draggingSlice === "x" ? throttledSliceIndexX : sliceIndexX;

  const [colormap, setColormap] = useState<string>("gray");
  const [interp2d, setInterp2d] = useState<Interp2d>("linear");
  const [sharpen2d, setSharpen2d] = useState(false);
  const [brightness2d, setBrightness2d] = useState(0);
  const [contrast2d, setContrast2d] = useState(1.5);
  const [sliceOverlayEnabled, setSliceOverlayEnabled] =
    useState(false);

  const [pan2d, setPan2d] = useState<{ x: number; y: number }>({ x: 0, y: 0 });


  const [sliceReloadNonce, setSliceReloadNonce] = useState(0);
  const bumpSliceReload = useCallback(() => {
    setSliceReloadNonce((n) => n + 1);
  }, []);

  const [mapLoading, setMapLoading] = useState(false);
  const [mapError, setMapError] = useState<string | null>(null);
  const [gpuError, setGpuError] = useState<string | null>(null);
  const [mapData, setMapData] =
    useState<VolumeRenderData | null>(null);

  const mapDataKeyRef = useRef("");

  const [surfaceMesh, setSurfaceMesh] = useState<VolumeSurfaceMesh | null>(null);
  const meshCameraStateRef = useRef<MeshCameraState | null>(null);
  const [surfaceLevel3d, setSurfaceLevel3d] = useState<number | null>(null);
  const [surfaceResolvedLevel, setSurfaceResolvedLevel] = useState<number | null>(null);
  const [surfaceLevelRange, setSurfaceLevelRange] = useState<[number, number] | null>(null);
  const [surfaceDust3d, setSurfaceDust3d] = useState(400);
  const [surfaceSmoothing3d, setSurfaceSmoothing3d] = useState(4);


  const [surfaceRefreshing, setSurfaceRefreshing] = useState(false);
  const [surfaceRefreshError, setSurfaceRefreshError] = useState<string | null>(null);
  const surfaceAbortRef = useRef<AbortController | null>(null);
  const surfaceRequestSeqRef = useRef(0);

  const volumeAbortRef = useRef<AbortController | null>(null);
  const volumeRequestSeqRef = useRef(0);

  const [maxDim3d, setMaxDim3d] = useState(256);
  const [method3d, setMethod3d] = useState<"none" | "binning" | "stride">("stride");

  const [surfaceCount, setSurfaceCount] = useState(3);
  const [opacity3d, setOpacity3d] = useState(1);
  const [colormap3d, setColormap3d] = useState<string>("viridis");
  const [colorMode3d, setColorMode3d] = useState<MeshColorMode3d>("solid");

  const [thrMode, setThrMode] = useState<ThrMode>("percentile");
  const [thrPct, setThrPct] = useState<[number, number]>([55, 98]);
  const [thrAbs, setThrAbs] = useState<[number, number]>([0, 1]);

  const [renderMode3d, setRenderMode3d] =
    useState<RenderMode3d>("surface");

  const usesSurfaceMesh3d = renderMode3d === "surface" || renderMode3d === "mesh";
  const needsHistogram =
    active &&
    selectedId != null &&
    (
      showHistogram ||
      viewMode === "map3d" ||
      viewMode === "slices"
    );

  const sliceIntensityWindow = useMemo<[number, number] | null>(() => {
    const histogramMin = histogram
      ? histogramWeightedQuantile(
        histogram,
        SLICE_WINDOW_LOW_QUANTILE,
      )
      : null;

    const histogramMax = histogram
      ? histogramWeightedQuantile(
        histogram,
        SLICE_WINDOW_HIGH_QUANTILE,
      )
      : null;

    if (
      histogramMin != null &&
      histogramMax != null &&
      Number.isFinite(histogramMin) &&
      Number.isFinite(histogramMax) &&
      histogramMax > histogramMin
    ) {
      return [histogramMin, histogramMax];
    }

    const metadataMin = firstFiniteNumber(meta?.min);
    const metadataMax = firstFiniteNumber(meta?.max);

    if (
      metadataMin != null &&
      metadataMax != null &&
      metadataMax > metadataMin
    ) {
      return [metadataMin, metadataMax];
    }

    return null;
  }, [histogram, meta]);

  const lastLoadedRef = useRef<{
    volumeId: string | number | null;
    maxDim: number;
    method: "binning" | "stride" | "none";
    renderMode: RenderMode3d;
    surfaceLevel: number | null;
    surfaceDust: number;
    surfaceSmoothing: number;
  }>({
    volumeId: null,
    maxDim: 256,
    method: "stride",
    renderMode: "surface",
    surfaceLevel: null,
    surfaceDust: 400,
    surfaceSmoothing: 4,
  });

  const lastThrVolumeRef = useRef<string | number | null>(null);

  const [helpAnchor, setHelpAnchor] = useState<HTMLElement | null>(null);
  const [helpKey, setHelpKey] = useState<string | null>(null);

  const openHelp = (key: string) => (e: React.MouseEvent<HTMLElement>) => {
    setHelpKey(key);
    setHelpAnchor(e.currentTarget);
  };
  const closeHelp = () => {
    setHelpAnchor(null);
    setHelpKey(null);
  };

  const [autoRotate3d, setAutoRotate3d] = useState(false);

  useEffect(() => {
    if (active) return;

    surfaceRequestSeqRef.current += 1;
    surfaceAbortRef.current?.abort();
    surfaceAbortRef.current = null;
    setMapLoading(false);
    setSurfaceRefreshing(false);
    setAutoRotate3d(false);
  }, [active]);

  useEffect(() => {
    return () => {
      surfaceRequestSeqRef.current += 1;
      surfaceAbortRef.current?.abort();
      surfaceAbortRef.current = null;

      volumeRequestSeqRef.current += 1;
      volumeAbortRef.current?.abort();
      volumeAbortRef.current = null;
    };
  }, []);

  // stopAutoRotateWhenLeaving3d
  useEffect(() => {
    if (viewMode !== "map3d") {
      setAutoRotate3d(false);
    }
  }, [viewMode]);

  useEffect(() => {
    const needsVolumeData =
      active &&
      (
        (viewMode === "map3d" && renderMode3d === "volume") ||
        (viewMode === "slices" && sliceOverlayEnabled)
      );

    if (needsVolumeData) return;

    volumeRequestSeqRef.current += 1;
    volumeAbortRef.current?.abort();
    volumeAbortRef.current = null;
  }, [
    active,
    viewMode,
    renderMode3d,
    sliceOverlayEnabled,
  ]);

  const plotlyAnimHandleRef = useRef<number | null>(null);
  const plotlyAnimAngleRef = useRef(0);
  const [plotlyAnimTick, setPlotlyAnimTick] = useState(0);

  useEffect(() => {
    const shouldAnimatePlotly =
      viewMode === "map3d" &&
      autoRotate3d &&
      (gpuError || !mapData);

    if (!shouldAnimatePlotly) {
      if (plotlyAnimHandleRef.current != null) {
        window.clearInterval(plotlyAnimHandleRef.current);
        plotlyAnimHandleRef.current = null;
      }
      return;
    }

    if (plotlyAnimHandleRef.current != null) {
      window.clearInterval(plotlyAnimHandleRef.current);
    }

    plotlyAnimHandleRef.current = window.setInterval(() => {
      plotlyAnimAngleRef.current += 0.03;

      const prev = plotlyCameraRef.current ?? {};
      const prevEye = prev?.eye ?? { x: 1.6, y: 1.2, z: 1.4 };

      const r = Math.max(
        0.8,
        Math.sqrt((prevEye.x ?? 0) * (prevEye.x ?? 0) + (prevEye.y ?? 0) * (prevEye.y ?? 0)) || 1.8,
      );
      const z = Number.isFinite(prevEye.z) ? prevEye.z : 1.4;

      const a = plotlyAnimAngleRef.current;
      plotlyCameraRef.current = {
        ...prev,
        eye: {
          x: r * Math.cos(a),
          y: r * Math.sin(a),
          z,
        },
      };

      setPlotlyAnimTick((t) => (t + 1) % 1000000);
    }, 33);

    return () => {
      if (plotlyAnimHandleRef.current != null) {
        window.clearInterval(plotlyAnimHandleRef.current);
        plotlyAnimHandleRef.current = null;
      }
    };
  }, [viewMode, renderMode3d, autoRotate3d, gpuError, mapData]);

  useEffect(() => {
    surfaceAbortRef.current?.abort();
    surfaceRequestSeqRef.current += 1;

    volumeRequestSeqRef.current += 1;
    volumeAbortRef.current?.abort();
    volumeAbortRef.current = null;

    setMapLoading(false);
    setSurfaceRefreshing(false);
    setSurfaceRefreshError(null);
    setMapError(null);
    setMapData(null);
    mapDataKeyRef.current = "";
    setSurfaceMesh(null);
    setSurfaceResolvedLevel(null);
    setSurfaceLevel3d(null);
    setSurfaceLevelRange(null);
    setGpuError(null);

    lastLoadedRef.current = {
      ...lastLoadedRef.current,
      volumeId: null,
    };
  }, [selectedId]);

  useEffect(() => {
    setRightTab("ctrl");
    setShowHistogram(false);
  }, [viewMode]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setLoadingList(true);
        setListError(null);
        const items = await svc.listOutputVolumes(
          projectId,
          protocolId,
          outputName,
        );
        if (cancelled) return;
        const mapped: VolumeLite[] = (items || []).map((v: any, i: number) => ({
          id: v?.id ?? i,
          label: v?.label ?? v?.name ?? `Volume ${v?.id ?? i}`,
          name: v?.name,
          tomoId: v?.tomoId ?? v?.tomogramId ?? null,
          tsId: v?.tsId ?? v?.tiltSeriesId ?? null,
        }));
        setVolumes(mapped);
        setSelectedId((prev) => {
          const exists = mapped.find(
            (m) => String(m.id) === String(prev ?? -999),
          );
          return exists ? (prev as any) : mapped[0]?.id ?? null;
        });
      } catch (e: any) {
        if (!cancelled) setListError(e?.message || "Failed to list volumes");
      } finally {
        if (!cancelled) setLoadingList(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [projectId, protocolId, outputName, svc]);

  useEffect(() => {
    if (selectedId == null) {
      setMeta(null);
      setMetaVolumeId(null);
      return;
    }

    let cancelled = false;

    (async () => {
      try {
        setMetaLoading(true);
        setMetaError(null);

        const info = await svc.getVolumeInfo(
          projectId,
          protocolId,
          outputName,
          selectedId,
        );

        if (cancelled) return;

        setMeta(info || null);
        setMetaVolumeId(selectedId);
      } catch (e: any) {
        if (!cancelled) {
          setMetaError(e?.message || "Failed to fetch volume info");
          setMeta(null);
          setMetaVolumeId(null);
        }
      } finally {
        if (!cancelled) setMetaLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [selectedId, projectId, protocolId, outputName, svc]);

  useEffect(() => {
    if (selectedVolumeId == null || volumes.length === 0) return;

    const match = volumes.find((v) => {
      return (
        String(v.id) === String(selectedVolumeId) ||
        String(v.tomoId) === String(selectedVolumeId) ||
        String(v.tsId) === String(selectedVolumeId) ||
        String(v.name) === String(selectedVolumeId) ||
        String(v.label) === String(selectedVolumeId)
      );
    });

    if (match && String(match.id) !== String(selectedId)) {
      setSelectedId(match.id);
    }
  }, [selectedVolumeId, volumes, selectedId]);

  useEffect(() => {
    if (!needsHistogram || selectedId == null) {
      setHistogram(null);
      setHistError(null);
      setHistLoading(false);
      return;
    }

    let cancelled = false;

    (async () => {
      try {
        setHistLoading(true);
        setHistError(null);

        const h = await svc.getVolumeHistogram(
          projectId,
          protocolId,
          outputName,
          selectedId,
        );
        if (cancelled) return;

        const raw: any = h ?? {};
        const binEdges: number[] =
          raw.binEdges ?? raw.bin_edges ?? raw.bins ?? [];
        const counts: number[] = raw.counts ?? raw.values ?? [];

        setHistogram({ binEdges, counts });
      } catch (e: any) {
        if (!cancelled) {
          setHistError(e?.message || "Failed to load histogram");
          setHistogram(null);
        }
      } finally {
        if (!cancelled) setHistLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [needsHistogram, selectedId, projectId, protocolId, outputName, svc]);

  const dims = useMemo(() => getDimsZYXtoXYZ(meta), [meta]);

  const selectedMetaReady =
    selectedId != null &&
    meta != null &&
    metaVolumeId != null &&
    String(metaVolumeId) === String(selectedId);

  const volumeSwitching =
    selectedId != null && !metaError && (metaLoading || !selectedMetaReady);

  const maxSlice = Math.max(0, dims[axis] - 1);
  const maxSliceZ = Math.max(0, dims.z - 1);
  const maxSliceY = Math.max(0, dims.y - 1);
  const maxSliceX = Math.max(0, dims.x - 1);

  useEffect(() => {
    if (!selectedMetaReady) return;

    const mid = Math.max(0, Math.floor(maxSlice / 2));
    setSliceIndex(mid);
  }, [selectedMetaReady, axis, maxSlice]);

  useEffect(() => {
    if (!selectedMetaReady) return;

    setSliceIndexZ(Math.max(0, Math.floor(maxSliceZ / 2)));
    setSliceIndexY(Math.max(0, Math.floor(maxSliceY / 2)));
    setSliceIndexX(Math.max(0, Math.floor(maxSliceX / 2)));
  }, [selectedMetaReady, maxSliceZ, maxSliceY, maxSliceX]);

  const readySlices = selectedId != null && selectedMetaReady && dims[axis] > 0;
  const readyTripleSlices =
    selectedId != null && selectedMetaReady && dims.x > 0 && dims.y > 0 && dims.z > 0;

  const buildSliceFetchOptions = useCallback(
    (isDragging: boolean) => ({
      thumb: isDragging
        ? SLICE_DRAG_PREVIEW_MAX_SIDE
        : SLICE_PREVIEW_MAX_SIDE,
      format: SLICE_PREVIEW_FORMAT,
      fast: true,
      quality: isDragging
        ? SLICE_DRAG_PREVIEW_QUALITY
        : SLICE_PREVIEW_QUALITY,
      windowMin: sliceIntensityWindow?.[0],
      windowMax: sliceIntensityWindow?.[1],
    }),
    [sliceIntensityWindow],
  );

  const singleSliceFetchOptions = useMemo(
    () => buildSliceFetchOptions(draggingSlice === "single"),
    [buildSliceFetchOptions, draggingSlice],
  );

  const zSliceFetchOptions = useMemo(
    () => buildSliceFetchOptions(draggingSlice === "z"),
    [buildSliceFetchOptions, draggingSlice],
  );

  const ySliceFetchOptions = useMemo(
    () => buildSliceFetchOptions(draggingSlice === "y"),
    [buildSliceFetchOptions, draggingSlice],
  );

  const xSliceFetchOptions = useMemo(
    () => buildSliceFetchOptions(draggingSlice === "x"),
    [buildSliceFetchOptions, draggingSlice],
  );

  const canShowExternalViewers = Boolean(
    selectedId != null &&
    meta != null &&
    !metaLoading &&
    !metaError &&
    String(metaVolumeId) === String(selectedId) &&
    readyTripleSlices,
  );

  useEffect(() => {
    if (viewMode === "slices" && (readySlices || readyTripleSlices)) {
      bumpSliceReload();
    }
  }, [viewMode, readySlices, readyTripleSlices, bumpSliceReload]);

  useEffect(() => {
    setZoomMul(1);
    setPan2d({ x: 0, y: 0 });
  }, [selectedId, axis]);

  const singleSlice = useVolumeSliceImage({
    enabled: active && viewMode === "slices" && sliceLayoutMode === "single" && readySlices,
    svc,
    projectId,
    protocolId,
    outputName,
    volumeId: selectedId,
    axis,
    maxSlice,
    colormap,
    sliceIndex: effectiveSliceIndex,
    requestOptions: singleSliceFetchOptions,
  });

  const frontUrl = singleSlice.url;
  const imgError = singleSlice.error;

  const zSlice = useVolumeSliceImage({
    enabled: active && viewMode === "slices" && sliceLayoutMode === "triple" && readyTripleSlices,
    svc,
    projectId,
    protocolId,
    outputName,
    volumeId: selectedId,
    axis: "z",
    sliceIndex: effectiveSliceIndexZ,
    maxSlice: maxSliceZ,
    colormap,
    reloadKey: sliceReloadNonce,
    requestOptions: zSliceFetchOptions,
  });

  const ySlice = useVolumeSliceImage({
    enabled: active && viewMode === "slices" && sliceLayoutMode === "triple" && readyTripleSlices,
    svc,
    projectId,
    protocolId,
    outputName,
    volumeId: selectedId,
    axis: "y",
    sliceIndex: effectiveSliceIndexY,
    maxSlice: maxSliceY,
    colormap,
    reloadKey: sliceReloadNonce,
    requestOptions: ySliceFetchOptions,
  });

  const xSlice = useVolumeSliceImage({
    enabled: active && viewMode === "slices" && sliceLayoutMode === "triple" && readyTripleSlices,
    svc,
    projectId,
    protocolId,
    outputName,
    volumeId: selectedId,
    axis: "x",
    sliceIndex: effectiveSliceIndexX,
    maxSlice: maxSliceX,
    colormap,
    reloadKey: sliceReloadNonce,
    requestOptions: xSliceFetchOptions,
  });

  const sliceImagesLoading =
    viewMode === "slices" &&
    !volumeSwitching &&
    (
      (sliceLayoutMode === "single" && singleSlice.loading && !singleSlice.url) ||
      (sliceLayoutMode === "triple" &&
        ((zSlice.loading && !zSlice.url) ||
          (ySlice.loading && !ySlice.url) ||
          (xSlice.loading && !xSlice.url)))
    );

  const waitingFor3dData =
    viewMode === "map3d" &&
    selectedId != null &&
    !mapError &&
    !gpuError &&
    (
      (usesSurfaceMesh3d && !surfaceMesh) ||
      (!usesSurfaceMesh3d && !mapData)
    );

  const showViewerLoading =
    volumeSwitching ||
    sliceImagesLoading ||
    mapLoading ||
    waitingFor3dData;

  const hasVisibleSliceContent =
    viewMode === "slices" &&
    (
      (sliceLayoutMode === "single" && !!singleSlice.url) ||
      (sliceLayoutMode === "triple" && (!!zSlice.url || !!ySlice.url || !!xSlice.url))
    );

  const [delayedViewerLoading, setDelayedViewerLoading] = useState(false);

  useEffect(() => {
    if (!showViewerLoading) {
      setDelayedViewerLoading(false);
      return;
    }

    if (!hasVisibleSliceContent) {
      setDelayedViewerLoading(true);
      return;
    }

    const timer = window.setTimeout(() => {
      setDelayedViewerLoading(true);
    }, 180);

    return () => {
      window.clearTimeout(timer);
    };
  }, [showViewerLoading, hasVisibleSliceContent]);

  const viewerLoadingVisible =
    showViewerLoading && (!hasVisibleSliceContent || delayedViewerLoading);

  const metadataSurfaceLevelRange = useMemo<[number, number] | null>(() => {

    const meshMin = firstFiniteNumber(surfaceMesh?.rangeMin);
    const meshMax = firstFiniteNumber(surfaceMesh?.rangeMax);

    if (meshMin != null && meshMax != null && meshMax > meshMin) {
      return [meshMin, meshMax];
    }

    const min = firstFiniteNumber(
      meta?.min,
      meta?.minimum,
      meta?.rangeMin,
      meta?.dataMin,
      meta?.valueMin,
    );

    const max = firstFiniteNumber(
      meta?.max,
      meta?.maximum,
      meta?.rangeMax,
      meta?.dataMax,
      meta?.valueMax,
    );

    if (min != null && max != null && max > min) {
      return [min, max];
    }

    return null;
  }, [surfaceMesh, meta]);



  useEffect(() => {
    if (metadataSurfaceLevelRange) {
      setSurfaceLevelRange(metadataSurfaceLevelRange);
    }
  }, [metadataSurfaceLevelRange]);

  const buildFallbackSurfaceLevelRange = useCallback((level: number): [number, number] => {
    const width = Math.max(Math.abs(level) * 4, 0.02);
    return [level - width, level + width];
  }, []);

  const cancelSurfaceRefresh = useCallback(() => {
    surfaceRequestSeqRef.current += 1;
    surfaceAbortRef.current?.abort();
    surfaceAbortRef.current = null;
    setSurfaceRefreshing(false);
    setMapLoading(false);
    setSurfaceRefreshError("Surface update cancelled. Keeping the previous surface.");
  }, []);

  const reloadSurfaceMesh = useCallback(
    async (
      level: number | null,
      opts: {
        silent?: boolean;
        minComponentTriangles?: number;
        smoothingIterations?: number;
      } = {},
    ) => {
      if (!active || selectedId == null) return;

      surfaceAbortRef.current?.abort();

      const controller = new AbortController();
      surfaceAbortRef.current = controller;

      const requestSeq = surfaceRequestSeqRef.current + 1;
      surfaceRequestSeqRef.current = requestSeq;

      const silent = opts.silent === true;

      const effectiveSurfaceDust =
        opts.minComponentTriangles ??
        surfaceDust3d;

      const effectiveSurfaceSmoothing =
        opts.smoothingIterations ??
        surfaceSmoothing3d;

      if (silent) {
        setSurfaceRefreshing(true);
      } else {
        setMapLoading(true);
      }

      setSurfaceRefreshError(null);
      setMapError(null);
      setGpuError(null);

      const requestLevel = clampIsoLevelToOpenRange(level, surfaceLevelRange);

      let timedOut = false;
      const timeoutId = window.setTimeout(() => {
        if (surfaceRequestSeqRef.current !== requestSeq) return;

        timedOut = true;
        surfaceRequestSeqRef.current += 1;
        controller.abort();

        if (surfaceAbortRef.current === controller) {
          surfaceAbortRef.current = null;
        }

        if (silent) {
          setSurfaceRefreshing(false);
          setSurfaceRefreshError("Surface update timed out. Keeping the previous surface.");
        } else {
          setMapLoading(false);
          setMapError("Surface loading timed out. Try a lower maxDim or binning.");
        }
      }, SURFACE_REQUEST_TIMEOUT_MS);

      try {
        const mesh = await svc.getVolumeSurfaceMesh(
          projectId,
          protocolId,
          outputName,
          selectedId,
          {
            level: requestLevel,
            maxDim: maxDim3d,
            method: method3d,
            maxTriangles: SURFACE_MAX_TRIANGLES,
            minComponentTriangles: effectiveSurfaceDust,
            smoothingIterations: effectiveSurfaceSmoothing,
            signal: controller.signal,
          },
        );

        if (
          controller.signal.aborted ||
          surfaceRequestSeqRef.current !== requestSeq
        ) {
          return;
        }

        const resolvedLevel = Number.isFinite(mesh?.level) ? Number(mesh.level) : null;

        setSurfaceMesh(mesh);
        setSurfaceResolvedLevel(resolvedLevel);
        setSurfaceRefreshError(null);

        if (metadataSurfaceLevelRange) {
          setSurfaceLevelRange(metadataSurfaceLevelRange);
        } else if (resolvedLevel != null) {
          setSurfaceLevelRange((prev) => {
            if (prev && resolvedLevel >= prev[0] && resolvedLevel <= prev[1]) {
              return prev;
            }

            return buildFallbackSurfaceLevelRange(resolvedLevel);
          });
        }

        lastLoadedRef.current = {
          volumeId: selectedId,
          maxDim: maxDim3d,
          method: method3d,
          renderMode: renderMode3d,
          surfaceLevel: requestLevel,
          surfaceDust: effectiveSurfaceDust,
          surfaceSmoothing: effectiveSurfaceSmoothing,
        };
      } catch (e: any) {
        if (surfaceRequestSeqRef.current !== requestSeq) return;

        if (controller.signal.aborted || e?.name === "AbortError") {
          if (!timedOut) return;
        }

        const message = e?.message || "Failed to load surface mesh";

        if (silent) {
          setSurfaceRefreshError(message);
        } else {
          setMapError(message);
          setSurfaceMesh(null);
          setSurfaceResolvedLevel(null);
        }
      } finally {
        window.clearTimeout(timeoutId);

        if (surfaceAbortRef.current === controller) {
          surfaceAbortRef.current = null;
        }

        if (surfaceRequestSeqRef.current === requestSeq) {
          if (silent) {
            setSurfaceRefreshing(false);
          } else {
            setMapLoading(false);
          }
        }
      }
    },
    [
      active,
      selectedId,
      svc,
      projectId,
      protocolId,
      outputName,
      maxDim3d,
      method3d,
      renderMode3d,
      metadataSurfaceLevelRange,
      buildFallbackSurfaceLevelRange,
      surfaceLevelRange,
      surfaceDust3d,
      surfaceSmoothing3d
    ],
  );

  const fetchVolumeData = useCallback(async () => {
    if (!active || selectedId == null) return null;

    volumeAbortRef.current?.abort();

    const controller = new AbortController();
    const requestSeq = volumeRequestSeqRef.current + 1;

    volumeRequestSeqRef.current = requestSeq;
    volumeAbortRef.current = controller;

    try {
      const raw = await svc.getVolumeData3d(
        projectId,
        protocolId,
        outputName,
        selectedId,
        {
          maxDim: maxDim3d,
          method: method3d,
          signal: controller.signal,
        },
      );

      if (
        controller.signal.aborted ||
        volumeRequestSeqRef.current !== requestSeq
      ) {
        return null;
      }

      const parsed = normalize3dPayload(raw);

      if (
        !parsed.values.length ||
        !parsed.dims.x ||
        !parsed.dims.y ||
        !parsed.dims.z
      ) {
        throw new Error("3D volume data is empty.");
      }

      setMapData(parsed);

      mapDataKeyRef.current = [
        String(selectedId),
        maxDim3d,
        method3d,
      ].join("|");

      return parsed;
    } finally {
      if (volumeAbortRef.current === controller) {
        volumeAbortRef.current = null;
      }
    }
  }, [
    active,
    selectedId,
    svc,
    projectId,
    protocolId,
    outputName,
    maxDim3d,
    method3d,
  ]);

  const load3d = useCallback(async () => {
    if (!active || selectedId == null) return;

    setMapLoading(true);
    setMapError(null);
    setGpuError(null);

    try {
      if (usesSurfaceMesh3d) {
        await reloadSurfaceMesh(surfaceLevel3d, { silent: false });
        return;
      }

      await fetchVolumeData();

      setSurfaceMesh(null);
      setSurfaceResolvedLevel(null);

      lastLoadedRef.current = {
        volumeId: selectedId,
        maxDim: maxDim3d,
        method: method3d,
        renderMode: renderMode3d,
        surfaceLevel: surfaceLevel3d,
        surfaceDust: surfaceDust3d,
        surfaceSmoothing: surfaceSmoothing3d,
      };
    } catch (e: any) {
      if (e?.name === "AbortError") {
        return;
      }
      setMapError(e?.message || "Failed to load 3D data");
      setMapData(null);
      setSurfaceMesh(null);
      setSurfaceResolvedLevel(null);
    } finally {
      setMapLoading(false);
    }
  }, [
    active,
    selectedId,
    svc,
    projectId,
    protocolId,
    outputName,
    maxDim3d,
    method3d,
    renderMode3d,
    surfaceLevel3d,
    usesSurfaceMesh3d,
    reloadSurfaceMesh,
    fetchVolumeData,
    surfaceDust3d,
    surfaceSmoothing3d
  ]);

  useEffect(() => {
    if (!active) return;
    if (viewMode !== "map3d") return;
    if (selectedId == null) return;

    const last = lastLoadedRef.current;
    if (last.volumeId !== selectedId || last.renderMode !== renderMode3d) {
      load3d();
    }
  }, [active, viewMode, selectedId, renderMode3d, load3d]);

  useEffect(() => {
    if (
      !active ||
      viewMode !== "slices" ||
      !sliceOverlayEnabled ||
      selectedId == null
    ) {
      return;
    }

    const expectedKey = [
      String(selectedId),
      maxDim3d,
      method3d,
    ].join("|");

    if (
      mapData &&
      mapDataKeyRef.current === expectedKey
    ) {
      return;
    }

    void fetchVolumeData().catch((error) => {
      setMapError(
        error?.message ||
        "Failed to load volumetric overlay data.",
      );
    });
  }, [
    active,
    viewMode,
    sliceOverlayEnabled,
    selectedId,
    maxDim3d,
    method3d,
    mapData,
    fetchVolumeData,
  ]);

  const dataDirty = useMemo(() => {
    const last = lastLoadedRef.current;

    return (
      viewMode === "map3d" &&
      selectedId != null &&
      (last.volumeId !== selectedId ||
        last.maxDim !== maxDim3d ||
        last.method !== method3d ||
        last.renderMode !== renderMode3d ||
        last.surfaceLevel !== surfaceLevel3d ||
        last.surfaceDust !== surfaceDust3d ||
        last.surfaceSmoothing !== surfaceSmoothing3d)
    );
  }, [
    viewMode,
    selectedId,
    maxDim3d,
    method3d,
    renderMode3d,
    surfaceLevel3d,
    surfaceDust3d,
    surfaceSmoothing3d
  ]);

  const stats3d = useMemo(() => {
    if (!mapData?.values?.length) return null;

    const payloadMin = firstFiniteNumber(mapData.min);
    const payloadMax = firstFiniteNumber(mapData.max);

    if (
      payloadMin != null &&
      payloadMax != null &&
      payloadMax > payloadMin
    ) {
      return {
        min: payloadMin,
        max: payloadMax,
      };
    }

    let min = Infinity;
    let max = -Infinity;

    for (const value of mapData.values) {
      if (!Number.isFinite(value)) continue;
      min = Math.min(min, value);
      max = Math.max(max, value);
    }

    return Number.isFinite(min) &&
      Number.isFinite(max) &&
      max > min
      ? { min, max }
      : null;
  }, [mapData]);

  useEffect(() => {
    if (
      !histogram ||
      selectedId == null ||
      lastThrVolumeRef.current === selectedId
    ) {
      return;
    }

    const low =
      histogramWeightedQuantile(histogram, 0.55);

    const high =
      histogramWeightedQuantile(histogram, 0.98);

    if (low != null && high != null && high > low) {
      setThrPct([55, 98]);
      setThrAbs([low, high]);
      lastThrVolumeRef.current = selectedId;
    }
  }, [histogram, selectedId]);

  const thrPctAbs = useMemo(() => {
    if (histogram) {
      const low = histogramWeightedQuantile(
        histogram,
        thrPct[0] / 100,
      );

      const high = histogramWeightedQuantile(
        histogram,
        thrPct[1] / 100,
      );

      if (
        low != null &&
        high != null &&
        high > low
      ) {
        return [low, high] as [number, number];
      }
    }

    if (!stats3d) return null;

    const span = stats3d.max - stats3d.min;

    return [
      stats3d.min + span * (thrPct[0] / 100),
      stats3d.min + span * (thrPct[1] / 100),
    ] as [number, number];
  }, [histogram, thrPct, stats3d]);

  const isoRange3d = useMemo(() => {
    if (!stats3d) return null;
    if (thrMode === "percentile") return thrPctAbs;
    const lo = Math.min(thrAbs[0], thrAbs[1]);
    const hi = Math.max(thrAbs[0], thrAbs[1]);
    return [lo, hi] as [number, number];
  }, [thrMode, thrPctAbs, thrAbs, stats3d]);

  const plotlyCameraRef = useRef<any>(null);
  const handleRelayout = useCallback((ev: any) => {
    const cam = ev?.["scene.camera"] ?? ev?.scene?.camera;
    if (cam) plotlyCameraRef.current = cam;
  }, []);

  const viewerRef = useRef<HTMLDivElement | null>(null);
  const [naturalW, setNaturalW] = useState<number | null>(null);
  const [naturalH, setNaturalH] = useState<number | null>(null);
  const [zoomMul, setZoomMul] = useState(1);
  const MIN_MUL = 0.25;
  const MAX_MUL = 4;

  const { width: vw, height: vh } = useElementSize(viewerRef);

  const fitScale = useMemo(() => {
    if (!naturalW || !naturalH || !vw || !vh) return 1;
    const sx = vw / naturalW;
    const sy = vh / naturalH;
    return Math.min(sx, sy);
  }, [naturalW, naturalH, vw, vh]);

  const renderScale = useMemo(() => fitScale * zoomMul, [fitScale, zoomMul]);

  const applyZoom = (mul: number) =>
    setZoomMul(() => Math.min(MAX_MUL, Math.max(MIN_MUL, mul)));
  const stepZoom = (factor: number) => applyZoom(zoomMul * factor);
  const fitZoom = () => {
    applyZoom(1);
    setPan2d({ x: 0, y: 0 });
  };

  useEffect(() => {
    const el = viewerRef.current;
    if (!el) return;

    const onWheel = (e: WheelEvent) => {
      if (
        viewMode !== "slices" ||
        sliceLayoutMode !== "single" ||
        !frontUrl
      ) {
        return;
      }
      e.preventDefault();
      const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
      stepZoom(factor);
    };

    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [viewMode, sliceLayoutMode, frontUrl, zoomMul]);

  useEffect(() => {
    const el = viewerRef.current;
    if (!el) return;

    let panning = false;
    let lastX = 0;
    let lastY = 0;

    const onPointerDown = (e: PointerEvent) => {
      if (
        viewMode !== "slices" ||
        sliceLayoutMode !== "single" ||
        !frontUrl
      ) {
        return;
      }
      const isMiddle = e.button === 1;
      if (!e.ctrlKey && !isMiddle) return;

      panning = true;
      lastX = e.clientX;
      lastY = e.clientY;
      (el as any).setPointerCapture?.(e.pointerId);
      el.style.cursor = "grabbing";
    };

    const onPointerMove = (e: PointerEvent) => {
      if (!panning) return;
      const dx = e.clientX - lastX;
      const dy = e.clientY - lastY;
      lastX = e.clientX;
      lastY = e.clientY;
      setPan2d((prev) => ({ x: prev.x + dx, y: prev.y + dy }));
    };

    const onPointerUp = (e: PointerEvent) => {
      if (!panning) return;
      panning = false;
      (el as any).releasePointerCapture?.(e.pointerId);
      el.style.cursor = "default";
    };

    el.addEventListener("pointerdown", onPointerDown);
    el.addEventListener("pointermove", onPointerMove);
    el.addEventListener("pointerup", onPointerUp);
    el.addEventListener("pointercancel", onPointerUp);
    el.addEventListener("pointerleave", onPointerUp);

    return () => {
      el.removeEventListener("pointerdown", onPointerDown);
      el.removeEventListener("pointermove", onPointerMove);
      el.removeEventListener("pointerup", onPointerUp);
      el.removeEventListener("pointercancel", onPointerUp);
      el.removeEventListener("pointerleave", onPointerUp);
    };
  }, [viewMode, sliceLayoutMode, frontUrl]);

  const handleMeshError = useCallback((msg: string) => {
    setGpuError(msg);
  }, []);

  const panelBasis = 340;

  const histogramLevelRange = useMemo<[number, number] | null>(() => {
    const range = getHistogramDisplayRange(histogram, 0.005, 0.995);
    if (range) return range;

    const edges = histogram?.binEdges ?? [];
    if (edges.length < 2) return null;

    const min = firstFiniteNumber(edges[0]);
    const max = firstFiniteNumber(edges[edges.length - 1]);

    if (min != null && max != null && max > min) {
      return [min, max];
    }

    return null;
  }, [histogram]);


  const surfaceLevelValue = useMemo(() => {
    return (
      surfaceLevel3d ??
      surfaceResolvedLevel ??
      surfaceMesh?.level ??
      isoRange3d?.[1] ??
      (surfaceLevelRange
        ? surfaceLevelRange[0] +
        0.75 *
        (surfaceLevelRange[1] - surfaceLevelRange[0])
        : 0)
    );
  }, [
    surfaceLevel3d,
    surfaceResolvedLevel,
    surfaceMesh,
    isoRange3d,
    surfaceLevelRange,
  ]);

  const needsVolumeRegions =
    active &&
    colorMode3d === "components" &&
    (
      (viewMode === "map3d" &&
        renderMode3d === "volume") ||
      (viewMode === "slices" &&
        sliceOverlayEnabled)
    );

  const {
    regions: volumeRegions,
    loading: volumeRegionsLoading,
    error: volumeRegionsError,
  } = useVolumeRegions({
    enabled: needsVolumeRegions,
    data: mapData,
    level: surfaceLevelValue,
    minRegionVoxels: 12,
    maxRegions: 96,
  });

  const buildSliceOverlay = useCallback(
    (
      sliceAxis: "x" | "y" | "z",
      index: number,
    ) => {
      if (!sliceOverlayEnabled || !mapData) {
        return null;
      }

      return buildVolumeSliceOverlayDataUrl({
        data: mapData,
        regions: volumeRegions,
        axis: sliceAxis,
        sourceIndex: index,
        sourceDims: dims,
        colorMode: colorMode3d,
        level: surfaceLevelValue,
        opacity: opacity3d,
        colormap: colormap3d,
      });
    },
    [
      sliceOverlayEnabled,
      mapData,
      volumeRegions,
      dims,
      colorMode3d,
      surfaceLevelValue,
      opacity3d,
      colormap3d,
    ],
  );

  const singleOverlayUrl = useMemo(
    () => buildSliceOverlay(axis, effectiveSliceIndex),
    [buildSliceOverlay, axis, effectiveSliceIndex],
  );

  const zOverlayUrl = useMemo(
    () => buildSliceOverlay("z", effectiveSliceIndexZ),
    [buildSliceOverlay, effectiveSliceIndexZ],
  );

  const yOverlayUrl = useMemo(
    () => buildSliceOverlay("y", effectiveSliceIndexY),
    [buildSliceOverlay, effectiveSliceIndexY],
  );

  const xOverlayUrl = useMemo(
    () => buildSliceOverlay("x", effectiveSliceIndexX),
    [buildSliceOverlay, effectiveSliceIndexX],
  );

  const meshCameraStateKey = useMemo(
    () =>
      `${projectIdNum}:${protocolIdNum}:${outputName}:${String(selectedId ?? "none")}`,
    [projectIdNum, protocolIdNum, outputName, selectedId],
  );

  return (
    <Box
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
          borderRight: "1px solid #eee",
          display: hideVolumeList ? "none" : "flex",
          flexDirection: "column",
          minHeight: 0,
          overflow: "hidden",
        }}
      >
        <Box sx={{ p: 1.5, flexShrink: 0 }}>
          <Typography variant="subtitle2">Volumes</Typography>
          <Typography variant="caption" color="text.secondary">
            {loadingList ? "" : `${volumes.length} item(s)`}
          </Typography>
        </Box>
        <Divider />
        <Box sx={{ flex: 1, minHeight: 0, overflow: "auto" }}>
          {loadingList ? (
            <Box sx={{ p: 2, display: "flex", gap: 1, alignItems: "center" }}>
              <CircularProgress size={18} />
              <Typography variant="body2" color="text.secondary">
                Loading tomograms...
              </Typography>
            </Box>
          ) : listError ? (
            <Box sx={{ p: 2 }}>
              <Typography variant="body2" color="error">
                {listError}
              </Typography>
            </Box>
          ) : volumes.length === 0 ? (
            <Box sx={{ p: 2 }}>
              <Typography variant="body2" color="text.secondary">
                No volumes in this output.
              </Typography>
            </Box>
          ) : (
            <List dense disablePadding>
              {volumes.map((v) => {
                const selected = String(selectedId) === String(v.id);
                return (
                  <ListItemButton
                    key={String(v.id)}
                    selected={selected}
                    onClick={() => {
                      setSelectedId(v.id);
                      onVolumeSelect?.(v);
                    }}
                    sx={{ px: 1.5, py: 1 }}
                  >
                    <ListItemText
                      primaryTypographyProps={{
                        variant: "body2",
                        noWrap: true,
                      }}
                      primary={v.label || `Volume ${String(v.id)}`}
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
          sx={{ p: 0.75, borderBottom: "1px solid #eee", flexShrink: 0 }}
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
            <Box sx={{ display: "flex", alignItems: "center", gap: 1.25 }}>
              <ToggleButtonGroup
                size="small"
                exclusive
                value={viewMode}
                onChange={(_, v) => v && setViewMode(v)}
              >
                <ToggleButton value="slices">
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
                {pClass.toLowerCase().startsWith("setof") && !hideMetadataAction ? (
                  <ToggleButton value="metadata" disabled={!canOpenMetadata}>
                    <Box sx={{ display: "inline-flex", alignItems: "center", gap: 0.5 }}>
                      <TableLucide size={14} />
                      Metadata
                    </Box>
                  </ToggleButton>
                ) : null}

              </ToggleButtonGroup>
            </Box>

            <Box
              sx={{
                display: "flex",
                alignItems: "center",
                justifyContent: "flex-end",
                gap: 0.75,
                flexWrap: "wrap",
                minWidth: 0,
              }}
            >
              {canShowExternalViewers && (
                <ExternalViewersBar
                  projectId={projectId}
                  protocolId={protocolId}
                  outputName={outputName}
                  objectId={selectedId}
                  objectKind="volume"
                />
              )}

              {viewMode === "map3d" && (
                <Tooltip title={autoRotate3d ? "Pause rotation" : "Play rotation"}>
                  <span>
                    <IconButton
                      size="small"
                      onClick={() => setAutoRotate3d((v) => !v)}
                      sx={{
                        border: "1px solid",
                        borderColor: "divider",
                        borderRadius: 1.5,
                      }}
                    >
                      {autoRotate3d ? <Pause size={16} /> : <Play size={16} />}
                    </IconButton>
                  </span>
                </Tooltip>
              )}

              <Box sx={{ display: "flex", alignItems: "center", gap: 1.25 }}>
                <Box
                  sx={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 0.5,
                    cursor: "default",
                    opacity:
                      viewMode === "slices" && sliceLayoutMode === "single"
                        ? 1
                        : 0.4,
                  }}
                >
                  <ZoomIn size={14} style={{ opacity: 0.6 }} />
                  <Typography
                    variant="caption"
                    color="text.secondary"
                    sx={{
                      fontVariantNumeric: "tabular-nums",
                      minWidth: "5ch",
                      textAlign: "right",
                    }}
                  >
                    {Math.round(zoomMul * 100)}%
                  </Typography>
                </Box>
              </Box>
            </Box>
          </Box>
        </Paper>

        <Box sx={{ flex: 1, display: "flex", minHeight: 0, minWidth: 0, overflow: "hidden" }}>
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
            <Box
              ref={viewerRef}
              onDoubleClick={
                viewMode === "slices" && sliceLayoutMode === "single"
                  ? fitZoom
                  : undefined
              }
              sx={{
                flex: 1,
                minHeight: 0,
                display: "flex",
                alignItems: viewMode === "metadata" ? "stretch" : "center",
                justifyContent: viewMode === "metadata" ? "stretch" : "center",
                p: viewMode === "metadata" ? 0 : 1.0,
                overflow: viewMode === "metadata" ? "auto" : "hidden",
                position: "relative",
                cursor: "default",
                bgcolor: "background.default",
              }}
              title={
                viewMode === "slices" && sliceLayoutMode === "single"
                  ? "Wheel: zoom | Ctrl+drag: pan | Double-click: fit"
                  : undefined
              }
            >
              {viewerLoadingVisible ? (
                <Box sx={{ display: "flex", gap: 1, alignItems: "center", color: "text.secondary" }}>
                  <CircularProgress size={18} />
                  <Typography variant="body2">
                    {viewMode === "map3d"
                      ? "Loading 3D map..."
                      : volumeSwitching
                        ? "Loading tomogram..."
                        : "Loading slices..."}
                  </Typography>
                </Box>
              ) : metaError ? (
                <Typography variant="body2" color="error">
                  {metaError}
                </Typography>
              ) : selectedId == null ? (
                <Typography variant="body2" color="text.secondary">
                  Select a volume
                </Typography>
              ) : viewMode === "metadata" ? (
                <Box sx={{ width: "100%", height: "100%", minHeight: 0 }}>
                  {canOpenMetadata ? (
                    <MetadataViewer
                      projectId={projectIdNum}
                      protocolId={protocolIdNum}
                      outputName={outputName}
                      onClose={() => setViewMode("slices")}
                      embedded={true}
                    />
                  ) : (
                    <Typography variant="body2" color="text.secondary">
                      Metadata view requires numeric projectId/protocolId.
                    </Typography>
                  )}
                </Box>
              ) : viewMode === "slices" ? (
                sliceLayoutMode === "triple" ? (
                  <OrthoSlicesGrid
                    dims={dims}
                    zSlice={zSlice}
                    ySlice={ySlice}
                    xSlice={xSlice}
                    sliceIndexX={sliceIndexX}
                    sliceIndexY={sliceIndexY}
                    sliceIndexZ={sliceIndexZ}
                    brightness={brightness2d}
                    contrast={contrast2d}
                    zOverlayUrl={zOverlayUrl}
                    yOverlayUrl={yOverlayUrl}
                    xOverlayUrl={xOverlayUrl}
                  />
                ) : imgError ? (
                  <Typography variant="body2" color="error">
                    {imgError}
                  </Typography>
                ) : frontUrl ? (
                  <>
                    <SlicesCanvas
                      url={frontUrl}
                      overlayUrl={singleOverlayUrl}
                      containerW={vw}
                      containerH={vh}
                      scale={renderScale}
                      pan={pan2d}
                      interp={interp2d}
                      sharpen={sharpen2d}
                      brightness={brightness2d}
                      contrast={contrast2d}
                      onNaturalSize={(w, h) => {
                        setNaturalW(w);
                        setNaturalH(h);
                      }}
                    />
                    <SlicesStatusBar
                      axis={axis}
                      sliceIndex={sliceIndex}
                      maxSlice={maxSlice}
                      zoomMul={zoomMul}
                      colormap={colormap}
                      interp={interp2d}
                      sharpen={sharpen2d}
                      brightness={brightness2d}
                      contrast={contrast2d}
                    />
                  </>
                ) : (
                  <Typography variant="body2" color="text.secondary">
                    No image
                  </Typography>
                )
              ) : mapError ? (
                <Typography variant="body2" color="error">
                  {mapError}
                </Typography>
              ) : (
                active &&
                renderMode3d === "volume" &&
                mapData &&
                stats3d &&
                isoRange3d &&
                !gpuError
              ) ? (
                <GpuVolumeView
                  values={mapData.values}
                  dims={mapData.dims}
                  order={mapData.order}
                  rangeMin={stats3d.min}
                  rangeMax={stats3d.max}
                  isoMin={isoRange3d[0]}
                  isoMax={isoRange3d[1]}
                  opacity={opacity3d}
                  colormap={colormap3d}
                  colorMode={colorMode3d}
                  regions={volumeRegions}
                  renderMode="volume"
                  autoRotate={autoRotate3d}
                  autoRotateSpeed={0.8}
                  onError={handleMeshError}
                />
              ) : usesSurfaceMesh3d && surfaceMesh && !gpuError ? (
                <MeshVolumeView
                  mesh={surfaceMesh}
                  displayMode={renderMode3d === "mesh" ? "mesh" : "surface"}
                  opacity={opacity3d}
                  colormap={colormap3d}
                  colorMode={colorMode3d}
                  autoRotate={autoRotate3d}
                  autoRotateSpeed={3.8}
                  cameraStateKey={meshCameraStateKey}
                  cameraStateRef={meshCameraStateRef}
                  onError={handleMeshError}
                  active={active && viewMode === "map3d"}
                />
              ) : usesSurfaceMesh3d && gpuError ? (
                <Typography variant="body2" color="error">
                  {gpuError}
                </Typography>

              ) : gpuError ? (
                <Typography variant="body2" color="error">
                  {gpuError}
                </Typography>
              ) : (
                <Typography variant="body2" color="text.secondary">
                  3D data is not available for this tomogram.
                </Typography>
              )}
            </Box>
            {viewMode !== "metadata" && (
              <>
                <Divider />
                <Box sx={{ p: 1.0, display: "flex", gap: 3, flexWrap: "wrap", flexShrink: 0 }}>
                  <MetaItem label="Dims" value={dimsToStringXYZ(dims)} />
                  {"min" in (meta || {}) && <MetaItem label="Min" value={num(meta?.min)} />}
                  {"max" in (meta || {}) && <MetaItem label="Max" value={num(meta?.max)} />}
                  {"mean" in (meta || {}) && <MetaItem label="Mean" value={num(meta?.mean)} />}
                  {"std" in (meta || {}) && <MetaItem label="Std" value={num(meta?.std)} />}
                  {viewMode === "map3d" && mapData?.dims && (
                    <MetaItem
                      label="Downsampled"
                      value={`${mapData.dims.x} × ${mapData.dims.y} × ${mapData.dims.z}`}
                    />
                  )}
                  {viewMode === "map3d" && renderMode3d === "surface" && surfaceMesh && (
                    <>
                      <MetaItem
                        label="Surface"
                        value={`${surfaceMesh.vertexCount} vertices / ${surfaceMesh.triangleCount} tris`}
                      />
                      <MetaItem
                        label="Level"
                        value={formatSci(surfaceResolvedLevel ?? surfaceMesh.level)}
                      />
                    </>
                  )}
                </Box>
              </>
            )}
          </Box>

          {viewMode !== "metadata" && (
            <>
              <Divider orientation="vertical" flexItem />
              <Box
                sx={{
                  flexBasis: panelBasis,
                  flexShrink: 0,
                  minWidth: panelBasis,
                  maxWidth: panelBasis,
                  p: 1.25,
                  display: "flex",
                  flexDirection: "column",
                  bgcolor: "background.paper",
                  gap: 1,
                  minHeight: 0,
                  overflow: "hidden",
                }}
              >
                <ToggleButtonGroup
                  size="small"
                  exclusive
                  value={rightTab}
                  onChange={(_, v) => {
                    if (!v) return;
                    setRightTab(v);
                    setShowHistogram(v === "hist");
                  }}
                  sx={{ flexShrink: 0 }}
                >
                  <ToggleButton value="ctrl">Controls</ToggleButton>
                  <ToggleButton value="hist">Histogram</ToggleButton>
                </ToggleButtonGroup>

                <Box
                  sx={{
                    flex: 1,
                    minHeight: 0,
                    overflowY: "auto",
                    overflowX: "hidden",
                    pr: 1,
                    pb: 2,
                    mt: 1,
                  }}
                >
                  {rightTab === "ctrl" && viewMode === "slices" && (
                    <Box sx={{ display: "flex", flexDirection: "column", gap: 1.25, ml: 1 }}>
                      <SectionTitle title="Slices" />

                      <ParamRow
                        label="Layout"
                        helpKey="sliceLayout"
                        onHelp={openHelp}
                        control={
                          <ToggleButtonGroup
                            size="small"
                            exclusive
                            value={sliceLayoutMode}
                            onChange={(_, v) => v && setSliceLayoutMode(v)}
                          >
                            <ToggleButton value="single">single</ToggleButton>
                            <ToggleButton value="triple">3 Views</ToggleButton>
                          </ToggleButtonGroup>
                        }
                      />

                      {sliceLayoutMode === "single" ? (
                        <>
                          <ParamRow
                            label="Axis"
                            helpKey="axis"
                            onHelp={openHelp}
                            control={
                              <ToggleButtonGroup
                                size="small"
                                value={axis}
                                exclusive
                                onChange={(_, v) => v && setAxis(v)}
                              >
                                <ToggleButton value="z">Z</ToggleButton>
                                <ToggleButton value="y">Y</ToggleButton>
                                <ToggleButton value="x">X</ToggleButton>
                              </ToggleButtonGroup>
                            }
                          />

                          <AxisSliceSliderControl
                            title="Slice"
                            helpKey="sliceIndex"
                            onHelp={openHelp}
                            value={Math.min(sliceIndex, maxSlice)}
                            min={0}
                            max={maxSlice}
                            onChange={(v) => {
                              setDraggingSlice("single");
                              setSliceIndex(v);
                            }}
                            onChangeCommitted={(v) => {
                              setSliceIndex(v);
                              setDraggingSlice((current) => current === "single" ? null : current);
                            }}
                            disabled={!readySlices}
                          />
                        </>
                      ) : (
                        <>
                          <AxisSliceSliderControl
                            title="Slice Z"
                            helpKey="sliceIndexZ"
                            onHelp={openHelp}
                            value={Math.min(sliceIndexZ, maxSliceZ)}
                            min={0}
                            max={maxSliceZ}
                            onChange={(v) => {
                              setDraggingSlice("z");
                              setSliceIndexZ(v);
                            }}
                            onChangeCommitted={(v) => {
                              setSliceIndexZ(v);
                              setDraggingSlice((current) => current === "z" ? null : current);
                            }}
                            disabled={!readyTripleSlices}
                            axisColor={ORTHO_AXIS_COLORS.z}
                          />
                          <AxisSliceSliderControl
                            title="Slice Y"
                            helpKey="sliceIndexY"
                            onHelp={openHelp}
                            value={Math.min(sliceIndexY, maxSliceY)}
                            min={0}
                            max={maxSliceY}
                            onChange={(v) => {
                              setDraggingSlice("y");
                              setSliceIndexY(v);
                            }}
                            onChangeCommitted={(v) => {
                              setSliceIndexY(v);
                              setDraggingSlice((current) => current === "y" ? null : current);
                            }}
                            disabled={!readyTripleSlices}
                            axisColor={ORTHO_AXIS_COLORS.y}
                          />
                          <AxisSliceSliderControl
                            title="Slice X"
                            helpKey="sliceIndexX"
                            onHelp={openHelp}
                            value={Math.min(sliceIndexX, maxSliceX)}
                            min={0}
                            max={maxSliceX}
                            onChange={(v) => {
                              setDraggingSlice("x");
                              setSliceIndexX(v);
                            }}
                            onChangeCommitted={(v) => {
                              setSliceIndexX(v);
                              setDraggingSlice((current) => current === "x" ? null : current);
                            }}
                            disabled={!readyTripleSlices}
                            axisColor={ORTHO_AXIS_COLORS.x}
                          />
                        </>
                      )}

                      <ParamRow
                        label="Colormap"
                        helpKey="colormap2d"
                        onHelp={openHelp}
                        control={
                          <TextField
                            size="small"
                            select
                            value={colormap}
                            onChange={(e) => setColormap(e.target.value)}
                            SelectProps={{ MenuProps: { disablePortal: true } }}
                          >
                            {CMAP_OPTIONS.map((cm) => (
                              <MenuItem key={cm} value={cm}>{cm}</MenuItem>
                            ))}
                          </TextField>
                        }
                      />

                      <Divider />

                      <SectionTitle title="Volume overlay" />

                      <ParamRow
                        label="Color"
                        helpKey="sliceColorOverlay"
                        onHelp={openHelp}
                        control={
                          <TextField
                            size="small"
                            select
                            value={
                              sliceOverlayEnabled
                                ? colorMode3d
                                : "off"
                            }
                            onChange={(event) => {
                              const value = event.target.value;

                              if (value === "off") {
                                setSliceOverlayEnabled(false);
                                return;
                              }

                              setSliceOverlayEnabled(true);
                              setColorMode3d(
                                value as MeshColorMode3d,
                              );
                            }}
                            SelectProps={{
                              MenuProps: { disablePortal: true },
                            }}
                          >
                            <MenuItem value="off">off</MenuItem>
                            <MenuItem value="solid">solid</MenuItem>
                            <MenuItem value="density">density</MenuItem>
                            <MenuItem value="components">regions</MenuItem>
                          </TextField>
                        }
                      />

                      {sliceOverlayEnabled ? (
                        <>
                          <ParamRow
                            label="Overlay cmap"
                            helpKey="colormap3d"
                            onHelp={openHelp}
                            control={
                              <TextField
                                size="small"
                                select
                                value={colormap3d}
                                disabled={colorMode3d === "components"}
                                onChange={(event) =>
                                  setColormap3d(event.target.value)
                                }
                                SelectProps={{
                                  MenuProps: { disablePortal: true },
                                }}
                              >
                                {CMAP_OPTIONS.map((cm) => (
                                  <MenuItem key={cm} value={cm}>
                                    {cm}
                                  </MenuItem>
                                ))}
                              </TextField>
                            }
                          />

                          <ParamRow
                            label="Opacity"
                            helpKey="opacity3d"
                            onHelp={openHelp}
                            control={
                              <Slider
                                size="small"
                                value={opacity3d}
                                min={0.05}
                                max={1}
                                step={0.05}
                                onChange={(_, value) =>
                                  setOpacity3d(value as number)
                                }
                              />
                            }
                          />

                          {surfaceLevelRange ? (
                            <SurfaceLevelHistogramSlider
                              histogram={histogram}
                              loading={histLoading}
                              error={histError}
                              displayRange={surfaceLevelRange}
                              validRange={surfaceLevelRange}
                              value={surfaceLevelValue}
                              disabled={false}
                              onHelp={openHelp("surfaceLevel3d")}
                              onChange={(level) =>
                                setSurfaceLevel3d(level)
                              }
                              onCommit={(level) =>
                                setSurfaceLevel3d(level)
                              }
                            />
                          ) : null}

                          {volumeRegionsLoading ? (
                            <Typography
                              variant="caption"
                              color="text.secondary"
                            >
                              Detecting 3D regions…
                            </Typography>
                          ) : null}

                          {volumeRegionsError ? (
                            <Typography
                              variant="caption"
                              color="warning.main"
                            >
                              {volumeRegionsError}
                            </Typography>
                          ) : null}
                        </>
                      ) : null}

                      <Divider />

                      <ParamRow
                        label="Interpolation"
                        helpKey="interp2d"
                        onHelp={openHelp}
                        control={
                          <TextField
                            size="small"
                            select
                            value={interp2d}
                            disabled={sliceLayoutMode === "triple"}
                            onChange={(e) => setInterp2d(e.target.value as Interp2d)}
                            SelectProps={{ MenuProps: { disablePortal: true } }}
                          >
                            <MenuItem value="nearest">nearest</MenuItem>
                            <MenuItem value="linear">linear</MenuItem>
                            <MenuItem value="high">high</MenuItem>
                          </TextField>
                        }
                      />

                      <ParamRow
                        label="Sharpen"
                        helpKey="sharpen2d"
                        onHelp={openHelp}
                        control={
                          <ToggleButtonGroup
                            size="small"
                            exclusive
                            value={sharpen2d ? "on" : "off"}
                            disabled={sliceLayoutMode === "triple"}
                            onChange={(_, v) => {
                              if (v === "on") setSharpen2d(true);
                              if (v === "off") setSharpen2d(false);
                            }}
                          >
                            <ToggleButton value="off">off</ToggleButton>
                            <ToggleButton value="on">on</ToggleButton>
                          </ToggleButtonGroup>
                        }
                      />

                      <Divider />

                      <SectionTitle title="Display" />

                      <Box
                        sx={{
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "center",
                          mt: 0.5,
                        }}
                      >
                        <Typography variant="caption" color="text.secondary">
                          Intensity
                        </Typography>
                        <Button
                          size="small"
                          onClick={() => {
                            setBrightness2d(0);
                            setContrast2d(1);
                          }}
                        >
                          Reset
                        </Button>
                      </Box>

                      <Box sx={{ display: "flex", flexDirection: "column", gap: 0.5 }}>
                        <Box sx={{ display: "inline-flex", gap: 0.5, alignItems: "center" }}>
                          <Typography variant="caption" color="text.secondary">
                            Brightness
                          </Typography>
                          <IconButton size="small" onClick={openHelp("brightness2d")}>
                            <HelpCircle size={14} />
                          </IconButton>
                        </Box>
                        <Slider
                          size="small"
                          value={brightness2d}
                          min={-1}
                          max={1}
                          step={0.02}
                          onChange={(_, v) => setBrightness2d(v as number)}
                          valueLabelDisplay="auto"
                          valueLabelFormat={(v) =>
                            `${Math.round((1 + (v as number)) * 100)}%`
                          }
                        />
                      </Box>

                      <Box sx={{ display: "flex", flexDirection: "column", gap: 0.5 }}>
                        <Box sx={{ display: "inline-flex", gap: 0.5, alignItems: "center" }}>
                          <Typography variant="caption" color="text.secondary">
                            Contrast
                          </Typography>
                          <IconButton size="small" onClick={openHelp("contrast2d")}>
                            <HelpCircle size={14} />
                          </IconButton>
                        </Box>
                        <Slider
                          size="small"
                          value={contrast2d}
                          min={0.5}
                          max={2}
                          step={0.02}
                          onChange={(_, v) => setContrast2d(v as number)}
                          valueLabelDisplay="auto"
                          valueLabelFormat={(v) =>
                            `${Math.round((v as number) * 100)}%`
                          }
                        />
                      </Box>

                      <Divider />

                      <Button
                        size="small"
                        variant="outlined"
                        onClick={fitZoom}
                        disabled={sliceLayoutMode !== "single"}
                        sx={{ textTransform: "none" }}
                      >
                        Fit + reset pan
                      </Button>

                      <Typography variant="caption" color="text.secondary">
                        {sliceLayoutMode === "single"
                          ? "Pan: Ctrl+drag or middle mouse"
                          : "Triple view: synchronized orthogonal slices (Z/Y/X)"}
                      </Typography>
                    </Box>
                  )}

                  {rightTab === "ctrl" && viewMode === "map3d" && (
                    <Box sx={{ display: "flex", flexDirection: "column", gap: 1.25, marginRight: "12px" }}>
                      <SectionTitle title="Data" />
                      <ParamRow
                        label="Quality"
                        helpKey="maxDim3d"
                        onHelp={openHelp}
                        control={
                          <TextField
                            size="small"
                            select
                            value={maxDim3d}
                            onChange={(e) => setMaxDim3d(Number(e.target.value))}
                            SelectProps={{ MenuProps: { disablePortal: true } }}
                          >
                            <MenuItem value={128}>Fast</MenuItem>
                            <MenuItem value={256}>Balanced</MenuItem>
                            <MenuItem value={384}>High</MenuItem>
                            <MenuItem value={512}>Maximum</MenuItem>
                          </TextField>
                        }
                      />
                      <ParamRow
                        label="Method"
                        helpKey="method3d"
                        onHelp={openHelp}
                        control={
                          <TextField
                            size="small"
                            select
                            value={method3d}
                            onChange={(e) => setMethod3d(e.target.value as any)}
                            SelectProps={{ MenuProps: { disablePortal: true } }}
                          >
                            <MenuItem value="binning">binning</MenuItem>
                            <MenuItem value="stride">stride</MenuItem>
                            <MenuItem value="none">none</MenuItem>
                          </TextField>
                        }
                      />

                      <Button
                        size="small"
                        variant={dataDirty ? "contained" : "outlined"}
                        onClick={load3d}
                        disabled={selectedId == null || mapLoading}
                        sx={{ textTransform: "none", borderRadius: 1.5 }}
                      >
                        Reload data
                      </Button>

                      <Divider />

                      <SectionTitle title="Appearance" />
                      <ParamRow
                        label="Color"
                        helpKey="colorMode3d"
                        onHelp={openHelp}
                        control={
                          <ToggleButtonGroup
                            size="small"
                            exclusive
                            value={colorMode3d}
                            onChange={(_, value) => {
                              if (value) {
                                setColorMode3d(value as MeshColorMode3d);
                              }
                            }}
                          >
                            <ToggleButton value="solid">solid</ToggleButton>
                            <ToggleButton value="density">density</ToggleButton>
                            <ToggleButton value="components">regions</ToggleButton>
                          </ToggleButtonGroup>
                        }
                      />
                      <ParamRow
                        label="Colormap"
                        helpKey="colormap3d"
                        onHelp={openHelp}
                        control={
                          <TextField
                            size="small"
                            select
                            value={colormap3d}
                            disabled={colorMode3d === "components"}
                            onChange={(e) => setColormap3d(e.target.value)}
                            SelectProps={{ MenuProps: { disablePortal: true } }}
                          >
                            {CMAP_OPTIONS.map((cm) => (
                              <MenuItem key={cm} value={cm}>{cm}</MenuItem>
                            ))}
                          </TextField>
                        }
                      />

                      <ParamRow
                        label="Opacity"
                        helpKey="opacity3d"
                        onHelp={openHelp}
                        control={
                          <TextField
                            size="small"
                            type="number"
                            value={opacity3d}
                            onChange={(e) => setOpacity3d(clampFloat(e.target.value, 0.05, 1))}
                            inputProps={{ min: 0.05, max: 1, step: 0.05 }}
                          />
                        }
                      />

                      <Divider />

                      <SectionTitle title="Rendering" />
                      <ParamRow
                        label="Iso mode"
                        helpKey="isoRenderMode3d"
                        onHelp={openHelp}
                        control={
                          <ToggleButtonGroup
                            size="small"
                            exclusive
                            value={renderMode3d}
                            onChange={(_, v) => v && setRenderMode3d(v)}
                          >
                            <ToggleButton value="surface">surface</ToggleButton>
                            <ToggleButton value="mesh">mesh</ToggleButton>
                          </ToggleButtonGroup>
                        }
                      />

                      <ParamRow
                        label="Hide dust"
                        helpKey="hideDust3d"
                        onHelp={openHelp}
                        control={
                          <TextField
                            size="small"
                            select
                            value={surfaceDust3d}
                            disabled={
                              selectedId == null ||
                              mapLoading ||
                              surfaceRefreshing
                            }
                            onChange={(event) => {
                              const value = Number(event.target.value);

                              setSurfaceDust3d(value);

                              if (surfaceMesh) {
                                void reloadSurfaceMesh(
                                  surfaceLevel3d,
                                  {
                                    silent: true,
                                    minComponentTriangles: value,
                                  },
                                );
                              }
                            }}
                            SelectProps={{
                              MenuProps: { disablePortal: true },
                            }}
                          >
                            <MenuItem value={0}>Off</MenuItem>
                            <MenuItem value={100}>Light</MenuItem>
                            <MenuItem value={400}>Standard</MenuItem>
                            <MenuItem value={1000}>Strong</MenuItem>
                          </TextField>
                        }
                      />

                      <ParamRow
                        label="Smoothing"
                        helpKey="surfaceSmoothing3d"
                        onHelp={openHelp}
                        control={
                          <TextField
                            size="small"
                            select
                            value={surfaceSmoothing3d}
                            disabled={
                              selectedId == null ||
                              mapLoading ||
                              surfaceRefreshing
                            }
                            onChange={(event) => {
                              const value = Number(event.target.value);

                              setSurfaceSmoothing3d(value);

                              if (surfaceMesh) {
                                void reloadSurfaceMesh(
                                  surfaceLevel3d,
                                  {
                                    silent: true,
                                    smoothingIterations: value,
                                  },
                                );
                              }
                            }}
                            SelectProps={{
                              MenuProps: { disablePortal: true },
                            }}
                          >
                            <MenuItem value={0}>Off</MenuItem>
                            <MenuItem value={2}>Low</MenuItem>
                            <MenuItem value={4}>Medium</MenuItem>
                            <MenuItem value={8}>High</MenuItem>
                          </TextField>
                        }
                      />

                      {renderMode3d === "volume" ? (
                        <>
                          <Box>
                            <Box
                              sx={{
                                display: "flex",
                                justifyContent: "space-between",
                                alignItems: "center",
                              }}
                            >
                              <Typography
                                variant="caption"
                                color="text.secondary"
                              >
                                Density window
                              </Typography>

                              <IconButton
                                size="small"
                                onClick={openHelp("volumeWindow3d")}
                              >
                                <HelpCircle size={14} />
                              </IconButton>
                            </Box>

                            <Slider
                              size="small"
                              value={thrPct}
                              min={0}
                              max={100}
                              step={1}
                              disableSwap
                              onChange={(_, value) =>
                                setThrPct(
                                  value as [number, number],
                                )
                              }
                              valueLabelDisplay="auto"
                              valueLabelFormat={(value) =>
                                `${value}%`
                              }
                            />
                          </Box>

                          {colorMode3d === "components" &&
                            surfaceLevelRange ? (
                            <SurfaceLevelHistogramSlider
                              histogram={histogram}
                              loading={histLoading}
                              error={histError}
                              displayRange={surfaceLevelRange}
                              validRange={surfaceLevelRange}
                              value={surfaceLevelValue}
                              disabled={false}
                              onHelp={openHelp("surfaceLevel3d")}
                              onChange={(level) =>
                                setSurfaceLevel3d(level)
                              }
                              onCommit={(level) =>
                                setSurfaceLevel3d(level)
                              }
                            />
                          ) : null}

                          {volumeRegionsLoading ? (
                            <Typography
                              variant="caption"
                              color="text.secondary"
                            >
                              Detecting 3D regions…
                            </Typography>
                          ) : null}
                        </>
                      ) : null}

                      {usesSurfaceMesh3d && (
                        <>
                          {surfaceLevelRange && (
                            <SurfaceLevelHistogramSlider
                              histogram={histogram}
                              loading={histLoading}
                              error={histError}
                              displayRange={surfaceLevelRange}
                              validRange={surfaceLevelRange ?? surfaceLevelRange}
                              value={surfaceLevelValue}
                              disabled={selectedId == null || mapLoading || surfaceRefreshing}
                              onHelp={openHelp("surfaceLevel3d")}
                              onChange={(level) => {
                                setSurfaceLevel3d(level);
                              }}
                              onCommit={(level) => {
                                setSurfaceLevel3d(level);
                                void reloadSurfaceMesh(level, { silent: true });
                              }}
                            />
                          )}

                          <Box sx={{ display: "flex", alignItems: "center", gap: 1, flexWrap: "wrap" }}>
                            <Button
                              size="small"
                              variant="outlined"
                              disabled={selectedId == null || mapLoading || surfaceRefreshing}
                              onClick={() => {
                                setSurfaceLevel3d(null);
                                void reloadSurfaceMesh(null, { silent: true });
                              }}
                              sx={{ textTransform: "none", borderRadius: 1.5 }}
                            >
                              Auto level
                            </Button>

                            {surfaceRefreshing && (
                              <>
                                <Typography variant="caption" color="text.secondary">
                                  updating surface…
                                </Typography>
                                <Button
                                  size="small"
                                  variant="text"
                                  onClick={cancelSurfaceRefresh}
                                  sx={{ textTransform: "none", minWidth: 0 }}
                                >
                                  Cancel
                                </Button>
                              </>
                            )}
                          </Box>

                          {surfaceRefreshError && (
                            <Typography variant="caption" color="warning.main">
                              {surfaceRefreshError}
                            </Typography>
                          )}

                          {surfaceResolvedLevel != null && (
                            <Typography variant="caption" color="text.secondary">
                              Current level: {formatSci(surfaceResolvedLevel)}
                            </Typography>
                          )}
                        </>
                      )}

                      {!surfaceLevelRange && (
                        <Typography variant="caption" color="text.secondary">
                          Level control will be available when the surface is ready.
                        </Typography>
                      )}
                    </Box>
                  )}

                  {rightTab === "hist" && (
                    <Box sx={{ display: "flex", flexDirection: "column", minHeight: 0, flex: 1 }}>
                      <Typography variant="caption" color="text.secondary">
                        Intensity histogram
                      </Typography>

                      {selectedId == null ? (
                        <Typography variant="caption" color="text.secondary" sx={{ mt: 1 }}>
                          Select a volume to see the histogram.
                        </Typography>
                      ) : histLoading ? (
                        <Box sx={{ display: "flex", gap: 1, alignItems: "center", mt: 1 }}>
                          <CircularProgress size={16} />
                          <Typography variant="caption">Loading histogram…</Typography>
                        </Box>
                      ) : histError ? (
                        <Typography variant="caption" color="error" sx={{ mt: 1 }}>
                          {histError}
                        </Typography>
                      ) : histogram && histogram.binEdges.length > 1 ? (
                        <Box sx={{ mt: 1, flex: 1, minHeight: 240 }}>
                          <Plot
                            data={[
                              {
                                type: "bar",
                                x: histogram.binEdges
                                  .slice(0, -1)
                                  .map((b, i) => 0.5 * (b + histogram.binEdges[i + 1])),
                                y: histogram.counts,
                              },
                            ]}
                            layout={{
                              margin: { l: 40, r: 10, t: 10, b: 30 },
                              autosize: true,
                              showlegend: false,
                              xaxis: { title: "Intensity" },
                              yaxis: { title: "Count" },
                            }}
                            style={{ width: "100%", height: "100%" }}
                            useResizeHandler
                            config={{ displaylogo: false, responsive: true }}
                          />
                        </Box>
                      ) : (
                        <Typography variant="caption" color="text.secondary" sx={{ mt: 1 }}>
                          No histogram data.
                        </Typography>
                      )}
                    </Box>
                  )}
                </Box>
              </Box>
            </>
          )}
        </Box>
      </Box>

      <Popover
        open={Boolean(helpAnchor && helpKey)}
        anchorEl={helpAnchor}
        onClose={closeHelp}
        anchorOrigin={{ vertical: "bottom", horizontal: "left" }}
        transformOrigin={{ vertical: "top", horizontal: "left" }}
        disableRestoreFocus
        PaperProps={{ sx: { p: 1.25, maxWidth: 320 } }}
      >
        <Typography variant="subtitle2" sx={{ mb: 0.5 }}>
          {helpKey}
        </Typography>
        <Typography variant="body2" color="text.secondary">
          {helpKey ? HELP_TEXT[helpKey] ?? "No help available." : ""}
        </Typography>
      </Popover>
    </Box>
  );
}

function SurfaceLevelHistogramSlider({
  histogram,
  loading,
  error,
  displayRange,
  validRange,
  value,
  disabled,
  onHelp,
  onChange,
  onCommit,
}: {
  histogram: HistogramData | null;
  loading: boolean;
  error: string | null;
  displayRange: [number, number];
  validRange: [number, number];
  value: number;
  disabled?: boolean;
  onHelp: (e: React.MouseEvent<HTMLElement>) => void;
  onChange: (value: number) => void;
  onCommit: (value: number) => void;
}) {
  const [min, max] = displayRange;

  const displayValue = clampValueToRange(value, displayRange);
  const markerX = max > min ? ((displayValue - min) / (max - min)) * 100 : 50;

  const bars = useMemo(() => {
    if (!histogram?.counts?.length || !histogram?.binEdges?.length) {
      return [];
    }

    const maxCount = Math.max(...histogram.counts.map((count) => Number(count) || 0));
    const maxLogCount = Math.log1p(maxCount);

    if (!Number.isFinite(maxLogCount) || maxLogCount <= 0 || max <= min) {
      return [];
    }
    return histogram.counts
      .map((count, index) => {
        const leftEdge = Number(histogram.binEdges[index]);
        const rightEdge = Number(histogram.binEdges[index + 1]);

        if (
          !Number.isFinite(leftEdge) ||
          !Number.isFinite(rightEdge) ||
          rightEdge <= min ||
          leftEdge >= max
        ) {
          return null;
        }

        const x0 = Math.max(0, ((leftEdge - min) / (max - min)) * 100);
        const x1 = Math.min(100, ((rightEdge - min) / (max - min)) * 100);
        const width = Math.max(0.12, x1 - x0);
        const height = Math.max(1, (Math.log1p(Number(count)) / maxLogCount) * 42);

        return {
          x: x0,
          y: 46 - height,
          width,
          height,
        };
      })
      .filter(Boolean) as Array<{
        x: number;
        y: number;
        width: number;
        height: number;
      }>;
  }, [histogram, min, max]);

  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 0.5 }}>
      <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 1 }}>
        <Box sx={{ display: "inline-flex", alignItems: "center", gap: 0.5 }}>
          <Typography variant="caption" color="text.secondary">
            Level
          </Typography>
          <IconButton size="small" onClick={onHelp}>
            <HelpCircle size={14} />
          </IconButton>
        </Box>

        <Typography variant="caption" color="text.secondary">
          {formatSci(displayValue)}
        </Typography>
      </Box>

      <Box
        sx={{
          position: "relative",
          height: 54,
          borderRadius: 1,
          bgcolor: "action.hover",
          overflow: "hidden",
          border: "1px solid",
          borderColor: "divider",
        }}
      >
        {loading ? (
          <Box sx={{ height: "100%", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <Typography variant="caption" color="text.secondary">
              Loading histogram…
            </Typography>
          </Box>
        ) : error ? (
          <Box sx={{ height: "100%", display: "flex", alignItems: "center", justifyContent: "center", px: 1 }}>
            <Typography variant="caption" color="error" noWrap>
              {error}
            </Typography>
          </Box>
        ) : (
          <Box
            component="svg"
            viewBox="0 0 100 48"
            preserveAspectRatio="none"
            sx={{
              width: "100%",
              height: "100%",
              display: "block",
            }}
          >
            {bars.map((bar, index) => (
              <rect
                key={index}
                x={bar.x}
                y={bar.y}
                width={bar.width}
                height={bar.height}
                fill="currentColor"
                opacity={0.45}
              />
            ))}

            <line
              x1={markerX}
              x2={markerX}
              y1={0}
              y2={48}
              stroke="currentColor"
              strokeWidth={0.9}
              opacity={0.95}
            />
          </Box>
        )}
      </Box>

      <Slider
        size="small"
        value={displayValue}
        min={min}
        max={max}
        step={(max - min) / 700}
        valueLabelDisplay="auto"
        valueLabelFormat={(v) => formatSci(v as number)}
        disabled={disabled || max <= min}
        onChange={(_, v) => {
          const rawValue = Array.isArray(v) ? v[0] : v;
          if (!Number.isFinite(rawValue)) return;

          onChange(clampValueToRange(rawValue as number, displayRange));
        }}
        onChangeCommitted={(_, v) => {
          const rawValue = Array.isArray(v) ? v[0] : v;
          if (!Number.isFinite(rawValue)) return;

          const displayLevel = clampValueToRange(rawValue as number, displayRange);
          const renderLevel =
            clampIsoLevelToOpenRange(displayLevel, validRange) ?? displayLevel;

          onCommit(renderLevel);
        }}
      />

      <Box sx={{ display: "flex", justifyContent: "space-between" }}>
        <Typography variant="caption" color="text.secondary">
          {formatSci(min)}
        </Typography>
        <Typography variant="caption" color="text.secondary">
          {formatSci(max)}
        </Typography>
      </Box>
    </Box>
  );
}

function AxisSliceSliderControl({
  title,
  helpKey,
  onHelp,
  value,
  min,
  max,
  onChange,
  onChangeCommitted,
  disabled,
  axisColor,
}: {
  title: string;
  helpKey: string;
  onHelp: (key: string) => (e: React.MouseEvent<HTMLElement>) => void;
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
  onChangeCommitted?: (value: number) => void;
  disabled?: boolean;
  axisColor?: string;
}) {
  const normalizeSliderValue = (v: number | number[]) =>
    Array.isArray(v) ? v[0] : v;
  return (
    <Box sx={{ mt: 0.5 }}>
      <Box sx={{ display: "inline-flex", gap: 0.5, alignItems: "center" }}>
        <Typography variant="caption" color="text.secondary">
          {title}
        </Typography>
        <IconButton size="small" onClick={onHelp(helpKey)}>
          <HelpCircle size={14} />
        </IconButton>
      </Box>

      <SliceSlider
        size="small"
        value={Math.max(min, Math.min(value, max))}
        min={min}
        max={Math.max(min, max)}
        step={1}
        onChange={(_, v) => onChange(normalizeSliderValue(v as number | number[]))}
        onChangeCommitted={(_, v) => {
          onChangeCommitted?.(normalizeSliderValue(v as number | number[]));
        }}
        disabled={disabled}
        valueLabelDisplay="auto"
        valueLabelFormat={(v) => `${(v as number) + 1}`}
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
          {min + 1}
        </Typography>
        <Typography variant="caption" color="text.secondary">
          {Math.max(min, max) + 1}
        </Typography>
      </Box>
    </Box>
  );
}

function OrthoSlicesGrid({
  dims,
  zSlice,
  ySlice,
  xSlice,
  sliceIndexX,
  sliceIndexY,
  sliceIndexZ,
  brightness,
  contrast,
  zOverlayUrl,
  yOverlayUrl,
  xOverlayUrl,
}: {
  dims: Record<"x" | "y" | "z", number>;
  zSlice: SliceImageState;
  ySlice: SliceImageState;
  xSlice: SliceImageState;
  sliceIndexX: number;
  sliceIndexY: number;
  sliceIndexZ: number;
  brightness: number;
  contrast: number;
  zOverlayUrl?: string | null;
  yOverlayUrl?: string | null;
  xOverlayUrl?: string | null;
}) {
  const colX = ORTHO_AXIS_COLORS.x;
  const colY = ORTHO_AXIS_COLORS.y;
  const colZ = ORTHO_AXIS_COLORS.z;

  const gx = Math.max(1, dims.x || 1);
  const gy = Math.max(1, dims.y || 1);
  const gz = Math.max(1, dims.z || 1);

  return (
    <Box
      sx={{
        width: "100%",
        height: "100%",
        display: "grid",
        gridTemplateColumns: `${gx}fr ${gz}fr`,
        gridTemplateRows: `${gz}fr ${gy}fr`,
        gap: 0.5,
        minWidth: 0,
        minHeight: 0,
      }}
    >
      <OrthoSlicePanel
        label="Y (XZ)"
        labelDotColor={colY}
        gridArea={{ col: "1 / 2", row: "1 / 2" }}
        imageUrl={ySlice.url}
        overlayUrl={yOverlayUrl}
        loading={ySlice.loading}
        error={ySlice.error}
        imageWidth={Math.max(1, dims.x)}
        imageHeight={Math.max(1, dims.z)}
        brightness={brightness}
        contrast={contrast}
        crossV={{
          pos: clampInt(sliceIndexX, 0, Math.max(0, dims.x - 1)),
          color: colX,
          max: Math.max(1, dims.x),
        }}
        crossH={{
          pos: clampInt(sliceIndexZ, 0, Math.max(0, dims.z - 1)),
          color: colZ,
          max: Math.max(1, dims.z),
        }}
      />



      <OrthoSlicePanel
        label="Z (XY)"
        labelDotColor={colZ}
        gridArea={{ col: "1 / 2", row: "2 / 3" }}
        imageUrl={zSlice.url}
        overlayUrl={zOverlayUrl}
        loading={zSlice.loading}
        error={zSlice.error}
        imageWidth={Math.max(1, dims.x)}
        imageHeight={Math.max(1, dims.y)}
        brightness={brightness}
        contrast={contrast}
        crossV={{
          pos: clampInt(sliceIndexX, 0, Math.max(0, dims.x - 1)),
          color: colX,
          max: Math.max(1, dims.x),
        }}
        crossH={{
          pos: clampInt(sliceIndexY, 0, Math.max(0, dims.y - 1)),
          color: colY,
          max: Math.max(1, dims.y),
        }}
      />

      <OrthoSlicePanel
        label="X (YZ)"
        labelDotColor={colX}
        gridArea={{ col: "2 / 3", row: "2 / 3" }}
        imageUrl={xSlice.url}
        overlayUrl={xOverlayUrl}
        loading={xSlice.loading}
        error={xSlice.error}
        imageWidth={Math.max(1, dims.y)}
        imageHeight={Math.max(1, dims.z)}
        brightness={brightness}
        contrast={contrast}
        rotate90
        crossV={{
          pos: clampInt(sliceIndexY, 0, Math.max(0, dims.y - 1)),
          color: colY,
          max: Math.max(1, dims.y),
        }}
        crossH={{
          pos: clampInt(sliceIndexZ, 0, Math.max(0, dims.z - 1)),
          color: colZ,
          max: Math.max(1, dims.z),
        }}
      />
    </Box>
  );
}

function OrthoSlicePanel({
  label,
  labelDotColor,
  gridArea,
  imageUrl,
  overlayUrl,
  loading,
  error,
  imageWidth,
  imageHeight,
  brightness,
  contrast,
  rotate90 = false,
  crossV,
  crossH,
}: {
  label: string;
  labelDotColor?: string;
  gridArea: { col: string; row: string };
  imageUrl: string | null;
  overlayUrl?: string | null;
  loading: boolean;
  error: string | null;
  imageWidth: number;
  imageHeight: number;
  brightness: number;
  contrast: number;
  rotate90?: boolean;
  crossV?: { pos: number; color: string; max: number };
  crossH?: { pos: number; color: string; max: number };
}) {
  const viewBoxW = rotate90 ? imageHeight : imageWidth;
  const viewBoxH = rotate90 ? imageWidth : imageHeight;

  const filterCss = `brightness(${1 + brightness}) contrast(${contrast})`;

  const strokeW = Math.max(1, Math.min(viewBoxW, viewBoxH) * 0.0025);

  const renderContent = () => {
    if (loading && !imageUrl) {
      return (
        <Box sx={{ display: "flex", gap: 1, alignItems: "center" }}>
          <CircularProgress size={16} />
          <Typography variant="caption">Loading…</Typography>
        </Box>
      );
    }

    if (error && !imageUrl) {
      return (
        <Typography variant="caption" color="error" sx={{ textAlign: "center", px: 1 }}>
          {error}
        </Typography>
      );
    }

    if (!imageUrl) {
      return (
        <Typography variant="caption" color="text.secondary">
          Waiting for image…
        </Typography>
      );
    }

    return (
      <svg
        viewBox={`0 0 ${viewBoxW} ${viewBoxH}`}
        preserveAspectRatio="xMidYMid meet"
        style={{ width: "100%", height: "100%", display: "block" }}
      >
        {rotate90 ? (
          <g transform={`translate(${imageHeight}, 0) rotate(90)`}>
            <image
              href={imageUrl}
              x={0}
              y={0}
              width={imageWidth}
              height={imageHeight}
              preserveAspectRatio="none"
              style={{ filter: filterCss }}
            />
            {overlayUrl ? (
              <image
                href={overlayUrl}
                x={0}
                y={0}
                width={imageWidth}
                height={imageHeight}
                preserveAspectRatio="none"
              />
            ) : null}
            {crossV && (
              <line
                x1={clampFloat(crossV.pos, 0, Math.max(0, imageWidth - 1))}
                y1={0}
                x2={clampFloat(crossV.pos, 0, Math.max(0, imageWidth - 1))}
                y2={imageHeight}
                stroke={crossV.color}
                strokeWidth={strokeW}
                opacity={0.95}
              />
            )}
            {crossH && (
              <line
                x1={0}
                y1={clampFloat(crossH.pos, 0, Math.max(0, imageHeight - 1))}
                x2={imageWidth}
                y2={clampFloat(crossH.pos, 0, Math.max(0, imageHeight - 1))}
                stroke={crossH.color}
                strokeWidth={strokeW}
                opacity={0.95}
              />
            )}
          </g>
        ) : (
          <>
            <image
              href={imageUrl}
              x={0}
              y={0}
              width={imageWidth}
              height={imageHeight}
              preserveAspectRatio="none"
              style={{ filter: filterCss }}
            />
            {overlayUrl ? (
              <image
                href={overlayUrl}
                x={0}
                y={0}
                width={imageWidth}
                height={imageHeight}
                preserveAspectRatio="none"
              />
            ) : null}
            {crossV && (
              <line
                x1={clampFloat(crossV.pos, 0, Math.max(0, imageWidth - 1))}
                y1={0}
                x2={clampFloat(crossV.pos, 0, Math.max(0, imageWidth - 1))}
                y2={imageHeight}
                stroke={crossV.color}
                strokeWidth={strokeW}
                opacity={0.95}
              />
            )}
            {crossH && (
              <line
                x1={0}
                y1={clampFloat(crossH.pos, 0, Math.max(0, imageHeight - 1))}
                x2={imageWidth}
                y2={clampFloat(crossH.pos, 0, Math.max(0, imageHeight - 1))}
                stroke={crossH.color}
                strokeWidth={strokeW}
                opacity={0.95}
              />
            )}
          </>
        )}
      </svg>
    );
  };

  return (
    <Box
      sx={{
        gridColumn: gridArea.col,
        gridRow: gridArea.row,
        borderRadius: 1,
        border: "1px solid",
        borderColor: "divider",
        bgcolor: "background.paper",
        position: "relative",
        minWidth: 0,
        minHeight: 0,
        overflow: "hidden",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      {renderContent()}

      <Box
        sx={{
          position: "absolute",
          top: 6,
          left: 6,
          px: 0.75,
          py: 0.25,
          borderRadius: 0.75,
          bgcolor: "rgba(0,0,0,0.55)",
          color: "common.white",
          pointerEvents: "none",
          display: "inline-flex",
          alignItems: "center",
          gap: 0.6,
        }}
      >
        {labelDotColor && (
          <Box
            sx={{
              width: 7,
              height: 7,
              borderRadius: "50%",
              bgcolor: labelDotColor,
              flexShrink: 0,
              boxShadow: "0 0 0 1px rgba(255,255,255,0.35)",
            }}
          />
        )}
        <Typography variant="caption" sx={{ color: "inherit", lineHeight: 1.2 }}>
          {label}
        </Typography>
      </Box>

      {error && imageUrl && (
        <Box
          sx={{
            position: "absolute",
            bottom: 6,
            left: 6,
            right: 6,
            px: 0.75,
            py: 0.5,
            borderRadius: 0.75,
            bgcolor: "rgba(239,68,68,0.12)",
            border: "1px solid rgba(239,68,68,0.35)",
            backdropFilter: "blur(2px)",
          }}
        >
          <Typography variant="caption" color="error" noWrap>
            {error}
          </Typography>
        </Box>
      )}
    </Box>
  );
}

async function decodeSliceObjectUrl(
  url: string | null | undefined,
): Promise<void> {
  if (!url || typeof Image === "undefined") return;

  const image = new Image();
  image.src = url;

  if (typeof image.decode !== "function") return;

  try {
    await image.decode();
  } catch {
    // The browser can still try to display the image normally.
  }
}

function useVolumeSliceImage({
  enabled,
  svc,
  projectId,
  protocolId,
  outputName,
  volumeId,
  axis,
  sliceIndex,
  maxSlice,
  colormap,
  reloadKey,
  requestOptions,
}: {
  enabled: boolean;
  svc: any;
  projectId: string | number;
  protocolId: string | number;
  outputName: string;
  volumeId: string | number | null;
  axis: "x" | "y" | "z";
  sliceIndex: number | null;
  maxSlice: number;
  colormap: string;
  reloadKey?: number;
  requestOptions?: {
    thumb?: number;
    format?: "png" | "webp" | "jpeg";
    fast?: boolean;
    quality?: number;
    windowMin?: number;
    windowMax?: number;
  };
}): SliceImageState {
  const [url, setUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const controllerRef = useRef<AbortController | null>(null);
  const inFlightRef = useRef(false);
  const pendingJobRef = useRef<{
    requestKey: string;
    sliceIndex: number;
  } | null>(null);

  const requestKeyRef = useRef<string | null>(null);
  const revokeRef = useRef<(() => void) | null>(null);
  const runNextRef = useRef<(() => void) | null>(null);

  runNextRef.current = () => {
    if (inFlightRef.current) return;

    const job = pendingJobRef.current;
    if (!job) {
      setLoading(false);
      return;
    }

    pendingJobRef.current = null;
    inFlightRef.current = true;

    const controller = new AbortController();
    controllerRef.current = controller;

    setLoading(true);
    setError(null);

    (async () => {
      try {
        const result = await svc.fetchVolumeSliceObjectUrl(
          projectId,
          protocolId,
          outputName,
          volumeId,
          job.sliceIndex,
          {
            axis,
            cmap: colormap,
            thumb: requestOptions?.thumb,
            format: requestOptions?.format,
            fast: requestOptions?.fast,
            quality: requestOptions?.quality,
            signal: controller.signal,
            windowMin: requestOptions?.windowMin,
            windowMax: requestOptions?.windowMax,
          },
        );

        if (
          controller.signal.aborted ||
          requestKeyRef.current !== job.requestKey
        ) {
          result?.revoke?.();
          return;
        }

        await decodeSliceObjectUrl(result?.url);

        if (
          controller.signal.aborted ||
          requestKeyRef.current !== job.requestKey
        ) {
          result?.revoke?.();
          return;
        }

        const previousRevoke = revokeRef.current;

        revokeRef.current = result?.revoke ?? null;
        setUrl(result?.url ?? null);

        if (previousRevoke) {
          window.requestAnimationFrame(() => {
            try {
              previousRevoke();
            } catch {
              // Ignore revoke errors.
            }
          });
        }
      } catch (e: any) {
        if (
          controller.signal.aborted ||
          requestKeyRef.current !== job.requestKey
        ) {
          return;
        }

        setError(e?.message || `Failed to load ${axis.toUpperCase()} slice`);
      } finally {
        if (controllerRef.current !== controller) {
          return;
        }

        controllerRef.current = null;
        inFlightRef.current = false;

        if (pendingJobRef.current) {
          runNextRef.current?.();
        } else {
          setLoading(false);
        }
      }
    })();
  };

  useEffect(() => {
    if (!enabled || volumeId == null || sliceIndex == null) {
      controllerRef.current?.abort();
      controllerRef.current = null;
      pendingJobRef.current = null;
      inFlightRef.current = false;
      requestKeyRef.current = null;
      setLoading(false);
      setError(null);
      return;
    }

    const clampedIndex = Math.max(0, Math.min(sliceIndex, maxSlice));
    const requestKey = [
      projectId,
      protocolId,
      outputName,
      volumeId,
      axis,
      colormap,
      reloadKey ?? "",
      requestOptions?.thumb ?? "",
      requestOptions?.format ?? "",
      requestOptions?.fast ?? "",
      requestOptions?.quality ?? "",
      requestOptions?.windowMin ?? "",
      requestOptions?.windowMax ?? "",
    ].map(String).join("|");

    // Do not include sliceIndex in requestKey.
    // While scrubbing, completed intermediate slices are intentionally displayed.
    // Only the latest pending index is kept, so visual continuity is preserved
    // without building an unbounded request queue.

    if (requestKeyRef.current !== requestKey) {
      controllerRef.current?.abort();
      controllerRef.current = null;
      pendingJobRef.current = null;
      inFlightRef.current = false;
      requestKeyRef.current = requestKey;
    }

    pendingJobRef.current = {
      requestKey,
      sliceIndex: clampedIndex,
    };

    runNextRef.current?.();
  }, [
    enabled,
    svc,
    projectId,
    protocolId,
    outputName,
    volumeId,
    axis,
    sliceIndex,
    maxSlice,
    colormap,
    reloadKey,
    requestOptions?.thumb,
    requestOptions?.format,
    requestOptions?.fast,
    requestOptions?.quality,
    requestOptions?.windowMin,
    requestOptions?.windowMax,
  ]);

  useEffect(() => {
    return () => {
      controllerRef.current?.abort();
      controllerRef.current = null;
      pendingJobRef.current = null;

      if (revokeRef.current) {
        try {
          revokeRef.current();
        } catch {
          // Ignore revoke errors.
        }
      }
    };
  }, []);

  const effectiveLoading =
    loading ||
    (
      enabled &&
      volumeId != null &&
      sliceIndex != null &&
      !url &&
      !error
    );

  return { url, loading: effectiveLoading, error };
}

/**
 * Throttle a value so it only updates at most once every `intervalMs` milliseconds.
 * Unlike debounce, this still updates while the user is moving the slider.
 */
function useThrottledValue<T>(value: T, intervalMs: number): T {
  const [throttled, setThrottled] = useState<T>(value);
  const lastExecutedRef = useRef<number>(0);
  const timeoutRef = useRef<number | null>(null);

  useEffect(() => {
    const now = Date.now();
    const elapsed = now - lastExecutedRef.current;

    if (elapsed >= intervalMs) {
      // Enough time passed: update immediately.
      lastExecutedRef.current = now;
      setThrottled(value);
      if (timeoutRef.current != null) {
        window.clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
    } else {
      // Not enough time: schedule a trailing update.
      const remaining = intervalMs - elapsed;
      if (timeoutRef.current != null) {
        window.clearTimeout(timeoutRef.current);
      }
      timeoutRef.current = window.setTimeout(() => {
        lastExecutedRef.current = Date.now();
        setThrottled(value);
        timeoutRef.current = null;
      }, remaining);
    }

    return () => {
      if (timeoutRef.current != null) {
        window.clearTimeout(timeoutRef.current);
      }
    };
  }, [value, intervalMs]);

  return throttled;
}

function SlicesCanvas({
  url,
  overlayUrl,
  containerW,
  containerH,
  scale,
  pan,
  interp,
  sharpen,
  brightness,
  contrast,
  onNaturalSize,
}: {
  url: string;
  overlayUrl?: string | null;
  containerW: number;
  containerH: number;
  scale: number;
  pan: { x: number; y: number };
  interp: Interp2d;
  sharpen: boolean;
  brightness: number;
  contrast: number;
  onNaturalSize: (w: number, h: number) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const overlayRef =
    useRef<HTMLImageElement | null>(null);
  const processedRef = useRef<HTMLCanvasElement | null>(null);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      imgRef.current = img;
      onNaturalSize(img.naturalWidth, img.naturalHeight);
      prepareProcessed(img, sharpen, processedRef);
      scheduleDraw();
    };
    img.src = url;
  }, [url]);

  useEffect(() => {
    if (!overlayUrl) {
      overlayRef.current = null;
      scheduleDraw();
      return;
    }

    const overlay = new Image();

    overlay.onload = () => {
      overlayRef.current = overlay;
      scheduleDraw();
    };

    overlay.src = overlayUrl;

    return () => {
      if (overlayRef.current === overlay) {
        overlayRef.current = null;
      }
    };
  }, [overlayUrl]);

  useEffect(() => {
    const img = imgRef.current;
    if (!img) return;
    prepareProcessed(img, sharpen, processedRef);
    scheduleDraw();
  }, [sharpen]);

  useEffect(() => {
    scheduleDraw();
  }, [containerW, containerH, scale, pan.x, pan.y, interp, brightness, contrast]);

  const scheduleDraw = () => {
    if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(draw);
  };

  const draw = () => {
    const canvas = canvasRef.current;
    const img = imgRef.current;
    if (!canvas || !img) return;

    const dpr = window.devicePixelRatio || 1;
    const w = Math.max(1, containerW);
    const h = Math.max(1, containerH);

    canvas.width = Math.floor(w * dpr);
    canvas.height = Math.floor(h * dpr);
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    if (interp === "nearest") {
      ctx.imageSmoothingEnabled = false;
    } else {
      ctx.imageSmoothingEnabled = true;
      (ctx as any).imageSmoothingQuality =
        interp === "high" ? "high" : "medium";
    }

    const src = sharpen && processedRef.current ? processedRef.current : img;

    const drawW = img.naturalWidth * scale;
    const drawH = img.naturalHeight * scale;

    const cx = w / 2 + pan.x;
    const cy = h / 2 + pan.y;
    const x0 = cx - drawW / 2;
    const y0 = cy - drawH / 2;

    const b = 1 + brightness;
    const c = contrast;

    ctx.filter = `brightness(${b}) contrast(${c})`;
    ctx.globalAlpha = 1;
    ctx.drawImage(src, x0, y0, drawW, drawH);
    ctx.filter = "none";

    const overlay = overlayRef.current;

    if (overlay) {
      ctx.globalAlpha = 1;
      ctx.drawImage(
        overlay,
        x0,
        y0,
        drawW,
        drawH,
      );
    }
  };

  return (
    <canvas
      ref={canvasRef}
      style={{
        display: "block",
        width: "100%",
        height: "100%",
      }}
    />
  );
}

function prepareProcessed(
  img: HTMLImageElement,
  sharpen: boolean,
  processedRef: React.MutableRefObject<HTMLCanvasElement | null>,
) {
  if (!sharpen) {
    processedRef.current = null;
    return;
  }

  const off = document.createElement("canvas");
  off.width = img.naturalWidth;
  off.height = img.naturalHeight;
  const ctx = off.getContext("2d");
  if (!ctx) {
    processedRef.current = null;
    return;
  }
  ctx.drawImage(img, 0, 0);
  const id = ctx.getImageData(0, 0, off.width, off.height);
  const out = sharpenImageData(id);
  ctx.putImageData(out, 0, 0);
  processedRef.current = off;
}

function sharpenImageData(src: ImageData): ImageData {
  const { width, height, data } = src;
  const out = new ImageData(width, height);
  const dst = out.data;

  const k = [0, -1, 0, -1, 5, -1, 0, -1, 0];
  const idx = (x: number, y: number) => (y * width + x) * 4;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      let ki = 0;

      for (let j = -1; j <= 1; j++) {
        for (let i = -1; i <= 1; i++, ki++) {
          const xx = Math.max(0, Math.min(width - 1, x + i));
          const yy = Math.max(0, Math.min(height - 1, y + j));
          const p = idx(xx, yy);
          const w = k[ki];
          r += data[p] * w;
          g += data[p + 1] * w;
          b += data[p + 2] * w;
          a += data[p + 3] * w;
        }
      }

      const o = idx(x, y);
      dst[o] = clampByte(r);
      dst[o + 1] = clampByte(g);
      dst[o + 2] = clampByte(b);
      dst[o + 3] = clampByte(a);
    }
  }
  return out;
}

function clampByte(v: number) {
  return Math.max(0, Math.min(255, Math.round(v)));
}

function SlicesStatusBar({
  axis,
  sliceIndex,
  maxSlice,
  zoomMul,
  colormap,
  interp,
  sharpen,
  brightness,
  contrast,
}: {
  axis: "x" | "y" | "z";
  sliceIndex: number;
  maxSlice: number;
  zoomMul: number;
  colormap: string;
  interp: Interp2d;
  sharpen: boolean;
  brightness: number;
  contrast: number;
}) {
  const bPct = Math.round((1 + brightness) * 100);
  const cPct = Math.round(contrast * 100);

  return (
    <Box
      sx={{
        position: "absolute",
        bottom: 8,
        right: 8,
        bgcolor: "rgba(0,0,0,0.55)",
        color: "white",
        px: 1,
        py: 0.5,
        borderRadius: 1,
        fontSize: 12,
        display: "flex",
        gap: 1.0,
        alignItems: "center",
        pointerEvents: "none",
        flexWrap: "wrap",
        maxWidth: "90%",
      }}
    >
      <Typography variant="caption" sx={{ color: "inherit" }}>
        {axis.toUpperCase()} {sliceIndex + 1}/{maxSlice + 1}
      </Typography>
      <Typography variant="caption" sx={{ color: "inherit" }}>
        {Math.round(zoomMul * 100)}%
      </Typography>
      <Typography variant="caption" sx={{ color: "inherit" }}>
        {colormap}
      </Typography>
      <Typography variant="caption" sx={{ color: "inherit" }}>
        {interp}
      </Typography>
      {sharpen && (
        <Typography variant="caption" sx={{ color: "inherit" }}>
          sharpen
        </Typography>
      )}
      <Typography variant="caption" sx={{ color: "inherit" }}>
        b {bPct}%
      </Typography>
      <Typography variant="caption" sx={{ color: "inherit" }}>
        c {cPct}%
      </Typography>
    </Box>
  );
}

function SectionTitle({ title }: { title: string }) {
  return (
    <Typography
      variant="caption"
      color="text.secondary"
      sx={{ fontWeight: 700 }}
    >
      {title}
    </Typography>
  );
}

function ParamRow({
  label,
  helpKey,
  onHelp,
  control,
}: {
  label: string;
  helpKey: string;
  onHelp: (key: string) => (e: React.MouseEvent<HTMLElement>) => void;
  control: React.ReactNode;
}) {
  return (
    <Box
      sx={{
        display: "grid",
        gridTemplateColumns: "1fr 1.2fr",
        gap: 1,
        alignItems: "center",
      }}
    >
      <Box sx={{ display: "inline-flex", alignItems: "center", gap: 0.5 }}>
        <Typography variant="caption" color="text.secondary">
          {label}
        </Typography>
        <IconButton size="small" onClick={onHelp(helpKey)}>
          <HelpCircle size={14} />
        </IconButton>
      </Box>
      {control}
    </Box>
  );
}

function useElementSize<T extends Element>(ref: React.RefObject<T | null>) {
  const [size, setSize] = useState({ width: 0, height: 0 });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const r = entries[0]?.contentRect;
      if (r) setSize({ width: r.width, height: r.height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return size;
}

function getDimsZYXtoXYZ(info: any): Record<"x" | "y" | "z", number> {
  const raw = info?.dims || info?.shape || info?.size || [];
  if (Array.isArray(raw) && raw.length >= 3) {
    const z = Number(raw[0]) || 0;
    const y = Number(raw[1]) || 0;
    const x = Number(raw[2]) || 0;
    return { x, y, z };
  }
  return {
    x: Number(info?.width ?? 0),
    y: Number(info?.height ?? 0),
    z: Number(info?.depth ?? info?.slices ?? 0),
  };
}

function dimsToStringXYZ(d: Record<"x" | "y" | "z", number>) {
  return d.x && d.y && d.z ? `${d.x} × ${d.y} × ${d.z}` : "–";
}

function num(n: any) {
  return Number.isFinite(n) ? Number(n).toFixed(3) : "–";
}

function MetaItem({ label, value }: { label: string; value: string }) {
  return (
    <Box sx={{ display: "flex", gap: 1 }}>
      <Typography variant="caption" color="text.secondary">
        {label}:
      </Typography>
      <Typography variant="caption">{value}</Typography>
    </Box>
  );
}

function normalize3dPayload(raw: any): {
  dims: { x: number; y: number; z: number };
  values: number[] | Float32Array;
  order: "zyx" | "xyz";
  min?: number;
  max?: number;
} {
  const dimsRaw = raw?.dims;
  const shapeRaw = raw?.shape ?? raw?.size;

  let x = 0, y = 0, z = 0;

  if (Array.isArray(dimsRaw) && dimsRaw.length >= 3) {
    x = Number(dimsRaw[0]) || 0;
    y = Number(dimsRaw[1]) || 0;
    z = Number(dimsRaw[2]) || 0;
  } else if (Array.isArray(shapeRaw) && shapeRaw.length >= 3) {
    z = Number(shapeRaw[0]) || 0;
    y = Number(shapeRaw[1]) || 0;
    x = Number(shapeRaw[2]) || 0;
  }

  let values: number[] | Float32Array = [];
  const vRaw = raw?.values ?? raw?.data ?? raw?.volume;

  if (vRaw instanceof Float32Array) {
    values = vRaw;
  } else if (Array.isArray(vRaw)) {
    if (Array.isArray(vRaw[0])) {
      values = flatten3dNested(vRaw as any);
      if (!x || !y || !z) {
        z = vRaw.length;
        y = (vRaw[0] as any).length;
        x = ((vRaw[0] as any)[0] as any).length;
      }
    } else {
      values = (vRaw as any[]).map((n) => Number(n) || 0);
    }
  }

  const orderRaw = (raw?.order ?? raw?.dimsOrder ?? "zyx").toLowerCase();
  const order: "zyx" | "xyz" = orderRaw === "xyz" ? "xyz" : "zyx";

  return { dims: { x, y, z }, values, order, min: raw?.min, max: raw?.max };
}

function flatten3dNested(v: number[][][]): number[] {
  const out: number[] = [];
  for (let k = 0; k < v.length; k++) {
    const yz = v[k] || [];
    for (let j = 0; j < yz.length; j++) {
      const row = yz[j] || [];
      for (let i = 0; i < row.length; i++) out.push(Number(row[i]) || 0);
    }
  }
  return out;
}

function clampInt(v: any, lo: number, hi: number) {
  const n = Number.parseInt(String(v), 10);
  if (!Number.isFinite(n)) return lo;
  return Math.max(lo, Math.min(hi, n));
}

function clampFloat(v: any, lo: number, hi: number) {
  const n = Number.parseFloat(String(v));
  if (!Number.isFinite(n)) return lo;
  return Math.max(lo, Math.min(hi, n));
}

function formatSci(v: number) {
  if (!Number.isFinite(v)) return "–";
  const av = Math.abs(v);
  if (av >= 1000 || (av > 0 && av < 0.001)) return v.toExponential(2);
  return v.toFixed(3);
}

function firstFiniteNumber(...values: any[]) {
  for (const value of values) {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function toPlotlyColorscale(name: string) {
  const n = (name || "viridis").toLowerCase();
  if (n === "gray" || n === "grey") return "Greys";
  if (n === "turbo") return "Turbo";
  if (n === "cividis") return "Cividis";
  if (n === "inferno") return "Inferno";
  if (n === "plasma") return "Plasma";
  if (n === "magma") return "Magma";
  return "Viridis";
}

function clampIsoLevelToOpenRange(
  value: number | null,
  range: [number, number] | null,
) {
  if (value == null || !range) return value;

  const [min, max] = range;
  if (!Number.isFinite(min) || !Number.isFinite(max) || max <= min) {
    return value;
  }

  const eps = Math.max((max - min) * 1e-5, Number.EPSILON * 100);
  return Math.max(min + eps, Math.min(max - eps, value));
}

function clampValueToRange(value: number, range: [number, number]) {
  const [min, max] = range;

  if (!Number.isFinite(value)) return min;
  if (!Number.isFinite(min) || !Number.isFinite(max) || max <= min) {
    return value;
  }

  return Math.max(min, Math.min(max, value));
}

function getHistogramDisplayRange(
  histogram: HistogramData | null,
  lowQuantile: number,
  highQuantile: number,
): [number, number] | null {
  if (!histogram?.binEdges?.length || !histogram?.counts?.length) {
    return null;
  }

  const low = histogramWeightedQuantile(histogram, lowQuantile);
  const high = histogramWeightedQuantile(histogram, highQuantile);

  if (low == null || high == null || high <= low) {
    return null;
  }

  const padding = Math.max((high - low) * 0.04, Number.EPSILON * 100);
  return [low - padding, high + padding];
}

function histogramWeightedQuantile(
  histogram: HistogramData,
  quantile: number,
): number | null {
  const edges = histogram.binEdges;
  const counts = histogram.counts;

  if (edges.length < 2 || counts.length === 0) {
    return null;
  }

  const total = counts.reduce((sum, count) => {
    const value = Number(count);
    return Number.isFinite(value) && value > 0 ? sum + value : sum;
  }, 0);

  if (!Number.isFinite(total) || total <= 0) {
    return null;
  }

  const target = Math.max(0, Math.min(1, quantile)) * total;
  let cumulative = 0;

  for (let i = 0; i < counts.length; i += 1) {
    const count = Number(counts[i]);
    if (!Number.isFinite(count) || count <= 0) continue;

    const left = Number(edges[i]);
    const right = Number(edges[i + 1]);

    if (!Number.isFinite(left) || !Number.isFinite(right)) continue;

    const previous = cumulative;
    cumulative += count;

    if (cumulative >= target) {
      const fraction = count > 0 ? (target - previous) / count : 0;
      return left + Math.max(0, Math.min(1, fraction)) * (right - left);
    }
  }

  const last = Number(edges[edges.length - 1]);
  return Number.isFinite(last) ? last : null;
}