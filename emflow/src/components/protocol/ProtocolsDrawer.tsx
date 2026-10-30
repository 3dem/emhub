import { ROOT_CLASS } from "@/widget/constants";
import { useOverlayRoot } from "@/widget/overlay";
import React, { useState, useCallback, useEffect, useMemo, useRef, type FC } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";

import { ProtocolsTree, type ProtocolNode } from "./ProtocolTree";
import { BoxCubeIcon } from "@/icons";
import styles from "./ProtocolsDrawer.module.css";
import { useProjectService } from "@/ProjectServiceContext";

interface ProtocolsDrawerProps {
  projectId: number | null;
  onProtocolDoubleClick?: (protocolId: string) => void;
  onProtocolHelpClick?: (protocolId: string, protocolLabel?: string) => void;

  open?: boolean;
  onOpenChange?: (open: boolean) => void;

  autoLoadOnOpen?: boolean;

  // Optional: used only as an anchor/bounds reference (not as a portal target)
  // to keep the drawer visually inside the widget/grafo.
  portalContainer?: HTMLElement | null;
}

type Insets = { top: number; right: number; bottom: number; left: number };

const getHostIsDarkFromElement = (el: HTMLElement | null): boolean => {
  if (!el || typeof document === "undefined") return false;

  const widgetRoot = el.closest(`.${ROOT_CLASS}`) as HTMLElement | null;
  const probe = widgetRoot ?? el;

  const probeDark =
    probe.classList.contains("dark") || probe.getAttribute("data-theme") === "dark";

  if (probeDark) return true;

  const html = document.documentElement;
  const body = document.body;

  return Boolean(
    html.classList.contains("dark") ||
      html.getAttribute("data-theme") === "dark" ||
      body?.classList.contains("dark") ||
      body?.getAttribute("data-theme") === "dark",
  );
};

const computeInsetsFromRect = (rect: DOMRect): Insets => {
  const vw = typeof window !== "undefined" ? window.innerWidth : 0;
  const vh = typeof window !== "undefined" ? window.innerHeight : 0;

  const top = Math.max(0, Math.round(rect.top));
  const left = Math.max(0, Math.round(rect.left));
  const right = Math.max(0, Math.round(vw - rect.right));
  const bottom = Math.max(0, Math.round(vh - rect.bottom));

  return { top, right, bottom, left };
};

