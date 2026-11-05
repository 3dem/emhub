// src/components/viewers/tiltseries/tilts.ts
//
// Formatting of the tilts of TiltSeriesViewer (labels, numbers).
import type { TiltSeriesTilt } from "@/services/ProjectService";

/** A number with `digits` decimals, without "-0". */
export const fmt = (v: number, digits: number) => v.toFixed(digits).replace(/^-(0\.?0*)$/, "$1");

/** "Movie index 25 · tilt -24.0°", as everywhere in EMhub's tilt series window. */
export function tiltLabel(t: TiltSeriesTilt, index: number): string {
  const parts: string[] = [];
  if (t.movieIndex != null) parts.push(`Movie index ${t.movieIndex}`);
  if (t.tiltAngle != null) parts.push(`tilt ${fmt(t.tiltAngle, 1)}°`);
  return parts.length ? parts.join(" · ") : `Tilt ${index + 1}`;
}

export function median(values: number[]): number {
  if (!values.length) return 0;
  const s = [...values].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}
