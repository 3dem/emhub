// File: src/utils/graph_layout/common.ts
// Node size estimates and graph helpers shared by the graph layouts.
import { ProtocolNode } from "@/types/protocolNode";

/**
 * Estimate the width of a label deterministically (no canvas).
 * This avoids host-dependent font metrics differences (e.g., Flask embedding).
 */
export function estimateLabelWidth(label: string, fontSize = 20): number {
  const text = String(label ?? "");

  // avgCharWidthFactor tuned to be close to typical UI fonts at 20px
  const avgCharWidth = fontSize * 0.58;

  // fixedPaddingForNodeCard must reflect the non-text parts of the node/card
  const fixedPaddingForNodeCard = 480;

  // clampBounds keep spacing stable even for very short/long labels
  const minNodeWidth = 620;
  const maxNodeWidth = 980;

  const estimated = Math.ceil(text.length * avgCharWidth + fixedPaddingForNodeCard);
  return Math.max(minNodeWidth, Math.min(maxNodeWidth, estimated));
}

/**
 * Estimate node height deterministically (no canvas).
 */
export function estimateNodeHeight(label: string, fontSize = 20, fontFamily = "Arial"): number {
  const avgCharWidth = fontSize * 0.6;
  const maxWidth = 240;
  const text = String(label ?? "");
  const charsPerLine = Math.max(1, Math.floor(maxWidth / avgCharWidth));
  const lines = Math.ceil(text.length / charsPerLine) || 1;

  const baseLineHeight = Math.round(fontSize * 1.2);
  const familyFactor = /arial/i.test(fontFamily) ? 1 : 1.05;

  return Math.ceil(lines * baseLineHeight * familyFactor) + 180;
}

export type Direction = "TB" | "LR";
export type GraphPosition = { x: number; y: number };

export type NodeSizeMap = Record<string, { width: number; height: number }>;

export function stableIdCompare(a: string, b: string): number {
  if (a === "PROJECT" && b !== "PROJECT") return -1;
  if (b === "PROJECT" && a !== "PROJECT") return 1;

  const na = parseInt(a, 10);
  const nb = parseInt(b, 10);
  const aNum = Number.isFinite(na);
  const bNum = Number.isFinite(nb);

  if (aNum && bNum) return na - nb;
  if (aNum && !bNum) return -1;
  if (!aNum && bNum) return 1;

  return String(a).localeCompare(String(b));
}

export function getNodeWidth(
  nodeId: string,
  label: string,
  nodeSizeMap?: NodeSizeMap | null
): number {
  const w = nodeSizeMap?.[nodeId]?.width;
  return typeof w === "number" && w > 0 ? Math.ceil(w) : estimateLabelWidth(label);
}

export function getNodeHeight(
  nodeId: string,
  label: string,
  nodeSizeMap?: NodeSizeMap | null
): number {
  const h = nodeSizeMap?.[nodeId]?.height;
  return typeof h === "number" && h > 0 ? Math.ceil(h) : estimateNodeHeight(label);
}

export function uniqStable(arr: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const x of arr) {
    const s = String(x);
    if (seen.has(s)) continue;
    seen.add(s);
    out.push(s);
  }
  return out;
}

export function getGraphNodeLabel(
  id: string,
  protocols: Record<string, ProtocolNode>,
  projectName: string
): string {
  return id === "PROJECT" ? projectName : protocols[id]?.label || id;
}

export function getProtocolOutputsCount(
  id: string,
  protocols: Record<string, ProtocolNode>
): number {
  if (id === "PROJECT") return 0;

  const rawOutputs = (protocols[id] as any)?.outputs;

  if (Array.isArray(rawOutputs)) {
    return rawOutputs.length;
  }

  if (rawOutputs && typeof rawOutputs === "object") {
    return Object.keys(rawOutputs).length;
  }

  return 0;
}

export function getEstimatedGraphNodeHeight(params: {
  id: string;
  protocols: Record<string, ProtocolNode>;
  projectName: string;
  nodeSizeMap?: NodeSizeMap | null;
}): number {
  const { id, protocols, projectName, nodeSizeMap } = params;

  const measuredHeight = nodeSizeMap?.[id]?.height;
  if (typeof measuredHeight === "number" && measuredHeight > 0) {
    return Math.ceil(measuredHeight);
  }

  const label = getGraphNodeLabel(id, protocols, projectName);
  const baseHeight = estimateNodeHeight(label);
  const outputsCount = getProtocolOutputsCount(id, protocols);

  const extraOutputsHeight = Math.max(0, outputsCount) * 32;

  return baseHeight + extraOutputsHeight;
}