export const ProtocolsDrawer: FC<ProtocolsDrawerProps> = ({
  projectId,
  onProtocolDoubleClick,
  onProtocolHelpClick,
  open: openProp,
  onOpenChange,
  autoLoadOnOpen = true,
  portalContainer,
}) => {
  const svc = useProjectService();
  const overlayRoot = useOverlayRoot();
  const hostRef = useRef<HTMLDivElement | null>(null);

  const [hostIsDark, setHostIsDark] = useState(false);

  useEffect(() => {
    // syncHostDarkMode
    const sync = () => setHostIsDark(getHostIsDarkFromElement(hostRef.current));
    sync();

    const widgetRoot = hostRef.current?.closest(`.${ROOT_CLASS}`) as HTMLElement | null;

    const obs = new MutationObserver(() => sync());
    try {
      if (widgetRoot) {
        obs.observe(widgetRoot, { attributes: true, attributeFilter: ["class", "data-theme"] });
      }
      obs.observe(document.documentElement, { attributes: true, attributeFilter: ["class", "data-theme"] });
      if (document.body) {
        obs.observe(document.body, { attributes: true, attributeFilter: ["class", "data-theme"] });
      }
    } catch {
      // noOp
    }

    return () => obs.disconnect();
  }, []);

  const [protocols, setProtocols] = useState<ProtocolNode[]>([]);
  const [loading, setLoading] = useState(false);

  const [innerOpen, setInnerOpen] = useState(false);
  const isControlled = typeof openProp === "boolean";
  const isOpen = isControlled ? (openProp as boolean) : innerOpen;

  const setOpen = (v: boolean) => {
    if (isControlled) onOpenChange?.(v);
    else setInnerOpen(v);
  };

  const [selectedRoot, setSelectedRoot] = useState<ProtocolNode | null>(null);
  const [searchText, setSearchText] = useState("");
  const searchInputRef = useRef<HTMLInputElement | null>(null);

  const lastLoadedProjectId = useRef<number | null>(null);

  const fetchProtocolsForProject = useCallback(async (pid: number) => {
    setLoading(true);
    try {
      const data = await svc.loadProtocols(pid);
      const normalized = Array.isArray(data) ? data : Object.values(data);
      setProtocols(normalized);
      setSelectedRoot(normalized.length > 0 ? normalized[0] : null);
      lastLoadedProjectId.current = pid;
    } catch (err) {
      console.error("Error loading protocols:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  const handleButtonOpen = useCallback(async () => {
    if (projectId == null) return;
    await fetchProtocolsForProject(projectId);
    setOpen(true);
  }, [projectId, fetchProtocolsForProject]);

  useEffect(() => {
    if (!autoLoadOnOpen) return;
    if (!isOpen) return;
    if (projectId == null) return;

    const needsLoad =
      protocols.length === 0 || lastLoadedProjectId.current !== projectId;

    if (needsLoad) {
      fetchProtocolsForProject(projectId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, projectId, autoLoadOnOpen]);

  useEffect(() => {
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onEsc);
    return () => window.removeEventListener("keydown", onEsc);
  }, [isControlled, onOpenChange]);

  useEffect(() => {
    if (!isOpen) return;
    const t = window.setTimeout(() => searchInputRef.current?.focus(), 50);
    return () => window.clearTimeout(t);
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) {
      setProtocols([]);
      setSelectedRoot(null);
      lastLoadedProjectId.current = null;
      setSearchText("");
    }
  }, [projectId, isOpen]);

  // ===================== Bounds (keep visually inside the widget) =====================
  const [insets, setInsets] = useState<Insets>({ top: 0, right: 0, bottom: 0, left: 0 });

  const computeBoundsTarget = useCallback((): HTMLElement | null => {
    // preferExplicitPortalContainerAsBoundsReference
    if (portalContainer) return portalContainer;

    // fallbackWidgetRoot
    const widgetRoot = hostRef.current?.closest(`.${ROOT_CLASS}`) as HTMLElement | null;
    if (widgetRoot) return widgetRoot;

    // finalFallback
    return hostRef.current;
  }, [portalContainer]);

  const refreshInsets = useCallback(() => {
    const target = computeBoundsTarget();
    if (!target || typeof window === "undefined") {
      setInsets({ top: 0, right: 0, bottom: 0, left: 0 });
      return;
    }

    const rect = target.getBoundingClientRect();
    setInsets(computeInsetsFromRect(rect));
  }, [computeBoundsTarget]);

  useEffect(() => {
    if (!isOpen) return;

    refreshInsets();

    const onResize = () => refreshInsets();
    const onScroll = () => refreshInsets();

    window.addEventListener("resize", onResize);
    // capture=trueToReactToScrollInsideContainersToo
    window.addEventListener("scroll", onScroll, true);

    return () => {
      window.removeEventListener("resize", onResize);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [isOpen, refreshInsets]);

  const portalVarsStyle = useMemo<React.CSSProperties>(() => {
    return {
      ["--pdInsetTop" as any]: `${insets.top}px`,
      ["--pdInsetRight" as any]: `${insets.right}px`,
      ["--pdInsetBottom" as any]: `${insets.bottom}px`,
      ["--pdInsetLeft" as any]: `${insets.left}px`,
    };
  }, [insets]);

  const drawerEl = (
    <div
      className={[
        styles.drawer,
        styles.drawerVars,
        hostIsDark ? styles.dark : "",
        isOpen ? styles.drawerOpen : styles.drawerClosed,
      ]
        .filter(Boolean)
        .join(" ")}
      role="dialog"
      aria-label="Protocols drawer"
      aria-hidden={!isOpen}
    >
      <div className={styles.header}>
        <h2 className={styles.headerTitle}>Protocols</h2>

        <button
          onClick={() => setOpen(false)}
          className={styles.closeButton}
          aria-label="Close drawer"
          type="button"
        >
          <X className={styles.closeIcon} />
        </button>
      </div>

      {protocols.length > 1 && (
        <div className={styles.rootSelectWrap}>
          <select
            className={styles.rootSelect}
            value={selectedRoot ? Math.max(0, protocols.indexOf(selectedRoot)) : 0}
            onChange={(e) => {
              const idx = Number(e.target.value);
              setSelectedRoot(protocols[idx] ?? null);
              setSearchText("");
            }}
          >
            {protocols.map((node, idx) => (
              <option key={idx} value={idx}>
                {node.text}
              </option>
            ))}
          </select>
        </div>
      )}

      <div className={styles.searchWrap}>
        <div className={styles.searchField}>
          <span className={styles.searchIconWrap} aria-hidden="true">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              className={styles.searchIcon}
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
              />
            </svg>
          </span>

          <input
            ref={searchInputRef}
            type="text"
            placeholder="Search protocols..."
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
            className={styles.searchInput}
          />
        </div>
      </div>

      <div className={styles.treeArea}>
        {selectedRoot ? (
          <ProtocolsTree
            data={[selectedRoot]}
            searchText={searchText}
            isDark={hostIsDark}
            onNodeDoubleClick={(protocolId: string) => {
              onProtocolDoubleClick?.(protocolId);
              setOpen(false);
            }}
            onNodeHelpClick={(protocolId: string, protocolLabel?: string) => {
              onProtocolHelpClick?.(protocolId, protocolLabel);
            }}
          />
        ) : (
          <div className={styles.emptyState}>
            {loading
              ? "Loading protocols…"
              : projectId == null
                ? "Select a project to view protocols"
                : "No protocols found"}
          </div>
        )}
      </div>
    </div>
  );

  const portalLayer = (
    <div className={styles.portalLayer} style={portalVarsStyle} aria-hidden={!isOpen}>
      {drawerEl}
    </div>
  );

  return (
    <div ref={hostRef} className={styles.drawerRoot}>
      <button
        onClick={handleButtonOpen}
        disabled={loading || projectId == null}
        className="pp-chipBtn"
        type="button"
      >
        <BoxCubeIcon className={styles.triggerIcon} />
        {loading ? "Loading…" : "Protocols"}
      </button>

      {typeof document !== "undefined" ? createPortal(portalLayer, overlayRoot) : null}
    </div>
  );
};
