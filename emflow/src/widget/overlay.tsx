// src/widget/overlay.tsx
//
// Overlays (MUI dialogs, menus, poppers, tooltips and the protocols drawer) are
// portaled to <body>, outside the widget container. To keep them inside the
// CSS scope, each mount creates an "overlay root": a `.emflow-root` element
// appended to <body> (display: contents, so it has no box of its own).
import { createContext, useContext, useMemo, type ReactNode } from "react";
import { createTheme, ThemeProvider as MuiThemeProvider, type ThemeOptions } from "@mui/material/styles";
import { ROOT_CLASS } from "./constants";

const OverlayRootContext = createContext<HTMLElement | null>(null);

/** Container for portaled overlays (falls back to document.body). */
export function useOverlayRoot(): HTMLElement {
  return useContext(OverlayRootContext) ?? document.body;
}

export function createOverlayRoot(): HTMLElement {
  const el = document.createElement("div");
  el.className = `${ROOT_CLASS} emflow-overlays`;
  // The root class sets display/min-height/background for the main container
  el.style.display = "contents";
  document.body.appendChild(el);
  return el;
}

/** MUI default props that send every portal into the overlay root. */
export function portalComponents(container: HTMLElement | null): ThemeOptions["components"] {
  if (!container) return {};
  return {
    MuiModal: { defaultProps: { container } }, // Dialog, Drawer, Menu, Select
    MuiDialog: { defaultProps: { container } },
    MuiPopover: { defaultProps: { container } },
    MuiPopper: { defaultProps: { container } }, // Tooltip, Autocomplete
  };
}

/** createTheme() keeping the overlay container defaults (for nested MUI themes). */
export function useEmflowMuiTheme(options: ThemeOptions = {}) {
  const container = useContext(OverlayRootContext);
  return useMemo(
    () =>
      createTheme({
        ...options,
        components: { ...portalComponents(container), ...(options.components ?? {}) },
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [container, JSON.stringify(options)],
  );
}

export function OverlayRootProvider({
  container,
  children,
}: {
  container: HTMLElement;
  children: ReactNode;
}) {
  return (
    <OverlayRootContext.Provider value={container}>
      <OverlayMuiTheme>{children}</OverlayMuiTheme>
    </OverlayRootContext.Provider>
  );
}

function OverlayMuiTheme({ children }: { children: ReactNode }) {
  const theme = useEmflowMuiTheme();
  return <MuiThemeProvider theme={theme}>{children}</MuiThemeProvider>;
}
