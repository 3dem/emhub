import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Box, FormControlLabel, Slider, Switch, Typography } from "@mui/material";
import VolumeAxisSchematic, {
  type VolumeSliceExtents,
  type VolumeSlicePositions,
} from "./volume-axis-schematic";
import type {
  TableViewerImageSliderAxis,
  TableViewerImageSliderContent,
} from "@/services/ProjectService";

type ImageSliderAxisContent = TableViewerImageSliderAxis;

type VolumeCoordinates = NonNullable<TableViewerImageSliderContent["coordinates"]>;

function sortedSliceKeys(slices: Record<string, string>): string[] {
  return Object.keys(slices).sort((left, right) => Number(left) - Number(right));
}

function sliceLabelForKey(key: string, offset = 0): string {
  const index = Number(key);
  if (!Number.isFinite(index)) return key;
  return String(index + offset);
}

function defaultSliderIndex(keys: string[], initialSlice?: string | number): number {
  if (!keys.length) return 0;
  if (initialSlice != null) {
    const idx = keys.indexOf(String(initialSlice));
    if (idx >= 0) return idx;
  }
  return Math.floor(keys.length / 2);
}

function initialSlicePosition(
  slices: Record<string, string> | undefined,
  initialSlice?: string | number,
): number {
  if (!slices) return 0;
  const keys = sortedSliceKeys(slices);
  return Number(keys[defaultSliderIndex(keys, initialSlice)] ?? 0);
}

function sliceExtentsForAxis(
  slices: Record<string, string> | undefined,
): [number, number] {
  const keys = sortedSliceKeys(slices ?? {});
  if (!keys.length) return [0, 0];
  return [Number(keys[0]), Number(keys[keys.length - 1])];
}

function toDataUrl(base64: string): string {
  if (base64.startsWith("data:")) return base64;
  return `data:image/png;base64,${base64}`;
}

function pointsForSlice(
  coordinates: VolumeCoordinates,
  sliceIndex: number,
  axis: "x" | "y" | "z",
  tolerance = 10,
): Array<[number, number]> {
  const points: Array<[number, number]> = [];
  for (let i = 0; i < coordinates.x.length; i += 1) {
    const axisValue =
      axis === "z" ? coordinates.z[i] : axis === "y" ? coordinates.y[i] : coordinates.x[i];
    if (Math.abs(axisValue - sliceIndex) > tolerance) continue;
    if (axis === "z") {
      points.push([coordinates.x[i], coordinates.y[i]]);
    } else if (axis === "y") {
      points.push([coordinates.x[i], coordinates.z[i]]);
    } else {
      points.push([coordinates.y[i], coordinates.z[i]]);
    }
  }
  return points;
}

function sliceDisplaySize(
  axis: "x" | "y" | "z",
  dimensions: [number, number, number],
  pixelScale: number,
): { width: number; height: number } {
  const [dimX, dimY, dimZ] = dimensions;
  if (axis === "z") {
    return { width: dimX * pixelScale, height: dimY * pixelScale };
  }
  if (axis === "y") {
    return { width: dimX * pixelScale, height: dimZ * pixelScale };
  }
  return { width: dimY * pixelScale, height: dimZ * pixelScale };
}

function computeVolumePixelScale(
  dimensions: [number, number, number],
  topRect: DOMRect | null,
  bottomLeftRect: DOMRect | null,
  bottomRightRect: DOMRect | null,
): number {
  const [dimX, dimY, dimZ] = dimensions;
  const candidates: number[] = [];

  const add = (available: number, voxels: number) => {
    if (available > 0 && voxels > 0) candidates.push(available / voxels);
  };

  if (bottomLeftRect) {
    add(bottomLeftRect.width - 8, dimX);
    add(bottomLeftRect.height - 52, dimY);
  }
  if (bottomRightRect) {
    add(bottomRightRect.width - 8, dimY);
    add(bottomRightRect.height - 52, dimZ);
  }
  if (topRect) {
    add(topRect.width - 4, dimX);
    add(topRect.height - 40, dimZ);
  }

  if (!candidates.length) return 1;
  return Math.max(0.25, Math.min(...candidates));
}

