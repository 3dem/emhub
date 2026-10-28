// File: src/utils/graph_layout/index.ts
// Graph layouts (node placement of the hierarchical view), by name.
//
// The layout of each direction can be chosen with the page URL arguments
// `wtb` (Top-Bottom) and `wlr` (Left-Right), e.g. `...&wtb=ylevel&wlr=current`.
import { currentLayout } from "./current";
import { yLevelLayout } from "./ylevel";
import { Direction, GraphLayout } from "./common";

export * from "./common";

export const GRAPH_LAYOUTS = {
  current: currentLayout,
  ylevel: yLevelLayout,
} satisfies Record<string, GraphLayout>;

export type GraphLayoutName = keyof typeof GRAPH_LAYOUTS;

export const DEFAULT_GRAPH_LAYOUT: GraphLayoutName = "ylevel";

/**
 * Key suffix of the saved node positions of a layout: none for "current"
 * (positions saved before there were several layouts), `-<name>` otherwise.
 */
export function getGraphLayoutStorageSuffix(name: GraphLayoutName): string {
  return name === "current" ? "" : `-${name}`;
}

const LAYOUT_URL_ARGS: Record<Direction, string> = { TB: "wtb", LR: "wlr" };

function isGraphLayoutName(name: unknown): name is GraphLayoutName {
  return typeof name === "string" && Object.prototype.hasOwnProperty.call(GRAPH_LAYOUTS, name);
}

/** Layout of the given direction, from the page URL arguments (wtb / wlr). */
export function getGraphLayoutName(direction: Direction): GraphLayoutName {
  if (typeof window === "undefined") return DEFAULT_GRAPH_LAYOUT;

  const value = new URLSearchParams(window.location.search).get(LAYOUT_URL_ARGS[direction]);
  if (value && !isGraphLayoutName(value)) {
    console.warn(`emflow: unknown graph layout '${value}', using '${DEFAULT_GRAPH_LAYOUT}'`);
  }
  return isGraphLayoutName(value) ? value : DEFAULT_GRAPH_LAYOUT;
}

export function getGraphLayout(name?: GraphLayoutName | null): GraphLayout {
  return GRAPH_LAYOUTS[isGraphLayoutName(name) ? name : DEFAULT_GRAPH_LAYOUT];
}
