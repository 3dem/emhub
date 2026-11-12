// src/components/viewers/VolumeViewer.tsx
//
// Config-driven volume viewer (tomograms, maps) with up to three tabs:
//   - Slices: linked X/Y/Z sections (volume/VolumeSlices.tsx) with select,
//     ruler, zoom and pan tools, contrast, crosshair and particles; zoomed,
//     the host's full-resolution crop of the view (`crop`) is drawn over the
//     slice image.
//   - 3D planes: three orthogonal planes in a rotatable scene, at most two
//     shown, the volume around them (its densest voxels, from the `density`
//     grid) and the particles as dots, spheres (oriented by an arrow) or
//     their template (volume/VolumeScene3D.ts).
//   - 3D volume: the density as an iso-surface with its histogram, threshold,
//     opacity and inverted contrast (volume/IsoSurfaceView.tsx); only with a
//     `density`. A Relion map (`iterations`) can be played through the
//     iterations of its job, with their resolution and FSC
//     (volume/IterationsBar.tsx); the Slices of a map have an iteration select.
// Slice images (Slices, 3D planes) can be denoised (volume/DenoisePanel.tsx).
// Each tab fits the room it has (the container, the window below it or the
// whole window when expanded): the rest of the tab is measured.
// An optional `mask` (a sphere or another map) is drawn over the 3D volume
// and the slices, with its options in a panel (volume/MaskPanel.tsx).
// The slices are the host's images (`axes`) or, without them, drawn from the
// density grid, so a small map is sent once for both tabs. The data is given
// inline (`data`) or loaded with the DataLoader (`source`, e.g. EMhub's
// resolve_table_view_pane), and so is the density (loaded when needed).
// Which tabs, tools and defaults are used is set per use (VolumeViewerConfig,
// e.g. a pane's viewerConfig). Mountable from the host:
//   EMFlow.mount("VolumeViewer", {container, props: {data | source, ...config}})
// and its handle (`instance`) has getPosition / setPosition / setTool.
// The expand button lays it over the whole browser window (Esc to go back).
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  ChartLine,
  Contrast,
  Crosshair,
  EyeOff,
  Maximize,
  Minimize,
  Move,
  Loader2,
  Rainbow,
  RefreshCw,
  Ruler as RulerIcon,
  Sparkles,
  Undo2,
  ZoomIn,
} from "lucide-react";
import styles from "./VolumeViewer.module.css";
import { useDataLoader, useLoad } from "@/data/DataLoaderContext";
import VolumeSlices, {
  type HistoryEntry,
  type Mode,
  type SliceColorBy,
  type SliceMask,
  type VolumeSlicesHandle,
} from "./volume/VolumeSlices";
import { VolumeScene3D, type ParticleDraw, type SceneState } from "./volume/VolumeScene3D";
import ParticlesPanel, { type ParticleOptions } from "./volume/ParticlesPanel";
import DenoisePanel from "./volume/DenoisePanel";
import { DETAILS } from "./volume/DensityPanel";
import IterationsBar from "./volume/IterationsBar";
import MaskPanel, { type MaskOptions } from "./volume/MaskPanel";
import ResolutionPanel, { type ResolutionStats } from "./volume/ResolutionPanel";
import IsoSurfaceView, {
  type DensityDebug,
  type IsoDefaults,
  type ColorByInput,
  ColorKey,
  type IsoMaskInput,
  type IsoSurfaceHandle,
  maskThreshold,
} from "./volume/IsoSurfaceView";
import { densitySlice, densitySliceKeys, densityValues, prepareDensity } from "./volume/densityGrid";
import {
  AXES,
  clampVox,
  isDensitySource,
  mapValueRange,
  normVoxel,
  rulerLength,
  scaleText,
  sectionSize,
  sliceKeys,
  volumeDataFromPane,
  type Axis,
  type DensitySource,
  type Ruler,
  type SliceImage,
  type CropRequest,
  type MapIterations,
  type Vec3,
  type VolumeCrop,
  type VolumeData,
  type VolumeDensity,
} from "./volume/volumeMath";

export type { VolumeData, VolumeDensity } from "./volume/volumeMath";

export type VolumeViewerTab = "slices" | "view3d" | "volume3d";

/** Initial state of the options (the user can change them). */
export type VolumeViewerDefaults = {
  particles?: {
    /** Shown (true). */
    show?: boolean;
    /** Only those near the sections in Slices (true) / the planes in 3D planes (false). */
    nearSlices?: boolean;
    near3d?: boolean;
    /** Slab half-thickness of "near", voxels (10). */
    tolerance?: number;
    /** CSS hex (#ffa500). */
    color?: string;
    /** Drawn as the oriented template (false: dots); see drawAs. */
    template?: boolean;
    /** 3D planes: "dots", "sphere" (with an arrow along the orientation when
     * there are angles) or "template" (needs one); by default "template"
     * with `template: true`, else "dots". */
    drawAs?: ParticleDraw;
    /** Sphere radius in voxels (the template's, or 8). */
    sphereRadius?: number;
  };
  /** Shown planes of 3D planes, at most two (["z", "y"]). */
  planes?: Axis[];
  /** Inverted contrast, of every tab (false; iso.below when not given): in
   * 3D volume it encloses the dark density. */
  inverted?: boolean;
  /** 3D volume: threshold or share of voxels enclosed, dark density, opacity,
   * color and detail of the grid (see IsoDefaults). */
  iso?: IsoDefaults;
};

/** Mask drawn over the 3D volume and the slices, translucent: a sphere or
 * another map. */
export type VolumeMask = (
  | {
      type: "sphere";
      /** Diameter in Å (needs the voxel size), or `diameterPx` in voxels;
       * by default 80% of the smallest side. */
      diameter?: number;
      diameterPx?: number;
      /** Centre in voxels (the centre of the box). */
      center?: Partial<Vec3>;
    }
  | {
      type: "map";
      /** The mask, on the same box as the volume: a density grid or a
       * request loaded with the DataLoader (as the volume's `density`). */
      density: VolumeDensity | DensitySource;
      /** Threshold in map units (0.5 for a 0-1 mask, else the middle of its
       * range). */
      threshold?: number;
    }
) & {
  /** Name shown in the mask panel. */
  label?: string;
  /** Shown at first (true). */
  show?: boolean;
  /** CSS hex (#5fd38d; another one if the volume has that color). */
  color?: string;
  /** 0-1 (0.3, the volume shows through). */
  opacity?: number;
};

/** A map on the same box that colors the 3D volume surface (e.g. a local
 * resolution map), with a toolbar button to turn it on and off. */
export type VolumeResolutionMap = {
  /** A density grid or a request loaded with the DataLoader (as the
   * volume's `density`), when the coloring is first turned on. */
  density: VolumeDensity | DensitySource;
  /** Name in the button tooltip. */
  label?: string;
  /** Title of the color key ("Local resolution (Å)"). */
  title?: string;
  /** Unit of the key labels ("Å"). */
  unit?: string;
  /** Palette ends in map units; by default from the minimum of the map's
   * resolutions (without the values <= 0 nor the fill outside the mask) to
   * the value below its highest 5%. It does not change with the threshold. */
  range?: [number, number] | null;
  /** Colored at first (false). */
  show?: boolean;
};

export type VolumeViewerConfig = {
  /** Shown tabs: all by default; 3D volume only with a density. */
  tabs?: { slices?: boolean; view3d?: boolean; volume3d?: boolean };
  /** Tab shown first (the first shown tab). */
  initialTab?: VolumeViewerTab;
  /** Tools (all on by default; particles "auto": only if there are particles,
   * false: neither drawn nor in the toolbar). ruler and zoom exist only in
   * Slices; volume only in 3D planes. crosshair false: no slice lines at all
   * (and no button to show or hide them, as with lines false). */
  tools?: {
    select?: boolean;
    ruler?: boolean;
    zoom?: boolean;
    pan?: boolean;
    particles?: boolean | "auto";
    volume?: boolean;
    invert?: boolean;
    lines?: boolean;
    crosshair?: boolean;
  };
  initialTool?: Mode;
  defaults?: VolumeViewerDefaults;
  /** Mask over the 3D volume and the slices (with a toolbar button and its
   * options there). */
  mask?: VolumeMask | null;
  /** Map that colors the 3D volume surface (local resolution), with a
   * toolbar button to turn it on and off and the color key over the view. */
  resolution?: VolumeResolutionMap | null;
  /** Longest side of the Z section in px (520). */
  viewSize?: number;
  /** Same as defaults.particles.tolerance (kept for older hosts). */
  particleTolerance?: number;
  /** A line under the viewer with how long the volume took on the host,
   * to load and to decode, for debugging (DEBUG_TIMING, off, by default). */
  debug?: boolean;
};

