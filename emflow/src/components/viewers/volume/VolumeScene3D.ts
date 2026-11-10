// src/components/viewers/volume/VolumeScene3D.ts
//
// The 3D tab of VolumeViewer: three orthogonal planes textured with the
// current slices (at most two shown), the volume box, picked particles
// (points, spheres with an arrow along their orientation, or the template
// surface at each particle) and an optional faint ray-marched volume.
// Renders on demand (no animation loop).
// The world is the voxel space with y flipped (three.js y goes up).
import * as THREE from "three";
import { templateMesh, type ParticleTemplate } from "./templateSurface";
import { Trackball } from "./trackball";
import {
  AXES,
  clampVox,
  imageSize,
  nearest,
  particleRotation,
  type Axis,
  type SliceImage,
  type Vec3,
  type VolumeCoordinates,
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

const VOLUME_VERTEX = "varying vec3 vP; void main() { vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }";

/* The whole volume as a faint haze: the Z sections are packed in a 3D
   texture and each pixel integrates the haze along its line of sight. */
const VOLUME_FRAGMENT = [
  "precision highp float; precision highp sampler3D;",
  "uniform sampler3D uTex; uniform vec3 uCam, uSize; uniform float uOp, uInv; varying vec3 vP;",
  "void main() {",
  "  vec3 dir = normalize(vP - uCam);",
  "  vec3 hs = uSize * 0.5, inv = 1.0 / dir;",
  "  vec3 t1 = (-hs - vP) * inv, t2 = (hs - vP) * inv;",
  "  float tmax = min(min(max(t1.x, t2.x), max(t1.y, t2.y)), max(t1.z, t2.z));",
  "  const int N = 64;",
  "  float dt = tmax / float(N);",
  "  vec3 col = vec3(0.0); float a = 0.0;",
  "  for (int i = 0; i < N; i++) {",
  "    vec3 p = vP + dir * (float(i) + 0.5) * dt;",
  "    vec3 uv = vec3(p.x / uSize.x + 0.5, 0.5 - p.y / uSize.y, p.z / uSize.z + 0.5);",
  "    float v = texture(uTex, uv).r;",
  "    v = mix(v, 1.0 - v, uInv);",
  "    float s = uOp * (dt / uSize.z) * 6.0 * (0.25 + abs(v - 0.5) * 3.0);",
  "    s = clamp(s, 0.0, 1.0);",
  "    col += (1.0 - a) * s * vec3(v);",
  "    a += (1.0 - a) * s;",
  "    if (a > 0.98) break;",
  "  }",
  "  gl_FragColor = vec4(col / max(a, 0.001), a);",
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
      // Planes are drawn after the faint volume so the haze never dims them
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
    const inverted = this.state.inverted;
    const id = `${a}:${key}${inverted ? ":inv" : ""}`;
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
    let src: SliceImage = img;
    if (inverted) {
      const c = document.createElement("canvas");
      [c.width, c.height] = imageSize(img);
      const g = c.getContext("2d")!;
      g.drawImage(img, 0, 0);
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

  private buildVolume() {
    if (this.vol || this.volLoading) return;
    const zk = this.o.keys.z;
    const imgs = zk.map((k) => this.o.getImage("z", k));
    if (imgs.some((i) => !i)) {
      // Wait once for the missing images, then build
      this.volLoading = true;
      Promise.all(zk.map((k) => this.o.loadImage("z", k))).then(
        () => {
          this.volLoading = false;
          if (!this.disposed) this.sync();
        },
        () => { this.volLoading = false; },
      );
      return;
    }
    const { x: X, y: Y, z: Z } = this.o.dim;
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
    const tex = new THREE.Data3DTexture(data, w, h, d);
    tex.format = THREE.RedFormat;
    tex.type = THREE.UnsignedByteType;
    tex.minFilter = tex.magFilter = THREE.LinearFilter;
    tex.unpackAlignment = 1;
    tex.needsUpdate = true;
    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      side: THREE.FrontSide,
      uniforms: {
        uTex: { value: tex },
        uCam: { value: new THREE.Vector3() },
        uSize: { value: new THREE.Vector3(X, Y, Z) },
        uOp: { value: this.state.volOpacity },
        uInv: { value: 0 },
      },
      vertexShader: VOLUME_VERTEX,
      fragmentShader: VOLUME_FRAGMENT,
    });
    const m = new THREE.Mesh(new THREE.BoxGeometry(X, Y, Z), mat);
    m.position.set(X / 2, -Y / 2, Z / 2);
    m.renderOrder = 0;
    m.frustumCulled = false;
    this.scene.add(m);
    this.vol = m;
  }

  private updateVolume() {
    const { volOn, volOpacity, inverted } = this.state;
    if (volOn) this.buildVolume();
    if (this.vol) {
      this.vol.visible = volOn;
      this.vol.material.uniforms.uOp.value = volOpacity;
      this.vol.material.uniforms.uInv.value = inverted ? 1 : 0;
    }
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
