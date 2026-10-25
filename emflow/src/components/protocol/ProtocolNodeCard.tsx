// src/components/protocol/ProtocolNodeCard.tsx
import { useCallback, useEffect, useMemo, useRef, useState, JSX } from "react";
import toast from "react-hot-toast";
import { Button, Dialog, DialogActions, DialogContent, DialogTitle, IconButton, Typography, Link, Tooltip } from "@mui/material";
import type {
  CSSProperties,
  Dispatch,
  DragEvent as ReactDragEvent,
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent,
  SetStateAction,
} from "react";

import RemoteFileDialog, {
  RemoteEntry,
  RemotePreview,
} from "@/components/files/RemoteFileDialog";
import OverflowTooltipText from "@/components/ui/overflow-tooltip-text";

import { Handle, Position, useReactFlow } from "reactflow";
import styles from "./ProtocolNodeCard.module.css";

import { useDrag } from "./DragContext";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from "../ui/dropdown-menu";

import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
} from "../ui/context-menu";

import {
  MoreHorizontal,
  Pencil,
  FolderOpen,
  Copy,
  Trash2,
  FileUp,
  RefreshCw,
  Play,
  RotateCcw,
  ArrowUpRight,
  Square,
  ArrowLeft,
  ArrowRight,
  ArrowDown,
  ArrowUp,
  Scan,
  Eye,
  Tags,
  HelpCircle,
  Plus,
  Check,
  FileIcon,
  ClipboardPaste,
  ClipboardCopy,
} from "lucide-react";

import AnalyzeOutputDialog from "@/components/analyze/analyze-output-dialog";
import TableViewerDialog from "@/components/analyze/table-viewer-dialog";
import {
  isTableViewerAnalyzeDecision,
  openExternalAnalyzeDecision,
  type TableViewerDecision,
} from "@/utils/analyze-viewer-decision";
import type {
  AnalyzeViewerResolveContext,
  AnalyzeViewerResolveDecision,
  Id,
  ProtocolTag as ServiceProtocolTag,
  ResolveBrowserPathsResult,
  ExportProtocolsRequestPayload,
} from "@/services/ProjectService";

import type { ProtocolTag } from "@/components/tags/tagTypes";
import { useTagStore } from "@/stores/tag_store";
import { useProjectService } from "@/ProjectServiceContext";
import { CloseIcon } from "@/icons";
import type { NodeMenuItemId, NodeMenuVisibility } from "@/types/protocol-node-menu-items";

const statusColors: Record<string, string> = {
  running: "#FCCE62",
  saved: "#D9F1FA",
  launched: "#D9F1FA",
  finished: "#D2F5CB",
  failed: "#F5CCCB",
  aborted: "#F5CCCB",
  interactive: "#f7f3bf",
  root: "#D9F1FA",
  scheduled: "#f7f3bf",
  new: "#D9F1FA",
};

const statusBadgeColors: Record<string, string> = {
  running: "#918516",
  saved: "#1E90FF",
  launched: "#1E90FF",
  finished: "#28A745",
  failed: "#DC3545",
  aborted: "#DC3545",
  interactive: "#FFC107",
  scheduled: "#918516",
  new: "#1E90FF",
};

export type ExternalAnalyzeViewerService = {
  resolveAnalyzeViewer?: (ctx: AnalyzeViewerResolveContext) => Promise<AnalyzeViewerResolveDecision>;
};

type StatusNodeProps = {
  id?: string;
  data: {
    label: string;
    runName: string;
    comment: string;
    title: string;
    status?: string;
    id: string;
    color?: string;
    cpuTime?: string;
    elapsedTime?: string;
    tick?: number;
    numberOfSteps?: number;
    stepsDone?: number;
    outputs?: any[];
    outputThumbnails?: Record<string, {
      exists?: boolean;
      thumbnailDataUrl?: string | null;
      outputClassName?: string | null;
      error?: string | null;
    }>;
    protocolOutputThumbnailsEnabled?: boolean;
    inputs?: any[];
    parents?: string[];
    children?: string[];
    __pathVer?: number;
    projectId?: string | number;

    // tags assigned to this protocol (backend provides this)
    // can be ids or objects; normalized later
    tags?: any[];
  };

  selectedNodeId?: string;
  hoveredNodeId?: string;
  isHovered?: boolean;
  setHoveredNodeId?: Dispatch<SetStateAction<string | null>>;
  graphDirection?: "TB" | "LR";
  onClick?: (evt?: ReactMouseEvent) => void;
  onDoubleClick?: () => void;
  zoomLevel?: number;
  compactThreshold?: number;

  onEdit?: (id: string) => void;
  onRename?: (id: string) => void;
  onDuplicate?: (id: string) => void;
  onCopyWorkflow?: (id: string) => void;
  onPasteWorkflow?: (id: string) => void;
  canPasteWorkflow?: boolean;
  onDelete?: (id: string) => void;
  onRestartAll?: (id: string) => void;
  onContinueAll?: (id: string) => void;
  onResetFrom?: (id: string) => void;
  onSelectFrom?: (id: string) => void;
  onSelectTo?: (id: string) => void;
  onStop?: (id: string) => void;
  onBrowse?: (protocolId: string, projectId?: string | number, protocolLabel?: string) => void;

  // opens the tag manager (create/edit tag definitions)
  onManageTags?: (protocolId: string, projectId?: string | number, protocolLabel?: string) => void;
  // opens the protocol creation/open UI for a given protocolClass
  onOpenProtocolClass?: (
    protocolClass: string,
    projectId?: string | number,
    sourceProtocolId?: string,
    sourceProtocolLabel?: string,
  ) => void;

  inPathSelection?: boolean;
  pathSelectionActive?: boolean;

  sourcePosition?: Position;
  targetPosition?: Position;

  showHandles?: boolean;

  service?: ExternalAnalyzeViewerService;
  contextMenuVisibility?: NodeMenuVisibility;
};



const formatCpuTime = (seconds: number): string => {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${pad(hours)}h:${pad(minutes)}m:${pad(secs)}s`;
};


type NextProtocolSuggestion = {
  protocolName: string;
  protocolClass: string;
  help?: string;
  installed?: string;
};

type NormalizedOutput = {
  name?: string; // outputKeyNameUsedByBackend
  info?: string;
  paramClass: string;
  pointerClass?: string;
  value?: string;
  parentId?: string | number;
};


const normalizeOutputItem = (outputObj: unknown): NormalizedOutput | null => {
  // normalizeOutputItem
  if (!outputObj || typeof outputObj !== "object") return null;

  const flatCandidate = outputObj as Record<string, unknown>;

  const hasAnyClassHint =
    "paramClass" in flatCandidate || "pointerClass" in flatCandidate || "_class" in flatCandidate;

  const looksLikeOutput =
    hasAnyClassHint &&
    ("info" in flatCandidate ||
      "name" in flatCandidate ||
      "outputName" in flatCandidate ||
      "value" in flatCandidate ||
      "parentId" in flatCandidate);

  if (looksLikeOutput) {
    const pointerClass =
      typeof flatCandidate.pointerClass === "string"
        ? flatCandidate.pointerClass
        : typeof flatCandidate._class === "string"
          ? (flatCandidate._class as string)
          : undefined;

    const rawParamClass = typeof flatCandidate.paramClass === "string" ? flatCandidate.paramClass : "";
    const inferredParamClass = rawParamClass || (pointerClass ? "PointerParam" : "");

    const normalized: NormalizedOutput = {
      name:
        typeof flatCandidate.outputName === "string"
          ? flatCandidate.outputName
          : typeof flatCandidate.name === "string"
            ? flatCandidate.name
            : undefined,
      info: typeof flatCandidate.info === "string" ? flatCandidate.info : undefined,
      paramClass: inferredParamClass,
      pointerClass,
      value: typeof flatCandidate.value === "string" ? flatCandidate.value : undefined,
      parentId:
        typeof flatCandidate.parentId === "string" || typeof flatCandidate.parentId === "number"
          ? flatCandidate.parentId
          : undefined,
    };

    return normalized.paramClass ? normalized : null;
  }

  const entries = Object.entries(flatCandidate);
  if (entries.length === 1) {
    const [wrappedName, wrappedValue] = entries[0];
    if (wrappedValue && typeof wrappedValue === "object") {
      const wrappedDef = wrappedValue as Record<string, unknown>;

      const hasAnyWrappedClassHint =
        "paramClass" in wrappedDef || "pointerClass" in wrappedDef || "_class" in wrappedDef;

      if (hasAnyWrappedClassHint) {
        const pointerClass =
          typeof wrappedDef.pointerClass === "string"
            ? wrappedDef.pointerClass
            : typeof wrappedDef._class === "string"
              ? (wrappedDef._class as string)
              : undefined;

        const rawParamClass = typeof wrappedDef.paramClass === "string" ? wrappedDef.paramClass : "";
        const inferredParamClass = rawParamClass || (pointerClass ? "PointerParam" : "");

        const normalized: NormalizedOutput = {
          name: wrappedName,
          info: typeof wrappedDef.info === "string" ? wrappedDef.info : undefined,
          paramClass: inferredParamClass,
          pointerClass,
          value: typeof wrappedDef.value === "string" ? wrappedDef.value : undefined,
          parentId:
            typeof wrappedDef.parentId === "string" || typeof wrappedDef.parentId === "number"
              ? wrappedDef.parentId
              : undefined,
        };

        return normalized.paramClass ? normalized : null;
      }
    }
  }

  return null;
};



const openDecisionUrl = (decision: AnalyzeViewerResolveDecision) => {
  return openExternalAnalyzeDecision(decision);
};

type ReactFlowSelectionEvent = ReactMouseEvent | ReactPointerEvent<HTMLDivElement>;

function uniqStrings(values: string[]): string[] {
  // uniqStrings
  const out: string[] = [];
  const seen = new Set<string>();
  for (const v of values) {
    const s = String(v ?? "").trim();
    if (!s) continue;
    if (seen.has(s)) continue;
    seen.add(s);
    out.push(s);
  }
  return out;
}

function filterExistingTagIds(tagIds: string[], defs: ProtocolTag[]): string[] {
  // filterExistingTagIds
  const allowed = new Set(defs.map((t) => String(t.id)));
  return uniqStrings(tagIds).filter((id) => allowed.has(String(id)));
}

function normalizeTagIdCandidate(raw: unknown, allTags: ProtocolTag[]): string {
  // normalizeTagIdCandidate
  const s = String(raw ?? "").trim();
  if (!s) return "";

  const byId = new Map(allTags.map((t) => [String(t.id), t]));
  if (byId.has(s)) return s;

  const lower = s.toLowerCase();
  const byTitle = new Map(allTags.map((t) => [String(t.title ?? "").trim().toLowerCase(), t]));
  const hit = byTitle.get(lower);
  return hit ? String(hit.id) : s;
}

function normalizeTagIdsFromRaw(rawTags: unknown, allTags: ProtocolTag[]): string[] {
  // normalizeTagIdsFromRaw
  if (!Array.isArray(rawTags)) return [];

  const out: string[] = [];

  for (const item of rawTags) {
    if (typeof item === "string" || typeof item === "number") {
      const id = normalizeTagIdCandidate(item, allTags);
      if (id) out.push(id);
      continue;
    }

    if (item && typeof item === "object") {
      const obj = item as Record<string, unknown>;
      const directId = obj.id ?? obj.tagId ?? obj.tag_id;
      if (directId != null) {
        const id = normalizeTagIdCandidate(directId, allTags);
        if (id) out.push(id);
        continue;
      }

      const titleCandidate = obj.title ?? obj.name ?? obj.label;
      if (titleCandidate != null) {
        const id = normalizeTagIdCandidate(titleCandidate, allTags);
        if (id) out.push(id);
      }
    }
  }

  return uniqStrings(out);
}

function coerceErrorMessage(e: any, fallback: string): string {
  // coerceErrorMessage
  const msg =
    (typeof e?.data?.detail === "string" && e.data.detail) ||
    (typeof e?.response?.data?.detail === "string" && e.response.data.detail) ||
    (typeof e?.message === "string" && e.message) ||
    String(e ?? "");
  return msg.trim() ? msg : fallback;
}

function normalizeTagDef(raw: any): ProtocolTag | null {
  // normalizeTagDef
  const id = String(raw?.id ?? "").trim();
  const title = String(raw?.title ?? "").trim();
  if (!id || !title) return null;

  const description =
    typeof raw?.description === "string" && raw.description.trim() ? raw.description.trim() : undefined;

  return {
    id,
    title,
    description,
    color: typeof raw?.color === "string" && raw.color.trim() ? raw.color.trim() : "#3b82f6",
  };
}

function normalizeTagDefList(raw: unknown): ProtocolTag[] {
  // normalizeTagDefList
  if (!Array.isArray(raw)) return [];
  const out: ProtocolTag[] = [];
  for (const t of raw) {
    const nt = normalizeTagDef(t);
    if (nt) out.push(nt);
  }
  return out;
}

function normalizeNextProtocolSuggestion(raw: any): NextProtocolSuggestion | null {
  // normalizeNextProtocolSuggestion
  const protocolName = typeof raw?.protocolName === "string" ? raw.protocolName.trim() : "";
  const protocolClass = typeof raw?.protocolClass === "string" ? raw.protocolClass.trim() : "";

  const installedRaw =
    typeof raw?.installed === "string" ? raw.installed.trim() : "installed";
  const installed = installedRaw || "installed";

  const help = typeof raw?.help === "string" ? raw.help.trim() : "";

  if (!protocolName || !protocolClass) return null;

  return {
    protocolName,
    protocolClass,
    installed,
    help: help ? help : undefined,
  };
}

const tagDefsCacheByProjectId = new Map<string, ProtocolTag[]>();
const tagDefsInFlightByProjectId = new Map<string, Promise<ProtocolTag[]>>();
let tagDefsStoreProjectId: string | null = null;



function renderBoldLabel(label: string, keyPrefix: string): Array<JSX.Element | string> {
  // renderBoldLabel
  const parts: Array<JSX.Element | string> = [];
  const boldRegex = /\*[^*]+\*/g;

  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let segIndex = 0;

  while ((match = boldRegex.exec(label)) !== null) {
    const token = match[0];
    const start = match.index;

    if (start > lastIndex) {
      parts.push(label.slice(lastIndex, start));
    }

    const boldText = token.slice(1, -1);
    parts.push(<strong key={`${keyPrefix}-b-${segIndex++}`}>{boldText}</strong>);

    lastIndex = boldRegex.lastIndex;
  }

  if (lastIndex < label.length) {
    parts.push(label.slice(lastIndex));
  }

  return parts;
}

function normalizeHelpText(raw: string): string {
  // normalizeHelpText
  return String(raw ?? "").replace(/\\n/g, "\n");
}

function sanitizeHref(rawUrl: string): string {
  // sanitizeHref
  let hrefToken = String(rawUrl ?? "").trim();

  while (/[.,;:!?)]$/.test(hrefToken)) {
    hrefToken = hrefToken.slice(0, -1);
  }

  if (!hrefToken) return "";

  const href =
    hrefToken.startsWith("http://") || hrefToken.startsWith("https://")
      ? hrefToken
      : `https://${hrefToken}`;

  return href;
}

