import * as React from "react";
import {
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  IconButton,
  Radio,
  RadioGroup,
  Slider,
  Stack,
  Typography,
} from "@mui/material";
import { Canvas, ThreeEvent, useThree } from "@react-three/fiber";
import { CloseIcon } from "@/icons";
import * as THREE from "three";
import { OrbitControls as ThreeOrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

import type { ThreeElements } from "@react-three/fiber";

declare module "react/jsx-runtime" {
    namespace JSX {
        interface IntrinsicElements extends ThreeElements { }
    }
}

export { };

type Point3d = {
  x: number;
  y: number;
  z: number;
};

type ViewAxis = "X" | "Y" | "Z";

type PointInVolumeWizardDialogProps = {
  open: boolean;
  title: string;
  message: string;

  dims: [number, number, number];
  previewDims: [number, number, number];
  previewValues: number[];

  point: Point3d;
  pointVoxel: Point3d;

  onClose: () => void;
  onConfirm: () => void;
  onPointChange: (point: Point3d) => void;
  onPointVoxelChange?: (pointVoxel: Point3d) => void;
};

type PointCloudResult = {
  positions: Float32Array;
  count: number;
};

const wizardDialogPaperSx = {
  borderRadius: "22px",
  overflow: "hidden",
  border: "1px solid rgba(51, 61, 73, 0.14)",
  boxShadow: "0 24px 70px rgba(15, 23, 42, 0.24)",
  backgroundImage: "none",
};

const wizardDialogTitleSx = {
  m: 0,
  px: 2.5,
  py: 2,
  background: "linear-gradient(135deg, #333d49 0%, #3d4957 55%, #465567 100%)",
  color: "#ffffff",
  borderBottom: "1px solid rgba(255,255,255,0.08)",
};

const wizardDialogContentSx = {
  px: 2.5,
  py: 2.5,
  background: "linear-gradient(180deg, #f8fafc 0%, #f4f7fb 100%)",
  borderColor: "rgba(15,23,42,0.08)",
};

const wizardDialogActionsSx = {
  px: 2.5,
  py: 2,
  backgroundColor: "#ffffff",
  borderTop: "1px solid rgba(15,23,42,0.08)",
  justifyContent: "flex-end",
  gap: 1.25,
};

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function roundTo(value: number, digits = 2): number {
  const factor = Math.pow(10, digits);
  return Math.round(value * factor) / factor;
}

function hasText(value: string | null | undefined): boolean {
  return Boolean(String(value ?? "").trim());
}

function asNumber(value: number | number[]): number {
  return Array.isArray(value) ? Number(value[0]) || 0 : Number(value) || 0;
}

function buildVolumeIndex(
  z: number,
  y: number,
  x: number,
  dims: [number, number, number],
): number {
  const [, yDim, xDim] = dims;
  return z * yDim * xDim + y * xDim + x;
}

function normalizePreviewValues(
  previewValues: number[],
  previewDims: [number, number, number],
): Uint8Array {
  const expectedSize = previewDims[0] * previewDims[1] * previewDims[2];
  const out = new Uint8Array(expectedSize);

  const count = Math.min(expectedSize, previewValues.length);
  for (let i = 0; i < count; i += 1) {
    out[i] = clamp(Math.round(Number(previewValues[i]) || 0), 0, 255);
  }

  return out;
}

function centeredPointToVoxel(
  point: Point3d,
  dims: [number, number, number],
): Point3d {
  return {
    x: clamp(point.x + dims[2] / 2, 0, Math.max(0, dims[2] - 1)),
    y: clamp(point.y + dims[1] / 2, 0, Math.max(0, dims[1] - 1)),
    z: clamp(point.z + dims[0] / 2, 0, Math.max(0, dims[0] - 1)),
  };
}

function voxelToCenteredPoint(
  pointVoxel: Point3d,
  dims: [number, number, number],
): Point3d {
  return {
    x: pointVoxel.x - dims[2] / 2,
    y: pointVoxel.y - dims[1] / 2,
    z: pointVoxel.z - dims[0] / 2,
  };
}

function previewVoxelToWorld(
  previewVoxel: Point3d,
  dims: [number, number, number],
  previewDims: [number, number, number],
): Point3d {
  const z =
    previewDims[0] <= 1 || dims[0] <= 1
      ? 0
      : (previewVoxel.z * (dims[0] - 1)) / (previewDims[0] - 1);

  const y =
    previewDims[1] <= 1 || dims[1] <= 1
      ? 0
      : (previewVoxel.y * (dims[1] - 1)) / (previewDims[1] - 1);

  const x =
    previewDims[2] <= 1 || dims[2] <= 1
      ? 0
      : (previewVoxel.x * (dims[2] - 1)) / (previewDims[2] - 1);

  return voxelToCenteredPoint({ x, y, z }, dims);
}

function worldToVoxel(point: Point3d, dims: [number, number, number]): Point3d {
  return centeredPointToVoxel(point, dims);
}

function removeOutliers(
  points: Array<[number, number, number]>,
): Array<[number, number, number]> {
  if (points.length < 8) return points;

  let sumX = 0;
  let sumY = 0;
  let sumZ = 0;

  for (const [x, y, z] of points) {
    sumX += x;
    sumY += y;
    sumZ += z;
  }

  const meanX = sumX / points.length;
  const meanY = sumY / points.length;
  const meanZ = sumZ / points.length;

  let varX = 0;
  let varY = 0;
  let varZ = 0;

  for (const [x, y, z] of points) {
    varX += (x - meanX) ** 2;
    varY += (y - meanY) ** 2;
    varZ += (z - meanZ) ** 2;
  }

  const stdX = Math.sqrt(varX / points.length) || 1;
  const stdY = Math.sqrt(varY / points.length) || 1;
  const stdZ = Math.sqrt(varZ / points.length) || 1;

  return points.filter(([x, y, z]) => {
    const zx = (x - meanX) / stdX;
    const zy = (y - meanY) / stdY;
    const zz = (z - meanZ) / stdZ;
    const score = (zx + zy + zz) / 3;
    return score <= 2;
  });
}

function buildPointCloud(args: {
  volume: Uint8Array;
  dims: [number, number, number];
  previewDims: [number, number, number];
  threshold: number;
  downsampling: number;
  maxPoints?: number;
}): PointCloudResult {
  const {
    volume,
    dims,
    previewDims,
    threshold,
    downsampling,
    maxPoints = 14000,
  } = args;

  const [zDim, yDim, xDim] = previewDims;
  const coords: Array<[number, number, number]> = [];

  for (let z = 0; z < zDim; z += 1) {
    for (let y = 0; y < yDim; y += 1) {
      for (let x = 0; x < xDim; x += 1) {
        const value = volume[buildVolumeIndex(z, y, x, previewDims)];
        if (value >= threshold) {
          coords.push([x, y, z]);
        }
      }
    }
  }

  if (coords.length === 0) {
    return {
      positions: new Float32Array(0),
      count: 0,
    };
  }

  const minCoords: [number, number, number] = [coords[0][0], coords[0][1], coords[0][2]];
  for (const [x, y, z] of coords) {
    if (x < minCoords[0]) minCoords[0] = x;
    if (y < minCoords[1]) minCoords[1] = y;
    if (z < minCoords[2]) minCoords[2] = z;
  }

  const voxelSize = Math.max(0.01, downsampling);
  const grid = new Map<string, { sx: number; sy: number; sz: number; count: number }>();

  for (const [x, y, z] of coords) {
    const keyX = Math.floor((x - minCoords[0]) / voxelSize);
    const keyY = Math.floor((y - minCoords[1]) / voxelSize);
    const keyZ = Math.floor((z - minCoords[2]) / voxelSize);
    const key = `${keyX}:${keyY}:${keyZ}`;

    const prev = grid.get(key);
    if (prev) {
      prev.sx += x;
      prev.sy += y;
      prev.sz += z;
      prev.count += 1;
    } else {
      grid.set(key, {
        sx: x,
        sy: y,
        sz: z,
        count: 1,
      });
    }
  }

  let previewPoints: Array<[number, number, number]> = Array.from(grid.values()).map((item) => [
    item.sx / item.count,
    item.sy / item.count,
    item.sz / item.count,
  ]);

  previewPoints = removeOutliers(previewPoints);

  if (previewPoints.length > maxPoints) {
    const stride = Math.ceil(previewPoints.length / maxPoints);
    previewPoints = previewPoints.filter((_, index) => index % stride === 0);
  }

  const positions = new Float32Array(previewPoints.length * 3);

  for (let i = 0; i < previewPoints.length; i += 1) {
    const [px, py, pz] = previewPoints[i];
    const world = previewVoxelToWorld(
      { x: px, y: py, z: pz },
      dims,
      previewDims,
    );

    positions[i * 3 + 0] = world.x;
    positions[i * 3 + 1] = world.y;
    positions[i * 3 + 2] = world.z;
  }

  return {
    positions,
    count: previewPoints.length,
  };
}

function applyCameraPreset(
  camera: THREE.PerspectiveCamera,
  axis: ViewAxis,
  distance: number,
) {
  if (axis === "X") {
    camera.position.set(distance, 0, 0);
    camera.up.set(0, 1, 0);
  } else if (axis === "Y") {
    camera.position.set(0, distance, 0);
    camera.up.set(0, 0, 1);
  } else {
    camera.position.set(0, 0, distance);
    camera.up.set(0, 1, 0);
  }

  camera.lookAt(0, 0, 0);
  camera.updateProjectionMatrix();
}

function PanZoomControls({
  viewAxis,
  fitDistance,
  resetToken,
  enabled,
}: {
  viewAxis: ViewAxis;
  fitDistance: number;
  resetToken: number;
  enabled: boolean;
}) {
  const { camera, gl } = useThree();
  const controlsRef = React.useRef<ThreeOrbitControls | null>(null);

  React.useEffect(() => {
    const perspectiveCamera = camera as THREE.PerspectiveCamera;
    const controls = new ThreeOrbitControls(perspectiveCamera, gl.domElement);
    controls.enableRotate = true;
    controls.enablePan = true;
    controls.enableZoom = true;
    controls.screenSpacePanning = true;
    controls.zoomSpeed = 1.1;
    controls.panSpeed = 1.0;
    controls.target.set(0, 0, 0);
    controlsRef.current = controls;

    return () => {
      controls.dispose();
      controlsRef.current = null;
    };
  }, [camera, gl]);

  React.useEffect(() => {
    const perspectiveCamera = camera as THREE.PerspectiveCamera;
    applyCameraPreset(perspectiveCamera, viewAxis, fitDistance);
    controlsRef.current?.target.set(0, 0, 0);
    controlsRef.current?.update();
  }, [camera, viewAxis, fitDistance, resetToken]);

  React.useEffect(() => {
    if (controlsRef.current) {
      controlsRef.current.enabled = enabled;
    }
  }, [enabled]);

  React.useEffect(() => {
    let frameId = 0;

    const loop = () => {
      controlsRef.current?.update();
      frameId = requestAnimationFrame(loop);
    };

    loop();
    return () => cancelAnimationFrame(frameId);
  }, []);

  return null;
}

function PointCloud({
  positions,
}: {
  positions: Float32Array;
}) {
  const geometry = React.useMemo(() => {
    const geom = new THREE.BufferGeometry();
    geom.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    return geom;
  }, [positions]);

  React.useEffect(() => {
    return () => {
      geometry.dispose();
    };
  }, [geometry]);

  return (
    <points geometry={geometry}>
      <pointsMaterial
        color="#8f70a0"
        size={3}
        sizeAttenuation={false}
        transparent
        opacity={0.3}
        depthWrite={false}
      />
    </points>
  );
}

function DraggablePoint({
  point,
  radius,
  viewAxis,
  dragEnabled,
  onPointChange,
}: {
  point: Point3d;
  radius: number;
  viewAxis: ViewAxis;
  dragEnabled: boolean;
  onPointChange: (point: Point3d) => void;
}) {
  const [dragging, setDragging] = React.useState(false);

  const plane = React.useMemo(() => {
    if (viewAxis === "X") {
      return new THREE.Plane(new THREE.Vector3(1, 0, 0), -point.x);
    }
    if (viewAxis === "Y") {
      return new THREE.Plane(new THREE.Vector3(0, 1, 0), -point.y);
    }
    return new THREE.Plane(new THREE.Vector3(0, 0, 1), -point.z);
  }, [viewAxis, point.x, point.y, point.z]);

  const updateFromEvent = React.useCallback(
    (event: ThreeEvent<PointerEvent>) => {
      const hit = new THREE.Vector3();
      if (!event.ray.intersectPlane(plane, hit)) return;

      const nextPoint = {
        x: viewAxis === "X" ? point.x : hit.x,
        y: viewAxis === "Y" ? point.y : hit.y,
        z: viewAxis === "Z" ? point.z : hit.z,
      };

      onPointChange(nextPoint);
    },
    [onPointChange, plane, point.x, point.y, point.z, viewAxis],
  );

  return (
    <group>
      {radius > 0 && (
        <mesh position={[point.x, point.y, point.z]}>
          <sphereGeometry args={[radius, 48, 48]} />
          <meshBasicMaterial color="#ff4b4b" transparent opacity={0.1} />
        </mesh>
      )}

      <mesh
        position={[point.x, point.y, point.z]}
        onPointerDown={(event) => {
          if (!dragEnabled) return;
          event.stopPropagation();
          setDragging(true);
          updateFromEvent(event);
        }}
        onPointerMove={(event) => {
          if (!dragEnabled || !dragging) return;
          event.stopPropagation();
          updateFromEvent(event);
        }}
        onPointerUp={(event) => {
          if (!dragEnabled) return;
          event.stopPropagation();
          setDragging(false);
        }}
        onPointerLeave={() => {
          setDragging(false);
        }}
      >
        <sphereGeometry args={[2.3, 18, 18]} />
        <meshBasicMaterial color="#00d7ff" />
      </mesh>

      <lineSegments position={[point.x, point.y, point.z]}>
        <edgesGeometry args={[new THREE.SphereGeometry(2.5, 12, 12)]} />
        <lineBasicMaterial color="#111111" />
      </lineSegments>
    </group>
  );
}

function Scene({
  point,
  radius,
  positions,
  viewAxis,
  fitDistance,
  resetToken,
  controlsEnabled,
  dragEnabled,
  onPointChange,
}: {
  point: Point3d;
  radius: number;
  positions: Float32Array;
  viewAxis: ViewAxis;
  fitDistance: number;
  resetToken: number;
  controlsEnabled: boolean;
  dragEnabled: boolean;
  onPointChange: (point: Point3d) => void;
}) {
  return (
    <>
      <color attach="background" args={["#ffffff"]} />
      <ambientLight intensity={1.0} />
      <PanZoomControls
        viewAxis={viewAxis}
        fitDistance={fitDistance}
        resetToken={resetToken}
        enabled={controlsEnabled}
      />
      <PointCloud positions={positions} />
      <DraggablePoint
        point={point}
        radius={radius}
        viewAxis={viewAxis}
        dragEnabled={dragEnabled}
        onPointChange={onPointChange}
      />
    </>
  );
}

function SliderRow({
  label,
  value,
  min,
  max,
  step,
  onChange,
  formatter,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
  formatter?: (value: number) => string;
}) {
  return (
    <Box
      sx={{
        display: "grid",
        gridTemplateColumns: "110px minmax(0, 1fr) 92px",
        alignItems: "center",
        gap: 1.25,
      }}
    >
      <Typography variant="body2" sx={{ color: "#111827" }}>
        {label}
      </Typography>

      <Slider
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(_, nextValue) => onChange(asNumber(nextValue))}
        sx={{
          color: "#0b0b8f",
          "& .MuiSlider-thumb": {
            width: 16,
            height: 16,
            backgroundColor: "#ffffff",
            border: "1px solid rgba(15,23,42,0.18)",
          },
          "& .MuiSlider-track": {
            border: "none",
          },
          "& .MuiSlider-rail": {
            opacity: 1,
            backgroundColor: "#d1d5db",
          },
        }}
      />

      <Typography
        variant="body2"
        sx={{
          color: "#111827",
          textAlign: "right",
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {formatter ? formatter(value) : String(roundTo(value, 2))}
      </Typography>
    </Box>
  );
}

export default function PointInVolumeWizardDialog({
  open,
  title,
  message,
  dims,
  previewDims,
  previewValues,
  point,
  pointVoxel,
  onClose,
  onConfirm,
  onPointChange,
  onPointVoxelChange,
}: PointInVolumeWizardDialogProps) {
  const volume = React.useMemo(
    () => normalizePreviewValues(previewValues, previewDims),
    [previewValues, previewDims],
  );

  const valueRange = React.useMemo(() => {
    let min = 255;
    let max = 0;

    for (let i = 0; i < volume.length; i += 1) {
      const v = volume[i];
      if (v < min) min = v;
      if (v > max) max = v;
    }

    if (volume.length === 0) {
      min = 0;
      max = 1;
    }

    return {
      min,
      max,
      range: Math.max(1, max - min),
    };
  }, [volume]);

  const maxDim = Math.max(dims[0], dims[1], dims[2], 1);
  const fitDistance = Math.max(450, maxDim * 2.5);

  const [viewAxis, setViewAxis] = React.useState<ViewAxis>("Z");
  const [downsampling, setDownsampling] = React.useState(5.01);
  const [radius, setRadius] = React.useState(0);
  const [threshold, setThreshold] = React.useState(0.5 * valueRange.range);
  const [resetToken, setResetToken] = React.useState(0);
  const [shiftPressed, setShiftPressed] = React.useState(false);

  React.useEffect(() => {
    if (!open) return;

    setViewAxis("Z");
    setDownsampling(5.01);
    setRadius(0);
    setThreshold(0.5 * valueRange.range);
    setResetToken((prev) => prev + 1);
  }, [open, valueRange.range]);

  React.useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Shift") {
        setShiftPressed(true);
      }
    };

    const onKeyUp = (event: KeyboardEvent) => {
      if (event.key === "Shift") {
        setShiftPressed(false);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);

    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, []);

  const pointCloud = React.useMemo(
    () =>
      buildPointCloud({
        volume,
        dims,
        previewDims,
        threshold,
        downsampling,
      }),
    [volume, dims, previewDims, threshold, downsampling],
  );

  const handlePointChange = React.useCallback(
    (nextPoint: Point3d) => {
      const normalizedPoint = {
        x: roundTo(nextPoint.x, 2),
        y: roundTo(nextPoint.y, 2),
        z: roundTo(nextPoint.z, 2),
      };

      onPointChange(normalizedPoint);

      if (onPointVoxelChange) {
        const nextVoxel = worldToVoxel(normalizedPoint, dims);
        onPointVoxelChange({
          x: roundTo(nextVoxel.x, 2),
          y: roundTo(nextVoxel.y, 2),
          z: roundTo(nextVoxel.z, 2),
        });
      }
    },
    [dims, onPointChange, onPointVoxelChange],
  );

  const currentVoxel = React.useMemo(
    () => pointVoxel ?? worldToVoxel(point, dims),
    [point, pointVoxel, dims],
  );

  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth="xl"
      fullWidth
      PaperProps={{
        sx: {
          ...wizardDialogPaperSx,
          maxHeight: "92vh",
        },
      }}
    >
      <DialogTitle sx={wizardDialogTitleSx}>
        <Box
          sx={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 2,
          }}
        >
          <Typography
            component="span"
            sx={{
              fontSize: "1rem",
              fontWeight: 700,
              color: "inherit",
            }}
          >
            {title || "Wizard"}
          </Typography>

          <IconButton
            onClick={onClose}
            size="small"
            sx={{
              color: "#e5e7eb",
              border: "1px solid rgba(255,255,255,0.14)",
              backgroundColor: "rgba(255,255,255,0.06)",
              "&:hover": {
                backgroundColor: "rgba(255,255,255,0.12)",
                borderColor: "rgba(255,255,255,0.22)",
              },
            }}
          >
            <CloseIcon fontSize="small" />
          </IconButton>
        </Box>
      </DialogTitle>

      <DialogContent
        dividers
        sx={{
          ...wizardDialogContentSx,
          display: "flex",
          flexDirection: "column",
          gap: 2,
        }}
      >
        {hasText(message) && (
          <Typography
            variant="body2"
            sx={{
              color: "text.secondary",
              lineHeight: 1.6,
            }}
          >
            {message}
          </Typography>
        )}

        <Box
          sx={{
            borderRadius: "18px",
            border: "1px solid rgba(15,23,42,0.10)",
            backgroundColor: "#ffffff",
            overflow: "hidden",
            display: "grid",
            gridTemplateRows: "auto 430px auto auto",
          }}
        >
          <Box
            sx={{
              px: 1.5,
              py: 1,
              borderBottom: "1px solid rgba(15,23,42,0.08)",
              backgroundColor: "rgba(248,250,252,0.9)",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 2,
              flexWrap: "wrap",
            }}
          >
            <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
              Volume point picker
            </Typography>

            <Stack direction="row" spacing={1} alignItems="center">
              <Typography variant="caption" sx={{ color: "text.secondary" }}>
                Drag to rotate. Hold Shift and drag the cyan point to move the center.
              </Typography>
              <Button
                size="small"
                variant="outlined"
                onClick={() => setResetToken((prev) => prev + 1)}
                sx={{
                  textTransform: "none",
                  borderRadius: "10px",
                  fontWeight: 600,
                }}
              >
                Reset view
              </Button>
            </Stack>
          </Box>

          <Box
            sx={{
              position: "relative",
              height: "100%",
              minHeight: 0,
              backgroundColor: "#ffffff",
            }}
          >
            <Box
              sx={{
                position: "absolute",
                left: 24,
                top: "50%",
                transform: "translateY(-50%)",
                zIndex: 10,
                width: 86,
                border: "1px solid rgba(15,23,42,0.45)",
                backgroundColor: "rgba(125,125,125,0.78)",
                px: 1,
                py: 1.25,
              }}
            >
              <RadioGroup
                value={viewAxis}
                onChange={(event) => {
                  setViewAxis(event.target.value as ViewAxis);
                  setResetToken((prev) => prev + 1);
                }}
              >
                <FormControlLabel
                  value="X"
                  control={
                    <Radio
                      size="small"
                      sx={{
                        color: "#111827",
                        "&.Mui-checked": {
                          color: "#0b0b8f",
                        },
                      }}
                    />
                  }
                  label="X"
                  sx={{ my: -0.25 }}
                />
                <FormControlLabel
                  value="Y"
                  control={
                    <Radio
                      size="small"
                      sx={{
                        color: "#111827",
                        "&.Mui-checked": {
                          color: "#0b0b8f",
                        },
                      }}
                    />
                  }
                  label="Y"
                  sx={{ my: -0.25 }}
                />
                <FormControlLabel
                  value="Z"
                  control={
                    <Radio
                      size="small"
                      sx={{
                        color: "#111827",
                        "&.Mui-checked": {
                          color: "#0b0b8f",
                        },
                      }}
                    />
                  }
                  label="Z"
                  sx={{ my: -0.25 }}
                />
              </RadioGroup>
            </Box>

            <Canvas
              camera={{ fov: 30, near: 0.1, far: 5000, position: [0, 0, fitDistance] }}
              gl={{ antialias: true }}
            >
              <Scene
                point={point}
                radius={radius}
                positions={pointCloud.positions}
                viewAxis={viewAxis}
                fitDistance={fitDistance}
                resetToken={resetToken}
                controlsEnabled={!shiftPressed}
                dragEnabled={shiftPressed}
                onPointChange={handlePointChange}
              />
            </Canvas>
          </Box>

          <Box
            sx={{
              px: 2.5,
              py: 1.5,
              borderTop: "1px solid rgba(15,23,42,0.08)",
              backgroundColor: "#ffffff",
              display: "flex",
              flexDirection: "column",
              gap: 1.25,
            }}
          >
            <SliderRow
              label="Downsampling"
              value={downsampling}
              min={0.01}
              max={10}
              step={0.2}
              onChange={setDownsampling}
              formatter={(value) => roundTo(value, 2).toFixed(2)}
            />

            <SliderRow
              label="Radius"
              value={radius}
              min={0}
              max={maxDim}
              step={1}
              onChange={setRadius}
              formatter={(value) => String(Math.round(value))}
            />

            <SliderRow
              label="Threshold"
              value={threshold}
              min={valueRange.min}
              max={valueRange.max}
              step={Math.max(1, 0.01 * valueRange.range)}
              onChange={setThreshold}
              formatter={(value) => roundTo(value, 2).toFixed(2)}
            />
          </Box>

          <Box
            sx={{
              px: 2.5,
              py: 1.25,
              borderTop: "1px solid rgba(15,23,42,0.08)",
              backgroundColor: "#f8fafc",
              display: "grid",
              gridTemplateColumns: {
                xs: "1fr",
                md: "repeat(3, minmax(0, 1fr))",
              },
              gap: 1.5,
            }}
          >
            <Typography
              variant="caption"
              sx={{ color: "text.secondary", fontVariantNumeric: "tabular-nums" }}
            >
              Point: x={roundTo(point.x, 2)} · y={roundTo(point.y, 2)} · z={roundTo(point.z, 2)}
            </Typography>

            <Typography
              variant="caption"
              sx={{ color: "text.secondary", fontVariantNumeric: "tabular-nums" }}
            >
              Voxel: x={roundTo(currentVoxel.x, 1)} · y={roundTo(currentVoxel.y, 1)} · z={roundTo(currentVoxel.z, 1)}
            </Typography>

            <Typography
              variant="caption"
              sx={{ color: "text.secondary", textAlign: { xs: "left", md: "right" } }}
            >
              Points visible: {pointCloud.count}
            </Typography>
          </Box>
        </Box>
      </DialogContent>

      <DialogActions sx={wizardDialogActionsSx}>
        <Button
          onClick={onClose}
          variant="outlined"
          sx={{
            textTransform: "none",
            borderRadius: "12px",
            px: 2,
            fontWeight: 600,
          }}
        >
          Cancel
        </Button>

        <Button
          variant="contained"
          onClick={onConfirm}
          sx={{
            textTransform: "none",
            borderRadius: "12px",
            px: 2.25,
            fontWeight: 700,
          }}
        >
          Select
        </Button>
      </DialogActions>
    </Dialog>
  );
}