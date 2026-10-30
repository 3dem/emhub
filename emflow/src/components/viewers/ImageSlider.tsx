import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Box, FormControlLabel, Slider, Switch, Typography } from "@mui/material";
import VolumeViewer from "./VolumeViewer";
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

export default function ImageSlider({
  content,
  fit = false,
}: {
  content: TableViewerImageSliderContent;
  /** Shrink a single-axis slider to its container (right pane, grid cell). */
  fit?: boolean;
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

  const fitSingle = fit && !useVolumeLayout && axisEntries.length === 1;
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
        p: fitSingle ? 1 : 2,
        height: "100%",
        minHeight: 0,
        overflow: useVolumeLayout || fitSingle ? "hidden" : "auto",
        display: "flex",
        flexDirection: "column",
        alignItems: useVolumeLayout || fitSingle ? "stretch" : "flex-start",
        gap: fitSingle ? 1 : 2,
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
          {hasParticles && !useVolumeLayout ? (
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
      ) : hasParticles && !useVolumeLayout ? (
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
          {/* Linked X/Y/Z sections and 3D view, fitted to the pane */}
          <VolumeViewer data={content as any} height="fill" {...content.viewerConfig} />
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
            fillAvailable={fitSingle}
          />
        ))
      )}
    </Box>
  );
}
