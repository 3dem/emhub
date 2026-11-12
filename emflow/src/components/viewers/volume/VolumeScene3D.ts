// src/components/viewers/volume/VolumeScene3D.ts
//
// The 3D tab of VolumeViewer: three orthogonal planes textured with the
// current slices (at most two shown), the volume box, picked particles
// (points, spheres with an arrow along their orientation, or the template
// surface at each particle) and an optional ray-marched volume (its densest
// voxels, from the binned density grid when the host sends one).
// Renders on demand (no animation loop).
// The world is the voxel space with y flipped (three.js y goes up).
import * as THREE from "three";
import { templateMesh, type ParticleTemplate } from "./templateSurface";
import { Trackball } from "./trackball";
import { densityValues, gaussianImage, removeDust, smoothGrid } from "./densityGrid";
import {
  AXES,
  clampVox,
  imageSize,
  nearest,
  particleRotation,
  sectionSize,
  type Axis,
  type SliceImage,
  type Vec3,
  type VolumeCoordinates,
  type VolumeDensity,
  type VoxelSize,
} from "./volumeMath";

/** How the particles are drawn in 3D. */
export type ParticleDraw = "dots" | "sphere" | "template";

export type SceneState = {
  pos: Vec3;
  partsOn: boolean;
  drawAs: ParticleDraw;
  /** Sphere radius, voxels. */
  sphereRadius: number;
  /** Only the particles within `tolerance` voxels of a shown plane. */
  nearOnly: boolean;
  tolerance: number;
  /** Template threshold (fraction of its maximum), null: the host's surface. */
  templateLevel: number | null;
  /** Color of the points and the template (CSS hex). */
  particleColor: string;
  volOn: boolean;
  inverted: boolean;
  /** Shown planes (at most two). */
  active: Axis[];
  volOpacity: number;
  /** Volume: share of the voxels drawn (0-1), the darkest or the brightest. */
  volShare: number;
  volDark: boolean;
  /** Volume: only within volTolerance voxels of the shown planes. */
  volNear: boolean;
  volTolerance: number;
  /** Denoise of the plane images: Gaussian sigma in voxels (0: none). */
  filterSigma: number;
  /** Active tool: "pan" drags move the volume; "select" clicks pick. */
  mode: string | null;
};

export type SceneOptions = {
  dim: Vec3;
  keys: Record<Axis, number[]>;
  particles: VolumeCoordinates | null;
  voxelSize: VoxelSize | null;
  /** The decoded slice image, or null while it loads (then onImage is called). */
  getImage: (a: Axis, key: number) => SliceImage | null;
  loadImage: (a: Axis, key: number) => Promise<SliceImage>;
  onPickParticle: (index: number) => void;
  onPickPoint: (p: Vec3) => void;
  /** The volume is drawn from a density grid (setDensity), not from the
   * Z slice images. */
  density?: boolean;
};

const toWorld = (x: number, y: number, z: number) => new THREE.Vector3(x, -y, z);

/** One geometry of two indexed geometries (positions and normals). */
function mergeGeometries(a: THREE.BufferGeometry, b: THREE.BufferGeometry): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  for (const name of ["position", "normal"]) {
    const x = a.getAttribute(name).array as Float32Array, y = b.getAttribute(name).array as Float32Array;
    const arr = new Float32Array(x.length + y.length);
    arr.set(x);
    arr.set(y, x.length);
    g.setAttribute(name, new THREE.BufferAttribute(arr, 3));
  }
  const ia = Array.from(a.getIndex()!.array), off = a.getAttribute("position").count;
  g.setIndex([...ia, ...Array.from(b.getIndex()!.array, (i) => i + off)]);
  return g;
}

/** Color of the density drawn around the planes (gray, as the slices). */
const HAZE_COLOR = "#c8c8c8";
/** Blobs of fewer grid voxels are hidden (the noise drawn as dust). */
const HAZE_DUST = 30;

const VOLUME_VERTEX = "varying vec3 vP; void main() { vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }";

