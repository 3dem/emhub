// src/components/files/RemoteFileDialog.tsx
import { PORTAL_ROOT_ID, ROOT_CLASS } from "@/widget/constants";
import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/Dialog";
import {
  File as FileIcon,
  FolderOpen,
  CornerUpLeft,
  RefreshCw,
  Home,
  Loader2,
  AlertCircle,
  Search,
  ArrowUp,
  ArrowDown,
} from "lucide-react";

import styles from "./RemoteFileDialog.module.css";

export type RemoteEntry = {
  name: string;
  path: string; // relative path to root (preferred); old backend may still send only basename
  absPath?: string; // absolute filesystem path, used when selecting an entry
  isDir: boolean;
  size?: number;
  mime?: string;
};

type PreviewMeta = {
  name?: string;
  mime?: string;
  width?: number;
  height?: number;
  depth?: number;
  thumbWidth?: number;
  thumbHeight?: number;
  sizeBytes?: number;
  voxelSize?: [number, number, number];
  note?: string;

  // allowArbitraryMetaKeys
  [key: string]: unknown;
};

type DatabaseSummaryItem = {
  key: string;
  value: unknown;
};

type DatabaseTablePreview = {
  name: string;
  type?: string;
  rows?: number | null;
  columns?: number;
  columnPreview?: Array<{
    name: string;
    type?: string;
    notNull?: boolean;
    primaryKey?: boolean;
  }>;
};

type DatabaseSamplePreview = {
  table?: string;
  columns: string[];
  rows: Array<Array<string | number | null>>;
  truncated?: boolean;
};

type RemoteDatabasePreview = {
  engine?: string;
  readable?: boolean;
  isScipion?: boolean;
  objectClass?: string | null;
  objectCount?: number | null;
  summary?: DatabaseSummaryItem[];
  tables?: DatabaseTablePreview[];
  sample?: DatabaseSamplePreview | null;
  warnings?: string[];
  scipion?: {
    objectClass?: string | null;
    objectCount?: number | null;
    reader?: string;
    summary?: DatabaseSummaryItem[];
    sample?: {
      columns?: string[];
      rows?: Array<Record<string, unknown>>;
    };
  };
};

export type RemotePreviewSource =
  | { sourceType: "url"; url: string }
  | { sourceType: "blob"; blob: Blob }
  | { sourceType: "base64"; dataBase64: string; mime?: string };

export type RemotePreview =
  | { kind: "none"; mime?: string; meta?: PreviewMeta; note?: string }
  | { kind: "text"; mime?: string; meta?: PreviewMeta; text: string; truncated?: boolean; language?: string }
  | { kind: "image"; mime?: string; meta?: PreviewMeta; source: RemotePreviewSource }
  | { kind: "volume"; mime?: string; meta?: PreviewMeta; source: RemotePreviewSource }
  | { kind: "table"; mime?: string; meta?: PreviewMeta; columns: string[]; rows: Array<Array<string | number | null>>; truncated?: boolean }
  | { kind: "database"; mime?: string; meta?: PreviewMeta; database: RemoteDatabasePreview; truncated?: boolean }
  | { kind: "error"; mime?: string; meta?: PreviewMeta; message: string };

type ResolveBrowserPathsResult = {
  rootAbs?: string; // absolute browser root; used when converting absolute paths to relative
  startPath?: string; // relative-to-root preferred ("" means root)
};

type RemoteFileDialogMode = "select" | "save";

type RemoteFileDialogProps = {
  open: boolean;
  onClose: () => void;
  title?: string;

  projectId?: string | number;
  protocolId?: string | number | null | undefined;

  // initialPathRel: relative to root ("" means root)
  initialPath?: string;
  resolveBrowserPaths?: () => Promise<ResolveBrowserPathsResult>;
  listRemoteDirectory: (relPath: string) => Promise<RemoteEntry[]>;
  previewRemoteEntry?: (relPath: string) => Promise<RemotePreview | null>;
  buildDownloadUrl?: (relPath: string, inline?: boolean) => string;

  mode?: RemoteFileDialogMode;
  defaultFilename?: string;
  filenameLabel?: string;
  confirmLabel?: string;
  closeOnPick?: boolean;
  busy?: boolean;

  onPick?: (path: string, entry: RemoteEntry, filename?: string) => void;
};

type SortDir = "asc" | "desc";

type TextPreviewToken = {
  text: string;
  className: string;
};

type TextPreviewLine = {
  tokens: TextPreviewToken[];
};

type AnsiState = {
  bold: boolean;
  dim: boolean;
  italic: boolean;
  underline: boolean;
  fg?: number;
  bg?: number;
};

type TextPreviewModel = {
  label: string;
  lines: TextPreviewLine[];
  lineCount: number;
  isJson: boolean;
  isEmpty: boolean;
  hasAnsi: boolean;
  sizeLabel?: string;
};