function SliceImage({
  imageBase64,
  alt,
  coordinates,
  sliceIndex,
  volumeAxis,
  volumeDimensions,
  showParticles = true,
  constrainToContainer = false,
  maxImageHeight,
  displaySize,
}: {
  imageBase64: string;
  alt: string;
  coordinates?: VolumeCoordinates;
  sliceIndex: number;
  volumeAxis?: "x" | "y" | "z";
  volumeDimensions?: [number, number, number];
  showParticles?: boolean;
  constrainToContainer?: boolean;
  maxImageHeight?: number;
  displaySize?: { width: number; height: number };
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const canOverlayParticles =
    showParticles &&
    coordinates != null &&
    volumeAxis != null &&
    volumeDimensions != null &&
    coordinates.x.length > 0;

  useEffect(() => {
    if (!canOverlayParticles) return;

    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const image = new Image();
    image.onload = () => {
      canvas.width = image.width;
      canvas.height = image.height;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(image, 0, 0, canvas.width, canvas.height);

      const [dimX, dimY] =
        volumeAxis === "z"
          ? [volumeDimensions[0], volumeDimensions[1]]
          : volumeAxis === "y"
            ? [volumeDimensions[0], volumeDimensions[2]]
            : [volumeDimensions[1], volumeDimensions[2]];

      const scaleX = canvas.width / dimX;
      const scaleY = canvas.height / dimY;
      const points = pointsForSlice(coordinates, sliceIndex, volumeAxis);

      for (const [x, y] of points) {
        const px = x * scaleX;
        const py = y * scaleY;
        ctx.beginPath();
        ctx.arc(px, py, 2, 0, Math.PI * 2);
        ctx.fillStyle = "rgba(0, 255, 0, 0.7)";
        ctx.fill();
        ctx.beginPath();
        ctx.arc(px, py, 2, 0, Math.PI * 2);
        ctx.strokeStyle = "rgba(0, 255, 0, 0.9)";
        ctx.lineWidth = 0.5;
        ctx.stroke();
      }
    };
    image.src = toDataUrl(imageBase64);
  }, [
    canOverlayParticles,
    imageBase64,
    sliceIndex,
    coordinates,
    volumeAxis,
    volumeDimensions,
  ]);

  const fitSx = displaySize
    ? {
        display: "block",
        width: Math.round(displaySize.width),
        height: Math.round(displaySize.height),
        maxWidth: "100%",
        maxHeight: "100%",
        objectFit: "contain" as const,
      }
    : constrainToContainer
    ? {
        display: "block",
        maxWidth: "100%",
        maxHeight: "100%",
        width: "auto",
        height: "auto",
        objectFit: "contain" as const,
      }
    : {
        display: "block",
        maxWidth: "100%",
        width: maxImageHeight ? "100%" : "auto",
        maxHeight: maxImageHeight ?? "none",
        height: "auto",
        objectFit: maxImageHeight ? ("contain" as const) : undefined,
      };

  if (!canOverlayParticles) {
    return (
      <Box
        component="img"
        src={toDataUrl(imageBase64)}
        alt={alt}
        sx={fitSx}
      />
    );
  }

  return (
    <Box
      component="canvas"
      ref={canvasRef}
      role="img"
      aria-label={alt}
      sx={fitSx}
    />
  );
}

function ImageSliderPanel({
  label,
  slices,
  sliderPrefix = "Slice: ",
  initialSlice,
  sliderOnTop = false,
  coordinates,
  volumeAxis,
  volumeDimensions,
  showParticles = true,
  axisId,
  onSlicePositionChange,
  fillAvailable = false,
  compactTop = false,
  maxImageHeight,
  displaySize,
  sliceLabelOffset = 0,
}: {
  label?: string;
  slices: Record<string, string>;
  sliderPrefix?: string;
  sliceLabelOffset?: number;
  initialSlice?: string | number;
  sliderOnTop?: boolean;
  coordinates?: VolumeCoordinates;
  volumeAxis?: "x" | "y" | "z";
  volumeDimensions?: [number, number, number];
  showParticles?: boolean;
  axisId?: "x" | "y" | "z";
  onSlicePositionChange?: (axis: "x" | "y" | "z", sliceIndex: number) => void;
  fillAvailable?: boolean;
  compactTop?: boolean;
  maxImageHeight?: number;
  displaySize?: { width: number; height: number };
}) {
  const keys = useMemo(() => sortedSliceKeys(slices), [slices]);
  const defaultIndex = useMemo(
    () => defaultSliderIndex(keys, initialSlice),
    [keys, initialSlice],
  );

  const [index, setIndex] = useState(defaultIndex);

  useEffect(() => {
    setIndex(defaultIndex);
  }, [defaultIndex, keys.join("|")]);

  if (!keys.length) {
    return (
      <Typography variant="body2" color="text.secondary" sx={{ p: 2 }}>
        No slices available.
      </Typography>
    );
  }

  const activeKey = keys[Math.min(Math.max(index, 0), keys.length - 1)];
  const sliceIndex = Number(activeKey);
  const sliceLabel = sliceLabelForKey(activeKey, sliceLabelOffset);
  const imageBase64 = slices[activeKey];
  const imageWidth = displaySize ? Math.round(displaySize.width) : undefined;

  const slider = (
    <Slider
      size="small"
      min={0}
      max={Math.max(keys.length - 1, 0)}
      step={1}
      value={index}
      onChange={(_, value) => {
        const nextIndex = Array.isArray(value) ? value[0] : value;
        setIndex(nextIndex);
        if (axisId && onSlicePositionChange) {
          const nextKey = keys[Math.min(Math.max(nextIndex, 0), keys.length - 1)];
          onSlicePositionChange(axisId, Number(nextKey));
        }
      }}
      sx={{
        width: imageWidth ?? "100%",
        maxWidth: "100%",
        display: "block",
        px: compactTop || imageWidth ? 0 : 0.5,
      }}
    />
  );

  const compactMaxHeight = maxImageHeight ?? (compactTop ? 88 : undefined);

  return (
    <Box
      sx={{
        display: "flex",
        flexDirection: "column",
        alignItems: "stretch",
        maxWidth: "100%",
        width: imageWidth ?? (fillAvailable || compactTop ? "100%" : "fit-content"),
        alignSelf: imageWidth && fillAvailable ? "center" : undefined,
        flex: fillAvailable ? 1 : undefined,
        minHeight: fillAvailable ? 0 : undefined,
        gap: compactTop ? 0.25 : 0.75,
      }}
    >
      {label ? (
        <Typography variant="caption" color="text.secondary" sx={{ flexShrink: 0 }}>
          {label}
        </Typography>
      ) : null}
      {sliderOnTop ? slider : null}
      <Box
        sx={
          fillAvailable || displaySize
            ? {
                flex: fillAvailable ? 1 : undefined,
                minHeight: fillAvailable ? 0 : undefined,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                overflow: "hidden",
              }
            : undefined
        }
      >
        <SliceImage
          imageBase64={imageBase64}
          alt={`${sliderPrefix}${sliceLabel}`}
          coordinates={coordinates}
          sliceIndex={sliceIndex}
          volumeAxis={volumeAxis}
          volumeDimensions={volumeDimensions}
          showParticles={showParticles}
          constrainToContainer={fillAvailable && !displaySize}
          maxImageHeight={displaySize ? undefined : compactMaxHeight}
          displaySize={displaySize}
        />
      </Box>
      {!sliderOnTop ? slider : null}
      {!compactTop ? (
        <Typography variant="caption" color="text.secondary" align="right" sx={{ flexShrink: 0 }}>
          {sliderPrefix}
          {sliceLabel}
        </Typography>
      ) : null}
    </Box>
  );
}

function axisContentMap(
  axisEntries: ReadonlyArray<readonly [string, ImageSliderAxisContent]>,
): Record<string, ImageSliderAxisContent> {
  return Object.fromEntries(axisEntries);
}

const volumeTopQuadrantSx = {
  minWidth: 0,
  display: "flex",
  alignItems: "flex-start",
  justifyContent: "center",
  overflow: "hidden",
  p: 0.5,
} as const;

const volumeBottomQuadrantSx = {
  minWidth: 0,
  minHeight: 0,
  display: "flex",
  flexDirection: "column",
  alignItems: "stretch",
  justifyContent: "stretch",
  overflow: "hidden",
  p: 1,
} as const;

function SchematicQuadrant({
  sliceExtents,
  slices,
  activeAxis,
  maxHeight,
}: {
  sliceExtents: VolumeSliceExtents;
  slices: VolumeSlicePositions;
  activeAxis: "x" | "y" | "z";
  maxHeight?: number;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 160, height: 72 });

  useEffect(() => {
    const element = containerRef.current;
    if (!element) return undefined;

    const updateSize = () => {
      const rect = element.getBoundingClientRect();
      setSize({
        width: Math.max(Math.floor(rect.width), 80),
        height: Math.max(Math.floor(rect.height), 40),
      });
    };

    updateSize();
    const observer = new ResizeObserver(updateSize);
    observer.observe(element);
    return () => observer.disconnect();
  }, [maxHeight]);

  return (
    <Box
      ref={containerRef}
      sx={{
        width: "100%",
        height: maxHeight && maxHeight > 0 ? maxHeight : "100%",
        maxHeight: maxHeight && maxHeight > 0 ? maxHeight : "100%",
        minHeight: 0,
        display: "flex",
        alignItems: "stretch",
        justifyContent: "stretch",
      }}
    >
      <VolumeAxisSchematic
        sliceExtents={sliceExtents}
        slices={slices}
        activeAxis={activeAxis}
        width={size.width}
        height={size.height}
      />
    </Box>
  );
}