/* The volume around the planes: the Z sections, or better the binned density
   grid (block means, much less noisy), in a 3D texture. Only the density
   beyond a threshold (the darkest or brightest share of the voxels) is drawn,
   shaded by its gradient, so the noise does not fill the box with a gray fog.
   The opacity is per length (uRef: full-weight density this deep reaches
   uOp), not per step, so it does not depend on the ray length nor on the
   sampling. Each ray stops at the first shown plane: the planes are opaque. */
const VOLUME_FRAGMENT = [
  "precision highp float; precision highp sampler3D;",
  "uniform sampler3D uTex;",
  "uniform vec3 uCam, uSize, uTexel, uPlane, uCut, uColor, uLight;",
  "uniform float uOp, uThr, uSoft, uSign, uStep, uRef, uTol;",
  "varying vec3 vP;",
  "float tex(vec3 p) { return texture(uTex, vec3(p.x / uSize.x + 0.5, 0.5 - p.y / uSize.y, p.z / uSize.z + 0.5)).r; }",
  "float weight(float v) { return clamp(uSign * (uThr - v) / uSoft, 0.0, 1.0); }",
  "void main() {",
  "  vec3 dir = normalize(vP - uCam);",
  "  vec3 hs = uSize * 0.5, inv = 1.0 / dir;",
  "  vec3 t1 = (-hs - vP) * inv, t2 = (hs - vP) * inv;",
  "  float tEnd = min(min(max(t1.x, t2.x), max(t1.y, t2.y)), max(t1.z, t2.z));",
  "  // The shown planes hide what is behind them",
  "  vec3 tp = (uPlane - vP) * inv;",
  "  if (uCut.x > 0.5 && tp.x > 0.0) tEnd = min(tEnd, tp.x);",
  "  if (uCut.y > 0.5 && tp.y > 0.0) tEnd = min(tEnd, tp.y);",
  "  if (uCut.z > 0.5 && tp.z > 0.0) tEnd = min(tEnd, tp.z);",
  "  float jit = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453);",
  "  float k = uStep / uRef;",
  "  vec3 col = vec3(0.0); float a = 0.0;",
  "  float t = uStep * jit;",
  "  for (int i = 0; i < 2048; i++) {",
  "    if (t > tEnd || a > 0.98) break;",
  "    vec3 p = vP + dir * t;",
  "    // Only near the shown planes (uTol >= 0: the distance, voxels)",
  "    vec3 dp = abs(p - uPlane) + (1.0 - uCut) * 1e9;",
  "    float w = uTol >= 0.0 && min(min(dp.x, dp.y), dp.z) > uTol ? 0.0 : weight(tex(p));",
  "    if (w > 0.0) {",
  "      vec3 g = vec3(",
  "        tex(p + vec3(uTexel.x, 0.0, 0.0)) - tex(p - vec3(uTexel.x, 0.0, 0.0)),",
  "        tex(p + vec3(0.0, uTexel.y, 0.0)) - tex(p - vec3(0.0, uTexel.y, 0.0)),",
  "        tex(p + vec3(0.0, 0.0, uTexel.z)) - tex(p - vec3(0.0, 0.0, uTexel.z)));",
  "      vec3 n = length(g) > 1e-6 ? normalize(g) : -dir;",
  "      if (dot(n, dir) > 0.0) n = -n;",
  "      vec3 c = uColor * (0.35 + 0.65 * max(dot(n, uLight), 0.0));",
  "      float s = 1.0 - pow(max(1.0 - uOp * w, 0.0), k);",
  "      col += (1.0 - a) * s * c;",
  "      a += (1.0 - a) * s;",
  "    }",
  "    t += uStep;",
  "  }",
  "  if (a <= 0.0) discard;",
  "  gl_FragColor = vec4(col / a, a);",
  "}",
].join("\n");

