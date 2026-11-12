// src/components/viewers/volume/IsoSurfaceScene.ts
//
// The "3D volume" tab of VolumeViewer: the density as an iso-surface (as
// ChimeraX or Mol* show maps), ray-cast on the GPU from a 3D texture of the
// binned grid, so changing the threshold, opacity or color needs no new mesh.
// Each ray finds where the density crosses the threshold (refined by
// bisection), shades it with the density gradient as normal and, when the
// surface is transparent, also blends the surfaces behind. Where the enclosed
// density touches the box, the box face caps it. Renders on demand, with
// longer steps while the view moves.
// An optional mask is drawn over it, translucent: a sphere (mesh) or another
// map (ray-cast as the density, only its front surface, so it does not hide
// the map behind it).
// The surface may be colored by another map on the same box, as ChimeraX's
// "color sample" does: a local resolution map, sampled (trilinear) where each
// ray hits the surface and colored with RESOLUTION_PALETTE over a range
// (below it: the first color; above it, outside the map or no value: gray).
// The world is the voxel space of the full volume with y flipped.
import * as THREE from "three";
import { Trackball } from "./trackball";
import { densityValues } from "./densityGrid";
import { RESOLUTION_PALETTE, resolutionValidLevels, type Vec3, type VolumeDensity } from "./volumeMath";

/** Mask drawn over the density: a sphere (voxels) or another map. */
export type IsoMask =
  | { type: "sphere"; center: Vec3; diameter: number }
  | { type: "map"; density: VolumeDensity; threshold: number };

export type MaskStyle = {
  show: boolean;
  /** CSS hex. */
  color: string;
  /** 0-1. */
  opacity: number;
};

export type IsoState = {
  /** Threshold in the units of the map. */
  threshold: number;
  /** Enclose the values below the threshold (dark density). */
  below: boolean;
  /** 0-1. */
  opacity: number;
  /** CSS hex. */
  color: string;
  /** Grid filters, applied by IsoSurfaceView (setValues). */
  dust: number;
  /** Drags move the view (pan tool). */
  pan: boolean;
};

const VERTEX = [
  "varying vec3 vP;",
  "void main() { vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }",
].join("\n");

