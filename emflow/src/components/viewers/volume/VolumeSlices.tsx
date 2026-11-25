// src/components/viewers/volume/VolumeSlices.tsx
//
// Slices tab of VolumeViewer, IMOD-like: the Z section in the centre, the Y
// section above it and the X section on its right (same scale), a slider for
// each axis, crosshair lines, particles, rulers and zoom/pan. Each section
// image is stretched over its whole section, so the mapping from screen to
// voxels stays exact even with downsampled images. Canvases are drawn
// imperatively; a section is only redrawn when its slice or zoom changed and
// keeps its picture until the next image has loaded (no blank frames).
// A mask (a sphere or a map) is drawn over the sections, translucent, and a
// map that colors them (local resolution: colorBy), with the palette and range
// of the 3D volume.
// The images are thumbnails: when a view shows them coarser than the screen
// (zoomed, or a large view) and than the voxels, the host's full-resolution
// crop of the view (loadCrop) is drawn over it, binned only to the screen
// pixels and smoothly interpolated past the voxels (no detail made up). The
// low-pass filter (filterSigma) is applied by the host to the crops and here
// to the slice images (same Gaussian and contrast), so a view that needs no
// crop (e.g. a whole X section, strided in the file) reads nothing more.
// With a `drawing` (e.g. the masks of MaskDrawWizard, see maskDrawing.ts),
// the contour tool (mode "contour") draws closed contours on the Z sections
// and the border tool (mode "border") the lower and upper borders of the
// lamella as straight lines on the Y and X sections; the other sections keep
// the select behaviour (a click moves the position there).
import { forwardRef, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useRef, type ReactNode } from "react";
import styles from "../VolumeViewer.module.css";
import { gaussianImage, maskSlice, resolutionSlice } from "./densityGrid";
import {
  addBorder, borderPlanes, crossings, isBorderAxis, planeZ, regionImage, segmentDistance, translateDrawing,
  type SliceBorder, type SliceContour, type SliceDrawing,
} from "./maskDrawing";
import {
  HV,
  nearest,
  clampVox,
  rulerLength,
  imageSize,
  type Axis,
  type BoxMargin,
  type Ruler,
  type SliceImage,
  type Vec3,
  type CropRequest,
  type VolumeCoordinates,
  type VolumeCrop,
  type VolumeDensity,
  type VoxelSize,
} from "./volumeMath";

export type ZoomWindow = { x0: number; y0: number; w: number; h: number };
export type Mode = "select" | "ruler" | "zoom" | "pan" | "contour" | "border" | "move" | null;

/** Undo steps of the Slices tab (the viewer adds "invert" and "lines"). */
export type HistoryEntry =
  | { type: "zoom"; a: Axis; win: ZoomWindow }
  | { type: "ruler"; a: Axis; prev: Ruler | null }
  | { type: "invert" }
  | { type: "lines" }
  // A change of the drawing of the mask tools (the one before it)
  | { type: "drawing"; prev: SliceDrawing | null };

/** Mask drawn over the sections: a sphere (voxels) or a map, whose voxels
 * above `level` (0-255 of its grid) are inside. */
export type SliceMask = (
  | { type: "sphere"; center: Vec3; diameter: number }
  | { type: "map"; density: VolumeDensity; level: number }
) & { color: string; opacity: number };

// Contour tool, on a Z section: click to add points, click the first one
// (or double-click) to close the contour (it replaces the one of that
// slice), drag a point to move it, click on an edge to add a point there,
// right-click a point to remove it (right-click while drawing: the last
// point). Border tool, on a Y or X section: click the start and the end of
// a line (two per section at most: the lower one is the lower border, a
// third one replaces the nearest), drag an end to move it, right-click a
// line to remove it (while drawing: cancel). Move tool, on any section:
// drag to move the whole drawing (contours and borders). The planes of the borders are
// shown dashed on every Y and X section, and shade the Z sections outside.
export type { SliceBorder, SliceContour, SliceDrawing } from "./maskDrawing";

/** A map (local resolution) drawn over the sections in RESOLUTION_PALETTE
 * over `range` (map units), translucent; no value (<= 0) is transparent. */