export class VolumeScene3D {
  readonly canvas: HTMLCanvasElement;
  private readonly o: SceneOptions;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera: THREE.PerspectiveCamera;
  private readonly planes = {} as Record<Axis, THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>>;
  private readonly tex = new Map<string, THREE.Texture>();
  private readonly pending = new Set<string>();
  private readonly ray = new THREE.Raycaster();
  private readonly ball: Trackball;
  private points: THREE.Points | null = null;
  private tmpl: THREE.InstancedMesh | null = null;
  /** Spheres and, with angles, arrows along each particle's Z axis. */
  private spheres: THREE.InstancedMesh | null = null;
  private arrows: THREE.InstancedMesh | null = null;
  /** Unit Z axis of each particle in the world (null without angles). */
  private dirs: THREE.Vector3[] | null = null;
  private drawnKey = "";
  private tmplMatrices: THREE.Matrix4[] = [];
  private tmplLevel: number | null = null;
  /** Indices of the particles shown (all, or near the shown planes). */
  private shown: number[] = [];
  private vol: THREE.Mesh<THREE.BoxGeometry, THREE.ShaderMaterial> | null = null;
  private volLoading = false;
  private grid: VolumeDensity | null = null;
  /** Invert and denoise setting whose plane images are the only ones kept. */
  private texDropped = "";
  /** Cumulative histogram of the volume's grid values. */
  private cumul: Float64Array | null = null;
  /** The volume's smoothed grid, and the threshold its dust was hidden at. */
  private base: Uint8Array | null = null;
  private dustKey = "";
  private raf = 0;
  private syncQueued = false;
  private disposed = false;
  private state: SceneState;

