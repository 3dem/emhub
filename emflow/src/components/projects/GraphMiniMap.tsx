import React, { CSSProperties, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Node, Panel, PanelPosition, Rect, getRectOfNodes, useStore, useStoreApi } from "reactflow";

/**
 * Minimap for the project graph.
 *
 * Unlike React Flow's built-in <MiniMap pannable zoomable>, the minimap frame is frozen while the
 * view box is dragged, so dragging only pans the visible area of the graph (the box keeps its size
 * and the minimap doesn't rescale under the cursor). The mouse wheel over the minimap zooms the
 * graph around the center of the visible area.
 */

type NodeAttr = string | ((node: Node<any>) => string);

export interface GraphMiniMapProps {
  nodeColor?: NodeAttr;
  nodeStrokeColor?: NodeAttr;
  nodeStrokeWidth?: number;
  nodeBorderRadius?: number;
  maskColor?: string;
  viewStrokeColor?: string;
  position?: PanelPosition;
  style?: CSSProperties;
  width?: number;
  height?: number;
  /** Padding around the content, in minimap pixels. */
  padding?: number;
  /** Wheel zoom sensitivity (higher = faster). */
  zoomSpeed?: number;
}

const attr = (a: NodeAttr | undefined, node: Node<any>, fallback: string) =>
  a === undefined ? fallback : typeof a === "function" ? a(node) : a;

/**
 * Applies a viewport synchronously. reactflow's setViewport() goes through a d3 transition (even
 * with duration 0), which lands a frame late and makes a drag lag behind / drop its last move.
 * The new ZoomTransform is built from the current one's constructor (d3-zoom isn't a direct dep).
 */
const applyViewport = (store: ReturnType<typeof useStoreApi>, x: number, y: number, k: number) => {
  const { d3Zoom, d3Selection } = store.getState();
  if (!d3Zoom || !d3Selection) return;
  const current: any = (d3Selection.node() as any)?.__zoom;
  if (!current) return;
  d3Zoom.transform(d3Selection, new current.constructor(k, x, y));
};

const unionRect = (a: Rect, b: Rect): Rect => {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return {
    x,
    y,
    width: Math.max(a.x + a.width, b.x + b.width) - x,
    height: Math.max(a.y + a.height, b.y + b.height) - y,
  };
};