export default function RemoteFileDialog({
  open,
  onClose,
  title = "Browse protocol files",
  initialPath = "",
  resolveBrowserPaths,
  listRemoteDirectory,
  previewRemoteEntry,
  protocolId,
  buildDownloadUrl,
  onPick,
  mode = "select",
  defaultFilename = "",
  filenameLabel = "File name",
  confirmLabel,
  closeOnPick = true,
  busy = false,
}: RemoteFileDialogProps) {
  // directoryState (cwdRel is relative to root; "" means root)
  const [cwdRel, setCwdRel] = useState<string>(initialPath);
  const [items, setItems] = useState<RemoteEntry[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  // browserRootAbs is used only to convert absolute paths -> relative when needed
  const [browserRootAbs, setBrowserRootAbs] = useState<string>("");

  // protocolRootRelativeOnceResolved
  const [protocolRootRel, setProtocolRootRel] = useState<string>("");

  // selectionState
  const [selected, setSelected] = useState<RemoteEntry | null>(null);

  // search / sort state
  const [filterText, setFilterText] = useState<string>("");
  const [sortDir, setSortDir] = useState<SortDir>("asc");

  // unifiedPreviewState
  const [preview, setPreview] = useState<RemotePreview | null>(null);
  const [previewLoading, setPreviewLoading] = useState<boolean>(false);
  const [previewError, setPreviewError] = useState<string | null>(null);

  // computedImageSrcForBlob
  const [previewImageSrc, setPreviewImageSrc] = useState<string>("");
  const previewObjectUrlRef = useRef<string>("");

  // portalContainer
  const [portalContainer, setPortalContainer] = useState<HTMLElement | null>(null);

  // hardening refs
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const refreshSeqRef = useRef<number>(0);
  const previewSeqRef = useRef<number>(0);

  // fixedLayoutSizes
  const dialogWidthClass = styles.dialogWidth;
  const dialogHeightClass =
    mode === "save"
      ? `${styles.dialogHeight} ${styles.dialogHeightSave}`
      : styles.dialogHeight;

  const browserHeightClass =
    mode === "save"
      ? `${styles.browserHeight} ${styles.browserHeightSave}`
      : styles.browserHeight;

  const previewHeightClass =
    mode === "save"
      ? `${styles.previewHeight} ${styles.previewHeightSave}`
      : styles.previewHeight;

  // controlledFilenameInputForSaveMode
  const [saveFilename, setSaveFilename] = useState<string>(defaultFilename);

  const getEntryExtension = (entry: RemoteEntry | null) => {
    const name = (entry?.name || "").trim();
    const dotIndex = name.lastIndexOf(".");
    if (dotIndex < 0 || dotIndex === name.length - 1) return "";
    return name.slice(dotIndex + 1).toLowerCase();
  };

  const hasAnsiSequences = (s: string) => /\x1b\[[0-9;]*m/.test(s);

  const createDefaultAnsiState = (): AnsiState => ({
    bold: false,
    dim: false,
    italic: false,
    underline: false,
  });

  const getAnsiStateClassName = (state: AnsiState) => {
    const css = styles as Record<string, string>;
    const classNames: string[] = [];

    if (state.bold) classNames.push(css.ansiBold);
    if (state.dim) classNames.push(css.ansiDim);
    if (state.italic) classNames.push(css.ansiItalic);
    if (state.underline) classNames.push(css.ansiUnderline);
    if (state.fg != null) classNames.push(css[`ansiFg${state.fg}`]);
    if (state.bg != null) classNames.push(css[`ansiBg${state.bg}`]);

    return classNames.filter(Boolean).join(" ");
  };

  const applyAnsiCode = (state: AnsiState, code: number): AnsiState => {
    if (code === 0) return createDefaultAnsiState();

    const next: AnsiState = { ...state };

    if (code === 1) next.bold = true;
    else if (code === 2) next.dim = true;
    else if (code === 3) next.italic = true;
    else if (code === 4) next.underline = true;
    else if (code === 22) {
      next.bold = false;
      next.dim = false;
    } else if (code === 23) next.italic = false;
    else if (code === 24) next.underline = false;
    else if ((code >= 30 && code <= 37) || (code >= 90 && code <= 97)) next.fg = code;
    else if (code === 39) next.fg = undefined;
    else if ((code >= 40 && code <= 47) || (code >= 100 && code <= 107)) next.bg = code;
    else if (code === 49) next.bg = undefined;

    return next;
  };

  const tokenizeAnsiLine = (line: string, initialState: AnsiState) => {
    const ansiRegex = /\x1b\[([0-9;]*)m/g;
    const tokens: TextPreviewToken[] = [];

    let state: AnsiState = { ...initialState };
    let lastIndex = 0;
    let match: RegExpExecArray | null = null;

    const pushChunk = (chunk: string) => {
      if (!chunk) return;
      tokens.push({
        text: chunk,
        className: getAnsiStateClassName(state),
      });
    };

    while ((match = ansiRegex.exec(line)) !== null) {
      pushChunk(line.slice(lastIndex, match.index));

      const rawCodes = match[1] || "0";
      const codes = rawCodes
        .split(";")
        .map((value) => Number(value))
        .filter((value) => Number.isFinite(value));

      for (const code of codes.length ? codes : [0]) {
        state = applyAnsiCode(state, code);
      }

      lastIndex = ansiRegex.lastIndex;
    }

    pushChunk(line.slice(lastIndex));

    return {
      tokens,
      state,
    };
  };

  const buildTextPreviewLines = (content: string, parseAnsi: boolean): TextPreviewLine[] => {
    const rawLines = content.length > 0 ? content.split(/\r\n|\r|\n/) : [""];

    if (!parseAnsi) {
      return rawLines.map((line) => ({
        tokens: [{ text: line || "\u00A0", className: "" }],
      }));
    }

    let state = createDefaultAnsiState();

    return rawLines.map((line) => {
      const result = tokenizeAnsiLine(line, state);
      state = result.state;

      return {
        tokens: result.tokens.length
          ? result.tokens
          : [{ text: "\u00A0", className: getAnsiStateClassName(state) }],
      };
    });
  };

  const buildTextPreviewModel = (
    textPreview: Extract<RemotePreview, { kind: "text" }>,
    entry: RemoteEntry | null
  ): TextPreviewModel => {
    const rawText = String(textPreview.text ?? "");
    const declaredLanguage = String(textPreview.language || "").trim().toLowerCase();
    const extension = getEntryExtension(entry);
    const mime = normalizeMimeValue(
      String(textPreview.mime || textPreview.meta?.mime || entry?.mime || "")
    );

    const hasAnsi = hasAnsiSequences(rawText);
    const isLogLike =
      declaredLanguage === "log" ||
      ["log", "out", "err", "stdout", "stderr"].includes(extension);

    const shouldTryJson =
      !hasAnsi &&
      (declaredLanguage === "json" ||
        extension === "json" ||
        mime.includes("json") ||
        isProbablyJsonString(rawText));

    let content = rawText;
    let isJson = false;

    if (shouldTryJson) {
      try {
        content = JSON.stringify(JSON.parse(rawText), null, 2);
        isJson = true;
      } catch {
        content = rawText;
      }
    }

    const renderedLines = buildTextPreviewLines(content, hasAnsi);
    const lineCount = content.length > 0 ? renderedLines.length : 0;

    const sizeLabel =
      typeof textPreview.meta?.sizeBytes === "number"
        ? humanBytes(textPreview.meta.sizeBytes)
        : undefined;

    const label = isJson
      ? "JSON"
      : hasAnsi
        ? isLogLike
          ? "ANSI LOG"
          : "ANSI"
        : isLogLike
          ? "LOG"
          : (declaredLanguage || extension || "text").toUpperCase();

    return {
      label,
      lines: renderedLines,
      lineCount,
      isJson,
      isEmpty: content.length === 0,
      hasAnsi,
      sizeLabel,
    };
  };

  useEffect(() => {
    if (!open) return;
    setSaveFilename(defaultFilename || "");
  }, [open, defaultFilename]);

  useEffect(() => {
    // ensureDialogPortalRootExists
    const doc = typeof document !== "undefined" ? document : null;
    if (!doc) return;

    let host = doc.getElementById(PORTAL_ROOT_ID) as HTMLElement | null;

    if (!host) {
      host = doc.createElement("div");
      host.id = PORTAL_ROOT_ID;

      // keepTailwindScopeForWidgetBuild
      host.classList.add(ROOT_CLASS);

      // avoidAffectingHostLayout
      host.style.position = "fixed";
      host.style.left = "0";
      host.style.top = "0";
      host.style.width = "0";
      host.style.height = "0";
      host.style.zIndex = "2147483647";

      doc.body.appendChild(host);
    } else {
      host.classList.add(ROOT_CLASS);
    }

    // keepDarkModeConsistentIfNeeded
    if (doc.documentElement.classList.contains("dark")) {
      host.classList.add("dark");
    } else {
      host.classList.remove("dark");
    }

    setPortalContainer(host);
  }, []);

  /** normalizePosixPath */
  const normalizePosixPath = (p: string) => (p || "").replace(/\\/g, "/").replace(/\/+/g, "/").trim();

  /** isAbsolutePath */
  const isAbsolutePath = (p: string) => {
    const raw = normalizePosixPath(p || "");
    if (!raw) return false;
    return raw.startsWith("/") || /^[A-Za-z]:\//.test(raw);
  };

  /** normalizeRelPath */
  const normalizeRelPath = (p: string) => {
    const raw = normalizePosixPath(p || "").replace(/^\/+/g, "");
    if (!raw) return "";

    const parts = raw.split("/").filter(Boolean);
    const out: string[] = [];

    for (const part of parts) {
      if (part === ".") continue;
      if (part === "..") {
        if (out.length > 0) out.pop();
        continue; // clampNeverGoAboveRoot
      }
      out.push(part);
    }

    return out.join("/");
  };

  /** joinRelPaths */
  const joinRelPaths = (baseRel: string, leaf: string) => {
    const b = normalizeRelPath(baseRel || "");
    const l = normalizeRelPath(leaf || "");
    if (!b) return l;
    if (!l) return b;
    return normalizeRelPath(`${b}/${l}`);
  };

  /** getParentRelPath */
  const getParentRelPath = (relPath: string): string | null => {
    const r = normalizeRelPath(relPath || "");
    if (!r) return null;
    const parts = r.split("/").filter(Boolean);
    if (parts.length <= 1) return "";
    return parts.slice(0, -1).join("/");
  };

  /** absoluteToRelPath */
  const absoluteToRelPath = (absPath: string) => {
    const abs = normalizePosixPath(absPath || "");
    const root = normalizePosixPath(browserRootAbs || "");

    if (!abs || !root) return "";

    const rootClean = root.replace(/\/+$/g, "");
    const absClean = abs.replace(/\/+$/g, "");

    if (absClean === rootClean) return "";

    if (absClean.startsWith(`${rootClean}/`)) {
      return normalizeRelPath(absClean.slice(rootClean.length + 1));
    }

    return "";
  };

  /** buildRelPathForEntry */
  const buildRelPathForEntry = (entry: RemoteEntry) => {
    const rawPath = normalizePosixPath(entry?.path || "");
    const entryName = normalizeRelPath(entry?.name || "");

    if (rawPath) {
      if (isAbsolutePath(rawPath)) {
        const relFromAbs = absoluteToRelPath(rawPath);
        if (relFromAbs) return relFromAbs;

        const leafFromAbs = rawPath.split("/").filter(Boolean).pop() || entryName;
        return joinRelPaths(cwdRel, leafFromAbs);
      }

      const safeRel = normalizeRelPath(rawPath);
      if (!safeRel) return "";

      // Old backend contract: only basename in entry.path
      if (safeRel === entryName) {
        return joinRelPaths(cwdRel, safeRel);
      }

      // New backend contract: full relative path
      return safeRel;
    }

    return joinRelPaths(cwdRel, entryName);
  };

  /** buildPickPathForEntry */
  const buildPickPathForEntry = (entry: RemoteEntry) => {
    const absPath = normalizePosixPath(entry?.absPath || "");
    if (absPath && isAbsolutePath(absPath)) return absPath;

    const rawPath = normalizePosixPath(entry?.path || "");
    if (rawPath && isAbsolutePath(rawPath)) return rawPath;

    const relPath = buildRelPathForEntry(entry);
    if (!relPath && browserRootAbs) return normalizePosixPath(browserRootAbs);

    if (browserRootAbs) {
      const root = normalizePosixPath(browserRootAbs).replace(/\/+$/g, "");
      return relPath ? `${root}/${relPath}` : root;
    }

    return relPath;
  };

  /** sameEntry */
  const sameEntry = (a: RemoteEntry | null | undefined, b: RemoteEntry | null | undefined) => {
    if (!a || !b) return false;

    const aAbs = normalizePosixPath(a.absPath || "");
    const bAbs = normalizePosixPath(b.absPath || "");
    if (aAbs || bAbs) return aAbs === bAbs;

    const aPath = normalizePosixPath(a.path || "");
    const bPath = normalizePosixPath(b.path || "");
    return aPath === bPath && a.name === b.name && a.isDir === b.isDir;
  };

  /** revokeObjectUrlSafe */
  const revokeObjectUrlSafe = (url: string) => {
    try {
      if (url) URL.revokeObjectURL(url);
    } catch {
      // ignoreRevokeErrors
    }
  };

  const humanBytes = (n?: number) => {
    // humanBytesBinaryUnits
    if (n == null || !Number.isFinite(n)) return undefined;

    const abs = Math.abs(n);

    const kb = 1024;
    const mb = kb * 1024;
    const gb = mb * 1024;
    const tb = gb * 1024;

    const fmt = (value: number, unit: string) => {
      const decimals = value >= 10 ? 1 : 2;
      return `${value.toFixed(decimals)} ${unit}`;
    };

    if (abs < kb) return `${Math.round(n)} B`;
    if (abs < mb) return fmt(n / kb, "KB");
    if (abs < gb) return fmt(n / mb, "MB");
    if (abs < tb) return fmt(n / gb, "GB");
    return fmt(n / tb, "TB");
  };

  type MetaPair = { key: string; rawValue: unknown };

  function extractPixelSize(value: unknown): number | undefined {
    // extractPixelSizeBestEffort
    if (value == null) return undefined;

    if (typeof value === "number") {
      return Number.isFinite(value) ? value : undefined;
    }

    if (Array.isArray(value)) {
      const first = value.length > 0 ? Number((value as any)[0]) : NaN;
      return Number.isFinite(first) ? first : undefined;
    }

    if (typeof value === "string") {
      const s = value.trim();
      if (!s) return undefined;

      // allowCommaSeparatedLikeHeader
      const firstToken = s.split(",")[0]?.trim() ?? "";
      const num = Number(firstToken);
      return Number.isFinite(num) ? num : undefined;
    }

    return undefined;
  }

  function buildMetaPairs(meta: PreviewMeta | undefined): MetaPair[] {
    // metaPairsWithUiTransforms
    const raw = meta && typeof meta === "object" ? (meta as Record<string, unknown>) : {};
    const view: Record<string, unknown> = { ...raw };

    // hideMimeFieldsInUi
    for (const k of Object.keys(view)) {
      const kLower = k.toLowerCase();

      // hide "mime" and any "*Mime" variants (payloadMime, responseMime, semanticMime, etc.)
      if (kLower === "mime" || kLower.endsWith("mime")) {
        delete view[k];
      }
    }

    // sizeBytes -> size (humanReadable) and hideRaw
    const sizeBytesRaw = view.sizeBytes;
    const sizeBytesNum =
      typeof sizeBytesRaw === "number"
        ? sizeBytesRaw
        : typeof sizeBytesRaw === "string"
          ? Number(sizeBytesRaw)
          : undefined;

    if (typeof sizeBytesNum === "number" && Number.isFinite(sizeBytesNum)) {
      const h = humanBytes(sizeBytesNum);
      if (h) view.size = h;
      delete view.sizeBytes;
    }

    // voxelSize -> pixelSize (singleValue) and hideRaw
    const pixelSize = extractPixelSize(view.voxelSize);
    if (typeof pixelSize === "number" && Number.isFinite(pixelSize)) {
      // keepReasonablePrecisionForDisplay
      const rounded = Math.round(pixelSize * 1e6) / 1e6;
      view.pixelSize = rounded;
      delete view.voxelSize;
    }

    const keys = Object.keys(view).sort((a, b) => a.localeCompare(b));

    const out: MetaPair[] = [];
    for (const k of keys) {
      const v = view[k];
      if (v === undefined) continue;
      out.push({ key: k, rawValue: v });
    }

    return out;
  }

  function isProbablyJsonString(s: string): boolean {
    // bestEffortJsonStringHeuristic
    const t = (s || "").trim();
    if (!t) return false;
    if ((t.startsWith("{") && t.endsWith("}")) || (t.startsWith("[") && t.endsWith("]"))) {
      return true;
    }
    return false;
  }

  function safeJsonStringify(v: unknown): string {
    // safeJsonStringifyNoThrow
    try {
      return JSON.stringify(v, null, 2);
    } catch {
      return String(v);
    }
  }

  function toInlineString(v: unknown): string {
    // metaInlineString
    if (v === undefined) return "";
    if (v === null) return "null";
    if (typeof v === "string") return v;
    if (typeof v === "number") return Number.isFinite(v) ? String(v) : String(v);
    if (typeof v === "boolean") return v ? "true" : "false";
    if (Array.isArray(v)) return v.map((x) => toInlineString(x)).join(", ");
    if (typeof v === "object") return "[object]";
    return String(v);
  }

  function shouldCollapseMetaValue(v: unknown): boolean {
    // collapseRule: objects/arrays or large json-like strings
    if (v == null) return false;

    if (typeof v === "object") return true;

    if (typeof v === "string") {
      const t = v.trim();
      if (t.length < 120) return false;
      return isProbablyJsonString(t);
    }

    return false;
  }

  function buildMetaPreviewLabel(v: unknown): string {
    // labelShownOnSummaryLine
    if (v == null) return "null";
    if (typeof v === "string") {
      const t = v.trim();
      if (!t) return '""';
      // keepLabelCompact
      return t.length > 80 ? `${t.slice(0, 80)}…` : t;
    }
    if (Array.isArray(v)) return `Array(${v.length})`;
    if (typeof v === "object") {
      try {
        const keys = Object.keys(v as any);
        return `Object(${keys.length})`;
      } catch {
        return "Object";
      }
    }
    return String(v);
  }

  function MetaValueRenderer({ value }: { value: unknown }) {
    const collapsible = shouldCollapseMetaValue(value);

    if (!collapsible) {
      return <span className={styles.metaValue}>{toInlineString(value)}</span>;
    }

    const previewLabel = buildMetaPreviewLabel(value);

    // stringJsonCase: show parsed pretty if possible
    let pretty = "";
    if (typeof value === "string") {
      const t = value.trim();
      if (isProbablyJsonString(t)) {
        try {
          pretty = JSON.stringify(JSON.parse(t), null, 2);
        } catch {
          pretty = t;
        }
      } else {
        pretty = value;
      }
    } else {
      pretty = safeJsonStringify(value);
    }

    return (
      <details className={styles.metaDetails}>
        <summary className={styles.metaSummary}>
          <span className={styles.metaChevron}>▸</span>
          <span className={styles.metaSummaryText}>{previewLabel}</span>
          <span className={styles.metaHint}>details</span>
        </summary>

        <pre className={styles.metaJsonBlock}>{pretty}</pre>
      </details>
    );
  }

  const renderMetaFooter = (meta: PreviewMeta | undefined) => {
    const pairs = buildMetaPairs(meta);
    if (!pairs.length) return null;

    return (
      <div className={styles.previewFooter}>
        <div className={styles.metaGrid}>
          {pairs.map((p) => (
            <div key={p.key} className={styles.metaItem}>
              <span className={styles.metaKey}>{p.key}:</span>
              <MetaValueRenderer value={p.rawValue} />
            </div>
          ))}
        </div>
      </div>
    );
  };

  const renderTwoRowPreview = (content: React.ReactNode, meta: PreviewMeta | undefined) => {
    return (
      <div className={styles.previewStack}>
        <div className={styles.previewMain}>{content}</div>
        {renderMetaFooter(meta)}
      </div>
    );
  };

  /** clearPreviewState */
  const clearPreviewState = () => {
    previewSeqRef.current += 1;
    setPreview(null);
    setPreviewLoading(false);
    setPreviewError(null);

    revokeObjectUrlSafe(previewObjectUrlRef.current);
    previewObjectUrlRef.current = "";
    setPreviewImageSrc("");
  };

  /** refresh */
  const refresh = async (relPath: string) => {
    const seq = ++refreshSeqRef.current;

    try {
      setLoading(true);
      setError(null);

      const safeRel = normalizeRelPath(relPath || "");
      const listing = await listRemoteDirectory(safeRel);

      // ignoreStaleRefreshResults
      if (refreshSeqRef.current !== seq) return;

      setItems(Array.isArray(listing) ? listing : []);
      setCwdRel(safeRel);

      // resetSelectionAndPreviewOnDirectoryChange
      setSelected(null);
      clearPreviewState();
    } catch (e: unknown) {
      if (refreshSeqRef.current !== seq) return;
      const msg = e instanceof Error ? e.message : "Failed to list directory contents";
      setError(msg);
    } finally {
      if (refreshSeqRef.current === seq) setLoading(false);
    }
  };

  const enterDir = (entry: RemoteEntry) => {
    if (!entry.isDir) return;
    const nextRelDir = buildRelPathForEntry(entry);
    void refresh(nextRelDir);
  };

  const goUp = () => {
    const parentRel = getParentRelPath(cwdRel);
    if (parentRel === null) return;
    void refresh(parentRel);
  };

  const goRoot = () => {
    void refresh("");
  };

  const goProtocolRoot = () => {
    if (!protocolRootRel) return;
    void refresh(protocolRootRel);
  };

  /** loadUnifiedPreview */
  const loadUnifiedPreview = async (entry: RemoteEntry) => {
    if (!previewRemoteEntry) {
      clearPreviewState();
      return;
    }
    if (entry.isDir) {
      clearPreviewState();
      return;
    }

    const seq = ++previewSeqRef.current;

    setPreview(null);
    setPreviewLoading(true);
    setPreviewError(null);

    revokeObjectUrlSafe(previewObjectUrlRef.current);
    previewObjectUrlRef.current = "";
    setPreviewImageSrc("");

    try {
      const relPath = buildRelPathForEntry(entry);
      const p = await previewRemoteEntry(relPath);

      // ignoreStalePreviewResults
      if (previewSeqRef.current !== seq) return;

      setPreview(p || { kind: "none", note: "No preview available." });
    } catch (e: unknown) {
      if (previewSeqRef.current !== seq) return;
      const msg = e instanceof Error ? e.message : "Failed to load preview";
      setPreviewError(msg);
      setPreview({ kind: "error", message: msg });
    } finally {
      if (previewSeqRef.current === seq) setPreviewLoading(false);
    }
  };

  const handleSelectEntry = (entry: RemoteEntry) => {
    setSelected(entry);

    if (mode === "save" && !entry.isDir && entry.name) {
      setSaveFilename(entry.name);
    }

    void loadUnifiedPreview(entry);
  };

  const handleEntryDoubleClick = (entry: RemoteEntry) => {
    if (entry.isDir) {
      enterDir(entry);
      return;
    }

    handleSelectEntry(entry);

    if (mode !== "select" || !onPick) return;

    const pickPath = buildRelPathForEntry(entry);
    onPick(pickPath, entry);

    if (closeOnPick) onClose();
  };

  const handlePick = () => {
    if (!onPick) return;

    if (mode === "save") {
      const filename = String(saveFilename ?? "").trim();
      if (!filename) return;

      const entry = selected ?? buildSyntheticCurrentDirEntry();
      const directoryPath = buildSaveDirectoryPath();

      onPick(directoryPath, entry, filename);

      if (closeOnPick) onClose();
      return;
    }

    if (!selected) return;

    const pickPath = buildRelPathForEntry(selected);
    onPick(pickPath, selected);

    if (closeOnPick) onClose();
  };

  const handleDialogClick: React.MouseEventHandler = (e) => {
    e.stopPropagation();
  };

  /** isTextInputTarget */
  const isTextInputTarget = (t: EventTarget | null) => {
    const el = t as HTMLElement | null;
    if (!el) return false;
    const tag = (el.tagName || "").toLowerCase();
    if (tag === "input" || tag === "textarea" || tag === "select") return true;
    return !!el.getAttribute?.("contenteditable");
  };

  /** moveSelectionBy */
  const moveSelectionBy = (delta: number, visibleList: RemoteEntry[]) => {
    if (!visibleList.length) return;

    const currIndex = selected
      ? visibleList.findIndex((e) => sameEntry(e, selected))
      : -1;

    const baseIndex = currIndex >= 0 ? currIndex : delta > 0 ? -1 : visibleList.length;
    const nextIndex = Math.max(0, Math.min(visibleList.length - 1, baseIndex + delta));
    const next = visibleList[nextIndex];
    if (next) handleSelectEntry(next);
  };

  /** focusSearch */
  const focusSearch = () => {
    try {
      searchInputRef.current?.focus();
      searchInputRef.current?.select();
    } catch {
      // ignoreFocusErrors
    }
  };

  useEffect(() => {
    let mounted = true;

    const boot = async () => {
      if (!open) {
        // resetStateWhenClosed
        refreshSeqRef.current += 1;
        previewSeqRef.current += 1;

        setItems([]);
        setCwdRel(normalizeRelPath(initialPath || ""));
        setProtocolRootRel("");
        setBrowserRootAbs("");
        setSelected(null);
        setFilterText("");

        clearPreviewState();
        setError(null);
        return;
      }

      let startRel = normalizeRelPath(initialPath || "");
      let rootAbs = "";

      if (resolveBrowserPaths) {
        try {
          const resolved = await resolveBrowserPaths();
          if (!mounted) return;

          const startRaw = normalizePosixPath(resolved?.startPath || "");
          startRel = normalizeRelPath(startRaw);
          rootAbs = normalizePosixPath(resolved?.rootAbs || "");
        } catch {
          // ignoreResolveErrorsAndFallbackToInitialPath
          startRel = normalizeRelPath(initialPath || "");
          rootAbs = "";
        }
      }

      setBrowserRootAbs(rootAbs);
      setProtocolRootRel(startRel);
      await refresh(startRel);
    };

    void boot();
    return () => {
      mounted = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    // syncPreviewImageSrcFromModel
    if (!preview || (preview.kind !== "image" && preview.kind !== "volume")) {
      revokeObjectUrlSafe(previewObjectUrlRef.current);
      previewObjectUrlRef.current = "";
      setPreviewImageSrc("");
      return;
    }

    const src = preview.source as any;

    // urlSource
    if (src?.sourceType === "url" && typeof src.url === "string") {
      revokeObjectUrlSafe(previewObjectUrlRef.current);
      previewObjectUrlRef.current = "";
      setPreviewImageSrc(src.url);
      return;
    }

    // blobSource
    if (src?.sourceType === "blob" && src.blob instanceof Blob) {
      revokeObjectUrlSafe(previewObjectUrlRef.current);
      const objUrl = URL.createObjectURL(src.blob);
      previewObjectUrlRef.current = objUrl;
      setPreviewImageSrc(objUrl);

      return () => {
        revokeObjectUrlSafe(objUrl);
        if (previewObjectUrlRef.current === objUrl) previewObjectUrlRef.current = "";
      };
    }

    // base64Source
    if (src?.sourceType === "base64" && typeof src.dataBase64 === "string") {
      const effectiveMime =
        normalizeMimeValue(String(src.mime || preview.mime || "image/png")) || "image/png";

      try {
        const blob = base64ToBlob(src.dataBase64, effectiveMime);

        revokeObjectUrlSafe(previewObjectUrlRef.current);
        const objUrl = URL.createObjectURL(blob);
        previewObjectUrlRef.current = objUrl;
        setPreviewImageSrc(objUrl);

        return () => {
          revokeObjectUrlSafe(objUrl);
          if (previewObjectUrlRef.current === objUrl) previewObjectUrlRef.current = "";
        };
      } catch (e) {
        // keepUiStableOnBadPayload
        revokeObjectUrlSafe(previewObjectUrlRef.current);
        previewObjectUrlRef.current = "";
        setPreviewImageSrc("");
        return;
      }
    }

    // unknownSourceTypeFallback
    revokeObjectUrlSafe(previewObjectUrlRef.current);
    previewObjectUrlRef.current = "";
    setPreviewImageSrc("");
  }, [preview]);

  function normalizeMimeValue(v: string): string {
    // normalizeMimeLikeHeaderValue
    const raw = (v || "").trim().toLowerCase();
    if (!raw) return "";
    return raw.split(";")[0].trim();
  }

  function base64ToBlob(dataBase64OrDataUrl: string, mime: string): Blob {
    // extractBase64Payload
    let base64 = (dataBase64OrDataUrl || "").trim();

    // handleDataUrlPrefix
    if (base64.startsWith("data:")) {
      const commaIndex = base64.indexOf(",");
      if (commaIndex >= 0) base64 = base64.slice(commaIndex + 1);
    }

    // normalizeUrlSafeBase64
    base64 = base64.replace(/-/g, "+").replace(/_/g, "/");

    // addPaddingIfNeeded
    const mod = base64.length % 4;
    if (mod === 2) base64 += "==";
    else if (mod === 3) base64 += "=";

    const binaryStr = atob(base64);
    const len = binaryStr.length;
    const bytes = new Uint8Array(len);

    for (let i = 0; i < len; i++) {
      bytes[i] = binaryStr.charCodeAt(i);
    }

    return new Blob([bytes], { type: mime || "application/octet-stream" });
  }

  const parentRel = getParentRelPath(cwdRel);
  const showParentEntry = parentRel !== null && !loading && !error;
  const parentEntry = useMemo<RemoteEntry>(() => ({ name: "..", path: "..", isDir: true }), []);

  const breadcrumbs = useMemo(() => {
    const rel = normalizeRelPath(cwdRel || "");
    const parts = rel ? rel.split("/").filter(Boolean) : [];
    const crumbs: { label: string; relPath: string }[] = [{ label: ".", relPath: "" }];

    let acc = "";
    for (const p of parts) {
      acc = acc ? `${acc}/${p}` : p;
      crumbs.push({ label: p, relPath: acc });
    }
    return crumbs;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cwdRel]);

  const visibleItems = useMemo(() => {
    const needle = (filterText || "").trim().toLowerCase();

    const filtered = !needle ? items : items.filter((e) => (e.name || "").toLowerCase().includes(needle));

    const dirMult = sortDir === "asc" ? 1 : -1;

    const sorted = [...filtered].sort((a, b) => {
      // foldersFirstAlways
      if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;

      // nameOnlySort
      const na = (a.name || "").toLowerCase();
      const nb = (b.name || "").toLowerCase();
      if (na === nb) return 0;
      return na < nb ? -1 * dirMult : 1 * dirMult;
    });

    return sorted;
  }, [items, filterText, sortDir]);

  useEffect(() => {
  // autoSelectFirstVisibleEntry
  if (!open || loading || error) return;

  const firstVisible = visibleItems[0] ?? null;

  if (!firstVisible) {
    if (selected) {
      setSelected(null);
      clearPreviewState();
    }
    return;
  }

  const stillThere = selected
    ? visibleItems.some((e) => sameEntry(e, selected))
    : false;

  if (!stillThere) {
    handleSelectEntry(firstVisible);
  }

  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [open, loading, error, visibleItems]);

  const onKeyDown: React.KeyboardEventHandler = (e) => {
    if (!open) return;

    // doNotHijackTypingInInputs
    if (isTextInputTarget(e.target)) {
      if ((e.ctrlKey || e.metaKey) && (e.key === "f" || e.key === "F")) {
        e.preventDefault();
        focusSearch();
      }
      return;
    }

    if ((e.ctrlKey || e.metaKey) && (e.key === "f" || e.key === "F")) {
      e.preventDefault();
      focusSearch();
      return;
    }

    if (e.key === "Escape") {
      e.preventDefault();
      onClose();
      return;
    }

    if (e.key === "Backspace") {
      e.preventDefault();
      goUp();
      return;
    }

    if (e.key === "ArrowDown") {
      e.preventDefault();
      moveSelectionBy(1, visibleItems);
      return;
    }

    if (e.key === "ArrowUp") {
      e.preventDefault();
      moveSelectionBy(-1, visibleItems);
      return;
    }

    if (e.key === "Enter") {
      e.preventDefault();
      if (!selected) return;
      if (selected.isDir) enterDir(selected);
      else handlePick();
    }
  };

  const toggleSortDir = () => setSortDir((d) => (d === "asc" ? "desc" : "asc"));
  const SortDirIcon = sortDir === "asc" ? ArrowUp : ArrowDown;

  const formatDatabaseValue = (value: unknown): string => {
    if (value === null || value === undefined) return "—";
    if (typeof value === "boolean") return value ? "yes" : "no";
    if (typeof value === "number") return Number.isFinite(value) ? String(value) : "—";
    if (typeof value === "string") return value || "—";

    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  };

  const renderDatabasePreview = (
    dbPreview: Extract<RemotePreview, { kind: "database" }>,
  ) => {
    const database = dbPreview.database || {};
    const meta = dbPreview.meta || {};
    const summary = Array.isArray(database.summary) ? database.summary : [];
    const tables = Array.isArray(database.tables) ? database.tables : [];
    const warnings = Array.isArray(database.warnings) ? database.warnings : [];
    const sample = database.sample || null;

    const title = database.isScipion
      ? "Scipion SQLite database"
      : "SQLite database";

    const objectClass = database.objectClass || database.scipion?.objectClass || meta.objectClass;
    const objectCount = database.objectCount ?? database.scipion?.objectCount;

    return (
      <div className={styles.databasePreviewShell}>
        <div className={styles.databasePreviewHeader}>
          <div className={styles.databasePreviewTitleBlock}>
            <div className={styles.databasePreviewTitle}>{title}</div>
            <div className={styles.databasePreviewSubtitle}>
              {objectClass ? `${objectClass}` : database.engine || "sqlite"}
              {objectCount !== undefined && objectCount !== null ? ` · ${objectCount} items` : ""}
            </div>
          </div>

          <div className={styles.databasePreviewBadgeRow}>
            <span className={styles.databasePreviewBadge}>
              {database.readable === false ? "Unreadable" : "Readable"}
            </span>
            {database.isScipion && (
              <span className={styles.databasePreviewBadgeAccent}>Scipion</span>
            )}
          </div>
        </div>

        {warnings.length > 0 && (
          <div className={styles.databaseWarnings}>
            {warnings.map((warning, index) => (
              <div key={index} className={styles.databaseWarning}>
                {warning}
              </div>
            ))}
          </div>
        )}

        <div className={styles.databaseSummaryGrid}>
          {summary.map((item, index) => (
            <div key={`${item.key}-${index}`} className={styles.databaseSummaryCard}>
              <div className={styles.databaseSummaryKey}>{item.key}</div>
              <div className={styles.databaseSummaryValue}>{formatDatabaseValue(item.value)}</div>
            </div>
          ))}
        </div>

        {tables.length > 0 && (
          <div className={styles.databaseSection}>
            <div className={styles.databaseSectionTitle}>Tables</div>

            <div className={styles.databaseTableScroll}>
              <table className={styles.databaseTable}>
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Type</th>
                    <th>Rows</th>
                    <th>Columns</th>
                  </tr>
                </thead>
                <tbody>
                  {tables.map((table) => (
                    <tr key={table.name}>
                      <td title={table.name}>{table.name}</td>
                      <td>{table.type || "table"}</td>
                      <td>{table.rows === null || table.rows === undefined ? "—" : table.rows}</td>
                      <td>{table.columns ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {sample && Array.isArray(sample.columns) && sample.columns.length > 0 && (
          <div className={styles.databaseSection}>
            <div className={styles.databaseSectionTitle}>
              Sample rows{sample.table ? ` · ${sample.table}` : ""}
            </div>

            <div className={styles.databaseTableScroll}>
              <table className={styles.databaseTable}>
                <thead>
                  <tr>
                    {sample.columns.map((column) => (
                      <th key={column}>{column}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {(sample.rows || []).map((row, rowIndex) => (
                    <tr key={rowIndex}>
                      {sample.columns.map((_, colIndex) => (
                        <td key={colIndex}>{formatDatabaseValue(row[colIndex])}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {sample.truncated && (
              <div className={styles.databaseSampleHint}>Showing a limited sample.</div>
            )}
          </div>
        )}
      </div>
    );
  };

  const renderPreviewBody = () => {
    if (!selected) return <div className={styles.centerPlaceholder}>Select a file or folder.</div>;

    if (selected.isDir) {
      return (
        <div className={styles.centerPlaceholder}>
          Double-click a folder to enter it. Select to pick this folder.
        </div>
      );
    }

    if (previewLoading) {
      return (
        <div className={styles.inlineLoading}>
          <Loader2 className={styles.iconSpinSm} />
          <span>Loading preview…</span>
        </div>
      );
    }

    if (previewError) {
      return (
        <div className={styles.errorBox}>
          <AlertCircle className={styles.iconSm} />
          <span>{previewError}</span>
        </div>
      );
    }

    if (!preview || preview.kind === "none") {
      const note = (preview as any)?.note || "No preview available.";
      return renderTwoRowPreview(<div className={styles.centerPlaceholder}>{note}</div>, (preview as any)?.meta);
    }

    if (preview.kind === "error") {
      return (
        <div className={styles.errorBox}>
          <AlertCircle className={styles.iconSm} />
          <span>{preview.message}</span>
        </div>
      );
    }
    if (preview.kind === "text") {
      const model = buildTextPreviewModel(preview, selected);

      const content = (
        <div className={styles.textPreviewShell}>
          <div className={styles.textPreviewHeader}>
            <div className={styles.textPreviewHeaderLeft}>
              <span className={styles.textPreviewBadge}>{model.label}</span>
              <span className={styles.textPreviewMeta}>
                {model.lineCount === 1 ? "1 line" : `${model.lineCount} lines`}
              </span>
              {model.sizeLabel && <span className={styles.textPreviewMeta}>{model.sizeLabel}</span>}
            </div>

            {preview.truncated && (
              <span className={styles.textPreviewTruncated}>Truncated preview</span>
            )}
          </div>

          {model.isEmpty ? (
            <div className={styles.textPreviewEmpty}>Empty text file.</div>
          ) : (
            <div className={styles.textPreviewCodeScroll}>
              <code className={styles.textPreviewCode}>
                {model.lines.map((line, idx) => (
                  <span key={idx} className={styles.textPreviewLine}>
                    <span className={styles.textPreviewLineNumber}>{idx + 1}</span>
                    <span className={styles.textPreviewLineContent}>
                      {line.tokens.map((token, tokenIdx) => (
                        <span key={tokenIdx} className={token.className}>
                          {token.text}
                        </span>
                      ))}
                    </span>
                  </span>
                ))}
              </code>
            </div>
          )}
        </div>
      );

      return renderTwoRowPreview(content, preview.meta);
    }

    if (preview.kind === "table") {
      const content = (
        <div className={styles.textPreviewBox} style={{ height: "100%", padding: 0 }}>
          <div style={{ height: "100%", overflow: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
              <thead>
                <tr>
                  {preview.columns.map((c) => (
                    <th
                      key={c}
                      style={{
                        textAlign: "left",
                        padding: "8px 10px",
                        borderBottom: "1px solid rgba(148, 163, 184, 0.18)",
                        position: "sticky",
                        top: 0,
                        background: "rgba(15, 23, 42, 0.25)",
                        backdropFilter: "blur(6px)",
                        zIndex: 1,
                      }}
                    >
                      {c}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {preview.rows.map((row, idx) => (
                  <tr key={idx}>
                    {row.map((cell, j) => (
                      <td
                        key={j}
                        style={{
                          padding: "8px 10px",
                          borderBottom: "1px solid rgba(148, 163, 184, 0.10)",
                          whiteSpace: "nowrap",
                          textOverflow: "ellipsis",
                          overflow: "hidden",
                          maxWidth: 240,
                        }}
                        title={cell === null ? "" : String(cell)}
                      >
                        {cell === null ? "" : String(cell)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      );

      return renderTwoRowPreview(content, preview.meta);
    }

    if (preview.kind === "database") {
      const content = renderDatabasePreview(preview);
      return renderTwoRowPreview(content, preview.meta);
    }

    if (preview.kind === "image" || preview.kind === "volume") {
      const content = (
        <div className={styles.imageCanvas}>
          {!previewImageSrc && <div className={styles.centerPlaceholder}>No image preview available.</div>}

          {!!previewImageSrc && (
            <div className={styles.imageFrameResponsive}>
              <img src={previewImageSrc} alt={selected.name} className={styles.previewImage} />
            </div>
          )}
        </div>
      );

      return renderTwoRowPreview(content, preview.meta);
    }

    return <div className={styles.centerPlaceholder}>No preview available.</div>;
  };

  const buildCurrentDirectoryPickPath = () => {
    const root = normalizePosixPath(browserRootAbs || "").replace(/\/+$/g, "");
    if (root) {
      return cwdRel ? `${root}/${cwdRel}` : root;
    }
    return cwdRel || "";
  };

  const buildSyntheticCurrentDirEntry = (): RemoteEntry => {
    const parts = normalizeRelPath(cwdRel || "").split("/").filter(Boolean);
    const name = parts[parts.length - 1] || ".";
    return {
      name,
      path: cwdRel || "",
      absPath: buildCurrentDirectoryPickPath(),
      isDir: true,
    };
  };

  const buildSaveDirectoryPath = () => {
    if (!selected) return buildCurrentDirectoryPickPath();

    const picked = buildPickPathForEntry(selected);
    if (selected.isDir) return picked;

    const normalized = normalizePosixPath(picked);
    const parent = normalized.replace(/\/+$/g, "").replace(/\/[^/]+$/g, "");
    return parent || buildCurrentDirectoryPickPath();
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
    >
      <DialogContent
        container={portalContainer}
        tabIndex={-1}
        onKeyDown={onKeyDown}
        // preventCloseOnOutsideClick
        onInteractOutside={(e) => {
          e.preventDefault();
        }}
        onClick={handleDialogClick}
        className={[dialogWidthClass, dialogHeightClass, styles.dialogContent, styles.dialogLayout].join(" ")}
      >
        <DialogHeader className={styles.headerBar}>
          <DialogTitle className={styles.headerTitle}>
            <span className={styles.headerTitleText}>{title}</span>
          </DialogTitle>

          <DialogDescription className={styles.srOnly}>
            Remote file browser dialog. Use Enter/double-click to open folders, and Select to choose a file or folder.
          </DialogDescription>
        </DialogHeader>

        <div className={styles.toolbar}>
          <button type="button" onClick={goUp} className={styles.ppChipBtn} disabled={parentRel === null}>
            <CornerUpLeft className={styles.iconSm} />
            Up
          </button>

          <button type="button" onClick={goRoot} className={styles.ppChipBtn}>
            <Home className={styles.iconSm} />
            Root
          </button>

          {protocolId !== null && protocolId !== undefined && (
            <button
              type="button"
              onClick={goProtocolRoot}
              className={styles.ppChipBtn}
              title="Back to the protocol start directory"
            >
              <FolderOpen className={styles.iconSm} />
              Protocol folder
            </button>
          )}

          <button
            type="button"
            onClick={() => void refresh(cwdRel || "")}
            disabled={loading}
            title="Refresh this directory"
            className={styles.ppChipBtn}
          >
            {loading ? <Loader2 className={styles.iconSpinSm} /> : <RefreshCw className={styles.iconSm} />}
            Refresh
          </button>
        </div>

        <div className={[styles.bodyGrid, browserHeightClass].join(" ")}>
          <div className={styles.panel}>
            <div className={styles.panelHeader}>
              <div className={styles.panelHeaderLeft}>
                <div className={styles.panelHeaderTitle}>Directory</div>

                <div
                  className={styles.panelHeaderPath}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    flexWrap: "wrap",
                    gap: 0,
                    lineHeight: 1.2,
                  }}
                >
                  {breadcrumbs.map((c, idx) => {
                    const isLast = idx === breadcrumbs.length - 1;
                    return (
                      <React.Fragment key={`${c.relPath}-${idx}`}>
                        <button
                          type="button"
                          onClick={() => void refresh(c.relPath)}
                          disabled={loading || !!error || isLast}
                          title={c.relPath ? `Go to ./${c.relPath}` : "Go to root"}
                          style={{
                            border: "none",
                            background: "transparent",
                            padding: 0,
                            margin: 0,
                            cursor: isLast ? "default" : "pointer",
                            color: "inherit",
                            opacity: isLast ? 0.9 : 0.7,
                            fontWeight: isLast ? 600 : 500,
                          }}
                        >
                          {c.label}
                        </button>

                        {!isLast && <span style={{ opacity: 0.55, padding: "0 2px", userSelect: "none" }}>/</span>}
                      </React.Fragment>
                    );
                  })}
                </div>
              </div>

              {error && (
                <span className={styles.panelError}>
                  <AlertCircle className={styles.iconXs} />
                  <span>Error</span>
                </span>
              )}
            </div>

            {!error && (
              <div className={styles.fileListControls}>
                <div className={styles.fileFilterRow}>
                  <Search className={styles.fileFilterIcon} />

                  <input
                    ref={searchInputRef}
                    value={filterText}
                    onChange={(e) => setFilterText(e.target.value)}
                    placeholder="Filter file names…"
                    aria-label="Filter file names"
                    className={styles.fileFilterInput}
                  />
                </div>

                <div className={styles.fileListHeader}>
                  <div className={styles.fileListHeaderTitle}>Name</div>

                  <button
                    type="button"
                    onClick={toggleSortDir}
                    title={sortDir === "asc" ? "Ascending" : "Descending"}
                    aria-label={`Sort ${sortDir === "asc" ? "ascending" : "descending"}`}
                    className={styles.fileListSortButton}
                  >
                    <SortDirIcon className={styles.iconSm} />
                  </button>
                </div>
              </div>
            )}

            <div className={styles.panelBody}>
              {error && (
                <div className={styles.errorBox}>
                  <AlertCircle className={styles.iconSm} />
                  <span>{error}</span>
                </div>
              )}

              {!error && (
                <ul className={styles.list}>
                  {showParentEntry && (
                    <li className={styles.listItem} key="..">
                      {(() => {
                        const isSel = sameEntry(selected, parentEntry);
                        return (
                          <button
                            className={[styles.rowBtn, isSel ? styles.rowBtnSelected : ""].join(" ")}
                            onClick={() => handleSelectEntry(parentEntry)}
                            onDoubleClick={goUp}
                            type="button"
                            title="Double-click to go up"
                          >
                            <FolderOpen className={styles.iconSmMut} />
                            <span className={styles.truncate}>..</span>
                          </button>
                        );
                      })()}
                    </li>
                  )}

                  {loading && (
                    <li className={styles.loadingRow} key="loading">
                      <Loader2 className={styles.iconSpinSmMut} />
                      <span>Loading…</span>
                    </li>
                  )}

                  {!loading &&
                    visibleItems.map((entry) => {
                      const isSel = sameEntry(selected, entry);
                      const entryKey = `${entry.absPath ?? entry.path}-${entry.name}-${entry.isDir ? "d" : "f"}`;

                      return (
                        <li key={entryKey} className={styles.listItem}>
                          <button
                            className={[styles.rowBtn, isSel ? styles.rowBtnSelected : ""].join(" ")}
                            onClick={() => handleSelectEntry(entry)}
                            onDoubleClick={() => handleEntryDoubleClick(entry)}
                            type="button"
                          >
                            {entry.isDir ? (
                              <>
                                <FolderOpen className={styles.iconSmMut} />
                                <span className={styles.truncate}>{entry.name}</span>
                              </>
                            ) : (
                              <>
                                <FileIcon className={styles.iconSmMut} />
                                <span className={styles.truncate}>{entry.name}</span>
                                <span className={styles.fileSize}>
                                  {typeof entry.size === "number" ? humanBytes(entry.size) ?? "" : ""}
                                </span>
                              </>
                            )}
                          </button>
                        </li>
                      );
                    })}
                </ul>
              )}
            </div>
          </div>

          <div className={styles.panel}>
            <div className={styles.previewViewport + " " + previewHeightClass}>{renderPreviewBody()}</div>
          </div>
        </div>

        {mode === "save" && (
          <div className={styles.saveBar}>
            <label className={styles.saveLabel}>{filenameLabel}</label>
            <input
              value={saveFilename}
              onChange={(e) => setSaveFilename(e.target.value)}
              placeholder="protocols_export.json"
              className={styles.saveInput}
              aria-label={filenameLabel}
              disabled={busy}
            />
          </div>
        )}

        <div className={styles.footer}>
          <button
            type="button"
            className={styles.ppDialogBtn}
            onClick={onClose}
            disabled={busy}
          >
            Close
          </button>

          <button
            type="button"
            className={[styles.ppDialogBtn, styles.ppDialogBtnPrimary].join(" ")}
            onClick={handlePick}
            disabled={
              busy ||
              (mode === "save"
                ? !String(saveFilename ?? "").trim()
                : !selected)
            }
          >
            {confirmLabel ?? (mode === "save" ? "Save" : "Select")}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}