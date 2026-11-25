// src/components/viewers/volume/maskDrawing.ts
//
// What the contour and border tools of VolumeSlices draw (e.g. the masks of
// MaskDrawWizard; server: emwrap.base.mask_draw): closed contours on Z
// sections and the lower / upper borders of a lamella as straight lines on
// Y or X sections, with the plane of each border (as the server's
// border_plane) to show it on every section.
//
// Points are in voxels of their section (voxel i spans [i, i + 1)): a Z
// section x, y; a Y section x, z; an X section z, y (volumeMath.HV).
import type { Axis, Vec3 } from "./volumeMath";

/** A closed contour on the Z slice z. */
export type SliceContour = { z: number; points: [number, number][] };

/** A border of the lamella ("low": smaller Z, "high"), a line on the Y or
 * X slice `index`. */
export type SliceBorder = { side: "low" | "high"; axis: "y" | "x"; index: number;
                            points: [[number, number], [number, number]] };

/** What the tools draw: one contour per Z slice at most and the border
 * lines. `fill`: the color of the region of the contours between the
 * borders, drawn translucent over the sections (null: not filled). */
export type SliceDrawing = {
  contours: SliceContour[];
  borders: SliceBorder[];
  fill?: string | null;
};

/** z = a + gx x + gy y (voxels). */
export type Plane = { a: number; gx: number; gy: number };

/** Distance from p to the segment ab, and the parameter t of the nearest point. */
export function segmentDistance(p: [number, number], a: [number, number], b: [number, number]): [number, number] {
  const dx = b[0] - a[0], dy = b[1] - a[1], L2 = dx * dx + dy * dy;
  const t = L2 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L2)) : 0;
  return [Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy), t];
}

/** Where a closed polygon crosses the line v = c (points h, v; uIndex: the
 * coordinate returned): the u of the crossings. */
export function crossings(points: [number, number][], c: number, uIndex: 0 | 1): number[] {
  const out: number[] = [], vIndex = uIndex === 0 ? 1 : 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i], b = points[(i + 1) % points.length];
    if ((a[vIndex] > c) !== (b[vIndex] > c)) {
      out.push(a[uIndex] + ((c - a[vIndex]) * (b[uIndex] - a[uIndex])) / (b[vIndex] - a[vIndex]));
    }
  }
  return out;
}

/** The Z of a point of a border line (Y section: its v; X section: its h). */
export const borderZ = (b: Pick<SliceBorder, "axis">, q: [number, number]) => (b.axis === "y" ? q[1] : q[0]);
const meanZ = (b: SliceBorder) => (borderZ(b, b.points[0]) + borderZ(b, b.points[1])) / 2;

/** The ends of a border line as (x, y, z) voxels. */
function borderPoints(b: SliceBorder): Vec3[] {
  const c = b.index + 0.5;
  return b.points.map(([h, v]) => (b.axis === "y" ? { x: h, y: c, z: v } : { x: c, y: v, z: h }));
}

/** The plane through the ends of the lines (least squares, as the server):
 * no tilt along X (Y) when all the ends have the same x (y). */
export function borderPlane(lines: SliceBorder[]): Plane | null {
  const P = lines.flatMap(borderPoints);
  if (!P.length) return null;
  const spread = (k: "x" | "y") => Math.max(...P.map((p) => p[k])) - Math.min(...P.map((p) => p[k])) > 1e-6;
  const used = (["x", "y"] as const).filter(spread);
  // Normal equations of z = a + sum g_k k, centered (well conditioned)
  const mean = (f: (p: Vec3) => number) => P.reduce((s, p) => s + f(p), 0) / P.length;
  const m = { x: mean((p) => p.x), y: mean((p) => p.y), z: mean((p) => p.z) };
  const g: Record<"x" | "y", number> = { x: 0, y: 0 };
  if (used.length === 1) {
    const k = used[0];
    const sxx = P.reduce((s, p) => s + (p[k] - m[k]) ** 2, 0);
    g[k] = P.reduce((s, p) => s + (p[k] - m[k]) * (p.z - m.z), 0) / sxx;
  } else if (used.length === 2) {
    const S = (u: "x" | "y" | "z", w: "x" | "y" | "z") => P.reduce((s, p) => s + (p[u] - m[u]) * (p[w] - m[w]), 0);
    const sxx = S("x", "x"), syy = S("y", "y"), sxy = S("x", "y"), sxz = S("x", "z"), syz = S("y", "z");
    const det = sxx * syy - sxy * sxy;
    if (Math.abs(det) > 1e-9) {
      g.x = (sxz * syy - syz * sxy) / det;
      g.y = (syz * sxx - sxz * sxy) / det;
    }
  }
  return { a: m.z - g.x * m.x - g.y * m.y, gx: g.x, gy: g.y };
}