function sanitizeUrlToken(token: string): { display: string; href: string } {
  // sanitizeUrlToken
  const display = token;

  let hrefToken = token;
  while (/[.,;:!?)]$/.test(hrefToken)) {
    hrefToken = hrefToken.slice(0, -1);
  }

  const href = sanitizeHref(hrefToken);
  return { display, href };
}

function parseOrgLinkToken(token: string): { href: string; label: string } | null {
  // parseOrgLinkToken
  const orgRegex = /^\[\[([^\]]+)\](?:\[([^\]]+)\])?\]$/;
  const match = orgRegex.exec(token);
  if (!match) return null;

  const rawUrl = match[1] ?? "";
  const rawLabel = match[2];

  const href = sanitizeHref(rawUrl);
  const label = String(rawLabel ?? rawUrl);

  if (!href) return null;
  return { href, label };
}

function renderRichHelpText(helpText: string, linkClassName: string): JSX.Element {
  // renderRichHelpText
  const normalized = normalizeHelpText(helpText);
  const lines = normalized.split("\n");

  const tokenPattern =
    /(\[\[[^\]]+\](?:\[[^\]]+\])?\]|\*[^*]+\*|https?:\/\/[^\s<>()]+|www\.[^\s<>()]+)/g;

  const renderLineTokens = (line: string, lineIndex: number) => {
    // renderLineTokens
    const parts: JSX.Element[] = [];
    let lastIndex = 0;
    let match: RegExpExecArray | null;
    let keyIndex = 0;

    const tokenRegex = new RegExp(tokenPattern.source, "g");

    while ((match = tokenRegex.exec(line)) !== null) {
      const token = match[0];
      const start = match.index;

      if (start > lastIndex) {
        parts.push(<span key={`t-${lineIndex}-${keyIndex++}`}>{line.slice(lastIndex, start)}</span>);
      }

      if (token.startsWith("[[")) {
        const orgLink = parseOrgLinkToken(token);
        if (orgLink) {
          const linkKey = `ol-${lineIndex}-${keyIndex++}`;
          parts.push(
            <Link
              key={linkKey}
              className={linkClassName}
              href={orgLink.href}
              target="_blank"
              rel="noopener noreferrer"
              underline="hover"
              sx={{ wordBreak: "break-word", fontWeight: 600 }}
              onClick={(e) => e.stopPropagation()}
            >
              {renderBoldLabel(orgLink.label, linkKey)}
            </Link>,
          );
        } else {
          parts.push(<span key={`ot-${lineIndex}-${keyIndex++}`}>{token}</span>);
        }
      } else if (token.startsWith("*") && token.endsWith("*") && token.length >= 2) {
        const boldText = token.slice(1, -1);
        parts.push(<strong key={`b-${lineIndex}-${keyIndex++}`}>{boldText}</strong>);
      } else {
        const { display, href } = sanitizeUrlToken(token);
        if (!href) {
          parts.push(<span key={`u-${lineIndex}-${keyIndex++}`}>{display}</span>);
        } else {
          parts.push(
            <Link
              key={`l-${lineIndex}-${keyIndex++}`}
              className={linkClassName}
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              underline="hover"
              sx={{ wordBreak: "break-word" }}
              onClick={(e) => e.stopPropagation()}
            >
              {display}
            </Link>,
          );
        }
      }

      lastIndex = tokenRegex.lastIndex;
    }

    if (lastIndex < line.length) {
      parts.push(<span key={`t-${lineIndex}-${keyIndex++}`}>{line.slice(lastIndex)}</span>);
    }

    return parts;
  };

  if (!normalized.trim()) {
    return (
      <Typography variant="body2" component="div" sx={{ lineHeight: 1.6, mt: 1, opacity: 0.75 }}>
        No help available.
      </Typography>
    );
  }

  return (
    <Typography
      variant="body2"
      component="div"
      sx={{
        lineHeight: 1.6,
        mt: 1,
        whiteSpace: "normal",
        wordBreak: "break-word",
      }}
    >
      {lines.map((line, i) => (
        <span key={`hl-${i}`}>
          {renderLineTokens(line, i)}
          {i < lines.length - 1 ? <br /> : null}
        </span>
      ))}
    </Typography>
  );
}

function renderHelpBody(help: string, linkClassName: string): JSX.Element {
  // renderHelpBody
  return renderRichHelpText(help, linkClassName);
}


