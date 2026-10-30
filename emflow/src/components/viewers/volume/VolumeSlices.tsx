// src/components/viewers/volume/VolumeSlices.tsx
//
// Slices tab of VolumeViewer, IMOD-like: the Z section in the centre, the Y
// section above it and the X section on its right (same scale), a slider for
// each axis, crosshair lines, particles, rulers and zoom/pan. Each section
// image is stretched over its whole section, so the mapping from screen to
// voxels stays exact even with downsampled images. Canvases are drawn
// imperatively; a section is only redrawn when its slice or zoom changed and
// keeps its picture until the next image has loaded (no blank frames).
import { forwardRef, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useRef } from "react";
import styles from "../VolumeViewer.module.css";
import {
  HV,
  nearest,
  clampVox,
  rulerLength,
  type Axis,
  type Ruler,
  type Vec3,
  type VolumeCoordinates,
  type VoxelSize,
} from "./volumeMath";

export type ZoomWindow = { x0: number; y0: number; w: number; h: number };
export type Mode = "select" | "ruler" | "zoom" | "pan" | null;

/** Undo steps of the Slices tab (the viewer adds "invert" and "lines"). */
export type HistoryEntry =
  | { type: "zoom"; a: Axis; win: ZoomWindow }
  | { type: "ruler"; a: Axis; prev: Ruler | null }
  | { type: "invert" }
  | { type: "lines" };

export type VolumeSlicesHandle = {
  setWindow: (a: Axis, win: ZoomWindow) => void;
  clearPending: () => void;
};

type Props = {
  dim: Vec3;
  keys: Record<Axis, number[]>;
  size: Record<Axis, [number, number]>;
  /** Screen px per voxel. */
  scale: number;
  pos: Vec3;
  sel: number;
  mode: Mode;
  partsOn: boolean;
  particles: VolumeCoordinates | null;
  tolerance: number;
  hideLines: boolean;
  inverted: boolean;
  rulers: Record<Axis, Ruler | null>;
  voxelSize: VoxelSize | null;
  getImage: (a: Axis, key: number) => HTMLImageElement | null;
  loadImage: (a: Axis, key: number) => Promise<HTMLImageElement>;
  onPosition: (p: Partial<Vec3>) => void;
  onParticle: (index: number) => void;
  onRuler: (a: Axis, ruler: Ruler | null) => void;
  pushHistory: (entry: HistoryEntry) => void;
};

type View = {
  img: CanvasRenderingContext2D;
  ov: CanvasRenderingContext2D;
  canvas: HTMLCanvasElement;
  cw: number;
  ch: number;
  win: ZoomWindow;
  hover: [number, number] | null;
  drawn: string | null;
};

type Drag = { a: Axis; type: "zoom" | "pan"; x0: number; y0: number; x: number; y: number };

// IMOD-like order of the grid cells
const VIEW_ORDER: Axis[] = ["y", "z", "x"];