export function GraphMiniMap({
  nodeColor,
  nodeStrokeColor,
  nodeStrokeWidth = 2,
  nodeBorderRadius = 5,
  maskColor = "rgba(240,240,240,0.6)",
  viewStrokeColor = "rgba(0,112,243,0.8)",
  position = "bottom-right",
  style,
  width = 200,
  height = 150,
  padding = 5,
  zoomSpeed = 1.2,
}: GraphMiniMapProps) {
  const store = useStoreApi();
  const nodeInternals = useStore((s) => s.nodeInternals);
  const [tx, ty, zoom] = useStore((s) => s.transform);
  const paneW = useStore((s) => s.width);
  const paneH = useStore((s) => s.height);
  const minZoom = useStore((s) => s.minZoom);
  const maxZoom = useStore((s) => s.maxZoom);

  const nodes = useMemo(
    () => Array.from(nodeInternals.values()).filter((n) => !n.hidden && n.width && n.height),
    [nodeInternals]
  );

  // Visible area of the graph, in flow coordinates.
  const viewBB: Rect = {
    x: -tx / zoom,
    y: -ty / zoom,
    width: paneW / zoom,
    height: paneH / zoom,
  };

  const liveBounds = nodes.length ? unionRect(getRectOfNodes(nodes), viewBB) : viewBB;

  // Frozen while dragging so the minimap->flow mapping stays constant during the gesture.
  const [frozenBounds, setFrozenBounds] = useState<Rect | null>(null);
  const bounds = frozenBounds ?? liveBounds;

  const viewScale = Math.max(bounds.width / width, bounds.height / height) || 1;
  const offset = padding * viewScale;
  const vbW = viewScale * width + offset * 2;
  const vbH = viewScale * height + offset * 2;
  const vbX = bounds.x - (vbW - bounds.width) / 2;
  const vbY = bounds.y - (vbH - bounds.height) / 2;

  const svgRef = useRef<SVGSVGElement | null>(null);
  const dragRef = useRef<{ grabX: number; grabY: number; pointerId: number } | null>(null);

  // Latest values for the native (non-passive) wheel listener.
  const latest = useRef({ tx, ty, zoom, paneW, paneH, minZoom, maxZoom, zoomSpeed });
  latest.current = { tx, ty, zoom, paneW, paneH, minZoom, maxZoom, zoomSpeed };

  const toFlow = useCallback(
    (clientX: number, clientY: number, box: { x: number; y: number; w: number; h: number }) => {
      const rect = svgRef.current!.getBoundingClientRect();
      return {
        x: box.x + ((clientX - rect.left) * box.w) / rect.width,
        y: box.y + ((clientY - rect.top) * box.h) / rect.height,
      };
    },
    []
  );

  // The viewBox used for the current drag (captured at pointerdown).
  const dragBoxRef = useRef({ x: 0, y: 0, w: 1, h: 1 });

  const moveViewTo = (originX: number, originY: number) => {
    applyViewport(store, -originX * zoom, -originY * zoom, zoom);
  };

  const onPointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const box = { x: vbX, y: vbY, w: vbW, h: vbH };
    dragBoxRef.current = box;
    setFrozenBounds(bounds);
    const p = toFlow(e.clientX, e.clientY, box);
    const inside =
      p.x >= viewBB.x && p.x <= viewBB.x + viewBB.width && p.y >= viewBB.y && p.y <= viewBB.y + viewBB.height;
    if (inside) {
      dragRef.current = { grabX: p.x - viewBB.x, grabY: p.y - viewBB.y, pointerId: e.pointerId };
    } else {
      // Clicking outside the box centers the view there, then keeps dragging from the center.
      dragRef.current = { grabX: viewBB.width / 2, grabY: viewBB.height / 2, pointerId: e.pointerId };
      moveViewTo(p.x - viewBB.width / 2, p.y - viewBB.height / 2);
    }
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const d = dragRef.current;
    if (!d || d.pointerId !== e.pointerId) return;
    const p = toFlow(e.clientX, e.clientY, dragBoxRef.current);
    moveViewTo(p.x - d.grabX, p.y - d.grabY);
  };

  const endDrag = (e: React.PointerEvent<SVGSVGElement>) => {
    const d = dragRef.current;
    if (!d || d.pointerId !== e.pointerId) return;
    dragRef.current = null;
    setFrozenBounds(null);
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
  };

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const s = latest.current;
      if (s.minZoom >= s.maxZoom) return;
      const unit = e.deltaMode === 1 ? 0.05 : e.deltaMode ? 1 : 0.002;
      const next = Math.min(s.maxZoom, Math.max(s.minZoom, s.zoom * Math.pow(2, -e.deltaY * unit * s.zoomSpeed)));
      if (next === s.zoom) return;
      // Zoom around the center of the visible area so the box stays in place.
      const cx = (s.paneW / 2 - s.tx) / s.zoom;
      const cy = (s.paneH / 2 - s.ty) / s.zoom;
      applyViewport(store, s.paneW / 2 - cx * next, s.paneH / 2 - cy * next, next);
    };
    svg.addEventListener("wheel", onWheel, { passive: false });
    return () => svg.removeEventListener("wheel", onWheel);
  }, [store]);

  const dragging = frozenBounds !== null;
  const strokeW = 1.5 * viewScale;

  return (
    <Panel position={position} style={style} className="react-flow__minimap">
      <svg
        ref={svgRef}
        width={width}
        height={height}
        viewBox={`${vbX} ${vbY} ${vbW} ${vbH}`}
        role="img"
        aria-label="Graph minimap"
        style={{ display: "block", cursor: dragging ? "grabbing" : "pointer", touchAction: "none" }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      >
        {nodes.map((n) => {
          const pos = n.positionAbsolute ?? n.position;
          return (
            <rect
              key={n.id}
              x={pos.x}
              y={pos.y}
              width={n.width!}
              height={n.height!}
              rx={nodeBorderRadius}
              ry={nodeBorderRadius}
              fill={attr(nodeColor, n, "#e2e2e2")}
              stroke={attr(nodeStrokeColor, n, "transparent")}
              strokeWidth={nodeStrokeWidth}
              shapeRendering="crispEdges"
            />
          );
        })}
        <path
          d={`M${vbX - offset},${vbY - offset}h${vbW + offset * 2}v${vbH + offset * 2}h${-vbW - offset * 2}z
              M${viewBB.x},${viewBB.y}h${viewBB.width}v${viewBB.height}h${-viewBB.width}z`}
          fill={maskColor}
          fillRule="evenodd"
          pointerEvents="none"
        />
        <rect
          x={viewBB.x}
          y={viewBB.y}
          width={viewBB.width}
          height={viewBB.height}
          fill="transparent"
          stroke={viewStrokeColor}
          strokeWidth={strokeW}
          style={{ cursor: dragging ? "grabbing" : "grab" }}
        />
      </svg>
    </Panel>
  );
}

export default GraphMiniMap;
