// src/components/viewers/volume/IsoSurfaceView.tsx
//
// The "3D volume" tab of VolumeViewer: loads the density (inline, or with the
// DataLoader when the tab is first opened) and shows it as an iso-surface
// (IsoSurfaceScene) with the histogram and options beside (DensityPanel).
// Its dust (small blobs of noise) may be hidden: it filters the grid given
// to the GPU, not the map. An optional mask (a
// sphere or another map, loaded like the density) is drawn over it. The
// surface may be colored by a local resolution map (colorBy), with its color
// key over the scene, as ChimeraX's "color sample ... key true".
import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import styles from "../VolumeViewer.module.css";
import { useLoad } from "@/data/DataLoaderContext";
import { IsoSurfaceScene, RESOLUTION_PALETTE, type IsoMask, type IsoState, type MaskStyle } from "./IsoSurfaceScene";
import DensityPanel, { DETAILS, enclosedFraction, levelForFraction, type DensityOptions } from "./DensityPanel";
import { densityValues, prepareDensity, removeDust } from "./densityGrid";
import { isDensitySource, type DensitySource, type Vec3, type VolumeDensity } from "./volumeMath";

export type IsoSurfaceHandle = { reset: () => void };

/** Mask of the view: a sphere (voxels) or a map, inline or to load. */
export type IsoMaskInput =
  | { type: "sphere"; center: Vec3; diameter: number }
  | { type: "map"; density: VolumeDensity | DensitySource; threshold?: number };

/** Timing of the density, for VolumeViewer's debug line. */
export type DensityDebug = {
  /** "request": loaded by the viewer; "inline": it came with the data. */
  from?: "request" | "inline";
  requestMs?: number;
  decodeMs?: number;
  /** Dust removal of the last change. */
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
  /** Dark density: enclose the values below the threshold (false); the
   * viewer's `inverted` takes precedence. */
  below?: boolean;
  /** 0-1 (1). */
  opacity?: number;
  /** CSS hex (ChimeraX's #b2b2ff). */
  color?: string;
  /** Most voxels of the grid asked to the host (2 M; see DETAILS). */
  maxVoxels?: number;
  /** Hide the blobs smaller than this many grid voxels (20; 0: show all). */
  dust?: number;
};

type Props = {
  density: VolumeDensity | DensitySource;
  dim: Vec3;
  width: number;
  height: number;
  /** Drags move the view. */
  pan: boolean;
  /** Most height of the side panel (it scrolls when longer). */
  panelHeight?: number;
  /** Width of the panel when it is below the scene (in two columns);
   * undefined: beside the scene. */
  panelWidth?: number;
  /** The height the panel needs to show without scrolling. */
  onPanelHeight?: (height: number) => void;
  /** Inverted contrast (the viewer's Invert button): the dark density is
   * enclosed (values below the threshold). Without it, `defaults.below`. */
  inverted?: boolean;
  /** Called by the Dark density checkbox when `inverted` is given. */
  onInvert?: (inverted: boolean) => void;
  defaults?: IsoDefaults;
  /** Timing of the loading and filters, as it happens. */
  onDebug?: (info: DensityDebug) => void;
  mask?: IsoMaskInput | null;
  maskStyle?: MaskStyle;
  /** Loading or error of a map mask; null once it is shown. */
  onMaskStatus?: (status: string | null) => void;
  /** Color the surface by this map (decoded, on the same box), e.g. a local
   * resolution map; null: the plain color. */
  colorBy?: ColorByInput | null;
};

/** A map that colors the surface (see Props.colorBy). */
export type ColorByInput = {
  density: VolumeDensity;
  /** Palette ends in map units (e.g. the range of the map's values). */
  range: [number, number];
  /** Title of the color key ("Local resolution (Å)"). */
  title?: string;
  /** Unit of the key labels ("Å"). */
  unit?: string;
};

const fmtKey = (v: number) => (Math.abs(v) >= 100 ? v.toFixed(0) : v.toFixed(1));

/** The color key of the colored surface: the palette from the lowest value
 * (left) to the highest, with the ends and the middle labeled (ChimeraX key:
 * horizontal bar, bordered, numeric labels below). */
