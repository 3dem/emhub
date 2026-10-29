// File: src/utils/graph_layout/current.ts
// "current" layout: subtree-aligned placement (see buildGraphElements notes).
import {
  compareChildrenByParentOrder,
  GraphLayoutParams,
  GraphPosition,
  getNodePackingCrossSize,
  getResolvedPlacementCrossSize,
  selectPrimaryLayoutParent,
  stableIdCompare,
  uniqStable,
} from "./common";

export function currentLayout(params: GraphLayoutParams): Record<string, GraphPosition> {
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
