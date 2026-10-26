// src/components/analyze/tiltseries-viewer.tsx
import { useEffect, useMemo, useRef, useState, useCallback, Fragment } from "react";
import {
  Box,
  CircularProgress,
  IconButton,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Typography,
  TextField,
  Checkbox,
  Tooltip,
  Slider,
  Button,
} from "@mui/material";
import {
  ArrowUpward,
  ArrowDownward,
  Refresh as RefreshIcon,
  PlayArrow,
  Stop as StopIcon,
  ExpandMore,
  ChevronRight,
  Transform as TransformIcon,
  TableView as MetadataIcon,
  ArrowBack,
} from "@mui/icons-material";
import { useProjectService } from "@/ProjectServiceContext";
import type { Id } from "@/services/ProjectService";
import { CloseIcon } from "@/icons";
import toast from "react-hot-toast";
import { MetadataViewer } from "./metadata-viewer";
import ExternalViewersBar from "./ExternalViewersBar";

type TiltSeriesViewerProps = {
  projectId: Id;
  protocolId: Id;
  outputName: string;
  protocolLabel?: string;
  selectedTiltSeriesId?: Id | null;
  selectedTiltImageIndex?: number | null;
  onTiltSeriesSelect?: (series: TiltSeriesSummary) => void;
  hideSeriesTable?: boolean;
  hideMetadataAction?: boolean;
};

type TiltSeriesSummary = {
  tiltSeriesId: Id;
  label: string;
  nViews?: number;
  tiltAxisAngle?: number | null;
  pixelSize?: number | null;
  dims?: [number, number] | [number, number, number];
  excluded?: boolean;
};

type TiltViewRow = {
  viewId: Id;
  index?: number | null;
  order?: number | null;
  tiltAngle?: number | null;
  excluded?: boolean;
  dose?: number | null;
  path?: string | null;
  rot?: number | null;
  shiftX?: number | null;
  shiftY?: number | null;
};

type FramesPayload = {
  tiltSeriesId: Id;
  label?: string;
  tiltAxisAngle?: number | null;
  frames: TiltViewRow[];
};

type ObjectUrlResult = {
  url: string;
  revoke?: () => void;
};

type CachedPreview = ObjectUrlResult & {
  lastUsed: number;
};

const PREVIEW_CACHE_LIMIT = 200;
const PREVIEW_BATCH_SIZE = 24;

const PREVIEW_SIZE_INTERACTIVE = 512;
const PREVIEW_SIZE_NORMAL = 768;
const PREVIEW_SIZE_REFRESH = 1024;

const PREVIEW_NEIGHBOR_OFFSETS = [-5, -1, 1, 5] as const;
const PREVIEW_FORWARD_OFFSETS = [1, 2, 3, 5, 8] as const;
const PREVIEW_BACKWARD_OFFSETS = [-1, -2, -3, -5, -8] as const;
const SCRUBBING_PREVIEW_NEIGHBOR_OFFSETS = [-5, -2, -1, 1, 2, 5] as const;

function getPreviewRequestSize(
  isPlaying: boolean,
  isScrubbing: boolean,
  isRefresh: boolean,
): number {
  if (isRefresh) return PREVIEW_SIZE_REFRESH;
  if (isPlaying || isScrubbing) return PREVIEW_SIZE_INTERACTIVE;
  return PREVIEW_SIZE_NORMAL;
}

function buildPreviewCacheKey(
  projectId: Id,
  protocolId: Id,
  outputName: string,
  tiltSeriesId: Id,
  frameIndex: number,
  size: number,
  applyTransform: boolean,
): string {
  return [
    String(projectId),
    String(protocolId),
    outputName,
    String(tiltSeriesId),
    String(frameIndex),
    String(size),
    applyTransform ? "aligned" : "raw",
  ].join("|");
}

type TiltExclusionsMap = Record<
  string,
  {
    excluded: boolean;
    tiltimages: number[];
  }
>;

// helperToTruncatePathInTheMiddleHomeImgMrc
function truncatePathMiddle(path: string, maxLength = 40): string {
  if (path.length <= maxLength) return path;
  const half = Math.floor((maxLength - 3) / 2);
  const start = path.slice(0, half);
  const end = path.slice(-half);
  return `${start}...${end}`;
}