const FRAGMENT = [
  "precision highp float; precision highp sampler3D;",
  "uniform sampler3D uTex, uRes;",
  "uniform vec3 uCam, uSize, uColor, uLight, uTexel, uResSize;",
  "uniform float uThr, uSign, uOpacity, uStep, uFirst, uColorBy, uResMin, uResMax, uNear;",
  "uniform vec2 uResRange;",
  "uniform vec3 uPal[5];",
  "uniform mat4 uMVP;",
  "varying vec3 vP;",
  "",
  "float val(vec3 p) {",
  "  return uSign * (texture(uTex, vec3(p.x / uSize.x + 0.5, 0.5 - p.y / uSize.y, p.z / uSize.z + 0.5)).r - uThr);",
  "}",
  "",
  "// The surface color: uColor, or the palette color of the resolution map",
  "vec3 surfColor(vec3 p) {",
  "  if (uColorBy < 0.5) return uColor;",
  "  vec3 q = vec3(p.x / uResSize.x + 0.5, 0.5 - p.y / uResSize.y, p.z / uResSize.z + 0.5);",
  "  if (any(lessThan(q, vec3(0.0))) || any(greaterThan(q, vec3(1.0)))) return vec3(0.5);",
  "  float r = texture(uRes, q).r;",
  "  // No value (<= 0, or the fill outside the mask, also blended at its",
  "  // edge) or above the max of the scale: gray",
  "  if (r < uResMin || r > uResMax) return vec3(0.5);",
  "  float t = clamp((r - uResRange.x) / max(uResRange.y - uResRange.x, 1e-6), 0.0, 1.0) * 4.0;",
  "  int i = int(min(floor(t), 3.0));",
  "  return mix(uPal[i], uPal[i + 1], t - float(i));",
  "}",
  "",
  "vec3 shade(vec3 p, vec3 n, vec3 dir) {",
  "  if (dot(n, dir) > 0.0) n = -n;",
  "  float diff = max(dot(n, uLight), 0.0);",
  "  float spec = pow(max(dot(n, normalize(uLight - dir)), 0.0), 48.0);",
  "  return surfColor(p) * (0.28 + 0.72 * diff) + vec3(0.22 * spec);",
  "}",
  "",
  "void main() {",
  "  vec3 dir = normalize(vP - uCam);",
  "  vec3 hs = uSize * 0.5, inv = 1.0 / dir;",
  "  vec3 t1 = (-hs - uCam) * inv, t2 = (hs - uCam) * inv;",
  "  vec3 tn = min(t1, t2), tf = max(t1, t2);",
  "  float t0 = max(max(max(tn.x, tn.y), tn.z), 0.0);",
  "  float tEnd = min(min(tf.x, tf.y), tf.z);",
  "  if (tEnd <= t0) discard;",
  "  // Box face entered first: the cap normal",
  "  vec3 capN = -sign(dir) * step(vec3(max(max(tn.x, tn.y), tn.z) - 1e-4), tn);",
  "  vec3 col = vec3(0.0);",
  "  float a = 0.0, depth = -1.0;",
  "  float prev = val(uCam + dir * t0);",
  "  if (prev > 0.0) {",
  "    // Starts inside the enclosed density: capped by the box face",
  "    vec3 p = uCam + dir * t0;",
  "    vec3 n = t0 > 0.0 ? capN : -dir;",
  "    col += (1.0 - a) * uOpacity * shade(p, n, dir);",
  "    a += (1.0 - a) * uOpacity;",
  "    vec4 c = uMVP * vec4(p, 1.0); depth = c.z / c.w;",
  "  }",
  "  // The same start for every pixel (no random jitter: neighbouring rays",
  "  // sample alike, so grazing edges do not hit or miss at random)",
  "  float t = t0 + 0.5 * uStep;",
  "  for (int i = 0; i < 8192; i++) {",
  "    if (t > tEnd || a > 0.98) break;",
  "    float v = val(uCam + dir * t);",
  "    // The segment's end inside: entering between t - uStep and t",
  "    float tIn = v > 0.0 && prev <= 0.0 ? t : -1.0;",
  "    float lo = max(t - uStep, t0);",
  "    if (tIn < 0.0 && prev <= 0.0 && max(prev, v) > -uNear) {",
  "      // Both ends outside but near the threshold: a thin feature or a",
  "      // grazing edge may cross between them, sample inside the segment",
  "      for (int s = 1; s < 4; s++) {",
  "        float ts = t - uStep + uStep * float(s) * 0.25;",
  "        if (ts > t0 && val(uCam + dir * ts) > 0.0) { tIn = ts; lo = max(ts - 0.25 * uStep, t0); break; }",
  "      }",
  "    }",
  "    if (tIn > 0.0) {",
  "      // Entering: refine the crossing between lo and tIn",
  "      float hi = tIn;",
  "      for (int k = 0; k < 8; k++) {",
  "        float mid = 0.5 * (lo + hi);",
  "        if (val(uCam + dir * mid) > 0.0) hi = mid; else lo = mid;",
  "      }",
  "      vec3 p = uCam + dir * hi;",
  "      vec3 g = vec3(",
  "        val(p + vec3(uTexel.x, 0.0, 0.0)) - val(p - vec3(uTexel.x, 0.0, 0.0)),",
  "        val(p + vec3(0.0, uTexel.y, 0.0)) - val(p - vec3(0.0, uTexel.y, 0.0)),",
  "        val(p + vec3(0.0, 0.0, uTexel.z)) - val(p - vec3(0.0, 0.0, uTexel.z)));",
  "      vec3 n = length(g) > 1e-6 ? -normalize(g) : -dir;",
  "      col += (1.0 - a) * uOpacity * shade(p, n, dir);",
  "      a += (1.0 - a) * uOpacity;",
  "      if (depth < -0.5) { vec4 c = uMVP * vec4(p, 1.0); depth = c.z / c.w; }",
  "      if (uFirst > 0.5) break;",
  "    }",
  "    prev = v;",
  "    t += uStep;",
  "  }",
  "  if (a <= 0.0) discard;",
  "  gl_FragDepth = depth * 0.5 + 0.5;",
  "  gl_FragColor = vec4(col / a, a);",
  "}",
].join("\n");

// Sphere mask: shaded as the surface (headlight + key light, view space)
const SPHERE_VERTEX = [
  "varying vec3 vN, vV;",
  "void main() {",
  "  vec4 mv = modelViewMatrix * vec4(position, 1.0);",
  "  vN = normalize(normalMatrix * normal); vV = -mv.xyz;",
  "  gl_Position = projectionMatrix * mv;",
  "}",
].join("\n");

