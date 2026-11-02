// src/components/viewers/volume/trackball.ts
//
// Camera control shared by the 3D tabs of VolumeViewer: drag to rotate freely
// (trackball, no limits), right-drag / shift+drag (or `isPan`) to move, wheel
// to zoom. The camera orbits `target` at distance `radius`.
import * as THREE from "three";

export type TrackballOptions = {
  /** Called after every change of the view (the owner renders). */
  onChange: () => void;
  /** A click: pointer up with almost no motion (left button). */
  onClick?: (e: PointerEvent) => void;
  /** Drags move the view instead of rotating it (e.g. the pan tool). */
  isPan?: () => boolean;
  /** Farthest zoom out. */
  maxRadius: number;
};

export class Trackball {
  quat = new THREE.Quaternion();
  readonly target = new THREE.Vector3();
  radius = 1;
  /** True while a drag is in progress. */
  dragging = false;

  constructor(private readonly el: HTMLElement, private readonly o: TrackballOptions) {
    this.attach();
  }

  /** Oblique view of `target` from distance `radius`. */
  reset(target: THREE.Vector3, radius: number) {
    this.target.copy(target);
    this.radius = radius;
    const th = 0.7, ph = 1.1;
    const c = new THREE.PerspectiveCamera();
    c.position.set(Math.sin(ph) * Math.sin(th), Math.cos(ph), Math.sin(ph) * Math.cos(th));
    c.lookAt(0, 0, 0);
    this.quat = c.quaternion.clone();
  }

  /** Places the camera. */
  apply(camera: THREE.Camera) {
    camera.quaternion.copy(this.quat);
    camera.position.copy(this.target).add(new THREE.Vector3(0, 0, this.radius).applyQuaternion(this.quat));
  }

  private attach() {
    const el = this.el;
    el.style.cursor = "grab";
    let drag: { x: number; y: number; sx: number; sy: number; moved: number } | null = null;
    el.addEventListener("contextmenu", (e) => e.preventDefault());
    el.addEventListener("pointerdown", (e) => {
      el.setPointerCapture(e.pointerId);
      drag = { x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, moved: 0 };
      this.dragging = true;
      el.style.cursor = "grabbing";
    });
    el.addEventListener("pointermove", (e) => {
      if (!drag) return;
      const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      drag.x = e.clientX;
      drag.y = e.clientY;
      drag.moved = Math.max(drag.moved, Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy));
      const right = new THREE.Vector3(1, 0, 0).applyQuaternion(this.quat);
      const up = new THREE.Vector3(0, 1, 0).applyQuaternion(this.quat);
      if (e.buttons & 2 || e.shiftKey || this.o.isPan?.()) {
        // Pan along the camera plane
        const k = this.radius * 0.0015;
        this.target.addScaledVector(right, -dx * k).addScaledVector(up, dy * k);
      } else {
        // Free trackball rotation around the camera axes, with no limits
        const q = new THREE.Quaternion()
          .setFromAxisAngle(up, -dx * 0.008)
          .multiply(new THREE.Quaternion().setFromAxisAngle(right, -dy * 0.008));
        this.quat.premultiply(q).normalize();
      }
      this.o.onChange();
    });
    el.addEventListener("pointerup", (e) => {
      el.style.cursor = "grab";
      const was = drag;
      drag = null;
      this.dragging = false;
      if (was && was.moved < 4 && e.button === 0) this.o.onClick?.(e);
      else this.o.onChange();
    });
    el.addEventListener(
      "wheel",
      (e) => {
        e.preventDefault();
        this.radius = Math.max(10, Math.min(this.o.maxRadius, this.radius * Math.exp(e.deltaY * 0.001)));
        this.o.onChange();
      },
      { passive: false },
    );
  }
}