export function getNodeCrossSize(params: {
  id: string;
  direction: Direction;
  protocols: Record<string, ProtocolNode>;
  projectName: string;
  nodeSizeMap?: NodeSizeMap | null;
}): number {
  const { id, direction, protocols, projectName, nodeSizeMap } = params;
  const label = getGraphNodeLabel(id, protocols, projectName);

  return direction === "TB"
    ? getNodeWidth(id, label, nodeSizeMap)
    : getEstimatedGraphNodeHeight({
      id,
      protocols,
      projectName,
      nodeSizeMap,
    });
}

export function getNodePackingCrossSize(params: {
  id: string;
  direction: Direction;
  protocols: Record<string, ProtocolNode>;
  projectName: string;
  nodeSizeMap?: NodeSizeMap | null;
}): number {
  const { id, direction, protocols, projectName, nodeSizeMap } = params;
  const label = getGraphNodeLabel(id, protocols, projectName);
  const measuredSize =
    direction === "TB" ? nodeSizeMap?.[id]?.width : nodeSizeMap?.[id]?.height;

  if (typeof measuredSize === "number" && measuredSize > 0) {
    return Math.ceil(measuredSize);
  }

  const estimatedSize =
    direction === "TB"
      ? estimateLabelWidth(label)
      : getEstimatedGraphNodeHeight({
        id,
        protocols,
        projectName,
        nodeSizeMap,
      });

  return direction === "TB"
    ? 950
    : Math.max(520, Math.min(680, estimatedSize));
}

export function getChildRankUnderParent(
  protocols: Record<string, ProtocolNode>,
  parentId: string,
  childId: string
): number {
  const children = protocols[parentId]?.children;
  if (!Array.isArray(children)) return Number.POSITIVE_INFINITY;

  const idx = children.map(String).indexOf(String(childId));
  return idx === -1 ? Number.POSITIVE_INFINITY : idx;
}

export function compareChildrenByParentOrder(
  protocols: Record<string, ProtocolNode>,
  parentId: string,
  a: string,
  b: string
): number {
  const rankA = getChildRankUnderParent(protocols, parentId, a);
  const rankB = getChildRankUnderParent(protocols, parentId, b);

  if (rankA !== rankB) return rankA - rankB;
  return stableIdCompare(a, b);
}

export function selectPrimaryLayoutParent(params: {
  id: string;
  parentMap: Record<string, string[]>;
  levelMap: Record<string, number>;
  protocols: Record<string, ProtocolNode>;
}): string | null {
  const { id, parentMap, levelMap, protocols } = params;
  const childLevel = levelMap[id];
  if (typeof childLevel !== "number") return null;

  const parents = uniqStable(parentMap[id] ?? []).filter((parentId) => {
    const parentLevel = levelMap[parentId];
    return typeof parentLevel === "number" && parentLevel < childLevel;
  });

  if (parents.length === 0) return null;

  parents.sort((a, b) => {
    const levelA = levelMap[a] ?? -1;
    const levelB = levelMap[b] ?? -1;

    const immediateA = levelA === childLevel - 1 ? 0 : 1;
    const immediateB = levelB === childLevel - 1 ? 0 : 1;
    if (immediateA !== immediateB) return immediateA - immediateB;

    if (levelA !== levelB) return levelB - levelA;

    const rankA = getChildRankUnderParent(protocols, a, id);
    const rankB = getChildRankUnderParent(protocols, b, id);
    if (rankA !== rankB) return rankA - rankB;

    return stableIdCompare(a, b);
  });

  return parents[0] ?? null;
}


export function getResolvedPlacementCrossSize(params: {
  id: string;
  direction: Direction;
  protocols: Record<string, ProtocolNode>;
  projectName: string;
  nodeSizeMap?: NodeSizeMap | null;
}): number {
  const size = getNodeCrossSize(params);

  return params.direction === "TB"
    ? Math.max(950, size)
    : Math.max(520, size);
}

/** Input of a graph layout: node levels (depth) and parents of the workflow DAG. */
export type GraphLayoutParams = {
  levelMap: Record<string, number>;
  parentMap: Record<string, string[]>;
  protocols: Record<string, ProtocolNode>;
  projectName: string;
  direction: Direction;
  spacingX: number;
  spacingY: number;
  nodeSizeMap?: NodeSizeMap | null;
  preferredChildOrder?: Record<string, string[]> | null;
};

/** A graph layout returns the position of each node (centered on the cross axis). */
export type GraphLayout = (params: GraphLayoutParams) => Record<string, GraphPosition>;