const SPHERE_FRAGMENT = [
  "uniform vec3 uColor; uniform float uOpacity;",
  "varying vec3 vN, vV;",
  "void main() {",
  "  vec3 n = normalize(vN), v = normalize(vV), l = normalize(vec3(-0.35, 0.45, 1.0));",
  "  float diff = max(dot(n, l), 0.0);",
  "  float spec = pow(max(dot(n, normalize(l + v)), 0.0), 48.0);",
  "  gl_FragColor = vec4(uColor * (0.28 + 0.72 * diff) + vec3(0.22 * spec), uOpacity);",
  "}",
].join("\n");

type RayMesh = THREE.Mesh<THREE.BoxGeometry, THREE.ShaderMaterial>;

/** Pixels per CSS pixel while the view moves (ray casting costs per pixel). */
const movingPixelRatio = () => Math.min(window.devicePixelRatio || 1, 1.5);
/** Pixels per CSS pixel of the still view: 2 (supersampled on a standard
 * screen, the native density of a high-DPI one). */
const stillPixelRatio = () => 2;

/** Ray step in grid voxels: still view, and while the view moves. */
const FINE_STEP = 0.25;
const COARSE_STEP = 0.75;

export { RESOLUTION_PALETTE };

/** Coloring of the surface by a resolution map on the same box. */
export type IsoColorBy = {
  density: VolumeDensity;
  /** Range in map units: the palette ends. */
  range: [number, number];
};

/** A 3D texture of a grid (uint8, linear filtering). */
function gridTexture(values: Uint8Array, nx: number, ny: number, nz: number): THREE.Data3DTexture {
  const tex = new THREE.Data3DTexture(values, nx, ny, nz);
  tex.format = THREE.RedFormat;
  tex.type = THREE.UnsignedByteType;
  tex.minFilter = tex.magFilter = THREE.LinearFilter;
  tex.unpackAlignment = 1;
  tex.needsUpdate = true;
  return tex;
}

/** Bound to uRes while the surface is not colored by a map. */
const EMPTY_RES = () => gridTexture(new Uint8Array(1), 1, 1, 1);

/** A box ray-cast with the iso-surface shader, over the grid of `d`. */
function rayMesh(d: VolumeDensity, values: Uint8Array, color: string): RayMesh {
  const [nz, ny, nx] = d.shape;
  const f = d.binning || 1;
  const tex = gridTexture(values, nx, ny, nz);
  // The grid covers whole blocks: it may pass the volume by < f voxels
  const size = new THREE.Vector3(nx * f, ny * f, nz * f);
  const mat = new THREE.ShaderMaterial({
    transparent: true,
    side: THREE.BackSide,
    uniforms: {
      uTex: { value: tex },
      uCam: { value: new THREE.Vector3() },
      uSize: { value: size },
      uTexel: { value: new THREE.Vector3(f, f, f) },
      uColor: { value: rgb(color) },
      uLight: { value: new THREE.Vector3(0, 0, 1) },
      uThr: { value: 0.5 },
      uSign: { value: 1 },
      uOpacity: { value: 1 },
      uStep: { value: f * FINE_STEP },
      uFirst: { value: 0 },
      // Distance to the threshold (0-1 of the grid) of the samples whose
      // segment is sampled inside (thin features, grazing edges)
      uNear: { value: 8 / 255 },
      uMVP: { value: new THREE.Matrix4() },
      uRes: { value: EMPTY_RES() },
      uResSize: { value: size.clone() },
      uColorBy: { value: 0 },
      uResMin: { value: 0 },
      uResMax: { value: 1 },
      uResRange: { value: new THREE.Vector2(0, 1) },
      uPal: { value: RESOLUTION_PALETTE.map(rgb) },
    },
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
  });
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(size.x, size.y, size.z), mat);
  mesh.position.set(size.x / 2, -size.y / 2, size.z / 2);
  mesh.frustumCulled = false;
  return mesh;
}

function disposeMesh(mesh: THREE.Mesh) {
  const mat = mesh.material as THREE.ShaderMaterial;
  (mat.uniforms?.uTex?.value as THREE.Texture | undefined)?.dispose();
  (mat.uniforms?.uRes?.value as THREE.Texture | undefined)?.dispose();
  mat.dispose();
  mesh.geometry.dispose();
}

/** Threshold in map units -> the 0-1 of the uint8 grid. */
const level = (d: VolumeDensity, thr: number) => {
  const [v0, v1] = d.valueRange;
  return (thr - v0) / (v1 - v0 || 1);
};

