// src/widget/mount.tsx
//
// Mounts one emflow component in a host element. Every mount gets the same
// setup as the project page: a `.emflow-root` shell (CSS scope), an overlay
// root for portals, its own emotion cache, the theme (dark class on its roots),
// a DataLoader and an error boundary. It unmounts by itself when the host
// removes the container (e.g. jQuery `.html()`), so hosts need no cleanup.
import React, {
  forwardRef,
  useImperativeHandle,
  useRef,
  useSyncExternalStore,
  type ComponentType,
  type ReactNode,
} from "react";
import ReactDOM from "react-dom/client";
import { CacheProvider } from "@emotion/react";
import createCache from "@emotion/cache";

import { ProjectServiceProvider } from "../ProjectServiceContext";
import { ThemeProvider, type ThemeMode } from "../context/ThemeContext";
import { DataLoaderProvider } from "../data/DataLoaderContext";
import { DataLoader, toDataLoader, type DataLoaderOptions } from "../data/DataLoader";
import { normalizeServiceAPI } from "./normalizeService";
import { createWidgetShell, ensureStylesheet, observeRemoval } from "./shell";
import { OverlayRootProvider, createOverlayRoot } from "./overlay";

export type MountOptions<P> = {
  /** Element (or CSS selector) where the component is mounted. */
  container: string | HTMLElement;
  /** Component props; change them later with `update()`. */
  props?: P;
  /** "auto" (default) follows the host page dark mode (html/body .dark). */
  theme?: ThemeMode;
  /** Optional stylesheet URL injected once in <head> (if not already linked). */
  cssHref?: string;
  /** true: fill the container height; false (default): the content's height. */
  fill?: boolean;
  /** Data access for the component (default: a shared fetch-based loader). */
  loader?: DataLoader | DataLoaderOptions;
  /** Host ProjectService, for components that need it (the project page). */
  service?: unknown;
};

export type Mounted<P> = {
  /** Merge new props into the current ones and re-render. */
  update: (props: Partial<P>) => void;
  /** Current props. */
  readonly props: P;
  /** Imperative API of the component (its ref), e.g. VolumeViewer.setPosition. */
  readonly instance: any;
  unmount: () => void;
  root: ReactDOM.Root;
};

/** A mountable component, with an optional wrapper for its own providers. */
export type MountableComponent = {
  component: ComponentType<any>;
  wrap?: (children: ReactNode) => ReactNode;
  /** Default of MountOptions.fill */
  fill?: boolean;
};

class MountErrorBoundary extends React.Component<{ children: ReactNode }, { err: unknown }> {
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

/** Props that `update()` can change without re-creating the root. */
function createPropsStore<P>(initial: P) {
  let props = initial;
  const listeners = new Set<() => void>();
  return {
    get: () => props,
    set(patch: Partial<P>) {
      props = { ...props, ...patch };
      listeners.forEach((l) => l());
    },
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

const PropsHost = forwardRef<unknown, {
  store: ReturnType<typeof createPropsStore<any>>;
  component: ComponentType<any>;
}>(function PropsHost({ store, component: Component }, ref) {
  const props = useSyncExternalStore(store.subscribe, store.get);
  const inner = useRef<unknown>(null);
  useImperativeHandle(ref, () => inner.current, [props]);
  // Only components made with forwardRef take a ref (their imperative API)
  const takesRef = (Component as { $$typeof?: symbol }).$$typeof === Symbol.for("react.forward_ref");
  return takesRef ? <Component {...props} ref={inner} /> : <Component {...props} />;
});

export function mountComponent<P extends object>(
  entry: MountableComponent,
  options: MountOptions<P>,
): Mounted<P> {
  const { container, theme = "auto", cssHref } = options;
  const target =
    typeof container === "string" ? document.querySelector<HTMLElement>(container) : container;
  if (!target) {
    throw new Error(`emflow: container '${String(container)}' not found`);
  }

  const fill = options.fill ?? entry.fill ?? false;
  const { shell, mountPoint } = createWidgetShell(target, { fill });
  const overlayRoot = createOverlayRoot();
  const removeStylesheet = ensureStylesheet(cssHref);
  const loader = toDataLoader(options.loader);
  const store = createPropsStore<P>((options.props ?? {}) as P);
  const instanceRef: { current: unknown } = { current: null };

  // MUI (emotion) styles are injected inside the shell, with their own key
  const emotionCache = createCache({ key: "emflow", container: shell, prepend: false });

  let content: ReactNode = (
    <PropsHost store={store} component={entry.component} ref={instanceRef} />
  );
  if (entry.wrap) content = entry.wrap(content);
  if (options.service !== undefined) {
    content = (
      <ProjectServiceProvider service={normalizeServiceAPI(options.service)}>{content}</ProjectServiceProvider>
    );
  }

  const root = ReactDOM.createRoot(mountPoint);
  root.render(
    <CacheProvider value={emotionCache}>
      <ThemeProvider mode={theme} rootElements={[shell, overlayRoot]}>
        <OverlayRootProvider container={overlayRoot}>
          <DataLoaderProvider loader={loader}>
            <MountErrorBoundary>{content}</MountErrorBoundary>
          </DataLoaderProvider>
        </OverlayRootProvider>
      </ThemeProvider>
    </CacheProvider>,
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

  return {
    update: (patch) => store.set(patch),
    get props() {
      return store.get();
    },
    get instance() {
      return instanceRef.current;
    },
    unmount,
    root,
  };
}
