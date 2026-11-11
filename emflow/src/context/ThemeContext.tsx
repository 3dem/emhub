// src/context/ThemeContext.tsx
//
// Widget-scoped theme. Unlike the ScipionWeb app, this never touches the host
// page: no classes on <html>/<body>, no stylesheet rewriting. The "dark" class
// is only toggled on the widget shell element (.emflow-root). The theme chosen
// in the widget (toggleTheme) is remembered in localStorage (THEME_STORAGE_KEY)
// and used instead of the mode given by the host.

import type React from "react";
import { createContext, useCallback, useContext, useEffect, useState } from "react";

export type Theme = "light" | "dark";
export type ThemeMode = Theme | "auto";

type ThemeContextType = {
  theme: Theme;
  toggleTheme: () => void;
  setThemeMode: (theme: ThemeMode) => void;
};

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

/** True when the host page declares a dark theme on <html> or <body>. */
export function getHostIsDark(): boolean {
  if (typeof document === "undefined") return false;
  const html = document.documentElement;
  const body = document.body;
  return Boolean(
    html.classList.contains("dark") ||
      html.getAttribute("data-theme") === "dark" ||
      body?.classList.contains("dark") ||
      body?.getAttribute("data-theme") === "dark",
  );
}

const THEME_STORAGE_KEY = "emflow:theme";

/** The theme chosen in the widget, if any (storage might be unavailable). */
function readStoredTheme(): Theme | null {
  try {
    const value = localStorage.getItem(THEME_STORAGE_KEY);
    return value === "light" || value === "dark" ? value : null;
  } catch {
    return null;
  }
}

function storeTheme(theme: Theme) {
  try {
    localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // Not remembered (e.g. storage blocked)
  }
}

function resolveTheme(mode: ThemeMode): Theme {
  return mode === "auto" ? (getHostIsDark() ? "dark" : "light") : mode;
}

type ThemeProviderProps = {
  /** "auto" follows the host page (class/data-theme "dark" on html/body). */
  mode?: ThemeMode;
  /** Elements that receive the "dark" class (widget shell and overlay root). */
  rootElements?: HTMLElement[];
  children: React.ReactNode;
};

export const ThemeProvider: React.FC<ThemeProviderProps> = ({
  mode: initialMode = "auto",
  rootElements,
  children,
}) => {
  const [mode, setMode] = useState<ThemeMode>(() => readStoredTheme() ?? initialMode);
  const [theme, setTheme] = useState<Theme>(() => resolveTheme(readStoredTheme() ?? initialMode));

  // The theme chosen in the widget wins over the host's mode
  useEffect(() => setMode(readStoredTheme() ?? initialMode), [initialMode]);

  // followHostThemeWhenAuto
  useEffect(() => {
    setTheme(resolveTheme(mode));
    if (mode !== "auto" || typeof document === "undefined") return;

    const observer = new MutationObserver(() => setTheme(resolveTheme("auto")));
    const opts = { attributes: true, attributeFilter: ["class", "data-theme"] };
    observer.observe(document.documentElement, opts);
    if (document.body) observer.observe(document.body, opts);
    return () => observer.disconnect();
  }, [mode]);

  // applyThemeToWidgetRootOnly
  useEffect(() => {
    rootElements?.forEach((el) => el.classList.toggle("dark", theme === "dark"));
  }, [rootElements, theme]);

  const setThemeMode = useCallback((next: ThemeMode) => setMode(next), []);
  const toggleTheme = useCallback(() => {
    const next: Theme = theme === "dark" ? "light" : "dark";
    storeTheme(next);
    setMode(next);
  }, [theme]);

  return (
    <ThemeContext.Provider value={{ theme, toggleTheme, setThemeMode }}>
      {children}
    </ThemeContext.Provider>
  );
};

export const useTheme = () => {
  const context = useContext(ThemeContext);

  if (context === undefined) {
    throw new Error("useTheme must be used within a ThemeProvider");
  }

  return context;
};
