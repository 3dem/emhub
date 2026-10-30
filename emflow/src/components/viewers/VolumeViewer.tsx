// src/components/viewers/VolumeViewer.tsx
//
// Config-driven volume (tomogram) viewer with two tabs:
//   - Slices: linked X/Y/Z sections (volume/VolumeSlices.tsx) with select,
//     ruler, zoom and pan tools, contrast, crosshair and particles.
//   - 3D: three orthogonal planes in a rotatable scene, at most two shown,
//     the faint whole volume and the particles or their template
//     (volume/VolumeScene3D.ts).
// The data is given inline (`data`) or loaded with the DataLoader (`source`,
// e.g. EMhub's resolve_table_view_pane). Mountable from the host:
//   EMFlow.mount("VolumeViewer", {container, props: {data | source, ...}})
// and its handle (`instance`) has getPosition / setPosition / setTool.
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
  ChevronLeft,
  ChevronRight,
  Contrast,
  Crosshair,
  EyeOff,
  Maximize2,
  Minimize2,
  Move,
  RefreshCw,
  Ruler as RulerIcon,
  Undo2,
  ZoomIn,
} from "lucide-react";
import styles from "./VolumeViewer.module.css";
import { useDataLoader, useLoad } from "@/data/DataLoaderContext";
import VolumeSlices, {
  type HistoryEntry,
  type Mode,
  type VolumeSlicesHandle,
} from "./volume/VolumeSlices";
import { VolumeScene3D, type SceneState } from "./volume/VolumeScene3D";
import {
  AXES,
  clampVox,
  normVoxel,
  rulerLength,
  scaleText,
  sectionSize,
  sliceKeys,
  volumeDataFromPane,
  type Axis,
  type Ruler,
  type Vec3,
  type VolumeData,
} from "./volume/volumeMath";

export type { VolumeData } from "./volume/volumeMath";

export type VolumeViewerConfig = {
  /** Shown tabs (both by default). */
  tabs?: { slices?: boolean; view3d?: boolean };
  /** Tools (all on by default; particles "auto": only if there are particles).
   * ruler and zoom exist only in Slices; volume only in 3D. */
  tools?: {
    select?: boolean;
    ruler?: boolean;
    zoom?: boolean;
    pan?: boolean;
    particles?: boolean | "auto";
    volume?: boolean;
    invert?: boolean;
    lines?: boolean;
  };
  initialTool?: Mode;
  /** Longest side of the Z section in px (520). */
  viewSize?: number;
  /** Slab half-thickness (voxels) of the particles shown on a section (10). */
  particleTolerance?: number;
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
};

export type VolumeViewerHandle = {
  getPosition: () => Vec3;
  setPosition: (p: Partial<Vec3>) => void;
  setTool: (tool: Mode) => void;
};

const MODES: Exclude<Mode, null>[] = ["select", "ruler", "zoom", "pan"];
const VOL_OPACITY = 0.35;

const svg = (children: ReactNode) => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"
       strokeLinecap="round" strokeLinejoin="round">
    {children}
  </svg>
);
const ICON_PARTICLES = svg(<><circle cx="5" cy="5" r="2.5" /><circle cx="11" cy="6" r="2.5" /><circle cx="7" cy="11.5" r="2.5" /></>);
const ICON_VOLUME = svg(<><path d="M8 1.5l6 3v7l-6 3-6-3v-7z" strokeDasharray="2 2" /><path d="M2 4.5l6 3 6-3M8 7.5v7" /></>);
const ICON_TEMPLATE = svg(<><ellipse cx="8" cy="10.5" rx="6" ry="3.5" /><ellipse cx="8" cy="5.5" rx="3.6" ry="2.6" /></>);

