// src/components/viewers/TiltSeriesViewer.tsx
//
// A tilt series to check its alignment: the tilt images (sorted by tilt
// angle) with a slider labelled "Movie index 25 · tilt -24.0°", a play
// button (back and forth) and the arrow keys to run through them, and the
// RELION alignment of each tilt (rlnTomoZRot, the X / Y shifts in Å and the
// local alignment, rlnTomoDeformationCoefficients, of the per tilt series
// STAR) applied on demand: every tilt drawn in one frame with the tilt axis
// vertical, so a well aligned series rocks smoothly about it. Tools: zoom
// (drag a rectangle), ruler (Å), invert contrast, the Alignment panel and
// return (undo the last zoom, measurement or contrast change; with nothing
// left it deactivates the tool). The values of the current tilt are in a
// line below the slider. The parts are in tiltseries/:
//   alignment.ts                the RELION geometry, the warp, the correlation
//   AlignmentPanel.tsx          none, global or global + local (radio, applied on click), what is shown
//   useNeighbourCorrelation.ts  how well each tilt lines up with its neighbours
//   AlignmentPlot.tsx           the alignment and that correlation against the tilt angle
//   tilts.ts                    labels and numbers
// Content: pane {kind: "tiltSeries"} (TableViewerTiltSeriesContent),
// built by EMhub's build_tilt_series_viewer_pane_content. Mountable:
//   EMFlow.mount("TiltSeriesViewer", {container, props: {content}})
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Slider } from "@mui/material";
import {
  Contrast,
  Maximize2,
  Minimize2,
  Pause,
  Play,
  Ruler as RulerIcon,
  Undo2,
  ZoomIn,
} from "lucide-react";
import { useDataLoader } from "@/data/DataLoaderContext";
import type { TableViewerTiltSeriesContent, TiltSeriesTilt } from "@/services/ProjectService";
import { ToolButton } from "./VolumeViewer";
import {
  deformationAt,
  deformationSupported,
  frameOf,
  greyOf,
  hasAlign,
  rawPoint,
  toImageData,
  VIEW_APPLY,
  warpTilt,
  type Geometry,
  type Pt,
  type View,
} from "./tiltseries/alignment";
import AlignmentPlot, { VIEW_COLOR, VIEW_LABEL } from "./tiltseries/AlignmentPlot";
import { fmt, median, tiltLabel } from "./tiltseries/tilts";
import useNeighbourCorrelation from "./tiltseries/useNeighbourCorrelation";
import AlignmentPanel, { type AlignmentOptions } from "./tiltseries/AlignmentPanel";
import vvStyles from "./VolumeViewer.module.css";
import styles from "./TiltSeriesViewer.module.css";

type Win = { x0: number; y0: number; w: number; h: number };
type Mode = "zoom" | "ruler" | null;
type Line = { a: Pt; b: Pt };
type HistoryEntry =
  | { type: "zoom"; prev: Win | null }
  | { type: "ruler"; prev: Line | null }
  | { type: "invert" };

const FPS = [2, 4, 8, 12];
/** Fitted viewers shorter than this hide the plot until it is asked for. */
const PLOT_MIN_HEIGHT = 560;
/** The local deformation is drawn this many times larger. */
const FIELD_SCALE = 10;
const AXIS_COLOR = "rgba(56, 189, 248, 0.85)";
const RULER_COLOR = "#f97316";
// The local deformation, in the color of "global + local" in the plot
const FIELD_COLOR = VIEW_COLOR.both;
const DEG = Math.PI / 180;

/** The choices of the last viewer, for the next tilt series (another row,
 * or a viewer mounted anew by the host, e.g. the OTF dashboard). */
const remembered = {
  aligned: false,
  local: true,
  showField: false,
  showAxis: true,
  plotChoice: null as boolean | null,
  fps: 4,
  inverted: false,
};