export type SliceColorBy = { density: VolumeDensity; range: [number, number]; opacity: number };

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
  /** Color of the particle dots (the selected one is red). */
  particleColor: string;
  /** Particles in sets: the set of each one, the color of each set and
   * whether it is shown (null: one set, particleColor). */
  particleSet?: number[] | null;
  setColors?: string[] | null;
  setShown?: boolean[] | null;
  inverted: boolean;
  rulers: Record<Axis, Ruler | null>;
  /** Shown mask (null: none or hidden). */
  mask?: SliceMask | null;
  /** Margin of the box (e.g. near the edges), translucent (null: none). */
  margin?: BoxMargin | null;
  /** Map that colors the sections (null: none or off). */
  colorBy?: SliceColorBy | null;
  /** Contours and borders of the drawing tools (null: none); with onDrawing,
   * called with the new drawing when the user changes it. */
  drawing?: SliceDrawing | null;
  onDrawing?: (d: SliceDrawing) => void;
  /** In the free cell right of the Y section (e.g. the color key). */
  corner?: ReactNode;
  voxelSize: VoxelSize | null;
  getImage: (a: Axis, key: number) => SliceImage | null;
  loadImage: (a: Axis, key: number) => Promise<SliceImage>;
  /** Full-resolution crop of a window (none: only the slice images). */
  loadCrop?: ((r: CropRequest) => Promise<VolumeCrop>) | null;
  /** Gaussian low-pass of the sections (voxels, 0: none). */
  filterSigma: number;
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

// Contour and border tools: the contour point or border end being dragged,
// and whether it moved (then the click that ends it does nothing)
type DrawDrag = { a: Axis; type: "point"; index: number; moved: boolean }
  | { a: Axis; type: "end"; border: number; end: 0 | 1; moved: boolean }
  // The move tool: the drawing and the voxel where the drag started
  | { a: Axis; type: "move"; base: SliceDrawing; start: [number, number]; moved: boolean };

