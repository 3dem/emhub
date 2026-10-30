// src/data/DataLoaderContext.tsx
// The DataLoader of a mount (see widget/mount.tsx) and a hook to load data.
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { DataLoader, toDataLoader } from "./DataLoader";

const DataLoaderContext = createContext<DataLoader | null>(null);

export function DataLoaderProvider({ loader, children }: { loader: DataLoader; children: ReactNode }) {
  return <DataLoaderContext.Provider value={loader}>{children}</DataLoaderContext.Provider>;
}

/** The mount's DataLoader (a shared default one outside a mount). */
export function useDataLoader(): DataLoader {
  return useContext(DataLoaderContext) ?? toDataLoader();
}

export type LoadState<T> =
  | { status: "idle" | "loading"; data?: undefined; error?: undefined }
  | { status: "ready"; data: T; error?: undefined }
  | { status: "error"; data?: undefined; error: Error };

/**
 * Loads `path` with `payload` (nothing while path is null). Requests are
 * cached and shared by the loader; a stale response (path or payload changed,
 * or unmounted) is ignored.
 */
export function useLoad<T>(path: string | null | undefined, payload?: unknown): LoadState<T> {
  const loader = useDataLoader();
  const payloadKey = JSON.stringify(payload ?? null);
  const [state, setState] = useState<LoadState<T>>({ status: path ? "loading" : "idle" });

  useEffect(() => {
    if (!path) {
      setState({ status: "idle" });
      return undefined;
    }
    const ctrl = new AbortController();
    setState({ status: "loading" });
    loader
      .load<T>(path, JSON.parse(payloadKey), { signal: ctrl.signal })
      .then((data) => setState({ status: "ready", data }))
      .catch((error) => {
        if (!ctrl.signal.aborted) setState({ status: "error", error: error instanceof Error ? error : new Error(String(error)) });
      });
    return () => ctrl.abort();
  }, [loader, path, payloadKey]);

  return state;
}