/** Share of the canvas taken by what is framed (fit). */
const FIT_MARGIN = 0.92;

/** World bounds (x, -y, z) of the grid voxels inside the surface at the
 * level (0-1 of the grid), or null when there are none. */
function gridBounds(d: VolumeDensity, values: Uint8Array, lvl: number, below: boolean): THREE.Box3 | null {
  const [nz, ny, nx] = d.shape;
  const f = d.binning || 1;
  const t = lvl * 255;
  let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -1, y1 = -1, z1 = -1;
  for (let z = 0, i = 0; z < nz; z++) {
    for (let y = 0; y < ny; y++) {
      for (let x = 0; x < nx; x++, i++) {
        const v = values[i];
        if (below ? v >= t : v <= t) continue;
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
        if (z < z0) z0 = z;
        if (z > z1) z1 = z;
      }
    }
  }
  if (x1 < 0) return null;
  return new THREE.Box3(new THREE.Vector3(x0 * f, -(y1 + 1) * f, z0 * f),
                        new THREE.Vector3((x1 + 1) * f, -y0 * f, (z1 + 1) * f));
}

function rgb(hex: string): THREE.Vector3 {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  const n = m ? parseInt(m[1], 16) : 0xb2b2ff;
  return new THREE.Vector3(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
}

export class IsoSurfaceScene {
  readonly canvas: HTMLCanvasElement;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera: THREE.PerspectiveCamera;
  private readonly ball: Trackball;
  private readonly dim: Vec3;
  private mesh: RayMesh | null = null;
  private density: VolumeDensity | null = null;
  /** The grid values given to the GPU (without dust). */
  private values: Uint8Array | null = null;
  /** The user moved the view since it was framed (fit). */
  touched = false;
  private state: IsoState;
  private mask: IsoMask | null = null;
  private maskMesh: THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial> | null = null;
  private maskStyle: MaskStyle = { show: false, color: "#5fd38d", opacity: 0.3 };
  private colorBy: IsoColorBy | null = null;
  private raf = 0;
  private fineTimer = 0;
  private coarse = false;
  private disposed = false;

  /** Throws when WebGL 2 is not available. */
  constructor(dim: Vec3, state: IsoState, width: number, height: number) {
    this.dim = dim;
    this.state = state;
    const m = Math.max(dim.x, dim.y, dim.z);
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    if (!this.renderer.capabilities.isWebGL2) {
      this.renderer.dispose();
      throw new Error("WebGL 2 is needed for the 3D volume.");
    }
    // Ray casting costs per pixel: no more than 1.5 pixels per CSS pixel
    // while the view moves; supersampled when it stops (see render)
    this.renderer.setPixelRatio(movingPixelRatio());
    this.renderer.setSize(width, height);
    this.renderer.setClearColor(0x111418);
    this.canvas = this.renderer.domElement;
    this.camera = new THREE.PerspectiveCamera(40, width / height, 1, 100 * m);
    this.ball = new Trackball(this.canvas, {
      onChange: () => {
        this.touched = true;
        this.moved();
      },
      isPan: () => this.state.pan,
      maxRadius: 50 * m,
    });

    const box = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.BoxGeometry(dim.x, dim.y, dim.z)),
      new THREE.LineBasicMaterial({ color: 0x8a94a0 }),
    );
    box.position.set(dim.x / 2, -dim.y / 2, dim.z / 2);
    // Drawn first: the surface depth then hides only the lines behind it
    box.renderOrder = 0;
    this.scene.add(box);
    this.reset();
  }

  /** New values of the same grid (e.g. without dust). */
  setValues(values: Uint8Array) {
    this.values = values;
    if (!this.mesh) return;
    const tex = this.mesh.material.uniforms.uTex.value as THREE.Data3DTexture;
    (tex.image as unknown as { data: Uint8Array }).data = values;
    tex.needsUpdate = true;
    this.render();
  }

  /** The grid of the surface (replaces the previous one); prepareDensity first. */
  setDensity(d: VolumeDensity, values = densityValues(d)) {
    if (this.disposed) return;
    this.removeMesh();
    this.density = d;
    this.values = values;
    const mesh = rayMesh(d, values, this.state.color);
    mesh.renderOrder = 1;
    this.scene.add(mesh);
    this.mesh = mesh;
    this.syncColorBy(true);
    this.sync();
  }

  /** Color the surface by a map on the same box (e.g. local resolution),
   * decoded first (prepareDensity); null: the plain color. */
  setColorBy(colorBy: IsoColorBy | null) {
    const changed = colorBy?.density !== this.colorBy?.density;
    this.colorBy = colorBy;
    this.syncColorBy(changed);
    this.render();
  }

  /** The texture (when the map changed or the mesh is new) and the range. */
  private syncColorBy(newTexture: boolean) {
    if (!this.mesh) return;
    const u = this.mesh.material.uniforms;
    const c = this.colorBy;
    if (newTexture) {
      (u.uRes.value as THREE.Texture).dispose();
      if (c) {
        const [nz, ny, nx] = c.density.shape;
        const f = c.density.binning || 1;
        u.uRes.value = gridTexture(densityValues(c.density), nx, ny, nz);
        u.uResSize.value = new THREE.Vector3(nx * f, ny * f, nz * f);
      } else {
        u.uRes.value = EMPTY_RES();
      }
    }
    u.uColorBy.value = c ? 1 : 0;
    if (c) {
      const lvl = (v: number) => level(c.density, v);
      u.uResRange.value.set(lvl(c.range[0]), lvl(c.range[1]));
      // Levels without a value: <= 0, or the fill value outside the mask
      const [k0, k1] = resolutionValidLevels(c.density, densityValues(c.density));
      u.uResMin.value = (k0 - 0.5) / 255;
      // Above the max of the range (or the last valid level): gray
      u.uResMax.value = Math.min((k1 + 0.5) / 255, lvl(c.range[1]) + 0.5 / 255);
    }
  }

  /** The mask (replaces the previous one); null removes it. A map mask must
   * be decoded first (prepareDensity). */
  setMask(mask: IsoMask | null) {
    if (this.disposed) return;
    this.removeMask();
    this.mask = mask;
    if (mask?.type === "sphere") {
      const mat = new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        uniforms: { uColor: { value: rgb(this.maskStyle.color) }, uOpacity: { value: this.maskStyle.opacity } },
        vertexShader: SPHERE_VERTEX,
        fragmentShader: SPHERE_FRAGMENT,
      });
      const sphere = new THREE.Mesh(new THREE.SphereGeometry(Math.max(mask.diameter / 2, 0.5), 64, 32), mat);
      sphere.position.set(mask.center.x, -mask.center.y, mask.center.z);
      this.maskMesh = sphere;
    } else if (mask?.type === "map") {
      const m = rayMesh(mask.density, densityValues(mask.density), this.maskStyle.color);
      m.material.uniforms.uFirst.value = 1;
      m.material.uniforms.uThr.value = level(mask.density, mask.threshold);
      m.material.depthWrite = false;
      this.maskMesh = m as unknown as THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>;
    }
    if (this.maskMesh) {
      // After the density: its depth hides the mask behind the surface
      this.maskMesh.renderOrder = 2;
      this.scene.add(this.maskMesh);
    }
    this.syncMask();
  }

  setMaskStyle(style: MaskStyle) {
    this.maskStyle = style;
    this.syncMask();
  }

  setState(state: IsoState) {
    this.state = state;
    this.sync();
  }

  resize(width: number, height: number) {
    this.renderer.setSize(width, height);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.render();
  }

  /** The oblique view, framing what is drawn (see fit). */
  reset() {
    this.fit();
  }

  /**
   * The oblique view centred on what is drawn: the voxels inside the surface
   * at the threshold and the shown mask (the whole box without them), at the
   * distance that makes it as large as fits the canvas, both in width and
   * height (FIT_MARGIN).
   */
  fit() {
    const { x, y, z } = this.dim;
    const whole = new THREE.Box3(new THREE.Vector3(0, -y, 0), new THREE.Vector3(x, 0, z));
    let content: THREE.Box3 | null = null;
    if (this.density && this.values) {
      content = gridBounds(this.density, this.values, level(this.density, this.state.threshold), this.state.below);
    }
    const mask = this.maskStyle.show ? this.maskBounds() : null;
    if (mask) content = content ? content.union(mask) : mask;
    const box = content ? content.intersect(whole) : whole;
    if (box.isEmpty()) box.copy(whole);

    const center = box.getCenter(new THREE.Vector3());
    this.ball.reset(center, 1);
    const q = this.ball.quat;
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(q);
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(q);
    const back = new THREE.Vector3(0, 0, 1).applyQuaternion(q);
    const tanV = Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2)) * FIT_MARGIN;
    const tanH = tanV * this.camera.aspect;
    // The nearest camera (along `back`) that sees every corner of the box
    let dist = 0;
    for (const cx of [box.min.x, box.max.x]) {
      for (const cy of [box.min.y, box.max.y]) {
        for (const cz of [box.min.z, box.max.z]) {
          const c = new THREE.Vector3(cx, cy, cz).sub(center);
          const depth = c.dot(back);
          dist = Math.max(dist, depth + Math.abs(c.dot(right)) / tanH, depth + Math.abs(c.dot(up)) / tanV);
        }
      }
    }
    this.ball.radius = Math.max(dist, 2);
    this.touched = false;
    this.render();
  }

  /** World bounds of the mask, or null. */
  private maskBounds(): THREE.Box3 | null {
    const m = this.mask;
    if (m?.type === "sphere") {
      const r = m.diameter / 2;
      const c = new THREE.Vector3(m.center.x, -m.center.y, m.center.z);
      return new THREE.Box3(c.clone().subScalar(r), c.clone().addScalar(r));
    }
    if (m?.type === "map") return gridBounds(m.density, densityValues(m.density), level(m.density, m.threshold), false);
    return null;
  }

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    clearTimeout(this.fineTimer);
    this.removeMesh();
    this.removeMask();
    this.scene.traverse((obj) => {
      const o = obj as THREE.Mesh;
      o.geometry?.dispose?.();
      (o.material as THREE.Material | undefined)?.dispose?.();
    });
    this.renderer.dispose();
  }

  private removeMesh() {
    if (!this.mesh) return;
    this.scene.remove(this.mesh);
    disposeMesh(this.mesh);
    this.mesh = null;
  }

  private removeMask() {
    if (!this.maskMesh) return;
    this.scene.remove(this.maskMesh);
    disposeMesh(this.maskMesh);
    this.maskMesh = null;
  }

  private syncMask() {
    if (this.maskMesh) {
      const u = this.maskMesh.material.uniforms;
      u.uColor.value = rgb(this.maskStyle.color);
      u.uOpacity.value = this.maskStyle.opacity;
      this.maskMesh.visible = this.maskStyle.show;
    }
    this.render();
  }

  private sync() {
    const d = this.density;
    if (this.mesh && d) {
      const u = this.mesh.material.uniforms;
      u.uThr.value = level(d, this.state.threshold);
      u.uSign.value = this.state.below ? -1 : 1;
      u.uOpacity.value = this.state.opacity;
      u.uColor.value = rgb(this.state.color);
    }
    this.render();
  }

  /** The view moves: long steps now, the fine image once it stops. */
  private moved() {
    this.coarse = true;
    clearTimeout(this.fineTimer);
    this.fineTimer = window.setTimeout(() => {
      this.coarse = false;
      this.render();
    }, 160);
    this.render();
  }

  private render() {
    if (this.raf || this.disposed) return;
    this.raf = requestAnimationFrame(() => {
      this.raf = 0;
      if (this.disposed) return;
      // The still view supersampled: the surface edges are decided per
      // pixel by the shader (no MSAA on them), more samples smooth them
      const ratio = this.coarse || this.ball.dragging ? movingPixelRatio() : stillPixelRatio();
      if (this.renderer.getPixelRatio() !== ratio) this.renderer.setPixelRatio(ratio);
      this.ball.apply(this.camera);
      this.camera.updateMatrixWorld();
      if (this.mesh && this.density) this.updateRay(this.mesh, this.density);
      if (this.maskMesh && this.mask?.type === "map") this.updateRay(this.maskMesh as RayMesh, this.mask.density);
      this.renderer.render(this.scene, this.camera);
    });
  }

  /** Camera, light, step and projection of a ray-cast box. */
  private updateRay(mesh: RayMesh, d: VolumeDensity) {
    const u = mesh.material.uniforms;
    const f = d.binning || 1;
    // Local box space (the mesh is only translated)
    u.uCam.value.copy(mesh.worldToLocal(this.camera.position.clone()));
    // Key light above-left of the camera
    u.uLight.value.set(-0.35, 0.45, 1).normalize().applyQuaternion(this.camera.quaternion);
    u.uStep.value = f * (this.coarse || this.ball.dragging ? COARSE_STEP : FINE_STEP);
    mesh.updateMatrixWorld();
    u.uMVP.value
      .copy(this.camera.projectionMatrix)
      .multiply(this.camera.matrixWorldInverse)
      .multiply(mesh.matrixWorld);
  }
}
