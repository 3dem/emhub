// src/components/viewers/tiltseries/alignment.ts
//
// The RELION 5 alignment of a tilt (TiltSeriesViewer): where a point of the
// aligned frame is in the tilt image as acquired, the warp of a tilt into
// that frame, and the correlation of neighbouring tilts that measures how
// well they line up.
//
// RELION (Tomogram::projectPoint, src/jaz/tomography/tomogram.cpp) projects
// a point to  pl = R(zRot) (q) + centre + shift / pixelSize  and, with local
// alignment, to  pl + d(pl), d the 2D deformation of the tilt evaluated in
// pixels of the full size tilt image (imageSize, at rlnTomoTiltSeriesPixelSize).
// The aligned frame is q + frame centre (tilt axis vertical), so drawing a
// tilt aligned samples it at rawPoint(frame point).
import type { TiltSeriesDeformation, TiltSeriesTilt } from "@/services/ProjectService";

export type Pt = { x: number; y: number };

const DEG = Math.PI / 180;

export const hasAlign = (t: TiltSeriesTilt) => t.zRot != null && t.shiftX != null && t.shiftY != null;

/** RELION's Spline2DDeformationModel::computeShift: a bicubic Hermite patch
 * per grid cell; per node and dimension [value, slope_x, slope_y, twist], the
 * nodes x fastest, then y, then the dimension (x shift first). (x, y) and
 * the shift in pixels of the full size image (size W x H). */
export function splineShift(
  c: number[], gx: number, gy: number, W: number, H: number, x: number, y: number,
): [number, number] {
  let qx = x / (W / (gx - 1)), qy = y / (H / (gy - 1));
  qx = Math.min(Math.max(qx, 0), gx - 1 - 1e-10);
  qy = Math.min(Math.max(qy, 0), gy - 1 - 1e-10);
  const cx = Math.floor(qx), cy = Math.floor(qy);
  const u = qx - cx, v = qy - cy, u2 = u * u, v2 = v * v, u3 = u2 * u, v3 = v2 * v;
  const hx = [1 - 3 * u2 + 2 * u3, 3 * u2 - 2 * u3, u - 2 * u2 + u3, -u2 + u3];
  const hy = [1 - 3 * v2 + 2 * v3, 3 * v2 - 2 * v3, v - 2 * v2 + v3, -v2 + v3];
  const out: [number, number] = [0, 0];
  for (let dim = 0; dim < 2; dim++) {
    const n = (ix: number, iy: number) => 4 * ((dim * gy + cy + iy) * gx + cx + ix);
    const n00 = n(0, 0), n01 = n(0, 1), n10 = n(1, 0), n11 = n(1, 1);
    // F rows (gravis d4Matrix, row by row): x-node 0 values, x-node 1
    // values, x-node 0 x-slopes, x-node 1 x-slopes; columns y-node 0, 1 and
    // their y-slopes
    const F = [
      [c[n00], c[n01], c[n00 + 2], c[n01 + 2]],
      [c[n10], c[n11], c[n10 + 2], c[n11 + 2]],
      [c[n00 + 1], c[n01 + 1], c[n00 + 3], c[n01 + 3]],
      [c[n10 + 1], c[n11 + 1], c[n10 + 3], c[n11 + 3]],
    ];
    let s = 0;
    for (let a = 0; a < 4; a++) {
      s += hx[a] * (F[a][0] * hy[0] + F[a][1] * hy[1] + F[a][2] * hy[2] + F[a][3] * hy[3]);
    }
    out[dim] = s;
  }
  return out;
}

/** Whether the viewer can apply a deformation (RELION also has "Fourier" and
 * "linear" ones; the projects write "spline"). */
export const deformationSupported = (d: TiltSeriesDeformation | null | undefined) =>
  !!d && d.type === "spline" && d.gridSize[0] > 1 && d.gridSize[1] > 1;

/** The geometry of a tilt series: image size (w x h, the images sent), Å per
 * pixel, the aligned frame (the image box rotated by the median rotation)
 * and the local deformation. */
export type Geometry = {
  w: number;
  h: number;
  px: number;
  frameW: number;
  frameH: number;
  deformation: TiltSeriesDeformation | null;
};

/** Which parts of the alignment a tilt is drawn with: the global one
 * (rotation and shifts, into the aligned frame) and the local deformation. */
export type Apply = { global: boolean; local: boolean };

/** How the tilts are drawn and measured: as acquired, with the global
 * alignment, or with the global and the local one. */
export type View = "raw" | "global" | "both";
export const VIEW_APPLY: Record<View, Apply> = {
  raw: { global: false, local: false },
  global: { global: true, local: false },
  both: { global: true, local: true },
};

/** The frame a tilt is drawn in: the aligned frame with the global
 * alignment, else the image itself. */
export const frameOf = (g: Geometry, a: Apply) => (a.global ? { w: g.frameW, h: g.frameH } : { w: g.w, h: g.h });

