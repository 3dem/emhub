// src/components/viewers/volume/templateSurface.ts
//
// Surface of the picking template drawn at each particle in the 3D tab. The
// host sends the surface at its default threshold (`vertices`, `faces`) and,
// optionally, the template density so the viewer can rebuild the surface at
// another threshold. Same algorithm as EMhub's data/coords3d.py
// (_surface_nets), so both give the same surface at the same level.

export type TemplateDensity = {
  /** Grid (z, y, x), already padded by one voxel. */
  shape: [number, number, number];
  /** base64 uint8, 0-255 of the map maximum. */
  data: string;
  /** Å per grid voxel. */
  voxelSize: number;
  /** Default threshold, as a fraction of the maximum. */
  level: number;
};

export type ParticleTemplate = {
  /** Flat vertices (Å, x y z, centered) and triangle indices. */
  vertices: number[];
  faces: number[];
  density?: TemplateDensity;
};

export type TemplateMesh = { positions: Float32Array; indices: Uint32Array };

const decoded = new WeakMap<TemplateDensity, Uint8Array>();

function densityValues(d: TemplateDensity): Uint8Array {
  let v = decoded.get(d);
  if (!v) {
    const bin = atob(d.data);
    v = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) v[i] = bin.charCodeAt(i);
    decoded.set(d, v);
  }
  return v;
}

/** Triangle mesh of f == 0 (inside f > 0) of a (n0, n1, n2) grid, in grid units. */
export function surfaceNets(f: Float32Array, n: [number, number, number]) {
  const [n0, n1, n2] = n;
  const c0 = n0 - 1, c1 = n1 - 1, c2 = n2 - 1;
  const at = (i: number, j: number, k: number) => f[(i * n1 + j) * n2 + k];
  const cellId = (i: number, j: number, k: number) => (i * c1 + j) * c2 + k;
  const vid = new Int32Array(c0 * c1 * c2).fill(-1);
  const verts: number[] = [];

  // The 12 cube edges as (corner, axis) with the corner's coordinate 0 on that axis
  const edges: [number, number, number, number][] = [];
  for (let a = 0; a < 3; a++) {
    for (const p of [0, 1]) for (const q of [0, 1]) {
      const c = [0, 0, 0];
      c[(a + 1) % 3] = p;
      c[(a + 2) % 3] = q;
      edges.push([c[0], c[1], c[2], a]);
    }
  }

  for (let i = 0; i < c0; i++) for (let j = 0; j < c1; j++) for (let k = 0; k < c2; k++) {
    let sx = 0, sy = 0, sz = 0, cnt = 0;
    for (const [di, dj, dk, a] of edges) {
      const f0 = at(i + di, j + dj, k + dk);
      const f1 = at(i + di + (a === 0 ? 1 : 0), j + dj + (a === 1 ? 1 : 0), k + dk + (a === 2 ? 1 : 0));
      if ((f0 > 0) === (f1 > 0)) continue;
      const t = f0 / (f0 - f1);
      sx += di + (a === 0 ? t : 0);
      sy += dj + (a === 1 ? t : 0);
      sz += dk + (a === 2 ? t : 0);
      cnt++;
    }
    if (!cnt) continue;
    vid[cellId(i, j, k)] = verts.length / 3;
    verts.push(i + sx / cnt, j + sy / cnt, k + sz / cnt);
  }

  const tris: number[] = [];
  const dims = [n0, n1, n2];
  for (let a = 0; a < 3; a++) {
    const b = (a + 1) % 3, c = (a + 2) % 3;
    const P = [0, 0, 0];
    for (P[a] = 0; P[a] < dims[a] - 1; P[a]++) {
      for (P[b] = 1; P[b] < dims[b] - 1; P[b]++) {
        for (P[c] = 1; P[c] < dims[c] - 1; P[c]++) {
          const f0 = at(P[0], P[1], P[2]);
          const f1 = at(P[0] + (a === 0 ? 1 : 0), P[1] + (a === 1 ? 1 : 0), P[2] + (a === 2 ? 1 : 0));
          if ((f0 > 0) === (f1 > 0)) continue;
          const quad: number[] = [];
          for (const [db, dc] of [[0, 0], [1, 0], [1, 1], [0, 1]]) {
            const q = [P[0], P[1], P[2]];
            q[b] -= db;
            q[c] -= dc;
            quad.push(vid[cellId(q[0], q[1], q[2])]);
          }
          if (!(f0 > 0)) quad.reverse();
          // Each triangle is kept if its three vertices exist (as the server does)
          for (const tri of [[quad[0], quad[1], quad[2]], [quad[0], quad[2], quad[3]]]) {
            if (tri.every((v) => v >= 0)) tris.push(tri[0], tri[1], tri[2]);
          }
        }
      }
    }
  }
  return { verts, tris };
}

/**
 * The template mesh in Å (x, y, z, centered): the host's surface, or, with a
 * `level` (fraction of the maximum) and the density, the surface at that level.
 */
export function templateMesh(t: ParticleTemplate, level?: number | null): TemplateMesh {
  const d = t.density;
  if (level == null || !d) {
    return { positions: new Float32Array(t.vertices), indices: new Uint32Array(t.faces) };
  }
  const u8 = densityValues(d);
  const thr = level * 255;
  const f = new Float32Array(u8.length);
  for (let i = 0; i < u8.length; i++) f[i] = u8[i] - thr;
  const { verts, tris } = surfaceNets(f, d.shape);
  // Grid (z, y, x) -> centered Å in (x, y, z), which flips the winding
  const [s0, s1, s2] = d.shape;
  const off = [1 + (s0 - 3) / 2, 1 + (s1 - 3) / 2, 1 + (s2 - 3) / 2];
  const positions = new Float32Array(verts.length);
  for (let v = 0; v < verts.length; v += 3) {
    positions[v] = (verts[v + 2] - off[2]) * d.voxelSize;
    positions[v + 1] = (verts[v + 1] - off[1]) * d.voxelSize;
    positions[v + 2] = (verts[v] - off[0]) * d.voxelSize;
  }
  const indices = new Uint32Array(tris.length);
  for (let i = 0; i < tris.length; i += 3) {
    indices[i] = tris[i + 2];
    indices[i + 1] = tris[i + 1];
    indices[i + 2] = tris[i];
  }
  return { positions, indices };
}