export default function ProtocolNodeCard({
  data,
  selectedNodeId,
  graphDirection = "TB",
  onClick,
  onDoubleClick,
  zoomLevel = 0.6,
  compactThreshold = 0.09,
  onEdit,
  onRename,
  onDuplicate,
  onCopyWorkflow,
  onPasteWorkflow,
  canPasteWorkflow = false,
  onDelete,
  onRestartAll,
  onContinueAll,
  onResetFrom,
  onSelectFrom,
  onSelectTo,
  onStop,
  onBrowse,
  onManageTags,
  onOpenProtocolClass, // addThis
  inPathSelection = false,
  pathSelectionActive = false,
  showHandles = true,
  service,
  contextMenuVisibility,
}: StatusNodeProps) {
  const svc = useProjectService();
  const svcRef = useRef(svc);

  useEffect(() => {
    // syncSvcRef
    svcRef.current = svc;
  }, [svc]);

  const [isHovered, setIsHovered] = useState(false);
  const [draggingIdx, setDraggingIdx] = useState<number | null>(null);
  const isSelected = selectedNodeId === data.id;

  const { setCurrentDraggedOutput } = useDrag();
  const rootRef = useRef<HTMLDivElement | null>(null);

  const suppressNextMenuActionRef = useRef(false);

  const armSuppressNextMenuAction = useCallback(() => {
    // armSuppressNextMenuAction
    suppressNextMenuActionRef.current = true;

    window.setTimeout(() => {
      suppressNextMenuActionRef.current = false;
    }, 0);
  }, []);

  const isProjectNode = data.id === "PROJECT";
  const isCompactView = zoomLevel <= compactThreshold;

  const protocolLabel = String(data.label ?? "").trim();
  const protocolRunName = String(data.runName ?? "").trim();

  const headerDisplayName = isProjectNode
    ? protocolLabel
    : protocolRunName || protocolLabel || String(data.title ?? data.id ?? "").trim();

  const normalizeDisplayText = (value: string) =>
    String(value ?? "").trim().replace(/\s+/g, " ").toLowerCase();

  const shouldShowProtocolSubtitle =
    !isProjectNode &&
    protocolLabel.length > 0 &&
    normalizeDisplayText(protocolLabel) !== normalizeDisplayText(headerDisplayName);

  const normalizedStatus = String(data.status ?? "finished").trim().toLowerCase();
  const bgColor = statusColors[normalizedStatus] ?? statusColors.root;
  data.color = bgColor;

  const nodeStyle: CSSProperties = {
    backgroundColor: bgColor,
  };

  const statusClassName =
    styles[`status-${normalizedStatus}`] ?? styles["status-finished"];

  const classNames = [
    styles.card,
    styles.crispText,
    statusClassName,
    isHovered ? styles.hovered : "",
    isSelected ? styles.selected : "",
    inPathSelection ? styles.inPathSelection : "",
  ]
    .filter(Boolean)
    .join(" ");

  const reactFlow = useReactFlow();

  const normalizedProjectId = useMemo(() => {
    // normalizedProjectId
    const s = String(data.projectId ?? "").trim();
    if (!s || s === "null" || s === "undefined") return null;
    return data.projectId as Id;
  }, [data.projectId]);

  const normalizedProtocolId = useMemo(() => {
    // normalizedProtocolId
    const s = String(data.id ?? "").trim();
    if (!s || s === "null" || s === "undefined") return null;
    return data.id as Id;
  }, [data.id]);



  const [nextStepSuggestions, setNextStepSuggestions] = useState<NextProtocolSuggestion[] | null>(null);
  const [nextStepLoading, setNextStepLoading] = useState(false);
  const [nextStepError, setNextStepError] = useState<string | null>(null);
  const nextStepInFlightRef = useRef<Promise<void> | null>(null);

  const [nextStepHelpOpen, setNextStepHelpOpen] = useState(false);
  const [nextStepHelpTarget, setNextStepHelpTarget] = useState<NextProtocolSuggestion | null>(null);

  const [nextStepTooltipEpoch, setNextStepTooltipEpoch] = useState(0);
  const [nextStepTooltipsSuppressed, setNextStepTooltipsSuppressed] = useState(false);
  const nextStepTooltipsTimerRef = useRef<number | null>(null);

  const suppressNextStepTooltips = useCallback(() => {
    // suppressNextStepTooltips
    setNextStepTooltipEpoch((v) => v + 1);
    setNextStepTooltipsSuppressed(true);

    if (nextStepTooltipsTimerRef.current != null) {
      window.clearTimeout(nextStepTooltipsTimerRef.current);
    }

    nextStepTooltipsTimerRef.current = window.setTimeout(() => {
      setNextStepTooltipsSuppressed(false);
      nextStepTooltipsTimerRef.current = null;
    }, 180);
  }, []);

  const [exportBrowserOpen, setExportBrowserOpen] = useState(false);
  const [exportBusy, setExportBusy] = useState(false);
  const [exportProtocolIds, setExportProtocolIds] = useState<string[]>([]);
  const [exportDefaultFilename, setExportDefaultFilename] = useState("protocols_export.json");

  const buildDefaultExportFilename = useCallback((projectId: Id, protocolIds: string[]) => {
    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, "0");
    const stamp =
      `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_` +
      `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;

    return `protocols_export_${String(projectId)}_${stamp}.json`;
  }, []);

  useEffect(() => {
    // cleanupNextStepTooltipTimer
    return () => {
      if (nextStepTooltipsTimerRef.current != null) {
        window.clearTimeout(nextStepTooltipsTimerRef.current);
        nextStepTooltipsTimerRef.current = null;
      }
    };
  }, []);


  useEffect(() => {
    // resetNextStepOnNodeChange
    setNextStepSuggestions(null);
    setNextStepError(null);
    setNextStepLoading(false);
    nextStepInFlightRef.current = null;
    setNextStepHelpOpen(false);
    setNextStepHelpTarget(null);
  }, [normalizedProjectId, normalizedProtocolId]);

  const openNextStepHelp = useCallback((suggestion: NextProtocolSuggestion) => {
    // openNextStepHelp
    setNextStepHelpTarget(suggestion);
    setNextStepHelpOpen(true);
  }, []);


  const preventMenuDismissWhileHelpOpen = useCallback(
    (e: any) => {
      // preventMenuDismissWhileHelpOpen
      if (!nextStepHelpOpen) return;
      e.preventDefault();
    },
    [nextStepHelpOpen],
  );


  const closeNextStepHelp = useCallback(() => {
    // closeNextStepHelp
    setNextStepHelpOpen(false);
    setNextStepHelpTarget(null);
  }, []);

  function dismissRadixMenus(): void {
    // dismissRadixMenus
    const doc = document;
    const evt = new KeyboardEvent("keydown", {
      key: "Escape",
      code: "Escape",
      bubbles: true,
      cancelable: true,
    });

    // Dispatch twice to close submenus + parent menus reliably
    doc.dispatchEvent(evt);
    window.setTimeout(() => doc.dispatchEvent(evt), 0);
  }


  const resetNextStepSuggestions = useCallback(() => {
    // resetNextStepSuggestions
    setNextStepSuggestions(null);
    setNextStepError(null);
    setNextStepLoading(false);
    nextStepInFlightRef.current = null;
  }, []);

  const loadNextStepSuggestionsIfNeeded = useCallback(() => {
    // loadNextStepSuggestionsIfNeeded
    if (nextStepSuggestions !== null) return;
    if (nextStepLoading) return;
    if (nextStepInFlightRef.current) return;
    if (isProjectNode) return;

    if (normalizedProjectId == null || normalizedProtocolId == null) {
      setNextStepSuggestions([]);
      return;
    }

    const fn = (svcRef.current as any)?.getNextProtocolSuggestions;
    if (typeof fn !== "function") {
      setNextStepSuggestions([]);
      return;
    }

    setNextStepLoading(true);
    setNextStepError(null);

    const run = async () => {
      const raw = await fn(normalizedProjectId as Id, normalizedProtocolId as Id);
      const list = Array.isArray(raw) ? raw : [];
      const normalized = list
        .map((x: any) => normalizeNextProtocolSuggestion(x))
        .filter(Boolean) as NextProtocolSuggestion[];
      setNextStepSuggestions(normalized);
    };

    const p = run()
      .catch((e: any) => {
        setNextStepError(coerceErrorMessage(e, "Failed to load suggestions"));
      })
      .finally(() => {
        nextStepInFlightRef.current = null;
        setNextStepLoading(false);
      });

    nextStepInFlightRef.current = p;
  }, [isProjectNode, nextStepLoading, nextStepSuggestions, normalizedProjectId, normalizedProtocolId]);



  const { tags: storeTagDefs, setTags: storeSetTags } = useTagStore();

  const [remoteTagDefs, setRemoteTagDefs] = useState<ProtocolTag[]>([]);
  const [isTagDefsLoading, setIsTagDefsLoading] = useState(false);

  const canReadTagDefsFromBackend =
    normalizedProjectId != null && typeof (svcRef.current as any)?.listProjectTags === "function";

  useEffect(() => {
    // loadTagDefinitionsFromBackend
    if (!canReadTagDefsFromBackend) return;

    const pidKey = String(normalizedProjectId ?? "").trim();
    if (!pidKey) return;

    const storeTagsAreForThisProject = tagDefsStoreProjectId === pidKey;
    const cached = tagDefsCacheByProjectId.get(pidKey);

    if (cached && cached.length > 0) {
      // doNotOverwriteStoreWithStaleCache
      const storeHasDataForThisProject = Array.isArray(storeTagDefs) && storeTagDefs.length > 0 && storeTagsAreForThisProject;

      if (!storeHasDataForThisProject) {
        tagDefsStoreProjectId = pidKey;
        storeSetTags?.(cached);
      }

      return;
    }


    if (Array.isArray(storeTagDefs) && storeTagDefs.length > 0 && storeTagsAreForThisProject) return;

    let cancelled = false;
    setIsTagDefsLoading(true);

    const existingPromise = tagDefsInFlightByProjectId.get(pidKey);
    const promise =
      existingPromise ??
      (async () => {
        const remote = await svcRef.current.listProjectTags(normalizedProjectId as Id);
        const list = normalizeTagDefList(remote as ServiceProtocolTag[]);
        tagDefsCacheByProjectId.set(pidKey, list);
        return list;
      })();

    if (!existingPromise) tagDefsInFlightByProjectId.set(pidKey, promise);

    promise
      .then((list) => {
        if (cancelled) return;
        tagDefsStoreProjectId = pidKey;
        storeSetTags?.(list);
        setRemoteTagDefs(list);
      })
      .catch((e) => {
        if (cancelled) return;
        toast.error(coerceErrorMessage(e, "Failed to load tags"));
      })
      .finally(() => {
        if (cancelled) return;
        setIsTagDefsLoading(false);
        if (tagDefsInFlightByProjectId.get(pidKey) === promise) {
          tagDefsInFlightByProjectId.delete(pidKey);
        }
      });

    return () => {
      // cleanup
      cancelled = true;
    };
  }, [canReadTagDefsFromBackend, normalizedProjectId, storeSetTags, storeTagDefs]);


  useEffect(() => {
    // syncCacheWithStoreForProject
    const pidKey = normalizedProjectId != null ? String(normalizedProjectId) : "";
    if (!pidKey) return;

    const storeTagsAreForThisProject = tagDefsStoreProjectId === pidKey;
    if (!storeTagsAreForThisProject) return;

    if (Array.isArray(storeTagDefs)) {
      tagDefsCacheByProjectId.set(pidKey, [...storeTagDefs]);
    }
  }, [normalizedProjectId, storeTagDefs]);

  const tagDefs: ProtocolTag[] = useMemo(() => {
    // tagDefs
    const pidKey = normalizedProjectId != null ? String(normalizedProjectId) : "";
    const storeTagsAreForThisProject = pidKey && tagDefsStoreProjectId === pidKey;

    // storeIsSourceOfTruth
    if (storeTagsAreForThisProject && Array.isArray(storeTagDefs) && storeTagDefs.length > 0) {
      return storeTagDefs;
    }

    // cacheIsFallbackOnly
    const cached = pidKey ? tagDefsCacheByProjectId.get(pidKey) : null;
    if (cached && cached.length > 0) return cached;

    return remoteTagDefs;
  }, [normalizedProjectId, remoteTagDefs, storeTagDefs]);


  const backendAssignmentsWriteEnabled =
    normalizedProjectId != null &&
    normalizedProtocolId != null &&
    typeof (svcRef.current as any)?.setProtocolTagIds === "function";

  const optimisticTagIdsByProtocolRef = useRef<Record<string, string[]>>({});
  const [optimisticRevision, setOptimisticRevision] = useState(0);

  const updateReactFlowNodeTags = useCallback(
    (updates: Array<{ protocolId: string; tagIds: string[] }>) => {
      // updateReactFlowNodeTags
      const setNodes = (reactFlow as any)?.setNodes;
      if (typeof setNodes !== "function") return;

      const byId = new Map(updates.map((u) => [String(u.protocolId), [...u.tagIds]]));
      setNodes((prev: any[]) => {
        if (!Array.isArray(prev)) return prev;

        let changed = false;

        const next = prev.map((n) => {
          const id = String(n?.id ?? "");
          const nextTagIds = byId.get(id);
          if (!nextTagIds) return n;

          changed = true;
          const nextData = { ...(n?.data ?? {}), tags: nextTagIds };
          return { ...n, data: nextData };
        });

        return changed ? next : prev;
      });
    },
    [reactFlow],
  );

  type TagTarget = {
    protocolId: string;
    projectId: string | number | undefined;
    rawTags: unknown;
  };

  const getSelectedTagTargets = useCallback((): TagTarget[] => {
    // getSelectedTagTargets
    try {
      const nodes = reactFlow.getNodes?.() ?? [];
      const selectedNodes = nodes.filter((n) => (n as any)?.selected === true);

      const currentId = String(data.id);
      const currentNode = nodes.find((n) => String(n.id) === currentId);

      const currentIsSelected = selectedNodes.some((n) => String(n.id) === currentId);
      const baseNodes = currentIsSelected ? selectedNodes : currentNode ? [currentNode] : [];

      if (baseNodes.length === 0) {
        return [
          {
            protocolId: String(data.id),
            projectId: data.projectId,
            rawTags: (data as any)?.tags,
          },
        ];
      }

      return baseNodes
        .filter((n) => String(n.id) !== "PROJECT")
        .map((n) => ({
          protocolId: String(n.id),
          projectId: (n as any)?.data?.projectId ?? data.projectId,
          rawTags: (n as any)?.data?.tags,
        }));
    } catch {
      return [
        {
          protocolId: String(data.id),
          projectId: data.projectId,
          rawTags: (data as any)?.tags,
        },
      ];
    }
  }, [reactFlow, data.id, data.projectId, data]);

  const getSelectedProtocolIdsForExport = useCallback((): string[] => {
    const targets = getSelectedTagTargets();

    return uniqStrings(
      targets
        .map((t) => String(t.protocolId ?? "").trim())
        .filter((protocolId) => protocolId && protocolId !== "PROJECT"),
    );
  }, [getSelectedTagTargets]);

  const getTagIdsFromNodeRaw = useCallback(
    (rawTags: unknown): string[] => {
      // getTagIdsFromNodeRaw
      if (!Array.isArray(rawTags)) return [];
      return uniqStrings(normalizeTagIdsFromRaw(rawTags, tagDefs));
    },
    [tagDefs],
  );

  const getEffectiveAssignedForTarget = useCallback(
    (protocolId: string, rawTags: unknown): string[] => {
      // getEffectiveAssignedForTarget
      const optimistic = optimisticTagIdsByProtocolRef.current[String(protocolId)];
      if (Array.isArray(optimistic)) return uniqStrings(optimistic);
      return getTagIdsFromNodeRaw(rawTags);
    },
    [getTagIdsFromNodeRaw],
  );

  const applyTagUpdatesOptimistically = useCallback(
    (updates: Array<{ projectId: string | number | undefined; protocolId: string; tagIds: string[] }>) => {
      // applyTagUpdatesOptimistically
      if (updates.length === 0) return;

      for (const u of updates) {
        optimisticTagIdsByProtocolRef.current[String(u.protocolId)] = [...u.tagIds];
      }
      setOptimisticRevision((v) => v + 1);

      updateReactFlowNodeTags(
        updates.map((u) => ({
          protocolId: String(u.protocolId),
          tagIds: [...u.tagIds],
        })),
      );
    },
    [updateReactFlowNodeTags],
  );

  const persistTagUpdatesToBackend = useCallback(
    async (updates: Array<{ projectId: string | number | undefined; protocolId: string; tagIds: string[] }>) => {
      // persistTagUpdatesToBackend
      if (!backendAssignmentsWriteEnabled) return;

      await Promise.all(
        updates.map(async (u) => {
          await (svcRef.current as any).setProtocolTagIds(u.projectId as Id, u.protocolId as Id, u.tagIds);
        }),
      );
    },
    [backendAssignmentsWriteEnabled],
  );

  const toggleTagSelectionForSelection = useCallback(
    (tagId: string) => {
      // toggleTagSelectionForSelection
      if (isProjectNode) return;

      const normalizedTagId = normalizeTagIdCandidate(tagId, tagDefs);
      if (!normalizedTagId) return;

      const targets = getSelectedTagTargets();
      if (targets.length === 0) return;

      const run = async () => {
        // run
        const currentByTarget = targets.map((t) => {
          const current = getEffectiveAssignedForTarget(String(t.protocolId), t.rawTags);
          return { ...t, current };
        });

        const allHaveTag = currentByTarget.every((t) =>
          t.current.some((x) => String(x) === String(normalizedTagId)),
        );

        const updates = currentByTarget.map((t) => {
          const next = allHaveTag
            ? t.current.filter((x) => String(x) !== String(normalizedTagId))
            : uniqStrings([...t.current, normalizedTagId]);

          return {
            projectId: t.projectId,
            protocolId: String(t.protocolId),
            tagIds: next,
          };
        });

        const rollback = currentByTarget.map((t) => ({
          projectId: t.projectId,
          protocolId: String(t.protocolId),
          tagIds: uniqStrings(t.current),
        }));

        applyTagUpdatesOptimistically(updates);

        try {
          await persistTagUpdatesToBackend(updates);
        } catch (e: any) {
          applyTagUpdatesOptimistically(rollback);
          toast.error(coerceErrorMessage(e, "Failed to update tags"));
        }
      };

      void run();
    },
    [
      applyTagUpdatesOptimistically,
      getEffectiveAssignedForTarget,
      getSelectedTagTargets,
      isProjectNode,
      persistTagUpdatesToBackend,
      tagDefs,
    ],
  );

  const rawNodeTags = (data as any)?.tags;

  const effectiveAssignedTagIds = useMemo(() => {
    // effectiveAssignedTagIds
    const optimistic = optimisticTagIdsByProtocolRef.current[String(data.id)];
    if (Array.isArray(optimistic)) return uniqStrings(optimistic);
    return getTagIdsFromNodeRaw(rawNodeTags);
  }, [data.id, getTagIdsFromNodeRaw, rawNodeTags, optimisticRevision]);

  const selectedTagIds = useMemo(() => {
    // selectedTagIds
    return filterExistingTagIds(effectiveAssignedTagIds, tagDefs);
  }, [effectiveAssignedTagIds, tagDefs]);

  useEffect(() => {
    // pruneOrphanAssignments
    if (isProjectNode) return;
    if (tagDefs.length === 0) return;

    if (selectedTagIds.length !== effectiveAssignedTagIds.length) {
      const updates = [
        {
          projectId: data.projectId,
          protocolId: String(data.id),
          tagIds: selectedTagIds,
        },
      ];

      applyTagUpdatesOptimistically(updates);

      if (backendAssignmentsWriteEnabled) {
        void persistTagUpdatesToBackend(updates).catch(() => {
          // ignore
        });
      }
    }
  }, [
    applyTagUpdatesOptimistically,
    backendAssignmentsWriteEnabled,
    data.id,
    data.projectId,
    effectiveAssignedTagIds.length,
    isProjectNode,
    persistTagUpdatesToBackend,
    selectedTagIds,
    tagDefs.length,
  ]);

  const selectedTagSet = useMemo(() => {
    // selectedTagSet
    return new Set(selectedTagIds.map((t) => String(t)));
  }, [selectedTagIds]);

  const tagsById = useMemo(() => {
    // tagsById
    return new Map(tagDefs.map((t) => [String(t.id), t]));
  }, [tagDefs]);

  const selectedTags = useMemo(() => {
    // selectedTags
    return selectedTagIds.map((id) => tagsById.get(String(id))).filter(Boolean) as ProtocolTag[];
  }, [selectedTagIds, tagsById]);

  const handleToggleTagFromMenu = useCallback(
    (e: Event, tagId: string, keepOpen: boolean) => {
      // handleToggleTagFromMenu
      e.stopPropagation();
      if (keepOpen) e.preventDefault();
      toggleTagSelectionForSelection(String(tagId));
    },
    [toggleTagSelectionForSelection],
  );

  const handleManageTags = useCallback(() => {
    // handleManageTags
    if (isProjectNode) return;
    onManageTags?.(data.id, data.projectId, headerDisplayName);
  }, [data.id, data.projectId, headerDisplayName, isProjectNode, onManageTags]);

  const handleEdit = () => onEdit?.(data.id);
  const handleRename = () => onRename?.(data.id);
  const handleDuplicate = () => onDuplicate?.(data.id);
  const handleCopyWorkflow = () => {
    if (!isProjectNode) onCopyWorkflow?.(data.id);
  };

  const handlePasteWorkflow = () => {
    onPasteWorkflow?.(data.id);
  };
  const handleDelete = () => onDelete?.(data.id);
  const handleRestartAll = () => onRestartAll?.(data.id);
  const handleContinueAll = () => onContinueAll?.(data.id);
  const handleResetFrom = () => onResetFrom?.(data.id);

  const handleSelectFrom = () => {
    if (!isProjectNode) onSelectFrom?.(data.id);
  };

  const handleSelectTo = () => {
    if (!isProjectNode) onSelectTo?.(data.id);
  };

  const handleStop = () => {
    if (!isProjectNode) onStop?.(data.id);
  };

  const handleBrowse = () => {
    if (!isProjectNode) onBrowse?.(data.id, data.projectId, headerDisplayName);
  };

  const reduceMenus = pathSelectionActive || inPathSelection;

  const isMenuItemVisible = useCallback(
    (id: NodeMenuItemId) => {
      // menuVisibilityDefaultVisible
      return contextMenuVisibility?.[id] !== false;
    },
    [contextMenuVisibility],
  );



  const FromIcon = graphDirection === "TB" ? ArrowDown : ArrowRight;
  const ToIcon = graphDirection === "TB" ? ArrowUp : ArrowLeft;

  const forwardClickToRFNode = (e: ReactMouseEvent) => {
    // forwardClickToRFNode
    const doc = (e.target as HTMLElement | null)?.ownerDocument || document;
    const win = doc.defaultView || window;

    const nodeEl =
      (e.currentTarget as HTMLElement)?.closest(".react-flow__node") ??
      rootRef.current?.closest(".react-flow__node") ??
      doc.querySelector(`.react-flow__node[data-id="${CSS.escape(String(data.id))}"]`);

    if (!nodeEl) return;

    const opts: MouseEventInit = {
      bubbles: true,
      cancelable: true,
      button: 0,
      clientX: e.clientX,
      clientY: e.clientY,
      ctrlKey: e.ctrlKey,
      metaKey: e.metaKey,
      shiftKey: e.shiftKey,
      view: win,
    };

    nodeEl.dispatchEvent(new MouseEvent("pointerdown", opts));
    nodeEl.dispatchEvent(new MouseEvent("pointerup", opts));
    nodeEl.dispatchEvent(new MouseEvent("mousedown", opts));
    nodeEl.dispatchEvent(new MouseEvent("mouseup", opts));
    nodeEl.dispatchEvent(new MouseEvent("click", opts));
  };

  const getReactFlowNodeElement = useCallback(
    (e: ReactFlowSelectionEvent) => {
      // getReactFlowNodeElement
      const doc = (e.target as HTMLElement | null)?.ownerDocument || document;

      const nodeEl =
        (e.currentTarget as HTMLElement | null)?.closest(".react-flow__node") ??
        rootRef.current?.closest(".react-flow__node") ??
        doc.querySelector(`.react-flow__node[data-id="${CSS.escape(String(data.id))}"]`);

      return nodeEl as HTMLElement | null;
    },
    [data.id],
  );

  const isReactFlowNodeCurrentlySelected = useCallback(
    (e: ReactFlowSelectionEvent) => {
      // isReactFlowNodeCurrentlySelected
      const nodeEl = getReactFlowNodeElement(e);
      if (!nodeEl) return false;
      return nodeEl.classList.contains("selected");
    },
    [getReactFlowNodeElement],
  );

  const selectNodeExclusivelyInReactFlow = useCallback(
    (e: ReactFlowSelectionEvent) => {
      // selectNodeExclusivelyInReactFlow
      const doc = (e.target as HTMLElement | null)?.ownerDocument || document;
      const win = doc.defaultView || window;

      const nodeEl = getReactFlowNodeElement(e);
      if (!nodeEl) return;

      const clientX = (e as any).clientX ?? 0;
      const clientY = (e as any).clientY ?? 0;

      const opts: MouseEventInit = {
        bubbles: true,
        cancelable: true,
        button: 0,
        clientX,
        clientY,
        ctrlKey: false,
        metaKey: false,
        shiftKey: false,
        view: win,
      };

      nodeEl.dispatchEvent(new MouseEvent("pointerdown", opts));
      nodeEl.dispatchEvent(new MouseEvent("pointerup", opts));
      nodeEl.dispatchEvent(new MouseEvent("mousedown", opts));
      nodeEl.dispatchEvent(new MouseEvent("mouseup", opts));
      nodeEl.dispatchEvent(new MouseEvent("click", opts));
    },
    [getReactFlowNodeElement],
  );

  const ensureRightClickSelectionIsUnambiguous = useCallback(
    (e: ReactFlowSelectionEvent) => {
      // ensureRightClickSelectionIsUnambiguous
      const alreadySelected = isReactFlowNodeCurrentlySelected(e);
      if (alreadySelected) return;
      selectNodeExclusivelyInReactFlow(e);
    },
    [isReactFlowNodeCurrentlySelected, selectNodeExclusivelyInReactFlow],
  );

  const truncateLabel = (text: string = "", max: number = 120) => (text.length > max ? `${text.slice(0, max)}…` : text);

  const outputsArray = Array.isArray(data.outputs) ? data.outputs : [];
  const hasOutputs = outputsArray.length > 0;

  const outputThumbnails = (data.outputThumbnails ?? {}) as Record<string, any>;
  const outputThumbnailsEnabled = data.protocolOutputThumbnailsEnabled === true;
  const thumbnailMode = outputThumbnailsEnabled && !isProjectNode;

  const renderableOutputThumbnailCount = useMemo(() => {
    return outputsArray.reduce((count, outputObj) => {
      const value = normalizeOutputItem(outputObj);
      const outputName = String(value?.name ?? "").trim();
      if (!outputName) return count;

      return outputThumbnails[outputName]?.thumbnailDataUrl ? count + 1 : count;
    }, 0);
  }, [outputsArray, outputThumbnails]);

  const shouldUseOutputTiles = outputThumbnailsEnabled && hasOutputs;

  const outputThumbnailLayoutCount = shouldUseOutputTiles
    ? outputsArray.length
    : renderableOutputThumbnailCount;

  const outputThumbnailLayoutClassName =
    outputThumbnailLayoutCount <= 1
      ? styles.sectionContentThumbsSingle
      : outputThumbnailLayoutCount === 2
        ? styles.sectionContentThumbsDouble
        : outputThumbnailLayoutCount === 3
          ? styles.sectionContentThumbsTriple
          : styles.sectionContentThumbsMany;

  const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad|iPod/.test(navigator.platform);

  const handleContextMenuCapture = useCallback(
    (e: ReactMouseEvent) => {
      // handleContextMenuCapture
      armSuppressNextMenuAction();

      // On macOS Ctrl+Click is treated as a secondary click (context menu).
      // We block it so Ctrl can be used for multi-selection in ReactFlow.
      if (isMac && e.ctrlKey) {
        e.preventDefault();
        e.stopPropagation();
        return;
      }

      // If user right-clicks a non-selected node, make it the only selection.
      ensureRightClickSelectionIsUnambiguous(e);
    },
    [isMac, armSuppressNextMenuAction, ensureRightClickSelectionIsUnambiguous],
  );

  const resolveExportBrowserPaths = useCallback(async (): Promise<ResolveBrowserPathsResult> => {
    return await svcRef.current.resolveBrowserPaths(-1, -1);
  }, []);

  const listExportRemoteDirectory = useCallback(async (relPath: string): Promise<RemoteEntry[]> => {
    const items = await svcRef.current.listRemoteDirectory(-1, -1, relPath ?? "");
    return Array.isArray(items) ? (items as RemoteEntry[]) : [];
  }, []);

  const previewExportRemoteEntry = useCallback(async (relPath: string): Promise<RemotePreview | null> => {
    return await svcRef.current.previewRemoteEntry(-1, -1, relPath ?? "");
  }, []);

  const buildExportDownloadUrl = useCallback((relPath: string, inline: boolean = false) => {
    return svcRef.current.buildProtocolDownloadUrl("-1", "-1", relPath ?? "", inline);
  }, []);

  const handleExport = useCallback(() => {
    if (isProjectNode) return;
    if (normalizedProjectId == null) {
      toast.error("Project id is not available.");
      return;
    }

    const protocolIds = getSelectedProtocolIdsForExport();
    if (protocolIds.length === 0) {
      toast.error("No protocols selected to export.");
      return;
    }

    setExportProtocolIds(protocolIds);
    setExportDefaultFilename(buildDefaultExportFilename(normalizedProjectId, protocolIds));
    setExportBrowserOpen(true);
  }, [
    buildDefaultExportFilename,
    getSelectedProtocolIdsForExport,
    isProjectNode,
    normalizedProjectId,
  ]);

  const handlePickExportTarget = useCallback(
    (directoryPath: string, _entry: RemoteEntry, filename?: string) => {
      if (normalizedProjectId == null) {
        toast.error("Project id is not available.");
        return;
      }

      const finalDirectoryPath = String(directoryPath ?? "").trim();
      const finalFilename = String(filename ?? "").trim();
      const protocolIds = exportProtocolIds;

      if (!finalDirectoryPath) {
        toast.error("Please choose a destination folder.");
        return;
      }

      if (!finalFilename) {
        toast.error("Please provide a file name.");
        return;
      }

      if (!protocolIds.length) {
        toast.error("No protocols selected to export.");
        return;
      }

      const run = async () => {
        setExportBusy(true);

        try {
          const payload: ExportProtocolsRequestPayload = {
            protocolIds,
            directoryPath: finalDirectoryPath,
            filename: finalFilename,
          };

          const result = await svcRef.current.exportProtocols(
            normalizedProjectId as Id,
            payload,
          );

          toast.success(`Export saved as ${result.filename ?? finalFilename}`);
          setExportBrowserOpen(false);
          setExportProtocolIds([]);
        } catch (e: any) {
          toast.error(coerceErrorMessage(e, "Failed to export protocols"));
        } finally {
          setExportBusy(false);
        }
      };

      void run();
    },
    [exportProtocolIds, normalizedProjectId],
  );

  const handleCloseExportBrowser = useCallback(() => {
    if (exportBusy) return;
    setExportBrowserOpen(false);
    setExportProtocolIds([]);
  }, [exportBusy]);

  const mod = isMac ? "⌘" : "Ctrl";
  const modShift = isMac ? "⌘⇧" : "Ctrl+Shift";

  const shortcuts = {
    edit: "Space / Db-Click",
    browse: `${mod} + B`,
    rename: "F2",
    delete: "Del",
    duplicate: `${mod} + D`,
    copyWorkflow: `${mod} + C`,
    pasteWorkflow: `${mod} + V`,
    restartAll: `${modShift} + R`,
    continueAll: `${modShift} + C`,
    resetFrom: `${modShift} + F`,
    stop: `${modShift} + S`,
    selectFrom: "Alt + ↓",
    selectTo: "Alt + ↑",
  } as const;

  const ShortcutHint = ({ text }: { text?: string }) => (text ? <span className={styles.shortcutHint}>{text}</span> : null);

  const shouldRenderProtocolBody = !isProjectNode;
  const isContentExpanded = !isCompactView;

  const contentClassName = [styles.content, isContentExpanded ? styles.contentExpanded : styles.contentCollapsed].join(" ");

  const contentStyle: CSSProperties = {
    opacity: isContentExpanded ? 1 : 0,
    transition: "max-height 520ms cubic-bezier(0.2, 0.8, 0.2, 1), opacity 260ms ease-in-out",
    willChange: "max-height, opacity",
  };

  const [analyzeOpen, setAnalyzeOpen] = useState(false);
  const [analyzeTarget, setAnalyzeTarget] = useState<{
    outputName: string;
    outputRaw: any;
  } | null>(null);
  const [tableViewerState, setTableViewerState] = useState<TableViewerDecision | null>(null);

  const analyzeProjectId = useMemo(() => {
    const n = Number(data.projectId);
    return Number.isFinite(n) ? n : 0;
  }, [data.projectId]);

  const analyzeProtocolId = useMemo(() => {
    const n = Number(data.id);
    return Number.isFinite(n) ? n : 0;
  }, [data.id]);

  const canOpenViewer = !isProjectNode && data.projectId != null;

  const openSuggestedProtocolClass = useCallback(
    (suggestion: NextProtocolSuggestion) => {
      // openSuggestedProtocolClass
      if (isProjectNode) return;

      const installedValue = String(suggestion.installed ?? "installed").trim() || "installed";
      const isInstalled = installedValue === "installed";
      if (!isInstalled) return;

      if (typeof onOpenProtocolClass === "function") {
        onOpenProtocolClass(
          String(suggestion.protocolClass),
          data.projectId,
          String(data.id),
          data.label,
        );
        return;
      }

      toast.error("Opening suggested protocols is not configured.");
    },
    [data.id, data.label, data.projectId, isProjectNode, onOpenProtocolClass],
  );


  const renderNextStepSubContent = useCallback(
    (kind: "dropdown" | "context") => {
      // renderNextStepSubContent
      const Item: any = kind === "dropdown" ? DropdownMenuItem : ContextMenuItem;
      const Sep: any = kind === "dropdown" ? DropdownMenuSeparator : ContextMenuSeparator;

      if (isProjectNode) {
        return (
          <Item disabled>
            <div className={styles.menuRow}>
              <span className={styles.menuLeft}>
                <span>Not available for project</span>
              </span>
            </div>
          </Item>
        );
      }

      if (nextStepLoading) {
        return (
          <Item disabled>
            <div className={styles.menuRow}>
              <span className={styles.menuLeft}>
                <span>Loading suggestions...</span>
              </span>
            </div>
          </Item>
        );
      }

      if (nextStepError) {
        return (
          <>
            <Item disabled>
              <div className={styles.menuRow}>
                <span className={styles.menuLeft}>
                  <span>{nextStepError}</span>
                </span>
              </div>
            </Item>
            <Sep />
            <Item
              onSelect={(e: Event) => {
                e.preventDefault();
                e.stopPropagation();
                resetNextStepSuggestions();
                loadNextStepSuggestionsIfNeeded();
              }}
            >
              <div className={styles.menuRow}>
                <span className={styles.menuLeft}>
                  <span>Retry</span>
                </span>
              </div>
            </Item>
          </>
        );
      }

      if (nextStepSuggestions == null) {
        return (
          <Item disabled>
            <div className={styles.menuRow}>
              <span className={styles.menuLeft}>
                <span>Open to load suggestions</span>
              </span>
            </div>
          </Item>
        );
      }

      if (nextStepSuggestions.length === 0) {
        return (
          <Item disabled>
            <div className={styles.menuRow}>
              <span className={styles.menuLeft}>
                <span>No suggestions</span>
              </span>
            </div>
          </Item>
        );
      }

      const list = (
        <div className={styles.nextStepList}
          data-next-step-scroll
          onScrollCapture={suppressNextStepTooltips}
          onWheelCapture={suppressNextStepTooltips}
          onTouchMoveCapture={suppressNextStepTooltips}>
          {nextStepSuggestions.map((s) => {
            const installedValue = String(s.installed ?? "installed").trim() || "installed";
            const isInstalled = installedValue === "installed";
            const disabledTooltip = !isInstalled ? installedValue : "";

            const showHelp = typeof s.help === "string" && s.help.trim().length > 0;

            const swallowIfDisabled = (e: any) => {
              // swallowIfDisabled
              if (isInstalled) return;
              e.preventDefault();
              e.stopPropagation();
            };

            const left = (
              <div
                className={styles.nextStepLeft}
                aria-disabled={!isInstalled}
                onPointerDown={(e) => {
                  // preventMenuCloseAndUnderlyingClicks
                  e.preventDefault();
                  e.stopPropagation();
                }}
                onMouseDown={(e) => {
                  // preventMenuCloseAndUnderlyingMouseDown
                  e.preventDefault();
                  e.stopPropagation();
                }}
                onClick={(e) => {
                  // preventSingleClickAction
                  e.preventDefault();
                  e.stopPropagation();
                }}
                onDoubleClick={(e) => {
                  // openOnDoubleClickIfInstalled
                  e.preventDefault();
                  e.stopPropagation();
                  if (!isInstalled) return;
                  dismissRadixMenus();
                  openSuggestedProtocolClass(s);
                }}
                onKeyDown={(e) => {
                  // openOnEnterKeyIfInstalled
                  if (e.key !== "Enter") return;
                  e.preventDefault();
                  e.stopPropagation();
                  if (!isInstalled) return;
                  dismissRadixMenus();
                  openSuggestedProtocolClass(s);
                }}
                role="button"
                tabIndex={isInstalled ? 0 : -1}
              >
                <FileIcon className={styles.nextStepItemIcon} />

                <Tooltip
                  key={`nextStepNameTooltip-${s.protocolClass}-${nextStepTooltipEpoch}`}
                  title={s.protocolName}
                  placement="right"
                  arrow
                  enterDelay={250}
                  disableHoverListener={nextStepTooltipsSuppressed}
                  disableFocusListener={nextStepTooltipsSuppressed}
                  disableTouchListener={nextStepTooltipsSuppressed}
                  slotProps={{
                    popper: { sx: { zIndex: 26000 } },
                    tooltip: { sx: { fontSize: "0.95rem", lineHeight: 1.35 } },
                  }}
                >
                  <span style={{ display: "block" }}>
                    <span className={styles.nextStepName}>{s.protocolName}</span>
                  </span>
                </Tooltip>
              </div>
            );

            const leftWithTooltip = disabledTooltip ? (
              <Tooltip
                key={`nextStepDisabledTooltip-${s.protocolClass}-${nextStepTooltipEpoch}`}
                title={disabledTooltip}
                placement="right"
                arrow
                enterDelay={250}
                disableHoverListener={nextStepTooltipsSuppressed}
                disableFocusListener={nextStepTooltipsSuppressed}
                disableTouchListener={nextStepTooltipsSuppressed}
                slotProps={{
                  popper: { sx: { zIndex: 26000 } },
                  tooltip: { sx: { fontSize: "0.95rem", lineHeight: 1.35 } },
                }}
              >
                <span style={{ display: "block" }}>{left}</span>
              </Tooltip>

            ) : (
              left
            );

            return (
              <Item
                key={`${s.protocolClass}:${s.protocolName}`}
                onSelect={(e: Event) => {
                  // keepMenuOpenNoRowActionYet
                  e.preventDefault();
                  e.stopPropagation();
                }}
              >
                <div
                  className={[styles.nextStepRow, !isInstalled ? styles.nextStepRowDisabled : ""].join(" ")}
                  onPointerDown={swallowIfDisabled}
                  onMouseDown={swallowIfDisabled}
                  onClick={swallowIfDisabled}
                  onDoubleClick={swallowIfDisabled}
                >
                  {leftWithTooltip}

                  <div className={styles.nextStepRight}>
                    {showHelp ? (
                      <button
                        type="button"
                        className={styles.nextStepHelpBtn}
                        aria-label={`Help for ${s.protocolName}`}
                        onPointerDown={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                        }}
                        onMouseDown={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                        }}
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          openNextStepHelp(s);
                        }}
                      >
                        <HelpCircle className={styles.nextStepHelpIcon} />
                      </button>
                    ) : (
                      <span className={styles.nextStepHelpPlaceholder} />
                    )}
                  </div>
                </div>
              </Item>
            );
          })}


        </div>
      );

      return list;

    },
    [
      isProjectNode,
      loadNextStepSuggestionsIfNeeded,
      nextStepError,
      nextStepLoading,
      nextStepSuggestions,
      openNextStepHelp,
      resetNextStepSuggestions,
      openSuggestedProtocolClass,
      nextStepTooltipEpoch,
      nextStepTooltipsSuppressed,
      suppressNextStepTooltips,
    ],
  );


  const openOutputViewer = useCallback(
    async (outputName: string, outputRaw: any, normalized?: NormalizedOutput | null) => {
      // openOutputViewer
      if (!canOpenViewer) return;

      const maybeResolve = service?.resolveAnalyzeViewer;
      if (typeof maybeResolve === "function") {
        try {
          const ctx: AnalyzeViewerResolveContext = {
            projectId: data.projectId as string | number,
            protocolId: data.id,
            protocolLabel: headerDisplayName,
            outputName,
            pointerClass: normalized?.pointerClass,
            paramClass: normalized?.paramClass,
            info: normalized?.info,
            value: normalized?.value,
            parentId: normalized?.parentId as any,
          };

          const decision = await maybeResolve(ctx);
          if (decision?.handled === true) {
            if (isTableViewerAnalyzeDecision(decision)) {
              setTableViewerState(decision);
              return;
            }

            const opened = openDecisionUrl(decision);
            if (opened) return;
            return;
          }
        } catch {
          // ignoreResolveErrorsAndFallbackToInternal
        }
      }

      setAnalyzeTarget({ outputName, outputRaw });
      setAnalyzeOpen(true);
    },
    [canOpenViewer, data.projectId, data.id, headerDisplayName, service],
  );

  const stepsDone = Number(data.stepsDone ?? 0);
  const numberOfSteps = Number(data.numberOfSteps ?? 0);

  const hasStepProgress =
    Number.isFinite(stepsDone) &&
    Number.isFinite(numberOfSteps) &&
    numberOfSteps > 0;

  const progressPct = hasStepProgress
    ? Math.max(0, Math.min(100, (stepsDone / numberOfSteps) * 100))
    : 0;

  const showProgressBar =
    data.status === "running" ||
    data.status === "failed" ||
    data.status === "aborted";

  const showIndeterminateProgress =
    data.status === "running" &&
    numberOfSteps > 0 &&
    stepsDone <= 0;

  return (
    <ContextMenu modal={false}>
      <ContextMenuTrigger asChild>
        <div
          ref={rootRef}
          className={classNames}
          style={nodeStyle}
          data-thumbnail-mode={outputThumbnailsEnabled && !isProjectNode ? "true" : undefined}
          onContextMenuCapture={handleContextMenuCapture}
          onPointerDownCapture={(e: ReactPointerEvent<HTMLDivElement>) => {
            // suppressMenuMouseUpSelectingFirstItem
            if (e.button === 2) {
              ensureRightClickSelectionIsUnambiguous(e);
              armSuppressNextMenuAction();
            }
          }}
          onClick={(e) => {
            // avoidClickSideEffectsAfterContextMenuOpen
            if (suppressNextMenuActionRef.current) {
              e.preventDefault();
              e.stopPropagation();
              return;
            }
            onClick?.(e);
          }}
          onDoubleClick={(e: ReactMouseEvent) => {
            e.stopPropagation();
            onDoubleClick?.();
          }}
          onMouseEnter={() => setIsHovered(true)}
          onMouseLeave={() => setIsHovered(false)}
        >
          <div className={[styles.header, isProjectNode ? styles.headerProject : styles.headerProtocol].join(" ")}>
            <div className={styles.headerLeft}>
              {!isProjectNode && (
                <div
                  className={[styles.nodeIdBadge, data.status === "running" ? styles.glowBadge : ""].filter(Boolean).join(" ")}
                  style={isCompactView ? { fontSize: "2.4rem" } : { fontSize: "2.3rem" }}
                >
                  <span>{data.id}</span>
                </div>
              )}

              {isProjectNode ? (
                <div className={styles.projectLabelWrapper} style={isCompactView ? { fontSize: "2.8rem" } : {}}>
                  <div title={data.label}>{truncateLabel(data.label, 150)}</div>
                </div>
              ) : (
                <div className={styles.protocolTitleBlock}>
                  <OverflowTooltipText
                    as="div"
                    text={protocolLabel}
                    className={[styles.label, isCompactView ? styles.labelCompact : ""].filter(Boolean).join(" ")}
                  />

                  {shouldShowProtocolSubtitle ? (
                    <div className={styles.protocolSubtitle} title={headerDisplayName}>
                      {truncateLabel(headerDisplayName, 150)}
                    </div>
                  ) : null}
                </div>

              )}
            </div>

            {!isProjectNode && (
              <div className={styles.headerRight}>
                <DropdownMenu modal={false}>
                  <DropdownMenuTrigger asChild>
                    <button
                      type="button"
                      className={`${styles.iconButton} nodrag`}
                      onPointerDown={(e) => e.stopPropagation()}
                      onMouseDown={(e) => e.stopPropagation()}
                      onClick={(e) => e.stopPropagation()}
                      onDoubleClick={(e) => e.stopPropagation()}
                      draggable={false}
                      data-nodrag
                      aria-label="Open node menu"
                    >
                      <MoreHorizontal className={styles.menuIcon} />
                    </button>
                  </DropdownMenuTrigger>

                  <DropdownMenuContent className={styles.menuContent}
                    onClick={(e) => e.stopPropagation()}
                    onPointerDownOutside={preventMenuDismissWhileHelpOpen}
                    onFocusOutside={preventMenuDismissWhileHelpOpen}
                    onInteractOutside={preventMenuDismissWhileHelpOpen}>
                    {!reduceMenus && (
                      <>
                        {isMenuItemVisible("open") && (
                          <DropdownMenuItem onSelect={() => handleEdit()}>
                            <div className={styles.menuRow}>
                              <span className={styles.menuLeft}>
                                <Scan className={styles.menuItemIcon} />
                                <span>Open</span>
                              </span>
                              <ShortcutHint text={shortcuts.edit} />
                            </div>
                          </DropdownMenuItem>)}


                        {isMenuItemVisible("browse") && (
                          <DropdownMenuItem onSelect={() => handleBrowse()}>
                            <div className={styles.menuRow}>
                              <span className={styles.menuLeft}>
                                <FolderOpen className={styles.menuItemIcon} />
                                <span>Browse</span>
                              </span>
                              <ShortcutHint text={shortcuts.browse} />
                            </div>
                          </DropdownMenuItem>)}

                        {isMenuItemVisible("rename") && (
                          <DropdownMenuItem onSelect={() => handleRename()}>
                            <div className={styles.menuRow}>
                              <span className={styles.menuLeft}>
                                <Pencil className={styles.menuItemIcon} />
                                <span>Annotate</span>
                              </span>
                              <ShortcutHint text={shortcuts.rename} />
                            </div>
                          </DropdownMenuItem>)}

                        {(isMenuItemVisible("open") || isMenuItemVisible("rename") || isMenuItemVisible("rename")) && (
                          <DropdownMenuSeparator />)}

                        {isMenuItemVisible("selectFrom") && (
                          <DropdownMenuItem onSelect={() => handleSelectFrom()}>
                            <div className={styles.menuRow}>
                              <span className={styles.menuLeft}>
                                <FromIcon className={styles.menuItemIcon} />
                                <span>Select from</span>
                              </span>
                              <ShortcutHint text={shortcuts.selectFrom} />
                            </div>
                          </DropdownMenuItem>)}


                        {isMenuItemVisible("selectTo") && (
                          <DropdownMenuItem onSelect={() => handleSelectTo()}>
                            <div className={styles.menuRow}>
                              <span className={styles.menuLeft}>
                                <ToIcon className={styles.menuItemIcon} />
                                <span>Select to</span>
                              </span>
                              <ShortcutHint text={shortcuts.selectTo} />
                            </div>
                          </DropdownMenuItem>)}

                        {(isMenuItemVisible("selectFrom") || isMenuItemVisible("selectTo")) && (
                          <DropdownMenuSeparator />)}

                        {isMenuItemVisible("stop") && (data.status === "running" || data.status === "launched" || data.status === "scheduled") && (
                          <DropdownMenuItem onSelect={() => handleStop()}>
                            <div className={styles.menuRow}>
                              <span className={styles.menuLeft}>
                                <Square className={styles.menuItemIcon} />
                                <span>Stop</span>
                              </span>
                              <ShortcutHint text={shortcuts.stop} />
                            </div>
                          </DropdownMenuItem>
                        )}

                        {isMenuItemVisible("restart") && (
                          <DropdownMenuItem onSelect={() => handleRestartAll()}>
                            <div className={styles.menuRow}>
                              <span className={styles.menuLeft}>
                                <RefreshCw className={styles.menuItemIcon} />
                                <span>Restart all</span>
                              </span>
                              <ShortcutHint text={shortcuts.restartAll} />
                            </div>
                          </DropdownMenuItem>)}

                        {isMenuItemVisible("continue") && (
                          <DropdownMenuItem onSelect={() => handleContinueAll()}>
                            <div className={styles.menuRow}>
                              <span className={styles.menuLeft}>
                                <Play className={styles.menuItemIcon} />
                                <span>Continue all</span>
                              </span>
                              <ShortcutHint text={shortcuts.continueAll} />
                            </div>
                          </DropdownMenuItem>)}

                        {isMenuItemVisible("reset") && (
                          <DropdownMenuItem onSelect={() => handleResetFrom()}>
                            <div className={styles.menuRow}>
                              <span className={styles.menuLeft}>
                                <RotateCcw className={styles.menuItemIcon} />
                                <span>Reset from</span>
                              </span>
                              <ShortcutHint text={shortcuts.resetFrom} />
                            </div>
                          </DropdownMenuItem>)}

                        {(isMenuItemVisible("reset") || isMenuItemVisible("continue") || isMenuItemVisible("restart") || isMenuItemVisible("stop")) && (
                          <DropdownMenuSeparator />)}
                      </>
                    )}

                    {reduceMenus && isMenuItemVisible("stop") && (data.status === "running" || data.status === "launched" || data.status === "scheduled") && (
                      <DropdownMenuItem onSelect={() => handleStop()}>
                        <div className={styles.menuRow}>
                          <span className={styles.menuLeft}>
                            <Square className={styles.menuItemIcon} />
                            <span>Stop selection</span>
                          </span>
                          <ShortcutHint text={shortcuts.stop} />
                        </div>
                      </DropdownMenuItem>
                    )}

                    {isMenuItemVisible("delete") && (
                      <DropdownMenuItem onSelect={() => handleDelete()}>
                        <div className={styles.menuRow}>
                          <span className={styles.menuLeft}>
                            <Trash2 className={styles.menuItemIcon} />
                            <span>Delete</span>
                          </span>
                          <ShortcutHint text={shortcuts.delete} />
                        </div>
                      </DropdownMenuItem>)}

                    {isMenuItemVisible("duplicate") && (
                      <DropdownMenuItem onSelect={() => handleDuplicate()}>
                        <div className={styles.menuRow}>
                          <span className={styles.menuLeft}>
                            <Copy className={styles.menuItemIcon} />
                            <span>Duplicate</span>
                          </span>
                          <ShortcutHint text={shortcuts.duplicate} />
                        </div>
                      </DropdownMenuItem>)}

                    {isMenuItemVisible("copyWorkflow") && onCopyWorkflow && !isProjectNode && (
                      <DropdownMenuItem onSelect={() => handleCopyWorkflow()}>
                        <div className={styles.menuRow}>
                          <span className={styles.menuLeft}>
                            <ClipboardCopy className={styles.menuItemIcon} />
                            <span>Copy workflow</span>
                          </span>
                          <ShortcutHint text={shortcuts.copyWorkflow} />
                        </div>
                      </DropdownMenuItem>
                    )}

                    {isMenuItemVisible("pasteWorkflow") && onPasteWorkflow && (
                      <DropdownMenuItem
                        disabled={!canPasteWorkflow}
                        onSelect={() => handlePasteWorkflow()}
                      >
                        <div className={styles.menuRow}>
                          <span className={styles.menuLeft}>
                            <ClipboardPaste className={styles.menuItemIcon} />
                            <span>Paste workflow</span>
                          </span>
                          <ShortcutHint text={shortcuts.pasteWorkflow} />
                        </div>
                      </DropdownMenuItem>
                    )}

                    {(isMenuItemVisible("delete") ||
                      isMenuItemVisible("duplicate") ||
                      onCopyWorkflow ||
                      onPasteWorkflow) && (
                        <DropdownMenuSeparator />
                      )}

                    {isMenuItemVisible("manageTags") && (
                      <DropdownMenuSub>
                        <DropdownMenuSubTrigger>
                          <div className={styles.menuRow}>
                            <span className={styles.menuLeft}>
                              <Tags className={styles.menuItemIcon} />
                              <span>Tags</span>
                            </span>
                          </div>
                        </DropdownMenuSubTrigger>

                        <DropdownMenuSubContent className={styles.menuContent} sideOffset={8}>
                          <DropdownMenuItem onSelect={() => handleManageTags()}>
                            <div className={styles.menuRow}>
                              <span className={styles.menuLeft}>
                                <Plus className={styles.menuItemIcon} />
                                <span>Add new tag</span>
                              </span>
                            </div>
                          </DropdownMenuItem>


                          <DropdownMenuSeparator />

                          {tagDefs.length > 0 ? (
                            tagDefs.map((tag) => {
                              const isChecked = selectedTagSet.has(String(tag.id));
                              return (
                                <DropdownMenuItem
                                  key={String(tag.id)}
                                  onSelect={(e) => handleToggleTagFromMenu(e, String(tag.id), true)}
                                >
                                  <div className={styles.menuRow}>
                                    <span className={styles.menuLeft}>
                                      <span
                                        style={{
                                          width: 10,
                                          height: 10,
                                          borderRadius: 999,
                                          backgroundColor: tag.color,
                                          border: "1px solid rgba(15,23,42,0.22)",
                                          display: "inline-block",
                                          marginRight: 8,
                                        }}
                                      />
                                      <span>{tag.title}</span>
                                    </span>

                                    <span className={styles.menuRight}>
                                      {isChecked ? (
                                        <Check className={styles.menuCheckIcon} />
                                      ) : (
                                        <span className={styles.menuCheckPlaceholder} />
                                      )}
                                    </span>
                                  </div>
                                </DropdownMenuItem>
                              );
                            })
                          ) : isTagDefsLoading ? (
                            <DropdownMenuItem disabled>
                              <div className={styles.menuRow}>
                                <span className={styles.menuLeft}>
                                  <span>Loading tags...</span>
                                </span>
                              </div>
                            </DropdownMenuItem>
                          ) : (
                            <DropdownMenuItem disabled>
                              <div className={styles.menuRow}>
                                <span className={styles.menuLeft}>
                                  <span>No tags defined</span>
                                </span>
                              </div>
                            </DropdownMenuItem>
                          )}
                        </DropdownMenuSubContent>
                      </DropdownMenuSub>)}

                    {isMenuItemVisible("export") && (
                      <DropdownMenuItem
                        onSelect={(e) => {
                          e.preventDefault();
                          handleExport();
                        }}
                      >
                        <div className={styles.menuRow}>
                          <span className={styles.menuLeft}>
                            <FileUp className={styles.menuItemIcon} />
                            <span>Export</span>
                          </span>
                        </div>
                      </DropdownMenuItem>
                    )}

                    {(isMenuItemVisible("export") || isMenuItemVisible("manageTags")) && (
                      <DropdownMenuSeparator />
                    )}

                    {isMenuItemVisible("nextSteps") && (
                      <DropdownMenuSub
                        onOpenChange={(open) => {
                          // loadNextStepOnOpen
                          if (open) loadNextStepSuggestionsIfNeeded();
                        }}>
                        <DropdownMenuSubTrigger
                          onPointerEnter={() => loadNextStepSuggestionsIfNeeded()}
                          onFocus={() => loadNextStepSuggestionsIfNeeded()}
                          onClick={() => loadNextStepSuggestionsIfNeeded()}
                        >
                          <div className={styles.menuRow}>
                            <span className={styles.menuLeft}>
                              <ArrowRight className={styles.menuItemIcon} />
                              <span>Next step</span>
                            </span>
                          </div>
                        </DropdownMenuSubTrigger>

                        <DropdownMenuSubContent className={styles.subMenuContent}
                          sideOffset={8}
                          onPointerDownOutside={preventMenuDismissWhileHelpOpen}
                          onFocusOutside={preventMenuDismissWhileHelpOpen}
                          onInteractOutside={preventMenuDismissWhileHelpOpen}>
                          {renderNextStepSubContent("dropdown")}
                        </DropdownMenuSubContent>
                      </DropdownMenuSub>
                    )}

                  </DropdownMenuContent>
                </DropdownMenu>

                <button
                  type="button"
                  className={`${styles.iconButton} nodrag`}
                  onPointerDown={(e) => e.stopPropagation()}
                  onMouseDown={(e) => e.stopPropagation()}
                  onClick={(e) => {
                    e.stopPropagation();
                    handleEdit();
                  }}
                  onDoubleClick={(e) => e.stopPropagation()}
                  draggable={false}
                  data-nodrag
                  aria-label="Edit protocol"
                >
                  <Scan className={styles.scanIcon} />
                </button>
              </div>
            )}
          </div>

          {isContentExpanded && selectedTags.length > 0 ? (
            <div className={styles.footerTagsRow} aria-label="Protocol tags">
              <Tags className={styles.tagsRowIcon} aria-hidden="true" />
              <div className={styles.tagsChipsWrap}>
                {selectedTags.map((t) => (
                  <span
                    key={String(t.id)}
                    className={styles.tagChip}
                    title={(t as any)?.description || t.title}
                    style={{ backgroundColor: t.color || "#9ca3af" }}
                  >
                    <span className={styles.tagChipText}>{t.title}</span>
                  </span>
                ))}
              </div>
            </div>
          ) : null}

          {shouldRenderProtocolBody && (
            <div className={contentClassName} style={contentStyle} aria-hidden={!isContentExpanded}>
              <div className={styles.cardContent}>
                <div
                  className={[
                    styles.outputsReserved,
                    thumbnailMode ? styles.outputsReservedThumbs : "",
                  ].filter(Boolean).join(" ")}
                >
                  {hasOutputs ? (
                    <div className={styles.outputsList}>
                      {!thumbnailMode ? (
                        <div className={styles.sectionHeader}>
                          <span className={styles.sectionTitle}>Outputs</span>
                        </div>
                      ) : null}

                      <div
                        className={[
                          styles.sectionContent,
                          shouldUseOutputTiles ? styles.sectionContentThumbs : "",
                          shouldUseOutputTiles ? outputThumbnailLayoutClassName : "",
                        ].filter(Boolean).join(" ")}
                        data-has-scroll
                      >
                        {outputsArray.map((outputObj, idx) => {
                          const value = normalizeOutputItem(outputObj);
                          if (!value) return null;

                          const isDragging = draggingIdx === idx;

                          const labelText = value.info ?? value.name ?? value.pointerClass ?? value.paramClass ?? "Output";
                          const pillKey = value.value ?? `${String(value.parentId ?? "")}:${String(value.name ?? idx)}`;

                          const outputName = String(value.name ?? "");
                          const isViewerEnabled = canOpenViewer && !!outputName;

                          const thumbnail = outputName ? outputThumbnails[outputName] : null;
                          const thumbnailSrc =
                            typeof thumbnail?.thumbnailDataUrl === "string" && thumbnail.thumbnailDataUrl
                              ? thumbnail.thumbnailDataUrl
                              : "";

                          const labelTextValue = String(labelText).trim();
                          const labelMatch = labelTextValue.match(/^(.+?)\s*\((.*)\)\s*$/);

                          const inlineCount = labelTextValue.match(/\b\d+\s+items?\b/i)?.[0] ?? "";
                          const inlineSampling = labelTextValue.match(/\d+(?:\.\d+)?\s*(?:Å|Å|A)\s*\/?\s*px/i)?.[0] ?? "";
                          const inlineSize = labelTextValue.match(/\d+\s*x\s*\d+(?:\s*x\s*\d+)?/i)?.[0] ?? "";

                          const removeInlineDetail = (text: string, detail: string) =>
                            detail ? text.replace(detail, "") : text;

                          const overlayTitle = [
                            inlineCount,
                            inlineSampling,
                            inlineSize,
                          ].reduce(removeInlineDetail, labelMatch?.[1] ?? labelTextValue)
                            .replace(/[(),]+/g, " ")
                            .replace(/\s+/g, " ")
                            .trim() || labelTextValue;

                          const overlayDetails = labelMatch?.[2]
                            ? labelMatch[2].split(",").map((part) => part.trim()).filter(Boolean)
                            : [inlineCount, inlineSize, inlineSampling].filter(Boolean);

                          const rawOverlaySampling = overlayDetails.find((part) =>
                            /\d+(?:\.\d+)?\s*(?:Å|Å|A)\s*\/?\s*px/i.test(part)
                          ) ?? "";

                          const overlaySampling = rawOverlaySampling
                            ? rawOverlaySampling.replace(/\s*(?:Å|Å|A)\s*\/?\s*px/i, " Å/px")
                            : "";

                          const rawOverlayCount = overlayDetails.find((part) => /\b\d+\s+items?\b/i.test(part)) ?? "";
                          const overlayCount = rawOverlayCount.replace(/\b1\s+items\b/i, "1 item");

                          const overlaySize = overlayDetails.find((part) => {
                            if (part === rawOverlaySampling) return false;
                            if (part === rawOverlayCount) return false;
                            return /\d+\s*x\s*\d+/i.test(part);
                          }) ?? "";

                          const overlayTopLeft = overlayTitle;
                          const overlayTopRight = overlaySampling;
                          const overlayBottomLeft = overlaySize;
                          const overlayBottomRight = overlayCount;

                          const buildDragPayload = () => {
                            const inferredParamClass = value.paramClass || (value.pointerClass ? "PointerParam" : "");

                            return {
                              paramClass: inferredParamClass,
                              pointerClass: value.pointerClass ?? "",
                              _expectedClass: value.pointerClass ?? "",
                              value: value.value ?? "",
                              info: value.info ?? "",
                              parentId: value.parentId ?? "",
                              name: value.name ?? "",
                            };
                          };

                          const isMultiSelectionGesture = (e: ReactMouseEvent) =>
                            e.ctrlKey || e.metaKey || e.shiftKey;

                          const handleOutputMouseDown = (e: ReactMouseEvent<HTMLDivElement>) => {
                            if (isMultiSelectionGesture(e)) {
                              e.preventDefault();
                              e.stopPropagation();
                            }
                          };

                          const handleOutputDragStart = (e: ReactDragEvent<HTMLDivElement>) => {
                            e.stopPropagation();
                            setDraggingIdx(idx);

                            const output = buildDragPayload();

                            setCurrentDraggedOutput(output);
                            e.dataTransfer.setData("application/scipion-output", JSON.stringify(output));

                            const ghost = document.createElement("div");
                            ghost.style.position = "absolute";
                            ghost.style.top = "-1000px";
                            ghost.style.left = "-1000px";
                            ghost.style.padding = "6px 12px";
                            ghost.style.background = "white";
                            ghost.style.border = "1px solid #ccc";
                            ghost.style.color = "black";
                            ghost.style.borderRadius = "0.5rem";
                            ghost.innerText = `(${labelText})`;
                            document.body.appendChild(ghost);
                            e.dataTransfer.setDragImage(ghost, 0, 15);
                            setTimeout(() => document.body.removeChild(ghost), 0);
                          };

                          const handleOutputDragEnd = () => {
                            setDraggingIdx(null);
                            setCurrentDraggedOutput(null);
                          };

                          const handleOpenOutput = (e: ReactMouseEvent) => {
                            e.preventDefault();
                            e.stopPropagation();

                            if (isMultiSelectionGesture(e)) {
                              forwardClickToRFNode(e);
                              return;
                            }

                            if (!isViewerEnabled) return;

                            void openOutputViewer(outputName, outputObj, value);
                          };

                          const outputInfoTooltipText = labelTextValue;
                          const shouldShowOutputInfoTooltip =
                            outputInfoTooltipText.length >= 48 ||
                            outputInfoTooltipText.includes("\n") ||
                            (shouldUseOutputTiles && outputInfoTooltipText !== overlayTitle);

                          const outputInfoTooltipProps = shouldShowOutputInfoTooltip
                            ? {
                                title: outputInfoTooltipText,
                                placement: "top" as const,
                                arrow: true,
                                enterDelay: 300,
                                slotProps: {
                                  popper: { sx: { zIndex: 26000 } },
                                  tooltip: {
                                    sx: {
                                      maxWidth: 560,
                                      whiteSpace: "pre-wrap",
                                      wordBreak: "break-word",
                                      fontSize: "0.95rem",
                                      lineHeight: 1.35,
                                    },
                                  },
                                },
                              }
                            : null;

                          if (shouldUseOutputTiles) {
                            const hasThumbnail = Boolean(thumbnailSrc);

                            const outputThumbSizeClassName =
                              outputThumbnailLayoutCount <= 1
                                ? styles.outputThumbTileSingle
                                : outputThumbnailLayoutCount === 2
                                  ? styles.outputThumbTileDouble
                                  : outputThumbnailLayoutCount === 3
                                    ? styles.outputThumbTileTriple
                                    : styles.outputThumbTileMany;

                            const thumbTile = (
                              <div
                                key={pillKey}
                                className={[
                                  styles.outputThumbTile,
                                  outputThumbSizeClassName,
                                  !hasThumbnail ? styles.outputThumbTileMissing : "",
                                  isDragging ? styles.outputPillDragging : "",
                                  "nodrag",
                                ].filter(Boolean).join(" ")}
                                draggable
                                onMouseDown={handleOutputMouseDown}
                                onClick={handleOpenOutput}
                                onDragStart={handleOutputDragStart}
                                onDragEnd={handleOutputDragEnd}
                              >
                                <div className={styles.outputThumbImageWrap}>
                                  <div
                                    className={[
                                      styles.outputThumbImageFrame,
                                      !hasThumbnail ? styles.outputThumbImageFrameEmpty : "",
                                    ].filter(Boolean).join(" ")}
                                  >
                                    {hasThumbnail ? (
                                      <img
                                        src={thumbnailSrc}
                                        alt={labelText}
                                        className={styles.outputThumbImage}
                                        draggable={false}
                                      />
                                    ) : (
                                      <div className={styles.outputThumbPlaceholder}>
                                        No preview
                                      </div>
                                    )}

                                    {overlayTopLeft ? (
                                      <OverflowTooltipText
                                        as="div"
                                        text={overlayTopLeft}
                                        className={`${styles.outputThumbBadge} ${styles.outputThumbBadgeTopLeft}`}
                                      />
                                    ) : null}

                                    {overlayTopRight ? (
                                      <OverflowTooltipText
                                        as="div"
                                        text={overlayTopRight}
                                        className={`${styles.outputThumbBadge} ${styles.outputThumbBadgeTopRight}`}
                                      />
                                    ) : null}

                                    {overlayBottomLeft ? (
                                      <OverflowTooltipText
                                        as="div"
                                        text={overlayBottomLeft}
                                        className={`${styles.outputThumbBadge} ${styles.outputThumbBadgeBottomLeft}`}
                                      />
                                    ) : null}

                                    {overlayBottomRight ? (
                                      <OverflowTooltipText
                                        as="div"
                                        text={overlayBottomRight}
                                        className={`${styles.outputThumbBadge} ${styles.outputThumbBadgeBottomRight}`}
                                      />
                                    ) : null}
                                  </div>
                                </div>
                              </div>
                            );

                            if (!outputInfoTooltipProps) return thumbTile;

                            return (
                              <Tooltip key={pillKey} {...outputInfoTooltipProps}>
                                {thumbTile}
                              </Tooltip>
                            );
                          }

                          return (
                            <div
                              key={pillKey}
                              className={[styles.outputPill, isDragging ? styles.outputPillDragging : "", "nodrag"]
                                .filter(Boolean)
                                .join(" ")}
                              draggable
                              onMouseDown={handleOutputMouseDown}
                              onClick={(e: ReactMouseEvent<HTMLDivElement>) => {
                                e.preventDefault();
                                e.stopPropagation();
                                forwardClickToRFNode(e);
                              }}
                              onDragStart={handleOutputDragStart}
                              onDragEnd={handleOutputDragEnd}
                            >
                              <ArrowUpRight className={styles.outputIcon} />
                              <OverflowTooltipText
                                text={outputInfoTooltipText}
                                className={styles.outputText}
                              />

                              <button
                                type="button"
                                className={`${styles.outputActionBtn} nodrag`}
                                draggable={false}
                                data-nodrag
                                aria-label="View output"
                                title={isViewerEnabled ? "View output" : "Viewer not available"}
                                onPointerDown={(e) => {
                                  // preventDragStartFromViewerButton
                                  e.preventDefault();
                                  e.stopPropagation();
                                }}
                                onMouseDown={(e) => {
                                  // preventDragStartFromViewerButtonMouse
                                  e.preventDefault();
                                  e.stopPropagation();
                                }}
                                onClick={handleOpenOutput}
                                disabled={!isViewerEnabled}
                              >
                                <Eye className={styles.outputEyeIcon} />
                              </button>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ) : (
                    <div className={styles.outputsPlaceholder} aria-hidden="true" />
                  )}
                </div>
              </div>

              {data.status && (
                <div className={styles.footer}>
                  <div className={styles.footerTopRow}>
                    <span
                      className={styles.statusBadge}
                      style={{
                        backgroundColor: statusBadgeColors[data.status] || "#999",
                      }}
                    >
                      {data.status}

                      {showProgressBar && (
                        <span className={styles.progress}>
                          <span className={styles.progressTrack}>
                            <span
                              className={[
                                styles.progressFill,
                                showIndeterminateProgress ? styles.progressFillIndeterminate : "",
                              ]
                                .filter(Boolean)
                                .join(" ")}
                              style={
                                showIndeterminateProgress
                                  ? undefined
                                  : {
                                    width: `${progressPct}%`,
                                  }
                              }
                            />
                          </span>
                          <span className={styles.progressText}>
                            {stepsDone}/{numberOfSteps}
                          </span>
                        </span>
                      )}
                    </span>

                    <span className={styles.timeRow}>
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        className={styles.timeIcon}
                        fill="none"
                        viewBox="0 0 22 24"
                        stroke="currentColor"
                        strokeWidth={2}
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
                        />
                      </svg>
                      <span>{formatCpuTime(data.tick ?? Number(data.elapsedTime) ?? 0)}</span>
                    </span>
                  </div>
                </div>
              )}
            </div>
          )}

          {showHandles && (
            <>
              <Handle
                type="target"
                position={graphDirection === "TB" ? Position.Top : Position.Left}
                style={graphDirection === "TB" ? {} : { top: "50%", transform: "translateY(-50%)" }}
              />
              <Handle
                type="source"
                position={graphDirection === "TB" ? Position.Bottom : Position.Right}
                style={graphDirection === "TB" ? {} : { top: "50%", transform: "translateY(-50%)" }}
              />
            </>
          )}
        </div>
      </ContextMenuTrigger>

      <ContextMenuContent
        className={styles.menuContent}
        style={{ marginLeft: 8, marginTop: 8 }}
        onPointerDownOutside={preventMenuDismissWhileHelpOpen}
        onFocusOutside={preventMenuDismissWhileHelpOpen}
        onInteractOutside={preventMenuDismissWhileHelpOpen}
        onPointerDown={(e) => e.stopPropagation()}
        onPointerUp={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}
      >
        {!reduceMenus && (
          <>
            {isMenuItemVisible("open") && (
              <ContextMenuItem onClick={handleEdit}>
                <div className={styles.menuRow}>
                  <span className={styles.menuLeft}>
                    <Scan className={styles.menuItemIcon} />
                    <span>Open</span>
                  </span>
                  <ShortcutHint text={shortcuts.edit} />
                </div>
              </ContextMenuItem>)}

            {isMenuItemVisible("browse") && (
              <ContextMenuItem onClick={handleBrowse}>
                <div className={styles.menuRow}>
                  <span className={styles.menuLeft}>
                    <FolderOpen className={styles.menuItemIcon} />
                    <span>Browse</span>
                  </span>
                  <ShortcutHint text={shortcuts.browse} />
                </div>
              </ContextMenuItem>)}

            {isMenuItemVisible("rename") && (
              <ContextMenuItem onClick={handleRename}>
                <div className={styles.menuRow}>
                  <span className={styles.menuLeft}>
                    <Pencil className={styles.menuItemIcon} />
                    <span>Annotate</span>
                  </span>
                  <ShortcutHint text={shortcuts.rename} />
                </div>
              </ContextMenuItem>)}

            {(isMenuItemVisible("rename") || isMenuItemVisible("browse") || isMenuItemVisible("open")) && (
              <ContextMenuSeparator />)}


            {isMenuItemVisible("selectFrom") && (
              <ContextMenuItem onClick={handleSelectFrom}>
                <div className={styles.menuRow}>
                  <span className={styles.menuLeft}>
                    <FromIcon className={styles.menuItemIcon} />
                    <span>Select from</span>
                  </span>
                  <ShortcutHint text={shortcuts.selectFrom} />
                </div>
              </ContextMenuItem>)}

            {isMenuItemVisible("selectTo") && (
              <ContextMenuItem onClick={handleSelectTo}>
                <div className={styles.menuRow}>
                  <span className={styles.menuLeft}>
                    <ToIcon className={styles.menuItemIcon} />
                    <span>Select to</span>
                  </span>
                  <ShortcutHint text={shortcuts.selectTo} />
                </div>
              </ContextMenuItem>)}


            {(isMenuItemVisible("selectTo") || isMenuItemVisible("selectFrom")) && (
              <ContextMenuSeparator />)}

            {isMenuItemVisible("selectTo") && (data.status === "running" || data.status === "launched" || data.status === "scheduled") && (
              <ContextMenuItem onClick={handleStop}>
                <div className={styles.menuRow}>
                  <span className={styles.menuLeft}>
                    <Square className={styles.menuItemIcon} />
                    <span>Stop</span>
                  </span>
                  <ShortcutHint text={shortcuts.stop} />
                </div>
              </ContextMenuItem>
            )}

            {isMenuItemVisible("restart") && (
              <ContextMenuItem onClick={handleRestartAll}>
                <div className={styles.menuRow}>
                  <span className={styles.menuLeft}>
                    <RefreshCw className={styles.menuItemIcon} />
                    <span>Restart all</span>
                  </span>
                  <ShortcutHint text={shortcuts.restartAll} />
                </div>
              </ContextMenuItem>)}

            {isMenuItemVisible("continue") && (
              <ContextMenuItem onClick={handleContinueAll}>
                <div className={styles.menuRow}>
                  <span className={styles.menuLeft}>
                    <Play className={styles.menuItemIcon} />
                    <span>Continue all</span>
                  </span>
                  <ShortcutHint text={shortcuts.continueAll} />
                </div>
              </ContextMenuItem>)}

            {isMenuItemVisible("reset") && (
              <ContextMenuItem onClick={handleResetFrom}>
                <div className={styles.menuRow}>
                  <span className={styles.menuLeft}>
                    <RotateCcw className={styles.menuItemIcon} />
                    <span>Reset from</span>
                  </span>
                  <ShortcutHint text={shortcuts.resetFrom} />
                </div>
              </ContextMenuItem>)}

            {(isMenuItemVisible("reset") || isMenuItemVisible("continue")) && (
              <ContextMenuSeparator />)}
          </>
        )}

        {reduceMenus && isMenuItemVisible("stop") && (data.status === "running" || data.status === "launched" || data.status === "scheduled") && (
          <ContextMenuItem onClick={handleStop}>
            <div className={styles.menuRow}>
              <span className={styles.menuLeft}>
                <Square className={styles.menuItemIcon} />
                <span>Stop selection</span>
              </span>
              <ShortcutHint text={shortcuts.stop} />
            </div>
          </ContextMenuItem>
        )}

        {isMenuItemVisible("delete") && (
          <ContextMenuItem onClick={handleDelete}>
            <div className={styles.menuRow}>
              <span className={styles.menuLeft}>
                <Trash2 className={styles.menuItemIcon} />
                <span>Delete</span>
              </span>
              <ShortcutHint text={shortcuts.delete} />
            </div>
          </ContextMenuItem>)}

        {isMenuItemVisible("duplicate") && (
          <ContextMenuItem onClick={handleDuplicate}>
            <div className={styles.menuRow}>
              <span className={styles.menuLeft}>
                <Copy className={styles.menuItemIcon} />
                <span>Duplicate</span>
              </span>
              <ShortcutHint text={shortcuts.duplicate} />
            </div>
          </ContextMenuItem>)}

        {isMenuItemVisible("copyWorkflow") && onCopyWorkflow && !isProjectNode && (
          <ContextMenuItem onClick={handleCopyWorkflow}>
            <div className={styles.menuRow}>
              <span className={styles.menuLeft}>
                <ClipboardCopy className={styles.menuItemIcon} />
                <span>Copy workflow</span>
              </span>
              <ShortcutHint text={shortcuts.copyWorkflow} />
            </div>
          </ContextMenuItem>
        )}

        {isMenuItemVisible("pasteWorkflow") && onPasteWorkflow && (
          <ContextMenuItem
            disabled={!canPasteWorkflow}
            onClick={handlePasteWorkflow}
          >
            <div className={styles.menuRow}>
              <span className={styles.menuLeft}>
                <ClipboardPaste className={styles.menuItemIcon} />
                <span>Paste workflow</span>
              </span>
              <ShortcutHint text={shortcuts.pasteWorkflow} />
            </div>
          </ContextMenuItem>
        )}

        {(isMenuItemVisible("delete") ||
          isMenuItemVisible("duplicate") ||
          onCopyWorkflow ||
          onPasteWorkflow) && (
            <ContextMenuSeparator />
          )}

        {isMenuItemVisible("manageTags") && (
          <ContextMenuSub>
            <ContextMenuSubTrigger>
              <div className={styles.menuRow}>
                <span className={styles.menuLeft}>
                  <Tags className={styles.menuItemIcon} />
                  <span>Tags</span>
                </span>
              </div>
            </ContextMenuSubTrigger>

            <ContextMenuSubContent className={styles.menuContent} sideOffset={8}>
              <ContextMenuItem
                onClick={(e) => {
                  e.stopPropagation();
                  handleManageTags();
                }}
              >
                <div className={styles.menuRow}>
                  <span className={styles.menuLeft}>
                    <Plus className={styles.menuItemIcon} />
                    <span>Add new tag</span>
                  </span>
                </div>
              </ContextMenuItem>

              <ContextMenuSeparator />

              {tagDefs.length > 0 ? (
                tagDefs.map((tag) => {
                  const isChecked = selectedTagSet.has(String(tag.id));
                  return (
                    <ContextMenuItem
                      key={String(tag.id)}
                      onSelect={(e: any) => handleToggleTagFromMenu(e as Event, String(tag.id), true)}
                    >
                      <div className={styles.menuRow}>
                        <span className={styles.menuLeft}>
                          <span
                            style={{
                              width: 10,
                              height: 10,
                              borderRadius: 999,
                              backgroundColor: tag.color,
                              border: "1px solid rgba(15,23,42,0.22)",
                              display: "inline-block",
                              marginRight: 8,
                            }}
                          />
                          <span>{tag.title}</span>
                        </span>

                        <span className={styles.menuRight}>
                          {isChecked ? <Check className={styles.menuCheckIcon} /> : <span className={styles.menuCheckPlaceholder} />}
                        </span>
                      </div>
                    </ContextMenuItem>
                  );
                })
              ) : isTagDefsLoading ? (
                <ContextMenuItem disabled>
                  <div className={styles.menuRow}>
                    <span className={styles.menuLeft}>
                      <span>Loading tags...</span>
                    </span>
                  </div>
                </ContextMenuItem>
              ) : (
                <ContextMenuItem disabled>
                  <div className={styles.menuRow}>
                    <span className={styles.menuLeft}>
                      <span>No tags defined</span>
                    </span>
                  </div>
                </ContextMenuItem>
              )}
            </ContextMenuSubContent>
          </ContextMenuSub>)}

        {isMenuItemVisible("export") && (
          <ContextMenuItem onClick={handleExport}>
            <div className={styles.menuRow}>
              <span className={styles.menuLeft}>
                <FileUp className={styles.menuItemIcon} />
                <span>Export</span>
              </span>
            </div>
          </ContextMenuItem>
        )}

        {isMenuItemVisible("export") && <ContextMenuSeparator />}

        {isMenuItemVisible("nextSteps") && (
          <ContextMenuSub
            onOpenChange={(open) => {
              // loadNextStepOnOpen
              if (open) loadNextStepSuggestionsIfNeeded();
            }}>
            <ContextMenuSubTrigger
              onPointerEnter={() => loadNextStepSuggestionsIfNeeded()}
              onFocus={() => loadNextStepSuggestionsIfNeeded()}
              onClick={() => loadNextStepSuggestionsIfNeeded()}
            >
              <div className={styles.menuRow}>
                <span className={styles.menuLeft}>
                  <ArrowRight className={styles.menuItemIcon} />
                  <span>Next step</span>
                </span>
              </div>
            </ContextMenuSubTrigger>

            <ContextMenuSubContent className={styles.subMenuContent}
              sideOffset={8}
              onPointerDownOutside={preventMenuDismissWhileHelpOpen}
              onFocusOutside={preventMenuDismissWhileHelpOpen}
              onInteractOutside={preventMenuDismissWhileHelpOpen}>
              {renderNextStepSubContent("context")}
            </ContextMenuSubContent>
          </ContextMenuSub>)}


      </ContextMenuContent>

      {canOpenViewer && analyzeOpen && analyzeTarget ? (
        <AnalyzeOutputDialog
          open
          onClose={() => {
            // closeAnalyzeDialog
            setAnalyzeOpen(false);
            setAnalyzeTarget(null);
          }}
          projectId={analyzeProjectId}
          protocolId={analyzeProtocolId}
          protocolLabel={headerDisplayName}
          outputName={analyzeTarget.outputName}
          outputRaw={analyzeTarget.outputRaw}
        />
      ) : null}

      {tableViewerState ? (
        <TableViewerDialog
          open
          onClose={() => setTableViewerState(null)}
          context={tableViewerState.context}
          table={tableViewerState.table}
          title={tableViewerState.title}
          protocolLabel={headerDisplayName}
        />
      ) : null}

      {nextStepHelpOpen && nextStepHelpTarget ? (
        <Dialog
          open
          onClose={closeNextStepHelp}
          maxWidth="sm"
          fullWidth
          disableEnforceFocus
          disableAutoFocus
          disableRestoreFocus
          PaperProps={{
            sx: {
              borderRadius: 4, // 16px
              overflow: "hidden",
              border: "1px solid",
              borderColor: "divider",
              boxShadow: "0 18px 50px rgba(0,0,0,0.35)",
            },
          }}
          BackdropProps={{ sx: { backgroundColor: "transparent" } }}
          sx={{
            zIndex: 25000,
            "& .MuiDialog-container": {
              alignItems: "flex-start",
              paddingTop: "16px",

            },
          }}
        >
          <DialogTitle
            sx={{
              display: "flex",
              alignItems: "center",
              backgroundColor: "#333d49",
              color: "white",
              px: 2,
              py: 1.5,
              boxSizing: "border-box",
              m: 0,
              gap: 1,
            }}
          >
            <div className={styles.helpDialogTitleText}>{nextStepHelpTarget.protocolName}</div>

            <IconButton
              onClick={closeNextStepHelp}
              aria-label="Close"
              size="small"
              sx={{
                ml: "auto",
                color: "white",
                borderRadius: 1,
                "&:hover": { backgroundColor: "rgba(255,255,255,0.10)" },
                "&:focus-visible": { outline: "2px solid rgba(255,255,255,0.55)", outlineOffset: 2 },
              }}
            >
              <CloseIcon fontSize="small" />
            </IconButton>
          </DialogTitle>


          <DialogContent className={styles.helpDialogContent} dividers>
            {(() => {
              return (
                <>
                  {renderHelpBody(nextStepHelpTarget.help ?? "", styles.helpLink)}
                </>
              );
            })()}
          </DialogContent>

          <DialogActions className={styles.helpDialogActions}>
            <Button
              variant="contained"
              onClick={() => {
                // openSuggestedProtocolFromHelp
                openSuggestedProtocolClass(nextStepHelpTarget);
              }}
              disabled={String(nextStepHelpTarget.installed ?? "installed").trim() !== "installed"}
              sx={{
                textTransform: "none",
                px: 3,
                borderRadius: 2,
                fontWeight: "bold",
                boxShadow: "none",

              }}
            >
              Open
            </Button>

            <Button onClick={closeNextStepHelp} variant="outlined" sx={{
              textTransform: "none",
              px: 3,
              borderRadius: 2,
              fontWeight: "bold",
              boxShadow: "none",
              "&:hover": {
                backgroundColor: "#f3ecec",
              },
            }}>
              Close
            </Button>
          </DialogActions>
        </Dialog>
      ) : null}

      {exportBrowserOpen ? (
        <RemoteFileDialog
          open
          onClose={handleCloseExportBrowser}
          title="Export protocols"
          projectId={-1}
          protocolId={-1}
          mode="save"
          defaultFilename={exportDefaultFilename}
          filenameLabel="Export file name"
          confirmLabel={exportBusy ? "Saving..." : "Save"}
          closeOnPick={false}
          busy={exportBusy}
          resolveBrowserPaths={resolveExportBrowserPaths}
          listRemoteDirectory={listExportRemoteDirectory}
          previewRemoteEntry={previewExportRemoteEntry}
          buildDownloadUrl={buildExportDownloadUrl}
          onPick={handlePickExportTarget}
        />
      ) : null}

    </ContextMenu>
  );
}