/** The point of the tilt image (pixels of the images sent) shown at frame
 * point (fx, fy) when the tilt is drawn with `a`. A tilt without alignment
 * is only rotated by `theta0`. */
export function rawPoint(g: Geometry, t: TiltSeriesTilt, a: Apply, theta0: number, fx: number, fy: number): Pt {
  let x = fx, y = fy;
  if (a.global) {
    const ok = hasAlign(t);
    const r = ok ? (t.zRot as number) * DEG : -theta0;
    const qx = fx - g.frameW / 2, qy = fy - g.frameH / 2;
    x = Math.cos(r) * qx - Math.sin(r) * qy + g.w / 2 + (ok ? (t.shiftX as number) / g.px : 0);
    y = Math.sin(r) * qx + Math.cos(r) * qy + g.h / 2 + (ok ? (t.shiftY as number) / g.px : 0);
  }
  const d = a.local ? deformationAt(g, t, x, y) : null;
  return d ? { x: x + d.x, y: y + d.y } : { x, y };
}

/** The deformation of a tilt at an image point (pixels of the images sent). */
export function deformationAt(g: Geometry, t: TiltSeriesTilt, x: number, y: number): Pt | null {
  const d = g.deformation;
  if (!d || !t.deformation || !deformationSupported(d)) return null;
  const [W, H] = d.imageSize, kx = W / g.w, ky = H / g.h;
  const [dx, dy] = splineShift(t.deformation, d.gridSize[0], d.gridSize[1], W, H,
                               (x - g.w / 2) * kx + Math.floor(W / 2), (y - g.h / 2) * ky + Math.floor(H / 2));
  return { x: dx / kx, y: dy / ky };
}

/** The grey values (0-255) of a decoded image, w x h. */
export function greyOf(img: HTMLImageElement, w: number, h: number): Float32Array {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d", { willReadFrequently: true }) as CanvasRenderingContext2D;
  ctx.drawImage(img, 0, 0, w, h);
  const rgba = ctx.getImageData(0, 0, w, h).data, out = new Float32Array(w * h);
  for (let i = 0; i < out.length; i++) out[i] = rgba[4 * i];
  return out;
}

export type Grey = { data: Float32Array; valid: Uint8Array; w: number; h: number };

/** A tilt drawn with `a`: its frame sampled at `scale` (output pixels per
 * frame pixel) from the grey image, bilinear; pixels outside the image are
 * not valid. The tilt image position is computed exactly on a lattice every
 * `step` output pixels and interpolated in between (the rigid part is
 * linear, the deformation is smooth). */
export function warpTilt(
  src: Float32Array, g: Geometry, t: TiltSeriesTilt, a: Apply, theta0: number, scale = 1, step = 8,
): Grey {
  const f = frameOf(g, a);
  const W = Math.max(1, Math.round(f.w * scale)), H = Math.max(1, Math.round(f.h * scale));
  const nx = Math.ceil(W / step) + 1, ny = Math.ceil(H / step) + 1;
  const lx = new Float32Array(nx * ny), ly = new Float32Array(nx * ny);
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const p = rawPoint(g, t, a, theta0, ((i * step + 0.5) / scale), ((j * step + 0.5) / scale));
      lx[j * nx + i] = p.x;
      ly[j * nx + i] = p.y;
    }
  }
  const data = new Float32Array(W * H), valid = new Uint8Array(W * H);
  const { w, h } = g;
  for (let y = 0; y < H; y++) {
    const j = Math.floor(y / step), fy = (y - j * step) / step;
    for (let x = 0; x < W; x++) {
      const i = Math.floor(x / step), fx = (x - i * step) / step;
      const k = j * nx + i;
      const sx = (lx[k] * (1 - fx) + lx[k + 1] * fx) * (1 - fy) + (lx[k + nx] * (1 - fx) + lx[k + nx + 1] * fx) * fy - 0.5;
      const sy = (ly[k] * (1 - fx) + ly[k + 1] * fx) * (1 - fy) + (ly[k + nx] * (1 - fx) + ly[k + nx + 1] * fx) * fy - 0.5;
      if (sx < 0 || sy < 0 || sx > w - 1 || sy > h - 1) continue;
      const x0 = Math.min(Math.floor(sx), w - 2), y0 = Math.min(Math.floor(sy), h - 2);
      const ax = sx - x0, ay = sy - y0, o = y0 * w + x0;
      data[y * W + x] = (src[o] * (1 - ax) + src[o + 1] * ax) * (1 - ay) + (src[o + w] * (1 - ax) + src[o + w + 1] * ax) * ay;
      valid[y * W + x] = 1;
    }
  }
  return { data, valid, w: W, h: H };
}

