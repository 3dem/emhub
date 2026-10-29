// File: src/utils/graph_utils.ts
import { ProtocolNode } from "@/types/protocolNode";
import { Node, Edge, Position } from "reactflow";
import {
  Direction,
  getGraphLayout,
  getNodeHeight,
  getNodeWidth,
  GraphLayoutName,
  NodeSizeMap,
  stableIdCompare,
  uniqStable,
} from "./graph_layout";

export type { NodeSizeMap } from "./graph_layout";

/* ------------------------ Collapsed groups ------------------------ */
// A collapsed node hides its subtree (the jobs highlighted by "Select from"),
// except the jobs already in another group:
// - a group whose root is in the subtree is nested: it is hidden too (its jobs
//   stay in it) and shows again, still collapsed, when the parent is expanded;
// - the jobs of any other group stay in it, the two groups are separate.
// The node is shown as a group node; edges into hidden jobs go to the group
// node that shows them, also between groups.

/** Ids of the subtree of `rootId`, the root included. */
function getSubtreeIds(protocols: Record<string, ProtocolNode>, rootId: string): Set<string> {
  const ids = new Set<string>();
  const pending = [String(rootId)];

  while (pending.length > 0) {
    const id = pending.pop()!;
    if (ids.has(id) || id === "PROJECT" || !protocols[id]) continue;
    ids.add(id);
    for (const childId of protocols[id]?.children ?? []) pending.push(String(childId));
  }
  return ids;
}

/**
 * Members of each collapsed group (its root included). Groups take their
 * jobs in collapse order, but a group nested in another one always goes
 * before it.
 */
function getCollapsedGroups(
  protocols: Record<string, ProtocolNode>,
  collapsedIds: Iterable<string>
): Map<string, Set<string>> {
  const subtrees = new Map(
    uniqStable([...collapsedIds].map(String))
      .filter((id) => Boolean(protocols[id]))
      .map((id) => [id, getSubtreeIds(protocols, id)] as const)
  );

  const roots: string[] = [];
  const addRoot = (root: string) => {
    if (roots.includes(root)) return;
    for (const other of subtrees.keys()) {
      if (other !== root && subtrees.get(root)!.has(other)) addRoot(other);
    }
    roots.push(root);
  };
  for (const root of subtrees.keys()) addRoot(root);

  const members = new Map<string, Set<string>>();
  const groupOf = new Map<string, string>();  // job -> group that holds it

  for (const root of roots) {
    const subtree = subtrees.get(root)!;
    const ids = new Set<string>();
    const pending = [root];

    while (pending.length > 0) {
      const id = pending.pop()!;
      if (ids.has(id) || id === "PROJECT" || !protocols[id]) continue;

      const group = groupOf.get(id);
      if (group !== undefined) {
        // The root of a nested group comes in this group, other jobs stay in theirs
        if (id === group && subtree.has(group)) ids.add(id);
        continue;
      }
      ids.add(id);
      for (const childId of protocols[id]?.children ?? []) pending.push(String(childId));
    }

    // Nested group roots now belong to this group (another one can not take them)
    for (const id of ids) groupOf.set(id, root);
    members.set(root, ids);
  }
  return members;
}

/**
 * Protocols with each collapsed group replaced by its root, which gets
 * `collapsedCount` (all the jobs it hides, nested groups included, plus the
 * root) and, as children, the other group nodes its jobs feed. Groups
 * nested in a collapsed group are hidden too. Missing roots are ignored.
 */