export type VolumeViewerProps = VolumeViewerConfig & {
  /** The volume; or `source` to load it. */
  data?: VolumeData | null;
  /** Loaded with the DataLoader; the response may be VolumeData, a table
   * viewer pane or EMhub's {paneContent}. */
  source?: { path: string; payload?: unknown };
  /** Text above the viewer. */
  info?: string;
  /** "fill": fit the height of the container; "window" (default): fit the
   * room left in the window below the viewer. */
  height?: "fill" | "window";
  /** Called when the user changes the position (click, slider, particle). */
  onSelect?: (p: Vec3) => void;
  /** Called with the mask options when they change (and once at first). */
  onMaskChange?: (mask: VolumeMaskState) => void;
};

/** The mask options chosen by the user. */
export type VolumeMaskState = MaskOptions & {
  type: "sphere" | "map";
  /** Sphere diameter in Å (null if the voxel size is unknown). */
  diameter: number | null;
};

export type VolumeViewerHandle = {
  getPosition: () => Vec3;
  setPosition: (p: Partial<Vec3>) => void;
  setTool: (tool: Mode) => void;
};

const MODES: Exclude<Mode, null>[] = ["select", "ruler", "zoom", "pan"];
// Volume of the 3D planes: opacity and share of the voxels start in the
// middle of their sliders (5-100%, 1-40%)
const VOL_OPACITY = 0.52;
/** Share of the voxels drawn as the volume in the 3D planes. */
const VOL_SHARE = 0.2;
/** Distance (voxels) of the volume drawn near the planes. */
const VOL_TOLERANCE = 20;
/** Default sigma (voxels) of the low-pass filter of the sections. */
const FILTER_SIGMA = 1.5;
const MASK_COLOR = "#5fd38d";
const MASK_COLOR_ALT = "#ffd166";
const MASK_OPACITY = 0.3;
/** Opacity of the local resolution colors over the slices (the density
 * shows through). */
const RESOLUTION_SLICE_OPACITY = 0.55;
/** Share of the highest (worst) resolutions left out of the color range. */
const RESOLUTION_HIGH_TAIL = 0.05;
/** Smallest longest side of the Z section, px, when the room is too short. */
const MIN_SECTION = 60;
/** Vertical padding of the expanded viewer (`.full`, 12px top and bottom). */
const FULL_PADDING = 24;
/** Default of the `debug` line (timing of the volume); true to show it
 * everywhere while debugging. */
export const DEBUG_TIMING = false;

/** A measured height (px) to size the view from, and its last applied
 * values (with their times): true when it is not to be applied, as the
 * last one, or as a flip between two values (something that wraps at one
 * size and not at the other would size the view forever): after A, B, A
 * within a second, B again. Other changes, also a slower return, are
 * applied (and kept in seen). */
function skipFlip(seen: { e: number; t: number }[], e: number): boolean {
  const n = seen.length, now = performance.now();
  if (n && Math.abs(seen[n - 1].e - e) <= 1) return true;
  if (n >= 3 && now - seen[n - 3].t < 1000 && Math.abs(seen[n - 1].e - seen[n - 3].e) <= 1
      && Math.abs(seen[n - 2].e - e) <= 1) return true;
  seen.push({ e, t: now });
  if (seen.length > 4) seen.shift();
  return false;
}

/** The debug line: host steps, request, size, decoding and filters. */
function debugText(info: DensityDebug): string {
  const d = info.density;
  const parts: string[] = [];
  const s = (sec: unknown) => `${Number(sec).toFixed(2)} s`;
  if (d?.timing) {
    const { total, cached, ...steps } = d.timing;
    const detail = Object.entries(steps).map(([k, v]) => `${k} ${s(v)}`).join(", ");
    parts.push(`server ${s(total)}${detail ? ` (${detail})` : ""}${cached ? " (in the server cache)" : ""}`);
  }
  if (info.from === "request" && info.requestMs !== undefined) {
    parts.push(`request ${(info.requestMs / 1000).toFixed(2)} s${info.requestMs < 5 ? " (cached)" : ""}`);
  } else if (info.from === "inline") {
    parts.push("sent with the pane");
  }
  if (d?.bytes) parts.push(`${(d.bytes.sent / 1e6).toFixed(1)} MB${d.encoding ? ` ${d.encoding}` : ""}`);
  if (info.decodeMs !== undefined) parts.push(`decode ${Math.round(info.decodeMs)} ms`);
  if (d) parts.push(`grid ${[...d.shape].reverse().join("×")}${d.method ? ` (${d.method})` : ""}`);
  if (info.filterMs !== undefined) parts.push(`dust ${Math.round(info.filterMs)} ms (${info.hidden ?? 0} blobs)`);
  return parts.join(" · ");
}

const svg = (children: ReactNode) => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"
       strokeLinecap="round" strokeLinejoin="round">
    {children}
  </svg>
);
const ICON_PARTICLES = svg(<><circle cx="5" cy="5" r="2.5" /><circle cx="11" cy="6" r="2.5" /><circle cx="7" cy="11.5" r="2.5" /></>);
// A box with the region outside the mask shaded
const ICON_MASK = svg(<>
  <path d="M2 2h12v12H2zM8 3.5a4.5 4.5 0 1 0 0 9a4.5 4.5 0 1 0 0-9z" fill="currentColor" fillOpacity={0.35}
        fillRule="evenodd" stroke="none" />
  <rect x="2" y="2" width="12" height="12" rx="1" />
  <circle cx="8" cy="8" r="4.5" />
</>);
const ICON_VOLUME = svg(<><path d="M8 1.5l6 3v7l-6 3-6-3v-7z" strokeDasharray="2 2" /><path d="M2 4.5l6 3 6-3M8 7.5v7" /></>);

/** A toolbar button (`styles.toolbar`); also used by TiltSeriesViewer. */
export function ToolButton({ title, active, onClick, children, hidden }: {
  title: string;
  active?: boolean;
  onClick: () => void;
  children: ReactNode;
  hidden?: boolean;
}) {
  if (hidden) return null;
  return (
    <button type="button" title={title} className={active ? styles.active : undefined} onClick={onClick}>
      {children}
    </button>
  );
}

/** The response of a density request: VolumeDensity or {density}. */
const unwrapDensity = (r: any): VolumeDensity | null => (r && r.density ? r.density : r?.data ? r : null);

/** A density grid, inline or loaded, decoded; or why it is not (`what`:
 * "the mask", "the volume"). */
function useDensityGrid(given: VolumeDensity | DensitySource | null, what: string): { density: VolumeDensity | null; status: string | null } {
  const source = given && isDensitySource(given) ? given : null;
  const loaded = useLoad<unknown>(source?.path, source?.payload);
  const d = !given ? null : !source ? given as VolumeDensity : loaded.status === "ready" ? unwrapDensity(loaded.data) : null;
  const [ready, setReady] = useState<{ d: VolumeDensity } | { error: string } | null>(null);
  useEffect(() => {
    if (!d) return undefined;
    let live = true;
    prepareDensity(d).then(() => live && setReady({ d }), (e) => live && setReady({ error: String(e?.message ?? e) }));
    return () => { live = false; };
  }, [d]);
  if (!given) return { density: null, status: null };
  if (ready && "d" in ready && ready.d === d) return { density: d, status: null };
  if (ready && "error" in ready) return { density: null, status: `Could not read ${what}: ${ready.error}` };
  if (source && loaded.status === "error") return { density: null, status: `Could not load ${what}: ${loaded.error.message}` };
  if (source && loaded.status === "ready" && !d) return { density: null, status: `${what[0].toUpperCase()}${what.slice(1)} has no density.` };
  return { density: null, status: `Loading ${what}…` };
}

