// src/index.tsx
//
// Library entry. Builds to a UMD bundle (dist/emflow.js) exposing the global
// `EMFlow`, plus a single stylesheet (dist/emflow.css) whose rules are all
// scoped under `.emflow-root` (see postcss.config.js).
import "./pages/Dashboard/projects/ProjectPage.css";

import React from "react";
import ReactDOM from "react-dom/client";
import { CacheProvider } from "@emotion/react";
import createCache from "@emotion/cache";
import { Toaster } from "react-hot-toast";

import { ProjectServiceProvider } from "./ProjectServiceContext";
import { DragProvider } from "./components/protocol/DragContext";
import { ThemeProvider, type ThemeMode } from "./context/ThemeContext";
import ProjectPage from "./pages/Dashboard/projects/ProjectPage";
import { normalizeServiceAPI } from "./widget/normalizeService";
import { createWidgetShell, ensureStylesheet, observeRemoval } from "./widget/shell";
import { ROOT_CLASS } from "./widget/constants";
import { OverlayRootProvider, createOverlayRoot } from "./widget/overlay";
import { APP_VERSION, WIDGET_BUILD_TIMESTAMP } from "./buildInfo";

export type { ProjectService } from "./services/ProjectService";
export type { ThemeMode } from "./context/ThemeContext";

export type MountProjectPageOptions = {
  /** Element (or CSS selector) where the viewer is mounted. */
  container: string | HTMLElement;
  /** Host data service (see ProjectService in src/services/ProjectService.ts). */
  service: unknown;
  /** Project identifier passed to service.fetchProject(). */
  projectName?: string | number;
  /** Alias of projectName. */
  projectId?: string | number;
  /** "auto" (default) follows the host page dark mode (html/body .dark). */
  theme?: ThemeMode;
  /** Optional stylesheet URL injected once in <head> (if not already linked). */
  cssHref?: string;
  /** Accepted for backwards compatibility with ScipionWeb mount calls; unused. */
  props?: Record<string, unknown>;
};

export type MountedProjectPage = {
  unmount: () => void;
  root: ReactDOM.Root;
};

class WidgetErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { err: unknown }
> {
  state = { err: null as unknown };

  static getDerivedStateFromError(err: unknown) {
    return { err };
  }

  componentDidCatch(err: unknown, info: unknown) {
    // eslint-disable-next-line no-console
    console.error("[emflow] error:", err, info);
  }

  render() {
    if (!this.state.err) return this.props.children;
    const err = this.state.err as { stack?: string };
    return (
      <pre
        style={{
          color: "#b91c1c",
          background: "#fee2e2",
          padding: 12,
          borderRadius: 8,
          whiteSpace: "pre-wrap",
          lineHeight: 1.35,
          fontSize: 13,
        }}
      >
        emflow error:
        {"\n"}
        {String(err?.stack || this.state.err)}
      </pre>
    );
  }
}

export function mountProjectPage(options: MountProjectPageOptions): MountedProjectPage {
  const { container, service, theme = "auto", cssHref } = options;
  const projectName = String(options.projectName ?? options.projectId ?? "");

  const target =
    typeof container === "string" ? document.querySelector<HTMLElement>(container) : container;

  if (!target) {
    throw new Error(`emflow: container '${String(container)}' not found`);
  }
  if (!projectName) {
    throw new Error("emflow: missing projectName/projectId");
  }

  const svc = normalizeServiceAPI(service);
  const { shell, mountPoint } = createWidgetShell(target);
  const overlayRoot = createOverlayRoot();
  const removeStylesheet = ensureStylesheet(cssHref);

  // MUI (emotion) styles are injected inside the shell, with their own key
  const emotionCache = createCache({ key: "emflow", container: shell, prepend: false });

  const root = ReactDOM.createRoot(mountPoint);
  root.render(
    <ProjectServiceProvider service={svc}>
      <CacheProvider value={emotionCache}>
        <ThemeProvider mode={theme} rootElements={[shell, overlayRoot]}>
          <OverlayRootProvider container={overlayRoot}>
            <WidgetErrorBoundary>
              <DragProvider>
                <ProjectPage projectName={projectName} />
              </DragProvider>
              <Toaster
                position="bottom-left"
                containerStyle={{ zIndex: 999999 }}
                toastOptions={{
                  style: { width: "420px", maxWidth: "420px", whiteSpace: "normal", background: "#f5f0ee" },
                  duration: 5000,
                }}
              />
            </WidgetErrorBoundary>
          </OverlayRootProvider>
        </ThemeProvider>
      </CacheProvider>
    </ProjectServiceProvider>,
  );

  let disposed = false;
  const stopObserving = observeRemoval(shell, () => unmount());

  function unmount() {
    if (disposed) return;
    disposed = true;
    stopObserving();
    try {
      root.unmount();
    } catch {
      // noOp
    }
    removeStylesheet();
    shell.remove();
    overlayRoot.remove();
  }

  return { unmount, root };
}

export const version = APP_VERSION;
export const buildTimestamp = WIDGET_BUILD_TIMESTAMP;
export const rootClass = ROOT_CLASS;

if (typeof window !== "undefined") {
  // Backwards compatibility with the ScipionWeb widget global used by EMhub's
  // project_widget_bootstrap.html (window.MyProjectsWidget.mountProjectPageWidget)
  const w = window as unknown as Record<string, any>;
  w.MyProjectsWidget = { ...(w.MyProjectsWidget || {}), mountProjectPageWidget: mountProjectPage };

  // eslint-disable-next-line no-console
  console.log(
    `[emflow] ready under window.EMFlow (v${APP_VERSION ?? "?"}${
      WIDGET_BUILD_TIMESTAMP ? `, built ${WIDGET_BUILD_TIMESTAMP}` : ""
    })`,
  );
}
