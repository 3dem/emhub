// src/index.tsx
//
// Library entry. Builds to a UMD bundle (dist/emflow.js) exposing the global
// `EMFlow`, plus a single stylesheet (dist/emflow.css) whose rules are all
// scoped under `.emflow-root` (see postcss.config.js).
//
//   EMFlow.mount(name, {container, props, ...})   any registered component
//   EMFlow.mountProjectPage({container, service, projectName})
//   EMFlow.components                              names that can be mounted
//   EMFlow.DataLoader                              data access (DataLoader.emhub())
//   EMFlow.Plotly                                  the bundled plotly.js
import "./pages/Dashboard/projects/ProjectPage.css";

import { Toaster } from "react-hot-toast";

import { DragProvider } from "./components/protocol/DragContext";
import ProjectPage from "./pages/Dashboard/projects/ProjectPage";
import VolumeViewer from "./components/viewers/VolumeViewer";
import Plot from "./components/viewers/Plot";
import ImageSlider from "./components/viewers/ImageSlider";
import TableViewerContent from "./components/viewers/TableViewerContent";
import { mountComponent, type MountableComponent, type MountOptions, type Mounted } from "./widget/mount";
import { ROOT_CLASS } from "./widget/constants";
import { DataLoader } from "./data/DataLoader";
import { Plotly } from "./lib/plot";
import { APP_VERSION, WIDGET_BUILD_TIMESTAMP } from "./buildInfo";
import type { ThemeMode } from "./context/ThemeContext";

export type { ProjectService } from "./services/ProjectService";
export type { ThemeMode } from "./context/ThemeContext";
export type { MountOptions, Mounted } from "./widget/mount";
export type { DataLoaderOptions } from "./data/DataLoader";
export type { VolumeViewerProps, VolumeViewerHandle } from "./components/viewers/VolumeViewer";
export type { PlotProps } from "./components/viewers/Plot";

/** Components that hosts can mount by name with `mount()`. */
const COMPONENTS: Record<string, MountableComponent> = {
  ProjectPage: {
    component: ProjectPage,
    fill: true,
    wrap: (children) => (
      <>
        <DragProvider>{children}</DragProvider>
        <Toaster
          position="bottom-left"
          containerStyle={{ zIndex: 999999 }}
          toastOptions={{
            style: { width: "420px", maxWidth: "420px", whiteSpace: "normal", background: "#f5f0ee" },
            duration: 5000,
          }}
        />
      </>
    ),
  },
  VolumeViewer: { component: VolumeViewer },
  Plot: { component: Plot },
  ImageSlider: { component: ImageSlider },
  /** Any table-viewer pane content ({kind: "imageSlider" | "plotly" | "text" ...}). */
  TableViewerContent: { component: TableViewerContent },
};

export const components = Object.keys(COMPONENTS);

/** Mount a registered component (see `components`) in a host element. */
export function mount<P extends object = Record<string, unknown>>(
  name: string,
  options: MountOptions<P>,
): Mounted<P> {
  const entry = COMPONENTS[name];
  if (!entry) {
    throw new Error(`emflow: unknown component '${name}' (available: ${components.join(", ")})`);
  }
  return mountComponent<P>(entry, options);
}

export type MountProjectPageOptions = Omit<MountOptions<never>, "props" | "fill"> & {
  /** Host data service (see ProjectService in src/services/ProjectService.ts). */
  service: unknown;
  /** Project identifier passed to service.fetchProject(). */
  projectName?: string | number;
  /** Alias of projectName. */
  projectId?: string | number;
  theme?: ThemeMode;
};

/** The project page (graph, forms, viewers) of one project. */
export function mountProjectPage(options: MountProjectPageOptions) {
  const projectName = String(options.projectName ?? options.projectId ?? "");
  if (!projectName) {
    throw new Error("emflow: missing projectName/projectId");
  }
  return mount<{ projectName: string }>("ProjectPage", { ...options, props: { projectName } });
}

export { DataLoader, Plotly };
export const version = APP_VERSION;
export const buildTimestamp = WIDGET_BUILD_TIMESTAMP;
export const rootClass = ROOT_CLASS;

if (typeof window !== "undefined") {
  // EMhub's own charts use the global Plotly: the bundled one serves them too
  const w = window as unknown as { Plotly?: unknown };
  if (!w.Plotly) w.Plotly = Plotly;
  // eslint-disable-next-line no-console
  console.log(
    `[emflow] ready under window.EMFlow (v${APP_VERSION ?? "?"}${
      WIDGET_BUILD_TIMESTAMP ? `, built ${WIDGET_BUILD_TIMESTAMP}` : ""
    })`,
  );
}