export function collapseProtocols(
  protocols: Record<string, ProtocolNode>,
  collapsedIds?: Iterable<string> | null
): Record<string, ProtocolNode> {
  const members = getCollapsedGroups(protocols, collapsedIds ?? []);
  if (members.size === 0) return protocols;

  // Group of each hidden job, then the visible group that shows it
  const groupOf = new Map<string, string>();
  for (const [root, ids] of members) {
    for (const id of ids) if (id !== root) groupOf.set(id, root);
  }
  const visibleGroupOf = (id: string): string => {
    let group = groupOf.get(id) ?? id;
    while (groupOf.has(group)) group = groupOf.get(group)!;
    return group;
  };

  const counts = new Map<string, number>();
  const hiddenByGroup = new Map<string, string[]>();
  for (const id of groupOf.keys()) {
    const group = visibleGroupOf(id);
    counts.set(group, (counts.get(group) ?? 1) + 1);
    hiddenByGroup.set(group, [...(hiddenByGroup.get(group) ?? []), id]);
  }

  const visibleChildren = (ids: string[], self: string) =>
    uniqStable(
      ids.flatMap((id) => (protocols[id]?.children ?? []).map((childId) => visibleGroupOf(String(childId))))
    ).filter((childId) => childId !== self);

  const visible: Record<string, ProtocolNode> = {};
  for (const [id, prot] of Object.entries(protocols)) {
    if (groupOf.has(id)) continue;

    if (members.has(id)) {
      visible[id] = {
        ...prot,
        children: visibleChildren([id, ...(hiddenByGroup.get(id) ?? [])], id),
        collapsedCount: counts.get(id) ?? 1,
      } as ProtocolNode;
      continue;
    }

    // Edges into a hidden job go to the group node that shows it
    visible[id] = { ...prot, children: visibleChildren([id], id) } as ProtocolNode;
  }
  return visible;
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

/**
 * Build nodes and edges for ReactFlow from protocols.
 *
 * The hierarchical node placement is done by a named layout (graph_layout/,
 * layoutOptions.layout, "ylevel" by default). Notes of the "current" layout:
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
    layout?: GraphLayoutName | null;
    // Roots of the collapsed groups (hierarchical view only)
    collapsed?: Iterable<string> | null;
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
      elapsedSessionId: prot.elapsedSessionId,
      elapsedRuns: prot.elapsedRuns,
      launched: prot.launched,
      queued: prot.queued,
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
          elapsedSessionId: prot?.elapsedSessionId,
          elapsedRuns: prot?.elapsedRuns,
          launched: prot?.launched,
          queued: prot?.queued,
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

  // HIERARCHICAL view -> named layout (graph_layout/) with all real edges preserved.
  // The jobs of collapsed groups are removed first, so nothing below sees them.
  protocols = collapseProtocols(protocols, layoutOptions?.collapsed);

  const getChildren = (id: string): string[] =>
    uniqStable(Array.isArray(protocols[id]?.children) ? protocols[id].children.map(String) : []);

  // Edges and parents of the nodes reachable from the project (depth-first order)
  const parentMap: Record<string, string[]> = {};
  const reachable: string[] = [];
  const visited = new Set<string>();

  const visit = (id: string) => {
    visited.add(id);
    reachable.push(id);

    for (const childId of getChildren(id)) {
      (parentMap[childId] ??= []).push(id);
      edges.push({
        id: `${id}-${childId}`,
        source: id,
        target: childId,
        animated: false,
        style: { stroke: "#CAD5E2", strokeWidth: 2 },
        markerEnd: "url(#circle)",
        sourceHandle: direction === "TB" ? "bottom" : "right",
        targetHandle: direction === "TB" ? "top" : "left",
      });
      if (!visited.has(childId)) visit(childId);
    }
  };

  visit("PROJECT");

  // Level of each node: longest path from the project, in topological order
  // (each node and edge is processed once)
  const levelMap: Record<string, number> = { PROJECT: 0 };
  const pendingParents: Record<string, number> = {};
  for (const id of reachable) pendingParents[id] = parentMap[id]?.length ?? 0;

  const ready = ["PROJECT"];
  for (let i = 0; i < ready.length; i++) {
    const id = ready[i];
    for (const childId of getChildren(id)) {
      levelMap[childId] = Math.max(levelMap[childId] ?? 0, levelMap[id] + 1);
      if (--pendingParents[childId] === 0) ready.push(childId);
    }
  }

  // Nodes in a cycle (never ready): one level below their deepest known parent
  for (const id of reachable) {
    if (id in levelMap && pendingParents[id] <= 0) continue;
    const parentLevels = (parentMap[id] ?? []).map((parentId) => levelMap[parentId] ?? 0);
    levelMap[id] = Math.max(levelMap[id] ?? 0, ...parentLevels) + 1;
  }

  const placements = getGraphLayout(layoutOptions?.layout)({
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
        elapsedSessionId: prot?.elapsedSessionId,
        elapsedRuns: prot?.elapsedRuns,
        launched: prot?.launched,
        queued: prot?.queued,
        stepsDone: prot?.stepsDone,
        numberOfSteps: prot?.numberOfSteps,
        outputs: prot?.outputs,
        inputs: prot?.inputs,
        tick: Number(prot?.elapsedTime) || 0,
        tags: Array.isArray(prot?.tags) ? prot.tags : [],
        collapsedCount: (prot as any)?.collapsedCount,
        canCollapse: id !== "PROJECT" && getChildren(id).length > 0,
      },
      position,
      draggable: true,
      sourcePosition,
      targetPosition,
    });
  }

  return { nodes, edges };
}
