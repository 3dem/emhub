// src/components/viewers/volume/densityGrid.ts
//
// The scaled uint8 grid of a VolumeDensity, decoded once (prepareDensity:
// base64, zlib when compressed) and shared by the "3D volume" tab (its 3D
// texture) and, when the host sends no slice images (e.g. maps such as 3D
// classes), the Slices tab, which draws its sections from the same grid.
// Also the colored sections of a mask map, and the display filters of the
// surface: smoothing and hiding the small blobs of noise ("dust") at a
// threshold.
import type { Axis, VolumeDensity } from "./volumeMath";

const decoded = new WeakMap<VolumeDensity, Uint8Array>();
const decoding = new WeakMap<VolumeDensity, Promise<number>>();

function base64Bytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const v = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) v[i] = bin.charCodeAt(i);
  return v;
}

/**
 * Decodes the grid of `d` once (zlib with the browser's DecompressionStream);
 * resolves with the milliseconds it took (0 if it was already decoded).
 */
export function prepareDensity(d: VolumeDensity): Promise<number> {
  if (decoded.has(d)) return Promise.resolve(0);
  let p = decoding.get(d);
  if (!p) {
    const t0 = performance.now();
    p = (async () => {
      let v = base64Bytes(d.data);
      if (d.encoding === "zlib") {
        const stream = new Blob([v]).stream().pipeThrough(new DecompressionStream("deflate"));
        v = new Uint8Array(await new Response(stream).arrayBuffer());
      }
      decoded.set(d, v);
      return performance.now() - t0;
    })();
    decoding.set(d, p);
  }
  return p;
}

/** The grid values (z, y, x), x fastest (after prepareDensity when compressed). */
export function densityValues(d: VolumeDensity): Uint8Array {
  let v = decoded.get(d);
  if (!v) {
    if (d.encoding) throw new Error("The density is not decoded yet (prepareDensity)");
    v = base64Bytes(d.data);
    decoded.set(d, v);
  }
  return v;
}

/** Slice numbers (full-volume voxels) of each axis: one per grid voxel. */
export function densitySliceKeys(d: VolumeDensity, dims: [number, number, number]): Record<Axis, number[]> {
  const [nz, ny, nx] = d.shape;
  const f = d.binning || 1;
  const keys = (n: number, dim: number) => {
    const k = Array.from({ length: n }, (_, i) => Math.min(dim - 1, Math.floor((i + 0.5) * f)));
    return [...new Set(k)];
  };
  return { x: keys(nx, dims[0]), y: keys(ny, dims[1]), z: keys(nz, dims[2]) };
}

/**
 * The section through full-volume voxel `key` of axis `a`, as an image laid
 * out like the host's slices (VolumeViewer's HV axes: Z is x by y, Y is x by
 * z, X is z by y).
 */
export function densitySlice(d: VolumeDensity, a: Axis, key: number): HTMLCanvasElement {
  return paintSlice(d, a, key, (px, o, value) => {
    px[o] = px[o + 1] = px[o + 2] = value;
    px[o + 3] = 255;
  });
}

/**
 * The section of a mask map through voxel `key` of axis `a` (laid out as
 * densitySlice): the voxels above `level` (0-255 of the grid) in `color`
 * (CSS hex), the rest transparent. The opacity is set when it is drawn.
 */
export function maskSlice(d: VolumeDensity, a: Axis, key: number, level: number, color: string): HTMLCanvasElement {
  const rgb = [1, 3, 5].map((i) => parseInt(color.slice(i, i + 2), 16) || 0);
  return paintSlice(d, a, key, (px, o, value) => {
    if (value <= level) return;
    [px[o], px[o + 1], px[o + 2]] = rgb;
    px[o + 3] = 255;
  });
}

/** Canvas of a section of the grid, each pixel set by `paint` from its value. */
function paintSlice(
  d: VolumeDensity,
  a: Axis,
  key: number,
  paint: (px: Uint8ClampedArray, offset: number, value: number) => void,
): HTMLCanvasElement {
  const [nz, ny, nx] = d.shape;
  const f = d.binning || 1;
  const v = densityValues(d);
  const n = { x: nx, y: ny, z: nz }[a];
  const i = Math.max(0, Math.min(n - 1, Math.floor(key / f)));
  const [w, h] = a === "z" ? [nx, ny] : a === "y" ? [nx, nz] : [nz, ny];
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const g = canvas.getContext("2d")!;
  const img = g.createImageData(w, h);
  const px = img.data;
  for (let r = 0; r < h; r++) {
    for (let c = 0; c < w; c++) {
      let idx: number;
      if (a === "z") idx = (i * ny + r) * nx + c;
      else if (a === "y") idx = (r * ny + i) * nx + c;
      else idx = (c * ny + r) * nx + i;
      paint(px, 4 * (r * w + c), v[idx]);
    }
  }
  g.putImageData(img, 0, 0);
  return canvas;
}

