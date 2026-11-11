// src/components/viewers/volume/volumeMath.ts
// Geometry and formatting shared by the Slices and 3D tabs of VolumeViewer.
// Everything is in voxel coordinates of the full volume.
import type { ParticleTemplate } from "./templateSurface";

export type Axis = "x" | "y" | "z";
export const AXES: Axis[] = ["x", "y", "z"];

export type Vec3 = { x: number; y: number; z: number };

/** A decoded slice: the host's image, or one drawn from the density grid. */
export type SliceImage = HTMLImageElement | HTMLCanvasElement;

export function imageSize(img: SliceImage): [number, number] {
  return img instanceof HTMLImageElement ? [img.naturalWidth, img.naturalHeight] : [img.width, img.height];
}
export type VoxelSize = { x: number | null; y: number | null; z: number | null };

/** Picked particles in voxels, optional RELION angles and template surface (Å). */
export type VolumeCoordinates = {
  x: number[];
  y: number[];
  z: number[];
  /** [rot, tilt, psi] in degrees per particle (RELION convention). */
  angles?: number[][];
  /** Picking template: surface (flat vertices in Å, triangle indices) and,
   * optionally, its density to change the threshold (see templateSurface.ts). */
  template?: ParticleTemplate;
};

/**
 * Density for the iso-surface of the "3D volume" tab: a binned grid (block
 * means) quantized to uint8, with the histogram and statistics computed by
 * the host from the float values, in the units of the map (EMhub:
 * data/volume_density.py).
 */
export type VolumeDensity = {
  /** Grid (z, y, x). */
  shape: [number, number, number];
  /** Full-volume voxels per grid voxel (not always an integer). */
  binning: number;
  /** base64 uint8, x fastest; 0 and 255 are valueRange[0] and [1]. */
  data: string;
  /** "zlib": `data` is compressed (decoded by prepareDensity). */
  encoding?: "zlib" | null;
  valueRange: [number, number];
  /** How the host scaled the volume (e.g. "Fourier ×0.776", "block mean ×3"). */
  method?: string;
  /** Seconds of each step on the host (`total`; `cached`: it was in memory). */
  timing?: Record<string, number | boolean>;
  /** Grid voxels and base64 characters sent. */
  bytes?: { grid: number; sent: number };
  /** Of the full-resolution volume. */
  stats?: { min: number; max: number; mean: number; std: number };
  histogram?: {
    /** Bins evenly spread over this range. */
    range: [number, number];
    /** Voxels of the full-resolution volume per bin. */
    counts: number[];
    /** Voxels of the binned grid (the surface's data) per bin. */
    shown?: number[];
    below?: number;
    above?: number;
    shownBelow?: number;
    shownAbove?: number;
  };
};

/** Loaded with the DataLoader when the tab is opened; `maxVoxels` is added
 * to the payload for the chosen detail. The response is VolumeDensity or
 * {density: VolumeDensity}. */
export type DensitySource = { path: string; payload?: Record<string, unknown> };

export type VolumeData = {
  /** [X, Y, Z] voxels. */
  dimensions: [number, number, number];
  /** Slice images (base64 PNG or url) per axis, keyed by slice number; if
   * missing, the sections are drawn from the density (it must be given). */
  axes?: Record<Axis, Record<string, string>> | null;
  /** Å per voxel: a number, [x, y, z] or null when unknown. */
  voxelSize?: number | number[] | null;
  coordinates?: VolumeCoordinates | null;
  /** Density for the "3D volume" tab (the tab is shown only with it). */
  density?: VolumeDensity | DensitySource | null;
};

/** Horizontal and vertical voxel axes of each section. */
export const HV: Record<Axis, [Axis, Axis]> = { z: ["x", "y"], y: ["x", "z"], x: ["z", "y"] };

/** Width and height (voxels) of each section. */
export function sectionSize(dim: Vec3): Record<Axis, [number, number]> {
  return { x: [dim.z, dim.y], y: [dim.x, dim.z], z: [dim.x, dim.y] };
}

export function normVoxel(v: unknown): VoxelSize | null {
  const ok = (n: unknown) => (isFinite(Number(n)) && Number(n) > 0 ? Number(n) : null);
  let r: VoxelSize | null = null;
  if (Array.isArray(v) && v.length >= 3) r = { x: ok(v[0]), y: ok(v[1]), z: ok(v[2]) };
  else if (v !== null && v !== undefined) r = { x: ok(v), y: ok(v), z: ok(v) };
  return r && (r.x || r.y || r.z) ? r : null;
}

/** Sorted slice numbers of each axis. */
export function sliceKeys(axes: Record<Axis, Record<string, string>>): Record<Axis, number[]> {
  const keys = {} as Record<Axis, number[]>;
  for (const a of AXES) {
    keys[a] = Object.keys(axes[a] ?? {}).map(Number).sort((p, q) => p - q);
  }
  return keys;
}

/** Index (in keys) of the slice closest to voxel v. */
export function nearest(keys: number[], v: number): number {
  let best = 0;
  for (let i = 1; i < keys.length; i++) {
    if (Math.abs(keys[i] - v) < Math.abs(keys[best] - v)) best = i;
  }
  return best;
}

export function clampVox(dim: Vec3, a: Axis, v: number): number {
  return Math.max(0, Math.min(dim[a] - 1, Math.floor(v)));
}

/** A length from voxel differences, in Å when the voxel size is known. */
export function formatLength(vs: VoxelSize | null, dx: number, dy: number, dz: number): string {
  const vox = Math.hypot(dx, dy, dz);
  const d3: Vec3 = { x: dx, y: dy, z: dz };
  const known = vs && AXES.every((a) => d3[a] === 0 || vs[a]);
  if (!known) return `${vox.toFixed(1)} voxels (voxel size unknown)`;
  const A = Math.hypot(dx * (vs!.x || 0), dy * (vs!.y || 0), dz * (vs!.z || 0));
  return `${A.toFixed(1)} Å (${(A / 10).toFixed(2)} nm) · ${vox.toFixed(1)} voxels`;
}