/** Distance (px) of a pointer to a point, line or edge to pick it. */
const PICK_PX = 7;
const CONTOUR_COLOR = "#ff9f1c";
const BORDER_COLORS = { low: "#4dabf7", high: "#f783ac" };

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
  // Contour and border tools: the contour being drawn (on the Z slice `z`),
  // the start of the border line being drawn, the dragged point or end, and
  // the drawing while dragging (sent on release)
  const pendContour = useRef<{ z: number; points: [number, number][] } | null>(null);
  const pendBorder = useRef<{ a: "x" | "y"; index: number; start: [number, number] } | null>(null);
  const drawDrag = useRef<DrawDrag | null>(null);
  const draft = useRef<SliceDrawing | null>(null);
  // Colored sections of a map mask, by axis, slice, color and level
  const maskImages = useRef<{ density: VolumeDensity | null; images: Map<string, HTMLCanvasElement> }>(
    { density: null, images: new Map() });
  // Colored sections of the colorBy map, by axis, slice and range
  const colorImages = useRef<{ density: VolumeDensity | null; images: Map<string, HTMLCanvasElement> }>(
    { density: null, images: new Map() });

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

  // Full-resolution crops: the last one of each axis (drawn over the
  // thumbnail while it still covers the view) and the pending request
  const crops = useRef<Partial<Record<Axis, { key: number; sigma: number; crop: VolumeCrop }>>>({});
  const cropTimers = useRef<Partial<Record<Axis, number>>>({});

  // Filtered slice images, by axis, slice and sigma
  const filteredImages = useRef(new Map<string, SliceImage>());
  /** The slice image low-pass filtered as the crops (sigma voxels, in its
   * pixels: sigma * px per voxel), or itself without filter. */
  const filtered = (a: Axis, key: number, img: SliceImage, pxPerVoxel: number): SliceImage => {
    const sigma = p.current.filterSigma;
    if (!sigma) return img;
    const id = `${a}:${key}:${sigma}`;
    let out = filteredImages.current.get(id);
    if (!out) {
      out = gaussianImage(img, sigma * pxPerVoxel);
      if (filteredImages.current.size > 64) filteredImages.current.clear();
      filteredImages.current.set(id, out);
    }
    return out;
  };

  /** The crop of `a` over the view, where it covers it. */
  const paintCrop = (a: Axis, v: View, key: number) => {
    const c = crops.current[a];
    if (!c || c.key !== key || c.sigma !== p.current.filterSigma) return;
    const [px, py] = toPx(v, c.crop.x0, c.crop.y0), k = sv(v);
    v.img.imageSmoothingEnabled = true;
    v.img.imageSmoothingQuality = "high";
    v.img.drawImage(c.crop.image, px, py, c.crop.w * k, c.crop.h * k);
  };

  /** Asks for the crop of the view (with the filter) when the thumbnail is
   * coarser than the screen and the voxels, once the view has settled. */
  const requestCrop = (a: Axis, v: View, key: number, stamp: string, thumbPx: number) => {
    window.clearTimeout(cropTimers.current[a]);
    const { loadCrop, filterSigma } = p.current;
    if (!loadCrop) return;
    const w = v.win, screenPx = (v.cw * dpr) / w.w;
    // Only when the view needs more detail than the slice image has (the
    // filter of a view that does not is applied to the slice image)
    if (thumbPx >= 0.98 * Math.min(1, screenPx)) return;
    const c = crops.current[a];
    const sz = p.current.size[a];
    const x0 = Math.max(0, Math.floor(w.x0)), y0 = Math.max(0, Math.floor(w.y0));
    const x1 = Math.min(sz[0], Math.ceil(w.x0 + w.w)), y1 = Math.min(sz[1], Math.ceil(w.y0 + w.h));
    // The last crop already covers the view at least as finely
    if (c && c.key === key && c.sigma === filterSigma && c.crop.x0 <= x0 && c.crop.y0 <= y0
        && c.crop.x0 + c.crop.w >= x1 - c.crop.binning && c.crop.y0 + c.crop.h >= y1 - c.crop.binning
        && 1 / c.crop.binning >= 0.98 * Math.min(1, screenPx)) return;
    cropTimers.current[a] = window.setTimeout(() => {
      const req: CropRequest = {
        axis: a, index: key, x0, y0, w: x1 - x0, h: y1 - y0,
        maxW: Math.ceil(((x1 - x0) / w.w) * v.cw * dpr), maxH: Math.ceil(((y1 - y0) / w.h) * v.ch * dpr),
        sigma: filterSigma,
        thumbBinning: Math.round((1 / thumbPx) * 100) / 100,
      };
      loadCrop(req).then((crop) => {
        crops.current[a] = { key, sigma: req.sigma, crop };
        // Still the same view: draw it now
        if (views.current[a] === v && v.drawn === stamp) paintCrop(a, v, key);
      }, () => undefined);
    }, 250);
  };

  const drawImage = useCallback((a: Axis) => {
    const v = views.current[a];
    if (!v) return;
    const key = currentKey(a);
    const w = v.win, stamp = [key, w.x0, w.y0, w.w, w.h, v.cw, v.ch, p.current.filterSigma].join(",");
    if (v.drawn === stamp) return;
    const img = p.current.getImage(a, key);
    if (!img) {
      p.current.loadImage(a, key).then(() => {
        if (views.current[a] === v && currentKey(a) === key) drawImage(a);
      }, () => undefined);
      return;
    }
    const sz = p.current.size[a];
    const [iw, ih] = imageSize(img);
    const rx = iw / sz[0], ry = ih / sz[1];
    v.img.clearRect(0, 0, v.cw, v.ch);
    v.img.drawImage(filtered(a, key, img, Math.min(rx, ry)), w.x0 * rx, w.y0 * ry, w.w * rx, w.h * ry, 0, 0, v.cw, v.ch);
    paintCrop(a, v, key);
    v.drawn = stamp;
    requestCrop(a, v, key, stamp, Math.min(rx, ry));
    // the helpers only read refs
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const drawOverlay = useCallback((a: Axis) => {
    const v = views.current[a];
    if (!v) return;
    const { pos, sel, mode, partsOn, particles: P, tolerance, hideLines, rulers, voxelSize, particleColor } = p.current;
    const { particleSet: S, setColors, setShown } = p.current;
    const ctx = v.ov, [ha, va] = HV[a];
    ctx.clearRect(0, 0, v.cw, v.ch);
    drawColorBy(a, v);
    drawMask(a, v);
    drawMargin(a, v);
    drawContours(a, v);
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
        if (S && setShown && !setShown[S[i]]) continue;
        const q = toPx(v, P[ha][i] + 0.5, P[va][i] + 0.5);
        if (q[0] < -8 || q[1] < -8 || q[0] > v.cw + 8 || q[1] > v.ch + 8) continue;
        ctx.beginPath();
        ctx.arc(q[0], q[1], i === sel ? 4 : 2.5, 0, 2 * Math.PI);
        ctx.fillStyle = i === sel ? "#ff3b30" : (S && setColors ? setColors[S[i]] ?? particleColor : particleColor);
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

  // The colorBy map at the shown slice of axis a
  const drawColorBy = (a: Axis, v: View) => {
    const c = p.current.colorBy;
    if (!c) return;
    const key = currentKey(a);
    const cache = colorImages.current;
    if (cache.density !== c.density) cache.images = new Map();
    cache.density = c.density;
    const id = `${a}:${key}:${c.range[0]}:${c.range[1]}`;
    let img = cache.images.get(id);
    if (!img) {
      img = resolutionSlice(c.density, a, key, c.range);
      cache.images.set(id, img);
    }
    const ctx = v.ov, sz = p.current.size[a], w = v.win;
    const rx = img.width / sz[0], ry = img.height / sz[1];
    ctx.save();
    ctx.globalAlpha = c.opacity;
    ctx.drawImage(img, w.x0 * rx, w.y0 * ry, w.w * rx, w.h * ry, 0, 0, v.cw, v.ch);
    ctx.restore();
  };

  // The mask at the shown slice of axis a
  const drawMask = (a: Axis, v: View) => {
    const m = p.current.mask;
    if (!m) return;
    const ctx = v.ov, [ha, va] = HV[a];
    const key = currentKey(a);
    ctx.save();
    ctx.globalAlpha = m.opacity;
    if (m.type === "sphere") {
      // The circle where the plane through the middle of the slice cuts it
      const R = m.diameter / 2, d = key + 0.5 - m.center[a];
      if (Math.abs(d) < R) {
        const c = toPx(v, m.center[ha], m.center[va]);
        ctx.beginPath();
        ctx.arc(c[0], c[1], Math.sqrt(R * R - d * d) * sv(v), 0, 2 * Math.PI);
        ctx.fillStyle = m.color;
        ctx.fill();
      }
    } else {
      const cache = maskImages.current;
      if (cache.density !== m.density) cache.images = new Map();
      cache.density = m.density;
      const id = `${a}:${key}:${m.color}:${m.level}`;
      let img = cache.images.get(id);
      if (!img) {
        img = maskSlice(m.density, a, key, m.level, m.color);
        cache.images.set(id, img);
      }
      const sz = p.current.size[a], w = v.win;
      const rx = img.width / sz[0], ry = img.height / sz[1];
      ctx.drawImage(img, w.x0 * rx, w.y0 * ry, w.w * rx, w.h * ry, 0, 0, v.cw, v.ch);
    }
    ctx.restore();
  };

  // The margin of the box in the section of axis a: the whole section when
  // its slice is in the margin, else the bands along its four sides
  const drawMargin = (a: Axis, v: View) => {
    const m = p.current.margin;
    if (!m) return;
    const { dim } = p.current, [ha, va] = HV[a];
    const ctx = v.ov, c = currentKey(a) + 0.5;
    const inside = c >= m.vox[a] && c <= dim[a] - m.vox[a];
    const A = toPx(v, 0, 0), B = toPx(v, dim[ha], dim[va]);
    ctx.save();
    ctx.globalAlpha = m.opacity;
    ctx.fillStyle = m.color;
    ctx.beginPath();
    ctx.rect(A[0], A[1], B[0] - A[0], B[1] - A[1]);
    if (inside) {
      const iA = toPx(v, Math.min(m.vox[ha], dim[ha] / 2), Math.min(m.vox[va], dim[va] / 2));
      const iB = toPx(v, Math.max(dim[ha] - m.vox[ha], dim[ha] / 2), Math.max(dim[va] - m.vox[va], dim[va] / 2));
      // The inner rectangle: a hole (even-odd rule)
      ctx.rect(iA[0], iA[1], iB[0] - iA[0], iB[1] - iA[1]);
    }
    ctx.fill("evenodd");
    ctx.restore();
  };

  /* ---------- contour and border tools: drawing ---------- */
  const shownDrawing = (): SliceDrawing | null => draft.current ?? p.current.drawing ?? null;

  // The contours (the one of the shown Z slice with its points, the others
  // faint; dots where they cross the Y and X sections), the border lines of
  // the shown Y / X slice, the planes of the borders (dashed on the Y and X
  // sections, shading the sections outside them)
  const drawContours = (a: Axis, v: View) => {
    const d = shownDrawing(), pc = pendContour.current, pb = pendBorder.current;
    if (!d && !pc && !pb) return;
    const { pos, dim, mode, onDrawing } = p.current;
    const contourTool = mode === "contour" && Boolean(onDrawing);
    const borderTool = mode === "border" && Boolean(onDrawing);
    const contours = d?.contours ?? [], borders = d?.borders ?? [];
    const planes = borderPlanes(borders);
    const ctx = v.ov, key = currentKey(a);
    const path = (pts: [number, number][], close: boolean) => {
      ctx.beginPath();
      pts.forEach((q, i) => {
        const [x, y] = toPx(v, q[0], q[1]);
        if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y);
      });
      if (close) ctx.closePath();
    };
    const handles = (pts: [number, number][], color: string, first = false) => pts.forEach((q, i) => {
      const [x, y] = toPx(v, q[0], q[1]);
      ctx.beginPath();
      ctx.arc(x, y, first && i === 0 ? 5 : 3, 0, 2 * Math.PI);
      ctx.fillStyle = first && i === 0 ? "#fff" : color;
      ctx.fill();
      ctx.lineWidth = 1;
      ctx.strokeStyle = "rgba(0,0,0,.7)";
      ctx.stroke();
    });
    const pending = (start: [number, number], color: string) => {
      if (!v.hover) return;
      path([start, toVox(v, v.hover[0], v.hover[1])], false);
      ctx.lineWidth = 2;
      ctx.strokeStyle = color;
      ctx.stroke();
    };
    ctx.save();
    // The region: the fill of the contours, the shade outside the borders
    const region = d ? regionImage(d, a, key, p.current.size) : null;
    if (region) {
      const [W, H] = p.current.size[a], [A, B] = [toPx(v, 0, 0), toPx(v, W, H)];
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(region, A[0], A[1], B[0] - A[0], B[1] - A[1]);
    }
    if (a === "z") {
      ctx.setLineDash([4, 3]);
      ctx.lineWidth = 1;
      ctx.strokeStyle = "rgba(255,159,28,.5)";
      for (const c of contours) {
        if (c.z === key) continue;
        path(c.points, true);
        ctx.stroke();
      }
      ctx.setLineDash([]);
      const cur = contours.find((c) => c.z === key);
      if (cur) {
        path(cur.points, true);
        ctx.lineWidth = 2;
        ctx.strokeStyle = CONTOUR_COLOR;
        ctx.stroke();
        if (contourTool) handles(cur.points, CONTOUR_COLOR);
      }
      if (pc && pc.z === key) {
        path(pc.points, false);
        ctx.lineWidth = 2;
        ctx.strokeStyle = "#fff";
        ctx.stroke();
        pending(pc.points[pc.points.length - 1], "#fff");
        handles(pc.points, CONTOUR_COLOR, true);
      }
    } else {
      // Y section: x across, z down; X section: z across, y down
      const across = a === "y" ? pos.y + 0.5 : pos.x + 0.5;
      ctx.fillStyle = CONTOUR_COLOR;
      for (const c of contours) {
        for (const u of crossings(c.points, across, a === "y" ? 0 : 1)) {
          const [x, y] = a === "y" ? toPx(v, u, c.z + 0.5) : toPx(v, c.z + 0.5, u);
          ctx.beginPath();
          ctx.arc(x, y, 3, 0, 2 * Math.PI);
          ctx.fill();
        }
      }
      ctx.setLineDash([6, 4]);
      ctx.lineWidth = 1.5;
      for (const side of ["low", "high"] as const) {
        const pl = planes[side];
        if (!pl) continue;
        const ends: [number, number][] = a === "y"
          ? [[0, planeZ(pl, 0, across)], [dim.x, planeZ(pl, dim.x, across)]]
          : [[planeZ(pl, across, 0), 0], [planeZ(pl, across, dim.y), dim.y]];
        path(ends, false);
        ctx.strokeStyle = BORDER_COLORS[side];
        ctx.stroke();
      }
      ctx.setLineDash([]);
      for (const b of borders) {
        if (b.axis !== a || b.index !== key) continue;
        path(b.points, false);
        ctx.lineWidth = 2.5;
        ctx.strokeStyle = BORDER_COLORS[b.side];
        ctx.stroke();
        if (borderTool) handles(b.points, BORDER_COLORS[b.side]);
      }
      if (pb && pb.a === a && pb.index === key) {
        pending(pb.start, "#fff");
        handles([pb.start], "#fff");
      }
    }
    ctx.restore();
  };

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
  }, [props.pos, props.sel, props.mode, props.partsOn, props.hideLines, props.rulers, props.tolerance,
      props.particleColor, props.particleSet, props.setColors?.join(), props.setShown?.join(),
      props.mask, props.margin, props.filterSigma, props.colorBy, props.drawing, drawAll]);
  // New slice images (e.g. another iteration of a map) or crop source:
  // forget the crops and filtered images and draw again
  useEffect(() => {
    crops.current = {};
    filteredImages.current.clear();
    for (const a of VIEW_ORDER) if (views.current[a]) views.current[a]!.drawn = null;
    drawAll();
  }, [props.loadCrop, props.loadImage, drawAll]);
  useEffect(() => () => {
    for (const a of VIEW_ORDER) window.clearTimeout(cropTimers.current[a]);
  }, []);

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
      pendContour.current = null;
      pendBorder.current = null;
      drawDrag.current = null;
      draft.current = null;
      VIEW_ORDER.forEach(drawOverlay);
    },
  }), [drawImage, drawOverlay]);

  /* ---------- contour and border tools: editing ---------- */
  // The click that ends the drag of a point or end does nothing
  const skipClick = useRef(false);
  const redrawAll = () => VIEW_ORDER.forEach(drawOverlay);
  const emitDrawing = (d: SliceDrawing) => {
    draft.current = null;
    p.current.onDrawing?.(d);
    redrawAll();
  };
  const current = (): SliceDrawing => shownDrawing() ?? { contours: [], borders: [] };
  /** The drawing with the contour of slice z replaced (null: removed). */
  const withContour = (d: SliceDrawing, z: number, c: SliceContour | null): SliceDrawing => ({
    ...d,
    contours: [...d.contours.filter((k) => k.z !== z), ...(c ? [c] : [])].sort((x, y) => x.z - y.z),
  });
  /** The contour of the shown Z slice and its point under (cx, cy), or -1. */
  const pickPoint = (v: View, cx: number, cy: number) => {
    const c = current().contours.find((k) => k.z === currentKey("z")) ?? null;
    let index = -1, best = PICK_PX;
    c?.points.forEach((q, i) => {
      const [x, y] = toPx(v, q[0], q[1]);
      const dd = Math.hypot(x - cx, y - cy);
      if (dd < best) { best = dd; index = i; }
    });
    return { c, index };
  };
  /** The border lines of the shown slice of a (indices in the borders). */
  const sliceBorders = (a: Axis) => current().borders
    .map((b, i) => [b, i] as [SliceBorder, number])
    .filter(([b]) => b.axis === a && b.index === currentKey(a));
  /** The border end under (cx, cy) of section a, or null. */
  const pickEnd = (a: Axis, v: View, cx: number, cy: number) => {
    let best = PICK_PX, hit: { border: number; end: 0 | 1 } | null = null;
    for (const [b, i] of sliceBorders(a)) {
      b.points.forEach((q, e) => {
        const [x, y] = toPx(v, q[0], q[1]);
        const dd = Math.hypot(x - cx, y - cy);
        if (dd < best) { best = dd; hit = { border: i, end: e as 0 | 1 }; }
      });
    }
    return hit as { border: number; end: 0 | 1 } | null;
  };
  /** The border line under (cx, cy) of section a (its index), or -1. */
  const pickLine = (a: Axis, v: View, cx: number, cy: number) => {
    let best = PICK_PX, hit = -1;
    for (const [b, i] of sliceBorders(a)) {
      const [dd] = segmentDistance([cx, cy], toPx(v, b.points[0][0], b.points[0][1]),
                                   toPx(v, b.points[1][0], b.points[1][1]));
      if (dd < best) { best = dd; hit = i; }
    }
    return hit;
  };
  const closePending = () => {
    const pc = pendContour.current;
    pendContour.current = null;
    if (pc && pc.points.length >= 3) emitDrawing(withContour(current(), pc.z, { z: pc.z, points: pc.points }));
    else redrawAll();
  };
  /** Whether the tool draws on section a: contours on Z, borders on Y and X,
   * move on all; the other sections keep the select behaviour. */
  const toolOn = (a: Axis) => Boolean(p.current.onDrawing)
    && ((p.current.mode === "contour" && a === "z") || (p.current.mode === "border" && a !== "z")
        || p.current.mode === "move");

  const drawDown = (a: Axis, e: React.MouseEvent) => {
    const v = views.current[a]!, [cx, cy] = local(a, e);
    skipClick.current = false;
    if (p.current.mode === "move") {
      drawDrag.current = { a, type: "move", base: current(), start: toVox(v, cx, cy), moved: false };
    } else if (a === "z") {
      if (pendContour.current) return;
      const { index } = pickPoint(v, cx, cy);
      if (index >= 0) drawDrag.current = { a, type: "point", index, moved: false };
    } else {
      if (pendBorder.current) return;
      const hit = pickEnd(a, v, cx, cy);
      if (hit) drawDrag.current = { a, type: "end", ...hit, moved: false };
    }
    if (drawDrag.current) e.preventDefault();
  };
  const drawMove = (a: Axis, v: View) => {
    const dd = drawDrag.current;
    if (!dd || dd.a !== a || !v.hover) return false;
    const [h, vv] = toVox(v, v.hover[0], v.hover[1]);
    const [W, H] = p.current.size[a];
    const q: [number, number] = [Math.max(0, Math.min(W, h)), Math.max(0, Math.min(H, vv))];
    dd.moved = true;
    const d = current();
    if (dd.type === "move") {
      // The drag in voxels of the section, along its two axes
      const [ha, va] = HV[a], delta: Vec3 = { x: 0, y: 0, z: 0 };
      delta[ha] = h - dd.start[0];
      delta[va] = vv - dd.start[1];
      draft.current = translateDrawing(dd.base, delta, p.current.dim);
    } else if (dd.type === "point") {
      const key = currentKey("z");
      const c = d.contours.find((k) => k.z === key);
      if (!c) return true;
      draft.current = withContour(d, key, { z: key, points: c.points.map((o, i) => (i === dd.index ? q : o)) });
    } else {
      draft.current = { ...d, borders: d.borders.map((b, i) => (i !== dd.border ? b : {
        ...b, points: (dd.end === 0 ? [q, b.points[1]] : [b.points[0], q]) as SliceBorder["points"] })) };
    }
    redrawAll();
    return true;
  };
  const drawClick = (a: Axis, v: View, cx: number, cy: number) => {
    if (skipClick.current) {
      skipClick.current = false;
      return;
    }
    if (p.current.mode === "move") return;
    const [h, vv] = toVox(v, cx, cy);
    const key = currentKey(a);
    if (isBorderAxis(a)) {
      let pb = pendBorder.current;
      if (pb && (pb.a !== a || pb.index !== key)) pb = pendBorder.current = null;
      if (pb) {
        pendBorder.current = null;
        const A = toPx(v, pb.start[0], pb.start[1]);
        // A click on the start again: no line
        if (Math.hypot(A[0] - cx, A[1] - cy) <= PICK_PX) redrawAll();
        else emitDrawing({ ...current(), borders: addBorder(current().borders,
          { axis: a, index: key, points: [pb.start, [h, vv]] }, p.current.dim.z) });
        return;
      }
      if (pickEnd(a, v, cx, cy)) return;
      pendBorder.current = { a, index: key, start: [h, vv] };
      redrawAll();
      return;
    }
    let pc = pendContour.current;
    if (pc && pc.z !== key) pc = pendContour.current = null;
    if (pc) {
      const f = toPx(v, pc.points[0][0], pc.points[0][1]);
      if (pc.points.length >= 3 && Math.hypot(f[0] - cx, f[1] - cy) <= PICK_PX) closePending();
      else {
        pc.points.push([h, vv]);
        redrawAll();
      }
      return;
    }
    const { c, index } = pickPoint(v, cx, cy);
    if (index >= 0) return;
    if (c) {
      // On an edge of the contour: a new point there
      let edge = -1, best = PICK_PX;
      c.points.forEach((q, i) => {
        const r = c.points[(i + 1) % c.points.length];
        const [dd] = segmentDistance([cx, cy], toPx(v, q[0], q[1]), toPx(v, r[0], r[1]));
        if (dd < best) { best = dd; edge = i; }
      });
      if (edge >= 0) {
        const points = [...c.points];
        points.splice(edge + 1, 0, [h, vv]);
        emitDrawing(withContour(current(), key, { z: key, points }));
        return;
      }
    }
    pendContour.current = { z: key, points: [[h, vv]] };
    redrawAll();
  };
  const drawDoubleClick = (a: Axis) => {
    const pc = pendContour.current;
    if (a !== "z" || !pc) return;
    // The clicks of the double-click added the same point twice
    const v = views.current.z!, px = (q: [number, number]) => toPx(v, q[0], q[1]);
    while (pc.points.length > 1) {
      const n = pc.points.length, A = px(pc.points[n - 1]), B = px(pc.points[n - 2]);
      if (Math.hypot(A[0] - B[0], A[1] - B[1]) > PICK_PX) break;
      pc.points.pop();
    }
    closePending();
  };
  const drawContextMenu = (a: Axis, e: React.MouseEvent) => {
    if (p.current.mode === "move") return;
    e.preventDefault();
    const v = views.current[a]!, [cx, cy] = local(a, e);
    if (a !== "z") {
      if (pendBorder.current) {
        pendBorder.current = null;
        redrawAll();
        return;
      }
      const i = pickLine(a, v, cx, cy);
      if (i >= 0) emitDrawing({ ...current(), borders: current().borders.filter((_b, j) => j !== i) });
      return;
    }
    const pc = pendContour.current;
    if (pc) {
      pc.points.pop();
      if (!pc.points.length) pendContour.current = null;
      redrawAll();
      return;
    }
    const { c, index } = pickPoint(v, cx, cy);
    if (!c || index < 0) return;
    const points = c.points.filter((_q, i) => i !== index);
    emitDrawing(withContour(current(), c.z, points.length >= 3 ? { z: c.z, points } : null));
  };

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
      const dd = drawDrag.current;
      if (dd) {
        drawDrag.current = null;
        skipClick.current = dd.moved;
        if (dd.moved && draft.current) emitDrawing(draft.current);
      }
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
    } else if (toolOn(a)) {
      if (!drawMove(a, v) && (pendContour.current || pendBorder.current)) drawOverlay(a);
    } else if (pend.current[a]) drawOverlay(a);
  };

  const onMouseDown = (a: Axis, e: React.MouseEvent) => {
    if (e.button !== 0) return;
    const mode = p.current.mode;
    if (toolOn(a)) {
      drawDown(a, e);
      return;
    }
    if (mode === "zoom" || mode === "pan") {
      const [x, y] = local(a, e);
      drag.current = { a, type: mode, x0: x, y0: y, x, y };
      e.preventDefault();
    }
  };

  const onClick = (a: Axis, e: React.MouseEvent) => {
    const v = views.current[a];
    if (!v) return;
    const { mode, partsOn, particles: P, pos, tolerance, dim: d, rulers, particleSet: S, setShown } = p.current;
    const [cx, cy] = local(a, e);
    if (toolOn(a)) {
      drawClick(a, v, cx, cy);
      return;
    }
    const [h, vv] = toVox(v, cx, cy);
    const [ha, va] = HV[a];
    // The drawing tools select on the sections they do not draw on
    const selecting = mode === "select" || ((mode === "contour" || mode === "border") && Boolean(p.current.onDrawing));
    if (P && partsOn && (selecting || mode === null)) {
      let best = -1, bd = 10;
      for (let i = 0; i < P.x.length; i++) {
        if (Math.abs(P[a][i] - pos[a]) > tolerance) continue;
        if (S && setShown && !setShown[S[i]]) continue;
        const q = toPx(v, P[ha][i] + 0.5, P[va][i] + 0.5);
        const dd = Math.hypot(q[0] - cx, q[1] - cy);
        if (dd < bd) { bd = dd; best = i; }
      }
      if (best >= 0) {
        p.current.onParticle(best);
        return;
      }
    }
    if (selecting) {
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

  const cursor = props.mode === "pan" || (props.mode === "move" && props.onDrawing) ? "grab"
    : props.mode ? "crosshair" : "default";

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
        onDoubleClick={() => { if (toolOn(a)) drawDoubleClick(a); }}
        onContextMenu={(e) => { if (toolOn(a)) drawContextMenu(a, e); }}
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
      <div className={styles.gridCorner}>{props.corner}</div>
      {figure("z")}
      {figure("x")}
      {slider("z")}
      {slider("x")}
    </div>
  );
});

export default VolumeSlices;
