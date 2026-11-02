// src/components/viewers/volume/IsoSurfaceView.tsx
//
// The "3D volume" tab of VolumeViewer: loads the density (inline, or with the
// DataLoader when the tab is first opened) and shows it as an iso-surface
// (IsoSurfaceScene) with the histogram and options beside (DensityPanel).
// The surface may be smoothed and its dust (small blobs of noise) hidden:
// both filter the grid given to the GPU, not the map.
import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import styles from "../VolumeViewer.module.css";
import { useLoad } from "@/data/DataLoaderContext";
import { IsoSurfaceScene, type IsoState } from "./IsoSurfaceScene";
import DensityPanel, { DETAILS, levelForFraction, type DensityOptions } from "./DensityPanel";
import { densityValues, prepareDensity, removeDust, smoothGrid } from "./densityGrid";
import { isDensitySource, type DensitySource, type Vec3, type VolumeDensity } from "./volumeMath";

export type IsoSurfaceHandle = { reset: () => void };

/** Timing of the density, for VolumeViewer's debug line. */
export type DensityDebug = {
  /** "request": loaded by the viewer; "inline": it came with the data. */
  from?: "request" | "inline";
  requestMs?: number;
  decodeMs?: number;
  /** Smoothing and dust removal of the last change. */
  filterMs?: number;
  hidden?: number;
  density?: VolumeDensity;
};

/** First options of the 3D volume tab. */
export type IsoDefaults = {
  /** Threshold in the units of the map; else the one enclosing `enclosed`. */
  threshold?: number;
  /** Share of the voxels enclosed by the first threshold (0.01, as ChimeraX). */
  enclosed?: number;
  /** Dark density: enclose the values below the threshold (false). */
  below?: boolean;
  /** 0-1 (1). */
  opacity?: number;
  /** CSS hex (ChimeraX's #b2b2ff). */
  color?: string;
  /** Most voxels of the grid asked to the host (2 M; see DETAILS). */
  maxVoxels?: number;
  /** Hide the blobs smaller than this many grid voxels (20; 0: show all). */
  dust?: number;
  /** Smooth the surface (display only; false). */
  smooth?: boolean;
};

type Props = {
  density: VolumeDensity | DensitySource;
  dim: Vec3;
  width: number;
  height: number;
  /** Drags move the view. */
  pan: boolean;
  defaults?: IsoDefaults;
  /** Timing of the loading and filters, as it happens. */
  onDebug?: (info: DensityDebug) => void;
};

/** Share of the voxels enclosed by the first threshold (as ChimeraX does). */
const INITIAL_ENCLOSED = 0.01;
/** ChimeraX's default map color. */
const DEFAULT_COLOR = "#b2b2ff";
const DEFAULT_DUST = 20;
/** Wait for the threshold to settle before hiding the dust again. */
const DUST_DELAY_MS = 120;

const isInline = (d: VolumeDensity | DensitySource): d is VolumeDensity => !isDensitySource(d);

