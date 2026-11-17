// src/widget/overlay.tsx
//
// Overlays (MUI dialogs, menus, poppers, tooltips and the protocols drawer) are
// portaled to <body>, outside the widget container. To keep them inside the
// CSS scope, each mount creates an "overlay root": a `.emflow-root` element
// appended to <body> (display: contents, so it has no box of its own).
import { createContext, useContext, useMemo, type ReactNode } from "react";
import { createTheme, ThemeProvider as MuiThemeProvider, type ThemeOptions } from "@mui/material/styles";
import { ROOT_CLASS } from "./constants";
import { useTheme } from "../context/ThemeContext";

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

// The accents of MUI's light palette, also in dark: its dark defaults are
// pastel (primary #90caf9 with dark text), so buttons (Save, Launch, Close),
// sliders and checkboxes would change color with the theme
const ACCENTS: ThemeOptions["palette"] = {
  primary: { main: "#1976d2", light: "#42a5f5", dark: "#1565c0", contrastText: "#fff" },
  success: { main: "#2e7d32", light: "#4caf50", dark: "#1b5e20", contrastText: "#fff" },
  error: { main: "#d32f2f", light: "#ef5350", dark: "#c62828", contrastText: "#fff" },
};

// Dark surfaces of MUI (dialogs, menus, selects) in the navy of the widget
// (--emf-pane-bg, --emf-white), as white is in light; MUI's dark default is
// grey (#121212 lightened by an overlay for each elevation)
const DARK_SURFACES: ThemeOptions = {
  palette: { background: { default: "#0b1220", paper: "#111827" } },
  components: { MuiPaper: { styleOverrides: { root: { backgroundImage: "none" } } } },
};

function OverlayMuiTheme({ children }: { children: ReactNode }) {
  // MUI components (dialogs, menus, tooltips, inputs) follow the widget theme
  const { theme: mode } = useTheme();
  const dark = mode === "dark";
  const theme = useEmflowMuiTheme({
    palette: { mode, ...ACCENTS, ...(dark ? DARK_SURFACES.palette : {}) },
    ...(dark ? { components: DARK_SURFACES.components } : {}),
  });
  return <MuiThemeProvider theme={theme}>{children}</MuiThemeProvider>;
}