export type Ruler = { key: number; a: [number, number]; b: [number, number] };

/** Length of a ruler drawn on section `a`. */
export function rulerLength(vs: VoxelSize | null, a: Axis, r: Pick<Ruler, "a" | "b">): string {
  const dv: Vec3 = { x: 0, y: 0, z: 0 };
  dv[HV[a][0]] = r.b[0] - r.a[0];
  dv[HV[a][1]] = r.b[1] - r.a[1];
  return formatLength(vs, dv.x, dv.y, dv.z);
}

export function scaleText(vs: VoxelSize | null): string {
  const v = vs && (vs.x || vs.y || vs.z);
  return v ? `${v.toFixed(2)} Å/voxel` : "voxel size unknown";
}

/**
 * Rotation (row-major 3 x 3) placing a template in the viewer's world: the
 * transpose of the RELION Euler matrix (rot, tilt, psi), with y flipped,
 * scaled by `k` (voxels per Å).
 */
export function particleRotation(angles: number[] | undefined, k: number): number[] {
  const [rot, tilt, psi] = (angles ?? [0, 0, 0]).map((d) => (d * Math.PI) / 180);
  const cr = Math.cos(rot), sr = Math.sin(rot);
  const ct = Math.cos(tilt), st = Math.sin(tilt);
  const cp = Math.cos(psi), sp = Math.sin(psi);
  const A = [
    [cp * ct * cr - sp * sr, cp * ct * sr + sp * cr, -cp * st],
    [-sp * ct * cr - cp * sr, -sp * ct * sr + cp * cr, sp * st],
    [st * cr, st * sr, ct],
  ];
  const sg = [1, -1, 1];
  const e: number[] = [];
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) e.push(sg[r] * sg[c] * A[c][r] * k);
  }
  return e;
}

export function isDensitySource(d: VolumeDensity | DensitySource | null | undefined): d is DensitySource {
  return Boolean(d && !("data" in d && d.data) && "path" in d && d.path);
}

/**
 * VolumeData from a host response: the data itself, a table-viewer pane
 * ({kind: "imageSlider", axes: {x: {slices}}, dimensions, voxelSize,
 * coordinates, density}) or EMhub's {paneContent: pane}. null if it has
 * neither X, Y and Z slices nor a density.
 */
export function volumeDataFromPane(input: any): VolumeData | null {
  const pane = input && typeof input === "object" && "paneContent" in input ? input.paneContent : input;
  if (!pane || typeof pane !== "object" || !Array.isArray(pane.dimensions)) return null;
  const density = pane.density && (pane.density.data || pane.density.path) ? pane.density : null;
  let axes: VolumeData["axes"] = {} as Record<Axis, Record<string, string>>;
  for (const a of AXES) {
    const ax = pane.axes?.[a];
    const slices = ax && typeof ax === "object" && "slices" in ax ? ax.slices : ax;
    if (!slices || !Object.keys(slices).length) {
      axes = null;
      break;
    }
    axes[a] = slices;
  }
  if (!axes && !density) return null;
  const c = pane.coordinates;
  return {
    dimensions: pane.dimensions as [number, number, number],
    axes,
    voxelSize: pane.voxelSize ?? pane.voxel_size ?? null,
    coordinates: c && c.x && c.x.length ? c : null,
    density,
  };
}

/** Colors of a local resolution map, from the best resolution (lowest value,
 * blue) to the worst (red), evenly spaced: the usual rainbow of local
 * resolution maps (ChimeraX: color sample ... palette ^rainbow). Shared by
 * the 3D volume (shader) and the slices, so both color a value alike. */
export const RESOLUTION_PALETTE = ["#0000ff", "#00ffff", "#00ff00", "#ffff00", "#ff0000"];

const PALETTE_RGB = RESOLUTION_PALETTE.map((h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)));

/** RGB (0-255) of t (0-1, clamped) in RESOLUTION_PALETTE, linear between
 * the colors (as the 3D shader). */
export function resolutionRgb(t: number): [number, number, number] {
  const x = Math.min(1, Math.max(0, t)) * (PALETTE_RGB.length - 1);
  const i = Math.min(Math.floor(x), PALETTE_RGB.length - 2), f = x - i;
  const [a, b] = [PALETTE_RGB[i], PALETTE_RGB[i + 1]];
  return [0, 1, 2].map((k) => Math.round(a[k] + (b[k] - a[k]) * f)) as [number, number, number];
}

/**
 * Range of the values of a map (e.g. a local resolution map): the values > 0
 * (<= 0: no value, outside its mask) without `tail` of each end, in map
 * units; null if it has none. The fallback of the coloring range when the
 * surface one (3D volume) is not known.
 */
export function mapValueRange(d: VolumeDensity, values: Uint8Array, tail = 0.01): [number, number] | null {
  const [v0, v1] = d.valueRange;
  const counts = new Array<number>(256).fill(0);
  let n = 0;
  for (let i = 0; i < values.length; i++) {
    if (v0 + (values[i] / 255) * (v1 - v0) > 0) { counts[values[i]]++; n++; }
  }
  if (!n) return null;
  const at = (q: number) => {
    let acc = 0;
    for (let k = 0; k < 256; k++) { acc += counts[k]; if (acc > q * (n - 1)) return v0 + (k / 255) * (v1 - v0); }
    return v1;
  };
  const lo = at(tail), hi = at(1 - tail);
  return hi > lo ? [lo, hi] : [lo, lo + (v1 - v0) / 255];
}