const VolumeSlices = forwardRef<VolumeSlicesHandle, Props>(function VolumeSlices(props, ref) {
  const { size, scale, dim, keys } = props;
  const dpr = window.devicePixelRatio || 1;
  // Latest props for the event handlers and the image callbacks
  const p = useRef(props);
  p.current = props;
  const views = useRef<Partial<Record<Axis, View>>>({});
  const imgCanvas = useRef<Partial<Record<Axis, HTMLCanvasElement | null>>>({});
  const ovCanvas = useRef<Partial<Record<Axis, HTMLCanvasElement | null>>>({});
  const pend = useRef<Record<Axis, [number, number] | null>>({ x: null, y: null, z: null });
  const drag = useRef<Drag | null>(null);
  const wins = useRef<Partial<Record<Axis, ZoomWindow>>>({});

  const sv = (v: View) => v.cw / v.win.w;
  const toVox = (v: View, cx: number, cy: number): [number, number] => {
    const k = sv(v);
    return [v.win.x0 + cx / k, v.win.y0 + cy / k];
  };
  const toPx = (v: View, h: number, vv: number): [number, number] => {
    const k = sv(v);
    return [(h - v.win.x0) * k, (vv - v.win.y0) * k];
  };
  const currentKey = (a: Axis) => p.current.keys[a][nearest(p.current.keys[a], p.current.pos[a])];

  const drawImage = useCallback((a: Axis) => {
    const v = views.current[a];
    if (!v) return;
    const key = currentKey(a);
    const w = v.win, stamp = [key, w.x0, w.y0, w.w, w.h, v.cw, v.ch].join(",");
    if (v.drawn === stamp) return;
    const img = p.current.getImage(a, key);
    if (!img) {
      p.current.loadImage(a, key).then(() => {
        if (views.current[a] === v && currentKey(a) === key) drawImage(a);
      }, () => undefined);
      return;
    }
    const sz = p.current.size[a];
    const rx = img.naturalWidth / sz[0], ry = img.naturalHeight / sz[1];
    v.img.clearRect(0, 0, v.cw, v.ch);
    v.img.drawImage(img, w.x0 * rx, w.y0 * ry, w.w * rx, w.h * ry, 0, 0, v.cw, v.ch);
    v.drawn = stamp;
  }, []);

  const drawOverlay = useCallback((a: Axis) => {
    const v = views.current[a];
    if (!v) return;
    const { pos, sel, mode, partsOn, particles: P, tolerance, hideLines, rulers, voxelSize } = p.current;
    const ctx = v.ov, [ha, va] = HV[a];
    ctx.clearRect(0, 0, v.cw, v.ch);
    // Crosshair lines of the other two sections
    if (!hideLines) {
      const c = toPx(v, pos[ha] + 0.5, pos[va] + 0.5);
      ctx.strokeStyle = "rgba(0,229,255,.9)";
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      if (c[0] >= 0 && c[0] <= v.cw) { ctx.moveTo(c[0], 0); ctx.lineTo(c[0], v.ch); }
      if (c[1] >= 0 && c[1] <= v.ch) { ctx.moveTo(0, c[1]); ctx.lineTo(v.cw, c[1]); }
      ctx.stroke();
    }
    if (partsOn && P) {
      for (let i = 0; i < P.x.length; i++) {
        if (Math.abs(P[a][i] - pos[a]) > tolerance) continue;
        const q = toPx(v, P[ha][i] + 0.5, P[va][i] + 0.5);
        if (q[0] < -8 || q[1] < -8 || q[0] > v.cw + 8 || q[1] > v.ch + 8) continue;
        ctx.beginPath();
        ctx.arc(q[0], q[1], i === sel ? 4 : 2.5, 0, 2 * Math.PI);
        ctx.fillStyle = i === sel ? "#ff3b30" : "#ffa500";
        ctx.fill();
        ctx.lineWidth = 1;
        ctx.strokeStyle = "rgba(0,0,0,.6)";
        ctx.stroke();
      }
    }
    const label = (text: string, x: number, y: number) => {
      ctx.font = "12px sans-serif";
      const w = ctx.measureText(text).width + 8;
      const lx = Math.max(2, Math.min(x, v.cw - w - 2));
      const ly = Math.max(16, y);
      ctx.fillStyle = "rgba(0,0,0,.75)";
      ctx.fillRect(lx, ly - 14, w, 18);
      ctx.fillStyle = "#ffd43b";
      ctx.fillText(text, lx + 4, ly - 1);
    };
    const seg = (s: [number, number], e: [number, number], text: string) => {
      const A = toPx(v, s[0], s[1]), B = toPx(v, e[0], e[1]);
      ctx.strokeStyle = "#ffd43b";
      ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(A[0], A[1]); ctx.lineTo(B[0], B[1]); ctx.stroke();
      for (const q of [A, B]) {
        ctx.beginPath(); ctx.arc(q[0], q[1], 3, 0, 2 * Math.PI);
        ctx.fillStyle = "#ffd43b"; ctx.fill();
      }
      label(text, (A[0] + B[0]) / 2 + 6, (A[1] + B[1]) / 2 - 6);
    };
    const r = rulers[a];
    if (mode === "ruler" && r && r.key === currentKey(a)) seg(r.a, r.b, rulerLength(voxelSize, a, r));
    const pa = pend.current[a];
    if (mode === "ruler" && pa && v.hover) {
      const q = toVox(v, v.hover[0], v.hover[1]);
      seg(pa, q, rulerLength(voxelSize, a, { a: pa, b: q }));
    }
    // Rectangle being dragged with the zoom tool
    const d = drag.current;
    if (d && d.type === "zoom" && d.a === a) {
      ctx.strokeStyle = "#fff";
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 3]);
      ctx.strokeRect(Math.min(d.x0, d.x), Math.min(d.y0, d.y), Math.abs(d.x - d.x0), Math.abs(d.y - d.y0));
      ctx.setLineDash([]);
    }
  }, []);

  const drawAll = useCallback(() => {
    for (const a of VIEW_ORDER) {
      drawImage(a);
      drawOverlay(a);
    }
  }, [drawImage, drawOverlay]);

  // Canvas sizes follow the scale; the zoom windows are kept
  useLayoutEffect(() => {
    for (const a of VIEW_ORDER) {
      const ic = imgCanvas.current[a], oc = ovCanvas.current[a];
      if (!ic || !oc) continue;
      const cw = size[a][0] * scale, ch = size[a][1] * scale;
      for (const c of [ic, oc]) {
        c.width = Math.round(cw * dpr);
        c.height = Math.round(ch * dpr);
        c.style.width = `${cw}px`;
        c.style.height = `${ch}px`;
      }
      const img = ic.getContext("2d")!, ov = oc.getContext("2d")!;
      img.setTransform(dpr, 0, 0, dpr, 0, 0);
      ov.setTransform(dpr, 0, 0, dpr, 0, 0);
      const win = wins.current[a] ?? { x0: 0, y0: 0, w: size[a][0], h: size[a][1] };
      wins.current[a] = win;
      views.current[a] = { img, ov, canvas: oc, cw, ch, win, hover: views.current[a]?.hover ?? null, drawn: null };
    }
    drawAll();
  }, [size, scale, dpr, drawAll]);

  // Everything else that is drawn
  useEffect(() => {
    drawAll();
  }, [props.pos, props.sel, props.mode, props.partsOn, props.hideLines, props.rulers, props.tolerance, drawAll]);

  useImperativeHandle(ref, () => ({
    setWindow(a, win) {
      const v = views.current[a];
      wins.current[a] = win;
      if (v) {
        v.win = win;
        drawImage(a);
        drawOverlay(a);
      }
    },
    clearPending() {
      pend.current = { x: null, y: null, z: null };
      drag.current = null;
      VIEW_ORDER.forEach(drawOverlay);
    },
  }), [drawImage, drawOverlay]);

  /* ---------- zoom and pan ---------- */
  // Zoom to the dragged rectangle, widened to the aspect ratio of the view
  const zoomTo = (d: Drag) => {
    if (Math.abs(d.x - d.x0) < 5 || Math.abs(d.y - d.y0) < 5) return;
    const v = views.current[d.a]!;
    const [W, H] = p.current.size[d.a], R = W / H;
    const a = toVox(v, Math.min(d.x0, d.x), Math.min(d.y0, d.y));
    const b = toVox(v, Math.max(d.x0, d.x), Math.max(d.y0, d.y));
    let w = b[0] - a[0], h = b[1] - a[1];
    if (w / h < R) w = h * R; else h = w / R;
    if (w > W) { w = W; h = w / R; }
    if (h > H) { h = H; w = h * R; }
    const cx = (a[0] + b[0]) / 2, cy = (a[1] + b[1]) / 2;
    p.current.pushHistory({ type: "zoom", a: d.a, win: { ...v.win } });
    v.win = wins.current[d.a] = {
      x0: Math.max(0, Math.min(W - w, cx - w / 2)),
      y0: Math.max(0, Math.min(H - h, cy - h / 2)),
      w,
      h,
    };
    drawImage(d.a);
  };
  // dx, dy in section voxels: the image follows the pointer
  const movePan = (a: Axis, dx: number, dy: number) => {
    const v = views.current[a]!, w = v.win, sz = p.current.size[a];
    w.x0 = Math.max(0, Math.min(sz[0] - w.w, w.x0 + dx));
    w.y0 = Math.max(0, Math.min(sz[1] - w.h, w.y0 + dy));
    drawImage(a);
    drawOverlay(a);
  };

  useEffect(() => {
    const endDrag = () => {
      const d = drag.current;
      drag.current = null;
      if (!d) return;
      if (d.type === "zoom") zoomTo(d);
      drawOverlay(d.a);
    };
    document.addEventListener("mouseup", endDrag);
    return () => document.removeEventListener("mouseup", endDrag);
    // zoomTo only reads refs
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drawOverlay]);

  const local = (a: Axis, e: React.MouseEvent) => {
    const r = views.current[a]!.canvas.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top] as [number, number];
  };

  const onMouseMove = (a: Axis, e: React.MouseEvent) => {
    const v = views.current[a];
    if (!v) return;
    v.hover = local(a, e);
    const d = drag.current;
    if (d && d.a === a) {
      d.x = v.hover[0];
      d.y = v.hover[1];
      if (d.type === "pan") {
        movePan(a, -(d.x - d.x0) / sv(v), -(d.y - d.y0) / sv(v));
        d.x0 = d.x;
        d.y0 = d.y;
      } else drawOverlay(a);
    } else if (pend.current[a]) drawOverlay(a);
  };

  const onMouseDown = (a: Axis, e: React.MouseEvent) => {
    if (e.button !== 0) return;
    const mode = p.current.mode;
    if (mode === "zoom" || mode === "pan") {
      const [x, y] = local(a, e);
      drag.current = { a, type: mode, x0: x, y0: y, x, y };
      e.preventDefault();
    }
  };

  const onClick = (a: Axis, e: React.MouseEvent) => {
    const v = views.current[a];
    if (!v) return;
    const { mode, partsOn, particles: P, pos, tolerance, dim: d, rulers } = p.current;
    const [cx, cy] = local(a, e);
    const [h, vv] = toVox(v, cx, cy);
    const [ha, va] = HV[a];
    if (P && partsOn && (mode === "select" || mode === null)) {
      let best = -1, bd = 10;
      for (let i = 0; i < P.x.length; i++) {
        if (Math.abs(P[a][i] - pos[a]) > tolerance) continue;
        const q = toPx(v, P[ha][i] + 0.5, P[va][i] + 0.5);
        const dd = Math.hypot(q[0] - cx, q[1] - cy);
        if (dd < bd) { bd = dd; best = i; }
      }
      if (best >= 0) {
        p.current.onParticle(best);
        return;
      }
    }
    if (mode === "select") {
      p.current.onPosition({ [ha]: clampVox(d, ha, h), [va]: clampVox(d, va, vv) });
    } else if (mode === "ruler") {
      const pa = pend.current[a];
      if (!pa) {
        pend.current[a] = [h, vv];
        p.current.onRuler(a, null);
      } else {
        p.current.pushHistory({ type: "ruler", a, prev: rulers[a] });
        pend.current[a] = null;
        p.current.onRuler(a, { key: currentKey(a), a: pa, b: [h, vv] });
      }
      drawOverlay(a);
    }
  };

  const cursor = props.mode === "pan" ? "grab" : props.mode ? "crosshair" : "default";

  const figure = (a: Axis) => (
    <figure className={styles.fig} style={{ width: size[a][0] * scale, height: size[a][1] * scale }}>
      <canvas
        ref={(el) => { imgCanvas.current[a] = el; }}
        className={styles.img}
        style={{ filter: props.inverted ? "invert(1)" : undefined }}
      />
      <canvas
        ref={(el) => { ovCanvas.current[a] = el; }}
        className={styles.ov}
        style={{ cursor }}
        onMouseMove={(e) => onMouseMove(a, e)}
        onMouseLeave={() => {
          const v = views.current[a];
          if (v) v.hover = null;
          drawOverlay(a);
        }}
        onMouseDown={(e) => onMouseDown(a, e)}
        onClick={(e) => onClick(a, e)}
      />
    </figure>
  );

  /* Each slider is as wide as the section it sits next to (but never too
     short to use), with its slice number below it. */
  const slider = (a: Axis) => (
    <div className={styles.slider}>
      <input
        type="range"
        min={0}
        max={dim[a] - 1}
        step={1}
        value={props.pos[a]}
        style={{ width: Math.max(size[a === "x" ? "x" : "z"][0] * scale, 110) }}
        onChange={(e) => props.onPosition({ [a]: Number(e.target.value) })}
      />
      <div className={styles.lbl}>
        {a.toUpperCase()} slice: {props.pos[a]}
      </div>
    </div>
  );

  return (
    <div className={styles.grid}>
      {slider("y")}
      <div />
      {figure("y")}
      <div />
      {figure("z")}
      {figure("x")}
      {slider("z")}
      {slider("x")}
    </div>
  );
});

export default VolumeSlices;
