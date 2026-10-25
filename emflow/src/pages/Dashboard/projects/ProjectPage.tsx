import "./ProjectPage.css";
import { APP_VERSION, formatWidgetBuildTimestamp, hasWidgetBuildInfo, WIDGET_BUILD_TIMESTAMP } from "@/buildInfo";
import { useTheme } from "@/context/ThemeContext";
import { PORTAL_ROOT_ID, ROOT_CLASS } from "@/widget/constants";
import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
  JSX
} from "react";

import ProtocolForm from "@/components/protocol/ProtocolForm";
import ProtocolStepsDeveloperDialog from "@/components/protocol/ProtocolStepsDeveloperDialog";
import { buildGraphElements, getGraphTopologySignature } from "@/utils/graph_utils";

import ReactFlow, {
  Background,
  ReactFlowProvider,
  useNodesState,
  useEdgesState,
  Edge,
  applyNodeChanges,
  NodeChange,
  Node,
  ReactFlowInstance,
  MarkerType,
  MiniMap,
} from "reactflow";
import "reactflow/dist/style.css";
import { createStatusNodeWrapper } from "@/components/protocol/ProtocolNodeCardWrapper";
import { ProtocolsDrawer } from "@/components/protocol/ProtocolsDrawer";
import { ProjectWorkflowsPanel, ProjectWorkflow } from "@/components/projects/workflows-panel";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog/dialog";

import { Button } from "@/components/ui/button";

import {
  MinusIcon,
  PlusIcon,
  RefreshCw,
  XCircle,
  LayoutGrid,
  MapIcon,
  FocusIcon,
  TagsIcon,
  AlertTriangle,
  Trash2,
  Play,
  Square,
  ClipboardPaste,
  CheckSquare,
  Info,
} from "lucide-react";
import { FitViewIcon, TableIcon, TreeIcon } from "@/icons";

import { useProjectService } from "@/ProjectServiceContext";
import {
  hasProjectEffectiveSettingsService,
  type ProjectEffectiveSettings,
  type ProtocolOutputThumbnailItem,
  type ProtocolRuntimeSummary,
} from "@/services/ProjectService";
import {
  DEFAULT_PROJECT_USER_SETTINGS,
  DEFAULT_PROJECT_INSTANCE_SETTINGS,
  type ProjectUserSettings,
} from "@/config/settingsDefaults";
import { Project } from "@/types/project";
import Label from "@/components/form/Label";
import { Typography, Link } from "@mui/material";
import toast from "react-hot-toast";
import RemoteFileDialog from "@/components/files/RemoteFileDialog";
import type { ExternalAnalyzeViewerService } from "@/components/protocol/ProtocolNodeCard";

import TagPicker from "@/components/tags/TagPicker";
import TagManager from "@/components/tags/TagManager";
import type { ProtocolTag } from "@/components/tags/tagTypes";
import TagsDialog from "@/components/tags/TagsDialog";
import { NodeMenuVisibility } from "@/types/protocol-node-menu-items";


/* --------------------- Types --------------------- */
interface StatusNodeData {
  label: string;
  title: string;
  runName: string;
  comment: string;
  status?: string;
  id: string;

  // Used by ProtocolNodeCard
  projectId?: string | number;
  outputs?: unknown[];
  inputs?: unknown[];
  outputThumbnails?: Record<string, ProtocolOutputThumbnailItem>;

  // Progress/timing
  cpuTime?: string;
  elapsedTime?: string;

  elapsedSessionId?:
  | string
  | null;

  tick?: number;
  numberOfSteps?: number;
  stepsDone?: number;

  // Selection/path
  parents?: string[];
  children?: string[];
  __pathVer?: number;

  // Optional color cache
  color?: string;
  tagIds?: string[];
}

const ELAPSED_TIMER_STATUSES = new Set([
  "launched",
  "running",
]);

function normalizeProtocolStatus(
  status: unknown,
): string {
  return String(status ?? "")
    .trim()
    .toLowerCase();
}

const LIVE_PROTOCOL_STATUSES =
  new Set([
    "scheduled",
    "launched",
    "running",
  ]);


function isLiveProtocolStatus(
  status: unknown,
): boolean {
  return (
    LIVE_PROTOCOL_STATUSES
      .has(
        normalizeProtocolStatus(
          status
        )
      )
  );
}

function isElapsedTimerStatus(
  status: unknown,
): boolean {
  return ELAPSED_TIMER_STATUSES.has(
    normalizeProtocolStatus(status),
  );
}

function normalizeElapsedSessionId(
  value: unknown,
): string {
  return String(
    value ?? ""
  ).trim();
}

function mergeNodeOutputs(
  freshNode: Node<StatusNodeData>,
  currentNode?: Node<StatusNodeData>,
): Node<StatusNodeData> {
  const freshOutputs = Array.isArray(freshNode.data?.outputs)
    ? freshNode.data.outputs
    : [];
  const currentOutputs = Array.isArray(currentNode?.data?.outputs)
    ? currentNode.data.outputs
    : [];

  if (!isLiveProtocolStatus(freshNode.data?.status)) {
    return freshNode;
  }

  if (!currentOutputs.length) {
    return freshNode;
  }

  if (freshOutputs.length >= currentOutputs.length) {
    return freshNode;
  }

  return {
    ...freshNode,
    data: {
      ...freshNode.data,
      outputs: currentOutputs,
    },
  };
}

function continuesElapsedTimerSession(
  previousStatus: unknown,
  nextStatus: unknown,
  previousSessionId?: unknown,
  nextSessionId?: unknown,
): boolean {
  const previous =
    normalizeProtocolStatus(
      previousStatus
    );

  const next =
    normalizeProtocolStatus(
      nextStatus
    );

  const statusContinues =
    (
      previous === "launched"
      &&
      (
        next === "launched"
        ||
        next === "running"
      )
    )
    ||
    (
      previous === "running"
      &&
      next === "running"
    );

  if (!statusContinues) {
    return false;
  }

  const nextSession =
    normalizeElapsedSessionId(
      nextSessionId
    );

  // Backward compatibility with hosts
  // that do not expose elapsedSessionId.
  if (!nextSession) {
    return true;
  }

  const previousSession =
    normalizeElapsedSessionId(
      previousSessionId
    );

  return (
    previousSession
    === nextSession
  );
}

function toElapsedSeconds(value: unknown): number {
  const seconds = Number(value);
  return Number.isFinite(seconds) && seconds >= 0 ? seconds : 0;
}

function mergeNodeElapsedTick(
  freshNode: Node<StatusNodeData>,
  currentNode?: Node<StatusNodeData>,
): Node<StatusNodeData> {
  const freshStatus =
    freshNode.data?.status;

  const backendElapsed = toElapsedSeconds(
    freshNode.data?.elapsedTime,
  );

  const nextData = {
    ...freshNode.data,
  };

  if (!isElapsedTimerStatus(freshStatus)) {
    delete nextData.tick;

    return {
      ...freshNode,
      data: nextData,
    };
  }

  const continuesActiveSession =
    continuesElapsedTimerSession(
      currentNode?.data?.status,
      freshStatus,
      currentNode
        ?.data
        ?.elapsedSessionId,
      freshNode
        .data
        ?.elapsedSessionId,
    );

  const currentElapsed = toElapsedSeconds(
    currentNode?.data?.tick ??
    currentNode?.data?.elapsedTime,
  );

  return {
    ...freshNode,
    data: {
      ...nextData,
      tick: continuesActiveSession
        ? Math.max(
          currentElapsed,
          backendElapsed,
        )
        : backendElapsed,
    },
  };
}

function mergeTableElapsedTick(
  freshRow: any,
  currentRow?: any,
  currentNode?: Node<StatusNodeData>,
): any {
  const backendElapsed = toElapsedSeconds(
    freshRow?.elapsedTime,
  );

  if (
    !isElapsedTimerStatus(
      freshRow?.status,
    )
  ) {
    const nextRow = {
      ...freshRow,
    };

    delete nextRow.tick;

    return nextRow;
  }

  const currentRowContinues =
    continuesElapsedTimerSession(
      currentRow?.status,
      freshRow?.status,
      currentRow?.elapsedSessionId,
      freshRow?.elapsedSessionId,
    );

  const currentNodeContinues =
    continuesElapsedTimerSession(
      currentNode?.data?.status,
      freshRow?.status,
      currentNode
        ?.data
        ?.elapsedSessionId,
      freshRow?.elapsedSessionId,
    );

  const currentElapsed = Math.max(
    currentRowContinues
      ? toElapsedSeconds(
        currentRow?.tick ??
        currentRow?.elapsedTime,
      )
      : 0,

    currentNodeContinues
      ? toElapsedSeconds(
        currentNode?.data?.tick ??
        currentNode?.data?.elapsedTime,
      )
      : 0,
  );

  const continuesActiveSession =
    currentRowContinues ||
    currentNodeContinues;

  return {
    ...freshRow,
    tick: continuesActiveSession
      ? Math.max(
        currentElapsed,
        backendElapsed,
      )
      : backendElapsed,
  };
}

interface ContextMenuState {
  visible: boolean;
  x: number; // pane-relative
  y: number; // pane-relative
  nodeId?: string | null;
}

type NodeActions = {
  onEdit?: (id: string) => void;
  onRename?: (id: string) => void;
  onDuplicate?: (id: string) => void;
  onDelete?: (id: string) => void;
  onCopyWorkflow?: (id: string) => void;
  onPasteWorkflow?: (id: string) => void;
  canPasteWorkflow?: boolean;
  onRestartAll?: (id: string) => void;
  onContinueAll?: (id: string) => void;
  onResetFrom?: (id: string) => void;
  onSelectFrom?: (id: string) => void;
  onSelectTo?: (id: string) => void;
  onStop?: (id: string) => void;
  onManageTags?: () => void;
  onOpenProtocolClass?: (protocolClass: string) => void;
};

type OpenForm = { key: string; id: string; details: any; isClosing?: boolean };

function getProtocolFormStatus(details: any): string {
  const candidates = [
    details?.info?.status,
    details?.form?.status,
    details?.status,
  ];

  for (const candidate of candidates) {
    const value = String(candidate ?? "").trim().toLowerCase();
    if (value) return value;
  }

  return "";
}

function shouldRefreshProtocolForm(
  details: any
): boolean {
  const status =
    getProtocolFormStatus(details);

  return (
    status === "launched" ||
    status === "running" ||
    status === "scheduled"
  );
}

function mergeLiveProtocolFormDetails(currentDetails: any, freshDetails: any): any {
  if (!currentDetails || typeof currentDetails !== "object") return freshDetails;
  if (!freshDetails || typeof freshDetails !== "object") return currentDetails;

  const currentInfo = currentDetails.info ?? {};
  const freshInfo = freshDetails.info ?? {};

  const currentForm = currentDetails.form ?? {};
  const freshForm = freshDetails.form ?? {};

  return {
    ...currentDetails,
    ...freshDetails,

    info: {
      ...currentInfo,
      ...freshInfo,
    },

    form: {
      ...currentForm,
      ...freshForm,

      // Keep the form definition stable while the user is editing.
      sections: currentForm.sections ?? freshForm.sections,
      definition: currentForm.definition ?? freshForm.definition,

      // Do not overwrite editable values while the form is open.
      values: currentForm.values ?? freshForm.values,
    },

    // Same protection if values are at the root level.
    values: currentDetails.values ?? freshDetails.values,
  };
}

type SearchResult = { id: string; label: string; status?: string };

type ProtocolHelpState = {
  open: boolean;
  title: string;
  text: string;
  loading: boolean;
  error: string | null;
};

type WorkflowClipboardState = {
  sourceProjectId: string | number;
  sourceProjectName?: string;
  protocolIds: string[];
  workflow: unknown;
  copiedAt: string;
};

let workflowClipboardMemory: WorkflowClipboardState | null = null;

function buildPreferredTbChildOrderFromGraph(sourceNodes: Node[], sourceEdges: Edge[]): Record<string, string[]> {
  const xById = new Map<string, number>();

  for (const node of sourceNodes) {
    const id = String(node.id);
    const x = node.position?.x;

    if (typeof x === "number" && Number.isFinite(x)) {
      xById.set(id, x);
    }
  }

  const childrenByParent: Record<string, string[]> = {};

  for (const edge of sourceEdges) {
    const parentId = String(edge.source);
    const childId = String(edge.target);

    if (!xById.has(childId)) continue;

    if (!childrenByParent[parentId]) {
      childrenByParent[parentId] = [];
    }

    if (!childrenByParent[parentId].includes(childId)) {
      childrenByParent[parentId].push(childId);
    }
  }

  const compareIds = (a: string, b: string): number => {
    const numericA = Number(a);
    const numericB = Number(b);

    if (Number.isFinite(numericA) && Number.isFinite(numericB) && numericA !== numericB) {
      return numericA - numericB;
    }

    return a.localeCompare(b, undefined, { numeric: true });
  };

  for (const parentId of Object.keys(childrenByParent)) {
    childrenByParent[parentId].sort((a, b) => {
      const xA = xById.get(a) ?? 0;
      const xB = xById.get(b) ?? 0;

      if (xA !== xB) return xA - xB;
      return compareIds(a, b);
    });
  }

  return childrenByParent;
}


function normalizeHelpText(raw: unknown): string {
  // normalizeHelpText
  return String(raw ?? "").replace(/\\n/g, "\n");
}

function sanitizeHref(rawUrl: string): string {
  // sanitizeHref
  let hrefToken = String(rawUrl ?? "").trim();
  while (/[.,;:!?)]$/.test(hrefToken)) hrefToken = hrefToken.slice(0, -1);
  if (!hrefToken) return "";
  if (hrefToken.startsWith("http://") || hrefToken.startsWith("https://")) return hrefToken;
  return `https://${hrefToken}`;
}

function parseOrgLinkToken(token: string): { href: string; label: string } | null {
  // parseOrgLinkToken
  const orgRegex = /^\[\[([^\]]+)\](?:\[([^\]]+)\])?\]$/;
  const match = orgRegex.exec(token);
  if (!match) return null;

  const rawUrl = match[1] ?? "";
  const rawLabel = match[2];

  const href = sanitizeHref(rawUrl);
  if (!href) return null;

  return { href, label: String(rawLabel ?? rawUrl) };
}

function extractHelpText(payload: unknown): string | null {
  // extractHelpText
  if (payload == null) return null;
  if (typeof payload === "string") return payload;

  if (typeof payload === "object") {
    const obj = payload as Record<string, unknown>;

    const directCandidates = [
      obj.help,
      obj.helpText,
      obj.doc,
      obj.documentation,
      obj.description,
      obj._help,
      obj._doc,
    ];

    for (const v of directCandidates) {
      if (typeof v === "string" && v.trim().length > 0) return v;
    }

    // backendShapeSupport: { form: { help: "..." } }
    const nestedCandidates = [obj.form, obj.protocol, obj.data, obj.result, obj.payload];

    for (const nested of nestedCandidates) {
      const found = extractHelpText(nested);
      if (found) return found;
    }
  }

  return null;
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

function renderBoldInline(text: string, keyPrefix: string): Array<JSX.Element | string> {
  // renderBoldInline
  const parts: Array<JSX.Element | string> = [];
  const boldRegex = /\*[^*]+\*/g;

  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let segIndex = 0;

  while ((match = boldRegex.exec(text)) !== null) {
    const token = match[0];
    const start = match.index;

    if (start > lastIndex) {
      parts.push(text.slice(lastIndex, start));
    }

    const boldText = token.slice(1, -1);
    parts.push(<strong key={`${keyPrefix}-b-${segIndex++}`}>{boldText}</strong>);

    lastIndex = boldRegex.lastIndex;
  }

  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex));
  }

  return parts;
}

