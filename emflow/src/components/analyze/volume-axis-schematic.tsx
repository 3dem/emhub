import { useMemo } from "react";
import { Box } from "@mui/material";

export type VolumeSlicePositions = {
  x: number;
  y: number;
  z: number;
};

export type VolumeSliceExtents = {
  x: [number, number];
  y: [number, number];
  z: [number, number];
};

type VolumeAxisSchematicProps = {
  sliceExtents: VolumeSliceExtents;
  slices: VolumeSlicePositions;
  activeAxis?: "x" | "y" | "z";
  width?: number;
  height?: number;
};

type Point3 = [number, number, number];
type Point2 = [number, number];

const COS_30 = Math.cos(Math.PI / 6);
const SIN_30 = Math.sin(Math.PI / 6);

/**
 * Project volume coords relative to front-lower-left (0,0,0):
 * - X → right
 * - Z → up (SVG y decreases)
 * - Y → into back at 30° from +X (up-right on screen)
 */
function projectRelative(rel: Point3): Point2 {
  const [x, y, z] = rel;
  return [x + COS_30 * y, -SIN_30 * y - z];
}

function buildViewportTransform(
  minCorner: Point3,
  maxCorner: Point3,
  width: number,
  height: number,
) {
  const toRelative = (point: Point3): Point3 => [
    point[0] - minCorner[0],
    point[1] - minCorner[1],
    point[2] - minCorner[2],
  ];

  const boxCornerPoints: Point3[] = [
    [minCorner[0], minCorner[1], minCorner[2]],
    [maxCorner[0], minCorner[1], minCorner[2]],
    [maxCorner[0], maxCorner[1], minCorner[2]],
    [minCorner[0], maxCorner[1], minCorner[2]],
    [minCorner[0], minCorner[1], maxCorner[2]],
    [maxCorner[0], minCorner[1], maxCorner[2]],
    [maxCorner[0], maxCorner[1], maxCorner[2]],
    [minCorner[0], maxCorner[1], maxCorner[2]],
  ];

  const projected = boxCornerPoints.map((point) => projectRelative(toRelative(point)));
  const minSx = Math.min(...projected.map(([x]) => x));
  const maxSx = Math.max(...projected.map(([x]) => x));
  const minSy = Math.min(...projected.map(([, y]) => y));
  const maxSy = Math.max(...projected.map(([, y]) => y));

  const padding = 16;
  const spanX = Math.max(maxSx - minSx, 1);
  const spanY = Math.max(maxSy - minSy, 1);
  const scale =
    Math.min((width - 2 * padding) / spanX, (height - 2 * padding) / spanY) * 0.88;

  const anchorX = padding - minSx * scale;
  const anchorY = height - padding - maxSy * scale;

  const project = (point: Point3): Point2 => {
    const [sx, sy] = projectRelative(toRelative(point));
    return [anchorX + sx * scale, anchorY + sy * scale];
  };

  return { project };
}

function toSvg(points: Point2[]): string {
  return points
    .map(([x, y], index) => `${index === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`)
    .join(" ");
}

function planePath(corners: Point3[], project: (point: Point3) => Point2): string {
  return `${toSvg(corners.map(project))} Z`;
}

function arrowHead(from: Point2, to: Point2, size = 7): string {
  const angle = Math.atan2(to[1] - from[1], to[0] - from[0]);
  const wing = Math.PI * 0.82;
  const x1 = to[0] + size * Math.cos(angle + wing);
  const y1 = to[1] + size * Math.sin(angle + wing);
  const x2 = to[0] + size * Math.cos(angle - wing);
  const y2 = to[1] + size * Math.sin(angle - wing);
  return `M${to[0].toFixed(1)},${to[1].toFixed(1)} L${x1.toFixed(1)},${y1.toFixed(1)} M${to[0].toFixed(1)},${to[1].toFixed(1)} L${x2.toFixed(1)},${y2.toFixed(1)}`;
}