const svg = (children: React.ReactNode) => (
  <svg width={16} height={16} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.3}
       strokeLinecap="round" strokeLinejoin="round">
    {children}
  </svg>
);
// A tilted image with the axis it rocks about and the rocking arrow
const ICON_TILT_AXIS = svg(<>
  <path d="M3.5 3.5l9-1.5v12l-9-1.5z" />
  <path d="M8 0.8v14.4" strokeDasharray="1.6 1.4" />
  <path d="M4.2 7.2q3.8 2 7.6 0" />
  <path d="M10.6 6.2l1.2 1-1.5.4" />
</>);
export default function TiltSeriesViewer({
  content,
  fit = false,
  expandable = false,
}: {
  content: TableViewerTiltSeriesContent;
  /** Fit to the container height (grid cell, right pane). */
  fit?: boolean;
  /** An expand button at the end of the toolbar lays the viewer over the
   * whole browser window (Esc or the button to go back), e.g. the OTF
   * dashboard, where the viewer is kept as high as the tomogram's. */
  expandable?: boolean;
}) {
  const loader = useDataLoader();
  const tilts = content.tilts ?? [];
  const n = tilts.length;
  const [w, h] = content.imageSize ?? [512, 512];
  const px = content.pixelSize && content.pixelSize > 0 ? content.pixelSize : null;
  const canAlign = content.hasAlignment && px != null;
  const hasLocal = canAlign && deformationSupported(content.deformation)
    && tilts.some((t) => t.deformation?.length);

  /* ---------- state ---------- */
  const [index, setIndex] = useState(() => {
    // The tilt nearest 0°, else the middle one
    let best = Math.floor(n / 2), err = Infinity;
    tilts.forEach((t, i) => {
      if (t.tiltAngle != null && Math.abs(t.tiltAngle) < err) { err = Math.abs(t.tiltAngle); best = i; }
    });
    return best;
  });
  // Kept for the next tilt series; applied only when it has an alignment
  const [alignChoice, setAligned] = useState(remembered.aligned);
  const aligned = alignChoice && canAlign;
  // With the global alignment, the local one too (as RELION projects)
  const [useLocal, setUseLocal] = useState(remembered.local);
  const [showField, setShowField] = useState(remembered.showField);
  const [showAxis, setShowAxis] = useState(remembered.showAxis);
  // null: shown unless fitted into a short container (a grid cell), where
  // the image needs the room; the plot option decides from then on
  const [plotChoice, setPlotChoice] = useState<boolean | null>(remembered.plotChoice);
  const [rootHeight, setRootHeight] = useState(Infinity);
  const [playing, setPlaying] = useState(false);
  const playDir = useRef(1);
  const [fps, setFps] = useState(remembered.fps);
  const [mode, setMode] = useState<Mode>(null);
  const [panelOpen, setPanelOpen] = useState(false);
  // Expanded over the whole browser window (not the Fullscreen API): then
  // it fits the window, as a grid cell
  const [full, setFull] = useState(false);
  const fitted = fit || full;
  const panelRef = useRef<HTMLSpanElement>(null);
  const [inverted, setInverted] = useState(remembered.inverted);
  const [win, setWin] = useState<Win | null>(null);
  const [ruler, setRuler] = useState<Line | null>(null);
  const [pending, setPending] = useState<Pt | null>(null);   // first ruler point
  const [hover, setHover] = useState<Pt | null>(null);
  const [drag, setDrag] = useState<{ a: Pt; b: Pt } | null>(null);   // zoom rectangle (frame)
  const history = useRef<HistoryEntry[]>([]);
  const cur = Math.min(Math.max(index, 0), Math.max(n - 1, 0));
  const tilt: TiltSeriesTilt | undefined = tilts[cur];
  const withLocal = hasLocal && useLocal;
  const view: View = !aligned ? "raw" : withLocal ? "both" : "global";
  // Drawn in the aligned frame, else the image's
  const rotated = aligned;

  useEffect(() => {
    Object.assign(remembered, { aligned: alignChoice, local: useLocal, showField, showAxis, plotChoice, fps, inverted });
  }, [alignChoice, useLocal, showField, showAxis, plotChoice, fps, inverted]);

  const firstContent = useRef(true);
  useEffect(() => {
    // Another tilt series (the host may pass a copy of the same content,
    // e.g. TableViewerGrid, so it is told by its tilts): the zoom and ruler
    // start again, the choices (alignment, contrast, what is shown) stay
    if (firstContent.current) { firstContent.current = false; return; }
    history.current = [];
    setWin(null); setRuler(null); setPending(null); setPlaying(false);
    setIndex((i) => Math.min(i, Math.max(n - 1, 0)));
  }, [tilts, n]);

  /* ---------- frame ---------- */
  // Aligned, every tilt is drawn in one frame: the image box rotated by the
  // median in-plane rotation, so the frame does not jump between tilts
  const theta0 = useMemo(
    () => -median(tilts.filter(hasAlign).map((t) => t.zRot as number)) * DEG,
    [tilts],
  );
  const alignedFrame = useMemo(() => {
    const cos = Math.abs(Math.cos(theta0)), sin = Math.abs(Math.sin(theta0));
    return { w: cos * w + sin * h, h: sin * w + cos * h };
  }, [theta0, w, h]);
  const frame = rotated ? alignedFrame : { w, h };
  const geom: Geometry = useMemo(() => ({
    w, h, px: px ?? 1, frameW: alignedFrame.w, frameH: alignedFrame.h,
    deformation: content.deformation ?? null,
  }), [w, h, px, alignedFrame, content.deformation]);

  /* ---------- size ---------- */
  const viewRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = rootRef.current;
    if (!fitted || !el) return undefined;
    const ro = new ResizeObserver(() => setRootHeight(el.clientHeight || Infinity));
    ro.observe(el);
    return () => ro.disconnect();
  }, [fitted]);
  const showPlot = plotChoice ?? (!fitted || rootHeight >= PLOT_MIN_HEIGHT);
  const [box, setBox] = useState({ w: 400, h: 300 });
  useLayoutEffect(() => {
    const el = viewRef.current;
    if (!el) return undefined;
    const measure = () => {
      const bw = el.clientWidth || 400;
      // Without a height to fit, the image box keeps the frame's aspect
      // (capped to most of the window)
      const bh = fitted ? el.clientHeight || 300
        : Math.min(bw * (frame.h / frame.w), window.innerHeight * 0.7);
      setBox((b) => (b.w === bw && Math.abs(b.h - bh) < 0.5 ? b : { w: bw, h: bh }));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    window.addEventListener("resize", measure);
    return () => { ro.disconnect(); window.removeEventListener("resize", measure); };
  }, [fitted, frame.w, frame.h]);

  // Frame -> screen: the zoom window (or the whole frame) fitted and centred
  const screen = useMemo(() => {
    const v = win ?? { x0: 0, y0: 0, w: frame.w, h: frame.h };
    const k = Math.min(box.w / v.w, box.h / v.h);
    return { k, ox: (box.w - v.w * k) / 2 - v.x0 * k, oy: (box.h - v.h * k) / 2 - v.y0 * k };
  }, [win, frame.w, frame.h, box]);
  const toScreen = (p: Pt): Pt => ({ x: p.x * screen.k + screen.ox, y: p.y * screen.k + screen.oy });
  const fromScreen = (p: Pt): Pt => ({ x: (p.x - screen.ox) / screen.k, y: (p.y - screen.oy) / screen.k });

  /* ---------- images ---------- */
  const images = useRef(new Map<number, HTMLImageElement>());
  const greys = useRef(new Map<number, Float32Array>());
  const warped = useRef(new Map<string, HTMLCanvasElement>());
  const [loaded, setLoaded] = useState(0);
  useEffect(() => {
    images.current = new Map();
    greys.current = new Map();
    warped.current = new Map();
    let live = true;
    // The current tilt first, then the others for playing
    const order = [cur, ...tilts.map((_, i) => i).filter((i) => i !== cur)];
    order.forEach((i) => {
      loader.image(tilts[i].image).then((img) => {
        if (!live) return;
        images.current.set(i, img);
        setLoaded((v) => v + 1);
      }, () => undefined);
    });
    return () => { live = false; };
    // Loaded once per content; cur only orders the first load
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loader, tilts]);
  const greyAt = useCallback((i: number): Float32Array | null => {
    const g = greys.current.get(i);
    if (g) return g;
    const img = images.current.get(i);
    if (!img) return null;
    const out = greyOf(img, w, h);
    greys.current.set(i, out);
    return out;
  }, [w, h]);
  /** A tilt drawn with the alignment of `v` (cached), as a canvas of its frame size. */
  const warpedAt = useCallback((i: number, v: View): HTMLCanvasElement | null => {
    const key = `${v}:${i}`;
    const hit = warped.current.get(key);
    if (hit) return hit;
    const grey = greyAt(i);
    if (!grey) return null;
    const g = warpTilt(grey, geom, tilts[i], VIEW_APPLY[v], theta0, 1);
    const c = document.createElement("canvas");
    c.width = g.w;
    c.height = g.h;
    c.getContext("2d")?.putImageData(toImageData(g), 0, 0);
    warped.current.set(key, c);
    return c;
  }, [greyAt, geom, tilts, theta0]);

  /* ---------- neighbour correlation ---------- */
  const views: View[] = useMemo(
    () => (canAlign ? (hasLocal ? ["raw", "global", "both"] : ["raw", "global"]) : ["raw"]),
    [canAlign, hasLocal],
  );
  const metrics = useNeighbourCorrelation({
    ready: loaded >= n && n > 0, n, views, greyAt, geom, pixelSize: px, tilts, theta0,
  });

  /* ---------- drawing ---------- */
  const imageCanvas = useRef<HTMLCanvasElement>(null);
  const overlayCanvas = useRef<HTMLCanvasElement>(null);
  const dpr = typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;

  const setup = (canvas: HTMLCanvasElement | null) => {
    if (!canvas) return null;
    const cw = Math.round(box.w * dpr), ch = Math.round(box.h * dpr);
    if (canvas.width !== cw || canvas.height !== ch) {
      canvas.width = cw; canvas.height = ch;
      canvas.style.width = `${box.w}px`; canvas.style.height = `${box.h}px`;
    }
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, cw, ch);
    return ctx;
  };

  useEffect(() => {
    const ctx = setup(imageCanvas.current);
    if (!ctx) return;
    // frame -> canvas pixels
    ctx.setTransform(screen.k * dpr, 0, 0, screen.k * dpr, screen.ox * dpr, screen.oy * dpr);
    ctx.imageSmoothingEnabled = true;
    if (view === "raw") {
      const img = images.current.get(cur);
      if (img) ctx.drawImage(img, 0, 0, w, h);
    } else {
      const c = warpedAt(cur, view);
      const f = frameOf(geom, VIEW_APPLY[view]);
      if (c) ctx.drawImage(c, 0, 0, f.w, f.h);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cur, loaded, screen, view, box, w, h, dpr, warpedAt, geom]);

  useEffect(() => {
    const ctx = setup(overlayCanvas.current);
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const seg = (a: Pt, b: Pt, color: string, width = 1.5, dash: number[] = []) => {
      const sa = toScreen(a), sb = toScreen(b);
      ctx.save();
      ctx.strokeStyle = color; ctx.lineWidth = width; ctx.setLineDash(dash);
      ctx.beginPath(); ctx.moveTo(sa.x, sa.y); ctx.lineTo(sb.x, sb.y); ctx.stroke();
      ctx.restore();
    };
    // The tilt axis: vertical through the frame centre when aligned; else
    // through the tomogram centre projected on this tilt (centre + shift)
    // at rlnTomoZRot, or the nominal tilt axis through the image centre
    if (showAxis && tilt) {
      const L = Math.hypot(frame.w, frame.h);
      let p: Pt | null = null, d: Pt | null = null;
      if (rotated) {
        p = { x: frame.w / 2, y: frame.h / 2 }; d = { x: 0, y: 1 };
      } else {
        const ok = hasAlign(tilt) && px != null;
        const deg = ok ? tilt.zRot : content.tiltAxisAngle;
        if (deg != null) {
          const a = deg * DEG;
          // R(zRot) (0, 1)
          d = { x: -Math.sin(a), y: Math.cos(a) };
          p = ok ? { x: w / 2 + (tilt.shiftX as number) / (px as number), y: h / 2 + (tilt.shiftY as number) / (px as number) }
            : { x: w / 2, y: h / 2 };
        }
      }
      if (p && d) seg({ x: p.x - d.x * L, y: p.y - d.y * L }, { x: p.x + d.x * L, y: p.y + d.y * L }, AXIS_COLOR, 1.5, [6, 4]);
    }
    // The local deformation of this tilt, FIELD_SCALE times larger: in the
    // image as acquired, or turned into the aligned frame
    if (showField && hasLocal && tilt?.deformation) {
      const N = 7;
      const a = hasAlign(tilt) ? -(tilt.zRot as number) * DEG : theta0;
      ctx.save();
      ctx.strokeStyle = FIELD_COLOR; ctx.fillStyle = FIELD_COLOR; ctx.lineWidth = 1.5;
      for (let j = 0; j < N; j++) {
        for (let i = 0; i < N; i++) {
          let at: Pt, imgPt: Pt;
          if (rotated) {
            at = { x: ((i + 0.5) / N) * frame.w, y: ((j + 0.5) / N) * frame.h };
            imgPt = rawPoint(geom, tilt, VIEW_APPLY.global, theta0, at.x, at.y);
            if (imgPt.x < 0 || imgPt.y < 0 || imgPt.x > w || imgPt.y > h) continue;
          } else {
            at = imgPt = { x: ((i + 0.5) / N) * w, y: ((j + 0.5) / N) * h };
          }
          const dd = deformationAt(geom, tilt, imgPt.x, imgPt.y);
          if (!dd) continue;
          // The image shift as seen in the frame drawn
          const v = rotated
            ? { x: Math.cos(a) * dd.x - Math.sin(a) * dd.y, y: Math.sin(a) * dd.x + Math.cos(a) * dd.y }
            : dd;
          const s = toScreen(at), e = toScreen({ x: at.x + v.x * FIELD_SCALE, y: at.y + v.y * FIELD_SCALE });
          ctx.beginPath(); ctx.arc(s.x, s.y, 1.8, 0, Math.PI * 2); ctx.fill();
          ctx.beginPath(); ctx.moveTo(s.x, s.y); ctx.lineTo(e.x, e.y); ctx.stroke();
          const ang = Math.atan2(e.y - s.y, e.x - s.x), hl = Math.min(6, Math.hypot(e.x - s.x, e.y - s.y) / 2);
          ctx.beginPath();
          ctx.moveTo(e.x, e.y); ctx.lineTo(e.x - hl * Math.cos(ang - 0.45), e.y - hl * Math.sin(ang - 0.45));
          ctx.moveTo(e.x, e.y); ctx.lineTo(e.x - hl * Math.cos(ang + 0.45), e.y - hl * Math.sin(ang + 0.45));
          ctx.stroke();
        }
      }
      ctx.font = "11px sans-serif";
      ctx.fillText(`local deformation ×${FIELD_SCALE}`, 8, box.h - 8);
      ctx.restore();
    }
    const dot = (p: Pt) => {
      const s = toScreen(p);
      ctx.fillStyle = RULER_COLOR; ctx.beginPath(); ctx.arc(s.x, s.y, 3, 0, Math.PI * 2); ctx.fill();
    };
    if (ruler) { seg(ruler.a, ruler.b, RULER_COLOR, 2); dot(ruler.a); dot(ruler.b); }
    if (mode === "ruler" && pending) {
      dot(pending);
      if (hover) seg(pending, hover, RULER_COLOR, 1.5, [4, 3]);
    }
    if (drag) {
      const a = toScreen(drag.a), b = toScreen(drag.b);
      ctx.save();
      ctx.strokeStyle = "#fff"; ctx.setLineDash([4, 3]); ctx.lineWidth = 1;
      ctx.strokeRect(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(b.x - a.x), Math.abs(b.y - a.y));
      ctx.restore();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showAxis, showField, tilt, rotated, ruler, pending, hover, drag, mode, screen, box, frame.w, frame.h, px, dpr, geom, theta0]);

  /* ---------- mouse ---------- */
  const eventPoint = (e: React.PointerEvent): Pt => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    return fromScreen({ x: e.clientX - r.left, y: e.clientY - r.top });
  };
  const onPointerDown = (e: React.PointerEvent) => {
    const p = eventPoint(e);
    if (mode === "zoom") {
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      setDrag({ a: p, b: p });
    } else if (mode === "ruler") {
      if (!pending) {
        setPending(p);
      } else {
        history.current.push({ type: "ruler", prev: ruler });
        setRuler({ a: pending, b: p });
        setPending(null);
      }
    }
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const p = eventPoint(e);
    if (drag) setDrag({ a: drag.a, b: p });
    else if (mode === "ruler" && pending) setHover(p);
  };
  const onPointerUp = () => {
    if (!drag) return;
    const x0 = Math.min(drag.a.x, drag.b.x), y0 = Math.min(drag.a.y, drag.b.y);
    const rw = Math.abs(drag.b.x - drag.a.x), rh = Math.abs(drag.b.y - drag.a.y);
    // A click or a tiny drag is not a zoom
    if (rw * screen.k > 6 && rh * screen.k > 6) {
      history.current.push({ type: "zoom", prev: win });
      setWin({ x0, y0, w: rw, h: rh });
    }
    setDrag(null);
  };

  /* ---------- tools ---------- */
  const setTool = (t: Exclude<Mode, null>) => {
    setMode((m) => (m === t ? null : t));
    setPending(null);
    setHover(null);
  };
  const toggleInvert = (isUndo: boolean) => {
    if (!isUndo) history.current.push({ type: "invert" });
    setInverted((v) => !v);
  };
  /* Return: each click undoes one zoom, measurement or contrast change;
     with nothing left to undo it only deactivates the tool. */
  const undo = () => {
    setPending(null);
    const e = history.current.pop();
    if (!e) setMode(null);
    else if (e.type === "zoom") setWin(e.prev);
    else if (e.type === "ruler") setRuler(e.prev);
    else toggleInvert(true);
  };
  // Aligned and unaligned tilts are drawn in different frames, so the zoom
  // and ruler of one do not apply to the other (the local alignment keeps
  // the frame, so they stay when it is switched)
  const chooseView = (v: View) => {
    const on = v !== "raw";
    if (on !== aligned) {
      setWin(null); setRuler(null); setPending(null);
      history.current = history.current.filter((e) => e.type === "invert");
    }
    setAligned(on);
    if (on) setUseLocal(v === "both");
  };

  /* ---------- alignment panel ---------- */
  const setAlignmentOptions = (o: Partial<AlignmentOptions>) => {
    if (o.showAxis !== undefined) setShowAxis(o.showAxis);
    if (o.showField !== undefined) setShowField(o.showField);
    if (o.showPlot !== undefined) setPlotChoice(o.showPlot);
  };
  // A click outside the panel (and its button) closes it. Esc closes the
  // panel, then collapses the expanded viewer; it is captured, so it does
  // not close a dialog around the viewer
  useEffect(() => {
    if (!panelOpen && !full) return undefined;
    const onDown = (e: MouseEvent) => {
      if (panelOpen && !panelRef.current?.contains(e.target as Node)) setPanelOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      e.preventDefault();
      if (panelOpen) setPanelOpen(false);
      else setFull(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey, true);
    };
  }, [panelOpen, full]);

  /* ---------- playing and keys ---------- */
  useEffect(() => {
    if (!playing || n < 2) return undefined;
    // Back and forth: first to last, then last to first
    const id = window.setInterval(() => setIndex((i) => {
      if (i + playDir.current < 0 || i + playDir.current > n - 1) playDir.current = -playDir.current;
      return i + playDir.current;
    }), 1000 / fps);
    return () => window.clearInterval(id);
  }, [playing, fps, n]);
  const step = (d: number) => {
    setPlaying(false);
    setIndex((i) => Math.min(Math.max(i + d, 0), n - 1));
  };
  const onKeyDown = (e: React.KeyboardEvent) => {
    if ((e.target as HTMLElement).closest("select, input")) return;
    if (e.key === "ArrowLeft" || e.key === "ArrowRight") step(e.key === "ArrowRight" ? 1 : -1);
    else if (e.key === " ") setPlaying((p) => !p);
    else return;
    // The keys are the viewer's, not the page's (EMhub's tilt series window)
    e.preventDefault();
    e.stopPropagation();
  };

  /* ---------- info and plot ---------- */
  const info = useMemo(() => {
    if (!tilt) return [];
    const parts: Array<[string, string]> = [];
    if (tilt.yTilt != null && (tilt.tiltAngle == null || Math.abs(tilt.yTilt - tilt.tiltAngle) >= 0.005)) {
      parts.push(["aligned tilt", `${fmt(tilt.yTilt, 2)}°`]);
    }
    if (tilt.xTilt) parts.push(["X tilt", `${fmt(tilt.xTilt, 2)}°`]);
    if (tilt.shiftX != null && tilt.shiftY != null) {
      parts.push(["shift", `X ${fmt(tilt.shiftX, 1)} Å, Y ${fmt(tilt.shiftY, 1)} Å`]);
    }
    if (tilt.zRot != null) parts.push(["rotation", `${fmt(tilt.zRot, 2)}°`]);
    if (tilt.dose != null) parts.push(["dose", `${fmt(tilt.dose, 1)} e⁻/Å²`]);
    if (tilt.defocusU != null) {
      const d = tilt.defocusV != null ? (tilt.defocusU + tilt.defocusV) / 2 : tilt.defocusU;
      parts.push(["defocus", `${fmt(d / 1e4, 2)} µm`]);
    }
    if (tilt.ctfMaxResolution != null && tilt.ctfMaxResolution > 0) {
      parts.push(["CTF fit", `${fmt(tilt.ctfMaxResolution, 1)} Å`]);
    }
    const cc = metrics?.[view]?.[cur];
    if (cc != null) parts.push(["neighbour CC", fmt(cc, 2)]);
    return parts;
  }, [tilt, metrics, view, cur]);

  if (!n) return <div className={styles.info} style={{ padding: 12 }}>No tilt images.</div>;

  const rulerText = ruler
    ? (() => {
        const d = Math.hypot(ruler.b.x - ruler.a.x, ruler.b.y - ruler.a.y);
        return px ? `${fmt(d * px, 1)} Å (${fmt(d, 1)} px)` : `${fmt(d, 1)} px`;
      })()
    : null;
  const cursor = mode ? "crosshair" : "default";
  const canPlot = content.hasAlignment || !!metrics;

  return (
    <div ref={rootRef} className={`${styles.root} ${fitted ? styles.fit : ""} ${full ? styles.full : ""}`}
         tabIndex={0} onKeyDown={onKeyDown}>
      <div className={vvStyles.toolbar}>
        <ToolButton title="Zoom: drag a rectangle over the region to enlarge" active={mode === "zoom"}
                    onClick={() => setTool("zoom")}>
          <ZoomIn size={16} />
        </ToolButton>
        <ToolButton title="Ruler: click two points to measure" active={mode === "ruler"}
                    onClick={() => setTool("ruler")}>
          <RulerIcon size={16} />
        </ToolButton>
        <ToolButton title="Invert the contrast" active={inverted} onClick={() => toggleInvert(false)}>
          <Contrast size={16} />
        </ToolButton>
        <span className={vvStyles.sep} />
        {/* The alignment, applied from a panel (as the particles of VolumeViewer) */}
        <span ref={panelRef} className={vvStyles.panelAnchor}>
          <ToolButton title={aligned ? `Alignment: ${VIEW_LABEL[view]} applied` : "Alignment: none, global or global + local, tilt axis, local deformation, plot"}
                      active={panelOpen} onClick={() => setPanelOpen((v) => !v)}>
            <span className={`${styles.icon} ${aligned ? styles.appliedIcon : ""}`}>{ICON_TILT_AXIS}</span>
          </ToolButton>
          {panelOpen && (
            <AlignmentPanel view={view} onView={chooseView} showAxis={showAxis} showField={showField} showPlot={showPlot}
                            canAlign={canAlign} hasLocal={hasLocal}
                            localLabel={`${content.deformation?.type ?? ""} ${content.deformation?.gridSize?.join(" × ") ?? ""}`}
                            fieldScale={FIELD_SCALE} canPlot={canPlot} onChange={setAlignmentOptions} />
          )}
        </span>
        <ToolButton title="Return: undo the last zoom, measurement or contrast change, or deactivate the tool"
                    onClick={undo}>
          <Undo2 size={16} />
        </ToolButton>
        {expandable && (
          <span className={styles.expand}>
            <ToolButton title={full ? "Back to the page (Esc)" : "Expand to the browser window"}
                        onClick={() => setFull((v) => !v)}>
              {full ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
            </ToolButton>
          </span>
        )}
      </div>

      <div ref={viewRef} className={styles.view} style={fitted ? undefined : { height: box.h }}>
        <canvas ref={imageCanvas} style={{ filter: inverted ? "invert(1)" : undefined }} />
        <canvas ref={overlayCanvas} style={{ cursor }}
                onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp}
                onPointerLeave={() => setHover(null)} />
      </div>

      <div className={styles.sliderRow}>
        <button type="button" className={styles.playBtn} title={playing ? "Pause (Space)" : "Play through the tilts, back and forth (Space; ← → step)"}
                onClick={() => setPlaying((p) => !p)}>
          {playing ? <Pause size={14} /> : <Play size={14} />}
        </button>
        <select value={fps} title="Tilts per second" onChange={(e) => setFps(Number(e.target.value))}>
          {FPS.map((f) => <option key={f} value={f}>{f}/s</option>)}
        </select>
        <Slider size="small" min={0} max={Math.max(n - 1, 0)} step={1} value={cur}
                onChange={(_, v) => { setPlaying(false); setIndex(Array.isArray(v) ? v[0] : v); }}
                sx={{ flex: 1, mx: 1 }} />
        <span className={styles.label}>{tilt ? tiltLabel(tilt, cur) : ""}</span>
      </div>

      <div className={styles.info}>
        {info.map(([k, v], i) => (
          <span key={k}>{i ? " · " : ""}{k} <b>{v}</b></span>
        ))}
        {rulerText && <span>{info.length ? " · " : ""}ruler <b>{rulerText}</b></span>}
        <span>{info.length || rulerText ? " · " : ""}{cur + 1} of {n}</span>
      </div>
      {rotated && tilt && !hasAlign(tilt) && (
        <div className={styles.warn}>This tilt has no alignment in the STAR: drawn rotated by the median rotation only.</div>
      )}
      {aligned && content.deformation && !deformationSupported(content.deformation) && (
        <div className={styles.warn}>Local alignment of type “{content.deformation.type}” is not drawn (only spline).</div>
      )}

      {showPlot && canPlot && (
        <AlignmentPlot tilts={tilts} hasAlignment={content.hasAlignment} metrics={metrics} cur={cur}
                       width={box.w} onSelect={(i) => { setPlaying(false); setIndex(i); }} />
      )}
    </div>
  );
}