/** RGBA pixels of a grey frame (outside the image transparent). */
export function toImageData(g: Grey): ImageData {
  const out = new ImageData(g.w, g.h);
  for (let i = 0; i < g.data.length; i++) {
    const v = g.data[i];
    out.data[4 * i] = out.data[4 * i + 1] = out.data[4 * i + 2] = v;
    out.data[4 * i + 3] = g.valid[i] ? 255 : 0;
  }
  return out;
}

/** A grey image resampled by `scale` (box average when shrinking), all valid. */
export function scaleGrey(src: Float32Array, w: number, h: number, scale: number): Grey {
  const W = Math.max(1, Math.round(w * scale)), H = Math.max(1, Math.round(h * scale));
  const data = new Float32Array(W * H), valid = new Uint8Array(W * H).fill(1);
  const f = 1 / scale;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      let s = 0, n = 0;
      const y0 = Math.floor(y * f), y1 = Math.max(y0 + 1, Math.min(h, Math.floor((y + 1) * f)));
      const x0 = Math.floor(x * f), x1 = Math.max(x0 + 1, Math.min(w, Math.floor((x + 1) * f)));
      for (let yy = y0; yy < y1; yy++) for (let xx = x0; xx < x1; xx++) { s += src[yy * w + xx]; n++; }
      data[y * W + x] = n ? s / n : 0;
    }
  }
  return { data, valid, w: W, h: H };
}

/** Separable box blur of odd width k (edges clamped). */
function boxBlur(src: Float32Array, w: number, h: number, k: number): Float32Array {
  const r = (k - 1) >> 1, tmp = new Float32Array(w * h), out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    const row = y * w;
    let s = 0;
    for (let x = -r; x <= r; x++) s += src[row + Math.min(Math.max(x, 0), w - 1)];
    for (let x = 0; x < w; x++) {
      tmp[row + x] = s / k;
      s += src[row + Math.min(x + r + 1, w - 1)] - src[row + Math.max(x - r, 0)];
    }
  }
  for (let x = 0; x < w; x++) {
    let s = 0;
    for (let y = -r; y <= r; y++) s += tmp[Math.min(Math.max(y, 0), h - 1) * w + x];
    for (let y = 0; y < h; y++) {
      out[y * w + x] = s / k;
      s += tmp[Math.min(y + r + 1, h - 1) * w + x] - tmp[Math.max(y - r, 0) * w + x];
    }
  }
  return out;
}

export type Prepared = { data: Float32Array; mask: Uint8Array; w: number; h: number };

/** A frame band-passed for the correlation (box blurs of about 30 Å minus
 * about 250 Å, at `px` Å per pixel: the features, not the ice gradients nor
 * the noise), with the pixels far enough from the image edge in the central
 * 60% of it. */
export function prepareForCorrelation(g: Grey, px: number): Prepared {
  const odd = (v: number) => Math.max(1, Math.round(v) | 1);
  const k1 = odd(30 / px), k2 = Math.max(odd(250 / px), k1 + 2);
  let sum = 0, n = 0;
  for (let i = 0; i < g.data.length; i++) if (g.valid[i]) { sum += g.data[i]; n++; }
  const mean = n ? sum / n : 0, filled = new Float32Array(g.data.length), validF = new Float32Array(g.data.length);
  for (let i = 0; i < g.data.length; i++) { filled[i] = g.valid[i] ? g.data[i] : mean; validF[i] = g.valid[i]; }
  const fine = boxBlur(filled, g.w, g.h, k1), coarse = boxBlur(filled, g.w, g.h, k2);
  const cover = boxBlur(validF, g.w, g.h, k2);
  const data = new Float32Array(g.data.length), mask = new Uint8Array(g.data.length);
  const x0 = g.w * 0.2, x1 = g.w * 0.8, y0 = g.h * 0.2, y1 = g.h * 0.8;
  for (let y = 0; y < g.h; y++) {
    for (let x = 0; x < g.w; x++) {
      const i = y * g.w + x;
      data[i] = fine[i] - coarse[i];
      mask[i] = cover[i] > 0.999 && x >= x0 && x < x1 && y >= y0 && y < y1 ? 1 : 0;
    }
  }
  return { data, mask, w: g.w, h: g.h };
}

/** Pearson correlation of two prepared frames of the same size, over the
 * pixels valid in both; null with too few. */
export function correlation(a: Prepared, b: Prepared): number | null {
  if (a.w !== b.w || a.h !== b.h) return null;
  let n = 0, sa = 0, sb = 0, saa = 0, sbb = 0, sab = 0;
  for (let i = 0; i < a.data.length; i++) {
    if (!a.mask[i] || !b.mask[i]) continue;
    const x = a.data[i], y = b.data[i];
    n++; sa += x; sb += y; saa += x * x; sbb += y * y; sab += x * y;
  }
  if (n < 100) return null;
  const va = saa - (sa * sa) / n, vb = sbb - (sb * sb) / n;
  return va > 0 && vb > 0 ? (sab - (sa * sb) / n) / Math.sqrt(va * vb) : null;
}