function VolumeSliderLayout({
  axisEntries,
  initialSlice,
  coordinates,
  volumeDimensions,
  showParticles,
}: {
  axisEntries: ReadonlyArray<readonly [string, ImageSliderAxisContent]>;
  initialSlice?: string | number;
  coordinates?: VolumeCoordinates;
  volumeDimensions?: [number, number, number];
  showParticles: boolean;
}) {
  const byAxis = axisContentMap(axisEntries);

  const sliceExtents = useMemo<VolumeSliceExtents>(
    () => ({
      x: sliceExtentsForAxis(byAxis.x?.slices),
      y: sliceExtentsForAxis(byAxis.y?.slices),
      z: sliceExtentsForAxis(byAxis.z?.slices),
    }),
    [axisEntries],
  );

  const [slicePositions, setSlicePositions] = useState<VolumeSlicePositions>(() => ({
    x: initialSlicePosition(byAxis.x?.slices, initialSlice),
    y: initialSlicePosition(byAxis.y?.slices, initialSlice),
    z: initialSlicePosition(byAxis.z?.slices, initialSlice),
  }));
  const [activeAxis, setActiveAxis] = useState<"x" | "y" | "z">("z");
  const topLeftRef = useRef<HTMLDivElement>(null);
  const bottomLeftRef = useRef<HTMLDivElement>(null);
  const bottomRightRef = useRef<HTMLDivElement>(null);
  const [topRowHeight, setTopRowHeight] = useState(0);
  const [pixelScale, setPixelScale] = useState(1);

  const handleSlicePositionChange = useCallback((axis: "x" | "y" | "z", sliceIndex: number) => {
    setSlicePositions((current) => ({ ...current, [axis]: sliceIndex }));
    setActiveAxis(axis);
  }, []);

  useEffect(() => {
    setSlicePositions({
      x: initialSlicePosition(byAxis.x?.slices, initialSlice),
      y: initialSlicePosition(byAxis.y?.slices, initialSlice),
      z: initialSlicePosition(byAxis.z?.slices, initialSlice),
    });
    setActiveAxis("z");
  }, [axisEntries, initialSlice]);

  useEffect(() => {
    const element = topLeftRef.current;
    if (!element) return undefined;

    const updateHeight = () => {
      setTopRowHeight(element.getBoundingClientRect().height);
    };

    updateHeight();
    const observer = new ResizeObserver(updateHeight);
    observer.observe(element);
    return () => observer.disconnect();
  }, [byAxis.y?.slices]);

  useEffect(() => {
    if (!volumeDimensions) return undefined;

    const measureScale = () => {
      setPixelScale(
        computeVolumePixelScale(
          volumeDimensions,
          topLeftRef.current?.getBoundingClientRect() ?? null,
          bottomLeftRef.current?.getBoundingClientRect() ?? null,
          bottomRightRef.current?.getBoundingClientRect() ?? null,
        ),
      );
    };

    measureScale();
    const observers: ResizeObserver[] = [];
    for (const element of [topLeftRef.current, bottomLeftRef.current, bottomRightRef.current]) {
      if (!element) continue;
      const observer = new ResizeObserver(measureScale);
      observer.observe(element);
      observers.push(observer);
    }
    return () => observers.forEach((observer) => observer.disconnect());
  }, [volumeDimensions, axisEntries, topRowHeight]);

  const yDisplaySize =
    volumeDimensions && byAxis.y
      ? sliceDisplaySize("y", volumeDimensions, pixelScale)
      : undefined;
  const zDisplaySize =
    volumeDimensions && byAxis.z
      ? sliceDisplaySize("z", volumeDimensions, pixelScale)
      : undefined;
  const xDisplaySize =
    volumeDimensions && byAxis.x
      ? sliceDisplaySize("x", volumeDimensions, pixelScale)
      : undefined;

  const gridTemplateRows = useMemo(() => {
    if (!volumeDimensions) return "max-content 1fr";
    const [, dimY, dimZ] = volumeDimensions;
    const ySliceHeight = dimZ;
    const zSliceHeight = dimY;
    if (ySliceHeight <= 0 || zSliceHeight <= 0) return "max-content 1fr";
    // Top row = Y slices (height dimZ); bottom row = Z slices (height dimY).
    return `${ySliceHeight}fr ${zSliceHeight}fr`;
  }, [volumeDimensions]);

  return (
    <Box
      sx={{
        display: "grid",
        gridTemplateColumns: "1fr 1fr",
        gridTemplateRows,
        gap: 1,
        width: "100%",
        height: "100%",
        minHeight: 0,
        overflow: "hidden",
        alignSelf: "stretch",
      }}
    >
      <Box ref={topLeftRef} sx={{ ...volumeTopQuadrantSx, gridColumn: 1, gridRow: 1, p: 0 }}>
        {byAxis.y ? (
          <ImageSliderPanel
            label="Y axis"
            slices={byAxis.y.slices}
            sliderPrefix={byAxis.y.sliderPrefix}
            initialSlice={initialSlice}
            sliderOnTop
            axisId="y"
            onSlicePositionChange={handleSlicePositionChange}
            compactTop
            displaySize={yDisplaySize}
          />
        ) : null}
      </Box>

      <Box
        sx={{
          ...volumeTopQuadrantSx,
          gridColumn: 2,
          gridRow: 1,
          p: 0.25,
          alignItems: "stretch",
          justifyContent: "stretch",
          alignSelf: "start",
          height: topRowHeight > 0 ? topRowHeight : undefined,
          maxHeight: topRowHeight > 0 ? topRowHeight : undefined,
          overflow: "hidden",
        }}
      >
        <SchematicQuadrant
          sliceExtents={sliceExtents}
          slices={slicePositions}
          activeAxis={activeAxis}
          maxHeight={topRowHeight}
        />
      </Box>

      <Box ref={bottomLeftRef} sx={{ ...volumeBottomQuadrantSx, gridColumn: 1, gridRow: 2 }}>
        {byAxis.z ? (
          <ImageSliderPanel
            label="Z axis"
            slices={byAxis.z.slices}
            sliderPrefix={byAxis.z.sliderPrefix}
            initialSlice={initialSlice}
            coordinates={coordinates}
            volumeAxis="z"
            volumeDimensions={volumeDimensions}
            showParticles={showParticles}
            axisId="z"
            onSlicePositionChange={handleSlicePositionChange}
            fillAvailable
            displaySize={zDisplaySize}
          />
        ) : null}
      </Box>

      <Box ref={bottomRightRef} sx={{ ...volumeBottomQuadrantSx, gridColumn: 2, gridRow: 2 }}>
        {byAxis.x ? (
          <ImageSliderPanel
            label="X axis"
            slices={byAxis.x.slices}
            sliderPrefix={byAxis.x.sliderPrefix}
            initialSlice={initialSlice}
            axisId="x"
            onSlicePositionChange={handleSlicePositionChange}
            fillAvailable
            displaySize={xDisplaySize}
          />
        ) : null}
      </Box>
    </Box>
  );
}