function ToolButton({ title, active, onClick, children, hidden }: {
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

const VolumeViewer = forwardRef<VolumeViewerHandle, VolumeViewerProps>(function VolumeViewer(props, ref) {
  const { data, source } = props;
  const loaded = useLoad<unknown>(data ? null : source?.path, source?.payload);
  const volume = useMemo(
    () => (data ? volumeDataFromPane(data) : loaded.status === "ready" ? volumeDataFromPane(loaded.data) : null),
    [data, loaded],
  );

  if (!volume) {
    let msg = "No volume to show.";
    if (!data && source) {
      if (loaded.status === "error") msg = loaded.error.message;
      else if (loaded.status !== "ready") msg = "Loading…";
      else msg = "The response has no X, Y and Z slices of a volume.";
    } else if (data) {
      msg = "The volume needs dimensions and slices along X, Y and Z.";
    }
    return <div className={styles.msg}>{msg}</div>;
  }
  return <VolumeViewerCore {...props} ref={ref} volume={volume} />;
});

export default VolumeViewer;

const VolumeViewerCore = forwardRef<VolumeViewerHandle, VolumeViewerProps & { volume: VolumeData }>(
  function VolumeViewerCore(props, ref) {
    const { volume, info, onSelect } = props;
    const [X, Y, Z] = volume.dimensions;
    const dim = useMemo<Vec3>(() => ({ x: X, y: Y, z: Z }), [X, Y, Z]);
    const size = useMemo(() => sectionSize(dim), [dim]);
    const keys = useMemo(() => sliceKeys(volume.axes), [volume.axes]);
    const vs = useMemo(() => normVoxel(volume.voxelSize), [volume.voxelSize]);
    const tabsCfg = { slices: true, view3d: true, ...props.tabs };
    const toolsCfg = {
      select: true, ruler: true, zoom: true, pan: true, particles: "auto" as boolean | "auto",
      volume: true, invert: true, lines: true, ...props.tools,
    };
    const viewSize = props.viewSize ?? 520;
    const tolerance = props.particleTolerance ?? 10;
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
    const [partsOn, setPartsOn] = useState(hasParticles);
    const [hideLines, setHideLines] = useState(false);
    const [inverted, setInverted] = useState(false);
    const [volOn, setVolOn] = useState(false);
    const [tmplOn, setTmplOn] = useState(false);
    const [active, setActive] = useState<Axis[]>(["z", "y"]);
    const [volOpacity, setVolOpacity] = useState(VOL_OPACITY);
    const [rulers, setRulers] = useState<Record<Axis, Ruler | null>>({ x: null, y: null, z: null });
    const [tab, setTab] = useState<"slices" | "view3d">(tabsCfg.slices ? "slices" : "view3d");
    const [full, setFull] = useState(false);
    const [fixed, setFixed] = useState(false);
    const [built3d, setBuilt3d] = useState(tab === "view3d");
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
    const stepParticle = (dir: number) => {
      if (!nPart) return;
      selectParticle(sel < 0 ? (dir > 0 ? 0 : nPart - 1) : (sel + dir + nPart) % nPart);
    };
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

    /* ---------- images (decoded once, shared by both tabs) ---------- */
    const loader = useDataLoader();
    const images = useRef(new Map<string, HTMLImageElement>());
    useEffect(() => images.current.clear(), [volume.axes]);
    const getImage = useCallback((a: Axis, key: number) => images.current.get(`${a}:${key}`) ?? null, []);
    const loadImage = useCallback((a: Axis, key: number) => {
      const src = volume.axes[a][String(key)];
      if (!src) return Promise.reject(new Error(`No ${a} slice ${key}`));
      return loader.image(src).then((img) => {
        images.current.set(`${a}:${key}`, img);
        return img;
      });
    }, [loader, volume.axes]);

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
    const [box, setBox] = useState({ width: 800, room: 700 });
    const measure = useCallback(() => {
      const el = rootRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      let room: number;
      if (full) room = window.innerHeight;
      else if (fillHeight) room = el.parentElement?.clientHeight || rect.height;
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

    // Screen px per voxel: the sections fit the room without scrolling
    const scale = useMemo(() => {
      const availH = Math.max(200, box.room - (full ? 190 : 238));
      const availW = Math.max(300, box.width - 40);
      const cap = full ? 4 : viewSize / Math.max(X, Y);
      return Math.max(0.05, Math.min(cap, availH / (Y + Z), (availW - 14) / (X + Z)));
    }, [box, full, viewSize, X, Y, Z]);
    const size3d = useMemo(() => {
      const h = Math.max(260, Math.min(full ? 4000 : 520, box.room - (full ? 190 : 220)));
      let w = full ? Math.min(window.innerWidth - 260, h * 1.4) : h * 1.2;
      w = Math.min(w, Math.max(240, box.width - 200));
      return [Math.round(w), Math.round(h)] as [number, number];
    }, [box, full]);

    /* ---------- full screen ---------- */
    useEffect(() => {
      const onChange = () => {
        if (document.fullscreenElement === rootRef.current) setFull(true);
        else if (!fixed) setFull(false);
      };
      const onKey = (e: KeyboardEvent) => {
        if (e.key === "Escape" && fixed) {
          setFixed(false);
          setFull(false);
        }
      };
      document.addEventListener("fullscreenchange", onChange);
      document.addEventListener("keydown", onKey);
      return () => {
        document.removeEventListener("fullscreenchange", onChange);
        document.removeEventListener("keydown", onKey);
        if (document.fullscreenElement === rootRef.current) document.exitFullscreen().catch(() => undefined);
      };
    }, [fixed]);
    const toggleFull = () => {
      const el = rootRef.current;
      if (!el) return;
      if (el.requestFullscreen && !fixed) {
        if (document.fullscreenElement === el) document.exitFullscreen();
        else el.requestFullscreen().catch(() => { setFixed(true); setFull(true); });
      } else {
        setFixed(!fixed);
        setFull(!fixed);
      }
    };

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
    const particleTools = (is3d: boolean) => hasParticles && (
      <>
        <ToolButton title="Show and inspect picked particles" active={partsOn} onClick={() => setPartsOn((v) => !v)}>
          {ICON_PARTICLES}
        </ToolButton>
        <ToolButton title="Previous particle" hidden={!partsOn} onClick={() => stepParticle(-1)}>
          <ChevronLeft size={16} />
        </ToolButton>
        <ToolButton title="Next particle" hidden={!partsOn} onClick={() => stepParticle(1)}>
          <ChevronRight size={16} />
        </ToolButton>
        {is3d && hasTemplate && (
          <ToolButton title="Show the picking template at every particle, with its orientation"
                      active={tmplOn} onClick={() => setTmplOn((v) => !v)}>
            {ICON_TEMPLATE}
          </ToolButton>
        )}
      </>
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
        {particleTools(false)}
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
          <ToolButton title="Show the whole volume as a faint haze" active={volOn} onClick={() => setVolOn((v) => !v)}>
            {ICON_VOLUME}
          </ToolButton>
        )}
        {toolsCfg.invert && (
          <ToolButton title="Invert the contrast" active={inverted} onClick={() => toggleInvert(false)}>
            <Contrast size={16} />
          </ToolButton>
        )}
        {modeButton("pan", "Move the volume: drag it in any direction (or right-drag / shift+drag)", <Move size={16} />)}
        {particleTools(true)}
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
    const sceneState: SceneState = { pos, sel, partsOn, tmplOn, volOn, inverted, active, volOpacity, mode };
    const sceneStateRef = useRef(sceneState);
    sceneStateRef.current = sceneState;
    const pickRef = useRef({ selectParticle, setPos, setSel });
    pickRef.current = { selectParticle, setPos, setSel };

    useEffect(() => {
      if (tab === "view3d") setBuilt3d(true);
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
    }, [built3d, dim, keys, particles, vs, getImage, loadImage]);
    useEffect(() => {
      sceneRef.current?.setState(sceneState);
      // the fields are the dependencies
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [pos, sel, partsOn, tmplOn, volOn, inverted, active, volOpacity, mode]);
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
    const [outWidth, setOutWidth] = useState<number | undefined>(undefined);
    useLayoutEffect(() => {
      const el = tab === "slices" ? slicesBox.current : view3dBox.current;
      if (!el) return undefined;
      const fit = () => setOutWidth(el.offsetWidth || undefined);
      fit();
      const ro = new ResizeObserver(fit);
      ro.observe(el);
      return () => ro.disconnect();
    }, [tab, sceneError]);

    /* ---------- layout ---------- */
    const rootClass = [styles.root, fixed ? styles.fixed : "", full ? styles.full : ""].join(" ");
    const tabs: ["slices" | "view3d", string][] = [];
    if (tabsCfg.slices) tabs.push(["slices", "Slices"]);
    if (tabsCfg.view3d) tabs.push(["view3d", "3D"]);

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
          <button type="button" className={styles.fullBtn} title={full ? "Exit full screen" : "Full screen"}
                  onClick={toggleFull}>
            {full ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
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
              tolerance={tolerance}
              hideLines={hideLines}
              inverted={inverted}
              rulers={rulers}
              voxelSize={vs}
              getImage={getImage}
              loadImage={loadImage}
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
                <div ref={sceneHost} className={styles.canvas3d} />
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
                    <div className={styles.row}>
                      Volume opacity
                      <input type="range" min={5} max={100} value={Math.round(volOpacity * 100)}
                             onChange={(e) => setVolOpacity(Number(e.target.value) / 100)} />
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        <div className={styles.out} style={{ width: outWidth }}>{readout}</div>
      </div>
    );
  },
);