/** The planes of the lower and upper borders (null: not drawn). */
export function borderPlanes(borders: SliceBorder[]): { low: Plane | null; high: Plane | null } {
  return {
    low: borderPlane(borders.filter((b) => b.side === "low")),
    high: borderPlane(borders.filter((b) => b.side === "high")),
  };
}

export const planeZ = (p: Plane, x: number, y: number) => p.a + p.gx * x + p.gy * y;

/** The borders with a new line on its section: at most two per section,
 * the lower one "low". A third one replaces the line of the section nearest
 * to it; the first one of a section takes the side of the borders already
 * drawn nearest to it (by mean Z), else "low" in the lower half of the box. */
export function addBorder(borders: SliceBorder[], line: Omit<SliceBorder, "side">, depth: number): SliceBorder[] {
  const same = (b: SliceBorder) => b.axis === line.axis && b.index === line.index;
  let here = borders.filter(same);
  const others = borders.filter((b) => !same(b));
  const z = meanZ({ ...line, side: "low" });
  if (here.length >= 2) {
    const far = here.reduce((f, b) => (Math.abs(meanZ(b) - z) > Math.abs(meanZ(f) - z) ? b : f));
    here = [far];
  }
  let side: SliceBorder["side"];
  if (here.length) {
    side = here[0].side === "low" ? "high" : "low";
  } else {
    const near = (s: SliceBorder["side"]) => {
      const zs = others.filter((b) => b.side === s).map(meanZ);
      return zs.length ? Math.min(...zs.map((v) => Math.abs(v - z))) : Infinity;
    };
    const dl = near("low"), dh = near("high");
    side = dl === Infinity && dh === Infinity ? (z < depth / 2 ? "low" : "high") : dl <= dh ? "low" : "high";
  }
  let mine: SliceBorder[] = [...here, { ...line, side }];
  // On a section, the lower line is the lower border
  if (mine.length === 2 && meanZ(mine.find((b) => b.side === "low")!) > meanZ(mine.find((b) => b.side === "high")!)) {
    mine = mine.map((b) => ({ ...b, side: b.side === "low" ? "high" : "low" }));
  }
  return [...others, ...mine];
}

/** The section axes of a border's section. */
export const isBorderAxis = (a: Axis): a is "x" | "y" => a === "x" || a === "y";

/** Signed distance (voxels) of (h, v) to the edges of a closed polygon,
 * negative inside (even-odd rule), as the server's contour_sdf. */
export function polygonSdf(pts: [number, number][], h: number, v: number): number {
  let d2 = Infinity, inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [h0, v0] = pts[j], [h1, v1] = pts[i];
    const dh = h1 - h0, dv = v1 - v0, L2 = dh * dh + dv * dv;
    const t = L2 ? Math.max(0, Math.min(1, ((h - h0) * dh + (v - v0) * dv) / L2)) : 0;
    d2 = Math.min(d2, (h - h0 - t * dh) ** 2 + (v - v0 - t * dv) ** 2);
    if (dv !== 0 && (v0 > v) !== (v1 > v) && h < h0 + ((v - v0) * dh) / dv) inside = !inside;
  }
  const d = Math.sqrt(d2);
  return inside ? -d : d;
}

/** Inside the region of the Z contours at (x, y, z) (as the server: the
 * signed distances interpolated linearly in Z between the two contours
 * around z, the nearest one beyond the first and last); `sorted` by z. */
export function insideContours(sorted: SliceContour[], x: number, y: number, z: number): boolean {
  const n = sorted.length;
  if (!n) return false;
  let j = 0;
  while (j < n && sorted[j].z + 0.5 <= z) j++;
  if (j === 0) return polygonSdf(sorted[0].points, x, y) <= 0;
  if (j === n) return polygonSdf(sorted[n - 1].points, x, y) <= 0;
  const c0 = sorted[j - 1].z + 0.5, c1 = sorted[j].z + 0.5, t = (z - c0) / (c1 - c0);
  return (1 - t) * polygonSdf(sorted[j - 1].points, x, y) + t * polygonSdf(sorted[j].points, x, y) <= 0;
}

/** Between the borders at (x, y, z). */
export function insideBorders(planes: { low: Plane | null; high: Plane | null },
                              x: number, y: number, z: number): boolean {
  let lo = planes.low ? planeZ(planes.low, x, y) : -Infinity;
  let hi = planes.high ? planeZ(planes.high, x, y) : Infinity;
  if (planes.low && planes.high && lo > hi) [lo, hi] = [hi, lo];
  return z >= lo && z <= hi;
}