const VolumeViewer = forwardRef<VolumeViewerHandle, VolumeViewerProps>(function VolumeViewer(props, ref) {
  const { data, source } = props;
  const loaded = useLoad<unknown>(data ? null : source?.path, source?.payload);
  const parsed = useMemo(
    () => (data ? volumeDataFromPane(data) : loaded.status === "ready" ? volumeDataFromPane(loaded.data) : null),
    [data, loaded],
  );
  // Without slice images the Slices tab draws them from the density: it is
  // loaded once here and the 3D volume tab uses the same grid
  const shared = parsed && !parsed.axes && isDensitySource(parsed.density) ? parsed.density : null;
  const maxVoxels = props.defaults?.iso?.maxVoxels;
  const sharedLoad = useLoad<unknown>(
    shared?.path, shared ? { ...shared.payload, ...(maxVoxels ? { maxVoxels } : {}) } : undefined);
  const loadedVolume = useMemo(() => {
    if (!parsed || !shared) return parsed;
    const d = sharedLoad.status === "ready" ? unwrapDensity(sharedLoad.data) : null;
    return d ? { ...parsed, density: d } : null;
  }, [parsed, shared, sharedLoad]);
  // A density that draws the slices is decoded before the viewer shows
  const gridDensity = loadedVolume && !loadedVolume.axes && !isDensitySource(loadedVolume.density)
    ? loadedVolume.density ?? null : null;
  const [decoded, setDecoded] = useState<{ d: VolumeDensity; debug: DensityDebug } | { error: string } | null>(null);
  useEffect(() => {
    if (!gridDensity) return undefined;
    let live = true;
    const requestMs = shared && sharedLoad.status === "ready" ? sharedLoad.ms : undefined;
    prepareDensity(gridDensity).then(
      (decodeMs) => live && setDecoded({
        d: gridDensity,
        debug: { from: shared ? "request" : "inline", requestMs, decodeMs, density: gridDensity },
      }),
      (e) => live && setDecoded({ error: String(e?.message ?? e) }),
    );
    return () => { live = false; };
    // sharedLoad only matters with gridDensity
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gridDensity]);
  const ready = decoded && "d" in decoded && decoded.d === gridDensity ? decoded : null;
  const volume = gridDensity && !ready ? null : loadedVolume;

  if (!volume) {
    let msg = "No volume to show.";
    if (decoded && "error" in decoded) {
      msg = `Could not read the volume: ${decoded.error}`;
    } else if (gridDensity) {
      msg = "Reading the volume…";
    } else if (shared) {
      msg = sharedLoad.status === "error" ? sharedLoad.error.message : "Loading the volume…";
    } else if (!data && source) {
      if (loaded.status === "error") msg = loaded.error.message;
      else if (loaded.status !== "ready") msg = "Loading…";
      else msg = "The response has no X, Y and Z slices nor a density of a volume.";
    } else if (data) {
      msg = "The volume needs dimensions and slices along X, Y and Z (or a density).";
    }
    return <div className={styles.msg}>{msg}</div>;
  }
  return <VolumeViewerCore {...props} ref={ref} volume={volume} densityDebug={ready?.debug} />;
});

export default VolumeViewer;