  /** Throws when WebGL is not available. */
  constructor(options: SceneOptions, state: SceneState, width: number, height: number) {
    this.o = options;
    this.state = state;
    const { x: X, y: Y, z: Z } = options.dim;
    const m = Math.max(X, Y, Z);

    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(window.devicePixelRatio || 1);
    this.renderer.setSize(width, height);
    this.renderer.setClearColor(0x111418);
    this.canvas = this.renderer.domElement;
    this.camera = new THREE.PerspectiveCamera(40, width / height, 1, 100 * m);
    this.ball = new Trackball(this.canvas, {
      onChange: () => this.render(),
      onClick: (e) => this.onClick(e),
      isPan: () => this.state.mode === "pan",
      maxRadius: 50 * m,
    });

    const geo: Record<Axis, THREE.PlaneGeometry> = {
      z: new THREE.PlaneGeometry(X, Y),
      y: new THREE.PlaneGeometry(X, Z),
      x: new THREE.PlaneGeometry(Z, Y),
    };
    for (const a of AXES) {
      // Opaque planes; the volume is drawn after them and its rays stop at them
      const mesh = new THREE.Mesh(
        geo[a],
        new THREE.MeshBasicMaterial({ side: THREE.DoubleSide, transparent: true, opacity: 1 }),
      );
      mesh.renderOrder = 1;
      if (a === "y") mesh.rotation.x = -Math.PI / 2;
      if (a === "x") mesh.rotation.y = -Math.PI / 2;
      this.planes[a] = mesh;
      this.scene.add(mesh);
    }
    const box = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.BoxGeometry(X, Y, Z)),
      new THREE.LineBasicMaterial({ color: 0x8a94a0 }),
    );
    box.position.set(X / 2, -Y / 2, Z / 2);
    this.scene.add(box);

    const P = options.particles;
    if (P) {
      const n = P.x.length;
      const arr = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) {
        arr[3 * i] = P.x[i] + 0.5;
        arr[3 * i + 1] = -(P.y[i] + 0.5);
        arr[3 * i + 2] = P.z[i] + 0.5;
      }
      const pg = new THREE.BufferGeometry();
      pg.setAttribute("position", new THREE.BufferAttribute(arr, 3));
      this.points = new THREE.Points(
        pg,
        new THREE.PointsMaterial({ color: state.particleColor, size: 3.5, sizeAttenuation: false }),
      );
      this.scene.add(this.points);
      this.scene.add(new THREE.AmbientLight(0xffffff, 0.7));
      const sun = new THREE.DirectionalLight(0xffffff, 0.8);
      sun.position.set(1, 1, 2);
      this.scene.add(sun);
      if (P.template?.faces?.length && options.voxelSize?.x) this.buildTemplate(P, state.templateLevel);
      this.buildSpheres(P);
    }

    this.reset();
    this.sync();
  }

  /** True when a picking template can be drawn. */
  get hasTemplate() {
    return this.tmpl !== null;
  }

  setState(state: SceneState) {
    this.state = state;
    this.sync();
  }

  resize(width: number, height: number) {
    this.renderer.setSize(width, height);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.render();
  }

  /** Back to the initial oblique view. */
  reset() {
    const { x: X, y: Y, z: Z } = this.o.dim;
    // Start from an oblique view; from here the rotation is unrestricted
    this.ball.reset(new THREE.Vector3(X / 2, -Y / 2, Z / 2), 2.3 * Math.max(X, Y, Z));
    this.render();
  }

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.tex.forEach((t) => t.dispose());
    this.tex.clear();
    this.vol?.material.uniforms.uTex.value?.dispose?.();
    this.scene.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      mesh.geometry?.dispose?.();
      const mat = mesh.material as THREE.Material | THREE.Material[] | undefined;
      if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
      else mat?.dispose?.();
    });
    this.renderer.dispose();
  }

  private render() {
    if (this.raf || this.disposed) return;
    this.raf = requestAnimationFrame(() => {
      this.raf = 0;
      if (this.disposed) return;
      this.ball.apply(this.camera);
      if (this.vol) {
        this.vol.material.uniforms.uCam.value.copy(this.vol.worldToLocal(this.camera.position.clone()));
      }
      this.renderer.render(this.scene, this.camera);
    });
  }

  private texture(a: Axis, key: number): THREE.Texture | null {
    const { inverted, filterSigma } = this.state;
    const id = `${a}:${key}${this.texVariant()}`;
    const hit = this.tex.get(id);
    if (hit) return hit;
    const img = this.o.getImage(a, key);
    if (!img) {
      const pid = `${a}:${key}`;
      if (!this.pending.has(pid)) {
        this.pending.add(pid);
        this.o.loadImage(a, key).then(() => {
          this.pending.delete(pid);
          this.queueSync();
        }, () => this.pending.delete(pid));
      }
      return null;
    }
    // Denoised as the Slices tab (sigma voxels, in the image's pixels)
    let src: SliceImage = filterSigma
      ? gaussianImage(img, filterSigma * imageSize(img)[0] / sectionSize(this.o.dim)[a][0]) : img;
    if (inverted) {
      const c = document.createElement("canvas");
      [c.width, c.height] = imageSize(img);
      const g = c.getContext("2d")!;
      g.drawImage(src, 0, 0);
      g.globalCompositeOperation = "difference";
      g.fillStyle = "#fff";
      g.fillRect(0, 0, c.width, c.height);
      src = c;
    }
    const tx = new THREE.Texture(src);
    tx.colorSpace = THREE.SRGBColorSpace;
    tx.minFilter = THREE.LinearFilter;
    tx.generateMipmaps = false;
    tx.needsUpdate = true;
    this.tex.set(id, tx);
    return tx;
  }

  /** Frees the plane images of another invert or denoise setting that no
   * plane shows; done again until every plane shows the current setting. */
  private dropOtherTextures() {
    const variant = this.texVariant();
    if (variant === this.texDropped) return;
    const shown = new Set(AXES.map((a) => this.planes[a].material.map));
    for (const [id, t] of this.tex) {
      if (id.replace(/^[xyz]:\d+/, "") === variant || shown.has(t)) continue;
      t.dispose();
      this.tex.delete(id);
    }
    const done = AXES.every((a) => {
      const key = this.o.keys[a][nearest(this.o.keys[a], this.state.pos[a])];
      return this.tex.has(`${a}:${key}${variant}`);
    });
    if (done) this.texDropped = variant;
  }

  /** The part of a texture id after `axis:key`: invert and denoise. */
  private texVariant() {
    return `${this.state.inverted ? ":inv" : ""}:${this.state.filterSigma}`;
  }

  private queueSync() {
    if (this.disposed || this.syncQueued) return;
    this.syncQueued = true;
    requestAnimationFrame(() => {
      this.syncQueued = false;
      if (!this.disposed) this.sync();
    });
  }

  /** Planes, particles and volume from the current state. */
  sync() {
    if (this.disposed) return;
    const { pos, partsOn, active } = this.state;
    const tmplOn = this.state.drawAs === "template" && Boolean(this.tmpl);
    const sphereOn = this.state.drawAs === "sphere";
    const { x: X, y: Y, z: Z } = this.o.dim;
    for (const a of AXES) {
      const key = this.o.keys[a][nearest(this.o.keys[a], pos[a])];
      const m = this.planes[a];
      const c = key + 0.5;
      if (a === "z") m.position.set(X / 2, -Y / 2, c);
      else if (a === "y") m.position.set(X / 2, -c, Z / 2);
      else m.position.set(c, -Y / 2, Z / 2);
      const tx = this.texture(a, key);
      if (tx || !m.material.map) m.material.map = tx;
      m.material.color.set(m.material.map ? 0xffffff : 0x444444);
      m.material.needsUpdate = true;
      m.visible = active.includes(a);
    }
    this.dropOtherTextures();
    const P = this.o.particles;
    if (P && this.points) {
      this.updateShown(P);
      const color = this.state.particleColor;
      this.points.visible = partsOn && !tmplOn && !sphereOn;
      (this.points.material as THREE.PointsMaterial).color.set(color);
      if (this.tmpl) {
        (this.tmpl.material as THREE.MeshLambertMaterial).color.set(color);
        if (tmplOn && this.state.templateLevel !== this.tmplLevel) this.setTemplateGeometry(P, this.state.templateLevel);
        this.tmpl.visible = partsOn && tmplOn;
      }
      for (const mesh of [this.spheres, this.arrows]) {
        if (!mesh) continue;
        (mesh.material as THREE.MeshLambertMaterial).color.set(color);
        mesh.visible = partsOn && sphereOn;
      }
    }
    this.updateVolume();
    this.render();
  }

  /** Particles within `tolerance` of a shown plane (or all), as points and templates. */
  private updateShown(P: VolumeCoordinates) {
    const { nearOnly, tolerance, active, pos } = this.state;
    const n = Math.min(P.x.length, P.y.length, P.z.length);
    const shown: number[] = [];
    for (let i = 0; i < n; i++) {
      if (!nearOnly || active.some((a) => Math.abs(P[a][i] - pos[a]) <= tolerance)) shown.push(i);
    }
    this.shown = shown;
    const attr = this.points!.geometry.getAttribute("position") as THREE.BufferAttribute;
    const arr = attr.array as Float32Array;
    shown.forEach((i, k) => {
      arr[3 * k] = P.x[i] + 0.5;
      arr[3 * k + 1] = -(P.y[i] + 0.5);
      arr[3 * k + 2] = P.z[i] + 0.5;
    });
    attr.needsUpdate = true;
    this.points!.geometry.setDrawRange(0, shown.length);
    if (this.tmpl) {
      shown.forEach((i, k) => this.tmpl!.setMatrixAt(k, this.tmplMatrices[i]));
      this.tmpl.count = shown.length;
      this.tmpl.instanceMatrix.needsUpdate = true;
    }
    // Spheres (and arrows) only when drawn: their size is the radius
    const r = Math.max(0.5, this.state.sphereRadius);
    const key = this.state.drawAs === "sphere" ? `${shown.join(",")}|${r}` : "";
    if (this.spheres && key && key !== this.drawnKey) {
      const mat = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(r, r, r);
      const zAxis = new THREE.Vector3(0, 0, 1);
      shown.forEach((i, k) => {
        const w = toWorld(P.x[i] + 0.5, P.y[i] + 0.5, P.z[i] + 0.5);
        this.spheres!.setMatrixAt(k, mat.compose(w, q.identity(), sc));
        if (this.arrows && this.dirs) {
          this.arrows.setMatrixAt(k, mat.compose(w, q.setFromUnitVectors(zAxis, this.dirs[i]), sc));
        }
      });
      for (const mesh of [this.spheres, this.arrows]) {
        if (!mesh) continue;
        mesh.count = shown.length;
        mesh.instanceMatrix.needsUpdate = true;
      }
      this.drawnKey = key;
    }
  }

  /* Spheres at the particles (translucent, so the arrow shows inside) and,
     when they have angles, an arrow from the centre along each one's Z axis
     (the RELION rotation, as the template), out of the sphere. Both are
     scaled to the radius per instance. */
  private buildSpheres(P: VolumeCoordinates) {
    const n = P.x.length;
    const color = this.state.particleColor;
    this.spheres = new THREE.InstancedMesh(
      new THREE.SphereGeometry(1, 20, 14),
      new THREE.MeshLambertMaterial({ color, transparent: true, opacity: 0.45, depthWrite: false }),
      n,
    );
    this.spheres.renderOrder = 2;
    if (P.angles?.length) {
      this.dirs = [];
      for (let i = 0; i < n; i++) {
        const e = particleRotation(P.angles[i], 1);
        this.dirs.push(new THREE.Vector3(e[2], e[5], e[8]).normalize());
      }
      // Along +Z: a shaft from the centre, the head just out of the sphere
      const shaft = new THREE.CylinderGeometry(0.11, 0.11, 1.35, 8).rotateX(Math.PI / 2).translate(0, 0, 0.675);
      const head = new THREE.ConeGeometry(0.3, 0.55, 12).rotateX(Math.PI / 2).translate(0, 0, 1.625);
      this.arrows = new THREE.InstancedMesh(mergeGeometries(shaft, head), new THREE.MeshLambertMaterial({ color }), n);
      shaft.dispose();
      head.dispose();
    }
    for (const mesh of [this.spheres, this.arrows]) {
      if (!mesh) continue;
      mesh.visible = false;
      mesh.frustumCulled = false;
      mesh.count = 0;
      this.scene.add(mesh);
    }
  }

  /* One instanced mesh of the template surface (Å) scaled to voxels, rotated
     at each particle by its RELION angles. */
  private buildTemplate(P: VolumeCoordinates, level: number | null) {
    const n = P.x.length;
    const mesh = new THREE.InstancedMesh(
      new THREE.BufferGeometry(),
      new THREE.MeshLambertMaterial({ color: this.state.particleColor, side: THREE.DoubleSide }),
      n,
    );
    const k = 1 / this.o.voxelSize!.x!;
    for (let i = 0; i < n; i++) {
      const e = particleRotation(P.angles?.[i], k);
      const w = toWorld(P.x[i] + 0.5, P.y[i] + 0.5, P.z[i] + 0.5);
      this.tmplMatrices.push(new THREE.Matrix4().set(
        e[0], e[1], e[2], w.x, e[3], e[4], e[5], w.y, e[6], e[7], e[8], w.z, 0, 0, 0, 1));
    }
    mesh.visible = false;
    mesh.frustumCulled = false;
    this.scene.add(mesh);
    this.tmpl = mesh;
    this.setTemplateGeometry(P, level);
  }

  /** The template surface at `level` (the host's surface when null). */
  private setTemplateGeometry(P: VolumeCoordinates, level: number | null) {
    const { positions, indices } = templateMesh(P.template as ParticleTemplate, level);
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    g.setIndex(new THREE.BufferAttribute(indices, 1));
    g.computeVertexNormals();
    this.tmpl!.geometry.dispose();
    this.tmpl!.geometry = g;
    this.tmplLevel = level;
  }

  /** The density grid to draw the volume from (options.density): the
   * volume waits for it, and is built again when it changes. */
  setDensity(d: VolumeDensity | null) {
    if (d === this.grid) return;
    this.grid = d;
    if (this.vol) {
      this.scene.remove(this.vol);
      this.vol.material.uniforms.uTex.value?.dispose?.();
      this.vol.material.dispose();
      this.vol.geometry.dispose();
      this.vol = null;
    }
    this.sync();
  }

  /** The Z sections in a uint8 grid (z, y, x), or null while they load. */
  private sliceGrid(): { data: Uint8Array; w: number; h: number; d: number } | null {
    const zk = this.o.keys.z;
    const imgs = zk.map((k) => this.o.getImage("z", k));
    if (imgs.some((i) => !i)) {
      // Wait once for the missing images, then build
      if (!this.volLoading) {
        this.volLoading = true;
        Promise.all(zk.map((k) => this.o.loadImage("z", k))).then(
          () => {
            this.volLoading = false;
            if (!this.disposed) this.sync();
          },
          () => { this.volLoading = false; },
        );
      }
      return null;
    }
    const [w, h] = imageSize(imgs[0]!);
    const d = zk.length;
    const data = new Uint8Array(w * h * d);
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    const g = c.getContext("2d", { willReadFrequently: true })!;
    imgs.forEach((im, i) => {
      g.drawImage(im!, 0, 0, w, h);
      const px = g.getImageData(0, 0, w, h).data;
      for (let j = 0; j < w * h; j++) data[i * w * h + j] = px[4 * j];
    });
    return { data, w, h, d };
  }

  private buildVolume() {
    if (this.vol) return;
    let grid: { data: Uint8Array; w: number; h: number; d: number } | null;
    if (this.o.density) {
      if (!this.grid) return; // loaded by the host (setDensity)
      const [nz, ny, nx] = this.grid.shape;
      grid = { data: densityValues(this.grid), w: nx, h: ny, d: nz };
    } else {
      grid = this.sliceGrid();
      if (!grid) return;
    }
    const { w, h, d } = grid;
    const { x: X, y: Y, z: Z } = this.o.dim;
    // Smoothed once; the dust is hidden at each threshold (updateVolume)
    const data = smoothGrid(grid.data, [d, h, w]);
    this.base = data;
    this.dustKey = "";
    // Cumulative histogram of the grid, for the share of voxels drawn
    const counts = new Float64Array(256);
    for (let i = 0; i < data.length; i++) counts[data[i]]++;
    for (let i = 1; i < 256; i++) counts[i] += counts[i - 1];
    this.cumul = counts;
    const tex = new THREE.Data3DTexture(new Uint8Array(data), w, h, d);
    tex.format = THREE.RedFormat;
    tex.type = THREE.UnsignedByteType;
    tex.minFilter = tex.magFilter = THREE.LinearFilter;
    tex.unpackAlignment = 1;
    tex.needsUpdate = true;
    const texel = new THREE.Vector3(X / w, Y / h, Z / d);
    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      side: THREE.FrontSide,
      uniforms: {
        uTex: { value: tex },
        uCam: { value: new THREE.Vector3() },
        uSize: { value: new THREE.Vector3(X, Y, Z) },
        uTexel: { value: texel },
        uPlane: { value: new THREE.Vector3() },
        uCut: { value: new THREE.Vector3() },
        uColor: { value: new THREE.Color(HAZE_COLOR) },
        uLight: { value: new THREE.Vector3(0.35, 0.45, 1).normalize() },
        uOp: { value: this.state.volOpacity },
        uThr: { value: 0.5 },
        uSoft: { value: 0.05 },
        uSign: { value: 1 },
        // Half a grid voxel per step; full-weight density 2 voxels deep
        // reaches the opacity of the slider
        uStep: { value: 0.5 * Math.min(texel.x, texel.y, texel.z) },
        uRef: { value: 2 * Math.max(texel.x, texel.y, texel.z) },
        uTol: { value: -1 },
      },
      vertexShader: VOLUME_VERTEX,
      fragmentShader: VOLUME_FRAGMENT,
    });
    const m = new THREE.Mesh(new THREE.BoxGeometry(X, Y, Z), mat);
    m.position.set(X / 2, -Y / 2, Z / 2);
    // After the planes: it is drawn over them where it is in front
    m.renderOrder = 2;
    m.frustumCulled = false;
    this.scene.add(m);
    this.vol = m;
  }

  /** Grid value (0-1) with `share` of the voxels below it (from the top
   * with `fromTop`). */
  private level(share: number, fromTop: boolean): number {
    const c = this.cumul!, n = c[255];
    const target = (fromTop ? 1 - share : share) * n;
    let i = 0;
    while (i < 255 && c[i] < target) i++;
    return (i + 0.5) / 255;
  }

  private updateVolume() {
    const { volOn, volOpacity, volShare, volDark, volNear, volTolerance, active, pos } = this.state;
    if (volOn) this.buildVolume();
    if (!this.vol) return;
    this.vol.visible = volOn;
    const u = this.vol.material.uniforms;
    u.uOp.value = volOpacity;
    // The darkest (or brightest) share of the voxels; the third most dense
    // of them at full weight
    const share = Math.min(Math.max(volShare, 0.001), 0.999);
    const thr = this.level(share, !volDark), full = this.level(share / 3, !volDark);
    u.uThr.value = thr;
    // The grid without the small blobs at this threshold
    const lvl = Math.round(thr * 255 - 0.5), key = `${lvl}:${volDark}`;
    if (key !== this.dustKey && this.base) {
      this.dustKey = key;
      const tex = u.uTex.value as THREE.Data3DTexture;
      const { width: w, height: h, depth: d } = tex.image;
      const clean = removeDust(this.base, [d, h, w], lvl + (volDark ? 1 : 0), volDark, HAZE_DUST).values;
      (tex.image.data as unknown as Uint8Array).set(clean);
      tex.needsUpdate = true;
    }
    u.uSign.value = volDark ? 1 : -1;
    u.uSoft.value = Math.max(Math.abs(thr - full), 1 / 255);
    // The shown planes, in the box's coordinates (centered, y flipped)
    const { x: X, y: Y, z: Z } = this.o.dim;
    const c = (a: Axis) => this.o.keys[a][nearest(this.o.keys[a], pos[a])] + 0.5;
    u.uPlane.value.set(c("x") - X / 2, Y / 2 - c("y"), c("z") - Z / 2);
    u.uCut.value.set(active.includes("x") ? 1 : 0, active.includes("y") ? 1 : 0, active.includes("z") ? 1 : 0);
    u.uTol.value = volNear && active.length ? volTolerance : -1;
  }

  private onClick(e: PointerEvent) {
    const { mode, partsOn } = this.state;
    if (mode !== "select" && mode !== null) return;
    const rect = this.canvas.getBoundingClientRect();
    const px = e.clientX - rect.left, py = e.clientY - rect.top;
    this.camera.updateMatrixWorld();
    const P = this.o.particles;
    if (P && partsOn) {
      let best = -1, bd = 10;
      const v = new THREE.Vector3();
      // Only the particles shown
      for (const i of this.shown) {
        v.copy(toWorld(P.x[i] + 0.5, P.y[i] + 0.5, P.z[i] + 0.5)).project(this.camera);
        if (v.z > 1) continue;
        const dd = Math.hypot(((v.x + 1) / 2) * rect.width - px, ((1 - v.y) / 2) * rect.height - py);
        if (dd < bd) { bd = dd; best = i; }
      }
      if (best >= 0) {
        this.o.onPickParticle(best);
        return;
      }
    }
    if (mode !== "select") return;
    const ndc = new THREE.Vector2((px / rect.width) * 2 - 1, -((py / rect.height) * 2 - 1));
    this.ray.setFromCamera(ndc, this.camera);
    const hits = this.ray.intersectObjects(AXES.map((a) => this.planes[a]).filter((m) => m.visible));
    if (!hits.length) return;
    const p = hits[0].point, dim = this.o.dim;
    this.o.onPickPoint({ x: clampVox(dim, "x", p.x), y: clampVox(dim, "y", -p.y), z: clampVox(dim, "z", p.z) });
  }
}