/** Most cells along a side of a section for the region of a drawing (its
 * fill and the shade outside the borders); one per voxel below. */
const REGION_CELLS = 128;
/** Opacity of the region fill, and of the shade outside the borders. */
const FILL_OPACITY = 0.35;
const SHADE_OPACITY = 0.45;
// The region images of each drawing, by section and slice
const regionCache = new WeakMap<SliceDrawing, Map<string, HTMLCanvasElement | null>>();

/** The region of a drawing on the slice `key` of section a (`size`: the
 * section sizes in voxels), on cells (one canvas pixel each, at most
 * REGION_CELLS per side), to draw stretched over the section: the fill
 * color inside the contours and between the borders, a shade outside the
 * borders; null when there is nothing to show. Cached per
 * drawing (a new drawing object, new images): the Slices tab and the 3D
 * planes share them. */
export function regionImage(d: SliceDrawing, a: Axis, key: number,
                            size: Record<Axis, [number, number]>): HTMLCanvasElement | null {
  let cache = regionCache.get(d);
  if (!cache) regionCache.set(d, cache = new Map());
  const id = `${a}:${key}`;
  if (cache.has(id)) return cache.get(id)!;
  const planes = borderPlanes(d.borders);
  const contours = [...d.contours].sort((x, y) => x.z - y.z);
  const bounded = Boolean(planes.low || planes.high);
  const fill = d.fill && contours.length ? d.fill : null;
  let img: HTMLCanvasElement | null = null;
  if (fill || bounded) {
    const [W, H] = size[a];
    const nw = Math.max(1, Math.min(REGION_CELLS, Math.round(W))), nh = Math.max(1, Math.min(REGION_CELLS, Math.round(H)));
    img = document.createElement("canvas");
    img.width = nw;
    img.height = nh;
    const g = img.getContext("2d")!, c = key + 0.5;
    const px = g.createImageData(nw, nh), out = px.data;
    // The fill color (CSS hex), as RGB bytes
    const hex = (fill ?? "#000000").replace("#", "");
    const rgb = hex.length === 3 ? [...hex].map((ch) => parseInt(ch + ch, 16))
      : [0, 2, 4].map((o) => parseInt(hex.slice(o, o + 2), 16));
    const fillA = Math.round(FILL_OPACITY * 255), shadeA = Math.round(SHADE_OPACITY * 255);
    for (let j = 0; j < nh; j++) {
      const vv = ((j + 0.5) * H) / nh;
      for (let i = 0; i < nw; i++) {
        const h = ((i + 0.5) * W) / nw, o = 4 * (j * nw + i);
        // The voxel (x, y, z) of the cell of this section
        const [x, y, z] = a === "z" ? [h, vv, c] : a === "y" ? [h, c, vv] : [c, vv, h];
        if (!insideBorders(planes, x, y, z)) {
          out[o + 3] = shadeA;
        } else if (fill && insideContours(contours, x, y, z)) {
          out[o] = rgb[0]; out[o + 1] = rgb[1]; out[o + 2] = rgb[2]; out[o + 3] = fillA;
        }
      }
    }
    g.putImageData(px, 0, 0);
  }
  cache.set(id, img);
  return img;
}

/** The drawing moved by delta (voxels): the contours and the border lines
 * (Z by whole slices, as the contours are on slices; the slice of a line
 * on a Y / X section by whole slices too), kept inside the box. */
export function translateDrawing(d: SliceDrawing, delta: Vec3, dim: Vec3): SliceDrawing {
  const dz = Math.round(delta.z);
  const clamp = (v: number, n: number) => Math.max(0, Math.min(n - 1, v));
  const contours = new Map<number, SliceContour>();
  for (const c of d.contours) {
    const z = clamp(c.z + dz, dim.z);
    contours.set(z, { z, points: c.points.map(([x, y]) => [x + delta.x, y + delta.y] as [number, number]) });
  }
  const borders = d.borders.map((b): SliceBorder => (b.axis === "y"
    ? { ...b, index: clamp(Math.round(b.index + delta.y), dim.y),
        points: b.points.map(([x, z]) => [x + delta.x, z + dz]) as SliceBorder["points"] }
    : { ...b, index: clamp(Math.round(b.index + delta.x), dim.x),
        points: b.points.map(([z, y]) => [z + dz, y + delta.y]) as SliceBorder["points"] }));
  return { ...d, contours: [...contours.values()].sort((x, y) => x.z - y.z), borders };
}
