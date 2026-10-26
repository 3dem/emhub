import { useEffect, useState } from "react";
import type {
  VolumeRegionLabels,
  VolumeRenderData,
} from "./volume-color-utils";
// Inlined in the bundle (blob URL), so no extra file must be deployed
import VolumeRegionWorker from "./volume-region-worker.ts?worker&inline";

export default function useVolumeRegions({
  enabled,
  data,
  level,
  minRegionVoxels = 12,
  maxRegions = 96,
}: {
  enabled: boolean;
  data: VolumeRenderData | null;
  level: number;
  minRegionVoxels?: number;
  maxRegions?: number;
}) {
  const [regions, setRegions] =
    useState<VolumeRegionLabels | null>(null);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (
      !enabled ||
      !data ||
      !Number.isFinite(level) ||
      !data.values.length
    ) {
      setRegions(null);
      setLoading(false);
      setError(null);
      return;
    }

    let worker: Worker | null = null;
    let cancelled = false;

    setLoading(true);
    setError(null);

    const timeoutId = window.setTimeout(() => {
      if (cancelled) return;

      worker = new VolumeRegionWorker();

      worker.onmessage = (event) => {
        if (cancelled) return;

        if (event.data?.error) {
          setError(String(event.data.error));
          setRegions(null);
          setLoading(false);
          return;
        }

        setRegions({
          dims: {
            x: event.data.dims[0],
            y: event.data.dims[1],
            z: event.data.dims[2],
          },
          labels: new Uint8Array(event.data.labelsBuffer),
          regionCount: Number(event.data.regionCount) || 0,
        });

        setLoading(false);
      };

      worker.onerror = () => {
        if (cancelled) return;

        setError("Could not calculate 3D regions.");
        setRegions(null);
        setLoading(false);
      };

      const values = new Float32Array(data.values);

      worker.postMessage(
        {
          dims: [data.dims.x, data.dims.y, data.dims.z],
          values,
          level,
          minRegionVoxels,
          maxRegions,
        },
        [values.buffer],
      );
    }, 180);

    return () => {
      cancelled = true;
      window.clearTimeout(timeoutId);
      worker?.terminate();
    };
  }, [
    enabled,
    data,
    level,
    minRegionVoxels,
    maxRegions,
  ]);

  return { regions, loading, error };
}