export default function TiltSeriesViewer({
  projectId,
  protocolId,
  outputName,
  selectedTiltSeriesId,
  selectedTiltImageIndex,
  onTiltSeriesSelect,
  hideSeriesTable = false,
  hideMetadataAction = false,
}: TiltSeriesViewerProps) {
  const svc = useProjectService();

  // viewerModeSwitchBetweenTiltViewerAndMetadata
  const [mainMode, setMainMode] = useState<"viewer" | "metadata">("viewer");

  const projectIdNum = useMemo(() => Number(projectId), [projectId]);
  const protocolIdNum = useMemo(() => Number(protocolId), [protocolId]);

  const canOpenMetadata = useMemo(() => {
    return Number.isFinite(projectIdNum) && Number.isFinite(protocolIdNum);
  }, [projectIdNum, protocolIdNum]);

  useEffect(() => {
    // stopAutoplayWhenLeavingTiltViewer
    if (mainMode === "metadata") {
      setIsPlaying(false);
      setIsScrubbing(false);
    }
  }, [mainMode]);

  const [series, setSeries] = useState<TiltSeriesSummary[]>([]);
  const [seriesLoading, setSeriesLoading] = useState(false);
  const [seriesError, setSeriesError] = useState<string | null>(null);
  const [selectedSeriesId, setSelectedSeriesId] = useState<Id | null>(null);
  const [expandedSeriesId, setExpandedSeriesId] = useState<Id | null>(null);

  const [framesData, setFramesData] = useState<FramesPayload | null>(null);
  const [framesLoading, setFramesLoading] = useState(false);
  const [framesError, setFramesError] = useState<string | null>(null);

  const [selectedRowIndex, setSelectedRowIndex] = useState<number | null>(null);
  const [filterText, setFilterText] = useState<string>("");

  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [invertPreview, setInvertPreview] = useState(false);

  const [previewReloadToken, setPreviewReloadToken] = useState(0);

  const consumedPreviewReloadTokenRef = useRef(0);
  const previewAbortRef = useRef<AbortController | null>(null);
  const previewReqIdRef = useRef(0);
  const previewCacheRef = useRef<Map<string, CachedPreview>>(new Map());
  const previewInFlightRef = useRef<Set<string>>(new Set());
  const previewPrefetchTimerRef = useRef<number | null>(null);
  const previewWarmupAbortRef = useRef<AbortController | null>(null);
  const treeScrollRef = useRef<HTMLDivElement | null>(null);
  // trackPreviewLoadingStateInARefToUseItSafelyInsideIntervals
  const previewLoadingRef = useRef(false);

  const [isPlaying, setIsPlaying] = useState(false);
  const [isScrubbing, setIsScrubbing] = useState(false);
  const autoplayRef = useRef<number | null>(null);
  const playDirectionRef = useRef<1 | -1>(1);

  const [brightness, setBrightness] = useState<number>(100);
  const [contrast, setContrast] = useState<number>(100);

  const [displayedUrl, setDisplayedUrl] = useState<string | null>(null);
  const [transitionUrl, setTransitionUrl] = useState<string | null>(null);

  // applyAlignmentsToggle
  const [applyTransform, setApplyTransform] = useState<boolean>(true);

  // exclusionsSummaryAndDialogState
  const exclusionsRef = useRef<TiltExclusionsMap | null>(null);
  const [saveDialogOpen, setSaveDialogOpen] = useState(false);
  const [saveBusy, setSaveBusy] = useState(false);

  // persistExcludedFramesBySeriesId
  const excludedBySeriesRef = useRef<Record<string, Set<number>>>({});
  // persistWholeSeriesExcludedBySeriesId
  const seriesExcludedRef = useRef<Record<string, boolean>>({});

  // columnWidthsAsPercentagesToAvoidHorizontalScroll
  const columnWidths = {
    series: { width: "16%" },
    order: { width: "7%" },
    angle: { width: "9%" },
    excluded: { width: "6%" },
    dose: { width: "7%" },
    path: { width: "27%" },
    rot: { width: "7%" },
    shiftX: { width: "7%" },
    shiftY: { width: "7%" },
  } as const;

  const imageFilterCss = useMemo(() => {
    const parts: string[] = [];
    if (invertPreview) {
      parts.push("invert(1)");
    }
    parts.push(`brightness(${brightness / 100})`);
    parts.push(`contrast(${contrast / 100})`);
    return parts.join(" ");
  }, [invertPreview, brightness, contrast]);

  const imageBaseSx = useMemo(
    () => ({
      width: "100%",
      height: "100%",
      objectFit: "contain" as const,
      display: "block",
      filter: imageFilterCss,
    }),
    [imageFilterCss],
  );

  // syncLoadingStateIntoRefForUseInAutoplayInterval
  useEffect(() => {
    previewLoadingRef.current = previewLoading;
  }, [previewLoading]);

  // syncSeriesExcludedStateIntoRefForFastReadsDuringFrameLoads
  useEffect(() => {
    const nextMap: Record<string, boolean> = {};
    series.forEach((s) => {
      nextMap[String(s.tiltSeriesId)] = Boolean(s.excluded);
    });
    seriesExcludedRef.current = nextMap;
  }, [series]);

  const getFrameIndexValue = (f: TiltViewRow, fallbackIndex: number): number => {
    const v = f.index != null ? Number(f.index) : fallbackIndex;
    return Number.isFinite(v) ? v : fallbackIndex;
  };

  const syncExcludedSetForSeries = (tiltSeriesId: Id, frames: TiltViewRow[]) => {
    const key = String(tiltSeriesId);
    const nextSet = new Set<number>();
    frames.forEach((f, i) => {
      if (f.excluded) nextSet.add(getFrameIndexValue(f, i));
    });
    excludedBySeriesRef.current[key] = nextSet;
  };

  // helperToFormatApiErrorsSimilarToProjectPage
  const getErrorMsg = (e: any): string => {
    if (e && typeof e === "object") {
      const status = (e as any).status;
      const data = (e as any).data;
      if (status === 500) {
        return (data?.detail as string) || (e as any).message || "Server error";
      }
      return (data?.message as string) || (e as any).message || "Operation failed";
    }
    return "Operation failed";
  };

  // loadListOfTiltSeriesForThisOutput
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setSeriesLoading(true);
        setSeriesError(null);
        setSeries([]);
        setSelectedSeriesId(null);
        setExpandedSeriesId(null);
        setFramesData(null);
        setFramesError(null);
        setSelectedRowIndex(null);
        setIsPlaying(false);

        excludedBySeriesRef.current = {};
        seriesExcludedRef.current = {};

        const raw = await (svc as any).listOutputTiltSeries(projectId, protocolId, outputName);

        if (cancelled) return;

        const items: TiltSeriesSummary[] = (raw || []).map((ts: any) => {
          const idRaw = ts.tiltSeriesId ?? ts.tsId ?? ts.id ?? ts.name ?? ts.label ?? "TiltSeries";
          const id = String(idRaw);

          const label = ts.label ?? ts.name ?? ts.tsLabel ?? `TiltSeries ${id}`;

          const dims: any = ts.dims ?? ts.shape ?? ts.size;

          return {
            tiltSeriesId: id,
            label,
            nViews: ts.nViews ?? ts.count ?? ts.nTilts ?? undefined,
            tiltAxisAngle:
              typeof ts.tiltAxisAngle === "number"
                ? ts.tiltAxisAngle
                : typeof ts.tilt_axis_angle === "number"
                  ? ts.tilt_axis_angle
                  : ts.axisAngle,
            pixelSize:
              typeof ts.pixelSize === "number"
                ? ts.pixelSize
                : typeof ts.samplingRate === "number"
                  ? ts.samplingRate
                  : undefined,
            dims:
              Array.isArray(dims) && dims.length >= 2
                ? [Number(dims[0]), Number(dims[1]), Number(dims[2] ?? 0)]
                : undefined,
          };
        });

        setSeries(items);
        if (items.length > 0) {
          const firstId = items[0].tiltSeriesId;
          setSelectedSeriesId(firstId);
          setExpandedSeriesId(null);
        }
      } catch (e: any) {
        if (!cancelled) {
          setSeriesError(e?.message || "Failed to load tilt series for this output");
        }
      } finally {
        if (!cancelled) setSeriesLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [projectId, protocolId, outputName, svc]);

  useEffect(() => {
    if (selectedTiltSeriesId == null || series.length === 0) return;

    const match = series.find((s) => String(s.tiltSeriesId) === String(selectedTiltSeriesId));
    if (match && String(match.tiltSeriesId) !== String(selectedSeriesId)) {
      setSelectedSeriesId(match.tiltSeriesId);
      setExpandedSeriesId(match.tiltSeriesId);
    }
  }, [selectedTiltSeriesId, series, selectedSeriesId]);


  const activeSeries: TiltSeriesSummary | null = useMemo(() => {
    if (selectedSeriesId == null) return null;
    return series.find((s) => String(s.tiltSeriesId) === String(selectedSeriesId)) ?? null;
  }, [series, selectedSeriesId]);

  // loadFramesForSelectedTiltSeries
  useEffect(() => {
    if (selectedSeriesId == null) {
      setFramesData(null);
      setFramesError(null);
      setSelectedRowIndex(null);
      setIsPlaying(false);
      return;
    }

    let cancelled = false;
    (async () => {
      try {
        setFramesLoading(true);
        setFramesError(null);
        setFramesData(null);
        setSelectedRowIndex(null);
        setIsPlaying(false);

        const raw = await (svc as any).fetchTiltSeriesFrames(
          projectId,
          protocolId,
          outputName,
          selectedSeriesId,
        );

        if (cancelled) return;

        let payload: FramesPayload;

        if (Array.isArray(raw)) {
          payload = {
            tiltSeriesId: selectedSeriesId,
            frames: normalizeFrames(raw),
            tiltAxisAngle: null,
          };
        } else {
          const obj: any = raw ?? {};
          const framesRaw = obj.frames ?? obj.views ?? (Array.isArray(obj.items) ? obj.items : []);
          payload = {
            tiltSeriesId: obj.tiltSeriesId ?? obj.id ?? selectedSeriesId,
            label: obj.label ?? obj.name,
            tiltAxisAngle:
              typeof obj.tiltAxisAngle === "number"
                ? obj.tiltAxisAngle
                : typeof obj.tilt_axis_angle === "number"
                  ? obj.tilt_axis_angle
                  : obj.axisAngle,
            frames: normalizeFrames(framesRaw),
          };
        }

        const seriesKey = String(payload.tiltSeriesId);

        // seedExcludedSetFromServerStateIfMissing
        if (!excludedBySeriesRef.current[seriesKey]) {
          const seeded = new Set<number>();
          payload.frames.forEach((f, i) => {
            if (f.excluded) seeded.add(getFrameIndexValue(f, i));
          });
          excludedBySeriesRef.current[seriesKey] = seeded;
        }

        const excludedSet = excludedBySeriesRef.current[seriesKey] ?? new Set<number>();
        const forceExcludeWholeSeries = Boolean(seriesExcludedRef.current[seriesKey]);

        if (forceExcludeWholeSeries) {
          payload.frames = payload.frames.map((f) => ({ ...f, excluded: true }));
          syncExcludedSetForSeries(payload.tiltSeriesId, payload.frames);
        } else {
          payload.frames = payload.frames.map((f, i) => {
            const idxVal = getFrameIndexValue(f, i);
            const nextExcluded = excludedSet.has(idxVal);
            return f.excluded === nextExcluded ? f : { ...f, excluded: nextExcluded };
          });
        }

        setFramesData(payload);

        if (payload.frames.length > 0) {
          if (selectedTiltImageIndex != null) {
            const requestedIndex = payload.frames.findIndex(
              (frame, framePosition) =>
                getPreviewFrameIndex(
                  frame,
                  framePosition,
                ) === selectedTiltImageIndex,
            );

            setSelectedRowIndex(
              requestedIndex >= 0
                ? requestedIndex
                : Math.min(
                  Math.max(
                    selectedTiltImageIndex,
                    0,
                  ),
                  payload.frames.length - 1,
                ),
            );
          } else if (hideSeriesTable) {
            setSelectedRowIndex(
              Math.floor(
                payload.frames.length / 2,
              ),
            );
          } else {
            const firstIncluded =
              payload.frames.findIndex(
                (frame) => !frame.excluded,
              );

            setSelectedRowIndex(
              firstIncluded >= 0
                ? firstIncluded
                : 0,
            );
          }
        }
      } catch (e: any) {
        if (!cancelled) {
          setFramesError(e?.message || "Failed to load tilt views");
        }
      } finally {
        if (!cancelled) setFramesLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [selectedSeriesId, projectId, protocolId, outputName, svc]);


  useEffect(() => {
    if (
      selectedTiltImageIndex == null ||
      !framesData?.frames?.length
    ) {
      return;
    }

    const requestedIndex =
      framesData.frames.findIndex(
        (frame, framePosition) =>
          getPreviewFrameIndex(
            frame,
            framePosition,
          ) === selectedTiltImageIndex,
      );

    if (requestedIndex >= 0) {
      setSelectedRowIndex(
        requestedIndex,
      );
      return;
    }

    setSelectedRowIndex(
      Math.min(
        Math.max(
          selectedTiltImageIndex,
          0,
        ),
        framesData.frames.length - 1,
      ),
    );
  }, [
    selectedTiltImageIndex,
    framesData?.tiltSeriesId,
    framesData?.frames,
  ]);

  // derivedFilteredFramesForCurrentSelectedSeries
  const filteredFrames: TiltViewRow[] = useMemo(() => {
    if (!framesData?.frames) return [];
    if (!filterText.trim()) return framesData.frames;
    const q = filterText.toLowerCase();
    return framesData.frames.filter((f) => {
      const path = f.path ?? "";
      const angle = f.tiltAngle != null ? String(f.tiltAngle) : "";
      const order = f.order != null ? String(f.order) : "";
      const index = f.index != null ? String(f.index) : "";
      return (
        path.toLowerCase().includes(q) ||
        angle.toLowerCase().includes(q) ||
        order.toLowerCase().includes(q) ||
        index.toLowerCase().includes(q)
      );
    });
  }, [framesData, filterText]);

  // mapSelectedRowIndexToSameIndexInFilteredList
  const selectedFilteredIndex = useMemo(() => {
    if (selectedRowIndex == null || !framesData?.frames || !filteredFrames.length) {
      return null;
    }
    const selectedView = framesData.frames[selectedRowIndex];
    if (!selectedView) return null;
    const idx = filteredFrames.findIndex((f) => String(f.viewId) === String(selectedView.viewId));
    return idx >= 0 ? idx : null;
  }, [selectedRowIndex, framesData, filteredFrames]);

  // selectedFrameObjectForCurrentSeriesIndex
  const selectedFrame: TiltViewRow | null = useMemo(() => {
    if (selectedRowIndex == null || !framesData?.frames || !framesData.frames.length) {
      return null;
    }
    return framesData.frames[selectedRowIndex] ?? null;
  }, [framesData, selectedRowIndex]);

  // toggleExcludeAtFrameIndexAndSyncSeriesExcludedFlag
  const toggleExcludeAtIndex = (frameIndex: number) => {
    setFramesData((prev) => {
      if (!prev) return prev;
      if (frameIndex < 0 || frameIndex >= prev.frames.length) {
        return prev;
      }

      const nextFrames = prev.frames.map((f, idx) =>
        idx === frameIndex ? { ...f, excluded: !f.excluded } : f,
      );

      syncExcludedSetForSeries(prev.tiltSeriesId, nextFrames);

      const allExcluded = nextFrames.length > 0 && nextFrames.every((f) => f.excluded);

      setSeries((prevSeries) =>
        prevSeries.map((s) =>
          String(s.tiltSeriesId) === String(prev.tiltSeriesId) ? { ...s, excluded: allExcluded } : s,
        ),
      );

      seriesExcludedRef.current[String(prev.tiltSeriesId)] = allExcluded;

      return { ...prev, frames: nextFrames };
    });
  };

  const handleToggleExcludeCurrent = () => {
    if (selectedRowIndex == null || !framesData?.frames?.length) {
      return;
    }
    toggleExcludeAtIndex(selectedRowIndex);
  };

  const handleToggleExcludeRow = (row: TiltViewRow) => {
    if (!framesData?.frames) return;
    const idx = framesData.frames.findIndex((f) => String(f.viewId) === String(row.viewId));
    if (idx >= 0) {
      toggleExcludeAtIndex(idx);
    }
  };

  // toggleExcludeForWholeTiltSeriesAndItsFramesIfLoaded
  const handleToggleExcludeSeries = (seriesId: Id) => {
    let updatedByFrames = false;

    setFramesData((prev) => {
      if (!prev || String(prev.tiltSeriesId) !== String(seriesId)) {
        return prev;
      }
      updatedByFrames = true;

      const anyIncluded = prev.frames.some((f) => !f.excluded);
      const newExcluded = anyIncluded;
      const nextFrames = prev.frames.map((f) => ({
        ...f,
        excluded: newExcluded,
      }));

      syncExcludedSetForSeries(seriesId, nextFrames);

      setSeries((prevSeries) =>
        prevSeries.map((s) =>
          String(s.tiltSeriesId) === String(seriesId) ? { ...s, excluded: newExcluded } : s,
        ),
      );

      seriesExcludedRef.current[String(seriesId)] = newExcluded;

      return { ...prev, frames: nextFrames };
    });

    if (!updatedByFrames) {
      setSeries((prevSeries) => {
        const nextSeries = prevSeries.map((s) => {
          if (String(s.tiltSeriesId) !== String(seriesId)) return s;
          const nextExcluded = !s.excluded;
          seriesExcludedRef.current[String(seriesId)] = Boolean(nextExcluded);
          return { ...s, excluded: nextExcluded };
        });
        return nextSeries;
      });
    }
  };

  const getPreviewFrameIndex = (frame: TiltViewRow | null | undefined, fallbackIndex: number): number => {
    const rawIndex = frame?.index != null ? Number(frame.index) : fallbackIndex;
    return Number.isFinite(rawIndex) ? rawIndex : fallbackIndex;
  };

  const trimPreviewCache = useCallback((keepKeys: Set<string> = new Set()) => {
    const cache = previewCacheRef.current;

    if (cache.size <= PREVIEW_CACHE_LIMIT) return;

    const entries = Array.from(cache.entries()).sort((a, b) => a[1].lastUsed - b[1].lastUsed);

    for (const [key, cached] of entries) {
      if (cache.size <= PREVIEW_CACHE_LIMIT) break;
      if (keepKeys.has(key)) continue;

      try {
        cached.revoke?.();
      } catch {
        // ignore
      }

      cache.delete(key);
    }
  }, []);

  const prefetchPreviewAtIndex = useCallback(
    (rowIndex: number, size: number) => {
      if (mainMode !== "viewer") return;
      if (selectedSeriesId == null) return;
      if (!framesData?.frames?.length) return;
      if (rowIndex < 0 || rowIndex >= framesData.frames.length) return;

      const frame = framesData.frames[rowIndex];
      const frameIndex = getPreviewFrameIndex(frame, rowIndex);

      const cacheKey = buildPreviewCacheKey(
        projectId,
        protocolId,
        outputName,
        selectedSeriesId,
        frameIndex,
        size,
        applyTransform,
      );

      if (previewCacheRef.current.has(cacheKey)) return;
      if (previewInFlightRef.current.has(cacheKey)) return;

      previewInFlightRef.current.add(cacheKey);

      const options: any = {
        size,
        normalize: "minmax",
      };

      if (applyTransform) {
        options.applyTransform = true;
      }

      void (svc as any)
        .fetchTiltSeriesViewImageObjectUrl(
          projectId,
          protocolId,
          outputName,
          selectedSeriesId,
          frameIndex,
          options,
        )
        .then((result: ObjectUrlResult | null) => {
          if (!result?.url) return;

          previewCacheRef.current.set(cacheKey, {
            url: result.url,
            revoke: result.revoke,
            lastUsed: Date.now(),
          });

          trimPreviewCache(new Set([cacheKey]));
        })
        .catch(() => {
          // ignore background prefetch errors
        })
        .finally(() => {
          previewInFlightRef.current.delete(cacheKey);
        });
    },
    [
      mainMode,
      selectedSeriesId,
      framesData?.frames,
      projectId,
      protocolId,
      outputName,
      applyTransform,
      svc,
      trimPreviewCache,
    ],
  );

  const prefetchPreviewBatch = useCallback(
    async (
      rowIndexes: number[],
      size: number,
      options: {
        signal?: AbortSignal;
        fallbackToIndividual?: boolean;
      } = {},
    ) => {
      if (mainMode !== "viewer") return;
      if (selectedSeriesId == null) return;
      if (!framesData?.frames?.length) return;

      const {
        signal,
        fallbackToIndividual = true,
      } = options;

      if (signal?.aborted) return;

      const pending: Array<{
        rowIndex: number;
        frameIndex: number;
        cacheKey: string;
      }> = [];

      const seenFrameIndexes = new Set<number>();

      rowIndexes.forEach((rowIndex) => {
        if (rowIndex < 0 || rowIndex >= framesData.frames.length) return;

        const frame = framesData.frames[rowIndex];
        const frameIndex = getPreviewFrameIndex(frame, rowIndex);

        if (seenFrameIndexes.has(frameIndex)) return;
        seenFrameIndexes.add(frameIndex);

        const cacheKey = buildPreviewCacheKey(
          projectId,
          protocolId,
          outputName,
          selectedSeriesId,
          frameIndex,
          size,
          applyTransform,
        );

        if (previewCacheRef.current.has(cacheKey)) return;
        if (previewInFlightRef.current.has(cacheKey)) return;

        pending.push({
          rowIndex,
          frameIndex,
          cacheKey,
        });
      });

      if (!pending.length) return;

      const batchFetcher = (svc as any).fetchTiltSeriesViewImagesBatch;

      if (typeof batchFetcher !== "function") {
        if (fallbackToIndividual) {
          pending.forEach((item) => {
            prefetchPreviewAtIndex(item.rowIndex, size);
          });
        }
        return;
      }

      pending.forEach((item) => {
        previewInFlightRef.current.add(item.cacheKey);
      });

      try {
        const result = await batchFetcher(
          projectId,
          protocolId,
          outputName,
          selectedSeriesId,
          {
            indices: pending.map((item) => item.frameIndex),
            size,
            format: "webp",
            applyTransform,
            signal,
          },
        );

        if (signal?.aborted) return;

        const items = Array.isArray(result?.items) ? result.items : [];

        items.forEach((item: any) => {
          const frameIndex = Number(item?.index);
          const dataUrl = String(item?.dataUrl ?? "");

          if (!Number.isFinite(frameIndex) || !dataUrl) return;

          const cacheKey = buildPreviewCacheKey(
            projectId,
            protocolId,
            outputName,
            selectedSeriesId,
            frameIndex,
            size,
            applyTransform,
          );

          previewCacheRef.current.set(cacheKey, {
            url: dataUrl,
            revoke: undefined,
            lastUsed: Date.now(),
          });
        });

        trimPreviewCache(
          new Set(
            pending.map((item) => item.cacheKey),
          ),
        );
      } catch {
        if (!signal?.aborted && fallbackToIndividual) {
          pending.forEach((item) => {
            previewInFlightRef.current.delete(item.cacheKey);
          });

          pending.forEach((item) => {
            prefetchPreviewAtIndex(item.rowIndex, size);
          });
        }
      } finally {
        pending.forEach((item) => {
          previewInFlightRef.current.delete(item.cacheKey);
        });
      }
    },
    [
      mainMode,
      selectedSeriesId,
      framesData?.frames,
      projectId,
      protocolId,
      outputName,
      applyTransform,
      svc,
      trimPreviewCache,
      prefetchPreviewAtIndex,
    ],
  );

  // warmActiveTiltSeriesAtInteractiveResolution
  useEffect(() => {
    previewWarmupAbortRef.current?.abort();
    previewWarmupAbortRef.current = null;

    if (mainMode !== "viewer") return;
    if (selectedSeriesId == null) return;
    if (!framesData?.frames?.length) return;

    if (
      String(framesData.tiltSeriesId) !==
      String(selectedSeriesId)
    ) {
      return;
    }

    const controller = new AbortController();
    previewWarmupAbortRef.current = controller;

    const totalFrames = framesData.frames.length;

    const firstIncluded = framesData.frames.findIndex(
      (frame) => !frame.excluded,
    );

    const startRowIndex =
      firstIncluded >= 0
        ? firstIncluded
        : 0;

    const orderedRowIndexes: number[] = [
      startRowIndex,
    ];

    for (
      let distance = 1;
      orderedRowIndexes.length < totalFrames;
      distance += 1
    ) {
      const forwardIndex =
        startRowIndex + distance;

      const backwardIndex =
        startRowIndex - distance;

      if (forwardIndex < totalFrames) {
        orderedRowIndexes.push(
          forwardIndex,
        );
      }

      if (backwardIndex >= 0) {
        orderedRowIndexes.push(
          backwardIndex,
        );
      }
    }

    void (async () => {
      for (
        let offset = 0;
        offset < orderedRowIndexes.length;
        offset += PREVIEW_BATCH_SIZE
      ) {
        if (controller.signal.aborted) {
          return;
        }

        await prefetchPreviewBatch(
          orderedRowIndexes.slice(
            offset,
            offset + PREVIEW_BATCH_SIZE,
          ),
          PREVIEW_SIZE_INTERACTIVE,
          {
            signal: controller.signal,
            fallbackToIndividual: false,
          },
        );
      }
    })();

    return () => {
      controller.abort();

      if (
        previewWarmupAbortRef.current ===
        controller
      ) {
        previewWarmupAbortRef.current = null;
      }
    };
  }, [
    mainMode,
    selectedSeriesId,
    framesData?.tiltSeriesId,
    framesData?.frames?.length,
    applyTransform,
    prefetchPreviewBatch,
  ]);

  // previewImageForSelectedViewOnlyWhenFramesAreAlreadyLoaded
  useEffect(() => {

    if (mainMode === "metadata") {
      previewAbortRef.current?.abort();
      setPreviewLoading(false);
      return;
    }

    if (selectedSeriesId == null || selectedRowIndex == null || !selectedFrame) {
      previewAbortRef.current?.abort();
      setPreviewUrl(null);
      setPreviewError(null);
      setPreviewLoading(false);
      return;
    }

    const frameIndex = getPreviewFrameIndex(selectedFrame, selectedRowIndex);

    const shouldBypassPreviewCache =
      previewReloadToken !== consumedPreviewReloadTokenRef.current;

    const previewSize = getPreviewRequestSize(
      isPlaying,
      isScrubbing,
      shouldBypassPreviewCache,
    );

    const cacheKey = buildPreviewCacheKey(
      projectId,
      protocolId,
      outputName,
      selectedSeriesId,
      frameIndex,
      previewSize,
      applyTransform,
    );

    const cachedPreview = shouldBypassPreviewCache ? undefined : previewCacheRef.current.get(cacheKey);

    if (cachedPreview) {
      cachedPreview.lastUsed = Date.now();

      previewAbortRef.current?.abort();
      setPreviewLoading(false);
      setPreviewError(null);
      setPreviewUrl(cachedPreview.url);

      return;
    }

    if (shouldBypassPreviewCache) {
      const stalePreview = previewCacheRef.current.get(cacheKey);
      if (stalePreview?.revoke) {
        try {
          stalePreview.revoke();
        } catch {
          // ignore
        }
      }

      previewCacheRef.current.delete(cacheKey);
      consumedPreviewReloadTokenRef.current = previewReloadToken;
    }

    previewAbortRef.current?.abort();
    const controller = new AbortController();
    previewAbortRef.current = controller;
    const reqId = ++previewReqIdRef.current;

    (async () => {
      try {
        setPreviewLoading(true);
        setPreviewError(null);

        const options: any = {
          size: previewSize,
          normalize: "minmax",
          signal: controller.signal,
        };
        if (applyTransform) {
          options.applyTransform = true;
        }

        const result: ObjectUrlResult | null = await (svc as any).fetchTiltSeriesViewImageObjectUrl(
          projectId,
          protocolId,
          outputName,
          selectedSeriesId,
          frameIndex,
          options,
        );

        if (controller.signal.aborted || previewReqIdRef.current !== reqId) {
          if (result?.revoke) {
            try {
              result.revoke();
            } catch {
              // ignore
            }
          }
          return;
        }

        if (result?.url) {
          previewCacheRef.current.set(cacheKey, {
            url: result.url,
            revoke: result.revoke,
            lastUsed: Date.now(),
          });

          trimPreviewCache(new Set([cacheKey]));
        }

        setPreviewUrl(result?.url ?? null);
      } catch (e: any) {
        if (controller.signal.aborted || previewReqIdRef.current !== reqId) {
          return;
        }
        setPreviewError(e?.message || "Failed to load tilt image preview");
        setPreviewUrl(null);
      } finally {
        if (!controller.signal.aborted && previewReqIdRef.current === reqId) {
          setPreviewLoading(false);
        }
      }
    })();

    return () => {
      controller.abort();

      if (previewReqIdRef.current === reqId) {
        previewReqIdRef.current += 1;
      }
    };
  }, [
    mainMode,
    selectedSeriesId,
    selectedRowIndex,
    selectedFrame,
    projectId,
    protocolId,
    outputName,
    svc,
    previewReloadToken,
    applyTransform,
    isPlaying,
    isScrubbing,
    trimPreviewCache,
  ]);


  useEffect(() => {
    if (mainMode !== "viewer") return;
    if (selectedSeriesId == null) return;
    if (selectedRowIndex == null) return;
    if (!framesData?.frames?.length) return;

    if (previewPrefetchTimerRef.current != null) {
      window.clearTimeout(previewPrefetchTimerRef.current);
      previewPrefetchTimerRef.current = null;
    }

    const size = isPlaying || isScrubbing ? PREVIEW_SIZE_INTERACTIVE : PREVIEW_SIZE_NORMAL;

    const offsets = isPlaying
      ? playDirectionRef.current === 1
        ? PREVIEW_FORWARD_OFFSETS
        : PREVIEW_BACKWARD_OFFSETS
      : isScrubbing
        ? SCRUBBING_PREVIEW_NEIGHBOR_OFFSETS
        : PREVIEW_NEIGHBOR_OFFSETS;

    previewPrefetchTimerRef.current = window.setTimeout(() => {
      prefetchPreviewBatch(
        offsets.map((offset) => selectedRowIndex + offset),
        size,
      );

      previewPrefetchTimerRef.current = null;
    }, isScrubbing ? 120 : 60);

    return () => {
      if (previewPrefetchTimerRef.current != null) {
        window.clearTimeout(previewPrefetchTimerRef.current);
        previewPrefetchTimerRef.current = null;
      }
    };
  }, [
    mainMode,
    selectedSeriesId,
    selectedRowIndex,
    framesData?.frames?.length,
    isPlaying,
    isScrubbing,
    prefetchPreviewBatch,
  ]);

  // manageDisplayedUrlVsTransitionUrlForSmoothCrossfade
  useEffect(() => {
    if (!previewUrl) {
      setDisplayedUrl(null);
      setTransitionUrl(null);
      return;
    }
    if (!displayedUrl) {
      setDisplayedUrl(previewUrl);
      setTransitionUrl(null);
      return;
    }
    if (previewUrl === displayedUrl) {
      return;
    }
    setTransitionUrl(previewUrl);
  }, [previewUrl, displayedUrl]);

  // cleanupObjectUrlAndAutoplayOnUnmount
  useEffect(() => {
    return () => {
      previewAbortRef.current?.abort();
      previewWarmupAbortRef.current?.abort();
      previewWarmupAbortRef.current = null;
      previewAbortRef.current = null;
      previewReqIdRef.current += 1;
      previewLoadingRef.current = false;

      if (previewPrefetchTimerRef.current != null) {
        window.clearTimeout(previewPrefetchTimerRef.current);
        previewPrefetchTimerRef.current = null;
      }

      previewCacheRef.current.forEach((cached) => {
        try {
          cached.revoke?.();
        } catch {
          // ignore
        }
      });
      previewCacheRef.current.clear();
      previewInFlightRef.current.clear();

      if (autoplayRef.current != null) {
        window.clearInterval(autoplayRef.current);
        autoplayRef.current = null;
      }
    };
  }, []);

  const totalFrames = framesData?.frames.length ?? 0;
  const sliceSliderMax = Math.max(totalFrames - 1, 0);
  const sliceSliderValue =
    selectedRowIndex == null ? 0 : Math.min(Math.max(selectedRowIndex, 0), sliceSliderMax);

  const tiltAxisAngle = framesData?.tiltAxisAngle ?? activeSeries?.tiltAxisAngle ?? null;


  const canGoPrev = selectedRowIndex != null && selectedRowIndex > 0 && totalFrames > 0;
  const canGoNext = selectedRowIndex != null && totalFrames > 0 && selectedRowIndex < totalFrames - 1;

  const handlePrev = () => {
    if (!canGoPrev || selectedRowIndex == null) return;
    setSelectedRowIndex((prev) => (prev == null ? prev : prev - 1));
  };

  const handleNext = () => {
    if (!canGoNext || selectedRowIndex == null) return;
    setSelectedRowIndex((prev) => (prev == null ? prev : prev + 1));
  };

  const handleRowClick = (row: TiltViewRow) => {
    if (!framesData?.frames) return;
    const idx = framesData.frames.findIndex((f) => String(f.viewId) === String(row.viewId));
    if (idx >= 0) {
      setSelectedRowIndex(idx);
    }
  };

  const handleSliceSliderChange = (_: Event, value: number | number[]) => {
    const rawValue = Array.isArray(value) ? value[0] : value;
    const nextIndex = Math.round(Number(rawValue));

    if (!Number.isFinite(nextIndex) || totalFrames <= 0) return;

    setIsPlaying(false);
    setIsScrubbing(true);
    setSelectedRowIndex(Math.min(Math.max(nextIndex, 0), totalFrames - 1));
  };

  const handleSliceSliderCommitted = (_: any, value: number | number[]) => {
    const rawValue = Array.isArray(value) ? value[0] : value;
    const nextIndex = Math.round(Number(rawValue));

    setIsScrubbing(false);

    if (!Number.isFinite(nextIndex) || totalFrames <= 0) return;

    setSelectedRowIndex(Math.min(Math.max(nextIndex, 0), totalFrames - 1));
  };

  useEffect(() => {
    if (mainMode !== "viewer") return;
    if (selectedRowIndex == null || !framesData?.frames?.length) return;
    if (selectedSeriesId == null || expandedSeriesId == null) return;
    if (String(selectedSeriesId) !== String(expandedSeriesId)) return;

    window.requestAnimationFrame(() => {
      const root = treeScrollRef.current;
      if (!root) return;

      const selectedRow = root.querySelector('[data-selected-tilt-row="true"]') as HTMLElement | null;
      if (typeof selectedRow?.scrollIntoView === "function") {
        selectedRow.scrollIntoView({ block: "nearest", inline: "nearest" });
      }
    });
  }, [
    mainMode,
    selectedRowIndex,
    selectedSeriesId,
    expandedSeriesId,
    framesData?.tiltSeriesId,
    framesData?.frames?.length,
    filteredFrames.length,
  ]);

  const handleSeriesRowClick = (seriesId: Id) => {
    setSelectedSeriesId((prev) => (prev != null && String(prev) === String(seriesId) ? prev : seriesId));

    const selectedSeries = series.find((s) => String(s.tiltSeriesId) === String(seriesId));
    if (selectedSeries) {
      onTiltSeriesSelect?.(selectedSeries);
    }
  };

  const handleRefreshPreview = () => {
    if (selectedRowIndex == null) return;
    setPreviewUrl(null);
    setPreviewError(null);
    setDisplayedUrl(null);
    setTransitionUrl(null);
    setPreviewReloadToken((t) => t + 1);
  };

  // whenTogglingApplyTransformAvoidCrossfadeBetweenMisalignedImages
  const handleToggleApplyTransform = () => {
    previewAbortRef.current?.abort();
    setPreviewUrl(null);
    setPreviewError(null);
    setDisplayedUrl(null);
    setTransitionUrl(null);
    setApplyTransform((prev) => !prev);
  };

  // buildExclusionsSummaryFromPersistedPerSeriesState
  const buildExclusionsSummary = (): TiltExclusionsMap => {
    const summary: TiltExclusionsMap = {};

    series.forEach((s) => {
      const key = String(s.tiltSeriesId);
      const set = excludedBySeriesRef.current[key];
      const tiltimages = set ? Array.from(set).sort((a, b) => a - b) : [];

      let excluded = Boolean(s.excluded);

      if (!excluded && s.nViews != null && tiltimages.length === s.nViews) {
        excluded = true;
      }

      summary[key] = {
        excluded,
        tiltimages,
      };
    });

    return summary;
  };

  const handleSaveClick = () => {
    const summary = buildExclusionsSummary();
    exclusionsRef.current = summary;
    setSaveBusy(false);
    // eslint-disable-next-line no-console
    console.log("Tilt series exclusion summary", summary);
    setSaveDialogOpen(true);
  };

  const handleSaveCancel = () => {
    if (saveBusy) return;
    setSaveDialogOpen(false);
  };

  const handleSaveYes = async () => {
    const summary = exclusionsRef.current;
    if (!summary) {
      setSaveDialogOpen(false);
      return;
    }

    setSaveDialogOpen(false);
    setSaveBusy(true);

    try {
      await (svc as any).createNewSetOfTiltSeries(
        projectId,
        protocolId,
        outputName,
        summary,
        false,
      );

      toast.success("New tilt series set created successfully.");
    } catch (e: any) {
      // eslint-disable-next-line no-console
      console.error("Failed to create new set of tiltseries", e);
      toast.error(getErrorMsg(e));
    } finally {
      setSaveBusy(false);
    }
  };

  const handleSaveRestack = async () => {
    const summary = exclusionsRef.current;
    if (!summary) {
      setSaveDialogOpen(false);
      return;
    }

    setSaveDialogOpen(false);
    setSaveBusy(true);

    try {
      await (svc as any).createNewSetOfTiltSeries(
        projectId,
        protocolId,
        outputName,
        summary,
        true,
      );

      toast.success("New re-stacked tilt series set created successfully.");
    } catch (e: any) {
      // eslint-disable-next-line no-console
      console.error("Failed to create new set of tiltseries (restack)", e);
      toast.error(getErrorMsg(e));
    } finally {
      setSaveBusy(false);
    }
  };

  // autoplayPingPongBetweenFirstAndLastTilt
  useEffect(() => {
    if (!isPlaying || !framesData?.frames?.length) {
      if (autoplayRef.current != null) {
        window.clearInterval(autoplayRef.current);
        autoplayRef.current = null;
      }
      return;
    }

    const handle = window.setInterval(() => {
      setSelectedRowIndex((prev) => {
        const total = framesData?.frames?.length ?? 0;
        if (!total) return prev;

        // doNotAdvanceWhileCurrentPreviewIsStillLoading
        if (previewLoadingRef.current) {
          return prev;
        }

        if (prev == null) {
          return 0;
        }

        let next = prev + playDirectionRef.current;

        if (next >= total) {
          playDirectionRef.current = -1;
          next = total - 2 >= 0 ? total - 2 : 0;
        } else if (next < 0) {
          playDirectionRef.current = 1;
          next = total > 1 ? 1 : 0;
        }

        return next;
      });
    }, 400);

    autoplayRef.current = handle;

    return () => {
      window.clearInterval(handle);
      if (autoplayRef.current === handle) {
        autoplayRef.current = null;
      }
    };
  }, [isPlaying, framesData?.frames?.length]);

  if (mainMode === "metadata") {
    return (
      <Box
        sx={{
          display: "flex",
          flexDirection: "column",
          height: "100%",
          width: "100%",
          minHeight: 0,
          minWidth: 0,
          overflow: "hidden",
        }}
      >
        <Paper
          square
          elevation={0}
          sx={{
            p: 1.5,
            borderBottom: "1px solid #e5e7eb",
            display: "flex",
            alignItems: "center",
            gap: 1,
            flexShrink: 0,
          }}
        >
          <Tooltip title="Show TitlSerie viewer">
            <span>
              <Button
                size="small"
                variant="outlined"
                startIcon={<ArrowBack fontSize="small" />}
                disabled={!canOpenMetadata}
                onClick={() => setMainMode("viewer")}
                sx={{ textTransform: "none" }}
              >
                TitlSerie viewer
              </Button>
            </span>
          </Tooltip>


        </Paper>

        <Box sx={{ flex: 1, minHeight: 0, overflow: "hidden" }}>
          {canOpenMetadata ? (
            <MetadataViewer
              projectId={projectIdNum}
              protocolId={protocolIdNum}
              outputName={outputName}
              embedded
              onClose={() => setMainMode("viewer")}
            />
          ) : (
            <Box sx={{ p: 2 }}>
              <Typography variant="body2" color="text.secondary">
                Metadata view requires numeric projectId/protocolId.
              </Typography>
            </Box>
          )}
        </Box>
      </Box>
    );
  }

  return (
    <>
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
        {/* leftSideTiltSeriesTreeAndTiltViews */}
        <Box
          sx={{
            flex: 1.4,
            minWidth: 0,
            display: hideSeriesTable
              ? "none"
              : "flex",
            flexDirection: "column",
            borderRight: "1px solid #e5e7eb",
          }}
        >
          <Paper
            square
            elevation={0}
            sx={{
              p: 0.75,
              borderBottom: "1px solid #e5e7eb",
              display: "flex",
              alignItems: "center",
              gap: 1,
            }}
          >
            <Typography
              variant="caption"
              color="text.secondary"
              sx={{ fontSize: "0.75rem", whiteSpace: "nowrap" }}
            >
              Filter (selected series)
            </Typography>
            <TextField
              size="small"
              variant="outlined"
              value={filterText}
              onChange={(e) => setFilterText(e.target.value)}
              placeholder="Filter by angle, order or path"
              sx={{
                maxWidth: 260,
                "& .MuiInputBase-input": {
                  fontSize: "0.75rem",
                  paddingY: 0.5,
                },
                "& input::placeholder": {
                  fontSize: "0.7rem",
                },
              }}
            />
            <Button
              size="small"
              variant="outlined"
              onClick={handleSaveClick}
              disabled={!series.length || saveBusy}
              sx={{
                textTransform: "none",
                fontSize: "0.8rem",
                paddingX: 1.5,
                paddingY: 0.25,
                borderRadius: "6px",
              }}
            >
              Save
            </Button>
            {seriesError && !seriesLoading && (
              <Typography variant="caption" color="error" sx={{ fontSize: "0.7rem" }}>
                {seriesError}
              </Typography>
            )}
          </Paper>

          <Box
            ref={treeScrollRef}
            sx={{
              flex: 1,
              minHeight: 0,
              overflowY: "auto",
              overflowX: "hidden",
            }}
          >
            {seriesLoading && !series.length ? (
              <Box sx={{ p: 2, display: "flex", gap: 1, alignItems: "center" }}>
                <CircularProgress size={18} />
                <Typography variant="body2" color="text.secondary">
                  Loading tilt series…
                </Typography>
              </Box>
            ) : framesError && !framesData ? (
              <Box sx={{ p: 2 }}>
                <Typography variant="body2" color="error">
                  {framesError}
                </Typography>
              </Box>
            ) : !series.length ? (
              <Box sx={{ p: 2 }}>
                <Typography variant="body2" color="text.secondary">
                  No tilt series available for this output.
                </Typography>
              </Box>
            ) : (
              <Table
                size="small"
                stickyHeader
                sx={{
                  tableLayout: "fixed",
                  width: "100%",
                  "& th": {
                    whiteSpace: "nowrap",
                    fontSize: "0.75rem",
                    paddingTop: 0.5,
                    paddingBottom: 0.5,
                  },
                  "& td": {
                    fontSize: "0.75rem",
                    paddingTop: 0.25,
                    paddingBottom: 0.25,
                  },
                }}
              >
                <TableHead>
                  <TableRow>
                    <TableCell sx={columnWidths.series}>Tilt series</TableCell>
                    <TableCell sx={columnWidths.order}>Order</TableCell>
                    <TableCell sx={columnWidths.angle}>Tilt angle</TableCell>
                    <TableCell sx={columnWidths.excluded}>Excl.</TableCell>
                    <TableCell sx={columnWidths.dose}>Dose</TableCell>
                    <TableCell sx={columnWidths.path}>Path</TableCell>
                    <TableCell sx={columnWidths.rot}>Rot</TableCell>
                    <TableCell sx={columnWidths.shiftX}>ShiftX</TableCell>
                    <TableCell sx={columnWidths.shiftY}>ShiftY</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {series.map((s) => {
                    const isExpanded =
                      expandedSeriesId != null && String(expandedSeriesId) === String(s.tiltSeriesId);
                    const isSelectedSeries =
                      selectedSeriesId != null && String(selectedSeriesId) === String(s.tiltSeriesId);

                    const showFramesForThisSeries =
                      isExpanded && framesData && String(framesData.tiltSeriesId) === String(s.tiltSeriesId);

                    const seriesFrames = showFramesForThisSeries ? filteredFrames : [];

                    return (
                      <Fragment key={String(s.tiltSeriesId)}>
                        {/* seriesRow */}
                        <TableRow
                          hover
                          selected={isSelectedSeries}
                          onClick={() => handleSeriesRowClick(s.tiltSeriesId)}
                          sx={{
                            cursor: "pointer",
                            ...(s.excluded && {
                              backgroundColor: "rgba(248,113,113,0.16)",
                              "&:hover": { backgroundColor: "rgba(248,113,113,0.24)" },
                              "&.Mui-selected": { backgroundColor: "rgba(248,113,113,0.30)" },
                              "&.Mui-selected:hover": { backgroundColor: "rgba(248,113,113,0.36)" },
                            }),
                          }}
                        >
                          <TableCell sx={columnWidths.series}>
                            <Box sx={{ display: "flex", alignItems: "center", gap: 0.25 }}>
                              <IconButton
                                size="small"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  const nextExpanded = isExpanded ? null : s.tiltSeriesId;
                                  setExpandedSeriesId(nextExpanded);
                                  if (nextExpanded) {
                                    setSelectedSeriesId((prev) =>
                                      prev != null && String(prev) === String(s.tiltSeriesId) ? prev : s.tiltSeriesId,
                                    );
                                    onTiltSeriesSelect?.(s);
                                  }
                                }}
                                sx={{ mr: 0.25 }}
                              >
                                {isExpanded ? <ExpandMore fontSize="small" /> : <ChevronRight fontSize="small" />}
                              </IconButton>
                              <Checkbox
                                size="small"
                                checked={Boolean(s.excluded)}
                                onClick={(e) => e.stopPropagation()}
                                onChange={() => handleToggleExcludeSeries(s.tiltSeriesId)}
                                sx={{ padding: 0.25 }}
                              />
                              <Typography
                                variant="body2"
                                noWrap
                                title={s.label}
                                sx={{ fontSize: "0.75rem" }}
                              >
                                {String(s.tiltSeriesId)}
                              </Typography>
                            </Box>
                          </TableCell>
                          <TableCell sx={columnWidths.order} />
                          <TableCell sx={columnWidths.angle} />
                          <TableCell sx={columnWidths.excluded} />
                          <TableCell sx={columnWidths.dose} />
                          <TableCell sx={columnWidths.path} />
                          <TableCell sx={columnWidths.rot} />
                          <TableCell sx={columnWidths.shiftX} />
                          <TableCell sx={columnWidths.shiftY} />
                        </TableRow>

                        {/* frameRowsForThisSeries */}
                        {showFramesForThisSeries &&
                          seriesFrames.map((row, idx) => {
                            const isSelectedRow = idx === selectedFilteredIndex && isSelectedSeries;
                            return (
                              <TableRow
                                key={`${String(s.tiltSeriesId)}-${String(row.viewId)}`}
                                hover
                                selected={isSelectedRow}
                                data-selected-tilt-row={isSelectedRow ? "true" : undefined}
                                onClick={() => handleRowClick(row)}
                                sx={{
                                  cursor: "pointer",
                                  ...(row.excluded && {
                                    backgroundColor: "rgba(248,113,113,0.16)",
                                    "&:hover": { backgroundColor: "rgba(248,113,113,0.24)" },
                                    "&.Mui-selected": { backgroundColor: "rgba(248,113,113,0.30)" },
                                    "&.Mui-selected:hover": { backgroundColor: "rgba(248,113,113,0.36)" },
                                  }),
                                }}
                              >
                                <TableCell sx={columnWidths.series}>
                                  <Box sx={{ pl: 6, display: "flex", alignItems: "center" }}>
                                    <Typography variant="body2" sx={{ fontSize: "0.75rem" }}>
                                      {row.index != null ? row.index : ""}
                                    </Typography>
                                  </Box>
                                </TableCell>
                                <TableCell sx={columnWidths.order}>{row.order != null ? row.order : ""}</TableCell>
                                <TableCell sx={columnWidths.angle}>
                                  {row.tiltAngle != null ? row.tiltAngle.toFixed(2) : ""}
                                </TableCell>
                                <TableCell sx={columnWidths.excluded}>
                                  <Checkbox
                                    size="small"
                                    checked={Boolean(row.excluded)}
                                    onClick={(e) => e.stopPropagation()}
                                    onChange={() => handleToggleExcludeRow(row)}
                                    sx={{ padding: 0.25 }}
                                  />
                                </TableCell>
                                <TableCell sx={columnWidths.dose}>{row.dose != null ? row.dose.toFixed(2) : ""}</TableCell>
                                <TableCell
                                  sx={{
                                    ...columnWidths.path,
                                    whiteSpace: "nowrap",
                                    overflow: "hidden",
                                  }}
                                  title={row.path ?? undefined}
                                >
                                  {row.path ? truncatePathMiddle(row.path) : ""}
                                </TableCell>
                                <TableCell sx={columnWidths.rot}>{row.rot != null ? row.rot.toFixed(2) : ""}</TableCell>
                                <TableCell sx={columnWidths.shiftX}>
                                  {row.shiftX != null ? row.shiftX.toFixed(2) : ""}
                                </TableCell>
                                <TableCell sx={columnWidths.shiftY}>
                                  {row.shiftY != null ? row.shiftY.toFixed(2) : ""}
                                </TableCell>
                              </TableRow>
                            );
                          })}
                      </Fragment>
                    );
                  })}
                </TableBody>
              </Table>
            )}
          </Box>
        </Box>

        {/* rightSideImagePreviewAndControls */}
        <Box sx={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
          <Paper
            square
            elevation={0}
            sx={{
              p: 0.75,
              borderBottom: "1px solid #e5e7eb",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 1,
            }}
          >
            <Box sx={{ display: "flex", flexDirection: "column", gap: 0.25 }}>
              <Typography variant="subtitle2" sx={{ fontSize: "0.8rem" }}>
                Tilt view preview
              </Typography>
              <Typography variant="caption" color="text.secondary" sx={{ fontSize: "0.7rem" }}>
                {selectedRowIndex != null && totalFrames > 0
                  ? `View ${selectedRowIndex + 1} of ${totalFrames}`
                  : "No view selected"}
              </Typography>
            </Box>

            <Box
              sx={{
                display: "flex",
                alignItems: "center",
                gap: 1,
                flexWrap: "wrap",
                minWidth: 0,
              }}
            >
              {!hideMetadataAction ? (
                <Tooltip title="Show metadata viewer">
                  <span>
                    <Button
                      size="small"
                      variant="outlined"
                      startIcon={<MetadataIcon fontSize="small" />}
                      disabled={!canOpenMetadata}
                      onClick={() => setMainMode("metadata")}
                      sx={{ textTransform: "none" }}
                    >
                      Metadata
                    </Button>
                  </span>
                </Tooltip>
              ) : null}

              <ExternalViewersBar
                projectId={projectId}
                protocolId={protocolId}
                outputName={outputName}
                objectId={selectedSeriesId}
                objectKind="tiltSeries"
                disabled={selectedSeriesId == null}
              />
            </Box>

          </Paper>

          {/* smallerBrightnessContrastPanel */}
          <Box
            sx={{
              px: 1.5,
              py: 0.5,
              borderBottom: "1px solid #e5e7eb",
              bgcolor: "background.paper",
              display: "flex",
              alignItems: "center",
              gap: 2,
            }}
          >
            <Box sx={{ display: "flex", alignItems: "center", gap: 0.75, flex: 1, minWidth: 0 }}>
              <Typography
                variant="caption"
                color="text.secondary"
                sx={{ whiteSpace: "nowrap", fontSize: "0.7rem" }}
              >
                Brightness
              </Typography>
              <Slider size="small" value={brightness} min={50} max={200} onChange={(_, value) => setBrightness(value as number)} />
            </Box>
            <Box sx={{ display: "flex", alignItems: "center", gap: 0.75, flex: 1, minWidth: 0 }}>
              <Typography
                variant="caption"
                color="text.secondary"
                sx={{ whiteSpace: "nowrap", fontSize: "0.7rem" }}
              >
                Contrast
              </Typography>
              <Slider size="small" value={contrast} min={50} max={200} onChange={(_, value) => setContrast(value as number)} />
            </Box>
          </Box>

          {/* imageAndOverlayControls */}
          <Box
            sx={{
              flex: 1,
              minHeight: 0,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              bgcolor: "background.default",
              position: "relative",
            }}
            onDoubleClick={() => setInvertPreview((prev) => !prev)}
          >
            <Box
              sx={{
                position: "absolute",
                top: 8,
                left: "50%",
                transform: "translateX(-50%)",
                display: "flex",
                alignItems: "center",
                gap: 0.25,
                bgcolor: "rgba(248,250,252,0.9)",
                borderRadius: 9999,
                px: 0.75,
                py: 0.25,
                zIndex: 2,
                boxShadow: 1,
              }}
            >
              <Tooltip title="Previous tilt">
                <span>
                  <IconButton size="small" onClick={handlePrev} disabled={!canGoPrev} sx={{ color: "text.primary" }}>
                    <ArrowUpward fontSize="small" />
                  </IconButton>
                </span>
              </Tooltip>
              <Tooltip title="Next tilt">
                <span>
                  <IconButton size="small" onClick={handleNext} disabled={!canGoNext} sx={{ color: "text.primary" }}>
                    <ArrowDownward fontSize="small" />
                  </IconButton>
                </span>
              </Tooltip>
              <Tooltip title="Refresh preview">
                <span>
                  <IconButton
                    size="small"
                    onClick={handleRefreshPreview}
                    disabled={selectedRowIndex == null}
                    sx={{ color: "text.primary" }}
                  >
                    <RefreshIcon fontSize="small" />
                  </IconButton>
                </span>
              </Tooltip>
              <Tooltip title="Toggle exclude current tilt">
                <span>
                  <IconButton
                    size="small"
                    onClick={handleToggleExcludeCurrent}
                    disabled={selectedRowIndex == null || !framesData?.frames?.length}
                    sx={{ color: "text.primary" }}
                  >
                    <CloseIcon fontSize="small" />
                  </IconButton>
                </span>
              </Tooltip>

              <Tooltip title={applyTransform ? "Disable alignments" : "Apply alignments"}>
                <span>
                  <IconButton
                    size="small"
                    onClick={handleToggleApplyTransform}
                    sx={{
                      color: applyTransform ? "primary.main" : "text.primary",
                      bgcolor: applyTransform ? "rgba(59,130,246,0.12)" : "transparent",
                      "&:hover": {
                        bgcolor: applyTransform ? "rgba(59,130,246,0.20)" : "action.hover",
                      },
                    }}
                  >
                    <TransformIcon fontSize="small" />
                  </IconButton>
                </span>
              </Tooltip>

              <Tooltip title="Play (auto navigate)">
                <span>
                  <IconButton
                    size="small"
                    onClick={() => {
                      if (totalFrames > 0) {
                        playDirectionRef.current = 1;
                        setIsPlaying(true);
                      }
                    }}
                    disabled={totalFrames <= 1}
                    sx={{ color: "text.primary" }}
                  >
                    <PlayArrow fontSize="small" />
                  </IconButton>
                </span>
              </Tooltip>
              <Tooltip title="Stop autoplay">
                <span>
                  <IconButton size="small" onClick={() => setIsPlaying(false)} disabled={!isPlaying} sx={{ color: "text.primary" }}>
                    <StopIcon fontSize="small" />
                  </IconButton>
                </span>
              </Tooltip>
            </Box>

            {previewError ? (
              <Typography variant="body2" color="error">
                {previewError}
              </Typography>
            ) : !displayedUrl && !transitionUrl && !previewLoading ? (
              <Typography variant="body2" color="text.secondary" sx={{ fontSize: "0.8rem" }}>
                No preview available.
              </Typography>
            ) : (
              <>
                {previewLoading && !displayedUrl && !transitionUrl && (
                  <Box
                    sx={{
                      position: "absolute",
                      inset: 0,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      zIndex: 3,
                      pointerEvents: "none",
                    }}
                  >
                    <CircularProgress size={22} />
                  </Box>
                )}
                {(displayedUrl || transitionUrl) && (
                  <Box sx={{ position: "relative", width: "100%", height: "100%" }}>
                    {displayedUrl && <Box component="img" src={displayedUrl} alt="Tilt view" sx={imageBaseSx} />}
                    {transitionUrl && (
                      <Box
                        component="img"
                        src={transitionUrl}
                        alt="Tilt view"
                        onAnimationEnd={() => {
                          setDisplayedUrl(transitionUrl);
                          setTransitionUrl(null);
                        }}
                        sx={{
                          ...imageBaseSx,
                          position: "absolute",
                          top: 0,
                          left: 0,
                          animation: "tiltFadeIn 120ms ease-out",
                          "@keyframes tiltFadeIn": {
                            from: { opacity: 0 },
                            to: { opacity: 1 },
                          },
                        }}
                      />
                    )}
                  </Box>
                )}
              </>
            )}
          </Box>

          <Box
            sx={{
              px: 1.5,
              py: 0.75,
              borderTop: "1px solid #e5e7eb",
              bgcolor: "background.paper",
              display: "flex",
              alignItems: "center",
              gap: 1.5,
            }}
          >

            <Slider
              size="small"
              value={sliceSliderValue}
              min={0}
              max={sliceSliderMax}
              step={1}
              disabled={totalFrames <= 1}
              onChange={handleSliceSliderChange}
              onChangeCommitted={handleSliceSliderCommitted}
              valueLabelDisplay="auto"
              valueLabelFormat={(value) => `View ${Number(value) + 1}`}
              sx={{ flex: 1, minWidth: 120, ml: 10 }}
            />

            <Typography
              variant="caption"
              color="text.secondary"
              sx={{ minWidth: 72, textAlign: "right", fontSize: "0.7rem" }}
            >
              {selectedRowIndex != null && totalFrames > 0
                ? `${selectedRowIndex + 1} / ${totalFrames}`
                : "0 / 0"}
            </Typography>
          </Box>

          <Box
            sx={{
              p: 0.75,
              borderTop: "1px solid #e5e7eb",
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              bgcolor: "background.paper",
            }}
          >
            <Typography variant="caption" color="text.secondary" sx={{ fontSize: "0.7rem" }}>
              {tiltAxisAngle != null
                ? `Tilt axis angle: ${tiltAxisAngle.toFixed(2)}`
                : "Tilt axis angle: not available"}
            </Typography>

            {activeSeries?.dims && (
              <Typography variant="caption" color="text.secondary" sx={{ fontSize: "0.7rem" }}>
                Size: {activeSeries.dims[0]} × {activeSeries.dims[1]}
                {typeof activeSeries.dims[2] === "number" && activeSeries.dims[2]
                  ? ` × ${activeSeries.dims[2]}`
                  : ""}
                {activeSeries.pixelSize ? `, ${activeSeries.pixelSize.toFixed(2)} Å/px` : ""}
              </Typography>
            )}
          </Box>
        </Box>
      </Box>

      {/* processingOverlayWhileCreatingNewSet */}
      {saveBusy && !saveDialogOpen && (
        <div
          role="status"
          aria-live="polite"
          className="fixed inset-0 z-[120] pointer-events-auto flex items-center justify-center"
        >
          <div className="rounded-xl border bg-gray-600 dark:bg-gray-900/95 shadow-lg px-4 py-3 flex items-center gap-3 pointer-events-auto">
            <div className="relative">
              <div className="w-5 h-5 rounded-full border-2 border-gray-300" />
              <div className="absolute inset-0 rounded-full border-2 border-transparent border-t-gray-700 animate-spin" />
            </div>
            <div className="flex flex-col">
              <span className="text-xs font-medium text-white dark:text-gray-100">Processing tilt series…</span>
              <span className="text-[11px] text-white dark:text-gray-400">
                Creating new tilt series set. Please wait until the process finishes.
              </span>
            </div>
          </div>
        </div>
      )}

      {/* saveOverlayDialogCustomSimilarStyleToProjectPage */}
      {saveDialogOpen && (
        <div className="fixed inset-0 z-[130] flex items-center justify-center bg-black/40">
          <div className="bg-white dark:bg-gray-950 rounded-xl shadow-lg w-full max-w-lg p-6">
            <h2 className="text-lg font-semibold mb-3 dark:text-white">Create a new set</h2>

            <p className="mb-3 text-sm text-muted-foreground">
              Are you going to create a new set of tiltseries without the excluded views?
            </p>

            <ul className="mb-4 list-disc pl-5 text-sm text-muted-foreground space-y-1">
              <li>
                <span className="font-semibold">Yes</span>: The set will be created without the excluded views.
              </li>
              <li>
                <span className="font-semibold">Re-stack</span>: Delete excluded views and create a new TS stack.
              </li>
            </ul>

            <div className="mt-4 flex flex-col-reverse gap-3 sm:flex-row sm:flex-wrap sm:justify-end">
              <button
                type="button"
                onClick={handleSaveCancel}
                disabled={saveBusy}
                className="px-5 py-2 rounded-md text-sm min-w-[100px] bg-gray-200 hover:bg-gray-300 text-gray-800 disabled:opacity-60 disabled:cursor-not-allowed"
              >
                Cancel
              </button>

              <button
                type="button"
                onClick={handleSaveYes}
                disabled={saveBusy || !series.length}
                className="px-5 py-2 rounded-md text-sm min-w-[100px] border border-gray-300 bg-white hover:bg-gray-50 text-gray-900 disabled:opacity-60 disabled:cursor-not-allowed"
              >
                Yes
              </button>

              <button
                type="button"
                onClick={handleSaveRestack}
                disabled={saveBusy || !series.length}
                className="px-5 py-2 rounded-md text-sm min-w-[100px] bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-60 disabled:cursor-not-allowed"
              >
                Re-stack
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function normalizeFrames(raw: any[]): TiltViewRow[] {
  return (raw || []).map((f: any, idx: number) => {
    const viewId = f.viewId ?? f.id ?? f.index ?? idx;
    const toNumber = (v: any): number | null => {
      const n = Number(v);
      return Number.isFinite(n) ? n : null;
    };

    const indexValue = toNumber(f.index ?? f.viewIndex ?? idx);

    let orderValue: number | null = null;
    if (f.order != null || f.viewIndex != null) {
      orderValue = toNumber(f.order ?? f.viewIndex);
    } else {
      orderValue = indexValue;
    }

    return {
      viewId,
      index: indexValue,
      order: orderValue,
      tiltAngle: toNumber(f.tiltAngle ?? f.tilt_angle ?? f.angle ?? f.alpha),
      excluded:
        typeof f.excluded === "boolean"
          ? f.excluded
          : typeof f.isExcluded === "boolean"
            ? f.isExcluded
            : Boolean(f.skip),
      dose: toNumber(f.dose ?? f.cumulativeDose),
      path: f.path ?? f.fileName ?? f.file ?? f.micrograph ?? f.image ?? null,
      rot: toNumber(f.rot ?? f.rotation),
      shiftX: toNumber(f.shiftX ?? f.shift_x ?? f.sx ?? f.shiftx),
      shiftY: toNumber(f.shiftY ?? f.shift_y ?? f.sy ?? f.shifty),
    } as TiltViewRow;
  });
}
