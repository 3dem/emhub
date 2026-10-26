const rawTimestamp =
  typeof __EMFLOW_BUILD_TIMESTAMP__ !== "undefined" ? __EMFLOW_BUILD_TIMESTAMP__ : "";

const rawVersion = typeof __EMFLOW_VERSION__ !== "undefined" ? __EMFLOW_VERSION__ : "";

/** ISO timestamp injected at build time (vite.config.ts). */
export const WIDGET_BUILD_TIMESTAMP = rawTimestamp.trim() || null;

/** Package version injected at build time (vite.config.ts). */
export const APP_VERSION = rawVersion.trim() || null;

export function formatWidgetBuildTimestamp(iso: string): string {
  try {
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

export function hasWidgetBuildInfo(): boolean {
  return Boolean(WIDGET_BUILD_TIMESTAMP || APP_VERSION);
}
