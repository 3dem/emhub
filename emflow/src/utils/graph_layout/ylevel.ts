// File: src/utils/graph_layout/ylevel.ts
// "ylevel" layout: level tree as in Scipion (pyworkflow/gui/graph_layout.py,
// LevelTreeLayout). Each node is drawn at its level (longest path from the
// project) and under a single layout parent, the first parent found one level
// above it. Then, bottom-up, the subtrees of the children of each node are
// packed side by side as close as their contours (left/right limits at each
// level) allow, and centered under the node.
import {
  compareChildrenByParentOrder,
  GraphLayoutParams,
  GraphPosition,
  getResolvedPlacementCrossSize,
  stableIdCompare,
  uniqStable,
} from "./common";

// Left/right limits of a subtree at each level below its root (index 0 is
// the root), relative to the root center on the cross axis.
type Contour = Array<[number, number]>;

export function yLevelLayout(params: GraphLayoutParams): Record<string, GraphPosition> {
  const { levelMap, protocols, projectName, direction, spacingX, spacingY, nodeSizeMap, preferredChildOrder } =
    params;

  // Gap between neighbor subtrees on the cross axis
  const gap = direction === "TB" ? 200 : 120;

  const getChildren = (id: string): string[] =>
    uniqStable(Array.isArray(protocols[id]?.children) ? protocols[id].children.map(String) : []);

  const getSize = (id: string): number =>
    getResolvedPlacementCrossSize({ id, direction, protocols, projectName, nodeSizeMap });

  const sortChildren = (parentId: string, children: string[]): string[] => {
    const preferredOrder = preferredChildOrder?.[parentId] ?? [];
    const preferredRank = new Map(preferredOrder.map((id, index) => [String(id), index]));

    return [...children].sort((a, b) => {
      const rankA = preferredRank.get(a);
      const rankB = preferredRank.get(b);
      if (rankA !== undefined && rankB !== undefined) return rankA - rankB;
      if (rankA !== undefined) return -1;
      if (rankB !== undefined) return 1;
      return compareChildrenByParentOrder(protocols, parentId, a, b);
    });
  };

  // Layout parent: the first parent (depth-first from the project) that is
  // exactly one level above the node
  const layoutChildren: Record<string, string[]> = {};
  const hasLayoutParent = new Set<string>();
  const visited = new Set<string>();

  const assignParents = (id: string) => {
    if (visited.has(id)) return;
    visited.add(id);

    for (const childId of getChildren(id)) {
      if (!(childId in levelMap)) continue;

      if (!hasLayoutParent.has(childId) && levelMap[childId] === levelMap[id] + 1) {
        hasLayoutParent.add(childId);
        (layoutChildren[id] ??= []).push(childId);
      }
      assignParents(childId);
    }
  };

  assignParents("PROJECT");

  for (const id of Object.keys(layoutChildren)) {
    layoutChildren[id] = sortChildren(id, layoutChildren[id]);
  }

  // Bottom-up: offset of each child relative to its layout parent
  const offsets: Record<string, number> = {};

  const computeContour = (id: string): Contour => {
    const half = getSize(id) / 2;
    const children = layoutChildren[id] ?? [];

    // Contour of the children placed so far (relative to the first child)
    const merged: Contour = [];
    const childOffsets: number[] = [];

    for (const childId of children) {
      const childContour = computeContour(childId);
      let offset = 0;

      if (childOffsets.length > 0) {
        // Closest position where the child does not overlap at any level
        offset = Number.NEGATIVE_INFINITY;
        const depth = Math.min(merged.length, childContour.length);
        for (let d = 0; d < depth; d++) {
          offset = Math.max(offset, merged[d][1] - childContour[d][0] + gap);
        }
      }

      childOffsets.push(offset);
      childContour.forEach(([left, right], d) => {
        merged[d] = merged[d]
          ? [Math.min(merged[d][0], left + offset), Math.max(merged[d][1], right + offset)]
          : [left + offset, right + offset];
      });
    }

    // Center the children under the node (between the first and last child)
    const shift = childOffsets.length > 0 ? -(childOffsets[0] + childOffsets[childOffsets.length - 1]) / 2 : 0;
    children.forEach((childId, i) => {
      offsets[childId] = childOffsets[i] + shift;
    });

    const contour: Contour = [[-half, half]];
    merged.forEach(([left, right]) => contour.push([left + shift, right + shift]));

    return contour;
  };

  // Roots: the project and, if any, nodes without a layout parent, side by side
  const roots = Object.keys(levelMap)
    .filter((id) => id === "PROJECT" || !hasLayoutParent.has(id))
    .sort((a, b) => {
      const levelDelta = (levelMap[a] ?? 0) - (levelMap[b] ?? 0);
      return levelDelta !== 0 ? levelDelta : stableIdCompare(a, b);
    });

  const placements: Record<string, GraphPosition> = {};

  const place = (id: string, axis: number) => {
    const level = levelMap[id] ?? 0;
    placements[id] = direction === "TB" ? { x: axis, y: level * spacingY } : { x: level * spacingX, y: axis };

    for (const childId of layoutChildren[id] ?? []) {
      place(childId, axis + offsets[childId]);
    }
  };

  let cursor = 0;
  for (const rootId of roots) {
    const contour = computeContour(rootId);
    const left = Math.min(...contour.map(([l]) => l));
    const right = Math.max(...contour.map(([, r]) => r));

    const axis = rootId === roots[0] ? 0 : cursor - left;
    place(rootId, axis);
    cursor = axis + right + gap;
  }

  return placements;
}