const VolumeViewerCore = forwardRef<VolumeViewerHandle, VolumeViewerProps & {
  volume: VolumeData;
  /** Timing of a density loaded and decoded before the viewer showed. */
  densityDebug?: DensityDebug;
}>(
  function VolumeViewerCore(props, ref) {
    const { volume, info, onSelect } = props;
    const [X, Y, Z] = volume.dimensions;
    const dim = useMemo<Vec3>(() => ({ x: X, y: Y, z: Z }), [X, Y, Z]);
    const size = useMemo(() => sectionSize(dim), [dim]);
    // The density grid draws the slices when the host sends no images
    const gridSlices = !volume.axes && volume.density && !isDensitySource(volume.density) ? volume.density : null;
    const keys = useMemo(
      () => (volume.axes ? sliceKeys(volume.axes) : densitySliceKeys(gridSlices!, volume.dimensions)),
      [volume.axes, gridSlices, volume.dimensions],
    );
    const vs = useMemo(() => normVoxel(volume.voxelSize), [volume.voxelSize]);
    const tabsCfg = {
      slices: true, view3d: true, ...props.tabs,
      volume3d: Boolean(volume.density) && props.tabs?.volume3d !== false,
    };
    const toolsCfg = {
      select: true, ruler: true, zoom: true, pan: true, particles: "auto" as boolean | "auto",
      volume: true, invert: true, lines: true, crosshair: true, ...props.tools,
    };
    if (!toolsCfg.crosshair) toolsCfg.lines = false;
    const defaults = props.defaults ?? {};
    const dParts = defaults.particles ?? {};
    const viewSize = props.viewSize ?? 520;
    const fillHeight = props.height === "fill";

    const P = volume.coordinates ?? null;
    const nPart = P ? Math.min(P.x.length, P.y.length, P.z.length) : 0;
    const hasParticles = nPart > 0 && toolsCfg.particles !== false;
    const particles = hasParticles ? P : null;
    const hasTemplate = Boolean(hasParticles && P?.template?.faces?.length && vs?.x);
    const allowed = MODES.filter((t) => toolsCfg[t]);

    /* ---------- state ---------- */
    const [pos, setPosState] = useState<Vec3>(() => ({
      x: keys.x[Math.floor(keys.x.length / 2)] ?? 0,
      y: keys.y[Math.floor(keys.y.length / 2)] ?? 0,
      z: keys.z[Math.floor(keys.z.length / 2)] ?? 0,
    }));
    const [mode, setMode] = useState<Mode>(() => {
      const t = props.initialTool === undefined ? "select" : props.initialTool;
      return t && allowed.includes(t) ? t : null;
    });
    const [sel, setSel] = useState(-1);
    const [partsOn, setPartsOn] = useState(hasParticles && dParts.show !== false);
    const [hideLines, setHideLines] = useState(false);
    // One contrast for all the tabs (3D volume: the dark density)
    const [inverted, setInverted] = useState(Boolean(defaults.inverted ?? defaults.iso?.below));
    const [volOn, setVolOn] = useState(false);
    // Dots, spheres or the template (only with one)
    const [drawAs, setDrawAs] = useState<ParticleDraw>(() => {
      const d = dParts.drawAs ?? (dParts.template ? "template" : "dots");
      return d === "template" && !hasTemplate ? "dots" : d;
    });
    // The template's radius (its farthest vertex) in voxels, else 8
    const [sphereRadius, setSphereRadius] = useState(() => {
      if (dParts.sphereRadius && dParts.sphereRadius > 0) return dParts.sphereRadius;
      const v = hasTemplate ? P!.template!.vertices : [];
      let r2 = 0;
      for (let i = 0; i + 2 < v.length; i += 3) r2 = Math.max(r2, v[i] ** 2 + v[i + 1] ** 2 + v[i + 2] ** 2);
      return r2 && vs?.x ? Math.max(1, Math.round(Math.sqrt(r2) / vs.x)) : 8;
    });
    // Particles: only those near the sections/planes (± tolerance) or all, per
    // tab: near the sections in Slices, all in 3D planes by default
    const [nearSlices, setNearSlices] = useState(dParts.nearSlices ?? true);
    const [near3d, setNear3d] = useState(dParts.near3d ?? false);
    const [tolerance, setTolerance] = useState(dParts.tolerance ?? props.particleTolerance ?? 10);
    const [templateLevel, setTemplateLevel] = useState<number | null>(
      () => volume.coordinates?.template?.density?.level ?? null);
    // One color for the dots and the template, in both tabs
    const [particleColor, setParticleColor] = useState(dParts.color ?? "#ffa500");
    const [panelOpen, setPanelOpen] = useState(false);
    const panelRef = useRef<HTMLDivElement>(null);
    const [active, setActive] = useState<Axis[]>(() => {
      const p = (defaults.planes ?? []).filter((a) => AXES.includes(a)).slice(0, 2);
      return p.length ? p : ["z", "y"];
    });
    const [volOpacity, setVolOpacity] = useState(VOL_OPACITY);
    // 3D planes volume: the darkest (or brightest) share of the voxels
    const [volShare, setVolShare] = useState(VOL_SHARE);
    const [volDark, setVolDark] = useState(defaults.iso?.below ?? false);
    // ... only near the shown planes (± voxels), as the particles
    const [volNear, setVolNear] = useState(true);
    const [volTolerance, setVolTolerance] = useState(VOL_TOLERANCE);
    // Its density grid (when the host sends one), loaded once it is shown
    const [volWanted, setVolWanted] = useState(false);
    useEffect(() => { if (volOn) setVolWanted(true); }, [volOn]);
    const hasVolDensity = Boolean(volume.density);
    const volGrid = useDensityGrid(volWanted && volume.density ? volume.density : null, "the volume");
    const [rulers, setRulers] = useState<Record<Axis, Ruler | null>>({ x: null, y: null, z: null });
    const shownTabs = (["slices", "view3d", "volume3d"] as VolumeViewerTab[]).filter((t) => tabsCfg[t]);
    const [tab, setTab] = useState<VolumeViewerTab>(() =>
      props.initialTab && tabsCfg[props.initialTab] ? props.initialTab : shownTabs[0] ?? "slices");
    // Expanded over the whole browser window (not the Fullscreen API)
    const [full, setFull] = useState(false);
    const [built3d, setBuilt3d] = useState(tab === "view3d");
    const [builtIso, setBuiltIso] = useState(tab === "volume3d");
    // Timing of the density (debug line)
    const showDebug = props.debug ?? DEBUG_TIMING;
    const [debug, setDebug] = useState<DensityDebug | null>(props.densityDebug ?? null);
    const onDebug = useCallback((info: DensityDebug) => setDebug((cur) => ({ ...cur, ...info })), []);
    const [isoPan, setIsoPan] = useState(false);
    // Mask over the 3D volume and the slices, and its panel
    const maskCfg = tabsCfg.volume3d || tabsCfg.slices ? props.mask ?? null : null;
    const angpix = vs?.x ?? null;
    const [maskOpts, setMaskOpts] = useState<MaskOptions>(() => {
      const isoColor = (defaults.iso?.color ?? "#b2b2ff").toLowerCase();
      let diameterPx = Math.min(X, Y, Z) * 0.8;
      if (maskCfg?.type === "sphere") {
        if (maskCfg.diameterPx && maskCfg.diameterPx > 0) diameterPx = maskCfg.diameterPx;
        else if (maskCfg.diameter && maskCfg.diameter > 0 && angpix) diameterPx = maskCfg.diameter / angpix;
      }
      return {
        show: maskCfg?.show !== false,
        color: maskCfg?.color ?? (isoColor === MASK_COLOR ? MASK_COLOR_ALT : MASK_COLOR),
        opacity: maskCfg?.opacity ?? MASK_OPACITY,
        diameterPx,
      };
    });
    // A map mask is loaded once, for both tabs
    const maskMap = useDensityGrid(maskCfg?.type === "map" ? maskCfg.density : null, "the mask");
    const [maskOpen, setMaskOpen] = useState(false);
    const maskPanelRef = useRef<HTMLDivElement>(null);
    const isoMask = useMemo<IsoMaskInput | null>(() => {
      if (!maskCfg) return null;
      if (maskCfg.type === "map") {
        return maskMap.density ? { type: "map", density: maskMap.density, threshold: maskCfg.threshold } : null;
      }
      const c = maskCfg.center ?? {};
      return {
        type: "sphere",
        center: { x: c.x ?? X / 2, y: c.y ?? Y / 2, z: c.z ?? Z / 2 },
        diameter: maskOpts.diameterPx,
      };
      // the config is compared by its fields
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [maskCfg?.type, maskMap.density, maskCfg?.type === "map" ? maskCfg.threshold : null,
        maskCfg?.type === "sphere" ? maskCfg.center?.x : null, maskCfg?.type === "sphere" ? maskCfg.center?.y : null,
        maskCfg?.type === "sphere" ? maskCfg.center?.z : null, maskOpts.diameterPx, X, Y, Z]);
    const maskStyle = useMemo(
      () => ({ show: maskOpts.show, color: maskOpts.color, opacity: maskOpts.opacity }),
      [maskOpts.show, maskOpts.color, maskOpts.opacity],
    );
    // The same mask over the slices; a map's threshold is in its grid units
    const sliceMask = useMemo<SliceMask | null>(() => {
      if (!isoMask || !maskOpts.show) return null;
      const style = { color: maskOpts.color, opacity: maskOpts.opacity };
      if (isoMask.type === "sphere") return { ...isoMask, ...style };
      const d = isoMask.density as VolumeDensity;
      const [v0, v1] = d.valueRange;
      const level = ((maskThreshold(d, isoMask.threshold) - v0) / (v1 - v0 || 1)) * 255;
      return { type: "map", density: d, level, ...style };
    }, [isoMask, maskOpts.show, maskOpts.color, maskOpts.opacity]);
    // The options for the host (e.g. a wizard that sets the diameter)
    const onMaskChangeRef = useRef(props.onMaskChange);
    onMaskChangeRef.current = props.onMaskChange;
    useEffect(() => {
      if (!maskCfg) return;
      onMaskChangeRef.current?.({
        ...maskOpts,
        type: maskCfg.type,
        diameter: angpix ? maskOpts.diameterPx * angpix : null,
      });
    }, [maskOpts, maskCfg?.type, angpix]); // eslint-disable-line react-hooks/exhaustive-deps
    // Coloring of the 3D volume by a resolution map: loaded when first on
    const resCfg = tabsCfg.volume3d || tabsCfg.slices ? props.resolution ?? null : null;
    const [resOn, setResOn] = useState(Boolean(resCfg?.show));
    const [resWanted, setResWanted] = useState(Boolean(resCfg?.show));
    const resMap = useDensityGrid(resCfg && resWanted ? resCfg.density : null, "the resolution map");
    // The values of the map (its resolutions: without the values <= 0 nor
    // the fill outside the mask, see resolutionValidLevels)
    const resStats = useMemo<ResolutionStats | null>(() => {
      if (!resMap.density) return null;
      const v = densityValues(resMap.density);
      const full = mapValueRange(resMap.density, v, 0, 0);
      const high = mapValueRange(resMap.density, v, 0, RESOLUTION_HIGH_TAIL);
      return full && high ? { min: full[0], max: full[1], p95: high[1] } : null;
    }, [resMap.density]);
    // Max of the color scale, chosen in the panel; by default the value
    // below the highest RESOLUTION_HIGH_TAIL (the worst values, at the mask
    // edge, would squash the colors of the others). Above it: gray
    const [resMax, setResMax] = useState<number | null>(null);
    // One range for the 3D volume and the slices, that never changes with
    // the threshold: the given one, else the map's minimum to the max
    const resRange: [number, number] | null = resCfg?.range
      ?? (resStats ? [resStats.min, resMax ?? resStats.p95] : null);
    const isoColorBy = useMemo<ColorByInput | null>(
      () => (resCfg && resOn && resMap.density && resRange
        ? { density: resMap.density, range: resRange, title: resCfg.title, unit: resCfg.unit }
        : null),
      // the config and range are compared by their values
      // eslint-disable-next-line react-hooks/exhaustive-deps
      [resOn, resMap.density, resRange?.[0], resRange?.[1], resCfg?.title, resCfg?.unit]);
    const sliceColorBy = useMemo<SliceColorBy | null>(
      () => (resOn && resMap.density && resRange
        ? { density: resMap.density, range: resRange, opacity: RESOLUTION_SLICE_OPACITY }
        : null),
      // the range is compared by value
      // eslint-disable-next-line react-hooks/exhaustive-deps
      [resOn, resMap.density, resRange?.[0], resRange?.[1]]);
    const sliceKey = resCfg && sliceColorBy && (
      <ColorKey inline range={sliceColorBy.range}
                title={resCfg.title ?? "Local resolution (Å)"} unit={resCfg.unit ?? "Å"} />
    );
    // While the resolution map loads (or if it failed): in the output bar
    const resStatus = resCfg && resWanted ? resMap.status : null;
    const resLoading = Boolean(resStatus && !resStatus.startsWith("Could not") && !resStatus.startsWith("The "));
    // The resolution button opens its panel (the first time it also turns
    // the coloring on, so one click shows it); its checkbox turns it on/off
    const [resOpen, setResOpen] = useState(false);
    const resPanelRef = useRef<HTMLDivElement>(null);
    const resolutionButton = (forTab: VolumeViewerTab) => resCfg && (
      <span className={styles.panelAnchor} data-res-button>
        <ToolButton
          title={`Local resolution: show, max of the color scale${resCfg.label ? ` (${resCfg.label})` : ""}`}
          active={resOpen || resOn}
          onClick={() => {
            if (!resWanted) {
              setResWanted(true);
              setResOn(true);
            }
            setResOpen((v) => !v);
          }}>
          <Rainbow size={16} />
        </ToolButton>
        {resOpen && tab === forTab && (
          <div ref={resPanelRef}>
            <ResolutionPanel
              show={resOn}
              onShow={(v) => { setResWanted(true); setResOn(v); }}
              label={resCfg.label}
              unit={resCfg.unit ?? "Å"}
              stats={resCfg.range ? null : resStats}
              status={resStatus}
              maxValue={resRange?.[1] ?? null}
              onMaxValue={setResMax}
            />
          </div>
        )}
      </span>
    );
    const isoRef = useRef<IsoSurfaceHandle>(null);
    const history = useRef<HistoryEntry[]>([]);
    const slicesRef = useRef<VolumeSlicesHandle>(null);
    const rootRef = useRef<HTMLDivElement>(null);
    const posRef = useRef(pos);
    posRef.current = pos;
    const onSelectRef = useRef(onSelect);
    onSelectRef.current = onSelect;

    const setPos = useCallback((p: Partial<Vec3>, fromUser: boolean) => {
      const next = { ...posRef.current, ...p };
      posRef.current = next;
      setPosState(next);
      if (fromUser) onSelectRef.current?.({ ...next });
    }, []);
    // The position holds exact voxels; sections show the nearest slice
    const selectParticle = useCallback((i: number) => {
      if (!P) return;
      setSel(i);
      setPos({ x: clampVox(dim, "x", P.x[i]), y: clampVox(dim, "y", P.y[i]), z: clampVox(dim, "z", P.z[i]) }, true);
    }, [P, dim, setPos]);
    const setTool = useCallback((t: Mode) => {
      setMode((m) => (t && allowed.includes(t) && t !== m ? t : null));
      // allowed only changes with the config
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [allowed.join()]);

    useImperativeHandle(ref, () => ({
      getPosition: () => ({ ...posRef.current }),
      setPosition: (p) => setPos(p, false),
      setTool,
    }), [setPos, setTool]);

    // Iterations of the map (a Relion class at every iteration of its job):
    // played in the 3D volume (the other maps are loaded in the background,
    // IsoSurfaceView preload); chosen in the Slices (sliceIter, below)
    const iterSrc = volume.iterations ?? null;
    const iterLoad = useLoad<any>(iterSrc ? iterSrc.path : null, iterSrc?.payload);
    const iters: MapIterations | null = useMemo(() => {
      const r = iterLoad.status === "ready" ? iterLoad.data : null;
      const it = r && "iterations" in r ? r.iterations : r;
      return it && Array.isArray(it.items) && it.items.length > 1 ? it : null;
    }, [iterLoad]);
    const [iterIdx, setIterIdx] = useState<number | null>(null);
    const [iterLoaded, setIterLoaded] = useState<boolean[]>([]);
    const [playing, setPlaying] = useState(false);
    const [iterFps, setIterFps] = useState(2);
    // The play bar and charts of the iterations (3D volume): the toolbar's
    // charts button, off at first
    const [iterCharts, setIterCharts] = useState(false);
    useEffect(() => {
      setIterIdx(iters ? iters.current : null);
      setIterLoaded(iters ? iters.items.map((_, i) => i === iters.current) : []);
      setPlaying(false);
    }, [iters]);
    const isoDensity: VolumeDensity | DensitySource | null = iters && iterIdx !== null && iterIdx !== iters.current
      ? iters.items[iterIdx].density : volume.density ?? null;
    const iterPreload = useMemo(
      () => (iters ? iters.items.map((it, i) => (i === iters.current ? null : it.density)) : undefined), [iters]);
    const onIterPreloaded = useCallback((i: number) => {
      setIterLoaded((cur) => (cur[i] ? cur : cur.map((v, j) => v || j === i)));
    }, []);
    // Playback: the next iteration once the shown one is drawn, after 1/fps
    const [isoShown, setIsoShown] = useState<VolumeDensity | DensitySource | null>(null);
    useEffect(() => {
      if (!playing || !iters || iterIdx === null || isoShown !== isoDensity) return undefined;
      const timer = window.setTimeout(() => setIterIdx((i) => ((i ?? 0) + 1) % iters.items.length), 1000 / iterFps);
      return () => window.clearTimeout(timer);
    }, [playing, iters, iterIdx, isoShown, isoDensity, iterFps]);

    // The Slices of a map have their own iteration (a select, no playback:
    // the 3D volume playing does not change them), drawn from its grid once
    // it is loaded (with the detail the 3D volume asks first, so the request
    // is shared); the pane's map until then
    const [sliceIter, setSliceIter] = useState<number | null>(null);
    useEffect(() => setSliceIter(iters ? iters.current : null), [iters]);
    const iterGridSrc = useMemo<DensitySource | null>(() => {
      const d = gridSlices && iters && sliceIter !== null && sliceIter !== iters.current
        ? iters.items[sliceIter].density : null;
      return d ? { path: d.path, payload: { ...d.payload, maxVoxels: defaults.iso?.maxVoxels ?? DETAILS[1][0] } } : null;
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [gridSlices, iters, sliceIter]);
    const iterGrid = useDensityGrid(iterGridSrc, "the iteration");
    const sliceGrid = (iterGridSrc && iterGrid.density) || gridSlices;

    /* ---------- images (decoded once, shared by both tabs) ---------- */
    const loader = useDataLoader();
    // A new cache with new slices (another iteration), not cleared after
    // the render: the sections redraw (an effect of VolumeSlices) before
    const images = useMemo(() => ({ current: new Map<string, SliceImage>() }), [volume.axes, sliceGrid]);
    const getImage = useCallback((a: Axis, key: number) => images.current.get(`${a}:${key}`) ?? null, [images]);
    const loadImage = useCallback((a: Axis, key: number): Promise<SliceImage> => {
      if (sliceGrid) {
        const img = densitySlice(sliceGrid, a, key);
        images.current.set(`${a}:${key}`, img);
        return Promise.resolve(img);
      }
      const src = volume.axes?.[a][String(key)];
      if (!src) return Promise.reject(new Error(`No ${a} slice ${key}`));
      return loader.image(src).then((img) => {
        images.current.set(`${a}:${key}`, img);
        return img;
      });
    }, [loader, volume.axes, sliceGrid, images]);

    // Full-resolution crops of the sections (when the host sends their
    // request), with the contrast of their slice image
    const cropSrc = volume.crop ?? null;
    const loadCrop = useMemo(() => {
      if (!cropSrc) return null;
      return (r: CropRequest): Promise<VolumeCrop> => loader.load<any>(cropSrc.path, {
        ...cropSrc.payload, ...r, levels: volume.levels?.[r.axis]?.[String(r.index)] ?? null,
      }).then((res) => {
        const c = res?.crop ?? res;
        // No image: the host skipped it (e.g. too slow to read), the slice
        // image stays
        if (!c?.image) throw new Error(c?.skipped || "The crop has no image");
        return loader.image(c.image).then((image) => ({ image, x0: c.x0, y0: c.y0, w: c.w, h: c.h, binning: c.binning || 1 }));
      });
    }, [cropSrc, loader, volume.levels]);
    // Denoise: Gaussian low-pass of the sections (Slices and 3D planes)
    const [filterOn, setFilterOn] = useState(false);
    const [filterSigma, setFilterSigma] = useState(FILTER_SIGMA);
    const [denoiseOpen, setDenoiseOpen] = useState(false);
    const denoiseRef = useRef<HTMLDivElement>(null);
    const shownSigma = filterOn ? filterSigma : 0;

    /* ---------- undo, invert, lines ---------- */
    const pushHistory = useCallback((e: HistoryEntry) => history.current.push(e), []);
    const toggleInvert = (isUndo: boolean) => {
      if (!isUndo) history.current.push({ type: "invert" });
      setInverted((v) => !v);
    };
    const toggleLines = () => {
      history.current.push({ type: "lines" });
      setHideLines((v) => !v);
    };
    /* Every zoom, ruler and contrast change is one step; each click goes back
       one step. With nothing left to undo it only deactivates the tool. */
    const clean = () => {
      const h = history.current.pop();
      if (!h) {
        setMode(null);
        slicesRef.current?.clearPending();
      } else if (h.type === "zoom") {
        slicesRef.current?.setWindow(h.a, h.win);
      } else if (h.type === "ruler") {
        setRulers((r) => ({ ...r, [h.a]: h.prev }));
        slicesRef.current?.clearPending();
      } else if (h.type === "invert") {
        toggleInvert(true);
      } else if (h.type === "lines") {
        setHideLines((v) => !v);
      }
    };

    /* ---------- size ---------- */
    // room: the height the viewer may take (its content box): the container
    // without its padding ("fill"), the window below the viewer, or the
    // whole window when expanded
    const [box, setBox] = useState({ width: 800, room: 700 });
    const measure = useCallback(() => {
      const el = rootRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const parent = el.parentElement;
      let room: number;
      if (full) room = window.innerHeight - FULL_PADDING;
      else if (fillHeight && parent?.clientHeight) {
        const cs = getComputedStyle(parent);
        room = parent.clientHeight - (parseFloat(cs.paddingTop) || 0) - (parseFloat(cs.paddingBottom) || 0);
      } else if (fillHeight) room = rect.height;
      else room = window.innerHeight - Math.min(Math.max(rect.top, 0), window.innerHeight / 2);
      const width = full ? window.innerWidth - 32 : el.clientWidth || window.innerWidth;
      setBox((b) => (b.width === width && b.room === room ? b : { width, room }));
    }, [full, fillHeight]);
    useLayoutEffect(() => {
      measure();
      const el = rootRef.current;
      const ro = new ResizeObserver(() => measure());
      if (el) ro.observe(el);
      if (fillHeight && el?.parentElement) ro.observe(el.parentElement);
      window.addEventListener("resize", measure);
      return () => {
        ro.disconnect();
        window.removeEventListener("resize", measure);
      };
    }, [measure, fillHeight]);

    // The height of everything shown in a tab but its sections or scene
    // (info, tabs, toolbar, sliders, output bar...), measured below, so they
    // take the rest of the room and nothing scrolls. Expanded, there is no
    // zoom cap: they take all the window
    const [extra, setExtra] = useState<Record<VolumeViewerTab, number>>({ slices: 240, view3d: 220, volume3d: 220 });
    // The last measured values of extra, per tab (see the measure below)
    const extraSeen = useRef<Record<VolumeViewerTab, { e: number; t: number }[]>>({ slices: [], view3d: [], volume3d: [] });
    const avail = (t: VolumeViewerTab) => Math.max(40, box.room - extra[t] - 4);
    // Screen px per voxel of the sections
    const scale = useMemo(() => {
      const availW = Math.max(60, box.width - 40);
      const cap = full ? Infinity : viewSize / Math.max(X, Y);
      // In a very short container the sections keep a usable size (the
      // viewer scrolls there; expand it for more)
      const byHeight = Math.max(avail("slices") / (Y + Z), MIN_SECTION / Math.max(X, Y));
      return Math.max(0.05, Math.min(cap, byHeight, (availW - 14) / (X + Z)));
      // avail reads box and extra
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [box, full, viewSize, X, Y, Z, extra.slices]);
    // 3D planes: the scene and its controls beside it. As expanded, the
    // scene takes all the room (no height cap, up to 1.4 times as wide as
    // high), as the Slices do
    const size3d = useMemo(() => {
      const h = Math.max(120, avail("view3d"));
      const w = Math.min(h * 1.4, Math.max(240, box.width - 200));
      return [Math.round(w), Math.round(h)] as [number, number];
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [box, extra.view3d]);
    // 3D volume: a wider panel beside the scene, as high as it (it scrolls
    // when longer); with no room for it there, the panel goes below, as wide
    // as the scene and in two columns, and the scene takes the height the
    // panel does not need (isoPanelNeed, measured by the panel), so nothing
    // scrolls. As expanded, the scene takes all the room (no height cap, up
    // to 1.4 times as wide as high), as the Slices do.
    // [width, height, panel max height, panel width (below only)]
    const [isoPanelNeed, setIsoPanelNeed] = useState(260);
    // The iterations bar under the scene (in its column): the scene is that
    // much lower, the panel beside it keeps the whole height
    const [iterBarH, setIterBarH] = useState(0);
    const iterBarObs = useRef<ResizeObserver | null>(null);
    const iterBarRef = useCallback((el: HTMLDivElement | null) => {
      iterBarObs.current?.disconnect();
      iterBarObs.current = null;
      if (!el) {
        setIterBarH(0);
        return;
      }
      const fit = () => setIterBarH((cur) => (Math.abs(cur - el.offsetHeight) > 1 ? el.offsetHeight : cur));
      fit();
      iterBarObs.current = new ResizeObserver(fit);
      iterBarObs.current.observe(el);
    }, []);
    const sizeIso = useMemo<[number, number, number, number | undefined]>(() => {
      const room = avail("volume3d");
      const h = Math.max(120, room - iterBarH);
      if (box.width - 290 >= 320) {
        const w = Math.min(h * 1.4, box.width - 290);
        return [Math.round(w), Math.round(h), Math.round(Math.max(h, room)), undefined];
      }
      const w = Math.round(Math.max(200, Math.min(box.width - 24, h * 1.2)));
      // 14: the gap of .wrap3d between the scene and the panel. Rounded
      // down, so the panel gets at least the height it needs: a pixel less
      // and it would scroll
      const sh = Math.floor(Math.max(120, Math.min(w, room - iterBarH - isoPanelNeed - 14)));
      // .isoCols is a border box: the panel is as wide as the scene
      return [w, sh, Math.max(120, Math.floor(room - sh - iterBarH - 14)), w];
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [box, extra.volume3d, isoPanelNeed, iterBarH]);
    // The last heights the panel needed (it reports it after each render)
    const isoPanelSeen = useRef<{ e: number; t: number }[]>([]);
    const onIsoPanelHeight = useCallback((ph: number) => {
      if (!skipFlip(isoPanelSeen.current, ph)) setIsoPanelNeed(ph);
    }, []);

    // Measured after each render of the shown tab: from the top of the first
    // element to the bottom of the output bar, but the sections (their height
    // is (Y + Z) * scale) or the 3D box; it does not change with their size
    useLayoutEffect(() => {
      const el = rootRef.current;
      if (!el?.firstElementChild || !el.lastElementChild) return;
      const content = el.lastElementChild.getBoundingClientRect().bottom
        - el.firstElementChild.getBoundingClientRect().top;
      const main = tab === "slices" ? (Y + Z) * scale
        : (tab === "view3d" ? view3dBox : isoBox).current?.offsetHeight ?? 0;
      if (!content || !main) return;
      const e = Math.ceil(content - main);
      if (Math.abs(extra[tab] - e) <= 1 || skipFlip(extraSeen.current[tab], e)) return;
      setExtra((cur) => ({ ...cur, [tab]: e }));
    });

    /* ---------- expand to the browser window ---------- */
    useEffect(() => {
      if (!full && !panelOpen && !maskOpen && !denoiseOpen && !resOpen) return undefined;
      // Captured: Esc closes the particles, mask, denoise or resolution panel, then collapses the
      // viewer, and does not reach a dialog around it
      const onKey = (e: KeyboardEvent) => {
        if (e.key !== "Escape") return;
        e.stopPropagation();
        e.preventDefault();
        if (panelOpen) setPanelOpen(false);
        else if (maskOpen) setMaskOpen(false);
        else if (denoiseOpen) setDenoiseOpen(false);
        else if (resOpen) setResOpen(false);
        else setFull(false);
      };
      document.addEventListener("keydown", onKey, true);
      return () => document.removeEventListener("keydown", onKey, true);
    }, [full, panelOpen, maskOpen, denoiseOpen, resOpen]);

    /* ---------- particles panel ---------- */
    // A click outside the panel (and its button) closes it
    useEffect(() => {
      if (!panelOpen) return undefined;
      const onDown = (e: MouseEvent) => {
        const t = e.target as Node;
        if (panelRef.current?.contains(t)) return;
        if ((t as Element).closest?.("[data-particles-button]")) return;
        setPanelOpen(false);
      };
      document.addEventListener("mousedown", onDown);
      return () => document.removeEventListener("mousedown", onDown);
    }, [panelOpen]);
    // The same for the mask panel
    useEffect(() => {
      if (!maskOpen) return undefined;
      const onDown = (e: MouseEvent) => {
        const t = e.target as Node;
        if (maskPanelRef.current?.contains(t)) return;
        if ((t as Element).closest?.("[data-mask-button]")) return;
        setMaskOpen(false);
      };
      document.addEventListener("mousedown", onDown);
      return () => document.removeEventListener("mousedown", onDown);
    }, [maskOpen]);
    // ... and for the denoise panel
    useEffect(() => {
      if (!denoiseOpen) return undefined;
      const onDown = (e: MouseEvent) => {
        const t = e.target as Node;
        if (denoiseRef.current?.contains(t)) return;
        if ((t as Element).closest?.("[data-denoise-button]")) return;
        setDenoiseOpen(false);
      };
      document.addEventListener("mousedown", onDown);
      return () => document.removeEventListener("mousedown", onDown);
    }, [denoiseOpen]);
    // The same for the resolution panel
    useEffect(() => {
      if (!resOpen) return undefined;
      const onDown = (e: MouseEvent) => {
        const t = e.target as Node;
        if (resPanelRef.current?.contains(t)) return;
        if ((t as Element).closest?.("[data-res-button]")) return;
        setResOpen(false);
      };
      document.addEventListener("mousedown", onDown);
      return () => document.removeEventListener("mousedown", onDown);
    }, [resOpen]);
    const setParticleOptions = (o: Partial<ParticleOptions>) => {
      if (o.partsOn !== undefined) setPartsOn(o.partsOn);
      if (o.nearOnly !== undefined) (tab === "view3d" ? setNear3d : setNearSlices)(o.nearOnly);
      if (o.tolerance !== undefined) setTolerance(o.tolerance);
      if (o.drawAs !== undefined) setDrawAs(o.drawAs);
      if (o.sphereRadius !== undefined) setSphereRadius(o.sphereRadius);
      if (o.templateLevel !== undefined) setTemplateLevel(o.templateLevel);
      if (o.color !== undefined) setParticleColor(o.color);
    };
    const toggleFull = () => setFull((v) => !v);

    /* ---------- readout ---------- */
    // One thing at a time, depending on the active tool
    let readout: ReactNode;
    if (mode === "ruler") {
      const meas = AXES.filter((a) => rulers[a]).map((a) => rulerLength(vs, a, rulers[a]!));
      readout = meas.length ? <><b>Length</b> {meas[meas.length - 1]}</> : "Ruler: click two points to measure";
    } else if (sel >= 0 && P) {
      readout = <><b>Particle {sel + 1}/{nPart}</b> ({P.x[sel]}, {P.y[sel]}, {P.z[sel]})</>;
    } else if (mode === "select") {
      readout = <><b>X</b> {pos.x} <b>Y</b> {pos.y} <b>Z</b> {pos.z} &nbsp;·&nbsp; {scaleText(vs)}</>;
    } else {
      readout = scaleText(vs);
    }

    /* ---------- toolbars ---------- */
    // All the particle options are in one panel, opened from the toolbar
    const particlesButton = (is3d: boolean) => hasParticles && (
      <span className={styles.panelAnchor} data-particles-button>
        <ToolButton title="Particles: show, filter, select, draw as dots or template"
                    active={panelOpen || partsOn} onClick={() => setPanelOpen((v) => !v)}>
          {ICON_PARTICLES}
        </ToolButton>
        {/* One panel, in the toolbar of the visible tab */}
        {panelOpen && is3d === (tab === "view3d") && (
          <div ref={panelRef}>
            <ParticlesPanel
              count={nPart}
              partsOn={partsOn}
              nearOnly={is3d ? near3d : nearSlices}
              tolerance={tolerance}
              drawAs={drawAs}
              sphereRadius={sphereRadius}
              maxRadius={Math.max(20, Math.round(Math.min(X, Y, Z) / 4), sphereRadius)}
              hasAngles={Boolean(P?.angles?.length)}
              angpix={vs?.x ?? null}
              templateLevel={templateLevel}
              color={particleColor}
              hasTemplate={hasTemplate}
              hasDensity={Boolean(P?.template?.density)}
              is3d={is3d}
              onChange={setParticleOptions}
            />
          </div>
        )}
      </span>
    );
    // The denoise options, in the toolbar of the visible tab
    const denoiseButton = (forTab: VolumeViewerTab) => (
      <span className={styles.panelAnchor} data-denoise-button>
        <ToolButton title="Denoise: Gaussian low-pass filter of the sections"
                    active={denoiseOpen || filterOn} onClick={() => setDenoiseOpen((v) => !v)}>
          <Sparkles size={16} />
        </ToolButton>
        {denoiseOpen && tab === forTab && (
          <div ref={denoiseRef}>
            <DenoisePanel on={filterOn} sigma={filterSigma}
                          onChange={(o) => {
                            if (o.on !== undefined) setFilterOn(o.on);
                            if (o.sigma !== undefined) setFilterSigma(o.sigma);
                          }} />
          </div>
        )}
      </span>
    );
    // The mask options, in the toolbar of the visible tab
    const maskButton = (forTab: VolumeViewerTab) => maskCfg && (
      <span className={styles.panelAnchor} data-mask-button>
        <ToolButton title="Mask: show, color, opacity" active={maskOpen || maskOpts.show}
                    onClick={() => setMaskOpen((v) => !v)}>
          {ICON_MASK}
        </ToolButton>
        {maskOpen && tab === forTab && (
          <div ref={maskPanelRef}>
            <MaskPanel
              {...maskOpts}
              kind={maskCfg.type}
              label={maskCfg.label}
              angpix={angpix}
              maxPx={Math.max(X, Y, Z) * 1.5}
              status={maskCfg.type === "map" ? maskMap.status : null}
              onChange={(patch) => setMaskOpts((o) => ({ ...o, ...patch }))}
            />
          </div>
        )}
      </span>
    );
    const modeButton = (t: Exclude<Mode, null>, title: string, icon: ReactNode) =>
      toolsCfg[t] && <ToolButton title={title} active={mode === t} onClick={() => setTool(t)}>{icon}</ToolButton>;

    const slicesToolbar = (
      <div className={styles.toolbar}>
        {modeButton("select", "Select a point: moves the sliders there", <Crosshair size={16} />)}
        {modeButton("ruler", "Ruler: click two points to measure", <RulerIcon size={16} />)}
        {modeButton("zoom", "Zoom: drag a rectangle over the region to enlarge", <ZoomIn size={16} />)}
        {modeButton("pan", "Move the zoomed section: drag it with the mouse", <Move size={16} />)}
        {toolsCfg.invert && (
          <ToolButton title="Invert the contrast" active={inverted} onClick={() => toggleInvert(false)}>
            <Contrast size={16} />
          </ToolButton>
        )}
        {toolsCfg.lines && (
          <ToolButton title="Hide the slice lines (crosshair)" active={hideLines} onClick={toggleLines}>
            <EyeOff size={16} />
          </ToolButton>
        )}
        {/* Denoise: only for slice images (tomograms), not for maps */}
        {volume.axes && denoiseButton("slices")}
        {gridSlices && iters && sliceIter !== null && (
          <label className={styles.iterSelect} title="Iteration of the map shown in the Slices">
            <select value={sliceIter} onChange={(e) => setSliceIter(Number(e.target.value))}>
              {iters.items.map((it, i) => <option key={it.file} value={i}>{it.label}</option>)}
            </select>
            {iterGridSrc && !iterGrid.density && <span className={styles.iterLoaded}>{iterGrid.status ?? "Loading…"}</span>}
          </label>
        )}
        {particlesButton(false)}
        {maskButton("slices")}
        {resolutionButton("slices")}
        {(toolsCfg.ruler || toolsCfg.zoom || toolsCfg.pan || toolsCfg.invert) && (
          <ToolButton title="Clean: undo the last zoom, measurement or contrast change, or deactivate the tool"
                      onClick={clean}>
            <Undo2 size={16} />
          </ToolButton>
        )}
      </div>
    );
    const view3dToolbar = (
      <div className={styles.toolbar}>
        {modeButton("select", "Select a point: moves the sliders there", <Crosshair size={16} />)}
        <span className={styles.sep} />
        {toolsCfg.volume && (
          <ToolButton title="Show the volume around the planes (its densest voxels)" active={volOn} onClick={() => setVolOn((v) => !v)}>
            {ICON_VOLUME}
          </ToolButton>
        )}
        {toolsCfg.invert && (
          <ToolButton title="Invert the contrast" active={inverted} onClick={() => toggleInvert(false)}>
            <Contrast size={16} />
          </ToolButton>
        )}
        {modeButton("pan", "Move the volume: drag it in any direction (or right-drag / shift+drag)", <Move size={16} />)}
        {denoiseButton("view3d")}
        {particlesButton(true)}
        <ToolButton title="Reset the 3D view" onClick={() => sceneRef.current?.reset()}>
          <RefreshCw size={16} />
        </ToolButton>
      </div>
    );

    /* ---------- 3D ---------- */
    const sceneRef = useRef<VolumeScene3D | null>(null);
    const size3dRef = useRef(size3d);
    size3dRef.current = size3d;
    const sceneHost = useRef<HTMLDivElement>(null);
    const [sceneError, setSceneError] = useState<string | null>(null);
    const sceneState: SceneState = {
      pos, partsOn, drawAs, sphereRadius, volOn, inverted, active, volOpacity, volShare, volDark, volNear, volTolerance,
      filterSigma: shownSigma, mode, nearOnly: near3d, tolerance, templateLevel, particleColor,
    };
    const sceneStateRef = useRef(sceneState);
    sceneStateRef.current = sceneState;
    const pickRef = useRef({ selectParticle, setPos, setSel });
    pickRef.current = { selectParticle, setPos, setSel };

    useEffect(() => {
      if (tab === "view3d") setBuilt3d(true);
      if (tab === "volume3d") setBuiltIso(true);
    }, [tab]);
    useEffect(() => {
      if (!built3d || !sceneHost.current) return undefined;
      let scene: VolumeScene3D;
      try {
        scene = new VolumeScene3D({
          dim,
          keys,
          particles,
          voxelSize: vs,
          getImage,
          loadImage,
          density: hasVolDensity,
          onPickParticle: (i) => pickRef.current.selectParticle(i),
          onPickPoint: (p) => {
            pickRef.current.setSel(-1);
            pickRef.current.setPos(p, true);
          },
        }, sceneStateRef.current, size3dRef.current[0], size3dRef.current[1]);
      } catch (e) {
        setSceneError("WebGL is not available in this browser.");
        return undefined;
      }
      sceneHost.current.appendChild(scene.canvas);
      sceneRef.current = scene;
      return () => {
        scene.dispose();
        scene.canvas.remove();
        sceneRef.current = null;
      };
    }, [built3d, dim, keys, particles, vs, getImage, loadImage, hasVolDensity]);
    useEffect(() => {
      sceneRef.current?.setState(sceneState);
      // the fields are the dependencies
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [pos, partsOn, drawAs, sphereRadius, volOn, inverted, active, volOpacity, volShare, volDark, volNear, volTolerance, shownSigma,
        mode, near3d, tolerance, templateLevel, particleColor]);
    useEffect(() => {
      sceneRef.current?.setDensity(volGrid.density);
    }, [volGrid.density, built3d, sceneError]);
    useEffect(() => {
      sceneRef.current?.resize(size3d[0], size3d[1]);
    }, [size3d]);

    const togglePlane = (a: Axis) => {
      setActive((cur) => {
        let next = cur.includes(a) ? cur.filter((x) => x !== a) : [...cur, a];
        if (next.length > 2) next = next.slice(next.length - 2);
        return next.length ? next : [a];
      });
    };

    /* The output bar spans exactly the width of the visible pane content */
    const slicesBox = useRef<HTMLDivElement>(null);
    const view3dBox = useRef<HTMLDivElement>(null);
    const isoBox = useRef<HTMLDivElement>(null);
    const [outWidth, setOutWidth] = useState<number | undefined>(undefined);
    useLayoutEffect(() => {
      const el = { slices: slicesBox, view3d: view3dBox, volume3d: isoBox }[tab].current;
      if (!el) return undefined;
      const fit = () => setOutWidth(el.offsetWidth || undefined);
      fit();
      const ro = new ResizeObserver(fit);
      ro.observe(el);
      return () => ro.disconnect();
    }, [tab, sceneError]);

    /* ---------- layout ---------- */
    const rootClass = full ? `${styles.root} ${styles.full}` : styles.root;
    const TAB_LABELS: Record<VolumeViewerTab, string> = { slices: "Slices", view3d: "3D planes", volume3d: "3D volume" };
    const tabs = shownTabs.map((t) => [t, TAB_LABELS[t]] as const);

    return (
      <div ref={rootRef} className={rootClass} style={fillHeight && !full ? { height: "100%" } : undefined}>
        {info && <p className={styles.info}>{info}</p>}
        <div className={styles.head}>
          {tabs.length > 1 ? (
            <div className={styles.tabs}>
              {tabs.map(([id, label]) => (
                <button key={id} type="button" className={tab === id ? styles.active : undefined}
                        onClick={() => setTab(id)}>
                  {label}
                </button>
              ))}
            </div>
          ) : <div style={{ flex: 1 }} />}
          <button type="button" className={styles.fullBtn}
                  title={full ? "Back to the page (Esc)" : "Expand to the browser window"}
                  onClick={toggleFull}>
            {full ? <Minimize size={16} /> : <Maximize size={16} />}
          </button>
        </div>

        {tabsCfg.slices && (
          <div style={{ display: tab === "slices" ? undefined : "none" }}>
            {slicesToolbar}
            <div ref={slicesBox} className={styles.content}>
            <VolumeSlices
              ref={slicesRef}
              dim={dim}
              keys={keys}
              size={size}
              scale={scale}
              pos={pos}
              sel={sel}
              mode={mode}
              partsOn={partsOn}
              particles={particles}
              tolerance={nearSlices ? tolerance : Infinity}
              hideLines={hideLines || !toolsCfg.crosshair}
              particleColor={particleColor}
              inverted={inverted}
              rulers={rulers}
              mask={sliceMask}
              colorBy={sliceColorBy}
              corner={sliceKey}
              voxelSize={vs}
              getImage={getImage}
              loadImage={loadImage}
              loadCrop={loadCrop}
              filterSigma={shownSigma}
              onPosition={(p) => { setSel(-1); setPos(p, true); }}
              onParticle={selectParticle}
              onRuler={(a, r) => setRulers((cur) => ({ ...cur, [a]: r }))}
              pushHistory={pushHistory}
            />
            </div>
          </div>
        )}

        {tabsCfg.view3d && (
          <div style={{ display: tab === "view3d" ? undefined : "none" }}>
            {view3dToolbar}
            {sceneError ? <div className={styles.msg}>{sceneError}</div> : (
              <div ref={view3dBox} className={styles.wrap3d}>
                <div ref={sceneHost} className={styles.canvas3d}>
                  {/* Over the scene while the volume loads (or why it does not show) */}
                  {volOn && volGrid.status && (
                    <div className={styles.volNotice} role="status"
                         data-error={volGrid.status.startsWith("Could") || volGrid.status.includes("no density") || undefined}>
                      {!volGrid.status.startsWith("Could") && <span className={styles.spinner} aria-hidden />}
                      {volGrid.status}
                    </div>
                  )}
                </div>
                <div className={styles.ctrl3d}>
                  <div className={styles.row}
                       title="Drag to rotate in any direction, right-drag or shift+drag to move, wheel to zoom">
                    Up to two planes at a time
                  </div>
                  {AXES.map((a) => (
                    <div key={a} className={styles.row}>
                      <label>
                        <input type="checkbox" checked={active.includes(a)} onChange={() => togglePlane(a)} />{" "}
                        {a.toUpperCase()} plane
                      </label>
                      <input type="range" min={0} max={dim[a] - 1} step={1} value={pos[a]}
                             disabled={!active.includes(a)}
                             onChange={(e) => { setSel(-1); setPos({ [a]: Number(e.target.value) }, true); }} />
                      <div className={styles.lbl} style={{ textAlign: "right" }}>
                        {a.toUpperCase()}: {pos[a]}
                      </div>
                    </div>
                  ))}
                  {volOn && (
                    <>
                      {volGrid.status && <div className={styles.volStatus}>{volGrid.status}</div>}
                      <label className={styles.row}>
                        <span>
                          <input type="checkbox" checked={volDark} onChange={(e) => setVolDark(e.target.checked)} />
                          {" "}Dark density
                        </span>
                      </label>
                      <div className={styles.row}
                           title="Share of the voxels drawn: the darkest (dark density) or the brightest">
                        Volume density: {Math.round(volShare * 100)}%
                        <input type="range" min={1} max={40} value={Math.round(volShare * 100)}
                               onChange={(e) => setVolShare(Number(e.target.value) / 100)} />
                      </div>
                      <div className={styles.row}>
                        Volume opacity
                        <input type="range" min={5} max={100} value={Math.round(volOpacity * 100)}
                               onChange={(e) => setVolOpacity(Number(e.target.value) / 100)} />
                      </div>
                      <div className={styles.row} title="Draw the volume only this close to the shown planes, or all of it">
                        <select value={volNear ? "near" : "all"} onChange={(e) => setVolNear(e.target.value === "near")}>
                          <option value="near">Near the shown planes</option>
                          <option value="all">All the volume</option>
                        </select>
                      </div>
                      {volNear && (
                        <div className={styles.row} style={{ marginTop: 8 }}>
                          Distance: ± {volTolerance} voxels
                          <input type="range" min={1} max={Math.max(50, Math.round(Math.max(dim.x, dim.y, dim.z) / 2))}
                                 step={1} value={volTolerance}
                                 onChange={(e) => setVolTolerance(Number(e.target.value))} />
                        </div>
                      )}
                    </>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        {tabsCfg.volume3d && (
          <div style={{ display: tab === "volume3d" ? undefined : "none" }}>
            <div className={styles.toolbar}>
              {toolsCfg.pan && (
                <ToolButton title="Move the volume: drag it in any direction (or right-drag / shift+drag)"
                            active={isoPan} onClick={() => setIsoPan((v) => !v)}>
                  <Move size={16} />
                </ToolButton>
              )}
              {toolsCfg.invert && (
                <ToolButton active={inverted} onClick={() => toggleInvert(false)}
                            title="Invert the contrast: enclose the dark density (the threshold moves to the other tail)">
                  <Contrast size={16} />
                </ToolButton>
              )}
              {maskButton("volume3d")}
              {iters && iterIdx !== null && (
                <label className={styles.iterSelect} title="Iteration of the map shown in the 3D volume">
                  <select value={iterIdx} onChange={(e) => { setPlaying(false); setIterIdx(Number(e.target.value)); }}>
                    {iters.items.map((it, i) => <option key={it.file} value={i}>{it.label}</option>)}
                  </select>
                </label>
              )}
              {iters && (
                <ToolButton title={iterCharts ? "Hide the iterations"
                                     : "Iterations: play the map through them, with the resolution (and FSC) charts"}
                            active={iterCharts}
                            onClick={() => { if (iterCharts) setPlaying(false); setIterCharts((v) => !v); }}>
                  <ChartLine size={16} />
                </ToolButton>
              )}
              {resolutionButton("volume3d")}
              <ToolButton title="Reset the 3D view" onClick={() => isoRef.current?.reset()}>
                <RefreshCw size={16} />
              </ToolButton>
            </div>
            <div ref={isoBox} className={styles.content}>
              {builtIso && isoDensity && (
                <IsoSurfaceView ref={isoRef} density={isoDensity} dim={dim} onDebug={onDebug}
                                preload={iterPreload} onPreloaded={onIterPreloaded} onShown={setIsoShown}
                                debug={showDebug}
                                below={iters && iterIdx !== null && iterCharts ? (
                                  <div ref={iterBarRef}>
                                    <IterationsBar items={iters.items} index={iterIdx} playing={playing} fps={iterFps}
                                                   loaded={iterLoaded} width={sizeIso[0]}
                                                   onIndex={setIterIdx} onPlaying={setPlaying} onFps={setIterFps} />
                                  </div>
                                ) : null}
                                width={sizeIso[0]} height={sizeIso[1]} pan={isoPan} defaults={defaults.iso}
                                panelHeight={sizeIso[2]} panelWidth={sizeIso[3]}
                                onPanelHeight={onIsoPanelHeight}
                                inverted={inverted} onInvert={(v) => { if (v !== inverted) toggleInvert(false); }}
                                mask={isoMask} maskStyle={maskStyle} colorBy={isoColorBy} />
              )}
            </div>
          </div>
        )}

        {showDebug && debug && (
          <div className={styles.debug} style={{ width: outWidth }} title="Timing of the volume (debug)">
            {debugText(debug)}
          </div>
        )}
        <div className={styles.out} style={{ width: outWidth }}>
          {resStatus && (tab === "volume3d" || tab === "slices") ? (
            // The resolution map loading (or its error), then the usual text
            <span className={resLoading ? styles.outStatus : `${styles.outStatus} ${styles.outStatusError}`}
                  role="status" aria-live="polite">
              {resLoading && <Loader2 size={14} className={styles.spin} aria-hidden="true" />}
              {resStatus}
            </span>
          ) : tab === "volume3d"
            ? <>Drag to rotate, right-drag or shift+drag to move, wheel to zoom &nbsp;·&nbsp; {scaleText(vs)}</>
            : readout}
        </div>
      </div>
    );
  },
);
