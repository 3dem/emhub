// File: src/utils/graph_utils.ts
import { ProtocolNode } from "@/types/protocolNode";
import { Node, Edge, Position } from "reactflow";

/**
 * Estimate the width of a label deterministically (no canvas).
 * This avoids host-dependent font metrics differences (e.g., Flask embedding).
 */
function estimateLabelWidth(label: string, fontSize = 20): number {
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
function estimateNodeHeight(label: string, fontSize = 20, fontFamily = "Arial"): number {
  const avgCharWidth = fontSize * 0.6;
  const maxWidth = 240;
  const text = String(label ?? "");
  const charsPerLine = Math.max(1, Math.floor(maxWidth / avgCharWidth));
  const lines = Math.ceil(text.length / charsPerLine) || 1;

  const baseLineHeight = Math.round(fontSize * 1.2);
  const familyFactor = /arial/i.test(fontFamily) ? 1 : 1.05;

  return Math.ceil(lines * baseLineHeight * familyFactor) + 180;
}

type Direction = "TB" | "LR";
type GraphPosition = { x: number; y: number };

export type NodeSizeMap = Record<string, { width: number; height: number }>;

function stableIdCompare(a: string, b: string): number {
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

function getNodeWidth(
  nodeId: string,
  label: string,
  nodeSizeMap?: NodeSizeMap | null
): number {
  const w = nodeSizeMap?.[nodeId]?.width;
  return typeof w === "number" && w > 0 ? Math.ceil(w) : estimateLabelWidth(label);
}

function getNodeHeight(
  nodeId: string,
  label: string,
  nodeSizeMap?: NodeSizeMap | null
): number {
  const h = nodeSizeMap?.[nodeId]?.height;
  return typeof h === "number" && h > 0 ? Math.ceil(h) : estimateNodeHeight(label);
}

function uniqStable(arr: string[]): string[] {
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

export function getGraphTopologySignature(protocols: Record<string, ProtocolNode>): string {
  return Object.keys(protocols)
    .sort(stableIdCompare)
    .map((id) => {
      const children = uniqStable(
        Array.isArray(protocols[id]?.children)
          ? protocols[id].children.map(String)
          : []
      );

      return `${id}>${children.join(",")}`;
    })
    .join("|");
}

function getTraversalOrderForGrid(protocols: Record<string, ProtocolNode>): string[] {
  // getTraversalOrderForGrid
  const visited = new Set<string>();
  const order: string[] = [];

  const visit = (id: string) => {
    // visit
    if (!id || id === "PROJECT") return;
    if (visited.has(id)) return;
    visited.add(id);
    order.push(id);

    const prot = protocols[id];
    const children = uniqStable(Array.isArray(prot?.children) ? prot.children.map(String) : []);
    for (const childId of children) visit(childId);
  };

  const root = protocols.PROJECT;
  const rootChildren = uniqStable(Array.isArray(root?.children) ? root.children.map(String) : []);
  for (const childId of rootChildren) visit(childId);

  // append disconnected nodes (stable)
  const remaining = Object.keys(protocols)
    .filter((id) => id !== "PROJECT" && !visited.has(id))
    .sort(stableIdCompare);

  return [...order, ...remaining];
}

function getGraphNodeLabel(
  id: string,
  protocols: Record<string, ProtocolNode>,
  projectName: string
): string {
  return id === "PROJECT" ? projectName : protocols[id]?.label || id;
}

function getProtocolOutputsCount(
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

function getEstimatedGraphNodeHeight(params: {
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

function getNodeCrossSize(params: {
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

function getNodePackingCrossSize(params: {
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

function getChildRankUnderParent(
  protocols: Record<string, ProtocolNode>,
  parentId: string,
  childId: string
): number {
  const children = protocols[parentId]?.children;
  if (!Array.isArray(children)) return Number.POSITIVE_INFINITY;

  const idx = children.map(String).indexOf(String(childId));
  return idx === -1 ? Number.POSITIVE_INFINITY : idx;
}

function compareChildrenByParentOrder(
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

function selectPrimaryLayoutParent(params: {
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


function getResolvedPlacementCrossSize(params: {
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

function buildSubtreeAlignedPlacements(params: {
  levelMap: Record<string, number>;
  parentMap: Record<string, string[]>;
  protocols: Record<string, ProtocolNode>;
  projectName: string;
  direction: Direction;
  spacingX: number;
  spacingY: number;
  nodeSizeMap?: NodeSizeMap | null;
  preferredChildOrder?: Record<string, string[]> | null;
}): Record<string, GraphPosition> {
  const {
    levelMap,
    parentMap,
    protocols,
    projectName,
    direction,
    spacingX,
    spacingY,
    nodeSizeMap,
    preferredChildOrder,
  } = params;

  const nodeIds = Object.keys(levelMap).sort((a, b) => {
    const levelDelta = (levelMap[a] ?? 0) - (levelMap[b] ?? 0);
    return levelDelta !== 0 ? levelDelta : stableIdCompare(a, b);
  });

  const nodeSet = new Set(nodeIds);
  const layoutChildren: Record<string, string[]> = {};
  const assigned = new Set<string>();

  for (const id of nodeIds) {
    if (id === "PROJECT") continue;

    const parentId = selectPrimaryLayoutParent({ id, parentMap, levelMap, protocols });
    if (!parentId || !nodeSet.has(parentId)) continue;

    if (!layoutChildren[parentId]) layoutChildren[parentId] = [];
    if (!layoutChildren[parentId].includes(id)) layoutChildren[parentId].push(id);
    assigned.add(id);
  }

  for (const parentId of Object.keys(layoutChildren)) {
    const preferredOrder = preferredChildOrder?.[parentId] ?? [];
    const preferredRank = new Map(preferredOrder.map((id, index) => [String(id), index]));

    layoutChildren[parentId] = uniqStable(layoutChildren[parentId]).sort((a, b) => {
      if (preferredOrder.length > 0) {
        const rankA = preferredRank.get(a);
        const rankB = preferredRank.get(b);

        if (rankA !== undefined && rankB !== undefined) return rankA - rankB;
        if (rankA !== undefined) return -1;
        if (rankB !== undefined) return 1;

        return stableIdCompare(a, b);
      }

      return compareChildrenByParentOrder(protocols, parentId, a, b);
    });
  }

  const roots = nodeIds.filter((id) => id === "PROJECT" || !assigned.has(id));
  roots.sort((a, b) => {
    if (a === "PROJECT" && b !== "PROJECT") return -1;
    if (b === "PROJECT" && a !== "PROJECT") return 1;

    const levelDelta = (levelMap[a] ?? 0) - (levelMap[b] ?? 0);
    return levelDelta !== 0 ? levelDelta : stableIdCompare(a, b);
  });

  const siblingGap = direction === "TB" ? 260 : 220;
  const rootBranchGap = direction === "TB" ? 320 : 120;
  const disconnectedRootGap = direction === "TB" ? 360 : 150;

  const getChildrenGap = (parentId: string): number => {
    return parentId === "PROJECT" ? rootBranchGap : siblingGap;
  };

  const getRootGap = (leftRootId: string, rightRootId: string): number => {
    return leftRootId === "PROJECT" || rightRootId === "PROJECT"
      ? rootBranchGap
      : disconnectedRootGap;
  };

  const getPairGapTotal = (
    ids: string[],
    getGap: (leftId: string, rightId: string) => number
  ): number => {
    let total = 0;
    for (let i = 1; i < ids.length; i++) {
      total += getGap(ids[i - 1], ids[i]);
    }
    return total;
  };

  const spanMemo = new Map<string, number>();

  const computeSpan = (id: string, stack = new Set<string>()): number => {
    const cached = spanMemo.get(id);
    if (typeof cached === "number") return cached;

    const nodeCrossSize = getNodePackingCrossSize({
      id,
      direction,
      protocols,
      projectName,
      nodeSizeMap,
    });

    if (stack.has(id)) {
      spanMemo.set(id, nodeCrossSize);
      return nodeCrossSize;
    }

    stack.add(id);

    const children = layoutChildren[id] ?? [];
    const childrenGap = getChildrenGap(id);
    const childrenTotal =
      children.length > 0
        ? children.reduce((sum, childId) => sum + computeSpan(childId, stack), 0) +
        Math.max(0, children.length - 1) * childrenGap
        : 0;

    stack.delete(id);

    const span = Math.ceil(Math.max(nodeCrossSize, childrenTotal));
    spanMemo.set(id, span);
    return span;
  };

  const placements: Record<string, GraphPosition> = {};

  const placeNode = (id: string, start: number) => {
    const span = computeSpan(id);
    const center = start + span / 2;
    const level = levelMap[id] ?? 0;

    placements[id] =
      direction === "TB"
        ? { x: center, y: level * spacingY }
        : { x: level * spacingX, y: center };

    const children = layoutChildren[id] ?? [];
    if (children.length === 0) return;

    const childrenGap = getChildrenGap(id);
    const childrenTotal =
      children.reduce((sum, childId) => sum + computeSpan(childId), 0) +
      Math.max(0, children.length - 1) * childrenGap;

    let cursor = start + (span - childrenTotal) / 2;

    for (const childId of children) {
      const childSpan = computeSpan(childId);
      placeNode(childId, cursor);
      cursor += childSpan + childrenGap;
    }
  };

  const rootTotal =
    roots.reduce((sum, rootId) => sum + computeSpan(rootId), 0) +
    getPairGapTotal(roots, getRootGap);

  let cursor = -rootTotal / 2;
  for (let i = 0; i < roots.length; i++) {
    const rootId = roots[i];
    const rootSpan = computeSpan(rootId);
    placeNode(rootId, cursor);
    cursor += rootSpan;

    if (i < roots.length - 1) {
      cursor += getRootGap(rootId, roots[i + 1]);
    }
  }

  const getPlacementAxis = (id: string): number => {
    const position = placements[id];
    return direction === "TB" ? position.x : position.y;
  };

  const setPlacementAxis = (id: string, axis: number): void => {
    placements[id] = direction === "TB"
      ? { ...placements[id], x: axis }
      : { ...placements[id], y: axis };
  };

  const getResolvedCrossSize = (id: string): number => {
    return getResolvedPlacementCrossSize({ id, direction, protocols, projectName, nodeSizeMap });
  };

  const getNearestRealChildren = (id: string): string[] => {
    const parentLevel = levelMap[id];

    if (typeof parentLevel !== "number") {
      return [];
    }

    const children = uniqStable(
      Array.isArray(protocols[id]?.children)
        ? protocols[id].children.map(String)
        : []
    ).filter((childId) => {
      const childLevel = levelMap[childId];

      return Boolean(placements[childId]) &&
        typeof childLevel === "number" &&
        childLevel > parentLevel;
    });

    if (children.length === 0) {
      return [];
    }

    const nearestLevel = Math.min(...children.map((childId) => levelMap[childId] as number));

    return children.filter((childId) => levelMap[childId] === nearestLevel);
  };

  const getChildrenCenterAxis = (children: string[]): number | null => {
    let minAxis = Number.POSITIVE_INFINITY;
    let maxAxis = Number.NEGATIVE_INFINITY;

    for (const childId of children) {
      const childAxis = getPlacementAxis(childId);
      const childSize = getResolvedCrossSize(childId);

      minAxis = Math.min(minAxis, childAxis - childSize / 2);
      maxAxis = Math.max(maxAxis, childAxis + childSize / 2);
    }

    if (!Number.isFinite(minAxis) || !Number.isFinite(maxAxis)) {
      return null;
    }

    return (minAxis + maxAxis) / 2;
  };

  const levelIds: Record<number, string[]> = {};

  for (const id of nodeIds) {
    const level = levelMap[id] ?? 0;

    if (!levelIds[level]) {
      levelIds[level] = [];
    }

    levelIds[level].push(id);
  }

  const parentAlignmentGap = direction === "TB" ? 360 : 240;

  const levelsDescending = Object.keys(levelIds).map(Number).filter(Number.isFinite).sort((a, b) => b - a);

  for (const level of levelsDescending) {
    const idsInLevel = (levelIds[level] ?? []).filter(
      (id) => id !== "PROJECT" && Boolean(placements[id])
    );

    if (direction === "TB") {
      const movableItems = idsInLevel
        .filter((id) => (layoutChildren[id] ?? []).length === 0)
        .map((id) => {
          const realChildren = getNearestRealChildren(id);
          const childrenAxis = getChildrenCenterAxis(realChildren);
          const currentAxis = getPlacementAxis(id);

          return {
            id,
            size: getResolvedCrossSize(id),
            currentAxis,
            desiredAxis: childrenAxis ?? currentAxis,
            alignsToChildren: childrenAxis !== null,
          };
        })
        .filter(
          (item) =>
            item.alignsToChildren &&
            Math.abs(item.desiredAxis - item.currentAxis) > 0.5
        );

      if (movableItems.length === 0) {
        continue;
      }

      const movableIds = new Set(
        movableItems.map((item) => item.id)
      );

      const occupied = idsInLevel
        .filter((id) => !movableIds.has(id))
        .map((id) => ({
          id,
          axis: getPlacementAxis(id),
          size: getResolvedCrossSize(id),
        }));

      movableItems.sort((a, b) => {
        if (a.desiredAxis !== b.desiredAxis) {
          return a.desiredAxis - b.desiredAxis;
        }

        return stableIdCompare(a.id, b.id);
      });

      for (const item of movableItems) {
        const candidateAxes = [
          item.desiredAxis,
        ];

        for (const obstacle of occupied) {
          const separation =
            obstacle.size / 2 +
            siblingGap +
            item.size / 2;

          candidateAxes.push(
            obstacle.axis - separation,
            obstacle.axis + separation
          );
        }

        candidateAxes.sort((a, b) => {
          const desiredDistanceA =
            Math.abs(a - item.desiredAxis);

          const desiredDistanceB =
            Math.abs(b - item.desiredAxis);

          if (desiredDistanceA !== desiredDistanceB) {
            return desiredDistanceA - desiredDistanceB;
          }

          const currentDistanceA =
            Math.abs(a - item.currentAxis);

          const currentDistanceB =
            Math.abs(b - item.currentAxis);

          if (currentDistanceA !== currentDistanceB) {
            return currentDistanceA - currentDistanceB;
          }

          return a - b;
        });

        const resolvedAxis =
          candidateAxes.find((candidateAxis) => {
            return !occupied.some((obstacle) => {
              const minimumDistance =
                obstacle.size / 2 +
                siblingGap +
                item.size / 2;

              return (
                Math.abs(
                  candidateAxis -
                  obstacle.axis
                ) <
                minimumDistance
              );
            });
          }) ?? item.currentAxis;

        setPlacementAxis(
          item.id,
          resolvedAxis
        );

        occupied.push({
          id: item.id,
          axis: resolvedAxis,
          size: item.size,
        });
      }

      continue;
    }

    const items = idsInLevel.map((id) => {
      const realChildren = getNearestRealChildren(id);
      const childrenAxis = getChildrenCenterAxis(realChildren);
      const currentAxis = getPlacementAxis(id);

      return {
        id,
        size: getResolvedCrossSize(id),
        currentAxis,
        desiredAxis: childrenAxis ?? currentAxis,
        alignsToChildren: childrenAxis !== null,
      };
    });

    const needsAlignment = items.some(
      (item) =>
        item.alignsToChildren &&
        Math.abs(item.desiredAxis - item.currentAxis) > 0.5
    );

    if (!needsAlignment) {
      continue;
    }

    items.sort((a, b) => {
      if (a.desiredAxis !== b.desiredAxis) {
        return a.desiredAxis - b.desiredAxis;
      }

      return stableIdCompare(a.id, b.id);
    });

    const resolvedAxes = new Map<string, number>();
    let previousRight = Number.NEGATIVE_INFINITY;

    for (const item of items) {
      const minCenter =
        previousRight +
        parentAlignmentGap +
        item.size / 2;

      const resolvedAxis = Math.max(
        item.desiredAxis,
        minCenter
      );

      resolvedAxes.set(
        item.id,
        resolvedAxis
      );

      previousRight =
        resolvedAxis +
        item.size / 2;
    }

    const desiredLeft = Math.min(
      ...items.map(
        (item) =>
          item.desiredAxis -
          item.size / 2
      )
    );

    const desiredRight = Math.max(
      ...items.map(
        (item) =>
          item.desiredAxis +
          item.size / 2
      )
    );

    const resolvedLeft = Math.min(
      ...items.map(
        (item) =>
          (resolvedAxes.get(item.id) ?? item.desiredAxis) -
          item.size / 2
      )
    );

    const resolvedRight = Math.max(
      ...items.map(
        (item) =>
          (resolvedAxes.get(item.id) ?? item.desiredAxis) +
          item.size / 2
      )
    );

    const desiredGroupCenter =
      (desiredLeft + desiredRight) / 2;

    const resolvedGroupCenter =
      (resolvedLeft + resolvedRight) / 2;

    const recenterOffset =
      desiredGroupCenter -
      resolvedGroupCenter;

    for (const item of items) {
      const resolvedAxis =
        resolvedAxes.get(item.id) ??
        item.desiredAxis;

      setPlacementAxis(
        item.id,
        resolvedAxis + recenterOffset
      );
    }
  }

  if (direction === "TB") {
    const wouldOverlapAtAxis = (id: string, axis: number): boolean => {
      const level = levelMap[id] ?? 0;
      const size = getResolvedCrossSize(id);

      return (levelIds[level] ?? []).some((otherId) => {
        if (otherId === id || !placements[otherId]) return false;

        const otherAxis = getPlacementAxis(otherId);
        const otherSize = getResolvedCrossSize(otherId);
        const minimumDistance = size / 2 + siblingGap + otherSize / 2;

        return Math.abs(axis - otherAxis) < minimumDistance;
      });
    };

    const parentIds = Object.keys(layoutChildren)
      .filter((id) => id !== "PROJECT" && Boolean(placements[id]))
      .sort((a, b) => {
        const levelDelta = (levelMap[a] ?? 0) - (levelMap[b] ?? 0);
        if (levelDelta !== 0) return levelDelta;

        const axisDelta = getPlacementAxis(a) - getPlacementAxis(b);
        if (axisDelta !== 0) return axisDelta;

        return stableIdCompare(a, b);
      });

    for (const parentId of parentIds) {
      const childIds = (layoutChildren[parentId] ?? []).filter((childId) => Boolean(placements[childId]));
      if (childIds.length === 0) continue;

      let desiredAxis: number;

      if (childIds.length === 1) {
        desiredAxis = getPlacementAxis(childIds[0]);
      } else {
        const middleIndex = Math.floor(childIds.length / 2);

        if (childIds.length % 2 === 1) {
          desiredAxis = getPlacementAxis(childIds[middleIndex]);
        } else {
          const leftMiddleAxis = getPlacementAxis(childIds[middleIndex - 1]);
          const rightMiddleAxis = getPlacementAxis(childIds[middleIndex]);
          desiredAxis = (leftMiddleAxis + rightMiddleAxis) / 2;
        }
      }

      if (!wouldOverlapAtAxis(parentId, desiredAxis)) {
        setPlacementAxis(parentId, desiredAxis);
      }
    }
  }


  if (direction === "TB") {
    const protocolIds = nodeIds.filter((id) => id !== "PROJECT" && Boolean(placements[id]));
    const adjacency = new Map<string, Set<string>>();

    for (const id of protocolIds) {
      adjacency.set(id, new Set());
    }

    for (const childId of protocolIds) {
      for (const parentId of parentMap[childId] ?? []) {
        if (parentId === "PROJECT" || !placements[parentId]) continue;

        adjacency.get(childId)?.add(parentId);
        adjacency.get(parentId)?.add(childId);
      }
    }

    const components: string[][] = [];
    const visited = new Set<string>();

    const orderedProtocolIds = [...protocolIds].sort((a, b) => {
      const axisDelta = getPlacementAxis(a) - getPlacementAxis(b);
      return axisDelta !== 0 ? axisDelta : stableIdCompare(a, b);
    });

    for (const startId of orderedProtocolIds) {
      if (visited.has(startId)) continue;

      const component: string[] = [];
      const pending = [startId];

      while (pending.length > 0) {
        const currentId = pending.pop();

        if (!currentId || visited.has(currentId)) continue;

        visited.add(currentId);
        component.push(currentId);

        for (const neighborId of adjacency.get(currentId) ?? []) {
          if (!visited.has(neighborId)) {
            pending.push(neighborId);
          }
        }
      }

      if (component.length > 0) {
        components.push(component);
      }
    }

    const componentBlocks = components
      .map((ids) => {
        let left = Number.POSITIVE_INFINITY;
        let right = Number.NEGATIVE_INFINITY;

        for (const id of ids) {
          const axis = getPlacementAxis(id);
          const size = getResolvedCrossSize(id);

          left = Math.min(left, axis - size / 2);
          right = Math.max(right, axis + size / 2);
        }

        return { ids, left, right };
      })
      .filter((block) => Number.isFinite(block.left) && Number.isFinite(block.right))
      .sort((a, b) => a.left - b.left);

    let previousRight = Number.NEGATIVE_INFINITY;

    for (const block of componentBlocks) {
      const offset = Number.isFinite(previousRight)
        ? Math.max(0, previousRight + disconnectedRootGap - block.left)
        : 0;

      if (offset > 0.5) {
        for (const id of block.ids) {
          setPlacementAxis(id, getPlacementAxis(id) + offset);
        }
      }

      previousRight = block.right + offset;
    }
  }

  if (placements.PROJECT) {
    let minGraphAxis =
      Number.POSITIVE_INFINITY;

    let maxGraphAxis =
      Number.NEGATIVE_INFINITY;

    for (const id of nodeIds) {
      if (
        id === "PROJECT" ||
        !placements[id]
      ) {
        continue;
      }

      const nodeAxis =
        getPlacementAxis(id);

      const nodeSize =
        getResolvedCrossSize(id);

      minGraphAxis = Math.min(
        minGraphAxis,
        nodeAxis - nodeSize / 2
      );

      maxGraphAxis = Math.max(
        maxGraphAxis,
        nodeAxis + nodeSize / 2
      );
    }

    if (
      Number.isFinite(minGraphAxis) &&
      Number.isFinite(maxGraphAxis)
    ) {
      setPlacementAxis(
        "PROJECT",
        (minGraphAxis + maxGraphAxis) / 2
      );
    }
  }

  return placements;

}

/**
 * Build nodes and edges for ReactFlow from protocols.
 *
 * Improvements:
 * - Hierarchical mode uses a subtree-aligned layout so children stay grouped around
 *   their primary visual parent while preserving all real workflow edges.
 * - TB connected workflow components occupy separate horizontal bands.
 * - Multi-root DAGs stay inside the same component instead of being split into artificial subgraphs.
 * - TB parent centering is collision-safe and never reintroduces node overlaps.
 * - Primary subtrees preserve their compact span-based placement.
 * - TB keeps primary parent-child chains on a stable vertical trunk.
 * - Secondary-only TB parents may align toward their nearest real children.
 * - LR keeps parents centered over the nearest visible layer of their real children.
 * - Parent-level collisions are resolved without moving descendant subtrees.
 * - Grid mode can follow traversal order (parents before children) to reduce visual confusion.
 * - Layout uses deterministic size estimates and optional measured node dimensions.
 */
export function buildGraphElements(
  projectName: string,
  protocols: Record<string, ProtocolNode>,
  viewMode: "hierarchical" | "grid" | "table" = "hierarchical",
  direction: Direction = "TB",
  containerWidth?: number | null,
  viewportZoom?: number | null,
  nodeSizeMap?: NodeSizeMap | null,
  layoutOptions?: {
    preferredChildOrder?: Record<string, string[]> | null;
  }
) {
  const spacingX = direction === "TB" ? 480 : 1250;
  const spacingY = direction === "TB" ? 680 : 480;

  const nodes: Node[] = [];
  const edges: Edge[] = [];

  // TABLE view -> only table
  if (viewMode === "table") {
    const sorted = Object.entries(protocols)
      .filter(([id]) => id !== "PROJECT")
      .sort(([idA], [idB]) => stableIdCompare(idA, idB));

    const tableData = sorted.map(([id, prot]) => ({
      id,
      label: prot.label,
      title: prot.title,
      status: prot.status,
      runName: prot.runName,
      comment: prot.comment,
      parameters: prot.parameters,
      children: prot.children,
      cpuTime: prot.cpuTime,
      stepsDone: prot.stepsDone,
      numberOfSteps: prot.numberOfSteps,
      elapsedTime: prot.elapsedTime,
      tick: Number(prot.elapsedTime) || 0,
      tags: Array.isArray(prot.tags) ? prot.tags : [],
    }));

    return { nodes: [], edges: [], table: tableData };
  }

  // GRID view -> rows and columns from top-left, no edges
  if (viewMode === "grid") {
    const orderedIds = getTraversalOrderForGrid(protocols);
    const items = orderedIds.map((id) => [id, protocols[id]] as const);

    const total = items.length;
    if (total === 0) return { nodes: [], edges: [] };

    const fallbackW =
      typeof window !== "undefined" && typeof window.innerWidth === "number" ? window.innerWidth : 1600;

    const zoom = typeof viewportZoom === "number" && viewportZoom > 0 ? viewportZoom : 1;
    const screenWidthPx = Math.max(600, containerWidth ?? fallbackW);
    const wrapWorldWidth = screenWidthPx / zoom;

    const estWidths = items.map(([id, prot]) => {
      const label = prot?.label || id;
      return getNodeWidth(id, label, nodeSizeMap);
    });

    const estHeights = items.map(([id, prot]) => {
      const label = prot?.label || id;
      return getNodeHeight(id, label, nodeSizeMap);
    });

    const gapX = 720;
    const gapY = 300;

    const softWidths = estWidths.map((w) => Math.round(w * 0.45));
    const avgSoftW =
      softWidths.length > 0
        ? Math.round(softWidths.reduce((a, b) => a + b, 0) / softWidths.length)
        : 560;

    const baseW = Math.min(680, Math.max(440, avgSoftW));
    const baseH =
      estHeights.length > 0
        ? Math.min(
          520,
          Math.max(
            320,
            Math.round((estHeights.reduce((a, b) => a + b, 0) / estHeights.length) * 0.9)
          )
        )
        : 380;

    const cellW = baseW + gapX;
    const cellH = baseH + gapY;

    const cols =
      Math.max(1, Math.min(total, Math.floor((wrapWorldWidth - gapX) / Math.max(320, cellW))) + 1) || 1;

    const sourcePosition: Position = direction === "LR" ? Position.Right : Position.Bottom;
    const targetPosition: Position = direction === "LR" ? Position.Left : Position.Top;

    // Start at (0,0) top-left
    const offsetX = 100;
    const offsetY = 100;

    for (let i = 0; i < total; i++) {
      const [id, prot] = items[i];
      const row = Math.floor(i / cols);
      const col = i % cols;

      const x = col * cellW + offsetX;
      const y = row * cellH + offsetY;

      nodes.push({
        id,
        type: "status",
        data: {
          label: prot?.label || id,
          title: prot?.title,
          status: prot?.status,
          runName: prot?.runName,
          comment: prot?.comment,
          id,
          parameters: prot?.parameters,
          cpuTime: prot?.cpuTime,
          elapsedTime: prot?.elapsedTime,
          stepsDone: prot?.stepsDone,
          numberOfSteps: prot?.numberOfSteps,
          outputs: prot?.outputs,
          inputs: prot?.inputs,
          tick: Number(prot?.elapsedTime) || 0,
          tags: Array.isArray(prot?.tags) ? prot?.tags : [],
        },
        position: { x, y },
        draggable: id !== "PROJECT",
        sourcePosition,
        targetPosition,
      });
    }

    return { nodes, edges: [] };
  }

  // HIERARCHICAL view -> subtree-aligned layout with all real edges preserved
  const levelMap: Record<string, number> = {};
  const levelBuckets: Record<number, string[]> = {};
  const edgeSet = new Set<string>();
  const parentMap: Record<string, string[]> = {};

  const removeFromOtherBuckets = (id: string) => {
    // removeFromOtherBuckets
    Object.values(levelBuckets).forEach((bucket) => {
      const idx = bucket.indexOf(id);
      if (idx !== -1) bucket.splice(idx, 1);
    });
  };

  const addToBucket = (id: string, level: number) => {
    // addToBucket
    if (!levelBuckets[level]) levelBuckets[level] = [];
    levelBuckets[level].push(id);
  };

  const addParentLink = (childId: string, parentId: string) => {
    // addParentLink
    if (!parentMap[childId]) parentMap[childId] = [];
    parentMap[childId].push(parentId);
  };

  const visiting = new Set<string>();

  const traverse = (id: string, level: number) => {
    // traverse
    const currentLevel = levelMap[id];
    if (currentLevel === undefined || level > currentLevel) {
      levelMap[id] = level;
      removeFromOtherBuckets(id);
      addToBucket(id, level);
    }

    if (visiting.has(id)) return;
    visiting.add(id);

    const prot = protocols[id];
    const children = uniqStable(Array.isArray(prot?.children) ? prot.children.map(String) : []);

    for (const childId of children) {
      const edgeId = `${id}-${childId}`;
      if (!edgeSet.has(edgeId)) {
        edgeSet.add(edgeId);
        addParentLink(childId, id);

        edges.push({
          id: edgeId,
          source: id,
          target: childId,
          animated: false,
          style: { stroke: "#CAD5E2", strokeWidth: 2 },
          markerEnd: "url(#circle)",
          sourceHandle: direction === "TB" ? "bottom" : "right",
          targetHandle: direction === "TB" ? "top" : "left",
        });
      } else {
        addParentLink(childId, id);
      }

      const nextLevel = (levelMap[id] ?? level) + 1;
      traverse(childId, nextLevel);
    }

    visiting.delete(id);
  };

  traverse("PROJECT", 0);

  const sortedLevels = Object.keys(levelBuckets)
    .map((k) => parseInt(k, 10))
    .filter((n) => Number.isFinite(n))
    .sort((a, b) => a - b);

  for (const lvl of sortedLevels) {
    levelBuckets[lvl] = uniqStable(levelBuckets[lvl] ?? []);
  }

  const placements = buildSubtreeAlignedPlacements({
    levelMap,
    parentMap,
    protocols,
    projectName,
    direction,
    spacingX,
    spacingY,
    nodeSizeMap,
    preferredChildOrder: layoutOptions?.preferredChildOrder,
  });

  const nodeIds = Object.keys(levelMap).sort((a, b) => {
    const levelDelta = (levelMap[a] ?? 0) - (levelMap[b] ?? 0);
    return levelDelta !== 0 ? levelDelta : stableIdCompare(a, b);
  });

  for (const id of nodeIds) {
    const prot = protocols[id];
    const label = prot?.label || id;
    const status = prot?.status;
    const runName = prot?.runName || "";
    const comment = prot?.comment || "";
    const level = levelMap[id] ?? 0;

    const position =
      placements[id] ??
      (direction === "TB" ? { x: 0, y: level * spacingY } : { x: level * spacingX, y: 0 });

    const sourcePosition: Position = direction === "LR" ? Position.Right : Position.Bottom;
    const targetPosition: Position = direction === "LR" ? Position.Left : Position.Top;

    nodes.push({
      id,
      type: "status",
      data: {
        label: id === "PROJECT" ? projectName : label,
        title: prot?.title,
        status,
        runName,
        comment,
        id,
        parameters: prot?.parameters,
        cpuTime: prot?.cpuTime,
        elapsedTime: prot?.elapsedTime,
        stepsDone: prot?.stepsDone,
        numberOfSteps: prot?.numberOfSteps,
        outputs: prot?.outputs,
        inputs: prot?.inputs,
        tick: Number(prot?.elapsedTime) || 0,
        tags: Array.isArray(prot?.tags) ? prot.tags : [],
      },
      position,
      draggable: true,
      sourcePosition,
      targetPosition,
    });
  }

  return { nodes, edges };
}
