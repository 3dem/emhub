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
// The world is the voxel space of the full volume with y flipped.
import * as THREE from "three";
import { Trackball } from "./trackball";
import { densityValues } from "./densityGrid";
import type { Vec3, VolumeDensity } from "./volumeMath";

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
  smooth: boolean;
  /** Drags move the view (pan tool). */
  pan: boolean;
};

const VERTEX = [
  "varying vec3 vP;",
  "void main() { vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }",
].join("\n");

const FRAGMENT = [
  "precision highp float; precision highp sampler3D;",
  "uniform sampler3D uTex;",
  "uniform vec3 uCam, uSize, uColor, uLight, uTexel;",
  "uniform float uThr, uSign, uOpacity, uStep;",
  "uniform mat4 uMVP;",
  "varying vec3 vP;",
  "",
  "float val(vec3 p) {",
  "  return uSign * (texture(uTex, vec3(p.x / uSize.x + 0.5, 0.5 - p.y / uSize.y, p.z / uSize.z + 0.5)).r - uThr);",
  "}",
  "",
  "vec3 shade(vec3 p, vec3 n, vec3 dir) {",
  "  if (dot(n, dir) > 0.0) n = -n;",
  "  float diff = max(dot(n, uLight), 0.0);",
  "  float spec = pow(max(dot(n, normalize(uLight - dir)), 0.0), 48.0);",
  "  return uColor * (0.28 + 0.72 * diff) + vec3(0.22 * spec);",
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
  "  float jit = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453);",
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
  "  float t = t0 + uStep * jit;",
  "  for (int i = 0; i < 4096; i++) {",
  "    if (t > tEnd || a > 0.98) break;",
  "    float v = val(uCam + dir * t);",
  "    if (v > 0.0 && prev <= 0.0) {",
  "      // Entering: refine the crossing between t - uStep and t",
  "      float lo = max(t - uStep, t0), hi = t;",
  "      for (int k = 0; k < 6; k++) {",
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
  "    }",
  "    prev = v;",
  "    t += uStep;",
  "  }",
  "  if (a <= 0.0) discard;",
  "  gl_FragDepth = depth * 0.5 + 0.5;",
  "  gl_FragColor = vec4(col / a, a);",
  "}",
].join("\n");

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
  private mesh: THREE.Mesh<THREE.BoxGeometry, THREE.ShaderMaterial> | null = null;
  private density: VolumeDensity | null = null;
  private state: IsoState;
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
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    this.renderer.setSize(width, height);
    this.renderer.setClearColor(0x111418);
    this.canvas = this.renderer.domElement;
    this.camera = new THREE.PerspectiveCamera(40, width / height, 1, 100 * m);
    this.ball = new Trackball(this.canvas, {
      onChange: () => this.moved(),
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

  /** New values of the same grid (e.g. smoothed or without dust). */
  setValues(values: Uint8Array) {
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
    const [nz, ny, nx] = d.shape;
    const f = d.binning || 1;
    const tex = new THREE.Data3DTexture(values, nx, ny, nz);
    tex.format = THREE.RedFormat;
    tex.type = THREE.UnsignedByteType;
    tex.minFilter = tex.magFilter = THREE.LinearFilter;
    tex.unpackAlignment = 1;
    tex.needsUpdate = true;
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
        uColor: { value: rgb(this.state.color) },
        uLight: { value: new THREE.Vector3(0, 0, 1) },
        uThr: { value: 0.5 },
        uSign: { value: 1 },
        uOpacity: { value: 1 },
        uStep: { value: f * 0.5 },
        uMVP: { value: new THREE.Matrix4() },
      },
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
    });
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(size.x, size.y, size.z), mat);
    mesh.position.set(size.x / 2, -size.y / 2, size.z / 2);
    mesh.renderOrder = 1;
    mesh.frustumCulled = false;
    this.scene.add(mesh);
    this.mesh = mesh;
    this.sync();
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

  reset() {
    const { x, y, z } = this.dim;
    this.ball.reset(new THREE.Vector3(x / 2, -y / 2, z / 2), 2.1 * Math.max(x, y, z));
    this.render();
  }

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    clearTimeout(this.fineTimer);
    this.removeMesh();
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
    this.mesh.material.uniforms.uTex.value.dispose();
    this.mesh.material.dispose();
    this.mesh.geometry.dispose();
    this.mesh = null;
  }

  private sync() {
    const d = this.density;
    if (this.mesh && d) {
      const u = this.mesh.material.uniforms;
      const [v0, v1] = d.valueRange;
      u.uThr.value = (this.state.threshold - v0) / (v1 - v0 || 1);
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
      this.ball.apply(this.camera);
      this.camera.updateMatrixWorld();
      if (this.mesh && this.density) {
        const u = this.mesh.material.uniforms;
        const f = this.density.binning || 1;
        // Local box space (the mesh is only translated)
        u.uCam.value.copy(this.mesh.worldToLocal(this.camera.position.clone()));
        // Key light above-left of the camera
        u.uLight.value.set(-0.35, 0.45, 1).normalize().applyQuaternion(this.camera.quaternion);
        u.uStep.value = f * (this.coarse || this.ball.dragging ? 1.25 : 0.5);
        this.mesh.updateMatrixWorld();
        u.uMVP.value
          .copy(this.camera.projectionMatrix)
          .multiply(this.camera.matrixWorldInverse)
          .multiply(this.mesh.matrixWorld);
      }
      this.renderer.render(this.scene, this.camera);
    });
  }
}
