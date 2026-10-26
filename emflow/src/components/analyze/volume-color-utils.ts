export type VolumeColorMode = "solid" | "density" | "components";

export type VolumeRenderData = {
  dims: { x: number; y: number; z: number };
  values: number[] | Float32Array;
  order: "zyx" | "xyz";
  min?: number;
  max?: number;
};

export type VolumeRegionLabels = {
  dims: { x: number; y: number; z: number };
  labels: Uint8Array;
  regionCount: number;
};

const COLORMAP_STOPS: Record<string, number[]> = {
  gray: [0x111111, 0xf3f4f6],
  grey: [0x111111, 0xf3f4f6],
  viridis: [0x440154, 0x31688e, 0x35b779, 0xfde725],
  magma: [0x000004, 0x721f81, 0xf1605d, 0xfcfdbf],
  plasma: [0x0d0887, 0x9c179e, 0xed7953, 0xf0f921],
  inferno: [0x000004, 0x57106e, 0xbc3754, 0xfcffa4],
  cividis: [0x00224e, 0x575d6d, 0xa59c74, 0xfee838],
  turbo: [0x30123b, 0x28bbec, 0xa4fc3c, 0xf9a31b, 0x7a0403],
};

function hexRgb(hex: number): [number, number, number] {
  return [
    ((hex >> 16) & 255) / 255,
    ((hex >> 8) & 255) / 255,
    (hex & 255) / 255,
  ];
}

export function sampleColormapRgb(
  name: string,
  value: number,
): [number, number, number] {
  const stops =
    COLORMAP_STOPS[String(name || "").toLowerCase()] ??
    COLORMAP_STOPS.viridis;

  const t = Math.max(0, Math.min(1, value));
  const position = t * (stops.length - 1);
  const lower = Math.floor(position);
  const upper = Math.min(stops.length - 1, lower + 1);
  const mix = position - lower;

  const a = hexRgb(stops[lower]);
  const b = hexRgb(stops[upper]);

  return [
    a[0] + (b[0] - a[0]) * mix,
    a[1] + (b[1] - a[1]) * mix,
    a[2] + (b[2] - a[2]) * mix,
  ];
}

function hueToRgb(p: number, q: number, t: number) {
  if (t < 0) t += 1;
  if (t > 1) t -= 1;
  if (t < 1 / 6) return p + (q - p) * 6 * t;
  if (t < 1 / 2) return q;
  if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
  return p;
}

export function regionColorRgb(index: number): [number, number, number] {
  const h = (index * 0.61803398875 + 0.03) % 1;
  const s = 0.78;
  const l = 0.56;

  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;

  return [
    hueToRgb(p, q, h + 1 / 3),
    hueToRgb(p, q, h),
    hueToRgb(p, q, h - 1 / 3),
  ];
}

function dataValue(
  data: VolumeRenderData,
  x: number,
  y: number,
  z: number,
) {
  const { dims } = data;

  if (data.order === "xyz") {
    return data.values[(x * dims.y + y) * dims.z + z] ?? 0;
  }

  return data.values[(z * dims.y + y) * dims.x + x] ?? 0;
}

function labelValue(
  regions: VolumeRegionLabels,
  x: number,
  y: number,
  z: number,
) {
  const { dims } = regions;
  return regions.labels[(z * dims.y + y) * dims.x + x] ?? 0;
}

function mappedSliceIndex(
  index: number,
  sourceSize: number,
  targetSize: number,
) {
  if (targetSize <= 1 || sourceSize <= 1) return 0;

  const clamped = Math.max(0, Math.min(sourceSize - 1, index));

  return Math.round(
    clamped * (targetSize - 1) / (sourceSize - 1),
  );
}

export function buildVolumeSliceOverlayDataUrl({
  data,
  regions,
  axis,
  sourceIndex,
  sourceDims,
  colorMode,
  level,
  opacity,
  colormap,
}: {
  data: VolumeRenderData;
  regions?: VolumeRegionLabels | null;
  axis: "x" | "y" | "z";
  sourceIndex: number;
  sourceDims: { x: number; y: number; z: number };
  colorMode: VolumeColorMode;
  level: number;
  opacity: number;
  colormap: string;
}): string | null {
  const { dims } = data;

  if (!data.values.length || !dims.x || !dims.y || !dims.z) {
    return null;
  }

  if (colorMode === "components" && !regions) {
    return null;
  }

  const slice = mappedSliceIndex(
    sourceIndex,
    sourceDims[axis],
    dims[axis],
  );

  const width =
    axis === "x" ? dims.y : dims.x;

  const height =
    axis === "z" ? dims.y : dims.z;

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;

  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  const image = ctx.createImageData(width, height);
  const rgba = image.data;

  const dataMax = Number.isFinite(data.max)
    ? Number(data.max)
    : Math.max(...data.values);

  const solidColor = sampleColormapRgb(colormap, 0.72);
  const alphaBase = Math.max(0, Math.min(1, opacity));

  for (let py = 0; py < height; py++) {
    for (let px = 0; px < width; px++) {
      let x: number;
      let y: number;
      let z: number;

      if (axis === "z") {
        x = px;
        y = py;
        z = slice;
      } else if (axis === "y") {
        x = px;
        y = slice;
        z = py;
      } else {
        x = slice;
        y = px;
        z = py;
      }

      const offset = (py * width + px) * 4;

      if (colorMode === "components") {
        const regionId = regions
          ? labelValue(regions, x, y, z)
          : 0;

        if (!regionId) continue;

        const color = regionColorRgb(regionId - 1);

        rgba[offset] = Math.round(color[0] * 255);
        rgba[offset + 1] = Math.round(color[1] * 255);
        rgba[offset + 2] = Math.round(color[2] * 255);
        rgba[offset + 3] = Math.round(alphaBase * 255);

        continue;
      }

      const value = dataValue(data, x, y, z);
      if (!Number.isFinite(value) || value < level) continue;

      const normalized =
        dataMax > level
          ? Math.max(0, Math.min(1, (value - level) / (dataMax - level)))
          : 1;

      const color =
        colorMode === "density"
          ? sampleColormapRgb(colormap, normalized)
          : solidColor;

      const alpha =
        colorMode === "density"
          ? alphaBase * (0.2 + 0.8 * normalized)
          : alphaBase;

      rgba[offset] = Math.round(color[0] * 255);
      rgba[offset + 1] = Math.round(color[1] * 255);
      rgba[offset + 2] = Math.round(color[2] * 255);
      rgba[offset + 3] = Math.round(alpha * 255);
    }
  }

  ctx.putImageData(image, 0, 0);
  return canvas.toDataURL("image/png");
}