// src/components/viewers/tiltseries/useNeighbourCorrelation.ts
//
// How well the tilts of a series line up (TiltSeriesViewer): the
// correlation of each tilt with its neighbours, for each way of drawing them
// (as acquired, global, global + local), computed in the background in
// chunks once the images are in. Every tilt on a frame of at most
// METRIC_SIZE px, band-passed (prepareForCorrelation), correlated with the
// next one; per tilt the mean of its two pairs.
import { useEffect, useState } from "react";
import type { TiltSeriesTilt } from "@/services/ProjectService";
import {
  correlation,
  prepareForCorrelation,
  scaleGrey,
  VIEW_APPLY,
  warpTilt,
  type Geometry,
  type Prepared,
  type View,
} from "./alignment";

/** The correlation is computed on frames of at most this size (px). */
const METRIC_SIZE = 320;

/** The neighbour correlation of each tilt, per view. */
export type NeighbourCorrelation = Partial<Record<View, Array<number | null>>>;

/** null until every view is measured. */
export default function useNeighbourCorrelation({ ready, n, views, greyAt, geom, pixelSize, tilts, theta0 }: {
  /** Every tilt image is loaded. */
  ready: boolean;
  n: number;
  views: View[];
  /** The grey values of tilt i (null if not loaded). */
  greyAt: (i: number) => Float32Array | null;
  geom: Geometry;
  /** Å per pixel of the images (null: unknown, taken as 10 for the band-pass). */
  pixelSize: number | null;
  tilts: TiltSeriesTilt[];
  theta0: number;
}): NeighbourCorrelation | null {
  const [result, setResult] = useState<NeighbourCorrelation | null>(null);
  useEffect(() => {
    setResult(null);
    if (!ready || n < 2) return undefined;
    let live = true;
    const scale = Math.min(1, METRIC_SIZE / Math.max(geom.frameW, geom.frameH));
    const pxMetric = (pixelSize ?? 10) / scale;
    const tick = () => new Promise((r) => window.setTimeout(r, 0));
    (async () => {
      const out: NeighbourCorrelation = {};
      let done = 0;
      for (const v of views) {
        const prepared: Array<Prepared | null> = [];
        for (let i = 0; i < n; i++) {
          if (!live) return;
          const grey = greyAt(i);
          if (!grey) { prepared.push(null); continue; }
          const g = v === "raw" ? scaleGrey(grey, geom.w, geom.h, scale)
            : warpTilt(grey, geom, tilts[i], VIEW_APPLY[v], theta0, scale, 6);
          prepared.push(prepareForCorrelation(g, pxMetric));
          // Let the page breathe
          if (++done % 4 === 0) await tick();
        }
        const pair = prepared.slice(1).map((b, i) => {
          const a = prepared[i];
          return a && b ? correlation(a, b) : null;
        });
        out[v] = prepared.map((_, i) => {
          const vals = [pair[i - 1], pair[i]].filter((x): x is number => x != null);
          return vals.length ? vals.reduce((s, x) => s + x, 0) / vals.length : null;
        });
      }
      if (live) setResult(out);
    })();
    return () => { live = false; };
  }, [ready, n, views, greyAt, geom, pixelSize, tilts, theta0]);
  return result;
}