function labelOffset(label: "x" | "y" | "z", tip: Point2, origin: Point2): Point2 {
  if (label === "x") return [tip[0] + 5, tip[1] + 4];
  if (label === "y") return [tip[0] + 8, tip[1] - 4];
  return [tip[0] - 16, tip[1] + 3];
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export default function VolumeAxisSchematic({
  sliceExtents,
  slices,
  activeAxis = "z",
  width = 148,
  height = 132,
}: VolumeAxisSchematicProps) {
  const geometry = useMemo(() => {
    const [minX, maxX] = sliceExtents.x;
    const [minY, maxY] = sliceExtents.y;
    const [minZ, maxZ] = sliceExtents.z;

    const minCorner: Point3 = [minX, minY, minZ];
    const maxCorner: Point3 = [maxX, maxY, maxZ];

    const { project } = buildViewportTransform(minCorner, maxCorner, width, height);

    const origin: Point3 = [minX, minY, minZ];
    const xTip: Point3 = [maxX, minY, minZ];
    const yTip: Point3 = [minX, maxY, minZ];
    const zTip: Point3 = [minX, minY, maxZ];

    const boxCorners: Point3[] = [
      [minX, minY, minZ],
      [maxX, minY, minZ],
      [maxX, maxY, minZ],
      [minX, maxY, minZ],
      [minX, minY, maxZ],
      [maxX, minY, maxZ],
      [maxX, maxY, maxZ],
      [minX, maxY, maxZ],
    ];

    const boxEdges: Array<[number, number]> = [
      [0, 1], [1, 2], [2, 3], [3, 0],
      [4, 5], [5, 6], [6, 7], [7, 4],
      [0, 4], [1, 5], [2, 6], [3, 7],
    ];

    const sliceX = clamp(slices.x, minX, maxX);
    const sliceY = clamp(slices.y, minY, maxY);
    const sliceZ = clamp(slices.z, minZ, maxZ);

    const origin2 = project(origin);
    const xTip2 = project(xTip);
    const yTip2 = project(yTip);
    const zTip2 = project(zTip);

    return {
      origin: origin2,
      axes: {
        x: { from: origin2, to: xTip2, head: arrowHead(origin2, xTip2), label: labelOffset("x", xTip2, origin2) },
        y: { from: origin2, to: yTip2, head: arrowHead(origin2, yTip2), label: labelOffset("y", yTip2, origin2) },
        z: { from: origin2, to: zTip2, head: arrowHead(origin2, zTip2), label: labelOffset("z", zTip2, origin2) },
      },
      boxEdges: boxEdges.map(([a, b]) => ({
        d: toSvg([project(boxCorners[a]), project(boxCorners[b])]),
      })),
      planes: {
        x: planePath(
          [
            [sliceX, minY, minZ],
            [sliceX, maxY, minZ],
            [sliceX, maxY, maxZ],
            [sliceX, minY, maxZ],
          ],
          project,
        ),
        y: planePath(
          [
            [minX, sliceY, minZ],
            [maxX, sliceY, minZ],
            [maxX, sliceY, maxZ],
            [minX, sliceY, maxZ],
          ],
          project,
        ),
        z: planePath(
          [
            [minX, minY, sliceZ],
            [maxX, minY, sliceZ],
            [maxX, maxY, sliceZ],
            [minX, maxY, sliceZ],
          ],
          project,
        ),
      },
    };
  }, [height, sliceExtents, slices.x, slices.y, slices.z, width]);

  const planeStyle = {
    x: {
      fill: "rgba(33, 150, 243, 0.35)",
      stroke: "rgba(33, 150, 243, 0.9)",
    },
    y: {
      fill: "rgba(76, 175, 80, 0.35)",
      stroke: "rgba(76, 175, 80, 0.9)",
    },
    z: {
      fill: "rgba(244, 67, 54, 0.35)",
      stroke: "rgba(244, 67, 54, 0.9)",
    },
  };

  const axisColor = {
    x: "#1976d2",
    y: "#388e3c",
    z: "#d32f2f",
  };

  const activePlane = planeStyle[activeAxis];

  return (
    <Box
      sx={{
        width: "100%",
        height: "100%",
        borderRadius: 1,
        border: "1px solid",
        borderColor: "divider",
        bgcolor: "rgba(255,255,255,0.92)",
        boxShadow: 1,
        overflow: "hidden",
        flex: 1,
        minWidth: 0,
        minHeight: 0,
      }}
    >
      <svg
        width="100%"
        height="100%"
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="xMidYMid meet"
        aria-hidden="true"
      >
        {geometry.boxEdges.map((edge, index) => (
          <path
            key={index}
            d={edge.d}
            fill="none"
            stroke="rgba(0,0,0,0.35)"
            strokeWidth={1}
          />
        ))}

        <path
          d={geometry.planes[activeAxis]}
          fill={activePlane.fill}
          stroke={activePlane.stroke}
          strokeWidth={1.4}
        />

        {(["x", "y", "z"] as const).map((label) => {
          const axis = geometry.axes[label];
          return (
            <g key={label}>
              <line
                x1={axis.from[0]}
                y1={axis.from[1]}
                x2={axis.to[0]}
                y2={axis.to[1]}
                stroke={axisColor[label]}
                strokeWidth={1.6}
              />
              <path
                d={axis.head}
                fill="none"
                stroke={axisColor[label]}
                strokeWidth={1.6}
                strokeLinecap="round"
              />
              <text
                x={axis.label[0]}
                y={axis.label[1]}
                fill={axisColor[label]}
                fontSize={11}
                fontWeight={600}
                fontFamily="system-ui, sans-serif"
                textAnchor={label === "z" ? "end" : "start"}
              >
                {label.toUpperCase()}
              </text>
            </g>
          );
        })}
      </svg>
    </Box>
  );
}