const IsoSurfaceView = forwardRef<IsoSurfaceHandle, Props>(function IsoSurfaceView(props, ref) {
  const { density: given, dim, width, height } = props;
  const dflt = props.defaults ?? {};
  const enclosed = dflt.enclosed ?? INITIAL_ENCLOSED;
  const [detail, setDetail] = useState(dflt.maxVoxels ?? DETAILS[1][0]);
  const source = isInline(given) ? null : given;
  const loaded = useLoad<unknown>(source?.path, source ? { ...source.payload, maxVoxels: detail } : undefined);
  const debugRef = useRef(props.onDebug);
  debugRef.current = props.onDebug;
  // The last grid stays while another detail loads; it is decoded first
  const [density, setDensity] = useState<VolumeDensity | null>(null);
  useEffect(() => {
    let d: VolumeDensity | null = null;
    let requestMs: number | undefined;
    if (isInline(given)) d = given;
    else if (loaded.status === "ready") {
      const r = loaded.data as { density?: VolumeDensity } & VolumeDensity;
      d = r && r.density ? r.density : r;
      requestMs = loaded.ms;
    }
    if (!d) return undefined;
    let live = true;
    const ready = d;
    prepareDensity(ready).then((decodeMs) => {
      if (!live) return;
      setDensity(ready);
      if (requestMs !== undefined) debugRef.current?.({ from: "request", requestMs, decodeMs, density: ready });
      else if (decodeMs) debugRef.current?.({ from: "inline", decodeMs, density: ready });
    }, (e) => live && setDecodeError(String(e?.message ?? e)));
    return () => { live = false; };
  }, [given, loaded]);
  const [decodeError, setDecodeError] = useState<string | null>(null);

  const [opts, setOpts] = useState<DensityOptions | null>(null);
  // First threshold once the density comes (it is kept for other details)
  useEffect(() => {
    if (!density || opts) return;
    const h = density.histogram;
    const [v0, v1] = density.valueRange;
    const below = Boolean(dflt.below);
    setOpts({
      threshold: dflt.threshold ?? (h ? levelForFraction(h, enclosed, below) : v0 + (below ? 0.3 : 0.7) * (v1 - v0)),
      below,
      opacity: dflt.opacity ?? 1,
      color: dflt.color ?? DEFAULT_COLOR,
      dust: dflt.dust ?? DEFAULT_DUST,
      smooth: Boolean(dflt.smooth),
    });
    // the defaults are only read once
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [density, opts]);
  const onChange = (patch: Partial<DensityOptions>) => {
    setOpts((o) => {
      if (!o) return o;
      const next = { ...o, ...patch };
      // Switching dark/bright density: the same share from the other tail
      const h = density?.histogram;
      if (patch.below !== undefined && patch.below !== o.below && h) {
        next.threshold = levelForFraction(h, enclosed, patch.below);
      }
      return next;
    });
  };

  const host = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<IsoSurfaceScene | null>(null);
  const [error, setError] = useState<string | null>(null);
  const sizeRef = useRef([width, height]);
  sizeRef.current = [width, height];
  const state: IsoState | null = useMemo(
    () => (opts ? { ...opts, pan: props.pan } : null),
    [opts, props.pan],
  );
  const stateRef = useRef(state);
  stateRef.current = state;

  useEffect(() => {
    if (!host.current) return undefined;
    let scene: IsoSurfaceScene;
    try {
      scene = new IsoSurfaceScene(dim, stateRef.current ?? {
        threshold: 0, below: false, opacity: 1, color: DEFAULT_COLOR, dust: 0, smooth: false, pan: false,
      }, sizeRef.current[0], sizeRef.current[1]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "WebGL is not available in this browser.");
      return undefined;
    }
    host.current.appendChild(scene.canvas);
    sceneRef.current = scene;
    return () => {
      scene.dispose();
      scene.canvas.remove();
      sceneRef.current = null;
    };
  }, [dim]);
  // Grid of the surface: smoothed or not, then without the dust at the
  // threshold (after it settles; meanwhile the dust shows)
  const smoothOn = Boolean(opts?.smooth);
  const base = useMemo(() => {
    if (!density) return null;
    const v = densityValues(density);
    return smoothOn ? smoothGrid(v, density.shape) : v;
  }, [density, smoothOn]);
  useEffect(() => {
    if (density && base) sceneRef.current?.setDensity(density, base);
  }, [density, base, error]);
  const [hidden, setHidden] = useState(0);
  const dust = opts?.dust ?? 0;
  const thr = opts?.threshold ?? 0;
  const below = Boolean(opts?.below);
  useEffect(() => {
    if (!density || !base) return undefined;
    if (!dust) {
      sceneRef.current?.setValues(base);
      setHidden(0);
      return undefined;
    }
    const timer = window.setTimeout(() => {
      const t0 = performance.now();
      const [v0, v1] = density.valueRange;
      const level = ((thr - v0) / (v1 - v0 || 1)) * 255;
      const r = removeDust(base, density.shape, level, below, dust);
      sceneRef.current?.setValues(r.values);
      setHidden(r.hidden);
      debugRef.current?.({ filterMs: performance.now() - t0, hidden: r.hidden });
    }, DUST_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [density, base, dust, thr, below]);
  useEffect(() => {
    if (state) sceneRef.current?.setState(state);
  }, [state, density]);
  useEffect(() => {
    sceneRef.current?.resize(width, height);
  }, [width, height]);

  useImperativeHandle(ref, () => ({ reset: () => sceneRef.current?.reset() }), []);

  if (error) return <div className={styles.msg}>{error}</div>;
  const loading = Boolean(source) && loaded.status === "loading";
  return (
    <div className={styles.wrap3d}>
      <div ref={host} className={styles.canvas3d} style={{ width, height }}>
        {!density && (
          <div className={styles.isoWait}>
            {decodeError ? `Could not read the volume: ${decodeError}`
              : loaded.status === "error" ? `Could not load the volume: ${loaded.error.message}` : "Loading the volume…"}
          </div>
        )}
      </div>
      {density && opts && (
        <DensityPanel
          {...opts}
          density={density}
          dims={[dim.x, dim.y, dim.z]}
          detail={detail}
          onDetail={source && !source.payload?.maxSize ? setDetail : undefined}
          loading={loading}
          hidden={hidden}
          onChange={onChange}
        />
      )}
    </div>
  );
});

export default IsoSurfaceView;