export function ColorKey({ range, title, unit, inline = false }: {
  range: [number, number];
  title: string;
  unit: string;
  /** In the layout (e.g. beside the slices), not over the 3D view. */
  inline?: boolean;
}) {
  const [lo, hi] = range;
  return (
    <div className={inline ? `${styles.colorKey} ${styles.colorKeyInline}` : styles.colorKey}
         aria-label={`${title}: ${fmtKey(lo)} to ${fmtKey(hi)} ${unit}`}>
      <div className={styles.colorKeyTitle}>{title}</div>
      <div className={styles.colorKeyBar}
           style={{ background: `linear-gradient(to right, ${RESOLUTION_PALETTE.join(", ")})` }} />
      <div className={styles.colorKeyLabels}>
        <span>{fmtKey(lo)}</span>
        <span>{fmtKey((lo + hi) / 2)}</span>
        <span>{fmtKey(hi)}</span>
      </div>
      <div className={styles.colorKeyNote}>
        <span className={styles.colorKeyGray} aria-hidden="true" /> above {fmtKey(hi)} {unit} or no value
      </div>
    </div>
  );
}

/** First threshold of a map mask: 0.5 for a 0-1 mask, else the middle. */
export function maskThreshold(d: VolumeDensity, given?: number): number {
  if (given !== undefined && isFinite(given)) return given;
  const [v0, v1] = d.valueRange;
  return v0 <= 0.5 && v1 >= 0.5 && v1 <= 1.001 ? 0.5 : (v0 + v1) / 2;
}

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
    const below = Boolean(props.inverted ?? dflt.below);
    setOpts({
      threshold: dflt.threshold ?? (h ? levelForFraction(h, enclosed, below) : v0 + (below ? 0.3 : 0.7) * (v1 - v0)),
      below,
      opacity: dflt.opacity ?? 1,
      color: dflt.color ?? DEFAULT_COLOR,
      dust: dflt.dust ?? DEFAULT_DUST,
    });
    // the defaults are only read once
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [density, opts]);
  const onChange = (patch: Partial<DensityOptions>) => {
    setOpts((o) => {
      if (!o) return o;
      const next = { ...o, ...patch };
      // Inverting (dark/bright density) inverts the threshold too: the same
      // share of the voxels from the other tail, so the surface keeps its size
      const h = density?.histogram;
      if (patch.below !== undefined && patch.below !== o.below && h) {
        next.threshold = levelForFraction(h, enclosedFraction(h, o.threshold, o.below), patch.below);
      }
      return next;
    });
  };
  // The viewer's Invert button
  const inverted = props.inverted;
  useEffect(() => {
    if (inverted !== undefined) onChange({ below: inverted });
    // onChange only sets the state
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inverted]);
  const onInvert = props.onInvert;
  const onPanelChange = (patch: Partial<DensityOptions>) => {
    if (patch.below !== undefined && onInvert) {
      const { below: b, ...rest } = patch;
      onInvert(b);
      if (Object.keys(rest).length) onChange(rest);
    } else {
      onChange(patch);
    }
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
        threshold: 0, below: false, opacity: 1, color: DEFAULT_COLOR, dust: 0, pan: false,
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
  // Grid of the surface, then without the dust at the threshold (after it
  // settles; meanwhile the dust shows)
  const base = useMemo(() => (density ? densityValues(density) : null), [density]);
  useEffect(() => {
    if (density && base) sceneRef.current?.setDensity(density, base);
  }, [density, base, error]);
  const [hidden, setHidden] = useState(0);
  // The view frames what is drawn (scene.fit) when the density, its first
  // grid without dust or the mask comes, until the user moves it
  const dustFramed = useRef<VolumeDensity | null>(null);
  const framed = useRef<{ density: VolumeDensity; mask: boolean } | null>(null);
  const autoFit = () => {
    const scene = sceneRef.current;
    if (scene && !scene.touched) scene.fit();
  };
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
      // The first frame without the dust (blobs of noise widen it)
      if (dustFramed.current !== density) {
        dustFramed.current = density;
        autoFit();
      }
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

  /* ---------- mask ---------- */
  const mask = props.mask ?? null;
  const maskGiven = mask?.type === "map" ? mask.density : null;
  const maskSource = maskGiven && !isInline(maskGiven) ? maskGiven : null;
  const maskLoaded = useLoad<unknown>(maskSource?.path, maskSource?.payload);
  const [maskDensity, setMaskDensity] = useState<VolumeDensity | null>(null);
  const maskStatusRef = useRef(props.onMaskStatus);
  maskStatusRef.current = props.onMaskStatus;
  useEffect(() => {
    if (!maskGiven) return undefined;
    let d: VolumeDensity | null = null;
    if (isInline(maskGiven)) d = maskGiven;
    else if (maskLoaded.status === "ready") {
      const r = maskLoaded.data as { density?: VolumeDensity } & VolumeDensity;
      d = r && r.density ? r.density : r;
    } else {
      maskStatusRef.current?.(maskLoaded.status === "error"
        ? `Could not load the mask: ${maskLoaded.error.message}` : "Loading the mask…");
      return undefined;
    }
    if (!d?.data) {
      maskStatusRef.current?.("The mask has no density.");
      return undefined;
    }
    let live = true;
    const ready = d;
    prepareDensity(ready).then(() => {
      if (!live) return;
      setMaskDensity(ready);
      maskStatusRef.current?.(null);
    }, (e) => live && maskStatusRef.current?.(`Could not read the mask: ${String(e?.message ?? e)}`));
    return () => { live = false; };
  }, [maskGiven, maskLoaded]);
  const sphere = mask?.type === "sphere" ? mask : null;
  const mapThreshold = mask?.type === "map" ? mask.threshold : undefined;
  useEffect(() => {
    let m: IsoMask | null = null;
    if (sphere) m = sphere;
    else if (maskGiven && maskDensity) {
      m = { type: "map", density: maskDensity, threshold: maskThreshold(maskDensity, mapThreshold) };
    }
    sceneRef.current?.setMask(m);
    // the sphere is compared by value
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sphere?.diameter, sphere?.center.x, sphere?.center.y, sphere?.center.z, maskGiven, maskDensity, mapThreshold,
      error]);
  const maskStyle = props.maskStyle;
  useEffect(() => {
    if (maskStyle) sceneRef.current?.setMaskStyle(maskStyle);
  }, [maskStyle?.show, maskStyle?.color, maskStyle?.opacity]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ---------- color by a map (local resolution) ---------- */
  const colorBy = props.colorBy ?? null;
  // The range is given (fixed: it does not follow the threshold)
  const colorRange = colorBy?.range ?? null;
  useEffect(() => {
    sceneRef.current?.setColorBy(colorBy && colorRange ? { density: colorBy.density, range: colorRange } : null);
    // the range is compared by value
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [colorBy?.density, colorRange?.[0], colorRange?.[1], density, error]);

  const hasMask = Boolean(sphere || (maskGiven && maskDensity));
  useEffect(() => {
    if (!density || !opts) return;
    const f = framed.current;
    if (f && f.density === density && f.mask === hasMask) return;
    framed.current = { density, mask: hasMask };
    autoFit();
    // after the density, state and mask effects above (same commit)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [density, opts, hasMask, error]);

  useImperativeHandle(ref, () => ({ reset: () => sceneRef.current?.reset() }), []);

  if (error) return <div className={styles.msg}>{error}</div>;
  const loading = Boolean(source) && loaded.status === "loading";
  return (
    <div className={styles.wrap3d}>
      <div ref={host} className={styles.canvas3d} style={{ width, height }}>
        {density && colorBy && colorRange && (
          <ColorKey range={colorRange} title={colorBy.title ?? "Local resolution (Å)"} unit={colorBy.unit ?? "Å"} />
        )}
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
          onChange={onPanelChange}
          maxHeight={props.panelHeight}
          width={props.panelWidth}
          onHeight={props.onPanelHeight}
        />
      )}
    </div>
  );
});

export default IsoSurfaceView;