function renderHelpText(helpText: string): JSX.Element {
  // renderHelpText
  const normalized = normalizeHelpText(helpText);
  const lines = normalized.split("\n");

  const tokenPattern =
    /(\[\[[^\]]+\](?:\[[^\]]+\])?\]|\*[^*]+\*|https?:\/\/[^\s<>()]+|www\.[^\s<>()]+)/g;

  const renderLine = (line: string, lineIndex: number) => {
    // renderLine
    const parts: JSX.Element[] = [];
    let lastIndex = 0;
    let match: RegExpExecArray | null;
    let keyIndex = 0;

    const tokenRegex = new RegExp(tokenPattern.source, "g");

    while ((match = tokenRegex.exec(line)) !== null) {
      const token = match[0];
      const start = match.index;

      if (start > lastIndex) {
        const text = line.slice(lastIndex, start);
        parts.push(<span key={`t-${lineIndex}-${keyIndex++}`}>{text}</span>);
      }

      if (token.startsWith("[[")) {
        const orgLink = parseOrgLinkToken(token);

        if (orgLink) {
          const linkKey = `ol-${lineIndex}-${keyIndex++}`;
          parts.push(
            <Link
              key={linkKey}
              href={orgLink.href}
              target="_blank"
              rel="noopener noreferrer"
              underline="hover"
              sx={{ wordBreak: "break-word", fontWeight: 600 }}
            >
              {renderBoldInline(orgLink.label, linkKey)}
            </Link>
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
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              underline="hover"
              sx={{ wordBreak: "break-word" }}
            >
              {display}
            </Link>
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

  return (
    <Typography
      variant="body2"
      component="div"
      sx={{
        lineHeight: 1.6,
        mt: 2,
        whiteSpace: "normal",
        wordBreak: "break-word",
      }}
    >
      {lines.map((line, i) => (
        <span key={`hl-${i}`}>
          {renderLine(line, i)}
          {i < lines.length - 1 ? <br /> : null}
        </span>
      ))}
    </Typography>
  );
}


// Tags (backend-driven; no localStorage)

type ProtocolTagAssignments = Record<string, string[]>;

function normalizeTagIds(raw: unknown): string[] {
  // normalizeTagIds
  if (!raw) return [];
  const arr = Array.isArray(raw) ? raw : [raw];

  const ids = arr
    .map((x) => {
      if (typeof x === "string") return x;
      if (x && typeof x === "object" && typeof (x as any).id === "string") return String((x as any).id);
      return "";
    })
    .map((s) => s.trim())
    .filter(Boolean);

  return Array.from(new Set(ids));
}

/** Try to read tag assignments from backend project payload if present.
+ * Accepts shapes like protocol.tagIds, protocol.tags (string[] or {id}[]), protocol.tag_ids.
+ */

/** * Try to read tag assignments from backend project payload if present. * Accepts shapes like protocol.tagIds, protocol.tags (string[] or {id}[]). */
function pickFirstNonEmptyTagIds(...candidates: unknown[]): string[] {
  // pickFirstNonEmptyTagIds 
  for (const c of candidates) {
    const ids = normalizeTagIds(c);
    if (ids.length) return ids;
  }
  return [];
}

function normalizeTagColor(raw: unknown): string {
  // normalizeTagColor
  const s = String(raw ?? "").trim();
  if (!s) return "#9ca3af";
  if (/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(s)) return s;
  return "#9ca3af";
}

function getReadableTextColor(hexColor: string): string {
  // getReadableTextColor
  const hex = String(hexColor ?? "").trim();
  const m = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.exec(hex);
  if (!m) return "#111827";

  const raw = m[1];
  const full = raw.length === 3 ? raw.split("").map((c) => c + c).join("") : raw;
  const r = Number.parseInt(full.slice(0, 2), 16);
  const g = Number.parseInt(full.slice(2, 4), 16);
  const b = Number.parseInt(full.slice(4, 6), 16);
  if (![r, g, b].every((v) => Number.isFinite(v))) return "#111827";

  const luminance = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  return luminance > 0.62 ? "#111827" : "#f9fafb";
}

const getProtocolRowDisplayName = (row: any) => {
  const runName = String(row?.runName ?? "").trim();
  if (runName) return runName;

  const label = String(row?.label ?? "").trim();
  if (label) return label;

  return String(row?.id ?? "");
};


const PROTOCOL_OUTPUT_THUMBNAIL_SIZE = 128;

function getOutputNameFromNodeOutput(output: unknown): string {
  if (!output || typeof output !== "object") return "";

  const obj = output as Record<string, unknown>;

  const directName = obj.outputName ?? obj.name;
  if (typeof directName === "string" && directName.trim()) {
    return directName.trim();
  }

  const entries = Object.entries(obj);
  if (entries.length === 1) {
    const [wrappedName, wrappedValue] = entries[0];
    if (wrappedValue && typeof wrappedValue === "object") {
      return String(wrappedName ?? "").trim();
    }
  }

  return "";
}

function getOutputThumbnailCacheKey(
  projectId: string | number,
  protocolId: string | number,
  outputName: string,
  size: number,
): string {
  return [
    String(projectId),
    String(protocolId),
    String(outputName),
    `size=${size}`,
  ].join("|");
}

function mergeOutputThumbnailsIntoNodes(
  nodes: Node<StatusNodeData>[],
  items: ProtocolOutputThumbnailItem[],
): Node<StatusNodeData>[] {
  if (!items.length) return nodes;

  const byProtocolId = new Map<string, Record<string, ProtocolOutputThumbnailItem>>();

  for (const item of items) {
    if (!item.exists || !item.thumbnailDataUrl) continue;

    const protocolId = String(item.protocolId ?? "").trim();
    const outputName = String(item.outputName ?? "").trim();

    if (!protocolId || !outputName) continue;

    const current = byProtocolId.get(protocolId) ?? {};
    current[outputName] = item;
    byProtocolId.set(protocolId, current);
  }

  if (!byProtocolId.size) return nodes;

  let changed = false;

  const nextNodes = nodes.map((node) => {
    const protocolThumbs = byProtocolId.get(String(node.id));
    if (!protocolThumbs) return node;

    changed = true;

    return {
      ...node,
      data: {
        ...node.data,
        outputThumbnails: {
          ...(node.data?.outputThumbnails ?? {}),
          ...protocolThumbs,
        },
      },
    };
  });

  return changed ? nextNodes : nodes;
}

function preserveExistingOutputThumbnails(
  nextNodes: Node<StatusNodeData>[],
  currentNodes: Node[],
): Node<StatusNodeData>[] {
  const thumbnailsByNodeId = new Map<string, Record<string, ProtocolOutputThumbnailItem>>();

  for (const node of currentNodes) {
    const thumbs = (node as any)?.data?.outputThumbnails;
    if (thumbs && typeof thumbs === "object") {
      thumbnailsByNodeId.set(String(node.id), thumbs);
    }
  }

  if (!thumbnailsByNodeId.size) return nextNodes;

  return nextNodes.map((node) => {
    const thumbs = thumbnailsByNodeId.get(String(node.id));
    if (!thumbs) return node;

    return {
      ...node,
      data: {
        ...node.data,
        outputThumbnails: thumbs,
      },
    };
  });
}

function clearOutputThumbnailsFromNodes(
  nodes: Node<StatusNodeData>[],
): Node<StatusNodeData>[] {
  let changed = false;

  const nextNodes = nodes.map((node) => {
    if (!node.data?.outputThumbnails) return node;

    changed = true;

    const nextData = { ...node.data };
    delete nextData.outputThumbnails;

    return {
      ...node,
      data: nextData,
    };
  });

  return changed ? nextNodes : nodes;
}

export type ProjectPageProps = {
  /** Project identifier passed to the service (e.g. EMhub entry/project id). */
  projectName: string;
};

export default function ProjectPage({ projectName }: ProjectPageProps) {
  const hostIsDark = useTheme().theme === "dark";
  const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad|iPod/.test(navigator.platform);

  const svc = useProjectService();

  const [project, setProject] = useState<Project | undefined>(undefined);
  const [isLoadingProject, setIsLoadingProject] = useState(true);

  const [projectEffectiveSettings, setProjectEffectiveSettings] =
    useState<ProjectEffectiveSettings | null>(null);

  const effectiveUserSettings =
    useMemo<ProjectUserSettings>(() => {
      const raw =
        projectEffectiveSettings
          ?.settings
          ?.user;

      const source =
        raw &&
          typeof raw === "object"
          ? raw as Record<string, unknown>
          : {};

      const workflowViewModeRaw =
        String(
          source.workflowViewMode
          ?? DEFAULT_PROJECT_USER_SETTINGS
            .workflowViewMode
        )
          .trim()
          .toLowerCase();

      let workflowViewMode:
        ProjectUserSettings[
        "workflowViewMode"
        ] = "treeTb";

      switch (workflowViewModeRaw) {
        case "treelr":
        case "tree_lr":
        case "tree-lr":
        case "lr":
          workflowViewMode =
            "treeLr";
          break;

        case "grid":
          workflowViewMode =
            "grid";
          break;

        case "table":
          workflowViewMode =
            "table";
          break;

        case "treetb":
        case "tree_tb":
        case "tree-tb":
        case "tb":
        default:
          workflowViewMode =
            "treeTb";
          break;
      }

      const refreshValue = Number(
        source.workflowsAutoRefreshSec
        ?? DEFAULT_PROJECT_USER_SETTINGS
          .workflowsAutoRefreshSec
      );

      return {
        workflowViewMode,

        graphMiniMapEnabled:
          typeof source
            .graphMiniMapEnabled
            === "boolean"
            ? source.graphMiniMapEnabled
            : DEFAULT_PROJECT_USER_SETTINGS
              .graphMiniMapEnabled,

        graphFocusModeEnabled:
          typeof source
            .graphFocusModeEnabled
            === "boolean"
            ? source.graphFocusModeEnabled
            : DEFAULT_PROJECT_USER_SETTINGS
              .graphFocusModeEnabled,

        protocolOutputThumbnailsEnabled:
          typeof source
            .protocolOutputThumbnailsEnabled
            === "boolean"
            ? source
              .protocolOutputThumbnailsEnabled
            : DEFAULT_PROJECT_USER_SETTINGS
              .protocolOutputThumbnailsEnabled,

        workflowsAutoRefreshSec:
          Number.isFinite(
            refreshValue
          )
            ? Math.max(
              0,
              Math.min(
                300,
                refreshValue,
              ),
            )
            : DEFAULT_PROJECT_USER_SETTINGS
              .workflowsAutoRefreshSec,
      };
    }, [
      projectEffectiveSettings,
    ]);


  const workflowAutoRefreshSec = effectiveUserSettings.workflowsAutoRefreshSec;

  const protocolOutputThumbnailsEnabled = effectiveUserSettings.protocolOutputThumbnailsEnabled;
  const protocolOutputThumbnailsEnabledRef = useRef(false);
  protocolOutputThumbnailsEnabledRef.current = protocolOutputThumbnailsEnabled;

  const [projectEffectiveSettingsLoading, setProjectEffectiveSettingsLoading] =
    useState(false);

  // Tags states
  const [allTags, setAllTags] = useState<ProtocolTag[]>([]);
  const [tagManagerOpen, setTagManagerOpen] = useState(false);
  const [tagFilterIds, setTagFilterIds] = useState<string[]>([]);
  const [tagAssignments, setTagAssignments] = useState<ProtocolTagAssignments>({});



  const projectIdForTags = useMemo(() => {
    // projectIdForTags
    const raw: any = (project as any)?.id ?? (project as any)?.projectId;
    if (raw == null) return undefined;
    const n = typeof raw === "number" ? raw : Number(raw);
    return Number.isFinite(n) ? n : undefined;
  }, [project]);

  const refreshTagsFromBackend = useCallback(async () => {
    // refreshTagsFromBackend
    if (!projectIdForTags) {
      setAllTags([]);
      return;
    }
    try {
      const tags = await (svc as any).listProjectTags?.(projectIdForTags);
      setAllTags(Array.isArray(tags) ? (tags as ProtocolTag[]) : []);
    } catch (err) {
      console.error("listProjectTags failed", err);
      setAllTags([]);
    }
  }, [svc, projectIdForTags]);


  function extractAssignmentsFromProjectProtocols(protocols: any): ProtocolTagAssignments {
    // extractAssignmentsFromProjectProtocols 
    const out: ProtocolTagAssignments = {};
    if (!protocols || typeof protocols !== "object")
      return out;
    for (const [protocolId, proto] of Object.entries(protocols)) {
      const p: any = proto ?? {};
      const tagIds = pickFirstNonEmptyTagIds(p.tagIds, p.tags, p.tag_ids);
      if (tagIds.length) out[String(protocolId)] = tagIds;
    }
    return out;
  }


  // Workflows loaded from API (lazy)
  const [workflows, setWorkflows] = useState<ProjectWorkflow[]>([]);
  const [workflowsLoading, setWorkflowsLoading] = useState(false);
  const [workflowsError, setWorkflowsError] = useState<string | null>(null);
  const [workflowsLoadedOnce, setWorkflowsLoadedOnce] = useState(false);
  const [miniMapEnabled, setMiniMapEnabled] = useState(true);

  const [workflowClipboard, setWorkflowClipboardState] =
    useState<WorkflowClipboardState | null>(() => workflowClipboardMemory);

  const setWorkflowClipboard = useCallback((next: WorkflowClipboardState | null) => {
    workflowClipboardMemory = next;
    setWorkflowClipboardState(next);
  }, []);

  // focusModeState
  const [focusModeEnabled, setFocusModeEnabled] = useState(false);
  const [buildInfoOpen, setBuildInfoOpen] = useState(false);


  useEffect(() => {
    const workflowViewMode = effectiveUserSettings.workflowViewMode;

    switch (workflowViewMode) {
      case "treeLr":
        setViewMode(
          "hierarchical"
        );

        setGraphDirection(
          "LR"
        );
        break;

      case "grid":
        setViewMode(
          "grid"
        );
        break;

      case "table":
        setViewMode(
          "table"
        );
        break;

      case "treeTb":
      default:
        setViewMode(
          "hierarchical"
        );

        setGraphDirection(
          "TB"
        );
        break;
    }

    setMiniMapEnabled(effectiveUserSettings.graphMiniMapEnabled);
    setFocusModeEnabled(effectiveUserSettings.graphFocusModeEnabled);

  }, [
    projectName,
    effectiveUserSettings,
  ]);

  const analyzeViewerService = useMemo<ExternalAnalyzeViewerService>(() => {
    return {
      resolveAnalyzeViewer: svc.resolveAnalyzeViewer,
    };
  }, [svc]);

  const getAnalyzeViewerService = () => analyzeViewerService;

  const helpCacheRef = useRef<Record<string, string>>({});

  const [protocolHelp, setProtocolHelp] = useState<ProtocolHelpState>({
    open: false,
    title: "Protocol help",
    text: "",
    loading: false,
    error: null,
  });

  const openProtocolHelp = useCallback(
    async (protocolClass: string, protocolLabel?: string) => {
      // openProtocolHelp
      if (!projectName) return;

      const cacheKey = `${projectName}:${protocolClass}`;
      const title = protocolLabel ? `Help — ${protocolLabel}` : "Protocol help";

      setProtocolHelp({
        open: true,
        title,
        text: "",
        loading: true,
        error: null,
      });

      const cached = helpCacheRef.current[cacheKey];
      if (cached) {
        setProtocolHelp({
          open: true,
          title,
          text: cached,
          loading: false,
          error: null,
        });
        return;
      }

      try {
        const details = await svc.fetchNewProtocolDetails(projectName, protocolClass);
        const extracted = extractHelpText(details);
        const finalText =
          extracted && extracted.trim().length > 0
            ? normalizeHelpText(extracted)
            : "No help available for this protocol.";

        helpCacheRef.current[cacheKey] = finalText;

        setProtocolHelp({
          open: true,
          title,
          text: finalText,
          loading: false,
          error: null,
        });
      } catch (err) {
        console.error("openProtocolHelp failed", err);
        setProtocolHelp({
          open: true,
          title,
          text: "",
          loading: false,
          error: "Failed to load help for this protocol.",
        });
      }
    },
    [projectName, svc]
  );


  // Default policy used until the service returns a value
  const contextMenuVisibilityPolicyRef = useRef<NodeMenuVisibility>({
    open: true,
    browse: true,
    continue: true,
    delete: true,
    duplicate: true,
    copyWorkflow: true,
    pasteWorkflow: true,
    export: true,
    manageTags: true,
    nextSteps: true,
    rename: true,
    reset: true,
    restart: true,
    selectFrom: true,
    selectTo: true,
    stop: true,
    upload: true,
  });

  const projectId = useMemo(() => {
    // deriveProjectIdFromProjectState
    const raw: any = (project as any)?.id ?? (project as any)?.projectId;
    if (raw == null) return undefined;

    const n = typeof raw === "number" ? raw : Number(raw);
    return Number.isFinite(n) ? n : undefined;
  }, [project]);

  const effectiveInstanceSettings =
    projectEffectiveSettings
      ?.settings
      ?.instance
    ?? null;
  const effectiveHostSettings =
    projectEffectiveSettings
      ?.settings
      ?.host
    ?? null;

  const effectiveHostQueues = effectiveHostSettings?.queues ?? [];
  const effectiveDefaultQueueName =
    effectiveInstanceSettings
      ?.defaultQueueName
    ?? DEFAULT_PROJECT_INSTANCE_SETTINGS
      .defaultQueueName;

  const loadProjectEffectiveSettings = useCallback(
    async (nextProjectId?: string | number): Promise<ProjectEffectiveSettings | null> => {
      if (nextProjectId == null) {
        setProjectEffectiveSettings(null);
        setProjectEffectiveSettingsLoading(false);
        return null;
      }

      if (!hasProjectEffectiveSettingsService(svc)) {
        setProjectEffectiveSettings(null);
        setProjectEffectiveSettingsLoading(false);
        return null;
      }

      try {
        setProjectEffectiveSettingsLoading(true);
        const data = await svc.fetchProjectEffectiveSettings(nextProjectId);
        const normalized = data ?? null;
        setProjectEffectiveSettings(normalized);
        return normalized;
      } catch (err) {
        console.warn("fetchProjectEffectiveSettings failed", err);
        setProjectEffectiveSettings(null);
        return null;
      } finally {
        setProjectEffectiveSettingsLoading(false);
      }
    },
    [svc],
  );

  // Bump this to force rerender when policy is loaded/changed
  const [policyRevision, setPolicyRevision] = useState(0);

  useEffect(() => {
    let isCancelled = false;

    const loadContextMenuVisibilityPolicy = async () => {
      if (!projectId) return;
      try {
        const remotePolicy = await svc.getContextMenuVisibilityPolicy(projectId);
        if (isCancelled || !remotePolicy) return;
        contextMenuVisibilityPolicyRef.current = {
          delete: Boolean(remotePolicy.delete),
          nextSteps: Boolean(remotePolicy.nextSteps),
          open: Boolean(remotePolicy.open),
          browse: Boolean(remotePolicy.browse),
          continue: Boolean(remotePolicy.continue),
          duplicate: Boolean(remotePolicy.duplicate),
          copyWorkflow: Boolean(remotePolicy.copyWorkflow),
          pasteWorkflow: Boolean(remotePolicy.pasteWorkflow),
          export: Boolean(remotePolicy.export),
          manageTags: Boolean(remotePolicy.manageTags),
          rename: Boolean(remotePolicy.rename),
          reset: Boolean(remotePolicy.reset),
          restart: Boolean(remotePolicy.restart),
          selectFrom: Boolean(remotePolicy.selectFrom),
          selectTo: Boolean(remotePolicy.selectTo),
          stop: Boolean(remotePolicy.stop),
          upload: Boolean(remotePolicy.upload),
        };

        setPolicyRevision((v) => v + 1);
      } catch (err) {
        console.error("Failed to load contextMenuVisibilityPolicy", err);
      }
    };

    loadContextMenuVisibilityPolicy();

    return () => {
      isCancelled = true;
    };
  }, [svc, projectId]);


  // unifiedSelectionState
  const [unifiedSelectedIdsState, setUnifiedSelectedIdsState] = useState<Set<string>>(
    () => new Set<string>()
  );

  const syncUnifiedSelectedIds = useCallback(() => {
    // syncUnifiedSelectedIds
    setUnifiedSelectedIdsState(new Set(getUnifiedSelectedIds()));
  }, []);


  // Multi-form dock state
  const [openForms, setOpenForms] = useState<OpenForm[]>([]);
  // inFlightFormOpenIdsRef
  const openingFormIdsRef = useRef<Set<string>>(new Set());

  // dockEpochRef: prevents reopening forms after global close while a fetch is in-flight
  const dockEpochRef = useRef(0);

  const openFormsRef = useRef<OpenForm[]>([]);

  const syncProtocolDetailsToGraphRef = useRef<
    (protocolId: string, details: any) => void
  >(() => { });

  useEffect(() => {
    openFormsRef.current = openForms;
  }, [openForms]);

  const closeAllDockedForms = useCallback(() => {
    // closeAllDockedForms
    if (!openForms.length) return;

    captureDockPositions();
    pendingFlipRef.current = true;

    // Invalidate any in-flight opens so they can't re-add forms later
    dockEpochRef.current += 1;
    openingFormIdsRef.current.clear();

    setOpenForms([]);
  }, [openForms.length]);

  const refreshOpenFormsDetails = useCallback(async () => {
    if (!projectName) return;

    const formsToRefresh = openFormsRef.current.filter((form) => {
      if (form.isClosing) return false;
      return shouldRefreshProtocolForm(form.details);
    });

    if (!formsToRefresh.length) return;

    const currentEpoch = dockEpochRef.current;

    const results = await Promise.allSettled(
      formsToRefresh.map(async (form) => {
        const details = await svc.fetchProtocolDetails(projectName, form.id);
        return {
          id: String(form.id),
          details,
        };
      })
    );

    if (dockEpochRef.current !== currentEpoch) return;

    const detailsById = new Map<string, any>();

    for (const result of results) {
      if (result.status !== "fulfilled") continue;
      detailsById.set(result.value.id, result.value.details);
    }

    if (!detailsById.size) return;

    for (const [protocolId, details] of detailsById) {
      syncProtocolDetailsToGraphRef.current(
        protocolId,
        details
      );
    }

    setOpenForms((prev) =>
      prev.map((form) => {
        const freshDetails = detailsById.get(String(form.id));
        if (!freshDetails) return form;

        return {
          ...form,
          details: mergeLiveProtocolFormDetails(form.details, freshDetails),
        };
      })
    );
  }, [projectName, svc]);


  // --- Smooth dock animations (FLIP) ---
  const dockRef = useRef<HTMLDivElement | null>(null);
  const lastPositionsRef = useRef<Record<string, DOMRect>>({});
  const pendingFlipRef = useRef(false);

  /** Measure current positions of panels before changing state (add/remove/reorder). */
  const captureDockPositions = () => {
    const root = dockRef.current;
    if (!root) return;
    const map: Record<string, DOMRect> = {};
    root.querySelectorAll<HTMLElement>("[data-dock-key]").forEach((el) => {
      const key = el.dataset.dockKey!;
      map[key] = el.getBoundingClientRect();
    });
    lastPositionsRef.current = map;
  };

  /** Animate from previous positions to the new ones (FLIP). */
  const playDockFlip = () => {
    const root = dockRef.current;
    if (!root) return;
    const prev = lastPositionsRef.current;

    // Honor reduced motion
    const prefersReduced =
      typeof window !== "undefined" &&
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const D_MOVE = prefersReduced ? 0 : 300;
    const D_FADE = prefersReduced ? 0 : 240;

    root.querySelectorAll<HTMLElement>("[data-dock-key]").forEach((el) => {
      const key = el.dataset.dockKey!;
      const oldRect = prev[key];
      const newRect = el.getBoundingClientRect();

      if (oldRect) {
        const dx = oldRect.left - newRect.left;
        const dy = oldRect.top - newRect.top;
        if (dx !== 0 || dy !== 0) {
          (el as any).animate?.(
            [
              { transform: `translate(${dx}px, ${dy}px)`, opacity: 0.92 },
              { transform: "translate(0, 0)", opacity: 1 },
            ],
            { duration: D_MOVE, easing: "cubic-bezier(0.22, 1, 0.36, 1)" }
          );
        }
      } else {
        (el as any).animate?.(
          [{ opacity: 0, transform: "translateX(12px)" }, { opacity: 1, transform: "translateX(0)" }],
          { duration: D_FADE, easing: "ease-out" }
        );
      }
    });

    lastPositionsRef.current = {};
  };

  const portalRootRef = useRef<HTMLDivElement | null>(null);
  const [dialogContainer, setDialogContainer] = useState<HTMLElement | null>(null);

  const [protocolStepsDialog, setProtocolStepsDialog] = useState<{
    open: boolean;
    protocolId: string | null;
    protocolLabel: string;
  }>({
    open: false,
    protocolId: null,
    protocolLabel: "",
  });

  useEffect(() => {
    setDialogContainer(portalRootRef.current);
  }, []);

  useLayoutEffect(() => {
    if (!pendingFlipRef.current) return;
    pendingFlipRef.current = false;
    requestAnimationFrame(() => playDockFlip());
  }, [openForms]);

  const [nodes, setNodes, onNodesChange] = useNodesState<StatusNodeData>([]);
  const outputThumbnailCacheRef = useRef<Map<string, ProtocolOutputThumbnailItem>>(new Map());
  const outputThumbnailRetryAfterRef = useRef<Map<string, number>>(new Map());
  const outputThumbnailInFlightRef = useRef<Promise<void> | null>(null);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge[]>([]);
  const [tableData, setTableData] = useState<any[]>([]);
  const sortedTableData = useMemo(() => {
    if (!Array.isArray(tableData)) return [];
    return [...tableData].sort((a, b) => {
      const aId = Number(a?.id);
      const bId = Number(b?.id);
      if (!Number.isNaN(aId) && !Number.isNaN(bId)) return bId - aId;
      return String(b?.id ?? "").localeCompare(String(a?.id ?? ""));
    });
  }, [tableData]);
  const filteredTableData = useMemo(() => {
    // filteredTableData
    if (!tagFilterIds.length) return sortedTableData;

    const filterSet = new Set(tagFilterIds);
    return sortedTableData.filter((row) => {
      const pid = String(row?.id ?? "");
      const assigned = pickFirstNonEmptyTagIds(
        tagAssignments[pid],
        (row as any)?.tagIds,
        (row as any)?.tags
      );
      return assigned.some((tid) => filterSet.has(tid));
    });
  }, [sortedTableData, tagFilterIds, tagAssignments]);

  const [isRefreshing, setIsRefreshing] = useState(false);
  const delayedRefreshTimerRef = useRef<number | null>(null);

  const [previousNodeId, setPreviousNodeId] = useState<string | null>(null);
  const selectedIdRef = useRef<string | null>(null);
  useEffect(() => { selectedIdRef.current = previousNodeId; }, [previousNodeId]);

  const [viewMode, setViewMode] = useState<"hierarchical" | "grid" | "table">("hierarchical");
  const [highlightedId, setHighlightedId] = useState<string | null>(null);
  const rowRefs = useRef<Record<string, HTMLTableRowElement | null>>({});
  const tableContainerRef = useRef<HTMLDivElement | null>(null);
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);
  const [graphDirection, setGraphDirection] = useState<"TB" | "LR">("TB");

  const [_, setHideGraphDuringCenter] = useState(false);
  const [, startTransition] = useTransition();
  const disablePersistenceRef = useRef(false);

  const projectIdRef = useRef<string | number | undefined>(undefined);

  const seedNodesWithSelectionAndThumbnails = useCallback(
    (
      sourceNodes: Node[],
      selectedIds: Set<string>,
    ): Node<StatusNodeData>[] => {
      let seededNodes: Node<StatusNodeData>[] = sourceNodes.map((n) => {
        const node = n as Node<StatusNodeData>;

        return {
          ...node,
          selected: selectedIds.has(node.id),
        };
      });

      if (protocolOutputThumbnailsEnabled) {
        seededNodes = preserveExistingOutputThumbnails(
          seededNodes,
          nodesRef.current,
        );
      }

      return seededNodes;
    },
    [protocolOutputThumbnailsEnabled],
  );

  // pendingNewNodesRef tracks node ids before an operation that creates new nodes (duplicate/add)
  const pendingNewNodesRef = useRef<{
    beforeIds: Set<string>;
    beforePositions?: Map<string, { x: number; y: number }>;
    operation?: "duplicate" | "add";
    reflowWholeGraph?: boolean;
    duplicatedPairs?: Array<{
      sourceId: string;
      newId: string;
      sourcePosition?: { x: number; y: number };
    }>;
  } | null>(null);

  const pendingDeletionRef = useRef<{
    beforePositions: Map<string, { x: number; y: number }>;
  } | null>(null);

  useEffect(() => {
    // forceNodeRerenderAfterPolicyChange
    if (policyRevision === 0) return;
    setNodes((prev) => prev.map((n) => ({ ...n })));
  }, [policyRevision, setNodes]);

  useEffect(() => {
    const raw = (project as any)?.projectId ?? (project as any)?.id;
    if (raw == null) return;
    const asNumber = typeof raw === "number" ? raw : Number(raw);
    projectIdRef.current = Number.isNaN(asNumber) ? String(raw) : asNumber;
  }, [project]);

  const getProjectId = () => projectIdRef.current;

  //Tags 
  const tagById = useMemo(() => {
    // tagById
    return new Map(allTags.map((t) => [t.id, t]));
  }, [allTags]);

  const renderTableTagsCell = useCallback(
    (row: any): JSX.Element => {
      // renderTableTagsCell
      const pid = String(row?.id ?? "");
      const assignedTagIds = pickFirstNonEmptyTagIds(
        tagAssignments[pid],
        row?.tagIds,
        row?.tags
      );

      if (!assignedTagIds.length) {
        return <span style={{ opacity: 0.7 }}>—</span>;
      }

      const tags = assignedTagIds.map((id) => {
        const hit = tagById.get(id);
        if (hit) return hit;
        return { id, title: id, color: "#9ca3af" } as ProtocolTag;
      });

      return (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
          {tags.map((t) => {
            const bg = normalizeTagColor((t as any)?.color);
            const fg = getReadableTextColor(bg);
            return (
              <span
                key={t.id}
                title={String((t as any)?.title ?? t.id)}
                style={{
                  backgroundColor: bg,
                  color: fg,
                  borderRadius: 9999,
                  padding: "2px 8px",
                  fontSize: 12,
                  fontWeight: 600,
                  lineHeight: 1.2,
                  maxWidth: 260,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {String((t as any)?.title ?? t.id)}
              </span>
            );
          })}
        </div>
      );
    },
    [tagAssignments, tagById]
  );

  useEffect(() => {
    // loadTagsCatalogFromBackend
    void refreshTagsFromBackend();
  }, [refreshTagsFromBackend]);

  useEffect(() => {
    // refreshCatalogAfterClosingManager
    if (tagManagerOpen) return;
    void refreshTagsFromBackend();
  }, [tagManagerOpen, refreshTagsFromBackend]);

  // Viewport state (used for hierarchical/table; grid uses fixed zoom)
  const [viewport, setViewport] = useState<{ x: number; y: number; zoom: number }>({ x: 0, y: 0, zoom: 0.3464 });
  const viewportRef = useRef(viewport);
  useEffect(() => { viewportRef.current = viewport; }, [viewport]);

  const reactFlowInstanceRef = useRef<ReactFlowInstance | null>(null);
  const [contextMenu, setContextMenu] = useState<ContextMenuState>({ visible: false, x: 0, y: 0 });

  // Wrapper ref
  const flowWrapperRef = useRef<HTMLDivElement | null>(null);

  // Drawer
  const [drawerOpen, setDrawerOpen] = useState(false);

  const contentPortalRef = useRef<HTMLDivElement | null>(null);
  // drawerPortalContainer
  const [drawerPortalContainer, setDrawerPortalContainer] = useState<HTMLElement | null>(null);

  useLayoutEffect(() => {
    // syncDrawerPortalContainer
    setDrawerPortalContainer(contentPortalRef.current);
  }, []);

  // Add near your state declarations
  const handleProtocolsDrawerOpenChange = useCallback((open: boolean) => {
    setDrawerOpen(open);

    // Ensure mutual exclusivity: opening Protocols closes Workflows
    if (open) setWorkflowsOpen(false);
  }, []);


  // Last RF point for context menu placement
  const lastPaneRFPointRef = useRef<{ x: number; y: number } | null>(null);

  // Pending placement point for newly created protocol
  const pendingPlacementRef = useRef<{
    point: { x: number; y: number };
    beforeIds: Set<string>;
  } | null>(null);

  const PROTOCOL_OUTPUT_THUMBNAIL_CHUNK_SIZE = 24;
  const PROTOCOL_OUTPUT_THUMBNAIL_CHUNK_DELAY_MS = 50;
  const PROTOCOL_OUTPUT_THUMBNAIL_RETRY_DELAY_MS = 30_000;
  const localStorageKey = `emflow:project-${projectName}-node-positions`;

  const [, setIsSwitchingLayout] = useState(false);
  const [nodesLoadedOnce, setNodesLoadedOnce] = useState(false);
  const firstLoadRef = useRef(true);
  const skipNextGridSnapRef = useRef(false);

  // Zoom rules
  const GRID_ZOOM = 0.347;
  const MIN_ZOOM = 0.1;
  const MAX_ZOOM = 0.8;
  const clampZoom = (z: number | undefined | null) => {
    const num = typeof z === "number" && !Number.isNaN(z) ? z : 0.347;
    return Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, num));
  };
  const getEffectiveZoom = () => (viewMode === "grid" ? GRID_ZOOM : viewportRef.current.zoom);

  const nodesRef = useRef<Node[]>(nodes);
  useEffect(() => { nodesRef.current = nodes; }, [nodes]);

  const syncProtocolDetailsToGraph = useCallback(
    (
      protocolId: string,
      details: any,
    ) => {
      const info = details?.info;

      if (!info || typeof info !== "object") return;

      const outputs = Array.isArray(info.outputs) && info.outputs.length > 0
        ? info.outputs
        : undefined;

      const status = typeof info.status === "string"
        ? info.status
        : undefined;

      if (
        outputs === undefined &&
        status === undefined
      ) {
        return;
      }

      setNodes((currentNodes) =>
        currentNodes.map((node) => {
          if (
            String(node.id) !==
            String(protocolId)
          ) {
            return node;
          }

          return {
            ...node,
            data: {
              ...node.data,
              ...(outputs !== undefined
                ? { outputs }
                : {}),
              ...(status !== undefined
                ? { status }
                : {}),
            },
          };
        })
      );

      setTableData((currentRows) =>
        currentRows.map((row) => {
          if (
            String(row?.id) !==
            String(protocolId)
          ) {
            return row;
          }

          return {
            ...row,
            ...(outputs !== undefined
              ? { outputs }
              : {}),
            ...(status !== undefined
              ? { status }
              : {}),
          };
        })
      );
    },
    [setNodes],
  );

  const applyProtocolRuntimeSummaries = useCallback(
    (summaries: ProtocolRuntimeSummary[]) => {
      const summaryByProtocolId = new Map(
        summaries.map((summary) => [String(summary.protocolId), summary])
      );

      if (!summaryByProtocolId.size) {
        return;
      }

      setNodes((currentNodes) =>
        currentNodes.map((node) => {
          const summary = summaryByProtocolId.get(String(node.id));

          if (!summary) {
            return node;
          }

          const status = String(summary.status ?? "");
          const cpuTime = String(summary.cpuTimeSeconds ?? 0);
          const elapsedTime = String(summary.elapsedTimeSeconds ?? 0);
          const outputs = Array.isArray(summary.outputs) ? summary.outputs : undefined;
          const stepsDone = Number(summary.stepsDone ?? 0);
          const numberOfSteps = Number(summary.numberOfSteps ?? 0);

          const elapsedSessionId =
            summary.elapsedSessionId == null
              ? null
              : String(summary.elapsedSessionId).trim() || null;

          const freshNode: Node<StatusNodeData> = {
            ...node,
            data: {
              ...node.data,
              status,
              cpuTime,
              elapsedTime,
              elapsedSessionId,
              stepsDone,
              numberOfSteps,
              ...(outputs !== undefined ? { outputs } : {}),
            },
          };

          return mergeNodeElapsedTick(freshNode, node);
        })
      );

      setTableData((currentRows) =>
        currentRows.map((row) => {
          const summary = summaryByProtocolId.get(String(row?.id));

          if (!summary) {
            return row;
          }

          const status = String(summary.status ?? "");
          const cpuTime = String(summary.cpuTimeSeconds ?? 0);
          const elapsedTime = String(summary.elapsedTimeSeconds ?? 0);
          const outputs = Array.isArray(summary.outputs) ? summary.outputs : undefined;
          const stepsDone = Number(summary.stepsDone ?? 0);
          const numberOfSteps = Number(summary.numberOfSteps ?? 0);

          const elapsedSessionId =
            summary.elapsedSessionId == null
              ? null
              : String(summary.elapsedSessionId).trim() || null;

          const freshRow = {
            ...row,
            status,
            cpuTime,
            elapsedTime,
            elapsedSessionId,
            stepsDone,
            numberOfSteps,
            ...(outputs !== undefined ? { outputs } : {}),
          };

          return mergeTableElapsedTick(freshRow, row);
        })
      );

      setProject((currentProject) => {
        const protocols = (currentProject as any)?.protocols;

        if (!protocols) {
          return currentProject;
        }

        let changed = false;
        const nextProtocols = { ...protocols };

        for (const [protocolId, summary] of summaryByProtocolId) {
          const currentProtocol = protocols[protocolId];

          if (!currentProtocol) {
            continue;
          }

          const status = String(summary.status ?? "");

          if (
            normalizeProtocolStatus(currentProtocol.status) ===
            normalizeProtocolStatus(status)
          ) {
            continue;
          }

          nextProtocols[protocolId] = {
            ...currentProtocol,
            status,
          };

          changed = true;
        }

        if (!changed) {
          return currentProject;
        }

        return {
          ...currentProject,
          protocols: nextProtocols,
        } as Project;
      });
    },
    [setNodes],
  );

  useEffect(() => {
    syncProtocolDetailsToGraphRef.current =
      syncProtocolDetailsToGraph;
  }, [syncProtocolDetailsToGraph]);

  const edgesRef = useRef<Edge[]>(edges);
  useEffect(() => { edgesRef.current = edges; }, [edges]);

  const fetchProtocolOutputThumbnailItemsForNodes = useCallback(
    async (
      projectIdValue: string | number | undefined,
      sourceNodes: Node<StatusNodeData>[],
      enabled: boolean,
      maxNewRequests?: number,
    ): Promise<ProtocolOutputThumbnailItem[]> => {
      if (!enabled) return [];
      if (projectIdValue == null) return [];
      if (!Array.isArray(sourceNodes) || sourceNodes.length === 0) return [];
      if (typeof (svc as any).fetchProtocolOutputThumbnails !== "function") return [];

      const cachedItems: ProtocolOutputThumbnailItem[] = [];
      const requests: Array<{ protocolId: string | number; outputName: string }> = [];
      const seen = new Set<string>();

      for (const node of sourceNodes) {
        const protocolId = String(node.id ?? "").trim();
        if (!protocolId || protocolId === "PROJECT") continue;

        const outputs = Array.isArray(node.data?.outputs) ? node.data.outputs : [];

        for (const output of outputs) {
          const outputName = getOutputNameFromNodeOutput(output);
          if (!outputName) continue;

          const cacheKey = getOutputThumbnailCacheKey(
            projectIdValue,
            protocolId,
            outputName,
            PROTOCOL_OUTPUT_THUMBNAIL_SIZE,
          );

          if (seen.has(cacheKey)) continue;
          seen.add(cacheKey);

          const cached = outputThumbnailCacheRef.current.get(cacheKey);
          if (cached) {
            cachedItems.push(cached);
            continue;
          }

          const retryAfter = outputThumbnailRetryAfterRef.current.get(cacheKey) ?? 0;

          if (retryAfter > Date.now()) {
            continue;
          }

          if (retryAfter) {
            outputThumbnailRetryAfterRef.current.delete(cacheKey);
          }

          if (
            typeof maxNewRequests === "number" &&
            maxNewRequests > 0 &&
            requests.length >= maxNewRequests
          ) {
            continue;
          }

          requests.push({
            protocolId,
            outputName,
          });
        }
      }

      if (!requests.length) return cachedItems;
      if (outputThumbnailInFlightRef.current) return cachedItems;

      const run = (async () => {
        const result = await (svc as any).fetchProtocolOutputThumbnails(projectIdValue, {
          size: PROTOCOL_OUTPUT_THUMBNAIL_SIZE,
          inlineImages: true,
          outputs: requests,
        });

        const items = Array.isArray(result?.items)
          ? result.items as ProtocolOutputThumbnailItem[]
          : [];

        for (const item of items) {
          const protocolId = String(item.protocolId ?? "").trim();
          const outputName = String(item.outputName ?? "").trim();

          if (!protocolId || !outputName) continue;

          const cacheKey = getOutputThumbnailCacheKey(
            projectIdValue,
            protocolId,
            outputName,
            PROTOCOL_OUTPUT_THUMBNAIL_SIZE,
          );

          if (item.exists && (item.thumbnailDataUrl || item.thumbnailUrl)) {
            outputThumbnailCacheRef.current.set(cacheKey, item);
            outputThumbnailRetryAfterRef.current.delete(cacheKey);
          } else {
            outputThumbnailRetryAfterRef.current.set(cacheKey, Date.now() + PROTOCOL_OUTPUT_THUMBNAIL_RETRY_DELAY_MS);
          }
        }

        return items;
      })();

      outputThumbnailInFlightRef.current = run.then(() => undefined);

      try {
        const items = await run;
        return [...cachedItems, ...items];
      } catch (err) {
        console.warn("fetchProtocolOutputThumbnails failed", err);
        return cachedItems;
      } finally {
        outputThumbnailInFlightRef.current = null;
      }
    },
    [svc],
  );

  const loadProtocolOutputThumbnailsForNodes = useCallback(
    async (
      projectIdValue: string | number | undefined,
      sourceNodes: Node<StatusNodeData>[],
      enabledOverride?: boolean,
    ) => {
      const enabled = enabledOverride ?? protocolOutputThumbnailsEnabled;
      if (!enabled) return;

      let safetyCounter = 0;

      while (safetyCounter < 50) {
        safetyCounter += 1;

        const cacheSizeBefore = outputThumbnailCacheRef.current.size;

        const items = await fetchProtocolOutputThumbnailItemsForNodes(
          projectIdValue,
          sourceNodes,
          true,
          PROTOCOL_OUTPUT_THUMBNAIL_CHUNK_SIZE,
        );

        const cacheSizeAfter = outputThumbnailCacheRef.current.size;
        const loadedNewCacheItems = cacheSizeAfter > cacheSizeBefore;

        if (items.length) {
          setNodes((prev) =>
            mergeOutputThumbnailsIntoNodes(
              prev as Node<StatusNodeData>[],
              items,
            ),
          );
        }

        if (!loadedNewCacheItems) break;

        await new Promise<void>((resolve) => {
          window.setTimeout(resolve, PROTOCOL_OUTPUT_THUMBNAIL_CHUNK_DELAY_MS);
        });
      }
    },
    [
      fetchProtocolOutputThumbnailItemsForNodes,
      protocolOutputThumbnailsEnabled,
      setNodes,
    ],
  );

  useEffect(() => {
    if (!protocolOutputThumbnailsEnabled) return;
    if (!project) return;

    const projectIdValue =
      (project as any)?.id ??
      (project as any)?.projectId;

    if (projectIdValue == null) return;

    const currentNodes = nodesRef.current as Node<StatusNodeData>[];
    if (!currentNodes.length) return;

    void loadProtocolOutputThumbnailsForNodes(projectIdValue, currentNodes);
  }, [
    protocolOutputThumbnailsEnabled,
    project,
    loadProtocolOutputThumbnailsForNodes,
  ]);

  useEffect(() => {
    if (protocolOutputThumbnailsEnabled) return;

    outputThumbnailCacheRef.current.clear();
    outputThumbnailRetryAfterRef.current.clear();
    outputThumbnailInFlightRef.current = null;

    setNodes((prev) => clearOutputThumbnailsFromNodes(prev as Node<StatusNodeData>[]));
  }, [protocolOutputThumbnailsEnabled, setNodes]);


  // Workflows
  const [workflowsOpen, setWorkflowsOpen] = useState(false);

  useEffect(() => {
    // closeDockWhenExclusivePanelsOpen
    if (!drawerOpen && !workflowsOpen) return;

    captureDockPositions();
    pendingFlipRef.current = true;

    // Invalidate any in-flight opens so they can't re-add forms later
    dockEpochRef.current += 1;
    openingFormIdsRef.current.clear();

    setOpenForms([]);
  }, [drawerOpen, workflowsOpen]);


  const handleOpenWorkflows = useCallback(async () => {
    if (!projectName) return;

    // Ensure mutual exclusivity: opening Workflows closes Protocols
    setDrawerOpen(false);
    setWorkflowsOpen(true);
    closeAllDockedForms();

    // Avoid refetch if already loaded or currently loading
    if (workflowsLoading || workflowsLoadedOnce) {
      return;
    }

    try {
      setWorkflowsLoading(true);
      setWorkflowsError(null);

      const data = await svc.fetchWorkflows();

      const normalizeStringArray = (value: unknown): string[] => {
        if (!Array.isArray(value)) return [];

        return Array.from(
          new Set(
            value
              .map((item) => String(item ?? "").trim())
              .filter(Boolean),
          ),
        );
      };

      const normalized: ProjectWorkflow[] = Array.isArray(data)
        ? data.map((wf: any, idx: number) => {
          const requiredPluginNames = normalizeStringArray(wf.requiredPluginNames);
          const missingPluginNames = normalizeStringArray(wf.missingPluginNames);

          return {
            id: String(wf.id ?? wf.name ?? `wf-${idx}`),
            name: String(wf.name ?? wf.id ?? `Workflow ${idx + 1}`),
            description: String(wf.description ?? ""),
            source: wf.source ? String(wf.source) : "",
            templatePath: wf.templatePath ? String(wf.templatePath) : "",
            protocolsCount: Number.isFinite(Number(wf.protocolsCount))
              ? Number(wf.protocolsCount)
              : undefined,
            parseError: wf.parseError ? String(wf.parseError) : null,
            requiredPluginNames,
            missingPluginNames,
            canLoad: typeof wf.canLoad === "boolean" ? wf.canLoad : missingPluginNames.length === 0,
            disabledReason: wf.disabledReason ? String(wf.disabledReason) : "",
          };
        })
        : [];

      setWorkflows(normalized);
      setWorkflowsLoadedOnce(true);
    } catch (err: any) {
      console.error("fetchWorkflows error:", err);
      setWorkflows([]);
      const msg = err?.message || "Failed to load workflows.";
      setWorkflowsError(msg);
      toast.error(msg);
    } finally {
      setWorkflowsLoading(false);
    }
  }, [projectName, svc, workflowsLoading, workflowsLoadedOnce]);




  /* ------------------------ Centering / viewport helpers ------------------------ */
  const centerLikeButton = useCallback((nodesList?: Node[], preserveZoom = true, zoomOverride?: number) => {
    const inst = reactFlowInstanceRef.current ?? (window as any).reactFlowInstance;
    if (!inst) return;
    const list = nodesList ?? nodesRef.current ?? [];
    const validNodes = list.filter((n) => typeof n.position?.x === "number" && typeof n.position?.y === "number");
    if (validNodes.length === 0) {
      const vp = inst.getViewport();
      inst.setViewport({ x: vp.x, y: vp.y, zoom: clampZoom(vp.zoom) });
      setViewport({ x: vp.x, y: vp.y, zoom: clampZoom(vp.zoom) });
      return;
    }
    try {
      if (!preserveZoom) {
        inst.fitView({ padding: 0.12, duration: 0 });
        const vp = inst.getViewport();
        setViewport({ x: vp.x, y: vp.y, zoom: vp.zoom });
        return;
      }
      const targetZoom = clampZoom(typeof zoomOverride === "number" ? zoomOverride : inst.getViewport().zoom);
      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
      for (const n of validNodes) {
        const x = (n.position!.x ?? 0);
        const y = (n.position!.y ?? 0);
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
      const centerX = (minX + maxX) / 2;
      const centerY = (minY + maxY) / 2;
      inst.setCenter(centerX, centerY, { zoom: targetZoom, duration: 0 });
      const finalVp = inst.getViewport();
      setViewport({ x: finalVp.x, y: finalVp.y, zoom: finalVp.zoom });
    } catch {
      const xSum = validNodes.reduce((s, n) => s + (n.position!.x ?? 0), 0);
      const ySum = validNodes.reduce((s, n) => s + (n.position!.y ?? 0), 0);
      const centerX = xSum / validNodes.length;
      const centerY = ySum / validNodes.length;
      const currentVp = inst.getViewport();
      const zoom = clampZoom(currentVp.zoom);
      inst.setCenter(centerX, centerY, { zoom, duration: 0 });
      const vp = inst.getViewport();
      setViewport({ x: vp.x, y: vp.y, zoom: vp.zoom });
    }
  }, []);

  const snapViewportToTopLeft = useCallback((zoomOverride?: number) => {
    const inst = reactFlowInstanceRef.current ?? (window as any).reactFlowInstance;
    if (!inst) return;
    const current = inst.getViewport();
    const zoom = typeof zoomOverride === "number" ? zoomOverride : clampZoom(current.zoom);
    inst.setViewport({ x: 0, y: 0, zoom });
    setViewport({ x: 0, y: 0, zoom });
  }, []);

  /* --------------------- Grid container width observer --------------------- */
  const [gridWidth, setGridWidth] = useState<number>(0);
  const lastObservedWidthRef = useRef<number>(-1);

  useLayoutEffect(() => {
    const el = flowWrapperRef.current;
    if (!el) return;

    // Set initial width and seed the ref to avoid a recenter on height-only changes
    const initialWidth = Math.max(0, Math.floor(el.clientWidth || 0));
    lastObservedWidthRef.current = initialWidth;
    setGridWidth(initialWidth);

    const ro = new ResizeObserver((entries) => {
      const entry = entries[0];
      const nextWidth = Math.max(0, Math.floor(entry.contentRect.width));

      // Ignore height-only changes (e.g., TagPicker chips wrapping)
      if (nextWidth === lastObservedWidthRef.current) return;

      lastObservedWidthRef.current = nextWidth;
      setGridWidth(nextWidth);

      requestAnimationFrame(() => {
        const inst = reactFlowInstanceRef.current ?? (window as any).reactFlowInstance;
        if (!inst) return;

        if (viewModeRef.current === "grid") {
          snapViewportToTopLeft(GRID_ZOOM);
        } else if (viewModeRef.current === "hierarchical") {
          centerLikeButton(undefined, true, viewportRef.current.zoom);
        }
      });
    });

    ro.observe(el);

    return () => {
      try { ro.disconnect(); } catch { /* ignore */ }
    };
  }, [centerLikeButton, snapViewportToTopLeft]);


  /* --------------------- Keep latest layout params in refs to avoid refetch on view switch --------------------- */
  const viewModeRef = useRef(viewMode);
  useEffect(() => { viewModeRef.current = viewMode; }, [viewMode]);

  const graphDirectionRef2 = useRef(graphDirection);
  useEffect(() => { graphDirectionRef2.current = graphDirection; }, [graphDirection]);

  const gridWidthRef = useRef(gridWidth);
  useEffect(() => { gridWidthRef.current = gridWidth; }, [gridWidth]);

  /* --------------------- Selection state --------------------- */
  const [, setPathNodeIds] = useState<string[]>([]);
  const [, setPathEdgeIds] = useState<string[]>([]);
  const pathSelRef = useRef<{ nodes: Set<string>; edges: Set<string> }>({ nodes: new Set(), edges: new Set() });

  const suppressNextSyncRef = useRef(false);
  const suppressOneFrame = () => {
    suppressNextSyncRef.current = true;
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        suppressNextSyncRef.current = false;
      });
    });
  };

  const getSelectedPathIds = () => pathSelRef.current.nodes;

  // Colors
  const SELECT_COLOR = "#0070f3";
  const PATH_COLOR = "#0ea5e9";

  const setsEqual = (a: Set<string>, b: Set<string>) => {
    if (a.size !== b.size) return false;
    for (const v of a) if (!b.has(v)) return false;
    return true;
  };

  const getUnifiedSelectedIds = (): Set<string> => {
    const out = new Set<string>(Array.from(pathSelRef.current.nodes));
    const single = selectedIdRef.current;
    if (single) out.add(single);
    return out;
  };

  const clearAllSelectionHard = useCallback(() => {
    if (pathSelRef.current.nodes.size || pathSelRef.current.edges.size) {
      pathSelRef.current = { nodes: new Set(), edges: new Set() };
      setPathNodeIds([]);
      setPathEdgeIds([]);
      setEdges((eds) =>
        eds.map((e) => {
          if ((e as any).__path || (e as any).__hl) {
            const styleCopy: any = { ...(e.style ?? {}) };
            delete styleCopy.strokeDasharray;
            if (styleCopy.stroke === PATH_COLOR || styleCopy.stroke === SELECT_COLOR) delete styleCopy.stroke;
            const sw = Number(styleCopy.strokeWidth);
            if (!Number.isNaN(sw) && (sw <= 4 || sw === 4)) delete styleCopy.strokeWidth;
            const cleaned: any = { ...e, style: Object.keys(styleCopy).length ? styleCopy : undefined };
            delete (cleaned as any).__path;
            delete (cleaned as any).__hl;
            return cleaned;
          }
          return e;
        })
      );
    } else {
      setEdges((eds) =>
        eds.map((e) => {
          if ((e as any).__hl) {
            const { style, ...rest } = e;
            const ns: any = { ...(style ?? {}) };
            if (ns.stroke === SELECT_COLOR) delete ns.stroke;
            const sw = Number(ns.strokeWidth);
            if (!Number.isNaN(sw) && sw === 4) delete ns.strokeWidth;
            const clean: any = { ...rest, style: Object.keys(ns).length ? ns : undefined };
            delete (clean as any).__hl;
            return clean;
          }
          return e;
        })
      );
    }

    suppressOneFrame();
    setNodes((prev) => (prev.some((n) => n.selected) ? prev.map((n) => ({ ...n, selected: false })) : prev));
    selectedIdRef.current = null;
    setPreviousNodeId(null);
    setHighlightedId(null);
    pathEdgeModeRef.current = 'all';
    syncUnifiedSelectedIds();
  }, [setNodes, setEdges]);

  /* --------------------- Edge painters --------------------- */
  const curIsBlue = (e: Edge) =>
    (e.style as any)?.stroke === SELECT_COLOR && Number((e.style as any)?.strokeWidth) === 4;

  const paintEdgeHighlight = useCallback((eds: Edge[], selectedId: string | null): Edge[] => {
    if (!selectedId) {
      let anyStyled = false;
      for (const e of eds) {
        if ((e as any).__hl || (e.style as any)?.stroke === SELECT_COLOR) { anyStyled = true; break; }
      }
      if (!anyStyled) return eds;
      return eds.map((e) => {
        if ((e as any).__hl || (e.style && (e.style as any).stroke === SELECT_COLOR)) {
          const { style, ...rest } = e;
          const newStyle: any = { ...(style ?? {}) };
          if ((e as any).__path) {
            delete newStyle.strokeWidth;
          } else {
            delete newStyle.stroke;
            delete newStyle.strokeWidth;
          }
          const clean: any = { ...rest, style: Object.keys(newStyle).length ? newStyle : undefined };
          delete (clean as any).__hl;
          return clean;
        }
        return e;
      });
    }

    let changed = false;
    const next = eds.map((e) => {
      const isConn = e.source === selectedId || e.target === selectedId;
      if (isConn) {
        const curStroke = (e.style as any)?.stroke;
        const curWidth = Number((e.style as any)?.strokeWidth);
        if (curStroke === SELECT_COLOR && curWidth === 4) return e;
        changed = true;
        return {
          ...e,
          style: { ...(e.style ?? {}), stroke: SELECT_COLOR, strokeWidth: 4 },
          __hl: true as any,
        };
      } else if ((e as any).__hl || curIsBlue(e)) {
        changed = true;
        const { style, ...rest } = e;
        const newStyle: any = { ...(style ?? {}) };
        if ((e as any).__path) {
          const sw = Number(newStyle.strokeWidth);
          if (!Number.isNaN(sw) && sw === 4) delete newStyle.strokeWidth;
        } else {
          delete newStyle.stroke;
          delete newStyle.strokeWidth;
        }
        const clean: any = { ...rest, style: Object.keys(newStyle).length ? newStyle : undefined };
        delete (clean as any).__hl;
        return clean;
      }
      return e;
    });
    return changed ? next : eds;
  }, [SELECT_COLOR]);

  const paintPathHighlight = useCallback((eds: Edge[], edgeIdsSet: Set<string>): Edge[] => {
    let changed = false;
    const next = eds.map((e) => {
      const inSet = edgeIdsSet.has(e.id);
      const wasPath = !!(e as any).__path;
      const isHL = !!(e as any).__hl;

      if (inSet) {
        if (isHL) return e;
        const newStyle: any = {
          ...(e.style ?? {}),
          stroke: PATH_COLOR,
          strokeWidth: Math.max(4, Number((e.style as any)?.strokeWidth) || 4),
          strokeDasharray: "6 3",
        };
        if (!wasPath || (e.style as any)?.stroke !== PATH_COLOR || Number((e.style as any)?.strokeWidth) < 4) {
          changed = true;
          return { ...e, style: newStyle, __path: true as any };
        }
        return e;
      } else if (wasPath) {
        const styleCopy: any = { ...(e.style ?? {}) };
        if (isHL) {
          if (styleCopy.stroke === PATH_COLOR) delete styleCopy.stroke;
          if (styleCopy.strokeDasharray === "6 3") delete styleCopy.strokeDasharray;
          changed = true;
          const cleaned: any = { ...e, style: Object.keys(styleCopy).length ? styleCopy : undefined };
          delete (cleaned as any).__path;
          return cleaned;
        } else {
          if (styleCopy.stroke === PATH_COLOR) delete styleCopy.stroke;
          const sw = Number(styleCopy.strokeWidth);
          if (!Number.isNaN(sw) && sw <= 4) delete styleCopy.strokeWidth;
          if (styleCopy.strokeDasharray === "6 3") delete styleCopy.strokeDasharray;
          changed = true;
          const cleaned: any = { ...e, style: Object.keys(styleCopy).length ? styleCopy : undefined };
          delete (cleaned as any).__path;
          return cleaned;
        }
      }
      return e;
    });
    return changed ? next : eds;
  }, [PATH_COLOR]);

  /* --------------------- Edge set helpers --------------------- */
  const computeEdgesTouchingNodes = useCallback((nodeSet: Set<string>) => {
    const edgeIds: string[] = [];
    for (const e of edgesRef.current) {
      const s = String(e.source);
      const t = String(e.target);
      if (nodeSet.has(s) || nodeSet.has(t)) edgeIds.push(e.id);
    }
    return new Set(edgeIds);
  }, []);

  /* --------------------- Directional path edge mode + helpers --------------------- */
  const pathEdgeModeRef = useRef<'all' | 'outgoing' | 'incoming'>('all');

  const computeOutgoingEdgesFromSet = useCallback((nodeSet: Set<string>) => {
    const edgeIds: string[] = [];
    for (const e of edgesRef.current) {
      if (nodeSet.has(String(e.source))) edgeIds.push(e.id);
    }
    return new Set(edgeIds);
  }, []);

  const computeIncomingEdgesToSet = useCallback((nodeSet: Set<string>) => {
    const edgeIds: string[] = [];
    for (const e of edgesRef.current) {
      if (nodeSet.has(String(e.target))) edgeIds.push(e.id);
    }
    return new Set(edgeIds);
  }, []);

  const computeEdgesForMode = useCallback(
    (nodeSet: Set<string>, mode: 'all' | 'outgoing' | 'incoming') => {
      if (!nodeSet.size) return new Set<string>();
      if (mode === 'outgoing') return computeOutgoingEdgesFromSet(nodeSet);
      if (mode === 'incoming') return computeIncomingEdgesToSet(nodeSet);
      return computeEdgesTouchingNodes(nodeSet);
    },
    [computeEdgesTouchingNodes, computeOutgoingEdgesFromSet, computeIncomingEdgesToSet]
  );

  /* --------------------- Selection application --------------------- */
  const bumpNodesForPath = useCallback(() => {
    setNodes((prev) =>
      prev.map((n) => ({
        ...n,
        data: { ...(n as any).data, __pathVer: ((n as any).data?.__pathVer ?? 0) + 1 },
      }))
    );
  }, [setNodes]);

  const applyPathSelection = useCallback((nodeIds: string[], edgeIds?: string[]) => {
    const nextNodes = new Set(nodeIds.map(String));
    const nextEdges = new Set(edgeIds ?? Array.from(computeEdgesTouchingNodes(nextNodes)));
    pathSelRef.current = { nodes: nextNodes, edges: nextEdges };
    setPathNodeIds(Array.from(nextNodes));
    setPathEdgeIds(Array.from(nextEdges));

    setNodes((prev) => prev.map((n) => ({ ...n, selected: nextNodes.has(n.id) })));

    setEdges((eds) => {
      let out = paintEdgeHighlight(eds, null);
      out = paintPathHighlight(out, nextEdges);
      return out;
    });

    bumpNodesForPath();
    syncUnifiedSelectedIds();
  }, [computeEdgesTouchingNodes, paintPathHighlight, paintEdgeHighlight, setNodes, setEdges, bumpNodesForPath]);

  const clearPathSelection = useCallback(() => {
    if (pathSelRef.current.nodes.size === 0 && pathSelRef.current.edges.size === 0) return;
    pathSelRef.current = { nodes: new Set(), edges: new Set() };
    setPathNodeIds([]);
    setPathEdgeIds([]);
    setEdges((eds) => paintPathHighlight(eds, new Set()));
    bumpNodesForPath();
    syncUnifiedSelectedIds();
  }, [paintPathHighlight, bumpNodesForPath]);

  const applyEdgeHighlight = useCallback((selectedId: string | null) => {
    setEdges((eds) => {
      let out = paintEdgeHighlight(eds, selectedId);
      if (pathSelRef.current.edges.size) {
        out = paintPathHighlight(out, pathSelRef.current.edges);
        return out;
      }
      return out;
    });
  }, [paintEdgeHighlight, paintPathHighlight, setEdges]);


  const prevHadTagFilterRef = useRef(false);

  useEffect(() => {
    // focusNodesMatchingTagFilter
    // Important: tag filtering must not change graph selection.
    const hadPrev = prevHadTagFilterRef.current;
    const hasNow = tagFilterIds.length > 0;
    prevHadTagFilterRef.current = hasNow;

    if (!hasNow) return;

    // In table mode, rows are already filtered; optional: scroll to the first match.
    if (viewMode === "table") {
      const first = filteredTableData[0];
      if (first) scrollToProtocol(String(first.id));
      return;
    }

    // No-op on graph modes: renderNodes already dims non-matching nodes via tagFilterIds.
    // This prevents applyPathSelection() from selecting nodes while filtering.
    void hadPrev;
  }, [tagFilterIds, viewMode, filteredTableData]);



  useEffect(() => {
    // pruneTagFilterAndAssignmentsAgainstCatalog
    const valid = new Set(allTags.map((t) => t.id));
    if (valid.size === 0) return;

    setTagFilterIds((prev) => prev.filter((id) => valid.has(id)));

    setTagAssignments((prev) => {
      let changed = false;
      const next: ProtocolTagAssignments = {};

      for (const [pid, ids] of Object.entries(prev)) {
        const cleaned = (ids ?? []).filter((id) => valid.has(id));
        if (cleaned.length !== (ids ?? []).length) changed = true;
        if (cleaned.length) next[pid] = cleaned;
      }

      return changed ? next : prev;
    });
  }, [allTags]);



  /* --------------------- Node click / double click --------------------- */
  const handleNodeClick = (nodeData: any, evt?: React.MouseEvent) => {
    if (evt?.ctrlKey || evt?.metaKey || evt?.shiftKey) return;

    if (pathSelRef.current.nodes.size || pathSelRef.current.edges.size) {
      clearPathSelection();
    }

    const id = String(nodeData.id);
    selectedIdRef.current = id;
    setPreviousNodeId(id);
    setHighlightedId(id);
    applyEdgeHighlight(id);

    suppressOneFrame();
    setNodes((prev) =>
      prev.map((n) =>
        n.id === id ? (n.selected ? n : { ...n, selected: true }) : (n.selected ? { ...n, selected: false } : n)
      )
    );
    syncUnifiedSelectedIds();
  };

  // Open or focus a docked form for a protocol class (new protocol form)
  const openFormForProtocolClass = useCallback(
    async (protocolClass: string) => {
      if (!projectName) return;

      setDrawerOpen(false);
      setWorkflowsOpen(false);

      const key = `class:${String(protocolClass)}`;
      const id = String(protocolClass);

      // preventDuplicateOpensInFlight
      if (openingFormIdsRef.current.has(key)) {
        // bringToFrontIfAlreadyInDock
        setOpenForms((prev) => {
          const hitIndex = prev.findIndex((f) => f.key === key);
          if (hitIndex < 0) return prev;
          const hit = prev[hitIndex];
          return [hit, ...prev.filter((_, i) => i !== hitIndex)];
        });
        return;
      }

      openingFormIdsRef.current.add(key);

      // bringToFrontIfAlreadyOpen
      let wasAlreadyOpen = false;
      setOpenForms((prev) => {
        const hitIndex = prev.findIndex((f) => f.key === key);
        if (hitIndex >= 0) {
          wasAlreadyOpen = true;
          const hit = prev[hitIndex];
          return [hit, ...prev.filter((_, i) => i !== hitIndex)];
        }
        return prev;
      });

      if (wasAlreadyOpen) {
        openingFormIdsRef.current.delete(key);
        return;
      }

      const dockEpoch = dockEpochRef.current;

      try {
        const details = await svc.fetchNewProtocolDetails(projectName, protocolClass);

        if (dockEpochRef.current !== dockEpoch) {
          // dockWasGloballyClosedWhileFetching
          return;
        }

        captureDockPositions();
        pendingFlipRef.current = true;

        setOpenForms((prev) => [
          { key, id, details },
          ...prev.filter((f) => f.key !== key),
        ]);
      } catch (err) {
        console.error("openFormForProtocolClass failed", err);
      } finally {
        openingFormIdsRef.current.delete(key);
      }
    },
    [projectName, svc]
  );


  // Open or focus a form for a node; fetch details only when needed
  // openFormForNode
  const openFormForNode = useCallback(
    async (nodeId: string, fetcher: () => Promise<any>) => {
      if (!projectName) return;

      setDrawerOpen(false);
      setWorkflowsOpen(false);

      // snapshot epoch to avoid reopening if dock was globally closed while fetching

      const id = String(nodeId);

      selectedIdRef.current = id;
      syncUnifiedSelectedIds();
      setPreviousNodeId(id);
      setHighlightedId(id);
      applyEdgeHighlight(id);

      // preventDuplicateOpensInFlight
      if (openingFormIdsRef.current.has(id)) {
        // bringToFrontIfAlreadyInDock
        setOpenForms((prev) => {
          const hitIndex = prev.findIndex((f) => f.id === id);
          if (hitIndex < 0) return prev;
          const hit = prev[hitIndex];
          return [hit, ...prev.filter((_, i) => i !== hitIndex)];
        });
        return;
      }

      openingFormIdsRef.current.add(id);

      // bringToFrontIfAlreadyOpen
      let wasAlreadyOpen = false;
      setOpenForms((prev) => {
        const hitIndex = prev.findIndex((f) => f.id === id);
        if (hitIndex >= 0) {
          wasAlreadyOpen = true;
          const hit = prev[hitIndex];
          return [hit, ...prev.filter((_, i) => i !== hitIndex)];
        }
        return prev;
      });

      if (wasAlreadyOpen) {
        openingFormIdsRef.current.delete(id);
        return;
      }

      const dockEpoch = dockEpochRef.current;

      try {
        const details = await fetcher();

        syncProtocolDetailsToGraph(
          id,
          details
        );

        if (dockEpochRef.current !== dockEpoch) {
          // dockWasGloballyClosedWhileFetching
          return;
        }

        captureDockPositions();
        pendingFlipRef.current = true;

        // useStableKeyToGuaranteeUniquenessPerId
        setOpenForms((prev) => [
          { key: id, id, details },
          ...prev.filter((f) => f.id !== id),
        ]);
      } catch (err) {
        console.error("openFormForNode failed", err);
      } finally {
        openingFormIdsRef.current.delete(id);
      }
    },
    [
      projectName,
      applyEdgeHighlight,
      syncUnifiedSelectedIds,
      syncProtocolDetailsToGraph,
    ]
  );


  const handleNodeDoubleClick = useCallback(
    async (nodeData: any) => {
      if (!projectName) return;
      await openFormForNode(String(nodeData.id), () =>
        svc.fetchProtocolDetails(projectName, nodeData.id)
      );
    },
    [projectName, openFormForNode, svc]
  );

  const closeFormByKey = useCallback((key: string) => {
    captureDockPositions();
    pendingFlipRef.current = true;
    setOpenForms((prev) => prev.filter((f) => f.key !== key));
  }, []);

  /* -------- Build adjacency from edges -------- */
  const buildAdjacency = useCallback(() => {
    const parents = new Map<string, Set<string>>();
    const children = new Map<string, Set<string>>();

    for (const e of edgesRef.current) {
      const s = String(e.source);
      const t = String(e.target);
      if (!children.has(s)) children.set(s, new Set());
      if (!parents.has(t)) parents.set(t, new Set());
      children.get(s)!.add(t);
      parents.get(t)!.add(s);
      if (!parents.has(s)) parents.set(s, new Set());
      if (!children.has(t)) children.set(t, new Set());
    }
    return { parents, children };
  }, []);

  const collectDescendants = useCallback((startIdRaw: string) => {
    const startId = String(startIdRaw);
    const { children } = buildAdjacency();
    const q: string[] = [startId];
    const visited = new Set<string>();
    while (q.length) {
      const cur = String(q.shift()!);
      if (cur === "PROJECT") continue;
      if (visited.has(cur)) continue;
      visited.add(cur);
      const ch = children.get(cur) ?? new Set<string>();
      for (const c of ch) if (!visited.has(c)) q.push(String(c));
    }
    visited.delete("PROJECT");
    return visited;
  }, [buildAdjacency]);

  const collectAncestors = useCallback((startIdRaw: string) => {
    const startId = String(startIdRaw);
    const { parents } = buildAdjacency();
    const q: string[] = [startId];
    const visited = new Set<string>();
    while (q.length) {
      const cur = String(q.shift()!);
      if (cur === "PROJECT") continue;
      if (visited.has(cur)) continue;
      visited.add(cur);
      const pa = parents.get(cur) ?? new Set<string>();
      for (const p of pa) if (!visited.has(p)) q.push(String(p));
    }
    visited.delete("PROJECT");
    return visited;
  }, [buildAdjacency]);

  const applyGenericSelectionFromSet = useCallback((ids: Set<string>) => {
    pathEdgeModeRef.current = 'all';
    applyPathSelection(Array.from(ids));
  }, [applyPathSelection]);

  const getAllWorkflowProtocolIds = useCallback((): Set<string> => {
    // getAllWorkflowProtocolIds
    const ids = new Set<string>();

    if (viewModeRef.current === "table") {
      for (const row of tableData) {
        const id = String(row?.id ?? "").trim();
        if (id && id !== "PROJECT") ids.add(id);
      }

      return ids;
    }

    for (const node of nodesRef.current) {
      const id = String(node.id ?? "").trim();
      if (id && id !== "PROJECT") ids.add(id);
    }

    return ids;
  }, [tableData]);

  const handleSelectAllWorkflow = useCallback(() => {
    // handleSelectAllWorkflow
    const ids = getAllWorkflowProtocolIds();

    if (!ids.size) return;

    selectedIdRef.current = null;
    setPreviousNodeId(null);
    setHighlightedId(null);

    suppressOneFrame();
    applyGenericSelectionFromSet(ids);
  }, [getAllWorkflowProtocolIds, applyGenericSelectionFromSet]);

  const handleSelectFrom = useCallback((id: string) => {
    const nodesSet = collectDescendants(id);
    if (id !== "PROJECT") nodesSet.add(String(id));
    pathEdgeModeRef.current = 'outgoing';
    const edgeIds = Array.from(computeOutgoingEdgesFromSet(nodesSet));
    applyPathSelection(Array.from(nodesSet), edgeIds);
  }, [collectDescendants, computeOutgoingEdgesFromSet, applyPathSelection]);

  const handleSelectTo = useCallback((id: string) => {
    const nodesSet = collectAncestors(id);
    if (id !== "PROJECT") nodesSet.add(String(id));
    pathEdgeModeRef.current = 'incoming';
    const edgeIds = Array.from(computeIncomingEdgesToSet(nodesSet));
    applyPathSelection(Array.from(nodesSet), edgeIds);
  }, [collectAncestors, computeIncomingEdgesToSet, applyPathSelection]);

  const handleAddProtocolFromDrawer = useCallback(
    async (
      protocolClass: string,
      opts?: { mode?: "add" | "help"; protocolLabel?: string }
    ) => {
      // handleAddProtocolFromDrawer
      if (!projectName) return;

      if (opts?.mode === "help") {
        await openProtocolHelp(protocolClass, opts.protocolLabel);
        return;
      }

      setDrawerOpen(false);

      await openFormForProtocolClass(protocolClass);
    },
    [projectName, openFormForNode, svc, openProtocolHelp]
  );


  useEffect(() => {
    nodeActionsRef.current = {
      onEdit: (id) => handleNodeDoubleClick({ id }),
      onRename: openRename,
      onDuplicate: (id) => {
        const ids =
          pathSelRef.current.nodes.size > 0
            ? Array.from(pathSelRef.current.nodes).map(String).filter((x) => x !== "PROJECT")
            : [String(id)];
        duplicateNow(ids);
      },
      onCopyWorkflow: () => {
        void handleCopyWorkflow();
      },
      onPasteWorkflow: () => {
        void handlePasteWorkflow();
      },
      canPasteWorkflow: Boolean(workflowClipboard?.workflow),
      onDelete: openDelete,
      onRestartAll: openRestartAll,
      onContinueAll: openContinueAll,
      onSelectFrom: handleSelectFrom,
      onSelectTo: handleSelectTo,
      onStop: openStop,
      onResetFrom: openResetFrom,
      onManageTags: () => setTagManagerOpen(true),

      onOpenProtocolClass: (protocolClass) => {
        void openFormForProtocolClass(protocolClass);
      },
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [handleSelectFrom, handleSelectTo, handleNodeDoubleClick, openFormForProtocolClass, workflowClipboard?.workflow,]);


  /** State and handler for RemoteFileDialog */
  const [fileDialogOpen, setFileDialogOpen] = useState(false);
  const [fileDialogCtx, setFileDialogCtx] = useState<{ protocolId?: string; protocolLabel?: string }>({});
  const canOpenFileDialog = fileDialogOpen && fileDialogCtx.protocolId != null && project?.id != null;
  const pid = fileDialogCtx.protocolId as string | number;
  const projId = project?.id as string | number;
  const plabel = fileDialogCtx.protocolLabel
    ? `( ${pid} ) ${fileDialogCtx.protocolLabel}`
    : String(pid);

  const openBrowse = useCallback((
    protocolId: string,
    _projectId?: string | number,
    protocolLabel?: string
  ) => {
    setFileDialogCtx({ protocolId, protocolLabel });
    setFileDialogOpen(true);
  }, []);

  const nodeTypesRef = useRef<Record<string, any> | null>(null);
  if (!nodeTypesRef.current) {
    nodeTypesRef.current = {
      status: createStatusNodeWrapper(
        (data, evt) => onClickRef.current?.(data, evt),
        (data) => onDblClickRef.current?.(data),
        () => selectedIdRef.current ?? undefined,
        () => hoveredIdRef.current ?? undefined,
        setHoveredNodeId,
        () => graphDirRef.current,
        () => viewModeRef.current,
        () => nodeActionsRef.current,
        () => getSelectedPathIds(),
        (protocolId: string, projectId?: string | number, protocolLabel?: string) =>
          openBrowse(protocolId, projectId, protocolLabel),
        () => getProjectId(),
        () => getAnalyzeViewerService(),
        () => contextMenuVisibilityPolicyRef.current,
        () => protocolOutputThumbnailsEnabledRef.current,
      ),
    };

  }
  const nodeTypes = nodeTypesRef.current;

  /* --------------------- Persistence of positions --------------------- */

  type PersistedNodePositionsV6 = {
    version: 6;
    direction: "TB" | "LR";
    topologySignature: string;
    positions: Array<{ id: string; position: { x: number; y: number } }>;
  };

  const nodePositionsVersion = 6;
  const graphTopologySignatureRef = useRef("");

  const storageKeyHier = `${localStorageKey}-${graphDirection}-hier`;
  const manualNodeOriginsStorageKey = `${storageKeyHier}-manual-origins`;
  const viewportStorageKey = `${localStorageKey}-${viewMode}-${graphDirection}-viewport`;

  const safeParseJson = (raw: string | null): unknown => {
    if (!raw) return null;

    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  };

  const isValidPosItem = (value: any): value is { id: string; position: { x: number; y: number } } => {
    const idOk = typeof value?.id === "string" && value.id.length > 0;
    const xOk = typeof value?.position?.x === "number" && Number.isFinite(value.position.x);
    const yOk = typeof value?.position?.y === "number" && Number.isFinite(value.position.y);

    return idOk && xOk && yOk;
  };

  type PersistedManualNodeOriginsV1 = {
    version: 1;
    direction: "TB" | "LR";
    topologySignature: string;
    positions: Array<{ id: string; position: { x: number; y: number } }>;
  };

  const readManualNodeOrigins = (): Map<string, { x: number; y: number }> => {
    const topologySignature = graphTopologySignatureRef.current;

    if (!topologySignature) {
      return new Map();
    }

    try {
      const parsed = safeParseJson(localStorage.getItem(manualNodeOriginsStorageKey));

      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
        return new Map();
      }

      const payload = parsed as Partial<PersistedManualNodeOriginsV1>;

      if (
        payload.version !== 1 ||
        payload.direction !== graphDirection ||
        payload.topologySignature !== topologySignature ||
        !Array.isArray(payload.positions)
      ) {
        localStorage.removeItem(manualNodeOriginsStorageKey);
        return new Map();
      }

      return new Map(
        payload.positions
          .filter(isValidPosItem)
          .map((item) => [item.id, item.position])
      );
    } catch {
      return new Map();
    }
  };

  const writeManualNodeOrigins = (
    positionsById: Map<string, { x: number; y: number }>
  ): void => {
    const topologySignature = graphTopologySignatureRef.current;

    if (!topologySignature) {
      return;
    }

    try {
      const payload: PersistedManualNodeOriginsV1 = {
        version: 1,
        direction: graphDirection,
        topologySignature,
        positions: Array.from(positionsById.entries()).map(([id, position]) => ({
          id,
          position,
        })),
      };

      localStorage.setItem(manualNodeOriginsStorageKey, JSON.stringify(payload));
    } catch {
      // noOp
    }
  };

  const clearManualNodeOrigins = (): void => {
    try {
      localStorage.removeItem(manualNodeOriginsStorageKey);
    } catch {
      // noOp
    }
  };

  const readPersistedPositions = (
    key: string,
    expectedDirection: "TB" | "LR",
    expectedTopologySignature: string
  ): Array<{ id: string; position: { x: number; y: number } }> => {
    const parsed = safeParseJson(localStorage.getItem(key));

    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return [];
    }

    const payload = parsed as Partial<PersistedNodePositionsV6>;

    if (payload.version !== nodePositionsVersion) return [];
    if (payload.direction !== expectedDirection) return [];
    if (payload.topologySignature !== expectedTopologySignature) return [];
    if (!Array.isArray(payload.positions)) return [];

    return payload.positions.filter(isValidPosItem);
  };

  const writePersistedPositions = (
    key: string,
    direction: "TB" | "LR",
    topologySignature: string,
    positions: Array<{ id: string; position: { x: number; y: number } }>
  ) => {
    const payload: PersistedNodePositionsV6 = {
      version: nodePositionsVersion,
      direction,
      topologySignature,
      positions,
    };

    localStorage.setItem(key, JSON.stringify(payload));
  };

  type PersistedViewportV1 = {
    version: 1;
    viewMode: "hierarchical" | "grid" | "table";
    direction: "TB" | "LR";
    viewport: {
      x: number;
      y: number;
      zoom: number;
    };
  };

  const isValidViewport = (value: any): value is { x: number; y: number; zoom: number } => {
    // isValidViewport
    return (
      typeof value?.x === "number" &&
      Number.isFinite(value.x) &&
      typeof value?.y === "number" &&
      Number.isFinite(value.y) &&
      typeof value?.zoom === "number" &&
      Number.isFinite(value.zoom) &&
      value.zoom > 0
    );
  };

  const readPersistedViewport = (): { x: number; y: number; zoom: number } | null => {
    // readPersistedViewport
    if (!projectName || viewMode === "table") return null;

    try {
      const parsed = safeParseJson(localStorage.getItem(viewportStorageKey));
      if (!parsed || typeof parsed !== "object") return null;

      const payload = parsed as PersistedViewportV1;

      if (payload.version !== 1) return null;
      if (payload.viewMode !== viewMode) return null;
      if (payload.direction !== graphDirection) return null;
      if (!isValidViewport(payload.viewport)) return null;

      return {
        x: payload.viewport.x,
        y: payload.viewport.y,
        zoom: viewMode === "grid" ? GRID_ZOOM : clampZoom(payload.viewport.zoom),
      };
    } catch {
      return null;
    }
  };

  const writePersistedViewport = (nextViewport: { x: number; y: number; zoom: number }) => {
    // writePersistedViewport
    if (!projectName || viewMode === "table") return;

    try {
      const normalizedViewport = {
        x: nextViewport.x,
        y: nextViewport.y,
        zoom: viewMode === "grid" ? GRID_ZOOM : clampZoom(nextViewport.zoom),
      };

      const payload: PersistedViewportV1 = {
        version: 1,
        viewMode,
        direction: graphDirection,
        viewport: normalizedViewport,
      };

      localStorage.setItem(viewportStorageKey, JSON.stringify(payload));
    } catch {
      // noOp
    }
  };


  const handleNodesChangeWithPersistence = (changes: NodeChange[]) => {
    if (disablePersistenceRef.current || viewMode !== "hierarchical") {
      return onNodesChange(changes);
    }

    setNodes((nds) => {
      const manualOrigins = readManualNodeOrigins();
      let manualOriginsChanged = false;

      for (const change of changes) {
        if (change.type !== "position" || (change as any).dragging !== true) {
          continue;
        }

        const nodeId = String(change.id);

        if (nodeId === "PROJECT" || manualOrigins.has(nodeId)) {
          continue;
        }

        const currentNode = nds.find((node) => String(node.id) === nodeId);
        const currentPosition = currentNode?.position;

        if (
          !currentPosition ||
          !Number.isFinite(currentPosition.x) ||
          !Number.isFinite(currentPosition.y)
        ) {
          continue;
        }

        manualOrigins.set(nodeId, {
          x: currentPosition.x,
          y: currentPosition.y,
        });

        manualOriginsChanged = true;
      }

      if (manualOriginsChanged) {
        writeManualNodeOrigins(manualOrigins);
      }

      const updated = applyNodeChanges(changes, nds);
      const shouldRecenterProject = changes.some((change) => change.type !== "select");
      const resolvedNodes = shouldRecenterProject
        ? centerProjectOverGraphBranches(updated, graphDirection)
        : updated;

      const positions = resolvedNodes.map((node) => ({
        id: node.id,
        position: node.position,
      }));

      try {
        const topologySignature = graphTopologySignatureRef.current;

        if (topologySignature) {
          writePersistedPositions(storageKeyHier, graphDirection, topologySignature, positions);
        }
      } catch {
        // noOp
      }

      return resolvedNodes;
    });
  };

  const centerProjectOverGraphBranches = (
    sourceNodes: Node[],
    dirOverride?: "TB" | "LR"
  ): Node[] => {
    const dir = dirOverride ?? graphDirection;
    const projectNode = sourceNodes.find((n) => String(n.id) === "PROJECT");
    if (!projectNode?.position) return sourceNodes;

    const branchNodes = sourceNodes.filter((n) => {
      if (String(n.id) === "PROJECT") return false;

      const position = n.position;
      return (
        typeof position?.x === "number" &&
        Number.isFinite(position.x) &&
        typeof position?.y === "number" &&
        Number.isFinite(position.y)
      );
    });

    if (branchNodes.length === 0) return sourceNodes;

    const getAxis = (pos: { x: number; y: number }) => (dir === "TB" ? pos.x : pos.y);

    const setAxis = (pos: { x: number; y: number }, axis: number) =>
      dir === "TB" ? { x: axis, y: pos.y } : { x: pos.x, y: axis };

    const getAxisSizeForNode = (node: Node<any>) => {
      const anyNode: any = node as any;
      const measuredWidth = Number(anyNode.measured?.width ?? anyNode.width);
      const measuredHeight = Number(anyNode.measured?.height ?? anyNode.height);

      const width =
        Number.isFinite(measuredWidth) && measuredWidth > 0
          ? Math.ceil(measuredWidth)
          : 900;

      const height =
        Number.isFinite(measuredHeight) && measuredHeight > 0
          ? Math.ceil(measuredHeight)
          : 520;

      return (dir === "TB" ? width : height) + 40;
    };

    let minAxis = Infinity;
    let maxAxis = -Infinity;

    for (const node of branchNodes) {
      const axis = getAxis(node.position);
      const axisSize = getAxisSizeForNode(node);

      minAxis = Math.min(minAxis, axis - axisSize / 2);
      maxAxis = Math.max(maxAxis, axis + axisSize / 2);
    }

    if (!Number.isFinite(minAxis) || !Number.isFinite(maxAxis)) return sourceNodes;

    const centeredAxis = (minAxis + maxAxis) / 2;
    const currentProjectAxis = getAxis(projectNode.position);

    if (Math.abs(currentProjectAxis - centeredAxis) < 1) {
      return sourceNodes;
    }

    const nextProjectPosition = setAxis(projectNode.position, centeredAxis);

    return sourceNodes.map((node) =>
      String(node.id) === "PROJECT"
        ? {
          ...node,
          position: nextProjectPosition,
        }
        : node
    );
  };

  const getProjectPositionChange = (
    beforeNodes: Node[],
    afterNodes: Node[]
  ): { id: string; position: { x: number; y: number } } | null => {
    const beforeProject = beforeNodes.find((n) => String(n.id) === "PROJECT");
    const afterProject = afterNodes.find((n) => String(n.id) === "PROJECT");

    const beforePosition = beforeProject?.position;
    const afterPosition = afterProject?.position;

    if (
      !afterPosition ||
      typeof afterPosition.x !== "number" ||
      typeof afterPosition.y !== "number" ||
      !Number.isFinite(afterPosition.x) ||
      !Number.isFinite(afterPosition.y)
    ) {
      return null;
    }

    if (
      beforePosition &&
      beforePosition.x === afterPosition.x &&
      beforePosition.y === afterPosition.y
    ) {
      return null;
    }

    return {
      id: "PROJECT",
      position: {
        x: afterPosition.x,
        y: afterPosition.y,
      },
    };
  };

  const loadNodesWithPositions = (
    loadedNodes: Node[],
    protocols: Record<string, any>,
    options?: { ignoreSaved?: boolean }
  ): Node[] => {
    const topologySignature = getGraphTopologySignature(protocols);
    graphTopologySignatureRef.current = topologySignature;

    const saved = options?.ignoreSaved
      ? []
      : readPersistedPositions(
        storageKeyHier,
        graphDirection,
        topologySignature
      );

    const savedById = new Map<string, { x: number; y: number }>();

    for (const item of saved) {
      savedById.set(item.id, item.position);
    }

    const nodesWithPositions = saved.length
      ? loadedNodes.map((node) => {
        if (String(node.id) === "PROJECT") return node;

        const savedPosition = savedById.get(String(node.id));

        return savedPosition
          ? { ...node, position: savedPosition }
          : node;
      })
      : loadedNodes;

    const resolvedNodes = centerProjectOverGraphBranches(
      nodesWithPositions,
      graphDirection
    );

    try {
      writePersistedPositions(
        storageKeyHier,
        graphDirection,
        topologySignature,
        resolvedNodes.map((node) => ({
          id: String(node.id),
          position: node.position,
        }))
      );
    } catch {
      // noOp
    }

    return resolvedNodes;
  };


  const preservePendingExistingNodePositions = (
    loadedNodes: Node[],
  ): Node[] => {
    const pending = pendingNewNodesRef.current;
    if (pending?.reflowWholeGraph) {
      return centerProjectOverGraphBranches(loadedNodes, graphDirection);
    }

    if (!pending?.beforePositions || viewModeRef.current !== "hierarchical") {
      return centerProjectOverGraphBranches(loadedNodes, graphDirection);
    }

    const nodesWithPreservedPositions = loadedNodes.map((node) => {
      // PROJECT should remain centered over the current graph branches.
      // Do not freeze its old position during incremental add/duplicate refreshes.
      if (String(node.id) === "PROJECT") return node;

      const previousPosition = pending.beforePositions?.get(String(node.id));
      if (!previousPosition) return node;

      return {
        ...node,
        position: previousPosition,
      };
    });

    return centerProjectOverGraphBranches(nodesWithPreservedPositions, graphDirection);
  };


  const compactSurvivingProjectBranchesAfterDeletion = (
    sourceNodes: Node[],
    currentEdges: Edge[],
    dir: "TB" | "LR"
  ): Node[] => {
    const nodeById = new Map(sourceNodes.map((node) => [String(node.id), node]));
    const protocolNodes = sourceNodes.filter((node) => String(node.id) !== "PROJECT");

    if (protocolNodes.length < 2) {
      return sourceNodes;
    }

    const getAxis = (node: Node): number => dir === "TB" ? node.position.x : node.position.y;

    const setAxis = (node: Node, axis: number): Node => ({
      ...node,
      position: dir === "TB"
        ? { ...node.position, x: axis }
        : { ...node.position, y: axis },
    });

    const getNodeAxisSize = (node: Node): number => {
      const measured = (node as any).measured;
      const measuredWidth = Number(measured?.width ?? node.width);
      const measuredHeight = Number(measured?.height ?? node.height);
      const width = Number.isFinite(measuredWidth) && measuredWidth > 0 ? Math.ceil(measuredWidth) : 950;
      const height = Number.isFinite(measuredHeight) && measuredHeight > 0 ? Math.ceil(measuredHeight) : 520;

      return (dir === "TB" ? width : height) + 40;
    };

    const outgoingBySource = new Map<string, string[]>();
    const incomingFromProtocols = new Map<string, number>();
    const projectRootIds = new Set<string>();

    for (const edge of currentEdges) {
      const sourceId = String(edge.source);
      const targetId = String(edge.target);

      if (!nodeById.has(targetId)) continue;

      if (sourceId === "PROJECT") {
        projectRootIds.add(targetId);
        continue;
      }

      if (!nodeById.has(sourceId)) continue;

      const children = outgoingBySource.get(sourceId) ?? [];

      if (!children.includes(targetId)) {
        children.push(targetId);
        outgoingBySource.set(sourceId, children);
      }

      incomingFromProtocols.set(targetId, (incomingFromProtocols.get(targetId) ?? 0) + 1);
    }

    for (const node of protocolNodes) {
      const nodeId = String(node.id);

      if ((incomingFromProtocols.get(nodeId) ?? 0) === 0) {
        projectRootIds.add(nodeId);
      }
    }

    const rootIds = Array.from(projectRootIds)
      .filter((id) => nodeById.has(id))
      .sort((leftId, rightId) => {
        const leftNode = nodeById.get(leftId)!;
        const rightNode = nodeById.get(rightId)!;
        return getAxis(leftNode) - getAxis(rightNode);
      });

    if (rootIds.length < 2) {
      return sourceNodes;
    }

    const reachableByRoot = new Map<string, Set<string>>();

    for (const rootId of rootIds) {
      const reachable = new Set<string>();
      const pendingIds = [rootId];

      while (pendingIds.length > 0) {
        const currentId = pendingIds.pop();

        if (!currentId || reachable.has(currentId) || !nodeById.has(currentId)) {
          continue;
        }

        reachable.add(currentId);

        for (const childId of outgoingBySource.get(currentId) ?? []) {
          pendingIds.push(childId);
        }
      }

      reachableByRoot.set(rootId, reachable);
    }

    const nodeIdsByRoot = new Map<string, string[]>();

    for (const rootId of rootIds) {
      nodeIdsByRoot.set(rootId, []);
    }

    for (const node of protocolNodes) {
      const nodeId = String(node.id);
      const nodeAxis = getAxis(node);

      const candidateRootIds = rootIds.filter((rootId) => reachableByRoot.get(rootId)?.has(nodeId));

      const resolvedRootId = (candidateRootIds.length > 0 ? candidateRootIds : rootIds)
        .slice()
        .sort((leftId, rightId) => {
          const leftDistance = Math.abs(getAxis(nodeById.get(leftId)!) - nodeAxis);
          const rightDistance = Math.abs(getAxis(nodeById.get(rightId)!) - nodeAxis);

          if (leftDistance !== rightDistance) {
            return leftDistance - rightDistance;
          }

          return getAxis(nodeById.get(leftId)!) - getAxis(nodeById.get(rightId)!);
        })[0];

      nodeIdsByRoot.get(resolvedRootId)?.push(nodeId);
    }

    const branchBlocks = rootIds
      .map((rootId) => {
        const nodeIds = nodeIdsByRoot.get(rootId) ?? [];
        let minAxis = Number.POSITIVE_INFINITY;
        let maxAxis = Number.NEGATIVE_INFINITY;

        for (const nodeId of nodeIds) {
          const node = nodeById.get(nodeId);

          if (!node) continue;

          const axis = getAxis(node);
          const size = getNodeAxisSize(node);

          minAxis = Math.min(minAxis, axis - size / 2);
          maxAxis = Math.max(maxAxis, axis + size / 2);
        }

        return {
          rootId,
          nodeIds,
          minAxis,
          maxAxis,
        };
      })
      .filter((block) => block.nodeIds.length > 0 && Number.isFinite(block.minAxis) && Number.isFinite(block.maxAxis))
      .sort((left, right) => left.minAxis - right.minAxis);

    if (branchBlocks.length < 2) {
      return sourceNodes;
    }

    const branchGap = dir === "TB" ? 80 : 120;
    const axisOffsetByNodeId = new Map<string, number>();
    let previousMaxAxis = branchBlocks[0].maxAxis;

    for (let index = 1; index < branchBlocks.length; index++) {
      const block = branchBlocks[index];
      const targetMinAxis = previousMaxAxis + branchGap;
      const offset = Math.min(0, targetMinAxis - block.minAxis);

      for (const nodeId of block.nodeIds) {
        axisOffsetByNodeId.set(nodeId, offset);
      }

      previousMaxAxis = Math.max(previousMaxAxis, block.maxAxis + offset);
    }

    return sourceNodes.map((node) => {
      const nodeId = String(node.id);

      if (nodeId === "PROJECT") {
        return node;
      }

      const offset = axisOffsetByNodeId.get(nodeId) ?? 0;

      return Math.abs(offset) > 0.5
        ? setAxis(node, getAxis(node) + offset)
        : node;
    });
  };

  const preservePendingDeletedNodePositions = (
    loadedNodes: Node[],
    currentEdges: Edge[]
  ): Node[] => {
    const pending = pendingDeletionRef.current;

    if (!pending || viewModeRef.current !== "hierarchical") {
      return loadedNodes;
    }

    const nodesWithPreservedPositions = loadedNodes.map((node) => {
      if (String(node.id) === "PROJECT") return node;

      const previousPosition = pending.beforePositions.get(String(node.id));

      return previousPosition
        ? { ...node, position: previousPosition }
        : node;
    });

    const compactedNodes = compactSurvivingProjectBranchesAfterDeletion(nodesWithPreservedPositions, currentEdges, graphDirection);
    const resolvedNodes = centerProjectOverGraphBranches(compactedNodes, graphDirection);
    const topologySignature = graphTopologySignatureRef.current;

    if (topologySignature) {
      const positions = resolvedNodes.map((node) => ({
        id: String(node.id),
        position: node.position,
      }));

      try {
        writePersistedPositions(storageKeyHier, graphDirection, topologySignature, positions);
      } catch {
        // noOp
      }
    }

    return resolvedNodes;
  };

  const mergeEdges = (newEdges: Edge[]) => {
    const oldEdgesMap = new Map(edges.map((e) => [e.id, e]));
    return newEdges.map((e) => (oldEdgesMap.get(e.id) ? { ...oldEdgesMap.get(e.id)!, ...e } : e));
  };


  // persistPositionsBulk writes multiple node positions in a single localStorage write
  const persistPositionsBulk = (
    direction: "TB" | "LR",
    items: Array<{ id: string; position: { x: number; y: number } }>
  ) => {
    try {
      const topologySignature = graphTopologySignatureRef.current;
      if (!topologySignature) return;

      const saved = readPersistedPositions(
        storageKeyHier,
        direction,
        topologySignature
      );

      const positionsById = new Map(
        saved.map((item) => [item.id, item.position])
      );

      for (const item of items) {
        positionsById.set(item.id, item.position);
      }

      const merged = Array.from(
        positionsById.entries()
      ).map(([id, position]) => ({
        id,
        position,
      }));

      writePersistedPositions(
        storageKeyHier,
        direction,
        topologySignature,
        merged
      );
    } catch {
      // noOp
    }
  };

  const preparePendingAddProtocolFromForm = () => {
    if (viewModeRef.current !== "hierarchical") return;

    const beforeIds = new Set(nodesRef.current.map((n) => String(n.id)));
    const beforePositions = new Map<string, { x: number; y: number }>();

    for (const node of nodesRef.current) {
      const nodeId = String(node.id ?? "").trim();
      const position = node.position;

      if (!nodeId || !position) continue;

      if (
        typeof position.x !== "number" ||
        typeof position.y !== "number" ||
        !Number.isFinite(position.x) ||
        !Number.isFinite(position.y)
      ) {
        continue;
      }

      beforePositions.set(nodeId, {
        x: position.x,
        y: position.y,
      });
    }

    pendingNewNodesRef.current = {
      beforeIds,
      beforePositions,
      operation: "add",
      reflowWholeGraph: true,
    };
  };

  /* ------------------------ Wait for nodes helper ------------------------ */
  const waitForNodesReady = async (expectedCount: number, timeoutMs = 2500): Promise<boolean> => {
    const inst = reactFlowInstanceRef.current ?? (window as any).reactFlowInstance;
    if (!inst) return false;
    const start = Date.now();
    return new Promise<boolean>((resolve) => {
      const check = () => {
        try {
          const instNodes = typeof inst.getNodes === "function" ? inst.getNodes() : [];
          const needed = Math.max(1, expectedCount);
          if (instNodes && instNodes.length >= needed) {
            let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, valid = 0;
            for (const n of instNodes) {
              const x = (n.position?.x), y = (n.position?.y);
              if (typeof x === "number" && typeof y === "number" && !Number.isNaN(x) && !Number.isNaN(y)) {
                valid++;
                if (x < minX) minX = x;
                if (x > maxX) maxX = x;
                if (y < minY) minY = y;
                if (y > maxY) maxY = y;
              }
            }
            const w = isFinite(minX) && isFinite(maxX) ? Math.abs(maxX - minX) : 0;
            const h = isFinite(minY) && isFinite(maxY) ? Math.abs(maxY - minY) : 0;
            if (valid >= 1 && (w > 1 || h > 1)) return resolve(true);
          }
        } catch { }
        if (Date.now() - start > timeoutMs) return resolve(false);
        requestAnimationFrame(check);
      };
      requestAnimationFrame(check);
    });
  };

  useEffect(() => {
    // resetFirstCenterOnProjectChange
    outputThumbnailCacheRef.current.clear();
    outputThumbnailRetryAfterRef.current.clear();
    outputThumbnailInFlightRef.current = null;

    firstLoadRef.current = true;
    setNodesLoadedOnce(false);

    // resetViewportForInitialPaint
    const nextZoom = viewModeRef.current === "grid" ? GRID_ZOOM : clampZoom(viewportRef.current.zoom);
    setViewport({ x: 0, y: 0, zoom: nextZoom });
  }, [projectName]);


  /* ------------------------ Fetch & load (NO refetch on view change) ------------------------ */
  const fetchAndLoadProject = useCallback(async () => {
    if (!projectName) return;
    setIsRefreshing(true);
    try {
      const data = await svc.fetchProject(projectName);
      setProject(data);
      setTagAssignments(extractAssignmentsFromProjectProtocols((data as any)?.protocols));

      const loadedProjectId =
        (data as any)?.id ??
        (data as any)?.projectId;

      const effectiveSettings = await loadProjectEffectiveSettings(loadedProjectId);

      const effectiveUserSettings =
        effectiveSettings?.settings?.user as Record<string, unknown> | null | undefined;

      const shouldLoadProtocolThumbnails =
        effectiveUserSettings?.protocolOutputThumbnailsEnabled === true;

      if (data.protocols) {
        const mode = viewModeRef.current;
        const dir = graphDirectionRef2.current;
        const width = gridWidthRef.current || flowWrapperRef.current?.clientWidth;
        const effectiveZoom = mode === "grid" ? GRID_ZOOM : viewportRef.current.zoom;

        const { nodes: loadedNodes, edges: loadedEdges, table } = buildGraphElements(
          data.shortName, data.protocols, mode, dir, width, effectiveZoom
        );

        const tableWithTick = (
          table ?? []
        ).map((row) =>
          mergeTableElapsedTick(row)
        );

        if (mode === "table") {
          setTableData(tableWithTick);

          setIsLoadingProject(false);
          setIsRefreshing(false);
          return;
        }

        const nodesWithPositions =
          mode === "hierarchical"
            ? loadNodesWithPositions(loadedNodes, data.protocols)
            : loadedNodes;

        const nodesWithTick =
          nodesWithPositions.map((node) =>
            mergeNodeElapsedTick(
              node as Node<StatusNodeData>,
            )
          );

        const unifiedSelectedIds = getUnifiedSelectedIds();
        const recomputedEdgeSet = unifiedSelectedIds.size
          ? computeEdgesForMode(unifiedSelectedIds, pathEdgeModeRef.current)
          : new Set<string>();
        pathSelRef.current.edges = recomputedEdgeSet;

        let nextNodes: Node<StatusNodeData>[] = nodesWithTick.map((n) => {
          const node = n as Node<StatusNodeData>;

          return {
            ...node,
            selected: unifiedSelectedIds.has(node.id),
          };
        });

        startTransition(() => {
          setNodes(nextNodes);
          setEdges((_) => {
            let base = mode === "grid" ? [] : loadedEdges;
            base = paintEdgeHighlight(base, selectedIdRef.current ?? null);
            if (recomputedEdgeSet.size) base = paintPathHighlight(base, recomputedEdgeSet);
            return base;
          });
          setTableData(tableWithTick);
        });

        if (shouldLoadProtocolThumbnails) {
          void loadProtocolOutputThumbnailsForNodes(
            loadedProjectId,
            nextNodes,
            true,
          );
        }

        setNodesLoadedOnce(true);

        if (mode === "grid") {
          requestAnimationFrame(() => {
            if (skipNextGridSnapRef.current) {
              skipNextGridSnapRef.current = false;
              return;
            }

            snapViewportToTopLeft(GRID_ZOOM);
          });
        }
      }
    } catch (err) {
      console.error("fetchAndLoadProject error:", err);
    } finally {
      setIsRefreshing(false);
      setIsLoadingProject(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    projectName,
    svc,
    paintEdgeHighlight,
    paintPathHighlight,
    computeEdgesForMode,
    snapViewportToTopLeft,
    fetchProtocolOutputThumbnailItemsForNodes,
  ]);

  useEffect(() => {
    setIsLoadingProject(true);
    setProjectEffectiveSettings(null);
    setProjectEffectiveSettingsLoading(false);

    outputThumbnailCacheRef.current.clear();
    outputThumbnailRetryAfterRef.current.clear();
    outputThumbnailInFlightRef.current = null;
  }, [projectName]);

  useEffect(() => {
    if (!projectName) return;

    void fetchAndLoadProject();
  }, [projectName, fetchAndLoadProject]);

  /* ------------------------ Refresh ------------------------ */
  const handleRefresh = useCallback(async () => {
    if (!projectName) return;
    setIsRefreshing(true);
    try {
      const data = await svc.fetchProject(projectName);
      setProject(data);
      setTagAssignments(extractAssignmentsFromProjectProtocols((data as any)?.protocols));

      if (data.protocols) {
        const preferredChildOrder = viewMode === "hierarchical" && graphDirection === "TB"
          ? buildPreferredTbChildOrderFromGraph(nodesRef.current, edgesRef.current)
          : undefined;

        const { nodes: loadedNodes, edges: loadedEdges, table } = buildGraphElements(
          data.shortName,
          data.protocols,
          viewMode,
          graphDirection,
          gridWidth || flowWrapperRef.current?.clientWidth,
          getEffectiveZoom(),
          undefined,
          preferredChildOrder ? { preferredChildOrder } : undefined
        );

        const freshTableRows = table ?? [];

        const currentNodesById = new Map(
          (
            nodesRef.current as
            Node<StatusNodeData>[]
          ).map((node) => [
            String(node.id),
            node,
          ])
        );

        if (viewMode === "table") {
          setTableData((currentRows) => {
            const currentRowsById = new Map(
              currentRows.map((row) => [
                String(row.id),
                row,
              ])
            );

            return freshTableRows.map(
              (freshRow) =>
                mergeTableElapsedTick(
                  freshRow,
                  currentRowsById.get(
                    String(freshRow.id),
                  ),
                  currentNodesById.get(
                    String(freshRow.id),
                  ),
                )
            );
          });

          setIsRefreshing(false);
          return;
        }

        let hierarchicalNodes = loadedNodes;

        if (viewMode === "hierarchical") {
          const pendingNewNodes =
            pendingNewNodesRef.current;

          if (
            pendingNewNodes?.reflowWholeGraph
          ) {
            hierarchicalNodes =
              loadNodesWithPositions(
                loadedNodes,
                data.protocols,
                { ignoreSaved: true }
              );
          } else if (
            pendingNewNodes &&
            graphDirection === "TB"
          ) {
            const canonicalNodes =
              loadNodesWithPositions(
                loadedNodes,
                data.protocols,
                { ignoreSaved: true }
              );

            const placement =
              placePendingNewNodesAtCanonicalTbPositions(
                canonicalNodes,
                loadedEdges
              );

            hierarchicalNodes =
              placement.nodes;

            if (placement.resolved) {
              const topologySignature =
                graphTopologySignatureRef.current;

              if (topologySignature) {
                try {
                  writePersistedPositions(
                    storageKeyHier,
                    graphDirection,
                    topologySignature,
                    hierarchicalNodes.map((node) => ({
                      id: String(node.id),
                      position: node.position,
                    }))
                  );
                } catch {
                  // noOp
                }
              }

              pendingNewNodesRef.current =
                null;

              pendingPlacementRef.current =
                null;
            }
          } else {
            hierarchicalNodes =
              preservePendingExistingNodePositions(
                loadNodesWithPositions(
                  loadedNodes,
                  data.protocols
                )
              );
          }

          hierarchicalNodes =
            preservePendingDeletedNodePositions(
              hierarchicalNodes,
              loadedEdges
            );
        }

        const nodesWithPositions =
          viewMode === "hierarchical"
            ? hierarchicalNodes
            : loadedNodes;

        const edgesMerged = viewMode === "grid" ? [] : mergeEdges(loadedEdges);
        edgesRef.current = edgesMerged;

        const unifiedSelectedIds = getUnifiedSelectedIds();
        const nodesSeed =
          nodesWithPositions.map(
            (freshNode) => {
              const mergedNode =
                mergeNodeOutputs(
                  mergeNodeElapsedTick(
                    freshNode as Node<StatusNodeData>,

                    currentNodesById.get(
                      String(freshNode.id),
                    ),
                  ),
                  currentNodesById.get(
                    String(freshNode.id),
                  ) as Node<StatusNodeData> | undefined,
                );

              return {
                ...mergedNode,
                selected:
                  unifiedSelectedIds.has(
                    freshNode.id
                  ),
              };
            }
          );

        const nodesSeedWithThumbnails = preserveExistingOutputThumbnails(
          nodesSeed as Node<StatusNodeData>[],
          nodesRef.current,
        );

        const recomputedEdgeSet = unifiedSelectedIds.size
          ? computeEdgesForMode(unifiedSelectedIds, pathEdgeModeRef.current)
          : new Set<string>();
        pathSelRef.current.edges = recomputedEdgeSet;

        setNodes(
          nodesSeedWithThumbnails
        );

        setEdges((_) => {
          let out = paintEdgeHighlight(
            edgesMerged,
            selectedIdRef.current ?? null
          );

          if (recomputedEdgeSet.size) {
            out = paintPathHighlight(
              out,
              recomputedEdgeSet
            );
          }

          return out;
        });

        setTableData((currentRows) => {
          const currentRowsById = new Map(
            currentRows.map((row) => [
              String(row.id),
              row,
            ])
          );

          return freshTableRows.map(
            (freshRow) =>
              mergeTableElapsedTick(
                freshRow,

                currentRowsById.get(
                  String(freshRow.id),
                ),

                currentNodesById.get(
                  String(freshRow.id),
                ),
              )
          );
        });

        if (protocolOutputThumbnailsEnabled) {
          void loadProtocolOutputThumbnailsForNodes(
            (data as any)?.id ?? (data as any)?.projectId,
            nodesSeedWithThumbnails,
          );
        }


        if (viewMode === "grid") {
          requestAnimationFrame(() => snapViewportToTopLeft(GRID_ZOOM));
        }
      }
      void refreshOpenFormsDetails();
    } catch (err) {
      console.error(err);
    } finally {
      setIsRefreshing(false);

      if (pendingPlacementRef.current) {
        setTimeout(() => tryPlaceNewlyCreatedNode(), 50);
        setTimeout(() => tryPlaceNewlyCreatedNode(), 400);
        setTimeout(() => tryPlaceNewlyCreatedNode(), 1200);
      }

      if (pendingNewNodesRef.current) {
        setTimeout(() => tryResolveNewNodesCollisions(), 80);
        setTimeout(() => tryResolveNewNodesCollisions(), 420);
        setTimeout(() => tryResolveNewNodesCollisions(), 1250);
      }
    }

  }, [projectName, viewMode, graphDirection, svc, paintEdgeHighlight, paintPathHighlight, computeEdgesForMode, gridWidth]);

  const liveProtocolIdsKey =
    useMemo(
      () =>
        nodes
          .filter(
            (node) =>
              String(
                node.id
              ) !== "PROJECT"
              &&
              isLiveProtocolStatus(
                node.data?.status
              )
          )
          .map(
            (node) =>
              String(
                node.id
              )
          )
          .sort(
            (a, b) =>
              Number(a)
              - Number(b)
          )
          .join(","),
      [
        nodes,
      ],
    );

  const handleRefreshRef = useRef(handleRefresh);
  useEffect(() => { handleRefreshRef.current = handleRefresh; }, [handleRefresh]);


  // Refresh only active protocols without rebuilding the workflow graph.
  useEffect(() => {
    const refreshSeconds =
      Number(
        workflowAutoRefreshSec
        ?? 5
      );

    if (
      !Number.isFinite(
        refreshSeconds
      )
      ||
      refreshSeconds <= 0
      ||
      !liveProtocolIdsKey
      ||
      projectId == null
    ) {
      return;
    }

    const protocolIds =
      liveProtocolIdsKey
        .split(",")
        .map(
          (protocolId) =>
            protocolId.trim()
        )
        .filter(Boolean);

    if (!protocolIds.length) {
      return;
    }

    let cancelled = false;

    let timerId:
      number | null = null;

    const delay =
      refreshSeconds
      * 1000;


    const refreshLiveProtocols =
      async () => {
        const fetchRuntime =
          (
            svc as any
          )
            .fetchProtocolRuntimeSummaries;

        // Backward-compatible fallback.
        if (
          typeof fetchRuntime
          !== "function"
        ) {
          await (
            handleRefreshRef
              .current?.()
          );

          return;
        }

        try {
          const summaries:
            ProtocolRuntimeSummary[] =
            await fetchRuntime(
              projectId,
              protocolIds,
            );

          if (cancelled) {
            return;
          }

          applyProtocolRuntimeSummaries(summaries);

          if (protocolOutputThumbnailsEnabled) {
            const runtimeOutputsByProtocolId =
              new Map<string, unknown[]>();

            for (const summary of summaries) {
              if (
                !Array.isArray(summary.outputs)
                ||
                !summary.outputs.length
              ) {
                continue;
              }

              runtimeOutputsByProtocolId.set(
                String(summary.protocolId),
                summary.outputs,
              );
            }

            const nodesMissingRuntimeThumbnails = (
              nodesRef.current as
              Node<StatusNodeData>[]
            ).flatMap((node) => {
              const outputs =
                runtimeOutputsByProtocolId.get(
                  String(node.id)
                );

              if (!outputs?.length) {
                return [];
              }

              const outputThumbnails =
                node.data?.outputThumbnails
                ?? {};

              const missingOutputs =
                outputs.filter((output) => {
                  const outputName =
                    getOutputNameFromNodeOutput(
                      output
                    );

                  return (
                    !!outputName
                    &&
                    !outputThumbnails[
                    outputName
                    ]
                  );
                });

              if (!missingOutputs.length) {
                return [];
              }

              return [{
                ...node,
                data: {
                  ...node.data,
                  outputs: missingOutputs,
                },
              }];
            });

            if (
              nodesMissingRuntimeThumbnails.length
            ) {
              void loadProtocolOutputThumbnailsForNodes(
                projectId,
                nodesMissingRuntimeThumbnails,
              );
            }
          }

          for (
            const summary
            of summaries
          ) {
            // Once the protocol leaves the
            // active state, refresh its
            // details once to obtain outputs.
            if (
              !isLiveProtocolStatus(
                summary.status
              )
            ) {
              try {
                const details =
                  await (
                    svc
                      .fetchProtocolDetails(
                        projectId,
                        summary.protocolId,
                      )
                  );

                if (cancelled) {
                  return;
                }

                syncProtocolDetailsToGraphRef
                  .current?.(
                    String(
                      summary.protocolId
                    ),
                    details,
                  );

              } catch (error) {
                console.warn(
                  "Final protocol details refresh failed",
                  error,
                );
              }
            }
          }

        } catch (error) {
          console.warn(
            "Live protocol runtime refresh failed",
            error,
          );
        }
      };


    const scheduleRefresh = () => {
      timerId =
        window.setTimeout(
          async () => {
            await (
              refreshLiveProtocols()
            );

            if (cancelled) {
              return;
            }

            scheduleRefresh();
          },
          delay,
        );
    };


    scheduleRefresh();


    return () => {
      cancelled = true;

      if (timerId != null) {
        window.clearTimeout(
          timerId
        );
      }
    };
  }, [
    workflowAutoRefreshSec,
    liveProtocolIdsKey,
    projectId,
    svc,
    applyProtocolRuntimeSummaries,
    protocolOutputThumbnailsEnabled,
    loadProtocolOutputThumbnailsForNodes,
  ]);

  useEffect(() => {
    return () => {
      if (delayedRefreshTimerRef.current !== null) {
        clearTimeout(delayedRefreshTimerRef.current);
        delayedRefreshTimerRef.current = null;
      }
    };
  }, []);

  // --- Double refresh helper (immediate + delayed) ---
  const scheduleDoubleRefresh = (delayMs = 5000, alsoPlace = false) => {
    handleRefreshRef.current?.();
    if (alsoPlace) setTimeout(() => tryPlaceNewlyCreatedNode(), 100);

    if (delayedRefreshTimerRef.current !== null) clearTimeout(delayedRefreshTimerRef.current);
    delayedRefreshTimerRef.current = window.setTimeout(() => {
      handleRefreshRef.current?.();
      if (alsoPlace) setTimeout(() => tryPlaceNewlyCreatedNode(), 100);
    }, delayMs);
  };


  /* ------------------------ Reflow on grid width change ------------------------ */
  useEffect(() => {
    if (viewMode !== "grid") return;
    if (!project?.protocols) return;

    const { nodes: newNodes } = buildGraphElements(
      project.shortName,
      project.protocols,
      "grid",
      graphDirection,
      gridWidth || flowWrapperRef.current?.clientWidth,
      GRID_ZOOM
    );

    const sel =
      getUnifiedSelectedIds();

    const seeded =
      seedNodesWithSelectionAndThumbnails(
        newNodes,
        sel
      );

    const currentNodesById =
      new Map(
        (
          nodesRef.current as
          Node<StatusNodeData>[]
        ).map((node) => [
          String(node.id),
          node,
        ])
      );

    const seededWithLiveTicks =
      seeded.map((node) =>
        mergeNodeElapsedTick(
          node as Node<StatusNodeData>,

          currentNodesById.get(
            String(node.id),
          ),
        )
      );

    setNodes(seededWithLiveTicks);
    setEdges([]); // grid has no edges

    if (protocolOutputThumbnailsEnabled) {
      const currentProjectId = getProjectId();

      if (currentProjectId != null) {
        void loadProtocolOutputThumbnailsForNodes(currentProjectId, seededWithLiveTicks);
      }
    }

    requestAnimationFrame(() => snapViewportToTopLeft(GRID_ZOOM));
  }, [gridWidth,
    viewMode,
    project,
    graphDirection,
    snapViewportToTopLeft,
    seedNodesWithSelectionAndThumbnails,
    protocolOutputThumbnailsEnabled,
    loadProtocolOutputThumbnailsForNodes,
  ]);

  /* ------------------------ Reorganize ------------------------ */
  const handleReorganize = useCallback(
    async (opts?: { preserveZoom?: boolean }) => {
      if (!projectName) return;
      try {
        disablePersistenceRef.current = true;
        setHideGraphDuringCenter(true);

        const data = await svc.fetchProject(projectName);
        setProject(data);
        setTagAssignments(extractAssignmentsFromProjectProtocols((data as any)?.protocols));

        if (!data.protocols) {
          disablePersistenceRef.current = false;
          setHideGraphDuringCenter(false);
          return;
        }

        const preferredChildOrder = viewMode === "hierarchical" && graphDirection === "TB"
          ? buildPreferredTbChildOrderFromGraph(nodesRef.current, edgesRef.current)
          : undefined;

        const { nodes: loadedNodes, edges: loadedEdges, table } = buildGraphElements(
          data.shortName,
          data.protocols,
          viewMode,
          graphDirection,
          gridWidth || flowWrapperRef.current?.clientWidth,
          getEffectiveZoom(),
          undefined,
          preferredChildOrder ? { preferredChildOrder } : undefined
        );

        const currentNodesById =
          new Map(
            (
              nodesRef.current as
              Node<StatusNodeData>[]
            ).map((node) => [
              String(node.id),
              node,
            ])
          );

        if (viewMode === "table") {
          setTableData((currentRows) => {
            const currentRowsById =
              new Map(
                currentRows.map((row) => [
                  String(row.id),
                  row,
                ])
              );

            return (table ?? []).map(
              (freshRow) =>
                mergeTableElapsedTick(
                  freshRow,

                  currentRowsById.get(
                    String(freshRow.id),
                  ),

                  currentNodesById.get(
                    String(freshRow.id),
                  ),
                )
            );
          });

          disablePersistenceRef.current =
            false;

          setHideGraphDuringCenter(false);

          return;
        }

        const nodesWithPositions =
          viewMode === "hierarchical"
            ? loadNodesWithPositions(
              loadedNodes,
              data.protocols,
              { ignoreSaved: true }
            )
            : loadedNodes;

        if (viewMode === "hierarchical") {
          clearManualNodeOrigins();
        }

        const unifiedSelectedIds = getUnifiedSelectedIds();
        const nodesSeeded = seedNodesWithSelectionAndThumbnails(
          nodesWithPositions,
          unifiedSelectedIds,
        );

        const nodesWithLiveTicks =
          nodesSeeded.map((node) =>
            mergeNodeElapsedTick(
              node as Node<StatusNodeData>,

              currentNodesById.get(
                String(node.id),
              ),
            )
          );

        const recomputedEdgeSet = unifiedSelectedIds.size
          ? computeEdgesForMode(unifiedSelectedIds, pathEdgeModeRef.current)
          : new Set<string>();
        pathSelRef.current.edges = recomputedEdgeSet;

        startTransition(() => {
          setNodes(nodesWithLiveTicks);
          setEdges((_) => {
            let out = viewMode === "grid" ? [] : paintEdgeHighlight(loadedEdges, selectedIdRef.current ?? null);
            if (recomputedEdgeSet.size) out = paintPathHighlight(out, recomputedEdgeSet);
            return out;
          });

          if (protocolOutputThumbnailsEnabled) {
            const currentProjectId =
              (data as any)?.id ??
              (data as any)?.projectId ??
              getProjectId();

            if (currentProjectId != null) {
              void loadProtocolOutputThumbnailsForNodes(currentProjectId, nodesWithLiveTicks);
            }
          }
          setTableData((currentRows) => {
            const currentRowsById =
              new Map(
                currentRows.map((row) => [
                  String(row.id),
                  row,
                ])
              );

            return (table ?? []).map(
              (freshRow) =>
                mergeTableElapsedTick(
                  freshRow,

                  currentRowsById.get(
                    String(freshRow.id),
                  ),

                  currentNodesById.get(
                    String(freshRow.id),
                  ),
                )
            );
          });
        });

        requestAnimationFrame(() => {
          const inst = reactFlowInstanceRef.current ?? (window as any).reactFlowInstance;
          if (inst && nodesWithPositions.length > 0 && viewMode === "hierarchical") {
            const preserve = opts?.preserveZoom ?? true;
            centerLikeButton(nodesWithPositions, preserve, viewportRef.current.zoom);
          } else if (inst) {
            snapViewportToTopLeft(GRID_ZOOM);
          }
          disablePersistenceRef.current = false;
          setHideGraphDuringCenter(false);
        });
      } catch (err) {
        console.error(err);
        disablePersistenceRef.current = false;
        setHideGraphDuringCenter(false);
      }
    },
    [projectName, viewMode, graphDirection, centerLikeButton, svc, paintEdgeHighlight, paintPathHighlight, computeEdgesForMode, gridWidth,
      seedNodesWithSelectionAndThumbnails,
      protocolOutputThumbnailsEnabled,
      loadProtocolOutputThumbnailsForNodes,
    ]
  );

  /* ------------------------ Ticks updater ------------------------ */
  useEffect(() => {
    const interval =
      window.setInterval(() => {
        setNodes((currentNodes) => {
          let changed = false;

          const nextNodes =
            currentNodes.map((node) => {
              if (
                !isElapsedTimerStatus(
                  node.data?.status
                )
              ) {
                return node;
              }

              const currentElapsed =
                toElapsedSeconds(
                  node.data?.tick ??
                  node.data?.elapsedTime
                );

              changed = true;

              return {
                ...node,
                data: {
                  ...node.data,
                  tick:
                    currentElapsed + 1,
                },
              };
            });

          return changed
            ? nextNodes
            : currentNodes;
        });

        setTableData((currentRows) => {
          let changed = false;

          const nextRows =
            currentRows.map((row) => {
              if (
                !isElapsedTimerStatus(
                  row.status
                )
              ) {
                return row;
              }

              changed = true;

              return {
                ...row,
                tick:
                  toElapsedSeconds(
                    row.tick ??
                    row.elapsedTime
                  ) + 1,
              };
            });

          return changed
            ? nextRows
            : currentRows;
        });
      }, 1000);

    return () =>
      window.clearInterval(interval);
  }, [setNodes]);

  /* ------------------------ Layout change effect ------------------------ */
  const prevLayout = useRef({ viewMode, graphDirection });
  useLayoutEffect(() => {
    const layoutChanged =
      prevLayout.current.viewMode !== viewMode ||
      prevLayout.current.graphDirection !== graphDirection;
    if (!layoutChanged) return;
    if (!project?.protocols) {
      prevLayout.current = { viewMode, graphDirection };
      return;
    }

    if (viewMode === "table") {
      const { table } =
        buildGraphElements(
          project.shortName,
          project.protocols,
          "table",
          graphDirection,
          gridWidth ||
          flowWrapperRef.current
            ?.clientWidth,
          getEffectiveZoom(),
        );

      const currentNodesById =
        new Map(
          (
            nodesRef.current as
            Node<StatusNodeData>[]
          ).map((node) => [
            String(node.id),
            node,
          ])
        );

      setTableData((currentRows) => {
        const currentRowsById =
          new Map(
            currentRows.map((row) => [
              String(row.id),
              row,
            ])
          );

        return (table ?? []).map(
          (freshRow) =>
            mergeTableElapsedTick(
              freshRow,

              currentRowsById.get(
                String(freshRow.id),
              ),

              currentNodesById.get(
                String(freshRow.id),
              ),
            )
        );
      });

      if (
        pathSelRef.current.nodes
          .size === 0
      ) {
        setHighlightedId(
          selectedIdRef.current ?? null
        );
      }

      prevLayout.current = {
        viewMode,
        graphDirection,
      };

      return;
    }

    const instance = reactFlowInstanceRef.current ?? (window as any).reactFlowInstance;
    if (!instance) {
      prevLayout.current = { viewMode, graphDirection };
      return;
    }

    const { nodes: loadedNodes, edges: loadedEdges } =
      buildGraphElements(
        project.shortName,
        project.protocols,
        viewMode,
        graphDirection,
        gridWidth || flowWrapperRef.current?.clientWidth,
        getEffectiveZoom()
      );

    const nodesWithPositions =
      viewMode === "hierarchical" ? loadNodesWithPositions(loadedNodes, project.protocols) : loadedNodes;

    const unifiedSelectedIds = getUnifiedSelectedIds();
    const nodesSeeded = seedNodesWithSelectionAndThumbnails(
      nodesWithPositions,
      unifiedSelectedIds,
    );

    const currentNodesById = new Map(
      (
        nodesRef.current as
        Node<StatusNodeData>[]
      ).map((node) => [
        String(node.id),
        node,
      ])
    );

    const nodesWithLiveTicks =
      nodesSeeded.map((node) =>
        mergeNodeElapsedTick(
          node as Node<StatusNodeData>,

          currentNodesById.get(
            String(node.id),
          ),
        )
      );

    const recomputedEdgeSet = unifiedSelectedIds.size
      ? computeEdgesForMode(unifiedSelectedIds, pathEdgeModeRef.current)
      : new Set<string>();
    pathSelRef.current.edges = recomputedEdgeSet;

    disablePersistenceRef.current = true;
    setIsSwitchingLayout(true);

    setNodes(nodesWithLiveTicks);

    setEdges((_) => {
      let out =
        viewMode === "grid"
          ? []
          : paintEdgeHighlight(
            loadedEdges,
            selectedIdRef.current ??
            null,
          );

      if (recomputedEdgeSet.size) {
        out = paintPathHighlight(
          out,
          recomputedEdgeSet,
        );
      }

      return out;
    });

    if (protocolOutputThumbnailsEnabled) {
      const currentProjectId = getProjectId();

      if (currentProjectId != null) {
        void loadProtocolOutputThumbnailsForNodes(currentProjectId, nodesWithLiveTicks);
      }
    }

    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const inst = reactFlowInstanceRef.current ?? (window as any).reactFlowInstance;
        if (!inst) {
          disablePersistenceRef.current = false;
          setTimeout(() => setIsSwitchingLayout(false), 60);
          prevLayout.current = { viewMode, graphDirection };
          return;
        }

        if (viewMode === "hierarchical") {
          centerLikeButton(nodesWithPositions, true);

          window.setTimeout(() => {
            if (viewModeRef.current === "hierarchical") {
              handleRefreshRef.current?.();
            }
          }, 0);
        } else {
          snapViewportToTopLeft(GRID_ZOOM);
        }

        requestAnimationFrame(() => {
          setTimeout(() => {
            disablePersistenceRef.current = false;
            setIsSwitchingLayout(false);
            prevLayout.current = { viewMode, graphDirection };
          }, 60);
        });
      });
    });
  }, [
    graphDirection,
    viewMode,
    project,
    paintEdgeHighlight,
    paintPathHighlight,
    computeEdgesForMode,
    gridWidth,
    centerLikeButton,
    snapViewportToTopLeft,
    seedNodesWithSelectionAndThumbnails,
    protocolOutputThumbnailsEnabled,
    loadProtocolOutputThumbnailsForNodes,
  ]);
  /* ------------------------ First-center ONLY once after initial load ------------------------ */
  useEffect(() => {
    if (!nodesLoadedOnce || !firstLoadRef.current) return;

    const inst = reactFlowInstanceRef.current ?? (window as any).reactFlowInstance;
    if (!inst) return;

    let cancelled = false;

    (async () => {
      await new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));
      if (cancelled) return;

      if (viewModeRef.current === "grid") {
        inst.setViewport({ x: 0, y: 0, zoom: GRID_ZOOM });
        setViewport({ x: 0, y: 0, zoom: GRID_ZOOM });
      } else if (viewModeRef.current === "hierarchical") {
        centerLikeButton(nodesRef.current, true, viewportRef.current.zoom);
      }

      firstLoadRef.current = false;
    })();

    return () => { cancelled = true; };
  }, [nodesLoadedOnce, centerLikeButton]);


  /* ============================================================
     Table helpers (unchanged)
     ============================================================ */
  const didScrollForTableRef = useRef(false);
  const tableScrollRetriesRef = useRef(0);

  const scrollSelectedRowIntoViewOnce = useCallback(() => {
    const id = pathSelRef.current.nodes.size === 0 ? selectedIdRef.current : null;
    if (!id) {
      setHighlightedId(null);
      didScrollForTableRef.current = true;
      return;
    }

    setHighlightedId(id);

    const row = rowRefs.current[id];
    const container = tableContainerRef.current;
    if (row && container && container.offsetHeight > 0) {
      const rowTop = row.offsetTop;
      const desired = rowTop - container.offsetHeight / 2 + row.offsetHeight / 2;
      container.scrollTop = Math.max(0, desired);
      didScrollForTableRef.current = true;
      tableScrollRetriesRef.current = 0;
      return;
    }

    if (tableScrollRetriesRef.current < 10) {
      tableScrollRetriesRef.current += 1;
      requestAnimationFrame(scrollSelectedRowIntoViewOnce);
    } else {
      didScrollForTableRef.current = true;
      tableScrollRetriesRef.current = 0;
    }
  }, [setHighlightedId]);

  useEffect(() => {
    if (viewMode !== "table") {
      didScrollForTableRef.current =
        false;

      tableScrollRetriesRef.current =
        0;

      return;
    }

    requestAnimationFrame(() => {
      if (
        didScrollForTableRef.current
      ) {
        return;
      }

      tableScrollRetriesRef.current =
        0;

      requestAnimationFrame(
        scrollSelectedRowIntoViewOnce
      );
    });
  }, [
    viewMode,
    tableData,
    scrollSelectedRowIntoViewOnce,
  ]);

  useEffect(() => {
    if (viewMode === "table" && pathSelRef.current.nodes.size === 0) {
      setHighlightedId(selectedIdRef.current ?? null);
    }
  }, [isRefreshing, viewMode]);

  /* --------------------- Search helpers --------------------- */
  const scrollToProtocol = (id: string) => {
    const row = rowRefs.current[id];
    const container = tableContainerRef.current;
    if (row && container) {
      setHighlightedId(id);
      const rowTop = row.offsetTop;
      const rowHeight = row.offsetHeight;
      const containerHeight = container.offsetHeight;
      container.scrollTop = Math.max(0, rowTop - containerHeight / 2 + rowHeight / 2);
    }
  };

  const getStatusStyle = (status?: string) => {
    const colorMap: Record<string, string> = {
      running: "#FCCE62",
      saved: "#D9F1FA",
      launched: "#D9F1FA",
      finished: "#D2F5CB",
      failed: "#F5CCCB",
      aborted: "#F5CCCB",
      interactive: "#f7f3bf",
      root: "#D9F1FA",
      scheduled: "#f7f3bf",
      new: "#1E90FF",
    };
    return { backgroundColor: colorMap[status ?? ""] ?? "#eee" };
  };

  const statusColorMap: Record<string, string> = {
    running: "#FCCE62",
    saved: "#D9F1FA",
    launched: "#D9F1FA",
    finished: "#D2F5CB",
    failed: "#F5CCCB",
    aborted: "#F5CCCB",
    interactive: "#f7f3bf",
    root: "#D9F1FA",
    scheduled: "#f7f3bf",
    new: "#1E90FF",
  };

  const getMiniMapNodeColor = useCallback(
    (node: Node<StatusNodeData>) => {
      // forceStatusOnly
      const dataAny: any = (node as any).data ?? {};
      const status = String(dataAny.status ?? "").toLowerCase();

      const byStatus = statusColorMap[status];
      if (byStatus) return byStatus;

      return hostIsDark ? "#1f2937" : "#e5e7eb";
    },
    [hostIsDark]
  );

  const getMiniMapNodeStroke = useCallback(
    (node: Node<StatusNodeData>) => {
      if ((node as any).selected) return "#0070f3";
      return hostIsDark ? "rgba(148,163,184,0.55)" : "rgba(15,23,42,0.35)";
    },
    [hostIsDark]
  );


  const formatCpuTime = (seconds: number): string => {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);
    const pad = (n: number) => n.toString().padStart(2, "0");
    return `${pad(hours)}h:${pad(minutes)}m:${pad(secs)}s`;
  };

  const handleSearch = (query: string) => {
    const inst = reactFlowInstanceRef.current ?? (window as any).reactFlowInstance;

    if (!query.trim()) {
      setHighlightedId(null);
      setPreviousNodeId(null);
      applyEdgeHighlight(null);
      if (inst && nodes.length > 0) {
        const currentViewport = inst.getViewport();
        const validNodes = nodes.filter((n) => typeof n.position?.x === "number" && typeof n.position?.y === "number");
        if (validNodes.length > 0) {
          const xSum = validNodes.reduce((s, n) => s + (n.position?.x ?? 0), 0);
          const ySum = validNodes.reduce((s, n) => s + (n.position?.y ?? 0), 0);
          const centerX = xSum / validNodes.length;
          const centerY = ySum / validNodes.length;
          const zoom = viewMode === "grid" ? GRID_ZOOM : clampZoom(currentViewport.zoom);
          inst.setCenter(centerX, centerY, { zoom, duration: 300 });
          const vp = inst.getViewport();
          setViewport({ x: vp.x, y: vp.y, zoom: vp.zoom });
        } else {
          const clamped = { x: currentViewport.x, y: currentViewport.y, zoom: viewMode === "grid" ? GRID_ZOOM : clampZoom(currentViewport.zoom) };
          inst.setViewport(clamped);
          setViewport(clamped);
        }
      }
      return;
    }

    if (viewMode === "table") {
      const matchRow = tableData.find((row) => {
        const id = String(row?.id ?? "").toLowerCase();
        const label = String(row?.label ?? "").toLowerCase();
        const runName = String(row?.runName ?? "").toLowerCase();
        const q = query.toLowerCase();

        return id.includes(q) || runName.includes(q) || label.includes(q);
      });
      if (matchRow) scrollToProtocol(matchRow.id);
      return;
    }

    const match = nodes.find((node) => {
      const d: any = (node as any).data ?? {};
      const q = query.toLowerCase();

      return (
        node.id.toLowerCase().includes(q) ||
        String(d.runName ?? "").toLowerCase().includes(q) ||
        String(d.label ?? "").toLowerCase().includes(q)
      );
    });

    if (!match) {
      setHighlightedId(null);
      setPreviousNodeId(null);
      applyEdgeHighlight(null);
      return;
    }

    setPreviousNodeId(match.id);
    setHighlightedId(match.id);
    applyEdgeHighlight(match.id);

    const inst2 = reactFlowInstanceRef.current ?? (window as any).reactFlowInstance;
    if (inst2) {
      const zoom = viewMode === "grid" ? GRID_ZOOM : clampZoom(inst2.getViewport().zoom);
      inst2.setCenter((match as any).position.x, (match as any).position.y, { zoom, duration: 500 });
      const vp = inst2.getViewport();
      setViewport({ x: vp.x, y: vp.y, zoom: vp.zoom });
    }
  };


  // searchUiState
  const [searchQuery, setSearchQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchActiveIndex, setSearchActiveIndex] = useState(0);
  const searchBoxRef = useRef<HTMLDivElement | null>(null);

  const searchResults = useMemo<SearchResult[]>(() => {
    // buildSearchResults
    const q = searchQuery.trim().toLowerCase();
    if (!q) return [];

    const limit = 12;
    const results: Array<{ item: SearchResult; score: number; numId: number }> = [];

    const pushIfMatch = (idRaw: any, labelRaw: any, statusRaw?: any) => {
      const id = String(idRaw ?? "");
      if (!id || id === "PROJECT") return;

      const label = String(labelRaw ?? id);
      const status = statusRaw != null ? String(statusRaw) : undefined;

      const idL = id.toLowerCase();
      const labelL = label.toLowerCase();

      const idExact = idL === q;
      const idStarts = idL.startsWith(q);
      const labelStarts = labelL.startsWith(q);
      const idIncludes = idL.includes(q);
      const labelIncludes = labelL.includes(q);

      if (!(idIncludes || labelIncludes)) return;

      let score = 0;
      if (idExact) score = 100;
      else if (idStarts) score = 90;
      else if (labelStarts) score = 80;
      else if (idIncludes) score = 70;
      else score = 60;

      const numId = Number.parseInt(id, 10);
      results.push({
        item: { id, label, status },
        score,
        numId: Number.isNaN(numId) ? Number.NEGATIVE_INFINITY : numId,
      });
    };

    if (viewMode === "table") {
      for (const row of filteredTableData) {
        pushIfMatch(row?.id, getProtocolRowDisplayName(row), row?.status);
      }
    } else {
      for (const n of nodes) {
        const d: any = (n as any).data ?? {};
        pushIfMatch(n.id, d.runName ?? d.label ?? n.id, d.status);
      }
    }

    results.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      if (b.numId !== a.numId) return b.numId - a.numId;
      return a.item.id.localeCompare(b.item.id);
    });

    return results.slice(0, limit).map((x) => x.item);
  }, [searchQuery, viewMode, filteredTableData, nodes]);

  const jumpToSearchResult = useCallback(
    async (res: SearchResult, opts?: { openForm?: boolean }) => {
      // jumpToSearchResult
      const id = String(res.id);
      if (!id) return;

      setSearchOpen(false);

      if (viewMode === "table") {
        scrollToProtocol(id);

        selectedIdRef.current = id;
        setPreviousNodeId(id);
        setHighlightedId(id);
        applyEdgeHighlight(id);

        suppressOneFrame();
        setNodes((prev) => prev.map((n) => ({ ...n, selected: n.id === id })));
        syncUnifiedSelectedIds();
        return;
      }

      const match = nodesRef.current.find((n) => String(n.id) === id);
      if (!match) return;

      selectedIdRef.current = id;
      setPreviousNodeId(id);
      setHighlightedId(id);
      applyEdgeHighlight(id);

      suppressOneFrame();
      setNodes((prev) => prev.map((n) => ({ ...n, selected: n.id === id })));

      const inst = reactFlowInstanceRef.current ?? (window as any).reactFlowInstance;
      if (inst) {
        const zoom = viewMode === "grid" ? GRID_ZOOM : clampZoom(inst.getViewport().zoom);
        inst.setCenter((match as any).position.x, (match as any).position.y, { zoom, duration: 350 });
        const vp = inst.getViewport();
        setViewport({ x: vp.x, y: vp.y, zoom: vp.zoom });
      }

      syncUnifiedSelectedIds();

      if (opts?.openForm && projectName) {
        await openFormForNode(id, () => svc.fetchProtocolDetails(projectName, id));
      }
    },
    [
      viewMode,
      GRID_ZOOM,
      projectName,
      svc,
      applyEdgeHighlight,
      openFormForNode,
      scrollToProtocol,
      suppressOneFrame,
      setNodes,
      syncUnifiedSelectedIds,
    ]
  );

  const handleSearchInputChange = useCallback(
    (value: string) => {
      // handleSearchInputChange
      setSearchQuery(value);
      const trimmed = value.trim();

      if (!trimmed) {
        setSearchOpen(false);
        setSearchActiveIndex(0);
        handleSearch("");
        return;
      }

      setSearchOpen(true);
      setSearchActiveIndex(0);
    },
    [handleSearch]
  );

  const handleSearchKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      // handleSearchKeyDown
      if (!searchOpen) {
        if (e.key === "Enter" && searchResults.length > 0) {
          e.preventDefault();
          void jumpToSearchResult(searchResults[0], { openForm: e.altKey });
        }
        return;
      }

      if (e.key === "Escape") {
        e.preventDefault();
        setSearchOpen(false);
        return;
      }

      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSearchActiveIndex((i) => Math.min(i + 1, Math.max(0, searchResults.length - 1)));
        return;
      }

      if (e.key === "ArrowUp") {
        e.preventDefault();
        setSearchActiveIndex((i) => Math.max(0, i - 1));
        return;
      }

      if (e.key === "Enter") {
        e.preventDefault();
        const hit = searchResults[searchActiveIndex] ?? searchResults[0];
        if (hit) void jumpToSearchResult(hit, { openForm: e.altKey });
        return;
      }
    },
    [searchOpen, searchResults, searchActiveIndex, jumpToSearchResult]
  );

  useEffect(() => {
    // closeSearchOnOutsideClick
    const onDown = (ev: MouseEvent) => {
      const target = ev.target as HTMLElement | null;
      if (!target) return;
      if (searchBoxRef.current && !searchBoxRef.current.contains(target)) {
        setSearchOpen(false);
      }
    };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, []);



  const handleRowDoubleClick = async (id: string) => {
    if (!projectName) return;
    await openFormForNode(String(id), () => svc.fetchProtocolDetails(projectName, id));
  };

  const findNodeLabel = (id: string) => {
    const n = nodesRef.current.find((m) => m.id === id);
    return ((n as any)?.data?.label as string) ?? id;
  };


  const findNodeRunName = (id: string) => {
    const n = nodesRef.current.find((m) => m.id === id);
    const data: any = (n as any)?.data ?? {};
    return String(data.runName ?? data.label ?? id);
  };

  const openProtocolStepsDialog = useCallback((id: string) => {
    const protocolId = String(id ?? "").trim();
    if (!protocolId || protocolId === "PROJECT") return;

    setProtocolStepsDialog({
      open: true,
      protocolId,
      protocolLabel: findNodeRunName(protocolId),
    });
  }, []);

  const findNodeEditableRunName = (id: string) => {
    const n = nodesRef.current.find((m) => m.id === id);
    const data: any = (n as any)?.data ?? {};
    return String(data.runName ?? "");
  };

  const findNodeComment = (id: string) => {
    const n = nodesRef.current.find((m) => m.id === id);
    const data: any = (n as any)?.data ?? {};
    return String(data.comment ?? "");
  };

  // layoutConstantsForHierarchical
  const hierSpacingX = (dir: "TB" | "LR") => (dir === "TB" ? 480 : 1250);
  const hierSpacingY = (dir: "TB" | "LR") => (dir === "TB" ? 680 : 480);

  // minGapBetweenSiblings is intentionally small; packing should be compact
  const minGapBetweenSiblings = 40;
  const getLevelCoord = (dir: "TB" | "LR", pos: { x: number; y: number }) => (dir === "TB" ? pos.y : pos.x);
  const setLevelCoord = (dir: "TB" | "LR", pos: { x: number; y: number }, v: number) =>
    dir === "TB" ? { x: pos.x, y: v } : { x: v, y: pos.y };

  const getAxisCoord = (dir: "TB" | "LR", pos: { x: number; y: number }) => (dir === "TB" ? pos.x : pos.y);
  const setAxisCoord = (dir: "TB" | "LR", pos: { x: number; y: number }, v: number) =>
    dir === "TB" ? { x: v, y: pos.y } : { x: pos.x, y: v };


  const getAxisSize = (dir: "TB" | "LR", n: Node<any>) => {
    const anyN: any = n as any;
    const mw = Number(anyN.measured?.width ?? anyN.width);
    const mh = Number(anyN.measured?.height ?? anyN.height);

    // fallBackSize is intentionally conservative to avoid visual overlaps
    const width = Number.isFinite(mw) && mw > 0 ? Math.ceil(mw) : 900;
    const height = Number.isFinite(mh) && mh > 0 ? Math.ceil(mh) : 520;

    // addPadding to be safer with card shadows/margins
    return (dir === "TB" ? width : height) + 40;
  };

  const getLevelSize = (dir: "TB" | "LR", n: Node<any>) => {
    const anyN: any = n as any;
    const mw = Number(anyN.measured?.width ?? anyN.width);
    const mh = Number(anyN.measured?.height ?? anyN.height);

    const width = Number.isFinite(mw) && mw > 0 ? Math.ceil(mw) : 900;
    const height = Number.isFinite(mh) && mh > 0 ? Math.ceil(mh) : 520;

    return (dir === "TB" ? height : width) + 40;
  };

  type GraphBlockBounds = {
    minAxis: number;
    maxAxis: number;
    minLevel: number;
    maxLevel: number;
  };

  const getBoundsFromPositionItems = (
    dir: "TB" | "LR",
    items: Array<{
      id: string;
      position: { x: number; y: number };
      node?: Node<any> | null;
    }>
  ): GraphBlockBounds | null => {
    let minAxis = Infinity;
    let maxAxis = -Infinity;
    let minLevel = Infinity;
    let maxLevel = -Infinity;
    let count = 0;

    for (const item of items) {
      const pos = item.position;
      if (
        typeof pos?.x !== "number" ||
        typeof pos?.y !== "number" ||
        !Number.isFinite(pos.x) ||
        !Number.isFinite(pos.y)
      ) {
        continue;
      }

      const axis = getAxisCoord(dir, pos);
      const level = getLevelCoord(dir, pos);

      const axisSize = item.node ? getAxisSize(dir, item.node) : dir === "TB" ? 940 : 560;
      const levelSize = item.node ? getLevelSize(dir, item.node) : dir === "TB" ? 560 : 940;

      minAxis = Math.min(minAxis, axis - axisSize / 2);
      maxAxis = Math.max(maxAxis, axis + axisSize / 2);
      minLevel = Math.min(minLevel, level - levelSize / 2);
      maxLevel = Math.max(maxLevel, level + levelSize / 2);
      count += 1;
    }

    if (count === 0) return null;

    return {
      minAxis,
      maxAxis,
      minLevel,
      maxLevel,
    };
  };

  const getBlockBoundsForNodeIds = (
    dir: "TB" | "LR",
    nodesList: Node<any>[],
    ids: Set<string>
  ): GraphBlockBounds | null => {
    return getBoundsFromPositionItems(
      dir,
      nodesList
        .filter((n) => ids.has(String(n.id)))
        .map((n) => ({
          id: String(n.id),
          position: n.position,
          node: n,
        }))
    );
  };

  const intervalsOverlap = (
    minA: number,
    maxA: number,
    minB: number,
    maxB: number,
    gap: number
  ) => {
    return minA < maxB + gap && maxA + gap > minB;
  };

  const blocksOverlap = (
    a: GraphBlockBounds,
    b: GraphBlockBounds,
    axisGap: number,
    levelGap: number
  ) => {
    return (
      intervalsOverlap(a.minAxis, a.maxAxis, b.minAxis, b.maxAxis, axisGap) &&
      intervalsOverlap(a.minLevel, a.maxLevel, b.minLevel, b.maxLevel, levelGap)
    );
  };

  const shiftBoundsOnAxis = (
    bounds: GraphBlockBounds,
    deltaAxis: number
  ): GraphBlockBounds => ({
    ...bounds,
    minAxis: bounds.minAxis + deltaAxis,
    maxAxis: bounds.maxAxis + deltaAxis,
  });

  const findFreeDuplicateBlockDelta = (
    dir: "TB" | "LR",
    nodesList: Node<any>[],
    duplicateIds: Set<string>,
    preferredDelta: number
  ): number => {
    const duplicateNodeBounds = nodesList
      .filter((n) => duplicateIds.has(String(n.id)))
      .map((n) =>
        getBoundsFromPositionItems(dir, [
          {
            id: String(n.id),
            position: n.position,
            node: n,
          },
        ])
      )
      .filter(Boolean) as GraphBlockBounds[];

    if (!duplicateNodeBounds.length) return preferredDelta;

    const obstacleBounds = nodesList
      .filter((n) => !duplicateIds.has(String(n.id)))
      .map((n) =>
        getBoundsFromPositionItems(dir, [
          {
            id: String(n.id),
            position: n.position,
            node: n,
          },
        ])
      )
      .filter(Boolean) as GraphBlockBounds[];

    const axisGap = dir === "TB" ? 120 : 80;
    const levelGap = dir === "TB" ? 100 : 120;

    const collides = (deltaAxis: number): boolean => {
      const movedDuplicateBounds = duplicateNodeBounds.map((bounds) =>
        shiftBoundsOnAxis(bounds, deltaAxis)
      );

      return movedDuplicateBounds.some((duplicateBounds) =>
        obstacleBounds.some((obstacle) =>
          blocksOverlap(duplicateBounds, obstacle, axisGap, levelGap)
        )
      );
    };

    if (!collides(preferredDelta)) return preferredDelta;

    const step = dir === "TB" ? 120 : 100;

    for (let i = 1; i <= 80; i++) {
      const rightDelta = preferredDelta + i * step;
      if (!collides(rightDelta)) return rightDelta;

      const leftDelta = preferredDelta - i * step;
      if (!collides(leftDelta)) return leftDelta;
    }

    return preferredDelta;
  };

  const placePendingNewNodesAtCanonicalTbPositions = (
    canonicalNodes: Node<any>[],
    currentEdges: Edge[]
  ): {
    nodes: Node<any>[];
    resolved: boolean;
  } => {
    const pending = pendingNewNodesRef.current;

    if (!pending?.beforePositions) {
      return {
        nodes: canonicalNodes,
        resolved: false,
      };
    }

    const beforePositions = pending.beforePositions;

    const canonicalById = new Map(
      canonicalNodes.map((node) => [
        String(node.id),
        node,
      ])
    );

    const currentById = new Map(
      nodesRef.current.map((node) => [
        String(node.id),
        node,
      ])
    );

    const protocolIds = canonicalNodes
      .map((node) => String(node.id))
      .filter((id) => id !== "PROJECT");

    const newIds = new Set(
      protocolIds.filter(
        (id) => !pending.beforeIds.has(id)
      )
    );

    if (newIds.size === 0) {
      return {
        nodes: preservePendingExistingNodePositions(
          canonicalNodes
        ),
        resolved: false,
      };
    }

    const workingById = new Map<string, Node<any>>();

    for (const node of canonicalNodes) {
      const nodeId = String(node.id);
      const previousPosition =
        beforePositions.get(nodeId);

      workingById.set(
        nodeId,
        previousPosition
          ? {
            ...node,
            position: {
              ...previousPosition,
            },
          }
          : {
            ...node,
            position: {
              ...node.position,
            },
          }
      );
    }

    const duplicatedPairByNewId = new Map(
      (pending.duplicatedPairs ?? []).map(
        (pair) => [
          String(pair.newId),
          pair,
        ]
      )
    );

    const neighborsById =
      new Map<string, string[]>();

    const outgoingBySource =
      new Map<string, string[]>();

    const incomingCount =
      new Map<string, number>();

    const projectRootIds =
      new Set<string>();

    const addNeighbor = (
      firstId: string,
      secondId: string
    ) => {
      const neighbors =
        neighborsById.get(firstId) ?? [];

      if (!neighbors.includes(secondId)) {
        neighbors.push(secondId);
        neighborsById.set(
          firstId,
          neighbors
        );
      }
    };

    for (const edge of currentEdges) {
      const sourceId =
        String(edge.source);

      const targetId =
        String(edge.target);

      if (!canonicalById.has(targetId)) {
        continue;
      }

      if (sourceId === "PROJECT") {
        projectRootIds.add(targetId);
        continue;
      }

      if (!canonicalById.has(sourceId)) {
        continue;
      }

      const children =
        outgoingBySource.get(sourceId) ?? [];

      if (!children.includes(targetId)) {
        children.push(targetId);
        outgoingBySource.set(
          sourceId,
          children
        );
      }

      incomingCount.set(
        targetId,
        (incomingCount.get(targetId) ?? 0) + 1
      );

      addNeighbor(
        sourceId,
        targetId
      );

      addNeighbor(
        targetId,
        sourceId
      );
    }

    for (const id of protocolIds) {
      if (
        (incomingCount.get(id) ?? 0) === 0
      ) {
        projectRootIds.add(id);
      }
    }

    const canonicalDistance = (
      firstId: string,
      secondId: string
    ): number => {
      const first =
        canonicalById.get(firstId);

      const second =
        canonicalById.get(secondId);

      if (!first || !second) {
        return Number.POSITIVE_INFINITY;
      }

      const dx =
        first.position.x -
        second.position.x;

      const dy =
        first.position.y -
        second.position.y;

      return Math.hypot(dx, dy);
    };

    const projectCanonical =
      canonicalById.get("PROJECT");

    const projectPrevious =
      beforePositions.get("PROJECT");

    for (const newId of newIds) {
      const canonicalNode =
        canonicalById.get(newId);

      const workingNode =
        workingById.get(newId);

      if (
        !canonicalNode ||
        !workingNode
      ) {
        continue;
      }

      let anchorId: string | null =
        null;

      let anchorPosition:
        { x: number; y: number } |
        undefined;

      const duplicatePair =
        duplicatedPairByNewId.get(newId);

      if (duplicatePair) {
        const sourceId =
          String(
            duplicatePair.sourceId
          );

        const sourcePosition =
          duplicatePair.sourcePosition ??
          beforePositions.get(
            sourceId
          );

        if (
          canonicalById.has(sourceId) &&
          sourcePosition
        ) {
          anchorId = sourceId;
          anchorPosition =
            sourcePosition;
        }
      }

      if (!anchorId) {
        const existingNeighbors =
          (
            neighborsById.get(newId) ??
            []
          )
            .filter(
              (id) =>
                pending.beforeIds.has(id) &&
                canonicalById.has(id) &&
                beforePositions.has(id)
            )
            .sort(
              (leftId, rightId) =>
                canonicalDistance(
                  newId,
                  leftId
                ) -
                canonicalDistance(
                  newId,
                  rightId
                )
            );

        const nearestNeighbor =
          existingNeighbors[0];

        if (nearestNeighbor) {
          anchorId =
            nearestNeighbor;

          anchorPosition =
            beforePositions.get(
              nearestNeighbor
            );
        }
      }

      if (
        anchorId &&
        anchorPosition
      ) {
        const canonicalAnchor =
          canonicalById.get(anchorId);

        if (canonicalAnchor) {
          workingById.set(
            newId,
            {
              ...workingNode,
              position: {
                x:
                  anchorPosition.x +
                  (
                    canonicalNode.position.x -
                    canonicalAnchor.position.x
                  ),

                y:
                  anchorPosition.y +
                  (
                    canonicalNode.position.y -
                    canonicalAnchor.position.y
                  ),
              },
            }
          );

          continue;
        }
      }

      if (
        projectCanonical &&
        projectPrevious
      ) {
        workingById.set(
          newId,
          {
            ...workingNode,
            position: {
              x:
                projectPrevious.x +
                (
                  canonicalNode.position.x -
                  projectCanonical.position.x
                ),

              y:
                projectPrevious.y +
                (
                  canonicalNode.position.y -
                  projectCanonical.position.y
                ),
            },
          }
        );
      }
    }

    const getCurrentRootX = (rootId: string): number => {
      const position =
        beforePositions.get(rootId) ??
        currentById.get(rootId)?.position ??
        canonicalById.get(rootId)?.position;

      return position?.x ?? 0;
    };

    const orderedRootIds = Array.from(projectRootIds)
      .filter((id) => canonicalById.has(id))
      .sort((leftId, rightId) => getCurrentRootX(leftId) - getCurrentRootX(rightId));

    if (orderedRootIds.length === 0) {
      const positionedNodes =
        canonicalNodes.map(
          (node) =>
            workingById.get(
              String(node.id)
            ) ?? node
        );

      return {
        nodes:
          centerProjectOverGraphBranches(
            positionedNodes,
            "TB"
          ),
        resolved: true,
      };
    }

    const reachableByRoot =
      new Map<string, Set<string>>();

    for (const rootId of orderedRootIds) {
      const reachable =
        new Set<string>();

      const pendingIds =
        [rootId];

      while (pendingIds.length > 0) {
        const currentId =
          pendingIds.pop();

        if (
          !currentId ||
          reachable.has(currentId)
        ) {
          continue;
        }

        reachable.add(currentId);

        for (
          const childId
          of outgoingBySource.get(
            currentId
          ) ?? []
        ) {
          pendingIds.push(childId);
        }
      }

      reachableByRoot.set(
        rootId,
        reachable
      );
    }

    const nodeIdsByRoot =
      new Map<string, string[]>();

    for (const rootId of orderedRootIds) {
      nodeIdsByRoot.set(
        rootId,
        []
      );
    }

    for (const nodeId of protocolIds) {
      const canonicalNode =
        canonicalById.get(nodeId);

      if (!canonicalNode) continue;

      const candidateRoots =
        orderedRootIds.filter(
          (rootId) =>
            reachableByRoot
              .get(rootId)
              ?.has(nodeId)
        );

      const candidates =
        candidateRoots.length > 0
          ? candidateRoots
          : orderedRootIds;

      const resolvedRootId =
        [...candidates]
          .sort((leftId, rightId) => {
            const leftRoot =
              canonicalById.get(
                leftId
              )!;

            const rightRoot =
              canonicalById.get(
                rightId
              )!;

            const leftDistance =
              Math.abs(
                leftRoot.position.x -
                canonicalNode.position.x
              );

            const rightDistance =
              Math.abs(
                rightRoot.position.x -
                canonicalNode.position.x
              );

            return (
              leftDistance -
              rightDistance
            );
          })[0];

      if (resolvedRootId) {
        nodeIdsByRoot
          .get(resolvedRootId)
          ?.push(nodeId);
      }
    }

    const getBranchBounds = (
      rootId: string,
      useBeforePositions = false
    ): { left: number; right: number } | null => {
      let left = Number.POSITIVE_INFINITY;
      let right = Number.NEGATIVE_INFINITY;

      for (const nodeId of nodeIdsByRoot.get(rootId) ?? []) {
        const workingNode = workingById.get(nodeId) ?? canonicalById.get(nodeId);
        const currentNode = currentById.get(nodeId);

        const position = useBeforePositions
          ? beforePositions.get(nodeId) ?? currentNode?.position ?? workingNode?.position
          : workingNode?.position;

        if (!position) continue;

        const sizeNode = currentNode
          ? { ...currentNode, position }
          : workingNode
            ? { ...workingNode, position }
            : null;

        const size = sizeNode ? getAxisSize("TB", sizeNode) : 940;

        left = Math.min(left, position.x - size / 2);
        right = Math.max(right, position.x + size / 2);
      }

      return Number.isFinite(left) && Number.isFinite(right)
        ? { left, right }
        : null;
    };

    const shiftBranch = (rootId: string, deltaX: number): void => {
      if (Math.abs(deltaX) <= 0.5) return;

      for (const nodeId of nodeIdsByRoot.get(rootId) ?? []) {
        const node = workingById.get(nodeId);
        if (!node) continue;

        workingById.set(nodeId, {
          ...node,
          position: {
            ...node.position,
            x: node.position.x + deltaX,
          },
        });
      }
    };

    const rootByNodeId = new Map<string, string>();

    for (const [rootId, branchIds] of nodeIdsByRoot) {
      for (const nodeId of branchIds) {
        rootByNodeId.set(nodeId, rootId);
      }
    }

    const affectedRootIds = new Set<string>();

    for (const newId of newIds) {
      const rootId = rootByNodeId.get(newId);

      if (rootId) {
        affectedRootIds.add(rootId);
      }
    }

    const sourceRootByNewRoot = new Map<string, string>();

    for (const rootId of affectedRootIds) {
      if (pending.beforeIds.has(rootId)) continue;

      const branchIds = new Set(nodeIdsByRoot.get(rootId) ?? []);

      for (const pair of pending.duplicatedPairs ?? []) {
        if (!branchIds.has(String(pair.newId))) continue;

        const sourceRootId = rootByNodeId.get(String(pair.sourceId));

        if (sourceRootId && sourceRootId !== rootId) {
          sourceRootByNewRoot.set(rootId, sourceRootId);
          break;
        }
      }
    }

    const compareNodeIds = (a: string, b: string): number => {
      const numericA = Number(a);
      const numericB = Number(b);

      if (Number.isFinite(numericA) && Number.isFinite(numericB) && numericA !== numericB) {
        return numericA - numericB;
      }

      return a.localeCompare(b, undefined, { numeric: true });
    };

    const existingRootIds = orderedRootIds
      .filter((rootId) => pending.beforeIds.has(rootId))
      .sort((leftId, rightId) => {
        const leftBounds = getBranchBounds(leftId, true);
        const rightBounds = getBranchBounds(rightId, true);

        const left = leftBounds?.left ?? getCurrentRootX(leftId);
        const right = rightBounds?.left ?? getCurrentRootX(rightId);

        return left - right;
      });

    const newRootIds = orderedRootIds
      .filter((rootId) => !pending.beforeIds.has(rootId))
      .sort(compareNodeIds);

    const orderedRootIdsByBounds = [...existingRootIds];

    for (const newRootId of newRootIds) {
      const sourceRootId = sourceRootByNewRoot.get(newRootId);

      if (!sourceRootId) {
        orderedRootIdsByBounds.push(newRootId);
        continue;
      }

      const sourceIndex = orderedRootIdsByBounds.indexOf(sourceRootId);

      if (sourceIndex < 0) {
        orderedRootIdsByBounds.push(newRootId);
        continue;
      }

      let insertIndex = sourceIndex + 1;

      while (
        insertIndex < orderedRootIdsByBounds.length &&
        sourceRootByNewRoot.get(orderedRootIdsByBounds[insertIndex]) === sourceRootId
      ) {
        insertIndex += 1;
      }

      orderedRootIdsByBounds.splice(insertIndex, 0, newRootId);
    }

    for (const rootId of affectedRootIds) {
      if (!pending.beforeIds.has(rootId)) {
        continue;
      }

      const branchIds = nodeIdsByRoot.get(rootId) ?? [];
      let anchorId = rootId;

      if (pending.operation === "duplicate") {
        const duplicatedSourceId = (pending.duplicatedPairs ?? [])
          .map((pair) => String(pair.sourceId))
          .find((sourceId) =>
            rootByNodeId.get(sourceId) === rootId &&
            beforePositions.has(sourceId) &&
            canonicalById.has(sourceId)
          );

        if (duplicatedSourceId) {
          anchorId = duplicatedSourceId;
        }
      }

      const canonicalAnchor = canonicalById.get(anchorId);
      const anchorPosition =
        beforePositions.get(anchorId) ??
        currentById.get(anchorId)?.position ??
        canonicalAnchor?.position;

      if (!canonicalAnchor || !anchorPosition) continue;

      for (const nodeId of branchIds) {
        const canonicalNode = canonicalById.get(nodeId);
        const workingNode = workingById.get(nodeId);

        if (!canonicalNode || !workingNode) continue;

        workingById.set(nodeId, {
          ...workingNode,
          position: {
            x: anchorPosition.x + canonicalNode.position.x - canonicalAnchor.position.x,
            y: anchorPosition.y + canonicalNode.position.y - canonicalAnchor.position.y,
          },
        });
      }
    }

    const firstAffectedIndex = orderedRootIdsByBounds.findIndex((rootId) =>
      affectedRootIds.has(rootId)
    );

    if (firstAffectedIndex >= 0) {
      const branchGap = 320;

      for (let index = firstAffectedIndex; index < orderedRootIdsByBounds.length; index++) {
        if (index === 0) continue;

        const rootId = orderedRootIdsByBounds[index];
        const previousRootId = orderedRootIdsByBounds[index - 1];

        const currentBounds = getBranchBounds(rootId);
        const previousBounds = getBranchBounds(previousRootId);

        if (!currentBounds || !previousBounds) continue;

        const isNewRoot = !pending.beforeIds.has(rootId);
        const isAnchoredAffectedRoot =
          index === firstAffectedIndex &&
          affectedRootIds.has(rootId) &&
          !isNewRoot;

        if (isAnchoredAffectedRoot) {
          continue;
        }

        const requiredShift =
          previousBounds.right +
          branchGap -
          currentBounds.left;

        const deltaX = isNewRoot
          ? requiredShift
          : Math.max(0, requiredShift);

        shiftBranch(rootId, deltaX);
      }
    }

    const positionedNodes =
      canonicalNodes.map(
        (node) =>
          workingById.get(
            String(node.id)
          ) ?? node
      );

    return {
      nodes:
        centerProjectOverGraphBranches(
          positionedNodes,
          "TB"
        ),

      resolved: true,
    };
  };

  const placeDuplicatedNodesAsBranchBlock = (
    dir: "TB" | "LR",
    nodesList: Node<any>[],
    duplicatedPairs: Array<{
      sourceId: string;
      newId: string;
      sourcePosition?: { x: number; y: number };
    }>
  ): {
    nodes: Node<any>[];
    changedMap: Map<string, { x: number; y: number }>;
  } => {
    const nodeById = new Map(nodesList.map((n) => [String(n.id), n]));
    const validPairs = duplicatedPairs.filter((pair) => nodeById.has(String(pair.newId)));

    const duplicateIds = new Set(validPairs.map((pair) => String(pair.newId)));
    const changedMap = new Map<string, { x: number; y: number }>();

    if (duplicateIds.size === 0) {
      return { nodes: nodesList, changedMap };
    }

    const duplicateBounds = getBlockBoundsForNodeIds(dir, nodesList, duplicateIds);
    if (!duplicateBounds) {
      return { nodes: nodesList, changedMap };
    }

    const sourceItems = validPairs
      .map((pair) => {
        const sourceId = String(pair.sourceId);
        const sourceNode = nodeById.get(sourceId) ?? null;
        const sourcePosition = pair.sourcePosition ?? sourceNode?.position;

        if (!sourcePosition) return null;

        return {
          id: sourceId,
          position: sourcePosition,
          node: sourceNode,
        };
      })
      .filter(Boolean) as Array<{
        id: string;
        position: { x: number; y: number };
        node?: Node<any> | null;
      }>;

    const sourceBounds =
      getBoundsFromPositionItems(dir, sourceItems) ??
      getBoundsFromPositionItems(
        dir,
        nodesList
          .filter((n) => !duplicateIds.has(String(n.id)))
          .map((n) => ({
            id: String(n.id),
            position: n.position,
            node: n,
          }))
      );

    if (!sourceBounds) {
      return { nodes: nodesList, changedMap };
    }

    const branchGap = dir === "TB" ? 220 : 180;

    const preferredDelta =
      sourceBounds.maxAxis + branchGap - duplicateBounds.minAxis;

    const resolvedDelta = findFreeDuplicateBlockDelta(
      dir,
      nodesList,
      duplicateIds,
      preferredDelta
    );

    const nextNodes = nodesList.map((node) => {
      const nodeId = String(node.id);
      if (!duplicateIds.has(nodeId)) return node;

      const nextPosition = setAxisCoord(
        dir,
        node.position,
        getAxisCoord(dir, node.position) + resolvedDelta
      );

      changedMap.set(nodeId, nextPosition);

      return {
        ...node,
        position: nextPosition,
        selected: true,
      };
    });

    return {
      nodes: nextNodes,
      changedMap,
    };
  };

  const getLevelStep = (dir: "TB" | "LR") => (dir === "TB" ? hierSpacingY(dir) : hierSpacingX(dir));

  // inferNearestLevelKey snaps a raw point to the closest existing level among current nodes
  const inferNearestLevelKey = (dir: "TB" | "LR", point: { x: number; y: number }, nodesList: Node<any>[]) => {
    const step = getLevelStep(dir);
    const p = getLevelCoord(dir, point);

    let bestKey = Math.round(p / step);
    let bestDist = Number.POSITIVE_INFINITY;

    for (const n of nodesList) {
      const k = Math.round(getLevelCoord(dir, n.position) / step);
      const levelPos = k * step;
      const dist = Math.abs(levelPos - p);
      if (dist < bestDist) {
        bestDist = dist;
        bestKey = k;
      }
    }

    return bestKey;
  };

  // resolveOverlapsInLevel keeps anchorId fixed and packs siblings left/right to avoid overlaps
  const resolveOverlapsInLevel = (
    dir: "TB" | "LR",
    nodesList: Node<any>[],
    anchorId: string,
    levelKey: number
  ): Node<any>[] => {
    const step = getLevelStep(dir);
    const levelPos = levelKey * step;

    // collect nodes in the same level (snap tolerance: half step)
    const sameLevel = nodesList.filter((n) => {
      const k = Math.round(getLevelCoord(dir, n.position) / step);
      return k === levelKey;
    });

    if (sameLevel.length <= 1) {
      // snap anchor level coord anyway for stability
      return nodesList.map((n) => {
        if (n.id !== anchorId) return n;
        const snapped = setLevelCoord(dir, n.position, levelPos);
        return (snapped.x === n.position.x && snapped.y === n.position.y) ? n : { ...n, position: snapped };
      });
    }

    // sort by axis coordinate
    const sorted = [...sameLevel].sort((a, b) => getAxisCoord(dir, a.position) - getAxisCoord(dir, b.position));

    const idx = sorted.findIndex((n) => n.id === anchorId);
    if (idx < 0) return nodesList;

    // snap all nodes to exact level coord (prevents drift across levels)
    // Keep the current level coordinate for existing nodes.
    const posMap = new Map<string, { x: number; y: number }>();
    for (const n of sorted) posMap.set(n.id, n.position);

    // anchor stays fixed on axis (but snapped in level coord)
    const anchorPos = posMap.get(anchorId)!;
    const anchorAxis = getAxisCoord(dir, anchorPos);
    posMap.set(anchorId, setAxisCoord(dir, anchorPos, anchorAxis));

    // pass to the right
    for (let i = idx + 1; i < sorted.length; i++) {
      const prevId = sorted[i - 1].id;
      const curId = sorted[i].id;

      const prevPos = posMap.get(prevId)!;
      const curPos = posMap.get(curId)!;

      const prevAxis = getAxisCoord(dir, prevPos);
      const prevSize = getAxisSize(dir, sorted[i - 1]);
      const curAxis = getAxisCoord(dir, curPos);
      const curSize = getAxisSize(dir, sorted[i]);

      const prevRight = prevAxis + prevSize / 2;
      const minCenter = prevRight + minGapBetweenSiblings + curSize / 2;

      if (curAxis < minCenter) {
        posMap.set(curId, setAxisCoord(dir, curPos, minCenter));
      }
    }

    // pass to the left
    for (let i = idx - 1; i >= 0; i--) {
      const nextId = sorted[i + 1].id;
      const curId = sorted[i].id;

      const nextPos = posMap.get(nextId)!;
      const curPos = posMap.get(curId)!;

      const nextAxis = getAxisCoord(dir, nextPos);
      const nextSize = getAxisSize(dir, sorted[i + 1]);
      const curAxis = getAxisCoord(dir, curPos);
      const curSize = getAxisSize(dir, sorted[i]);

      const nextLeft = nextAxis - nextSize / 2;
      const maxCenter = nextLeft - minGapBetweenSiblings - curSize / 2;

      if (curAxis > maxCenter) {
        posMap.set(curId, setAxisCoord(dir, curPos, maxCenter));
      }
    }

    // apply back to full list (only same-level nodes changed)
    const changedIds = new Set(sorted.map((n) => n.id));
    return nodesList.map((n) => {
      if (!changedIds.has(n.id)) return n;
      const np = posMap.get(n.id)!;
      return (np.x === n.position.x && np.y === n.position.y) ? n : { ...n, position: np };
    });
  };


  // Try to find the newly created node and place it at pending point
  const tryPlaceNewlyCreatedNode = () => {
    const pending = pendingPlacementRef.current;
    if (!pending) return;

    if (viewModeRef.current !== "hierarchical") return;

    const { beforeIds, point } = pending;

    const currentIds = new Set(nodesRef.current.map((n) => String(n.id)));
    const candidates = Array.from(currentIds).filter((id) => !beforeIds.has(id) && id !== "PROJECT");
    if (candidates.length === 0) return;

    let pick = candidates[0];
    let bestNum = Number.NEGATIVE_INFINITY;
    for (const id of candidates) {
      const n = parseInt(id, 10);
      if (!Number.isNaN(n) && n > bestNum) {
        bestNum = n;
        pick = id;
      }
    }

    const dir = graphDirRef.current;

    setNodes((prev) => {
      const levelKey = inferNearestLevelKey(dir, point, prev);
      const levelPos = levelKey * getLevelStep(dir);

      // placeNewNodeAtPointButSnapToLevel
      const desiredPos = setLevelCoord(dir, { x: point.x, y: point.y }, levelPos);

      const placed = prev.map((n) => (n.id === pick ? { ...n, position: desiredPos } : n));

      // resolveOverlapsOnlyInThatLevel
      const resolved = resolveOverlapsInLevel(dir, placed, pick, levelKey);

      // persistUpdatedLevelPositions
      const levelIds = resolved
        .filter((n) => Math.round(getLevelCoord(dir, n.position) / getLevelStep(dir)) === levelKey)
        .map((n) => ({ id: n.id, position: n.position }));

      // note: side effect inside setState is acceptable here because it is idempotent and tied to user action
      const centeredNodes = centerProjectOverGraphBranches(resolved, dir);

      const projectPositionChange = getProjectPositionChange(
        resolved,
        centeredNodes
      );

      if (projectPositionChange) {
        levelIds.push(projectPositionChange);
      }

      // note: side effect inside setState is acceptable here because it is idempotent and tied to user action
      persistPositionsBulk(dir, levelIds);

      return centeredNodes;
    });

    pendingPlacementRef.current = null;
  };

  const alignPendingSingleChildrenToParents = (currentNodes: Node[]): Node[] => {
    const pending = pendingNewNodesRef.current;

    if (!pending || viewModeRef.current !== "hierarchical") {
      return currentNodes;
    }

    const newIds = new Set(
      currentNodes
        .map((node) => String(node.id))
        .filter((id) => !pending.beforeIds.has(id))
    );

    if (newIds.size === 0) {
      return currentNodes;
    }

    const updatedById = new Map(
      currentNodes.map((node) => [
        String(node.id),
        {
          ...node,
          position: { ...node.position },
        },
      ])
    );

    const incomingParentsByChild = new Map<string, string[]>();
    const outgoingChildrenByParent = new Map<string, string[]>();

    for (const edge of edgesRef.current) {
      const sourceId = String(edge.source);
      const targetId = String(edge.target);

      const incomingParents = incomingParentsByChild.get(targetId) ?? [];

      if (!incomingParents.includes(sourceId)) {
        incomingParents.push(sourceId);
        incomingParentsByChild.set(targetId, incomingParents);
      }

      const outgoingChildren = outgoingChildrenByParent.get(sourceId) ?? [];

      if (!outgoingChildren.includes(targetId)) {
        outgoingChildren.push(targetId);
        outgoingChildrenByParent.set(sourceId, outgoingChildren);
      }
    }

    const getNodeSize = (node: Node): { width: number; height: number } => {
      const measured = (node as any).measured;
      const width = measured?.width ?? node.width ?? 700;
      const height = measured?.height ?? node.height ?? 340;

      return {
        width: typeof width === "number" && width > 0 ? width : 700,
        height: typeof height === "number" && height > 0 ? height : 340,
      };
    };

    const getNodeRect = (node: Node) => {
      const { width, height } = getNodeSize(node);

      return {
        left: node.position.x,
        right: node.position.x + width,
        top: node.position.y,
        bottom: node.position.y + height,
      };
    };

    const nodesOverlap = (firstNode: Node, secondNode: Node): boolean => {
      const firstRect = getNodeRect(firstNode);
      const secondRect = getNodeRect(secondNode);
      const margin = graphDirection === "TB" ? 80 : 60;

      return !(
        firstRect.right + margin <= secondRect.left ||
        firstRect.left >= secondRect.right + margin ||
        firstRect.bottom + margin <= secondRect.top ||
        firstRect.top >= secondRect.bottom + margin
      );
    };

    const alignChildToParent = (childNode: Node, parentNode: Node): Node => {
      const childSize = getNodeSize(childNode);
      const parentSize = getNodeSize(parentNode);

      if (graphDirection === "TB") {
        const parentCenterX = parentNode.position.x + parentSize.width / 2;

        return {
          ...childNode,
          position: {
            ...childNode.position,
            x: parentCenterX - childSize.width / 2,
          },
        };
      }

      const parentCenterY = parentNode.position.y + parentSize.height / 2;

      return {
        ...childNode,
        position: {
          ...childNode.position,
          y: parentCenterY - childSize.height / 2,
        },
      };
    };

    const readyNewIds = new Set<string>();
    const unresolvedNewIds = new Set(newIds);

    for (let pass = 0; pass < newIds.size; pass++) {
      let passChanged = false;

      for (const childId of Array.from(unresolvedNewIds)) {
        const childNode = updatedById.get(childId);

        if (!childNode) {
          unresolvedNewIds.delete(childId);
          continue;
        }

        const parentIds = incomingParentsByChild.get(childId) ?? [];

        const parentId =
          parentIds.find((id) => newIds.has(id) && readyNewIds.has(id)) ??
          parentIds.find((id) => !newIds.has(id)) ??
          null;

        if (!parentId) {
          if (parentIds.length === 0) {
            readyNewIds.add(childId);
            unresolvedNewIds.delete(childId);
            passChanged = true;
          }

          continue;
        }

        const parentNode = updatedById.get(parentId);

        if (!parentNode) {
          readyNewIds.add(childId);
          unresolvedNewIds.delete(childId);
          passChanged = true;
          continue;
        }

        const parentChildren = outgoingChildrenByParent.get(parentId) ?? [];

        if (parentChildren.length !== 1 || parentChildren[0] !== childId) {
          readyNewIds.add(childId);
          unresolvedNewIds.delete(childId);
          passChanged = true;
          continue;
        }

        const alignedChild = alignChildToParent(childNode, parentNode);

        const collides = Array.from(updatedById.entries()).some(([otherId, otherNode]) => {
          if (otherId === childId || otherId === parentId) {
            return false;
          }

          return nodesOverlap(alignedChild, otherNode);
        });

        if (!collides) {
          updatedById.set(childId, alignedChild);
        }

        readyNewIds.add(childId);
        unresolvedNewIds.delete(childId);
        passChanged = true;
      }

      if (!passChanged) {
        break;
      }
    }

    const resolvedNodes = currentNodes.map((node) => updatedById.get(String(node.id)) ?? node);

    return centerProjectOverGraphBranches(resolvedNodes, graphDirection);
  };

  const tryResolveNewNodesCollisions = () => {
    const pending = pendingNewNodesRef.current;
    if (!pending) return;

    if (pending.reflowWholeGraph) {
      setNodes((currentNodes) => {
        const hasNewNodes = currentNodes.some((node) => !pending.beforeIds.has(String(node.id)));

        if (!hasNewNodes) {
          pendingNewNodesRef.current = null;
          return currentNodes;
        }

        persistPositionsBulk(
          graphDirection,
          currentNodes.map((node) => ({
            id: String(node.id),
            position: node.position,
          }))
        );

        pendingNewNodesRef.current = null;

        return currentNodes;
      });

      return;
    }

    if (viewModeRef.current !== "hierarchical") return;

    const currentIds = new Set(nodesRef.current.map((n) => String(n.id)));
    const newIds = Array.from(currentIds).filter(
      (id) => !pending.beforeIds.has(id) && id !== "PROJECT"
    );

    if (newIds.length === 0) return;

    const dir = graphDirRef.current;

    if (
      pending.operation === "duplicate" &&
      Array.isArray(pending.duplicatedPairs) &&
      pending.duplicatedPairs.length > 0
    ) {
      setNodes((prev) => {
        const result = placeDuplicatedNodesAsBranchBlock(
          dir,
          prev,
          pending.duplicatedPairs ?? []
        );

        const alignedNodes = alignPendingSingleChildrenToParents(result.nodes);
        const centeredNodes = centerProjectOverGraphBranches(alignedNodes, dir);

        const positionsToPersist = centeredNodes.map((node) => ({
          id: String(node.id),
          position: node.position,
        }));

        persistPositionsBulk(dir, positionsToPersist);

        pendingNewNodesRef.current = null;

        return centeredNodes;
      });

      return;
    }

    setNodes((prev) => {
      const step = getLevelStep(dir);

      const newIdsByLevel = new Map<number, string[]>();

      for (const id of newIds) {
        const node = prev.find((n) => String(n.id) === id);
        if (!node) continue;

        const levelKey = Math.round(getLevelCoord(dir, node.position) / step);
        const arr = newIdsByLevel.get(levelKey) ?? [];
        arr.push(id);
        newIdsByLevel.set(levelKey, arr);
      }

      if (newIdsByLevel.size === 0) return prev;

      const levelKeys = Array.from(newIdsByLevel.keys()).sort((a, b) => a - b);

      let nodesAcc = prev;
      const changedMap = new Map<string, { x: number; y: number }>();

      for (const levelKey of levelKeys) {
        const idsInLevel = newIdsByLevel.get(levelKey) ?? [];
        if (idsInLevel.length === 0) continue;

        let anchorId = idsInLevel[0];
        let bestNum = Number.NEGATIVE_INFINITY;

        for (const id of idsInLevel) {
          const n = parseInt(id, 10);
          if (!Number.isNaN(n) && n > bestNum) {
            bestNum = n;
            anchorId = id;
          }
        }

        const beforePos = new Map<string, { x: number; y: number }>();

        for (const n of nodesAcc) {
          const k = Math.round(getLevelCoord(dir, n.position) / step);
          if (k === levelKey) beforePos.set(String(n.id), n.position);
        }

        nodesAcc = resolveOverlapsInLevel(dir, nodesAcc, anchorId, levelKey);

        for (const n of nodesAcc) {
          const k = Math.round(getLevelCoord(dir, n.position) / step);
          if (k !== levelKey) continue;

          const prevP = beforePos.get(String(n.id));
          if (!prevP) continue;

          if (prevP.x !== n.position.x || prevP.y !== n.position.y) {
            changedMap.set(String(n.id), n.position);
          }
        }
      }

      const changedItems = Array.from(changedMap.entries()).map(([id, position]) => ({
        id,
        position,
      }));

      const centeredNodes = centerProjectOverGraphBranches(nodesAcc, dir);

      const projectPositionChange = getProjectPositionChange(
        nodesAcc,
        centeredNodes
      );

      if (projectPositionChange) {
        changedItems.push(projectPositionChange);
      }

      if (changedItems.length) {
        persistPositionsBulk(dir, changedItems);
      }

      pendingNewNodesRef.current = null;

      return centeredNodes;
    });
  };


  const handleContextMenu = (event: React.MouseEvent) => {
    const target = event.target as HTMLElement;
    const isNode = !!target.closest(".react-flow__node");
    if (isNode) return;

    // preventCtrlClickContextMenuOnMac
    if (isMac && event.ctrlKey) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    event.preventDefault();
    event.stopPropagation();

    const inst = reactFlowInstanceRef.current;
    const wrapper = flowWrapperRef.current;
    if (inst && wrapper) {
      const bounds = wrapper.getBoundingClientRect();
      const px = event.clientX - bounds.left;
      const py = event.clientY - bounds.top;

      const rfPoint = inst.project({ x: px, y: py });
      lastPaneRFPointRef.current = rfPoint;

      const MENU_W = 230;
      const MENU_H = 150;
      const clampedX = Math.max(0, Math.min(px, bounds.width - MENU_W));
      const clampedY = Math.max(0, Math.min(py, bounds.height - MENU_H));

      setContextMenu({ visible: true, x: clampedX, y: clampedY, nodeId: null });
    } else {
      lastPaneRFPointRef.current = null;
      setContextMenu({ visible: true, x: event.clientX, y: event.clientY, nodeId: null });
    }
  };

  const handleCloseMenu = () => setContextMenu((prev) => ({ ...prev, visible: false }));

  useEffect(() => {
    if (!contextMenu.visible) return;
    const onWindowMouseDown = (e: MouseEvent) => {
      const el = e.target as HTMLElement;
      if (!el.closest?.("#canvas-context-menu")) handleCloseMenu();
    };
    const onKeyDown = (e: KeyboardEvent) => { if (e.key === "Escape") handleCloseMenu(); };
    window.addEventListener("mousedown", onWindowMouseDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("mousedown", onWindowMouseDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [contextMenu.visible]);

  const handleAddProtocolFromContext = () => {
    handleCloseMenu();

    // Ensure mutual exclusivity: opening Protocols closes Workflows
    setWorkflowsOpen(false);
    closeAllDockedForms();
    setDrawerOpen(true);

    const point = lastPaneRFPointRef.current;
    if (!point) {
      const inst = reactFlowInstanceRef.current;
      if (inst) {
        const vp = inst.getViewport();
        lastPaneRFPointRef.current = { x: -vp.x / vp.zoom, y: -vp.y / vp.zoom };
      }
    }

    const beforeIds = new Set(nodesRef.current.map((n) => String(n.id)));
    pendingPlacementRef.current = {
      point: lastPaneRFPointRef.current ?? { x: 0, y: 0 },
      beforeIds,
    };

    setDrawerOpen(true);
  };

  /* ------------------------ ReactFlow init / move / selection ------------------------ */
  const handleOnInit = useCallback((inst: ReactFlowInstance) => {
    reactFlowInstanceRef.current = inst;
    try {
      const current = inst.getViewport();
      const savedViewport = readPersistedViewport();

      if (savedViewport) {
        inst.setViewport(savedViewport);
        setViewport(savedViewport);
        firstLoadRef.current = false;
        skipNextGridSnapRef.current = viewMode === "grid";
        return;
      }

      const desiredZoom = viewMode === "grid" ? GRID_ZOOM : clampZoom(viewportRef.current.zoom ?? current.zoom);

      if (viewMode === "grid") {
        inst.setViewport({ x: 0, y: 0, zoom: GRID_ZOOM });
        setViewport({ x: 0, y: 0, zoom: GRID_ZOOM });
      } else {
        inst.setViewport({ x: current.x, y: current.y, zoom: desiredZoom });
        const vp = inst.getViewport();
        setViewport({ x: vp.x, y: vp.y, zoom: vp.zoom });
        if (firstLoadRef.current) {
          const expected = nodesRef.current?.length ?? 0;
          if (expected > 0) {
            (async () => {
              const ok = await waitForNodesReady(expected, 2000);
              if (ok && firstLoadRef.current && viewModeRef.current === "hierarchical") {
                centerLikeButton(nodesRef.current, true, viewportRef.current.zoom);
                firstLoadRef.current = false;
              }
            })();
          }
        }
      }
    } catch { }
  }, [readPersistedViewport, viewMode]);

  const handleOnMoveEnd = useCallback((_: any, vp: { x: number; y: number; zoom: number }) => {
    setViewport(vp);
    writePersistedViewport(vp);
  }, [writePersistedViewport]);

  const onSelectionChange = useCallback(({ nodes: selNodes }: { nodes: Node[]; edges: Edge[] }) => {
    if (suppressNextSyncRef.current) {
      suppressNextSyncRef.current = false;
      return;
    }

    const ids = new Set((selNodes ?? []).map((n) => n.id));

    if (ids.size > 1) {
      if (setsEqual(ids, pathSelRef.current.nodes)) return;
      applyGenericSelectionFromSet(ids);
      syncUnifiedSelectedIds();
      return;
    }

    if (ids.size === 1) {
      if (pathSelRef.current.nodes.size || pathSelRef.current.edges.size) {
        clearPathSelection();
      }
      const id = selNodes![0].id;
      selectedIdRef.current = id;
      setPreviousNodeId(id);
      setHighlightedId(id);
      applyEdgeHighlight(id);
      setNodes((prev) => prev.map((n) => ({ ...n, selected: n.id === id })));
      syncUnifiedSelectedIds();
      return;
    }

    selectedIdRef.current = null;
    setPreviousNodeId(null);
    setHighlightedId(null);
    clearPathSelection();
    applyEdgeHighlight(null);
    setNodes((prev) => (prev.some((n) => n.selected) ? prev.map((n) => ({ ...n, selected: false })) : prev));
    syncUnifiedSelectedIds();
  }, [setNodes, applyGenericSelectionFromSet, clearPathSelection, applyEdgeHighlight]);


  /* ------------------------ Dialogs + API ------------------------ */
  const emptyRenameDialog = {
    open: false,
    id: null,
    value: "",
    comment: "",
  };

  const [dlgRename, setDlgRename] = useState<{
    open: boolean;
    id: string | null;
    value: string;
    comment: string;
  }>(emptyRenameDialog);

  const [dlgResetFrom, setDlgResetFrom] = useState<{ open: boolean; id: string | null }>({
    open: false, id: null,
  });

  // deleteDialogState
  const [dlgDelete, setDlgDelete] = useState<{ open: boolean; ids: string[] }>({
    open: false,
    ids: [],
  });

  // restartAllDialogState
  const [dlgRestartAll, setDlgRestartAll] = useState<{ open: boolean; id: string | null }>({
    open: false,
    id: null,
  });

  // continueAllDialogState
  const [dlgContinueAll, setDlgContinueAll] = useState<{ open: boolean; id: string | null }>({
    open: false,
    id: null,
  });

  // stopDialogState
  const [dlgStop, setDlgStop] = useState<{ open: boolean; ids: string[] }>({
    open: false,
    ids: [],
  });

  const [deleteBusy, setDeleteBusy] = useState(false);
  const [restartAllBusy, setRestartAllBusy] = useState(false);
  const [continueAllBusy, setContinueAllBusy] = useState(false);
  const [stopBusy, setStopBusy] = useState(false);


  type ApiWorkflowResponse = {
    status: number;
    errors: string[];
    workflow: unknown[];
  };

  const showApiErrorsToast = (errors: unknown, fallbackMessage: string) => {
    const list = Array.isArray(errors) ? errors.map((x) => String(x)).filter(Boolean) : [];
    const msg = list.length ? list : [fallbackMessage];

    toast.error(
      <div style={{ maxWidth: 520 }}>
        <div style={{ fontWeight: 600, marginBottom: 6 }}>Operation failed</div>
        <ul style={{ margin: 0, paddingLeft: 18 }}>
          {msg.map((e, i) => (
            <li key={i}>{e}</li>
          ))}
        </ul>
      </div>
    );
  };

  const ensureApiOk = (res: ApiWorkflowResponse, fallbackMessage: string): boolean => {
    const status = Number(res.status);

    if (!Number.isFinite(status)) {
      toast.error(fallbackMessage);
      return false;
    }

    if (status !== 0) {
      showApiErrorsToast(res.errors, fallbackMessage);
      return false;
    }

    return true;
  };


  const getErrorMsg = (e: any) => {
    if (e && typeof e === "object") {
      const status = (e as any).status;
      const data = (e as any).data;
      if (status === 500) return (data?.detail as string) || (e.message as string) || "Server error";
      return (data?.message as string) || (e.message as string) || "Operation failed";
    }
    return "Operation failed";
  };

  const getSelectedProtocolIdsForWorkflowCopy = (): string[] => {
    return Array.from(new Set(
      Array.from(getUnifiedSelectedIds())
        .map(String)
        .filter((id) => id && id !== "PROJECT")
    ));
  };

  const handleCopyWorkflow = async () => {
    const currentProjectId = getProjectId();

    if (currentProjectId == null) {
      toast.error("Project is not loaded yet.");
      return;
    }

    const protocolIds = getSelectedProtocolIdsForWorkflowCopy();

    if (!protocolIds.length) {
      toast.error("Select at least one protocol to copy.");
      return;
    }

    try {
      const result = await svc.exportWorkflowProtocols(currentProjectId, {
        protocolIds,
        includeUpstream: false,
      });

      setWorkflowClipboard({
        sourceProjectId: result.sourceProjectId ?? currentProjectId,
        sourceProjectName:
          result.sourceProjectName ??
          String((project as any)?.name ?? (project as any)?.shortName ?? projectName ?? ""),
        protocolIds: (result.protocolIds ?? protocolIds).map(String),
        workflow: result.workflow,
        copiedAt: new Date().toISOString(),
      });

      toast.success(
        protocolIds.length > 1
          ? `${protocolIds.length} protocols copied.`
          : "Protocol copied."
      );
    } catch (e) {
      console.error("copy workflow failed", e);
      toast.error(getErrorMsg(e));
    }
  };

  const handlePasteWorkflow = async () => {
    const currentProjectId = getProjectId();
    const clipboard = workflowClipboardMemory ?? workflowClipboard;

    if (currentProjectId == null) {
      toast.error("Project is not loaded yet.");
      return;
    }

    if (!clipboard?.workflow) {
      toast.error("No workflow copied.");
      return;
    }

    const beforeIds = new Set(nodesRef.current.map((n) => String(n.id)));
    const beforePositions = new Map<string, { x: number; y: number }>();

    for (const node of nodesRef.current) {
      const nodeId = String(node.id);
      if (!nodeId || !node.position) continue;

      beforePositions.set(nodeId, {
        x: node.position.x,
        y: node.position.y,
      });
    }

    pendingNewNodesRef.current = {
      beforeIds,
      beforePositions,
      operation: "add",
      reflowWholeGraph: false,
    };

    try {
      const result = await svc.importWorkflowProtocols(currentProjectId, {
        workflow: clipboard.workflow,
        mode: "append",
        sourceProjectId: clipboard.sourceProjectId,
        sourceProjectName: clipboard.sourceProjectName,
      });

      if (!ensureApiOk(result as ApiWorkflowResponse, "Paste workflow failed.")) {
        pendingNewNodesRef.current = null;
        return;
      }

      const createdCount = Array.isArray(result.created) ? result.created.length : 0;

      toast.success(
        createdCount > 1
          ? `${createdCount} protocols pasted.`
          : createdCount === 1
            ? "Protocol pasted."
            : "Workflow pasted."
      );

      clearAllSelectionHard();
      await Promise.resolve(handleRefreshRef.current?.());
    } catch (e) {
      console.error("paste workflow failed", e);
      toast.error(getErrorMsg(e));
      pendingNewNodesRef.current = null;
    }
  };

  const getNodeLabelById = (id: string) => {
    const node = nodesRef.current.find((n) => n.id === id);
    return ((node as any)?.data?.label as string) || id;
  };

  const genCopyName = (id: string) => {
    const label = getNodeLabelById(id);
    const normalized = String(label).trim().replace(/\s+/g, "_").replace(/[^\w.-]/g, "");
    return `${normalized}_copy_${Date.now().toString().slice(-5)}`;
  };

  const duplicateNow = async (ids: string[]) => {
    if (!projectName) return;

    const cleanIds = ids.filter((i) => i && i !== "PROJECT");
    if (cleanIds.length === 0) return;

    const beforeIds = new Set(nodesRef.current.map((n) => String(n.id)));
    const beforePositions = new Map<string, { x: number; y: number }>();

    for (const node of nodesRef.current) {
      const nodeId = String(node.id);
      if (!nodeId || !node.position) continue;

      beforePositions.set(nodeId, {
        x: node.position.x,
        y: node.position.y,
      });
    }

    const sourcePositionById = new Map<string, { x: number; y: number }>();
    for (const id of cleanIds) {
      const node = nodesRef.current.find((n) => String(n.id) === String(id));
      if (node?.position) {
        sourcePositionById.set(String(id), node.position);
      }
    }

    pendingNewNodesRef.current = {
      beforeIds,
      beforePositions,
      operation: "duplicate",
      duplicatedPairs: [],
      reflowWholeGraph: false,
    };

    try {
      const items = cleanIds.map((id) => ({ id, name: genCopyName(id) }));
      const result = await svc.duplicateProtocol(projectName, items);

      const duplicatedFromBackend = Array.isArray((result as any)?.duplicated)
        ? (result as any).duplicated
        : [];

      pendingNewNodesRef.current = {
        beforeIds,
        beforePositions,
        operation: "duplicate",
        reflowWholeGraph: false,
        duplicatedPairs: duplicatedFromBackend
          .map((pair: any) => {
            const sourceId = String(pair?.sourceId ?? "");
            const newId = String(pair?.newId ?? "");
            if (!sourceId || !newId) return null;

            return {
              sourceId,
              newId,
              sourcePosition: sourcePositionById.get(sourceId),
            };
          })
          .filter(Boolean) as Array<{
            sourceId: string;
            newId: string;
            sourcePosition?: { x: number; y: number };
          }>,
      };

      toast.success(cleanIds.length > 1 ? "Protocols duplicated successfully." : "Protocol duplicated successfully.");

      clearAllSelectionHard();
      await Promise.resolve(handleRefreshRef.current?.());
    } catch (e) {
      console.error(e);
      toast.error(getErrorMsg(e));
      pendingNewNodesRef.current = null;
    }
  };


  const openRename = (id: string) =>
    setDlgRename({
      open: true,
      id,
      value: findNodeEditableRunName(id),
      comment: findNodeComment(id),
    });

  const openDelete = (id: string) => {
    const selected =
      pathSelRef.current.nodes.size > 0
        ? Array.from(pathSelRef.current.nodes).map(String).filter((x) => x !== "PROJECT")
        : [String(id)];

    setDlgDelete({ open: true, ids: selected });
  };

  const openRestartAll = (id: string) => setDlgRestartAll({ open: true, id: String(id) });

  const openContinueAll = (id: string) => setDlgContinueAll({ open: true, id: String(id) });

  const openResetFrom = (id: string) => setDlgResetFrom({ open: true, id: String(id) });

  const openStop = (id: string) => {
    const clickedId = String(id);

    const clickedNode = nodesRef.current.find(
      (node) => String(node.id) === clickedId
    );

    const visuallySelectedIds = nodesRef.current
      .filter(
        (node) =>
          node.selected &&
          String(node.id) !== "PROJECT"
      )
      .map(
        (node) => String(node.id)
      );

    const ids =
      clickedNode?.selected &&
        visuallySelectedIds.length > 0
        ? Array.from(
          new Set(visuallySelectedIds)
        )
        : [clickedId];

    setDlgStop({
      open: true,
      ids,
    });
  };


  const submitRename = async () => {
    if (!projectName || !dlgRename.id) return;

    const id = dlgRename.id;
    const runName = dlgRename.value.trim();
    const comment = dlgRename.comment.trim();

    setDlgRename(emptyRenameDialog);

    try {
      await svc.renameProtocol(projectName, id, { runName, comment });

      toast.success("Protocol annotation updated successfully.");
      await handleRefresh();
    } catch (e) {
      console.error(e);
      toast.error(getErrorMsg(e));
    }
  };

  /* ------------------------ Controls ------------------------ */
  const ZOOM_FACTOR = 1.2;
  const handleZoomIn = useCallback(() => {
    if (viewMode === "grid") return;
    const inst = reactFlowInstanceRef.current ?? (window as any).reactFlowInstance;
    if (!inst) return;
    const vp = inst.getViewport();
    const newZoom = Math.min(vp.zoom * ZOOM_FACTOR, MAX_ZOOM);
    inst.setViewport({ x: vp.x, y: vp.y, zoom: newZoom });
    const newVp = inst.getViewport();
    setViewport({ x: newVp.x, y: newVp.y, zoom: newVp.zoom });
  }, [viewMode]);
  const handleZoomOut = useCallback(() => {
    if (viewMode === "grid") return;
    const inst = reactFlowInstanceRef.current ?? (window as any).reactFlowInstance;
    if (!inst) return;
    const vp = inst.getViewport();
    const newZoom = Math.max(vp.zoom / ZOOM_FACTOR, MIN_ZOOM);
    inst.setViewport({ x: vp.x, y: vp.y, zoom: newZoom });
    const newVp = inst.getViewport();
    setViewport({ x: newVp.x, y: newVp.y, zoom: newVp.zoom });
  }, [viewMode]);
  const handleFitView = useCallback(() => {
    if (viewMode === "grid") {
      snapViewportToTopLeft(GRID_ZOOM);
      return;
    }
    centerLikeButton(undefined, true);
  }, [viewMode, centerLikeButton, snapViewportToTopLeft]);

  /* ------------------------ Wrapper plumbing (unchanged) ------------------------ */
  const onClickRef = useRef(handleNodeClick);
  const onDblClickRef = useRef(handleNodeDoubleClick);
  const prevIdRef = useRef<string | null>(null);
  const hoveredIdRef = useRef<string | null>(null);
  const graphDirRef = useRef<"TB" | "LR">(graphDirection);

  useEffect(() => { onClickRef.current = handleNodeClick; }, [handleNodeClick]);
  useEffect(() => { onDblClickRef.current = handleNodeDoubleClick; }, [handleNodeDoubleClick]);
  useEffect(() => { prevIdRef.current = previousNodeId; }, [previousNodeId]);
  useEffect(() => { hoveredIdRef.current = hoveredNodeId; }, [hoveredNodeId]);
  useEffect(() => { graphDirRef.current = graphDirection; }, [graphDirection]);

  const nodeActionsRef = useRef<NodeActions>({});


  // --- Global node keyboard shortcuts ---
  useEffect(() => {
    const isMac =
      typeof navigator !== "undefined" && /Mac|iPhone|iPad|iPod/.test(navigator.platform);
    const modPressed = (ev: KeyboardEvent) => (isMac ? ev.metaKey : ev.ctrlKey);

    const isTypingTarget = (el: EventTarget | null) => {
      const t = el as HTMLElement | null;
      if (!t) return false;

      return !!t.closest(
        'input, textarea, select, [contenteditable=""], [contenteditable="true"], [role="dialog"]'
      );
    };

    const getSelectedIds = (): string[] => {
      if (pathSelRef.current.nodes.size > 0) {
        return Array.from(pathSelRef.current.nodes)
          .map(String)
          .filter((id) => id !== "PROJECT");
      }
      const id = selectedIdRef.current;
      return id && id !== "PROJECT" ? [id] : [];
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.repeat) return;

      const anyActionDialogOpen =
        dlgDelete.open || dlgRestartAll.open || dlgContinueAll.open || dlgStop.open;

      if (
        dlgRename.open ||
        anyActionDialogOpen ||
        dlgResetFrom.open ||
        protocolStepsDialog.open ||
        fileDialogOpen ||
        drawerOpen ||
        contextMenu.visible ||
        isTypingTarget(e.target)
      ) {
        return;
      }

      if (modPressed(e) && e.shiftKey && e.key.toLowerCase() === "d") {
        e.preventDefault();
        e.stopPropagation();
        (e as any).stopImmediatePropagation?.();

        const ids = getSelectedIds();

        if (ids.length !== 1) {
          toast.error(ids.length > 1 ? "Select only one protocol." : "Select a protocol first.");
          return;
        }

        openProtocolStepsDialog(ids[0]);
        return;
      }

      if (modPressed(e) && !e.shiftKey && e.key.toLowerCase() === "p") {
        e.preventDefault();
        e.stopPropagation();
        (e as any).stopImmediatePropagation?.();

        closeAllDockedForms();
        handleProtocolsDrawerOpenChange(true);
        return;
      }

      if (modPressed(e) && !e.shiftKey && e.key.toLowerCase() === "p") {
        e.preventDefault();
        e.stopPropagation();
        (e as any).stopImmediatePropagation?.();

        closeAllDockedForms();
        handleProtocolsDrawerOpenChange(true);
        return;
      }

      if (modPressed(e) && !e.shiftKey && e.key.toLowerCase() === "a") {
        e.preventDefault();
        e.stopPropagation();
        (e as any).stopImmediatePropagation?.();

        handleSelectAllWorkflow();
        return;
      }

      if (modPressed(e) && !e.shiftKey && e.key.toLowerCase() === "c") {
        e.preventDefault();
        e.stopPropagation();
        (e as any).stopImmediatePropagation?.();

        void handleCopyWorkflow();
        return;
      }

      if (modPressed(e) && !e.shiftKey && e.key.toLowerCase() === "v") {
        e.preventDefault();
        e.stopPropagation();
        (e as any).stopImmediatePropagation?.();

        void handlePasteWorkflow();
        return;
      }

      const ids = getSelectedIds();
      const selectedId = selectedIdRef.current;

      if ((e.key === " " || e.key === "Enter" || e.code === "Space" || e.key === "Spacebar") && selectedId) {
        e.preventDefault();
        e.stopPropagation();
        (e as any).stopImmediatePropagation?.();
        handleNodeDoubleClick({ id: selectedId });
        return;
      }

      if ((e.key === "Delete" || e.key === "Backspace") && ids.length > 0) {
        e.preventDefault();
        e.stopPropagation();
        (e as any).stopImmediatePropagation?.();
        openDelete(ids[0]);
        return;
      }

      if (e.key === "F2" && selectedId) {
        e.preventDefault();
        e.stopPropagation();
        (e as any).stopImmediatePropagation?.();
        openRename(selectedId);
        return;
      }

      if (modPressed(e) && !e.shiftKey && e.key.toLowerCase() === "d" && ids.length > 0) {
        e.preventDefault();
        e.stopPropagation();
        (e as any).stopImmediatePropagation?.();
        duplicateNow(ids);
        return;
      }

      if (modPressed(e) && !e.shiftKey && e.key.toLowerCase() === "b" && selectedId) {
        e.preventDefault();
        openBrowse(selectedId, project?.id, findNodeRunName(selectedId));
        return;
      }

      if (modPressed(e) && e.shiftKey && e.key.toLowerCase() === "r" && selectedId) {
        e.preventDefault();
        openRestartAll(selectedId);
        return;
      }

      if (modPressed(e) && e.shiftKey && e.key.toLowerCase() === "c" && selectedId) {
        e.preventDefault();
        openContinueAll(selectedId);
        return;
      }

      if (modPressed(e) && e.shiftKey && e.key.toLowerCase() === "f" && selectedId) {
        e.preventDefault();
        return;
      }

      if (modPressed(e) && e.shiftKey && e.key.toLowerCase() === "s" && selectedId) {
        e.preventDefault();
        openStop(selectedId);
        return;
      }

      if (!modPressed(e) && e.altKey && e.key === "ArrowDown" && selectedId) {
        e.preventDefault();
        handleSelectFrom(selectedId);
        return;
      }

      if (!modPressed(e) && e.altKey && e.key === "ArrowUp" && selectedId) {
        e.preventDefault();
        handleSelectTo(selectedId);
        return;
      }
    };

    window.addEventListener("keydown", onKeyDown, { capture: true });
    return () => window.removeEventListener("keydown", onKeyDown, { capture: true } as any);
  }, [
    project?.id,
    drawerOpen,
    fileDialogOpen,
    contextMenu.visible,
    dlgRename.open,
    dlgResetFrom.open,
    dlgDelete.open,
    dlgRestartAll.open,
    dlgContinueAll.open,
    dlgStop.open,
    handleNodeDoubleClick,
    openDelete,
    openRename,
    openRestartAll,
    openContinueAll,
    openStop,
    handleSelectFrom,
    handleSelectTo,
    handleSelectAllWorkflow,
    closeAllDockedForms,
    handleProtocolsDrawerOpenChange,
    handleOpenWorkflows,
    handleCopyWorkflow,
    handlePasteWorkflow,
    protocolStepsDialog.open,
    openProtocolStepsDialog,
  ]);



  // focusModeDerivedGraph
  const focusActive =
    focusModeEnabled &&
    unifiedSelectedIdsState.size > 0 &&
    viewMode !== "table";

  const renderNodes = useMemo(() => {
    // deriveRenderNodes
    const tagFilterSet = new Set(tagFilterIds);
    const tagFilterActive = tagFilterSet.size > 0;

    const dimOpacity = 0.18;

    let anyChanged = false;

    const next = nodes.map((n) => {
      const nodeId = String(n.id);

      // keepProjectNodeAsIs
      if (nodeId === "PROJECT") return n;

      const dataAny: any = (n as any).data ?? {};
      const assignedTagIds = pickFirstNonEmptyTagIds(
        tagAssignments[nodeId],
        dataAny.tagIds,
        dataAny.tags
      );


      const matchesTagFilter = !tagFilterActive
        ? true
        : assignedTagIds.some((tid) => tagFilterSet.has(tid));

      const tagColor = assignedTagIds.length ? tagById.get(assignedTagIds[0])?.color : undefined;

      const inFocus = focusActive ? unifiedSelectedIdsState.has(nodeId) : true;

      const shouldDim = (focusActive && !inFocus) || (tagFilterActive && !matchesTagFilter);
      const desiredOpacity = shouldDim ? dimOpacity : 1;

      const baseStyle: any = (n as any).style ?? {};
      const curOpacity = typeof baseStyle.opacity === "number" ? baseStyle.opacity : 1;

      const curColor = typeof dataAny.color === "string" ? dataAny.color : undefined;


      const curTagIds = normalizeTagIds((dataAny as any).tagIds);
      const sameTags =
        curTagIds.length === assignedTagIds.length &&
        curTagIds.every((x) => assignedTagIds.includes(x)) &&
        assignedTagIds.every((x) => curTagIds.includes(x));

      const nextDataWithTags = sameTags
        ? dataAny
        : { ...dataAny, tagIds: assignedTagIds }; // keepNodeDataInSyncWithAssignments


      const nextStyle =
        curOpacity === desiredOpacity && (!focusActive || baseStyle.zIndex === (inFocus ? 10 : 0))
          ? baseStyle
          : {
            ...baseStyle,
            opacity: desiredOpacity,
            zIndex: focusActive ? (inFocus ? 10 : 0) : baseStyle.zIndex,
          };

      const baseData = nextDataWithTags;

      const nextData =
        tagColor && curColor !== tagColor
          ? { ...baseData, color: tagColor }
          : baseData; // deriveColorFromFirstTagIfPresent

      const styleChanged = nextStyle !== baseStyle;
      const dataChanged = nextData !== dataAny;

      if (!styleChanged && !dataChanged) return n;

      anyChanged = true;
      return { ...n, style: nextStyle, data: nextData };
    });

    return anyChanged ? next : nodes;
  }, [nodes, focusActive, unifiedSelectedIdsState, tagFilterIds, tagAssignments, tagById]);


  const renderEdges = useMemo(() => {
    // deriveRenderEdges
    if (!focusActive) return edges;

    const dimOpacity = 0.1;

    // keepContextEdges
    const focusEdgeIds = new Set<string>();
    const hasPathEdges = pathSelRef.current.edges.size > 0;

    if (hasPathEdges) {
      for (const id of pathSelRef.current.edges) focusEdgeIds.add(String(id));
    } else {
      for (const e of edges) {
        const s = String(e.source);
        const t = String(e.target);
        if (unifiedSelectedIdsState.has(s) || unifiedSelectedIdsState.has(t)) {
          focusEdgeIds.add(String(e.id));
        }
      }
    }

    return edges.map((e) => {
      const inFocus = focusEdgeIds.has(String(e.id));
      const baseStyle: any = (e as any).style ?? {};
      const desiredOpacity = inFocus ? 1 : dimOpacity;

      const currentOpacity =
        typeof baseStyle.opacity === "number" ? baseStyle.opacity : 1;

      if (currentOpacity === desiredOpacity) return e;

      return {
        ...e,
        style: {
          ...baseStyle,
          opacity: desiredOpacity,
        },
      };
    });
  }, [edges, focusActive, unifiedSelectedIdsState]);


  /* ------------------------ Render ------------------------ */
  const isGrid = viewMode === "grid";
  const canSelectAllWorkflow = getAllWorkflowProtocolIds().size > 0;

  return (
    <div className={`${ROOT_CLASS} ${hostIsDark ? "dark" : ""}`}>
      <div className="h-app min-h-0 flex flex-col relative overflow-hidden bg-background text-foreground">

        {/* Header */}
        <div className="pp-headerRow">
          <div className="pp-headerLeft">
            <div ref={searchBoxRef} className="pp-searchBox">
              <div className="pp-searchIconWrap" aria-hidden="true">
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  className="pp-searchIcon"
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
              </div>

              <input
                type="text"
                placeholder="Search protocol..."
                value={searchQuery}
                onChange={(e) => handleSearchInputChange(e.target.value)}
                onKeyDown={handleSearchKeyDown}
                onFocus={() => {
                  if (searchQuery.trim()) setSearchOpen(true);
                }}
                className="pp-searchInput"
              />

              {searchOpen && searchQuery.trim() && (
                <div className="pp-searchDropdown" role="listbox" aria-label="Search results">
                  {searchResults.length === 0 ? (
                    <div className="pp-searchEmpty" role="status">
                      No matches
                    </div>
                  ) : (
                    searchResults.map((r, idx) => (
                      <button
                        key={r.id}
                        type="button"
                        role="option"
                        aria-selected={idx === searchActiveIndex}
                        className={[
                          "pp-searchItem",
                          idx === searchActiveIndex ? "is-active" : "",
                        ].join(" ")}
                        onMouseDown={(ev) => {
                          // preventInputBlurBeforeClick
                          ev.preventDefault();
                        }}
                        onMouseEnter={() => setSearchActiveIndex(idx)}
                        onClick={() => {
                          void jumpToSearchResult(r);
                        }}
                        title={`${r.id} — ${r.label}`}
                      >
                        <div className="pp-searchItemMain">
                          <span className="pp-searchItemId">{r.id}</span>
                          <span className="pp-searchItemLabel">{r.label}</span>
                        </div>

                        <span
                          className="pp-searchItemStatus"
                          style={getStatusStyle(r.status)}
                        >
                          {r.status ?? "—"}
                        </span>
                      </button>
                    ))
                  )}
                </div>
              )}
            </div>

            <div className="pp-headerCard pp-tagsCard">
              <div className="pp-tagsActions">
                <button
                  type="button"
                  onClick={() => setTagManagerOpen(true)}
                  className="pp-chipBtn"
                  title="Manage tags"
                >
                  <TagsIcon className="pp-btnIcon" />
                  <span>Tags</span>
                </button>

              </div>
              <div className="pp-tagsPicker">
                <TagPicker
                  allTags={allTags}
                  selectedTagIds={tagFilterIds}
                  onChange={setTagFilterIds}
                  disablePortal={false}
                />
              </div>
            </div>
          </div>

          <div className="pp-headerCenter">

            <div className="pp-headerCard pp-actionsCard">
              <div className="pp-protocolsTrigger">
                <ProtocolsDrawer
                  projectId={project?.id ? Number(project.id) : null}
                  open={drawerOpen}
                  onOpenChange={handleProtocolsDrawerOpenChange}
                  onProtocolDoubleClick={handleAddProtocolFromDrawer}
                  onProtocolHelpClick={(protocolClass, protocolLabel) => {
                    // openProtocolHelpFromDrawer
                    void openProtocolHelp(protocolClass, protocolLabel);
                  }}
                  portalContainer={drawerPortalContainer}
                />
              </div>

              <button
                type="button"
                onClick={handleOpenWorkflows}
                disabled={workflowsLoading || !projectName}
                className="pp-chipBtn"
              >
                <TreeIcon className="pp-btnIcon" />
                <span>{workflowsLoading ? "Loading..." : "Workflows"}</span>
              </button>
            </div>
          </div>

          <div className="pp-headerRight">
            <div className="pp-headerCard pp-viewCard">
              <span className="pp-viewLabel">View modes</span>

              <div className="pp-toggleGroup" role="group" aria-label="View mode">
                <button
                  type="button"
                  onClick={() => {
                    setViewMode("hierarchical");
                    setGraphDirection("TB");
                  }}
                  aria-pressed={viewMode === "hierarchical" && graphDirection === "TB"}
                  data-active={viewMode === "hierarchical" && graphDirection === "TB"}
                  className="pp-toggleBtn"
                  title="Tree TB"
                >
                  <TreeIcon className="pp-btnIcon" />
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setViewMode("hierarchical");
                    setGraphDirection("LR");
                  }}
                  aria-pressed={viewMode === "hierarchical" && graphDirection === "LR"}
                  data-active={viewMode === "hierarchical" && graphDirection === "LR"}
                  className="pp-toggleBtn"
                  title="Tree LR"
                >
                  <TreeIcon className="pp-btnIcon pp-rotateLeft" />
                </button>

                <button
                  type="button"
                  onClick={() => setViewMode("grid")}
                  aria-pressed={viewMode === "grid"}
                  data-active={viewMode === "grid"}
                  className="pp-toggleBtn"
                  title="Grid"
                >
                  <LayoutGrid className="pp-btnIcon" />
                </button>

                <button
                  type="button"
                  onClick={() => setViewMode("table")}
                  aria-pressed={viewMode === "table"}
                  data-active={viewMode === "table"}
                  className="pp-toggleBtn"
                  title="Table"
                >
                  <TableIcon className="pp-btnIcon" />
                </button>
              </div>
            </div>

          </div>
        </div>


        {/* Content wrapper */}
        <div ref={contentPortalRef} className="flex-1 relative min-h-0 overflow-hidden" style={{ contain: "paint" }}>
          {/* removed switching overlay to avoid flicker */}

          {isLoadingProject && (
            <div
              role="status"
              aria-live="polite"
              className="absolute inset-0 z-[80] flex flex-col items-center justify-center bg-white/75 dark:bg-gray-900/75 backdrop-blur-[2px]"
              style={{ pointerEvents: "auto" }}
            >
              <div className="relative">
                <div className="w-8 h-8 rounded-full border-2 border-gray-300" />
                <div className="absolute inset-0 rounded-full border-2 border-transparent border-t-gray-700 animate-spin" />
              </div>
              <p className="mt-3 text-xs tracking-wide text-gray-700 dark:text-gray-200">
                Loading <span className="font-medium">Project</span>…
              </p>
            </div>
          )}

          {/* TABLE */}
          <div
            ref={tableContainerRef}
            className={viewMode === "table" ? "pp-tableShell" : "pp-tableShell pp-hidden"}
            aria-hidden={viewMode !== "table"}
          >
            <div className="pp-tableToolbar">
              <button
                type="button"
                className="pp-iconBtn"
                title="Refresh project"
                onClick={handleRefresh}
                disabled={isRefreshing}
              >
                <RefreshCw className={`pp-icon ${isRefreshing ? "pp-spin" : ""}`} />
              </button>
            </div>

            <div className="pp-tableCard">
              <table className="pp-table" role="grid">
                <thead className="pp-thead">
                  <tr className="pp-trHead">
                    <th className="pp-th">Id</th>
                    <th className="pp-th">Protocol</th>
                    <th className="pp-th">State</th>
                    <th className="pp-th">Tags</th>
                    <th className="pp-th">Elapsed</th>
                    <th className="pp-th">Dependent</th>
                  </tr>
                </thead>

                <tbody className="pp-tbody">
                  {filteredTableData.map((row) => (
                    <tr
                      key={row.id}
                      ref={(el) => {
                        rowRefs.current[row.id] = el;
                      }}
                      onClick={(e) => {
                        const target = e.target as HTMLElement;
                        if (target.closest("button,a")) return;

                        if (pathSelRef.current.nodes.size || pathSelRef.current.edges.size) {
                          clearPathSelection();
                        }

                        suppressOneFrame();
                        setNodes((prev) =>
                          prev.map((n) =>
                            n.id === row.id
                              ? n.selected
                                ? n
                                : { ...n, selected: true }
                              : n.selected
                                ? { ...n, selected: false }
                                : n
                          )
                        );

                        selectedIdRef.current = row.id;
                        setPreviousNodeId(row.id);
                        setHighlightedId(row.id);
                        applyEdgeHighlight(row.id);
                      }}
                      onDoubleClick={() => handleRowDoubleClick(row.id)}
                      className={[
                        "pp-tr",
                        highlightedId === row.id ? "pp-trHighlighted" : "",
                      ]
                        .filter(Boolean)
                        .join(" ")}
                    >
                      <td className="pp-td">
                        <div className="pp-idPill">{row.id}</div>
                      </td>

                      <td className="pp-td">
                        <div
                          className="pp-protocolCell"
                          title={String(row?.label ?? "")}
                        >
                          {getProtocolRowDisplayName(row)}
                        </div>
                      </td>

                      <td className="pp-td">
                        <div className="pp-stateCell">
                          <span
                            className={[
                              "pp-statusBadge",
                              row.status === "running" ? "pp-statusPulse" : "",
                            ]
                              .filter(Boolean)
                              .join(" ")}
                            style={getStatusStyle(row.status)}
                          >
                            {row.status ?? "—"}
                          </span>

                          {(row.status === "running" ||
                            row.status === "failed" ||
                            row.status === "aborted") && (
                              <div className="pp-progressWrap" data-status={row.status}>
                                <div className="pp-progressTrack">
                                  <div
                                    className="pp-progressFill"
                                    style={{
                                      width: `${((row.stepsDone ?? 0) / (row.numberOfSteps ?? 1)) * 100}%`,
                                    }}
                                  />
                                </div>
                                <span className="pp-progressText">
                                  {row.stepsDone}/{row.numberOfSteps}
                                </span>
                              </div>
                            )}
                        </div>
                      </td>

                      <td className="pp-td">
                        {renderTableTagsCell(row)}
                      </td>

                      <td className="pp-td">
                        <span className="pp-elapsedText">
                          {formatCpuTime(row.tick ?? Number(row.elapsedTime) ?? 0)}
                        </span>
                      </td>

                      <td className="pp-td">
                        <div className="pp-deps">
                          {row.children?.map((childId: string) => (
                            <button
                              key={childId}
                              type="button"
                              className="pp-linkBtn"
                              onClick={() => scrollToProtocol(childId)}
                              title={`Go to ${childId}`}
                            >
                              {childId}
                            </button>
                          ))}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>


          {/* ReactFlow */}
          <div
            ref={flowWrapperRef}
            className={`absolute inset-0 border ${viewMode !== "table" ? "" : "hidden"}`}
            data-view-mode={viewMode}
            aria-hidden={viewMode === "table"}
            onContextMenu={(e) => e.preventDefault()}
          >
            {/* === Canvas context menu === */}
            {contextMenu.visible && (
              <div
                id="canvas-context-menu"
                className="pp-canvasMenu"
                style={{ top: contextMenu.y, left: contextMenu.x }}
                onContextMenu={(e) => e.preventDefault()}
              >
                <button className="pp-canvasMenuItem" onClick={handleAddProtocolFromContext}>
                  <PlusIcon className="pp-canvasMenuIcon" />
                  <span className="text-sm mb-1">Add protocol</span>
                </button>


                {contextMenuVisibilityPolicyRef.current.pasteWorkflow && (
                  <button
                    className="pp-canvasMenuItem"
                    onClick={() => {
                      handleCloseMenu();
                      void handlePasteWorkflow();
                    }}
                    disabled={!projectId || !workflowClipboard?.workflow}
                    title={
                      workflowClipboard?.sourceProjectName
                        ? `Paste workflow from ${workflowClipboard.sourceProjectName}`
                        : "Paste copied workflow"
                    }
                  >
                    <ClipboardPaste className="pp-canvasMenuIcon" />
                    <span className="text-sm mb-1">Paste workflow</span>
                  </button>
                )}

                <button
                  className="pp-canvasMenuItem"
                  onClick={() => {
                    handleCloseMenu();
                    handleSelectAllWorkflow();
                  }}
                  disabled={!canSelectAllWorkflow}
                  title="Select all workflow protocols"
                >
                  <CheckSquare className="pp-canvasMenuIcon" />
                  <span className="text-sm mb-1">Select all workflow</span>
                </button>
                <div className="pp-canvasMenuSep" />

                <button
                  className="pp-canvasMenuItem"
                  onClick={() => { handleRefresh(); handleCloseMenu(); }}
                >
                  <RefreshCw className="pp-canvasMenuIcon" />
                  <span className="text-sm mb-2">Refresh graph</span>
                </button>

                <button
                  className="pp-canvasMenuItem"
                  onClick={() => { clearAllSelectionHard(); applyEdgeHighlight(null); handleCloseMenu(); }}
                >
                  <XCircle className="pp-canvasMenuIcon" />
                  <span className="text-sm">Clear selection</span>
                </button>
              </div>
            )}


            <div className="pp-flowControlsWrap">
              <div className="pp-flowControls">
                <button
                  type="button"
                  title={isGrid ? "Zoom disabled in Grid" : "Zoom in"}
                  onClick={handleZoomIn}
                  disabled={isGrid}
                  className="pp-flowControlBtn"
                >
                  <PlusIcon className="pp-btnIcon" />
                </button>

                <button
                  type="button"
                  title={isGrid ? "Zoom disabled in Grid" : "Zoom out"}
                  onClick={handleZoomOut}
                  disabled={isGrid}
                  className="pp-flowControlBtn"
                >
                  <MinusIcon className="pp-btnIcon" />
                </button>

                <button
                  type="button"
                  title={isGrid ? "Fixed zoom (Grid)" : "Fit view (preserve zoom)"}
                  onClick={handleFitView}
                  className="pp-flowControlBtn"
                >
                  <FitViewIcon className="pp-btnIcon" />
                </button>

                <button
                  type="button"
                  title="Reorganize project"
                  onClick={() => handleReorganize({ preserveZoom: true })}
                  className="pp-flowControlBtn"
                >
                  <TreeIcon className="pp-btnIcon" />
                </button>

                <button
                  type="button"
                  title="Refresh project"
                  onClick={handleRefresh}
                  className="pp-flowControlBtn"
                >
                  <RefreshCw className={`pp-btnIcon ${isRefreshing ? "animate-spin" : ""}`} />
                </button>

                <button
                  type="button"
                  title={miniMapEnabled ? "Hide minimap" : "Show minimap"}
                  onClick={() => setMiniMapEnabled((v) => !v)}
                  className="pp-flowControlBtn"
                  aria-pressed={miniMapEnabled}
                >
                  <MapIcon className="pp-btnIcon" />
                </button>

                <button
                  type="button"
                  onClick={() => setFocusModeEnabled((v) => !v)}
                  aria-pressed={focusModeEnabled}
                  className="pp-flowControlBtn"
                  title={focusModeEnabled ? "Focus selection: Off" : "Focus selection: On"}
                >
                  <FocusIcon className="pp-btnIcon" />
                </button>

                {hasWidgetBuildInfo() && (
                  <button
                    type="button"
                    onClick={() => setBuildInfoOpen(true)}
                    className="pp-flowControlBtn"
                    title="Build info"
                    aria-label="Build info"
                  >
                    <Info className="pp-btnIcon" />
                  </button>
                )}

              </div>
            </div>


            <ReactFlowProvider>
              <ReactFlow
                nodes={renderNodes}
                edges={renderEdges}
                // preventReactFlowDefaultDeleteeKeyCode is set to null to allow global handling of delete key for both nodes and edges without interference from React Flow's internal handling, enabling custom delete logic that can consider both nodes and edges together.
                deleteKeyCode={null}
                onNodesChange={handleNodesChangeWithPersistence}
                onEdgesChange={onEdgesChange}
                nodeTypes={nodeTypes}
                minZoom={isGrid ? GRID_ZOOM : MIN_ZOOM}
                maxZoom={isGrid ? GRID_ZOOM : MAX_ZOOM}
                zoomOnScroll={!isGrid}
                zoomOnPinch={!isGrid}
                zoomOnDoubleClick={false}
                onInit={handleOnInit}
                onMoveEnd={handleOnMoveEnd}
                onPaneClick={() => {
                  handleCloseMenu();
                  clearAllSelectionHard();
                  applyEdgeHighlight(null);
                }}
                onSelectionChange={onSelectionChange}
                onPaneContextMenu={handleContextMenu}
                defaultViewport={viewport}
                defaultEdgeOptions={{
                  type: "default",
                  style: { stroke: "#999", strokeWidth: 2 },
                  markerEnd: { type: MarkerType.ArrowClosed },
                }}
                onNodeDoubleClick={(_, node) => handleNodeDoubleClick(node)}
                onNodeClick={(evt, node) => handleNodeClick(node, evt)}
                multiSelectionKeyCode={isMac ? "Meta" : "Control"}
                selectionKeyCode="Shift"
                selectionOnDrag
                style={{
                  width: "100%",
                  height: "100%",
                  backgroundColor: hostIsDark ? "#0b1120" : "#f3f4f6"
                }}
                proOptions={{ hideAttribution: true }}
                nodesConnectable={viewMode !== "grid"}
                connectOnClick={viewMode !== "grid"}
              >
                {miniMapEnabled && (
                  <MiniMap
                    position="bottom-left"
                    nodeColor={getMiniMapNodeColor}
                    nodeStrokeColor={getMiniMapNodeStroke}
                    nodeStrokeWidth={2}
                    pannable
                    zoomable
                    zoomStep={1.2}
                    maskColor={hostIsDark ? "rgba(15,23,42,0.55)" : "rgba(0,0,0,0.18)"}
                    style={{
                      background: hostIsDark ? "rgba(2,6,23,0.85)" : "rgba(255,255,255,0.92)",
                      border: hostIsDark ? "1px solid rgba(148,163,184,0.22)" : "1px solid rgba(0,0,0,0.12)",
                      borderRadius: 10,
                      boxShadow: hostIsDark ? "0 10px 26px rgba(0,0,0,0.45)" : "0 10px 26px rgba(0,0,0,0.16)",
                    }}
                  />
                )}
                <Background
                  color={hostIsDark ? "rgba(148, 163, 184, 0.18)" : "rgba(148, 163, 184, 0.35)"}
                  gap={24}
                />
              </ReactFlow>
            </ReactFlowProvider>
          </div>

          {/* ===== Multi-Form Dock (right side) ===== */}
          <div className="dock-wrapper" style={{ zIndex: 60 }}>

            <div
              ref={dockRef}
              className={openForms.length ? "dock-scroll custom-scrollbar" : "hidden"}
            >
              {openForms.map((f) => (
                <div
                  key={f.key}
                  role="dialog"
                  aria-label={`Protocol ${f.id}`}
                  data-dock-key={f.key}
                  className="dock-panel"
                >
                  <ProtocolForm
                    data={f.details}
                    projectProtocols={project?.protocols ?? {}}
                    variant="docked"
                    projectEffectiveSettings={projectEffectiveSettings}
                    onSaved={() => {
                      if (String(f.key).startsWith("class:")) {
                        preparePendingAddProtocolFromForm();
                      }
                    }}
                    onClose={() => {
                      handleRefreshRef.current?.();
                      setTimeout(() => handleRefreshRef.current?.(), 800);

                      setTimeout(() => tryPlaceNewlyCreatedNode(), 50);
                      setTimeout(() => tryPlaceNewlyCreatedNode(), 400);

                      closeFormByKey(f.key);
                    }}
                    onExecuted={() => {
                      if (String(f.key).startsWith("class:")) {
                        preparePendingAddProtocolFromForm();
                      }

                      scheduleDoubleRefresh(5000, true);
                    }}
                  />
                </div>
              ))}
            </div>

          </div>

          <ProjectWorkflowsPanel
            open={workflowsOpen}
            onClose={() => setWorkflowsOpen(false)}
            workflows={workflows}
            loading={workflowsLoading}
            errorMessage={workflowsError}
            projectId={Number(project?.id)}
            onRetry={handleOpenWorkflows}
            onWorkflowLoaded={async () => {
              await handleRefresh();
              setWorkflowsOpen(false);
            }}

          />

        </div>

        {/* --- Dialogs --- */}
        <Dialog
          open={dlgRename.open}
          onOpenChange={(open: boolean) => {
            if (!open) setDlgRename(emptyRenameDialog);
          }}
        >
          <DialogContent
            container={dialogContainer ?? undefined}
            className="pp-annotateDialog"
          >
            <div className="pp-annotateHeader">
              <DialogHeader>
                <DialogTitle className="pp-annotateHeaderTitle">
                  Annotate protocol
                </DialogTitle>

                <DialogDescription className="pp-annotateHeaderDescription">
                  Update the optional visible protocol name and comment.
                </DialogDescription>
              </DialogHeader>
            </div>

            <div className="pp-annotateBody">
              <div className="pp-annotateMetaBox">
                <div className="pp-annotateMetaRow">
                  <span className="pp-annotateIdBadge">
                    {dlgRename.id ?? "—"}
                  </span>

                  <span className="pp-annotateInternalLabel">
                    {dlgRename.id ? findNodeLabel(dlgRename.id) : "—"}
                  </span>
                </div>
              </div>

              <div className="pp-annotateFields">
                <div className="pp-annotateField">
                  <Label htmlFor="rename" className="pp-annotateLabel">
                    Run name
                  </Label>

                  <input
                    id="rename"
                    value={dlgRename.value}
                    onChange={(e) =>
                      setDlgRename((s) => ({
                        ...s,
                        value: e.target.value,
                      }))
                    }
                    placeholder="e.g. motioncorr_02"
                    autoFocus
                    aria-invalid={false}
                    className="pp-annotateInput"
                  />

                  <p className="pp-annotateHelper">
                    Leave it empty to use the original protocol label in the workflow card.
                  </p>
                </div>

                <div className="pp-annotateField">
                  <Label htmlFor="rename-comment" className="pp-annotateLabel">
                    Comment
                  </Label>

                  <textarea
                    id="rename-comment"
                    value={dlgRename.comment}
                    onChange={(e) =>
                      setDlgRename((s) => ({
                        ...s,
                        comment: e.target.value,
                      }))
                    }
                    placeholder="Add a short note about this protocol..."
                    rows={4}
                    className="pp-annotateTextarea"
                  />
                </div>
              </div>
            </div>

            <DialogFooter className="pp-annotateFooter">
              <Button
                onClick={() => setDlgRename(emptyRenameDialog)}
                className="pp-dialogBtn"
              >
                Cancel
              </Button>

              <Button
                onClick={submitRename}
                disabled={!dlgRename.id}
                className="pp-dialogBtn pp-dialogBtnPrimary"
              >
                Save annotation
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>


        <Dialog
          open={dlgResetFrom.open}
          onOpenChange={(open: boolean) => {
            if (!open) setDlgResetFrom({ open: false, id: null });
          }}
        >
          <DialogContent
            container={dialogContainer ?? undefined}
            className="sm:max-w-lg p-0 overflow-hidden border border-border bg-background shadow-xl rounded-xl"
          >
            <div
              className="border-b border-border"
              style={{
                backgroundColor: "#333d49",
                color: "white",
                padding: "16px 20px",
                boxSizing: "border-box",
              }}
            >
              <DialogHeader>
                <div className="flex items-start gap-3">
                  <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white/10 ring-1 ring-white/15">
                    <AlertTriangle className="h-5 w-5 text-amber-300" />
                  </div>

                  <div className="min-w-0">
                    <DialogTitle className="text-base font-semibold leading-6 text-white">
                      Reset workflow from this protocol?
                    </DialogTitle>

                    <DialogDescription className="mt-1 text-sm text-white/75">
                      This operation will invalidate downstream steps. You can re-run them afterwards.
                    </DialogDescription>
                  </div>
                </div>
              </DialogHeader>
            </div>

            <div className="px-5 py-5">
              <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-100">
                <div className="font-semibold">
                  Protocol affected
                </div>

                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <span className="rounded-full bg-white px-2 py-1 font-mono text-xs text-amber-900 shadow-sm ring-1 ring-amber-200 dark:bg-amber-900/40 dark:text-amber-100 dark:ring-amber-800">
                    {dlgResetFrom.id ?? "—"}
                  </span>

                  <span className="min-w-0 truncate">
                    {dlgResetFrom.id ? findNodeLabel(dlgResetFrom.id) : "Selected protocol"}
                  </span>
                </div>
              </div>

              <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600 dark:border-slate-700 dark:bg-slate-900/40 dark:text-slate-300">
                The selected protocol will be kept, but all dependent results may become outdated and need to be executed again.
              </div>
            </div>

            <DialogFooter className="border-t border-border bg-slate-50 px-5 py-4 dark:bg-slate-900/35">
              <button
                type="button"
                onClick={() => setDlgResetFrom({ open: false, id: null })}
                className="pp-dialogBtn"
              >
                Cancel
              </button>

              <button
                type="button"
                onClick={async () => {
                  if (!projectName || !dlgResetFrom.id) return;

                  try {
                    await svc.resetFrom(projectName, dlgResetFrom.id);
                    setDlgResetFrom({ open: false, id: null });
                    toast.success("Reset completed.");
                    await handleRefresh();
                  } catch (e) {
                    console.error(e);
                    toast.error(getErrorMsg(e));
                  }
                }}
                className="pp-dialogBtn pp-dialogBtnPrimary"
              >
                Reset from here
              </button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Dialog
          open={protocolHelp.open}
          onOpenChange={(open: boolean) => {
            if (!open) {
              setProtocolHelp((s) => ({ ...s, open: false, loading: false, error: null }));
            }
          }}
        >
          <DialogContent
            container={dialogContainer ?? undefined}
            className="sm:max-w-2xl p-0 overflow-hidden border border-border bg-background shadow-xl rounded-xl pp-helpDialog"
          >
            {/* Header */}
            <div
              className="border-b border-border"
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                backgroundColor: "#333d49",
                color: "white",
                padding: "12px 16px",
                boxSizing: "border-box",
              }}
            >
              <div className="min-w-0 pr-3 mb-4">
                <DialogTitle className="text-base font-semibold leading-6 text-white truncate">
                  {protocolHelp.title}
                </DialogTitle>

              </div>
            </div>

            {/* Body */}
            <div className="px-5 py-1">
              <div className="max-h-[60vh] overflow-auto pr-1">
                {protocolHelp.loading ? (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <div className="w-4 h-4 rounded-full border-2 border-gray-300 dark:border-gray-700 border-t-gray-700 dark:border-t-gray-200 animate-spin" />
                    <span>Loading…</span>
                  </div>
                ) : protocolHelp.error ? (
                  <div className="text-sm">{protocolHelp.error}</div>
                ) : (
                  renderHelpText(protocolHelp.text)
                )}
              </div>
            </div>

            {/* Footer */}
            <div className="px-5 py-4 border-t border-border bg-background">
              <div className="flex justify-center">
                <Button
                  variant="outline"
                  onClick={() => setProtocolHelp((s) => ({ ...s, open: false }))}
                  className="min-w-28"
                >
                  Close
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>

        {hasWidgetBuildInfo() && (
          <Dialog open={buildInfoOpen} onOpenChange={setBuildInfoOpen}>
            <DialogContent
              container={dialogContainer ?? undefined}
              className="sm:max-w-md p-0 overflow-hidden border border-border bg-background shadow-xl rounded-xl"
            >
              <DialogHeader className="border-b border-border px-5 py-4 text-left">
                <DialogTitle className="text-base font-semibold leading-6">
                  Build info
                </DialogTitle>
                <DialogDescription>Project page widget</DialogDescription>
              </DialogHeader>

              <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2.5 px-5 py-4 text-sm">
                {APP_VERSION && (
                  <>
                    <dt className="font-medium text-muted-foreground">Version</dt>
                    <dd>{APP_VERSION}</dd>
                  </>
                )}
                {WIDGET_BUILD_TIMESTAMP && (
                  <>
                    <dt className="font-medium text-muted-foreground">Built</dt>
                    <dd>{formatWidgetBuildTimestamp(WIDGET_BUILD_TIMESTAMP)}</dd>
                    <dt className="font-medium text-muted-foreground">Build time (UTC)</dt>
                    <dd className="break-all font-mono text-xs">{WIDGET_BUILD_TIMESTAMP}</dd>
                  </>
                )}
              </dl>

              <DialogFooter className="border-t border-border bg-background px-5 py-4 sm:justify-center">
                <Button variant="outline" onClick={() => setBuildInfoOpen(false)} className="min-w-28">
                  Close
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        )}

        <Dialog
          open={dlgDelete.open}
          onOpenChange={(open: boolean) => {
            if (!open) {
              setDeleteBusy(false);
              setDlgDelete({ open: false, ids: [] });
            }
          }}
        >
          <DialogContent
            container={dialogContainer ?? undefined}
            className="sm:max-w-lg p-0 overflow-hidden border border-border bg-background shadow-xl rounded-xl"
          >
            <div
              className="border-b border-border"
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                backgroundColor: "#333d49",
                color: "white",
                padding: "14px 56px 14px 16px",
                boxSizing: "border-box",
              }}
            >
              <DialogHeader className="min-w-0 flex-1">
                <div className="flex min-w-0 items-start gap-3">
                  <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg  bg-white/10 ring-1 ring-white/15">
                    <Trash2 className="h-5 w-5 text-red-300" />
                  </div>

                  <div className="min-w-0">
                    <DialogTitle className="text-base font-semibold leading-6 text-white">
                      Delete protocol{dlgDelete.ids.length > 1 ? "s" : ""}?
                    </DialogTitle>

                    <DialogDescription className="mt-1 max-w-[420px] text-sm leading-5 text-gray-200">
                      This action cannot be undone. The selected protocol
                      {dlgDelete.ids.length > 1 ? "s" : ""} will be removed from the workflow.
                    </DialogDescription>
                  </div>
                </div>
              </DialogHeader>
            </div>

            <div className="px-5 py-5">
              <div className="rounded-xl border border-border bg-muted/30 px-4 py-3 text-sm">
                <div className="flex items-center gap-2 font-semibold text-foreground">
                  <span className="h-2 w-2 rounded-full bg-red-500" />
                  {dlgDelete.ids.length > 1
                    ? `${dlgDelete.ids.length} protocols selected`
                    : "Protocol selected"}
                </div>

                <div className="mt-3 max-h-40 overflow-auto pr-1">
                  <div className="grid gap-2">
                    {dlgDelete.ids
                      .filter((id) => id && id !== "PROJECT")
                      .map((id) => (
                        <div
                          key={id}
                          className="flex min-w-0 items-center gap-2 rounded-lg bg-background px-3 py-2"
                        >
                          <span className="shrink-0 rounded-full bg-muted px-2 py-1 font-mono text-xs font-semibold text-muted-foreground ring-1 ring-border">
                            {id}
                          </span>

                          <span className="min-w-0 truncate text-foreground">
                            {findNodeLabel(id)}
                          </span>
                        </div>
                      ))}
                  </div>
                </div>
              </div>

              <div className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm leading-5 text-red-800 dark:border-red-900/40 dark:bg-red-950/20 dark:text-red-100">
                Outputs that are not used elsewhere may also be removed. Make sure this is the protocol
                {dlgDelete.ids.length > 1 ? " selection" : ""} you want to delete.
              </div>
            </div>

            <DialogFooter className="border-t border-border bg-background px-5 py-4">
              <button
                type="button"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setDlgDelete({ open: false, ids: [] });
                }}
                onContextMenu={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                }}
                className="pp-dialogBtn"
                disabled={deleteBusy}
              >
                Cancel
              </button>

              <button
                type="button"
                onClick={async (e) => {
                  e.preventDefault();
                  e.stopPropagation();

                  if (!projectName || deleteBusy) return;

                  const ids = Array.from(new Set((dlgDelete.ids ?? []).map(String))).filter(
                    (x) => x && x !== "PROJECT",
                  );

                  if (ids.length === 0) {
                    setDlgDelete({ open: false, ids: [] });
                    return;
                  }

                  if (viewModeRef.current === "hierarchical") {
                    const beforePositions = new Map<string, { x: number; y: number }>();

                    for (const node of nodesRef.current) {
                      const nodeId = String(node.id);
                      const position = node.position;

                      if (!nodeId || !position) continue;
                      if (!Number.isFinite(position.x) || !Number.isFinite(position.y)) continue;

                      beforePositions.set(nodeId, {
                        x: position.x,
                        y: position.y,
                      });
                    }

                    pendingDeletionRef.current = { beforePositions };
                  } else {
                    pendingDeletionRef.current = null;
                  }

                  setDeleteBusy(true);

                  try {
                    const res = await svc.deleteProtocol(projectName, ids);

                    if (!ensureApiOk(res, "Delete failed.")) {
                      pendingDeletionRef.current = null;
                      return;
                    }

                    clearAllSelectionHard();

                    toast.success(
                      ids.length > 1
                        ? "Protocols deleted successfully."
                        : "Protocol deleted successfully.",
                    );

                    setDlgDelete({ open: false, ids: [] });
                    await handleRefresh();
                    pendingDeletionRef.current = null;
                  } catch (err) {
                    pendingDeletionRef.current = null;
                    console.error(err);
                    toast.error(getErrorMsg(err));
                  } finally {
                    setDeleteBusy(false);
                  }
                }}
                onContextMenu={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                }}
                disabled={deleteBusy}
                className="pp-dialogBtn pp-dialogBtnPrimary"
                style={{
                  backgroundColor: "#dc2626",
                  borderColor: "#dc2626",
                  color: "white",
                }}
              >
                {deleteBusy
                  ? "Deleting..."
                  : dlgDelete.ids.length > 1
                    ? "Delete protocols"
                    : "Delete protocol"}
              </button>
            </DialogFooter>
          </DialogContent>
        </Dialog>


        <Dialog
          open={dlgRestartAll.open}
          onOpenChange={(open: boolean) => {
            if (!open) {
              setRestartAllBusy(false);
              setDlgRestartAll({ open: false, id: null });
            }
          }}
        >
          <DialogContent
            container={dialogContainer ?? undefined}
            className="sm:max-w-lg p-0 overflow-hidden border border-border bg-background shadow-xl rounded-xl"
          >
            <div
              className="border-b border-border"
              style={{
                backgroundColor: "#333d49",
                color: "white",
                padding: "16px 20px",
                boxSizing: "border-box",
              }}
            >
              <DialogHeader>
                <div className="flex items-start gap-3">
                  <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white/10 ring-1 ring-white/15">
                    <RefreshCw className="h-5 w-5 text-sky-200" />
                  </div>

                  <div className="min-w-0 mt-2">
                    <DialogTitle className="text-base font-semibold leading-6 text-white">
                      Restart workflow from this protocol?
                    </DialogTitle>

                    <DialogDescription className="mt-1 text-sm text-white/75">
                      This will restart this protocol and all dependent protocols from this point.
                    </DialogDescription>
                  </div>
                </div>
              </DialogHeader>
            </div>

            <div className="px-5 py-5">
              <div className="rounded-lg border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-900 dark:border-sky-900/50 dark:bg-sky-950/30 dark:text-sky-100">
                <div className="font-semibold">
                  Restart origin
                </div>

                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <span className="rounded-full bg-white px-2 py-1 font-mono text-xs text-sky-900 shadow-sm ring-1 ring-sky-200 dark:bg-sky-900/40 dark:text-sky-100 dark:ring-sky-800">
                    {dlgRestartAll.id ?? "—"}
                  </span>

                  <span className="min-w-0 truncate">
                    {dlgRestartAll.id ? findNodeLabel(dlgRestartAll.id) : "Selected protocol"}
                  </span>
                </div>
              </div>

              <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-100">
                Previous results for affected protocols will be deleted and recomputed. This may take some time depending on the workflow size.
              </div>
            </div>

            <DialogFooter className="border-t border-border bg-slate-50 px-5 py-4 dark:bg-slate-900/35">
              <button
                type="button"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setDlgRestartAll({ open: false, id: null });
                }}
                onContextMenu={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                }}
                className="pp-dialogBtn"
                disabled={restartAllBusy}
              >
                Cancel
              </button>

              <button
                type="button"
                onClick={async (e) => {
                  // preventDefaultAndStopPropagation
                  e.preventDefault();
                  e.stopPropagation();

                  if (!projectName || !dlgRestartAll.id || restartAllBusy) return;

                  setRestartAllBusy(true);

                  try {
                    const res = await svc.restartAll(projectName, dlgRestartAll.id);
                    if (!ensureApiOk(res, "Restart failed.")) return;

                    toast.success("Restart started.");
                    setDlgRestartAll({ open: false, id: null });

                    scheduleDoubleRefresh(8000, true);
                  } catch (err) {
                    console.error(err);
                    toast.error(getErrorMsg(err));
                  } finally {
                    setRestartAllBusy(false);
                  }
                }}
                onContextMenu={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                }}
                disabled={restartAllBusy}
                className="pp-dialogBtn pp-dialogBtnPrimary"
              >
                {restartAllBusy ? "Restarting..." : "Restart workflow"}
              </button>
            </DialogFooter>
          </DialogContent>
        </Dialog>


        <Dialog
          open={dlgContinueAll.open}
          onOpenChange={(open: boolean) => {
            if (!open) {
              setContinueAllBusy(false);
              setDlgContinueAll({ open: false, id: null });
            }
          }}
        >
          <DialogContent
            container={dialogContainer ?? undefined}
            className="sm:max-w-lg p-0 overflow-hidden border border-border bg-background shadow-xl rounded-xl"
          >
            <div
              className="border-b border-border"
              style={{
                backgroundColor: "#333d49",
                color: "white",
                padding: "16px 20px",
                boxSizing: "border-box",
              }}
            >
              <DialogHeader>
                <div className="flex items-start gap-3">
                  <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white/10 ring-1 ring-white/15">
                    <Play className="h-5 w-5 text-emerald-200" />
                  </div>

                  <div className="min-w-0 mt-2">
                    <DialogTitle className="text-base font-semibold leading-6 text-white">
                      Continue workflow from this protocol?
                    </DialogTitle>

                    <DialogDescription className="mt-1 text-sm text-white/75">
                      This will continue this protocol and all dependent protocols from the current state.
                    </DialogDescription>
                  </div>
                </div>
              </DialogHeader>
            </div>

            <div className="px-5 py-5">
              <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900 dark:border-emerald-900/50 dark:bg-emerald-950/30 dark:text-emerald-100">
                <div className="font-semibold">
                  Continue origin
                </div>

                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <span className="rounded-full bg-white px-2 py-1 font-mono text-xs text-emerald-900 shadow-sm ring-1 ring-emerald-200 dark:bg-emerald-900/40 dark:text-emerald-100 dark:ring-emerald-800">
                    {dlgContinueAll.id ?? "—"}
                  </span>

                  <span className="min-w-0 truncate">
                    {dlgContinueAll.id ? findNodeLabel(dlgContinueAll.id) : "Selected protocol"}
                  </span>
                </div>
              </div>

              <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600 dark:border-slate-700 dark:bg-slate-900/40 dark:text-slate-300">
                Existing results may be reused when possible, but affected protocols can still update their outputs.
              </div>
            </div>

            <DialogFooter className="border-t border-border bg-slate-50 px-5 py-4 dark:bg-slate-900/35">
              <button
                type="button"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setDlgContinueAll({ open: false, id: null });
                }}
                onContextMenu={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                }}
                className="pp-dialogBtn"
                disabled={continueAllBusy}
              >
                Cancel
              </button>

              <button
                type="button"
                onClick={async (e) => {
                  // preventDefaultAndStopPropagation
                  e.preventDefault();
                  e.stopPropagation();

                  if (!projectName || !dlgContinueAll.id || continueAllBusy) return;

                  setContinueAllBusy(true);

                  try {
                    const res = await svc.continueAll(projectName, dlgContinueAll.id);
                    if (!ensureApiOk(res, "Continue failed.")) return;

                    toast.success("Continue started.");
                    setDlgContinueAll({ open: false, id: null });

                    await handleRefresh();
                  } catch (err) {
                    console.error(err);
                    toast.error(getErrorMsg(err));
                  } finally {
                    setContinueAllBusy(false);
                  }
                }}
                onContextMenu={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                }}
                disabled={continueAllBusy}
                className="pp-dialogBtn pp-dialogBtnPrimary"
              >
                {continueAllBusy ? "Continuing..." : "Continue workflow"}
              </button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Dialog
          open={dlgStop.open}
          onOpenChange={(open: boolean) => {
            if (!open) {
              setStopBusy(false);
              setDlgStop({ open: false, ids: [] });
            }
          }}
        >
          <DialogContent
            container={dialogContainer ?? undefined}
            className="sm:max-w-lg p-0 overflow-hidden border border-border bg-background shadow-xl rounded-xl"
          >
            <div
              className="border-b border-border"
              style={{
                backgroundColor: "#333d49",
                color: "white",
                padding: "16px 20px",
                boxSizing: "border-box",
              }}
            >
              <DialogHeader>
                <div className="flex items-start gap-3">
                  <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white/10 ring-1 ring-white/15">
                    <Square className="h-5 w-5 text-orange-200" />
                  </div>

                  <div className="min-w-0">
                    <DialogTitle className="text-base font-semibold leading-6 text-white">
                      Stop selected protocol{dlgStop.ids.length > 1 ? "s" : ""}?
                    </DialogTitle>

                    <DialogDescription className="mt-1 text-sm text-white/75">
                      This will request a graceful stop for the selected running protocol{dlgStop.ids.length > 1 ? "s" : ""}.
                    </DialogDescription>
                  </div>
                </div>
              </DialogHeader>
            </div>

            <div className="px-5 py-5">
              <div className="rounded-lg border border-orange-200 bg-orange-50 px-4 py-3 text-sm text-orange-900 dark:border-orange-900/50 dark:bg-orange-950/30 dark:text-orange-100">
                <div className="font-semibold">
                  {dlgStop.ids.length > 1
                    ? `${dlgStop.ids.length} protocols selected`
                    : "Protocol selected"}
                </div>

                <div className="mt-3 max-h-40 overflow-auto pr-1">
                  <div className="grid gap-2">
                    {dlgStop.ids
                      .filter((id) => id && id !== "PROJECT")
                      .map((id) => (
                        <div
                          key={id}
                          className="flex min-w-0 items-center gap-2 rounded-md bg-white/70 px-3 py-2 ring-1 ring-orange-200 dark:bg-orange-900/25 dark:ring-orange-800"
                        >
                          <span className="shrink-0 rounded-full bg-white px-2 py-1 font-mono text-xs text-orange-900 shadow-sm ring-1 ring-orange-200 dark:bg-orange-900/50 dark:text-orange-100 dark:ring-orange-800">
                            {id}
                          </span>

                          <span className="min-w-0 truncate">
                            {findNodeLabel(id)}
                          </span>
                        </div>
                      ))}
                  </div>
                </div>
              </div>

              <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600 dark:border-slate-700 dark:bg-slate-900/40 dark:text-slate-300">
                The stop request is graceful when possible. Running work may be interrupted, and affected outputs may remain incomplete.
              </div>
            </div>

            <DialogFooter className="border-t border-border bg-slate-50 px-5 py-4 dark:bg-slate-900/35">
              <button
                type="button"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setDlgStop({ open: false, ids: [] });
                }}
                onContextMenu={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                }}
                className="pp-dialogBtn"
                disabled={stopBusy}
              >
                Cancel
              </button>

              <button
                type="button"
                onClick={async (e) => {
                  // preventDefaultAndStopPropagation
                  e.preventDefault();
                  e.stopPropagation();

                  if (!projectName || stopBusy) return;

                  const ids = Array.from(new Set((dlgStop.ids ?? []).map(String)))
                    .filter((x) => x && x !== "PROJECT");

                  if (ids.length === 0) {
                    setDlgStop({ open: false, ids: [] });
                    return;
                  }

                  setStopBusy(true);

                  try {
                    const res = await svc.stopProtocol(projectName, ids);
                    if (!ensureApiOk(res, "Stop failed.")) return;

                    toast.success(
                      ids.length > 1
                        ? `Stop requested for ${ids.length} protocols.`
                        : "Stop requested.",
                    );

                    clearAllSelectionHard();
                    setDlgStop({ open: false, ids: [] });
                    await handleRefresh();
                  } catch (err) {
                    console.error(err);
                    toast.error(getErrorMsg(err));
                  } finally {
                    setStopBusy(false);
                  }
                }}
                onContextMenu={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                }}
                disabled={stopBusy}
                className="pp-dialogBtn pp-dialogBtnPrimary"
                style={{
                  backgroundColor: "#f97316",
                  borderColor: "#f97316",
                  color: "white",
                }}
              >
                {stopBusy
                  ? "Stopping..."
                  : dlgStop.ids.length > 1
                    ? "Stop protocols"
                    : "Stop protocol"}
              </button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* tagsManagerDialog */}
        <TagsDialog
          open={tagManagerOpen}
          onClose={() => setTagManagerOpen(false)}
          title="Manage tags"
        >
          <div style={{ paddingTop: 8 }}>
            <TagManager
              projectId={Number(projId)}
              open={tagManagerOpen}
              onTagsChange={setAllTags}
            />
          </div>
        </TagsDialog>

        {/* ================= ProtocolSteps ================= */}
        <ProtocolStepsDeveloperDialog
          open={protocolStepsDialog.open}
          projectId={getProjectId()}
          protocolId={protocolStepsDialog.protocolId}
          protocolLabel={protocolStepsDialog.protocolLabel}
          container={dialogContainer}
          onOpenChange={(open) =>
            setProtocolStepsDialog((prev) => ({
              ...prev,
              open,
              protocolId: open ? prev.protocolId : null,
              protocolLabel: open ? prev.protocolLabel : "",
            }))
          }
        />

        {/* ================= RemoteFileDialog ================= */}
        {canOpenFileDialog && (
          <RemoteFileDialog
            open={fileDialogOpen}
            onClose={() => setFileDialogOpen(false)}
            title={`Browsing — ${plabel}`}
            projectId={projId}
            protocolId={pid}
            resolveBrowserPaths={() => svc.resolveBrowserPaths(projId, pid.toString())}
            listRemoteDirectory={(p) => svc.listRemoteDirectory(projId, pid.toString(), p)}
            previewRemoteEntry={(p) => svc.previewRemoteEntry(projectId, pid.toString(), p)}
            buildDownloadUrl={(p, inline) => svc.buildProtocolDownloadUrl(projId.toString(), pid.toString(), p, !!inline)}
            onPick={() => {
              setFileDialogOpen(false);
            }}
          />
        )}
      </div>
      {/* portalRootInsideWidgetSoDialogsInheritWidgetStyles */}
      <div ref={portalRootRef} id={PORTAL_ROOT_ID} className="pp-portalRoot" />
    </div>
  );
}
