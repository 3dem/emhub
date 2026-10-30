// src/components/viewers/volume/volumeMath.ts
// Geometry and formatting shared by the Slices and 3D tabs of VolumeViewer.
// Everything is in voxel coordinates of the full volume.

export type Axis = "x" | "y" | "z";
export const AXES: Axis[] = ["x", "y", "z"];

export type Vec3 = { x: number; y: number; z: number };
export type VoxelSize = { x: number | null; y: number | null; z: number | null };

/** Picked particles in voxels, optional RELION angles and template surface (Å). */
export type VolumeCoordinates = {
  x: number[];
  y: number[];
  z: number[];
  /** [rot, tilt, psi] in degrees per particle (RELION convention). */
  angles?: number[][];
  /** Surface of the picking template: flat vertices (Å) and triangle indices. */
  template?: { vertices: number[]; faces: number[] };
};

export type VolumeData = {
  /** [X, Y, Z] voxels. */
  dimensions: [number, number, number];
  /** Slice images (base64 PNG or url) per axis, keyed by slice number. */
  axes: Record<Axis, Record<string, string>>;
  /** Å per voxel: a number, [x, y, z] or null when unknown. */
  voxelSize?: number | number[] | null;
  coordinates?: VolumeCoordinates | null;
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
export function sliceKeys(axes: VolumeData["axes"]): Record<Axis, number[]> {
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

/**
 * VolumeData from a host response: the data itself, a table-viewer pane
 * ({kind: "imageSlider", axes: {x: {slices}}, dimensions, voxelSize,
 * coordinates}) or EMhub's {paneContent: pane}. null if it has no X, Y and Z
 * slices.
 */
export function volumeDataFromPane(input: any): VolumeData | null {
  const pane = input && typeof input === "object" && "paneContent" in input ? input.paneContent : input;
  if (!pane || typeof pane !== "object" || !pane.axes || !Array.isArray(pane.dimensions)) return null;
  const axes = {} as VolumeData["axes"];
  for (const a of AXES) {
    const ax = pane.axes[a];
    const slices = ax && typeof ax === "object" && "slices" in ax ? ax.slices : ax;
    if (!slices || !Object.keys(slices).length) return null;
    axes[a] = slices;
  }
  const c = pane.coordinates;
  return {
    dimensions: pane.dimensions as [number, number, number],
    axes,
    voxelSize: pane.voxelSize ?? pane.voxel_size ?? null,
    coordinates: c && c.x && c.x.length ? c : null,
  };
}