export default function TableViewerImageSlider({
  content,
}: {
  content: TableViewerImageSliderContent;
}) {
  const axisEntries = useMemo(() => {
    if (content.axes && Object.keys(content.axes).length > 0) {
      return Object.entries(content.axes).filter(([, axis]) =>
        Object.keys(axis.slices ?? {}).length > 0,
      );
    }
    if (content.slices && Object.keys(content.slices).length > 0) {
      return [["z", { slices: content.slices, sliderPrefix: content.sliderPrefix }]] as const;
    }
    return [];
  }, [content.axes, content.slices, content.sliderPrefix]);

  const useVolumeLayout =
    content.layout === "volume" ||
    (axisEntries.length >= 3 &&
      axisEntries.some(([axis]) => axis === "x") &&
      axisEntries.some(([axis]) => axis === "y") &&
      axisEntries.some(([axis]) => axis === "z"));

  const hasParticles = (content.coordinates?.x.length ?? 0) > 0;
  const [showParticles, setShowParticles] = useState(true);

  useEffect(() => {
    setShowParticles(true);
  }, [content.coordinates?.x.length, content.title]);

  if (!axisEntries.length) {
    return (
      <Box sx={{ p: 3 }}>
        <Typography variant="body2" color="text.secondary">
          No image slices to display.
        </Typography>
      </Box>
    );
  }

  return (
    <Box
      sx={{
        p: 2,
        height: "100%",
        minHeight: 0,
        overflow: useVolumeLayout ? "hidden" : "auto",
        display: "flex",
        flexDirection: "column",
        alignItems: useVolumeLayout ? "stretch" : "flex-start",
        gap: 2,
      }}
    >
      {content.dimensions ? (
        <Box
          sx={{
            display: "flex",
            flexWrap: "wrap",
            alignItems: "center",
            gap: 1.5,
            flexShrink: 0,
          }}
        >
          <Typography variant="caption" color="text.secondary">
            Volume dimensions (X × Y × Z): {content.dimensions.join(" × ")}
            {hasParticles ? ` · ${content.coordinates!.x.length} particles` : ""}
          </Typography>
          {hasParticles ? (
            <FormControlLabel
              control={
                <Switch
                  size="small"
                  checked={showParticles}
                  onChange={(_, checked) => setShowParticles(checked)}
                />
              }
              label={
                <Typography variant="caption" color="text.secondary">
                  Show particles
                </Typography>
              }
              sx={{ m: 0 }}
            />
          ) : null}
        </Box>
      ) : hasParticles ? (
        <FormControlLabel
          control={
            <Switch
              size="small"
              checked={showParticles}
              onChange={(_, checked) => setShowParticles(checked)}
            />
          }
          label={
            <Typography variant="caption" color="text.secondary">
              Show particles
            </Typography>
          }
          sx={{ m: 0 }}
        />
      ) : null}
      {useVolumeLayout ? (
        <Box
          sx={{
            flex: 1,
            minHeight: 0,
            width: "100%",
            alignSelf: "stretch",
            display: "flex",
            flexDirection: "column",
          }}
        >
          <VolumeSliderLayout
            axisEntries={axisEntries}
            initialSlice={content.initialSlice}
            coordinates={content.coordinates}
            volumeDimensions={content.dimensions}
            showParticles={showParticles}
          />
        </Box>
      ) : (
        axisEntries.map(([axis, axisContent]) => (
          <ImageSliderPanel
            key={axis}
            label={axisEntries.length > 1 ? `${axis.toUpperCase()} axis` : undefined}
            slices={axisContent.slices}
            sliderPrefix={axisContent.sliderPrefix}
            sliceLabelOffset={content.sliceLabelOffset ?? 0}
            initialSlice={content.initialSlice}
          />
        ))
      )}
    </Box>
  );
}