/** One pass of a [1 2 1] / 4 filter along each axis (display smoothing). */
export function smoothGrid(v: Uint8Array, shape: [number, number, number]): Uint8Array {
  const [nz, ny, nx] = shape;
  let src = Float32Array.from(v);
  let dst = new Float32Array(src.length);
  const strides = [1, nx, nx * ny];
  const sizes = [nx, ny, nz];
  for (let ax = 0; ax < 3; ax++) {
    const s = strides[ax], n = sizes[ax];
    for (let i = 0; i < src.length; i++) {
      const c = Math.floor(i / s) % n;
      const a = c > 0 ? src[i - s] : src[i];
      const b = c < n - 1 ? src[i + s] : src[i];
      dst[i] = 0.25 * a + 0.5 * src[i] + 0.25 * b;
    }
    [src, dst] = [dst, src];
  }
  const out = new Uint8Array(v.length);
  for (let i = 0; i < out.length; i++) out[i] = Math.round(src[i]);
  return out;
}

/**
 * Hides the dust: the blobs (6-connected voxels inside the surface at
 * `level`, 0-255 of the grid) of fewer than `minVoxels` voxels are set out of
 * the surface. Returns the new grid (or `v` when nothing is hidden) and the
 * number of blobs hidden.
 */
export function removeDust(
  v: Uint8Array,
  shape: [number, number, number],
  level: number,
  below: boolean,
  minVoxels: number,
): { values: Uint8Array; hidden: number } {
  const [nz, ny, nx] = shape;
  const N = v.length;
  const inside = (i: number) => (below ? v[i] < level : v[i] > level);
  const label = new Int32Array(N);
  const stack = new Int32Array(N);
  const blob: number[] = [];
  let out: Uint8Array | null = null;
  let hidden = 0;
  const outsideValue = below ? 255 : 0;
  const plane = nx * ny;
  let next = 1;
  for (let s = 0; s < N; s++) {
    if (label[s] || !inside(s)) continue;
    // Flood fill one blob, keeping its voxels while it is still small
    let top = 0, size = 0;
    blob.length = 0;
    stack[top++] = s;
    label[s] = next;
    while (top) {
      const i = stack[--top];
      size++;
      if (size < minVoxels) blob.push(i);
      const x = i % nx, y = ((i / nx) | 0) % ny, z = (i / plane) | 0;
      for (let k = 0; k < 6; k++) {
        let j: number;
        if (k === 0) { if (x === 0) continue; j = i - 1; }
        else if (k === 1) { if (x === nx - 1) continue; j = i + 1; }
        else if (k === 2) { if (y === 0) continue; j = i - nx; }
        else if (k === 3) { if (y === ny - 1) continue; j = i + nx; }
        else if (k === 4) { if (z === 0) continue; j = i - plane; }
        else { if (z === nz - 1) continue; j = i + plane; }
        if (!label[j] && inside(j)) {
          label[j] = next;
          stack[top++] = j;
        }
      }
    }
    next++;
    if (size < minVoxels) {
      out ??= v.slice();
      for (const i of blob) out[i] = outsideValue;
      hidden++;
    }
  }
  return { values: out ?? v, hidden };
}

/**
 * Gaussian low-pass of a grayscale image (sigma in its pixels, reflected
 * edges), as the host filters the full-resolution crops
 * (emhub.data.volume_crop): the values are then stretched around the middle
 * gray by the ratio of the standard deviations, so the contrast is kept.
 */
export function gaussianImage(img: HTMLImageElement | HTMLCanvasElement, sigma: number): HTMLCanvasElement {
  const w = img instanceof HTMLImageElement ? img.naturalWidth : img.width;
  const h = img instanceof HTMLImageElement ? img.naturalHeight : img.height;
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const g = c.getContext("2d", { willReadFrequently: true })!;
  g.drawImage(img, 0, 0);
  if (sigma <= 0.05 || !w || !h) return c;
  const id = g.getImageData(0, 0, w, h), px = id.data;
  const src = new Float32Array(w * h);
  for (let i = 0; i < src.length; i++) src[i] = px[4 * i];
  const r = Math.max(1, Math.ceil(3 * sigma));
  const k = new Float32Array(2 * r + 1);
  let ks = 0;
  for (let j = -r; j <= r; j++) ks += k[j + r] = Math.exp(-0.5 * (j / sigma) ** 2);
  for (let j = 0; j < k.length; j++) k[j] /= ks;
  const refl = (i: number, n: number) => (n < 2 ? 0 : i < 0 ? Math.min(-i, n - 1) : i >= n ? Math.max(2 * n - 2 - i, 0) : i);
  const tmp = new Float32Array(src.length), out = new Float32Array(src.length);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let s = 0;
      for (let j = -r; j <= r; j++) s += k[j + r] * src[y * w + refl(x + j, w)];
      tmp[y * w + x] = s;
    }
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let s = 0;
      for (let j = -r; j <= r; j++) s += k[j + r] * tmp[refl(y + j, h) * w + x];
      out[y * w + x] = s;
    }
  }
  const std = (v: Float32Array) => {
    let m = 0, m2 = 0;
    for (let i = 0; i < v.length; i++) { m += v[i]; m2 += v[i] * v[i]; }
    m /= v.length;
    return Math.sqrt(Math.max(m2 / v.length - m * m, 0));
  };
  const gain = std(src) / Math.max(std(out), 1e-6);
  for (let i = 0; i < out.length; i++) {
    const v = Math.min(255, Math.max(0, 127.5 + (out[i] - 127.5) * gain));
    px[4 * i] = px[4 * i + 1] = px[4 * i + 2] = v;
  }
  g.putImageData(id, 0, 0);
  return c;
}
