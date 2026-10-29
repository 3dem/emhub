// src/services/ProjectService.ts



export interface loadWorkflowPayload {
  workflowId: string;
}

export type AuthenticatedRequestOptions = {
  signal?: AbortSignal;
  cache?: RequestCache;
};

export type SystemVersionInfo = {
  apiVersion?: string | null;
  webVersion?: string | null;
  currentVersion?: string | null;
  lastUpdateVersion?: string | null;
  lastUpdateAt?: string | null;
  updateBaseUrl?: string | null;
  serveWeb?: boolean;
  webDistPath?: string | null;
};

export type SystemUpdateCheck = SystemVersionInfo & {
  checkOk: boolean;
  error?: string | null;
  manifestUrl?: string | null;
  latestVersion?: string | null;
  updateAvailable: boolean;
  apiArchive?: string | null;
  webArchive?: string | null;
  apiArchiveUrl?: string | null;
  webArchiveUrl?: string | null;
  updateCommand?: string | null;
};

export type ProjectThumbnailOutputItem = {
  outputName?: string | null;
  outputClassName?: string | null;
  exists?: boolean;
  thumbnailUrl?: string | null;
  thumbnailDataUrl?: string | null;
  thumbnailRebuildUrl?: string | null;
};

export type ProjectThumbnailGroup = {
  protocolId: Id;
  label?: string;
  status?: string;
  outputs: ProjectThumbnailOutputItem[];
};

export type ProjectThumbnailSourceOptions = {
  sourceUrl?: string | null;
};

export type ProjectThumbnailItemsOptions =
  ProjectThumbnailSourceOptions &
  AuthenticatedRequestOptions & {
    size?: number;
    maxProtocols?: number;
    maxOutputsPerProtocol?: number;
    inlineImages?: boolean;
  };

export type ProjectThumbnailObjectUrlOptions =
  ProjectThumbnailSourceOptions &
  AuthenticatedRequestOptions & {
    size?: number;
  };

export type ProtocolOutputThumbnailRequestItem = {
  protocolId: Id;
  outputName: string;
};

export type ProtocolOutputThumbnailItem = {
  protocolId: Id;
  outputName: string;
  outputClassName?: string | null;
  exists?: boolean;
  cached?: boolean;
  thumbnailUrl?: string | null;
  thumbnailDataUrl?: string | null;
  error?: string | null;
};

export type ProtocolOutputThumbnailsResponse = {
  projectId: Id;
  size: number;
  items: ProtocolOutputThumbnailItem[];
};

export type ProtocolOutputThumbnailsOptions =
  AuthenticatedRequestOptions & {
    size?: number;
    inlineImages?: boolean;
    outputs: ProtocolOutputThumbnailRequestItem[];
  };


/** Protocol steps. */
export type ProtocolStep = {
  index: number;
  name: string;
  status: string;
  prerequisites?: number[];
  args?: unknown;
  initTime?: string | null;
  endTime?: string | null;
  elapsedSeconds?: number | null;
  error?: string | null;
  interactive?: boolean;
  needsGpu?: boolean;
  event?: string | null;
  updatedAt?: string | null;
};

export type ProtocolStepStatus = "new" | "finished";

export type ProtocolRuntimeSummary = {
  protocolId: string;
  status: string;

  cpuTimeSeconds: number;
  elapsedTimeSeconds: number;

  elapsedSessionId?:
  | string
  | null;

  stepsDone: number;
  numberOfSteps: number;
  outputs?: unknown[];
};

/** Common ID type to accept either string or number seamlessly. */
export type Id = string | number | null | undefined;

/** Payload for creating a project. */
export type ProjectPayload = { name: string; description?: string };

/** Payload for importing a project. */
export type ImportProjectPayload = {
  projectLocation: string;
  projectName?: string;
};

/** Volume list item used by Analyze Results. */
export type VolumeListItem = {
  /** Unique id for the volume (index, db id, or filename). */
  id: string;
  /** Human-friendly label to display in the left panel list. */
  name: string;
};

/** Minimal volume metadata for the slice viewer. */
export type VolumeInfo = {
  /** Total number of slices along the chosen axis (UI uses 1-based index). */
  slices: number;
  /** Optional raw shape [Z, Y, X] or [depth, height, width]. */
  shape?: [number, number, number];
  /** Optional voxel size tuple. Units depend on backend (e.g., Å/px or nm/px). */
  voxelSize?: [number, number, number];
  /** Optional dtype string (e.g., "float32", "uint16"). */
  dtype?: string;
};

/** Extra options when building the slice image URL. */
export type VolumeSliceOptions = {
  axis?: "x" | "y" | "z";
  cmap?: string;
  normalize?: "minmax" | "zscore" | "none";
  windowMin?: number;
  windowMax?: number;
  scale?: number;
  inline?: boolean;
  signal?: AbortSignal;
  format?: "png" | "webp" | "jpeg";
  thumb?: number;
  fast?: boolean;
  quality?: number;
};

export type VolumeSliceObjectUrl = {
  url: string;
  revoke: () => void;
};

/** Histogram data for a volume, already aggregated in bins. */
export type VolumeHistogram = {
  // Normalized fields for the viewer
  bins?: number[];
  counts?: number[];

  // Raw backend variants (keep them optional)
  binEdges?: number[];
  bin_edges?: number[];
  values?: number[];

  range?: [number, number];
  totalVoxels?: number;
};

/** Optional parameters to control histogram generation in the backend. */
export type VolumeHistogramOptions = {
  /** Desired number of bins. Backend may clamp this value. */
  bins?: number;
  /** Optional minimum of the value range. */
  rangeMin?: number;
  /** Optional maximum of the value range. */
  rangeMax?: number;
};

export type VolumeData3dOptions = {
  /** Maximum size for the longest dimension after downsampling. */
  maxDim?: number; // default backend: 160
  /** Downsampling method. */
  method?: "binning" | "stride" | "none"; // default backend: "binning"
  /** Optional abort signal to cancel the request. */
  signal?: AbortSignal;
};

/**
 * Normalized 3D volume payload for Plotly.
 * Backend is expected to return a downsampled cube and metadata.
 * `data` is a flat array; `order` tells how to reshape.
 */
export type VolumeData3d = {
  id?: string | number;
  name?: string;

  /** Dimensions in (x, y, z). */
  dims: [number, number, number];

  /** Flattened voxel values, X varying fastest for order="zyx". */
  values: number[] | Float32Array;

  /** Legacy compatibility payload. */
  data?: number[];

  order?: "zyx" | "xyz";
  voxelSize?: [number, number, number];

  min?: number;
  max?: number;
  mean?: number;
  std?: number;
};


// ─────────────────────────────────────────────────────────────────────────────
// Coordinates3D + linked tomograms (SetOfCoordinates3D support)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Single 3D coordinate in tomogram space.
 * Extra fields (label, score, etc.) can be attached by the backend.
 */
export type Coordinates3dPoint = {
  x: number;
  y: number;
  z: number;
  id?: number | string;
  label?: number | string;
  score?: number;
  [key: string]: unknown;
  matrix?: any | [];
};

/**
 * One tomogram entry associated with a SetOfCoordinates3D.
 * It can optionally reference the tomogram volume output so the UI can
 * jump into a slice/3D viewer for the same volume.
 */
export type Coordinates3dTomogram = {
  /** Tomogram identifier (index, db id, etc.). */
  id: Id;
  /** Human-friendly label for the tomogram. */
  label?: string;

  /** Optional output name where the tomogram volume lives. */
  tomogramOutputName?: string;
  /** Optional volume id within the tomogram output. */
  tomogramVolumeId?: Id;

  /** Optional tomogram dimensions [X, Y, Z]. */
  dims?: [number, number, number];
  /** Optional voxel size [sx, sy, sz]. Units depend on backend. */
  voxelSize?: [number, number, number];

  /** Optional count of coordinates for quick overview. */
  count?: number;
};

/**
 * Coordinates payload for a single tomogram.
 */
export type Coordinates3dTomogramPoints = {
  tomoId: Id;
  /** Optional tomogram dimensions [X, Y, Z]. */
  dims?: [number, number, number];
  /** Optional voxel size [sx, sy, sz]. */
  voxelSize?: [number, number, number];
  /** List of coordinates in tomogram space. */
  coords: Coordinates3dPoint[];
};

/**
 * Payload to create a new SetOfCoordinates3D output from an edited list of points.
 * The backend should interpret `coords` as a full replacement for the selected tomogram.
 */
export type CreateCoords3dOutputFromPointsPayload = {
  /** Name for the newly created output. */
  newOutputName: string;

  /** Tomogram identifier within the source SetOfCoordinates3D. */
  tomoId: Id;

  /**
   * Full coordinates list for this tomogram.
   * Each item is expected to keep x/y/z and may include score/radius/classId/id/tomoId.
   */
  coords: Array<
    Coordinates3dPoint & {
      /** Optional class id used by the UI. */
      classId?: string | number | null;
      /** Optional radius used by the UI. */
      radius?: number;
      /** Optional tomo id per point (kept for round-tripping). */
      tomoId?: Id;
    }
  >;

  /** Optional tomogram dimensions [X, Y, Z] for backend validation. */
  dims?: [number, number, number];

  /** Optional voxel size [sx, sy, sz] for backend bookkeeping. */
  voxelSize?: [number, number, number];
};

export type CreateCoords3dOutputFromPointsResult = {
  success: boolean;
  outputName: string;
  message?: string;
  data?: unknown;
};

export type CreateCoords3dOutputFromPointsOptions = {
  signal?: AbortSignal;
};

// ─────────────────────────────────────────────────────────────────────────────
// Metadata table basic types (en paralelo a los de api/projects.ts)
// ─────────────────────────────────────────────────────────────────────────────

export type MetadataRendererType = "int" | "float" | "bool" | "matrix" | "image" | "str";

export interface MetadataColumn {
  name: string;
  alias: string;
  index: number;
  sortable: boolean;
  visible: boolean;
  rendererType: MetadataRendererType;
  decimals: number | null;
  hasTransformation: boolean;
}

export interface MetadataTableInfo {
  name: string;
  alias: string;
  rowCount: number;
  hasColumnId: boolean;
}

export interface MetadataTableSchema {
  name: string;
  alias: string;
  hasColumnId: boolean;
  columns: MetadataColumn[];

  /** Optional actions advertised by the backend for this table. */
  actions?: string[];

  /** Optional column names advertised by the backend as gallery metadata. */
  additionalInfoColumns?: string[];
}

export type MetadataTableActionPayload = {
  /** Action label as provided by schema.actions */
  action: string;

  /** Subset name or action-specific label */
  subsetName?: string;

  /** Selected row ids */
  ids: Array<number | string>;
};

export type MetadataTableActionResult = {
  success: boolean;
  message?: string;

  /** Optional backend payload for caller-specific follow-ups */
  data?: unknown;
};

export type MetadataCell =
  | number
  | string
  | boolean
  | { kind: "image"; path: string }
  | { kind: "matrix"; value: any };

export interface MetadataRow {
  id: number;
  values: MetadataCell[];
}

export interface MetadataPage {
  pageNumber: number;
  pageSize: number;
  totalRows: number;
  rows: MetadataRow[];
}
// ─────────────────────────────────────────────────────────────────────────────
// Analyze Results (FSCs)
// ─────────────────────────────────────────────────────────────────────────────
export type FscPoint = {
  x: number;
  y: number;
  label?: string;
  xKind?: "frequency" | "resolution";
};


// ─────────────────────────────────────────────────────────────────────────────
// Analyze Results (Tilt series)
// ─────────────────────────────────────────────────────────────────────────────

/** Basic item for a tilt series in a SetOfTiltSeries output. */
export type TiltSeriesListItem = {
  /** Tilt series identifier (index, db id, etc.). */
  id: Id;
  /** Human-friendly label to display in the list. */
  label: string;
  /** Optional number of tilt images in this series. */
  nTilts?: number;
  /** Optional image dimensions [width, height] in pixels. */
  dims?: [number, number];
  /** Optional pixel size (for example Å/px). */
  pixelSize?: number;
};

/** Extra options when requesting a single tilt image. */
export type TiltImageOptions = {
  /** Target size in pixels for the longest side. */
  size?: number;
  /** Output format for the rendered image. */
  format?: "png" | "webp" | "jpeg";
  /** Whether to apply alignment or contrast corrections in backend. */
  applyTransform?: boolean;
  /** AbortSignal to cancel in-flight HTTP requests. */
  signal?: AbortSignal;
};

export type TiltSeriesBatchPreviewItem = {
  index: number;
  contentType?: string | null;
  dataUrl: string;
  cache?: string | null;
};

export type TiltSeriesBatchPreviewResult = {
  tiltSeriesId: string;
  size: number;
  fmt: string;
  applyTransform: boolean;
  items: TiltSeriesBatchPreviewItem[];
  errors?: Array<{
    index: number;
    error: string;
  }>;
};

export type TiltSeriesBatchPreviewOptions = {
  indices: number[];
  size?: number;
  format?: "png" | "webp" | "jpeg";
  applyTransform?: boolean;
  signal?: AbortSignal;
};

export type TiltExclusionsPayload = Record<
  string,
  {
    excluded: boolean;
    tiltimages: number[];
  }
>;

export type CTFTomoExclusionsPayload = TiltExclusionsPayload;

// Shared object-url result type used by image viewers
export type ObjectUrlResult = {
  url: string;
  revoke: () => void;
};

// Generic options for fetching 2D image slices / previews from the API
export type FetchImageSliceOptions = {
  // Common sampling / slicing options
  index?: number; // slice index along the chosen axis
  axis?: "x" | "y" | "z";

  // Color / normalization
  cmap?: string;
  colormap?: string;
  format?: "png" | "webp" | "jpeg";
  fmt?: string;
  normalize?: string; // e.g. "minmax", "zscore", etc.

  // Geometry / scaling
  scale?: number;
  thumb?: number;
  fast?: boolean;
  quality?: number;

  // Tilt / metadata specific
  size?: number;
  applyTransform?: boolean;

  // Abort support for fetch
  signal?: AbortSignal;
};

export type VolumeSurfaceMethod =
  | "binning"
  | "stride"
  | "linear"
  | "fourier"
  | "none";

export interface VolumeSurfaceMesh {
  kind: "surfaceMesh";
  level: number;
  rangeMin?: number;
  rangeMax?: number;
  dims: [number, number, number];
  sourceDims?: [number, number, number];
  order: "zyx" | "xyz";
  vertexCount: number;
  triangleCount: number;
  marchingCubesStep?: number;
  minComponentTriangles?: number;
  smoothingIterations?: number;
  removedComponents?: number;
  vertices: number[];
  normals: number[];
  indices: number[];
  values?: number[];
  center?: number[];
  scale?: number;
  maxDim?: number;
  method?: VolumeSurfaceMethod;
  volumeId?: string;
  outputName?: string;
}

export interface VolumeSurfaceMeshOptions {
  level?: number | null;
  maxDim?: number;
  method?: VolumeSurfaceMethod;
  maxTriangles?: number;
  minComponentTriangles?: number;
  smoothingIterations?: number;
  signal?: AbortSignal;
}

// ─────────────────────────────────────────────────────────────────────────────
// Integrated table viewer
// ─────────────────────────────────────────────────────────────────────────────

export type TableViewerCell =
  | string
  | number
  | boolean
  | null
  | undefined;

export type TableViewerAction = {
  id: string;
  label: string;
  /** Named icon ("tilt-series", "tomogram"): drawn as an icon button with the
   * label as tooltip, never used as the cell's link; unknown names show the label. */
  icon?: string;
  disabled?: boolean;
};

export type TableViewerEditAction = {
  id: string;
  label: string;
  icon?: string;
  disabled?: boolean;
  requiresChanges?: boolean;
};

export type TableViewerEdit = {
  rowId: string | number;
  columnId: string;
  field: string;
  value: TableViewerCell;

  parentRowId?: string | number;
  childrenId?: string;

  rowData?: Record<string, unknown>;
};

export type TableViewerEditActionRequest = {
  actionId: string;
  edits: TableViewerEdit[];
};

export type TableViewerEditActionResult = {
  success: boolean;
  message?: string;
  clearEdits?: boolean;
  // The workflow changed (e.g. a job was launched), refresh the project page
  refreshProject?: boolean;
  data?: unknown;
};

export type TableViewerActionTarget = {
  protocolId?: NonNullable<Id>;
  outputName?: string;
  pointerClass?: string;
};

export type TableViewerActionContext = {
  target?: TableViewerActionTarget;
  data?: Record<string, unknown>;
};

export type TableViewerRowChildren = {
  id: string;
  label: string;
  count?: number;
  readOnly?: boolean;
};

export type TableViewerCellEdit = {
  type: "boolean";
  field: string;
  disabled?: boolean;

  cascadeToChildren?: {
    childrenId: string;
    columnId?: string;
  };
};

export type TableViewerCellContext =
  TableViewerActionContext & {
    defaultAction?: TableViewerAction;
    actions?: TableViewerAction[];
    edit?: TableViewerCellEdit;
    children?: TableViewerRowChildren;
  };

export type TableViewerColumn = {
  id: string;
  label: string;
  /** Ignored: the TableViewer aligns every header and cell left. */
  align?: "left" | "center" | "right";
  width?: number | string;
  sortable?: boolean;
  actions?: TableViewerAction[];
};

export type TableViewerRow = {
  id: string | number;
  cells: Record<string, TableViewerCell>;
  data?: Record<string, unknown>;

  defaultAction?: TableViewerAction;
  actions?: TableViewerAction[];

  cellContexts?: Record<
    string,
    TableViewerCellContext
  >;

  children?: TableViewerRowChildren;
};

export type TableViewerChildrenRequest = {
  rowId: string | number;
  childrenId: string;
  rowData?: Record<string, unknown>;
  cellContext?: TableViewerActionContext;
};

export type TableViewerChildrenData = {
  title?: string;
  columns: TableViewerColumn[];
  rows: TableViewerRow[];
};

export type TableViewerPage = {
  offset: number;
  limit: number;
  total: number;
};

export type TableViewerData = {
  title?: string;
  columns: TableViewerColumn[];
  rows: TableViewerRow[];

  actions?: TableViewerAction[];

  editActions?: TableViewerEditAction[];

  page?: TableViewerPage;
};

export type TableViewerContext = {
  projectId: Id;
  protocolId: Id;
  outputName: string;
  pointerClass?: string;
  tableKey?: string;
};

export type TableViewerActionRequest = {
  actionId: string;
  rowId?: string | number;
  columnId?: string;
  rowData?: Record<string, unknown>;
  cellContext?: TableViewerActionContext;
};

export type TableViewerPaneContent =
  | {
    kind: "empty";
    title?: string;
    message?: string;
  }
  | {
    kind: "coords3d";
    title?: string;
    projectId: NonNullable<Id>;
    protocolId: NonNullable<Id>;
    outputName: string;
    tomogramId?: NonNullable<Id>;
  }
  | {
    kind: "tiltSeries";
    title?: string;
    projectId: NonNullable<Id>;
    protocolId: NonNullable<Id>;
    outputName: string;
    tiltSeriesId: NonNullable<Id>;
    frameIndex?: number;
  }
  | {
    kind: "volume";
    title?: string;
    projectId: NonNullable<Id>;
    protocolId: NonNullable<Id>;
    outputName: string;
    volumeId: NonNullable<Id>;
  }
  | {
    kind: "ctfTomo";
    title?: string;
    projectId: NonNullable<Id>;
    protocolId: NonNullable<Id>;
    outputName: string;
    ctfSeriesId: NonNullable<Id>;
    viewId?: NonNullable<Id>;
  }
  | {
    kind: "text";
    title?: string;
    text: string;
  }
  | {
    kind: "html";
    title?: string;
    html: string;
  }
  | {
    kind: "iframe";
    title?: string;
    src: string;
  }
  | {
    kind: "image";
    title?: string;
    src: string;
    alt?: string;
  }
  | {
    kind: "plotly";
    title?: string;
    figure: Record<string, unknown>;
  }
  | TableViewerImageSliderContent
  | TableViewerGridContent;

/**
 * Grid of up to 4 panes (2 x 2). The layout names the slots that are used:
 *   "2x2":         topLeft, topRight, bottomLeft, bottomRight
 *   "cols":        left, right
 *   "rows":        top, bottom
 *   "span-top":    top (both columns), bottomLeft, bottomRight
 *   "span-bottom": topLeft, topRight, bottom (both columns)
 *   "span-left":   left (both rows), topRight, bottomRight
 *   "span-right":  topLeft, bottomLeft, right (both rows)
 * A missing slot is left empty. Cells take the generic kinds (text, html,
 * iframe, image, plotly, imageSlider) or "empty" (e.g. an error message).
 */
export type TableViewerGridLayout =
  | "2x2"
  | "cols"
  | "rows"
  | "span-top"
  | "span-bottom"
  | "span-left"
  | "span-right";

export type TableViewerGridSlot =
  | "topLeft"
  | "topRight"
  | "bottomLeft"
  | "bottomRight"
  | "top"
  | "bottom"
  | "left"
  | "right";

export type TableViewerGridContent = {
  kind: "grid";
  title?: string;
  layout: TableViewerGridLayout;
  /** Cell title defaults to the content title. */
  cells: Partial<Record<TableViewerGridSlot, TableViewerPaneContent>>;
};

export type TableViewerImageSliderAxis = {
  slices: Record<string, string>;
  sliderPrefix?: string;
};

export type TableViewerImageSliderContent = {
  kind: "imageSlider";
  title?: string;
  /** Single-axis payload (base64 PNG strings, without data: prefix). */
  slices?: Record<string, string>;
  sliderPrefix?: string;
  /** Added to the stack index when showing slider labels (e.g. 1 → first slice shows as 1). */
  sliceLabelOffset?: number;
  /** Multi-axis payload keyed by x/y/z. */
  axes?: Record<string, TableViewerImageSliderAxis>;
  initialSlice?: string | number;
  dimensions?: [number, number, number];
  /** Volume layout: four quadrants — Y (top-left), schematic (top-right), Z (bottom-left), X (bottom-right). */
  layout?: "volume" | "stack";
  /** Picking coordinates overlaid on the Z-axis slider. */
  coordinates?: { x: number[]; y: number[]; z: number[] };
};

export type AnalyzeViewerResolveContext = {
  projectId: Id;
  protocolId: Id;
  protocolLabel?: string;

  outputName: string;

  // Minimal identity for routing decisions
  pointerClass?: string;
  paramClass?: string;

  // Optional extra hints (do not require sending the whole outputRaw)
  value?: string;
  info?: string;
  parentId?: Id;
};

export type AnalyzeViewerResolveDecision =
  | {
    handled: false;
  }
  | {
    handled: true;
    viewer: "external";
    // Omitted when the host opened its own viewer (nothing to navigate to)
    url?: string;
    target?: "_self" | "_blank";
    kind?: "redirect" | "iframe";
    title?: string;
  }
  | {
    handled: true;
    viewer: "table";
    title?: string;
    context: TableViewerContext;
    table: TableViewerData;
  };


export type IntegratedContextStatus =
  | "available"
  | "related"
  | "derived"
  | "missing"
  | "unknown"
  | "inferred";

export type IntegratedContextLink = {
  protocolId?: Id;
  publicProtocolId?: Id;
  outputName?: string | null;
  itemId?: Id;
  label?: string | null;
  status?: IntegratedContextStatus | null;
};

export type IntegratedContextItemRelation = {
  key: string;
  label?: string | null;

  tiltSeriesId?: Id;
  ctfSeriesId?: Id;
  tomogramId?: Id;
  tomogramVolumeId?: Id;
  coordinatesTomogramId?: Id;
};

export type IntegratedAnalyzeContext = {
  root?: {
    projectId?: Id;
    protocolId?: Id;
    outputName?: string | null;
    outputClass?: string | null;
  };
  links?: {
    tiltSeries?: IntegratedContextLink | null;
    ctf?: IntegratedContextLink | null;
    tomogram?: IntegratedContextLink | null;
    coordinates3d?: IntegratedContextLink | null;
  };
  summaries?: {
    tiltSeries?: Record<string, unknown> | null;
    ctf?: Record<string, unknown> | null;
    tomogram?: Record<string, unknown> | null;
    coordinates3d?: Record<string, unknown> | null;
  };
  relations?: {
    items?: IntegratedContextItemRelation[];
  };
};

// ─────────────────────────────────────────────────────────────────────────────
// User (sharing / collaboration)
// ─────────────────────────────────────────────────────────────────────────────

export type ShareableUser = {
  id: Id;
  name: string;
  email?: string;
};


// ─────────────────────────────────────────────────────────────────────────────
// Project workflows / templates (predefined pipelines)
// ─────────────────────────────────────────────────────────────────────────────

export type WorkflowDescriptor = {
  /** Workflow identifier (index, db id, or slug). */
  id: Id;
  /** Human-friendly workflow name to display in the UI. */
  name: string;
  /** Short description explaining what this workflow does. */
  description?: string;
};


// ─────────────────────────────────────────────────────────────────────────────
// Settings
// ─────────────────────────────────────────────────────────────────────────────
/** Generic JSON settings payload (user/instance). */
export type SettingsObject = Record<string, unknown>;

export type UserSettings = {
  theme:
  | "system"
  | "light"
  | "dark";

  uiDensity:
  | "comfortable"
  | "compact";

  fontScale: number;

  language:
  | "en"
  | "es";

  timeZone: string;

  workflowViewMode:
  | "treeTb"
  | "treeLr"
  | "grid"
  | "table";

  graphMiniMapEnabled: boolean;
  graphFocusModeEnabled: boolean;

  protocolOutputThumbnailsEnabled:
  boolean;

  workflowsAutoRefreshSec: number;
};

export type UserSettingsPatch =
  Partial<UserSettings>;

export type InstanceSettings = {
  defaultQueueName: string;
  maxConcurrentRunsPerUser: number;
};


export type InstanceGpuResource = {
  index: number;
  name: string;
  memoryTotalBytes?: number | null;
};

export type InstanceResources = {
  hostAlias: string;
  hostname: string;
  fqdn: string;
  schedulerName: string;

  operatingSystem: string;
  architecture: string;
  cpuModel: string;

  physicalCores: number;
  logicalCores: number;
  ramTotalBytes: number;

  gpuCount: number;
  gpus: InstanceGpuResource[];
};

export type InstanceSettingsPatch = Partial<InstanceSettings>;

export type JobWorker = {
  name: string;
  queues: string[];
  online: boolean;
  concurrency: number;
  active: number;
  reserved: number;
};

export type ActiveProtocolJob = {
  taskId: string;
  projectId: number;
  projectName?: string | null;
  protocolId: string;
  protocolClassName?: string | null;
  runMode: string;
  celeryState?: string | null;
  step?: string | null;
  protocolStatus: string;
  worker?: string | null;
  queue?: string | null;
  workerPid?: number | null;
  protocolPid?: number | null;
  jobIds: string[];
  startedAt?: string | null;
  elapsedSeconds?: number | null;
};

export type RecentProtocolJob = {
  projectId: number;
  projectName: string;
  protocolId: string;
  protocolClassName: string;
  status: string;
  runtimePid?: number | null;
  jobIds: string[];
  elapsedTimeSeconds?: number | null;
  createdAt: string;
  updatedAt?: string | null;
};

export type JobMonitoringOverview = {
  celeryAvailable: boolean;
  celeryError?: string | null;
  workers: JobWorker[];
  activeJobs: ActiveProtocolJob[];
  recentJobs: RecentProtocolJob[];
  refreshedAt: string;
};

export type EnvironmentVariable = {
  name: string;
  value: string;
  default?: string;
  description?: string;
  source?: string;
  isDefault?: boolean;
  type?: string;
};

export type EnvironmentVariablesPatch = Record<string, string>;

/**
 * Host configuration for settings page.
 */
export type HostQueueParam = {
  variableName: string;
  value: string;
  label: string;
  help: string;
};

export type HostQueue = {
  name: string;
  params: HostQueueParam[];
};

export type HostSettings = {
  hostAlias: string;
  schedulerName: string;
  mandatory: boolean;
  parallelCommand: string;
  submitCommand: string;
  cancelCommand: string;
  checkCommand: string;
  jobDoneRegex: string;
  submitTemplate: string;
  queues: HostQueue[];
};

export type HostSettingsPatch = Partial<HostSettings>;


export type ProjectRuntimeHostQueueParam = {
  variableName: string;
  value: string;
  label: string;
  help: string;
};

export type ProjectRuntimeHostQueue = {
  name: string;
  params: ProjectRuntimeHostQueueParam[];
};

export type ProjectRuntimeHostSettings = {
  hostAlias?: string | null;
  schedulerName?: string | null;
  mandatory?: boolean;
  parallelCommand?: string | null;
  submitCommand?: string | null;
  cancelCommand?: string | null;
  checkCommand?: string | null;
  jobDoneRegex?: string | null;
  submitTemplate?: string | null;
  queues?: ProjectRuntimeHostQueue[];
};

export type ProjectRuntimeInstanceSettings = {
  defaultQueueName?: string | null;
  maxConcurrentRunsPerUser?: number;
};

export type ProjectEffectiveSettings = {
  projectId: Id;
  settings: {
    user?: Record<string, unknown> | null;
    instance?: ProjectRuntimeInstanceSettings | null;
    host?: ProjectRuntimeHostSettings | null;
  };
};

export type ProjectServiceCapabilities = {
  projectEffectiveSettings?: boolean;
};

export function hasProjectEffectiveSettingsService(
  svc: ProjectService<any, any, any>,
): svc is ProjectService<any, any, any> & {
  fetchProjectEffectiveSettings: (projectId: Id) => Promise<ProjectEffectiveSettings>;
} {
  return typeof (svc as any)?.fetchProjectEffectiveSettings === "function";
}


//-────────────────────────────────────────────────────────────────────────────
// Protocol actions payloads
//-────────────────────────────────────────────────────────────────────────────
export type RenameProtocolPayload = {
  runName: string;
  comment?: string;
};

// ─────────────────────────────────────────────────────────────────────────────
// Protocol logs (dynamic channels)
// ─────────────────────────────────────────────────────────────────────────────

export type ProtocolLogChannel = {
  id: string;
  label: string;
  order?: number;
};

export type ProtocolLogChannelMeta = {
  label?: string;
  name?: string;
  title?: string;
  order?: number;
};

export type ProtocolLogChannelsResponse =
  | ProtocolLogChannel[]
  | { channels: ProtocolLogChannel[] }
  | Record<string, ProtocolLogChannelMeta>;

export type ProtocolLogOffsets = Record<string, number>;

export type ProtocolLogChunk = {
  text: string;
  offset: number;
  done?: boolean;
};

export type ProtocolLogsChunkResponse = {
  chunks?: Record<string, ProtocolLogChunk>;
};

export type NextProtocolSuggestion = {
  protocolName: string;
  protocolClass: string;
  help?: string;
  installed?: string;
};

export type NextProtocolSuggestionsOptions = {
  signal?: AbortSignal;
};

// ─────────────────────────────────────────────────────────────────────────────
// Protocol tags (project-level tags + protocol assignments)
// ─────────────────────────────────────────────────────────────────────────────

export type ProtocolTag = {
  id: string;
  projectId?: Id;

  title: string;
  description?: string | null;
  color?: string | null;

  createdAt?: string;
  updatedAt?: string;
};

export type ProtocolTagCreatePayload = {
  title: string;
  description?: string | null;
  color?: string | null;
};

export type ProtocolTagUpdatePayload = {
  title?: string;
  description?: string | null;
  color?: string | null;
};

export type ProtocolTagIdsResult = {
  tagIds: string[];
  missingTagIds: string[];
};

// ─────────────────────────────────────────────────────────────────────────────
// UI policies (project-level)
// ─────────────────────────────────────────────────────────────────────────────

export type ContextMenuVisibilityPolicy = {
  delete: boolean;
  nextSteps: boolean;
  open: boolean,
  browse: boolean,
  continue: boolean,
  duplicate: boolean,
  copyWorkflow: boolean,
  pasteWorkflow: boolean,
  export: boolean,
  manageTags: boolean,
  rename: boolean,
  reset: boolean,
  restart: boolean,
  selectFrom: boolean,
  selectTo: boolean,
  // Collapse a subtree into a group node (shown unless false)
  collapse?: boolean,
  stop: boolean,
  upload: boolean,
};


//-────────────────────────────────────────────────────────────────────────────
// 2D Coordinates picking (for CTF, particle picking, etc.)
//-────────────────────────────────────────────────────────────────────────────
export type Coords2dMicrograph = {
  id: Id;
  index: number;
  fileName: string;
  label?: string;
  particles: number;
  updated?: boolean;
  width?: number | null;
  height?: number | null;
  thumbnailUrl?: string | null;
};

export type Coords2dPoint = {
  id: Id;
  x: number;
  y: number;
  micId: Id;
  score?: number | null;
  classLabel?: string | null;
};

export type Coords2dMicrographsResult = {
  micrographs: Coords2dMicrograph[];
  totalMicrographs: number;
  totalPicks: number;
  boxSize?: number | null;
};

export type CreateCoords2dOutputPoint = {
  id?: Id;
  micId?: Id;
  x: number;
  y: number;
};

export type CreateCoords2dOutputMicrograph = {
  id: Id;
  coordinates: CreateCoords2dOutputPoint[];
};

export type CreateCoords2dOutputPayload = {
  boxSize?: number | null;
  outputName?: string | null;
  micrographs: CreateCoords2dOutputMicrograph[];
};

export type CreateCoords2dOutputResult = {
  success: boolean;
  outputName: string;
  totalCoordinates?: number;
  message?: string;
};

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────
// Wizards support (protocols that can launch a multi-step form instead of the regular parameter form)
// ─────────────────────────────────────────────────────────────────────────────────────────────────────────

export type ExecuteProtocolWizardInputField = {
  name: string;
  label?: string;
  kind: "number" | "text" | "select";
  value?: string | number | null;
  min?: number;
  max?: number;
  step?: number;
  options?: Array<{ value: string; label: string }>;
};

export type ExecuteProtocolWizardInputSchema =
  | {
    type: "select";
    paramName: string;
    title?: string;
    options: Array<{ value: string; label: string }>;
  }
  | {
    type: "mask_radius";
    paramName: string;
    title?: string;
    fields: Array<{
      name: string;
      label: string;
      kind: "number";
      value: number;
      min?: number;
      max?: number;
      step?: number;
    }>;
  }
  | {
    type: "mask_radii";
    paramName: string;
    title?: string;
    fields: Array<{
      name: string;
      label: string;
      kind: "number";
      value: number;
      min?: number;
      max?: number;
      step?: number;
    }>;
  }
  | {
    type: "ctf_preview";
    paramName: string;
    title?: string;
    fields: Array<{
      name: string;
      label: string;
      kind: "number";
      value: number;
      min?: number;
      max?: number;
      step?: number;
    }>;
  }
  | {
    type: "downsample_preview";
    paramName: string;
    title?: string;
    fields: Array<{
      name: string;
      label: string;
      kind: "number";
      value: number;
      min?: number;
      max?: number;
      step?: number;
    }>;
  }
  | {
    type: "filter_preview";
    paramName: string;
    title?: string;
    fields: Array<{
      name: string;
      label: string;
      kind: "number";
      value: number;
      min?: number;
      max?: number;
      step?: number;
    }>;
  }
  | {
    type: "gaussian_preview";
    paramName: string;
    title?: string;
    fields: Array<{
      name: string;
      label: string;
      kind: "number";
      value: number;
      min?: number;
      max?: number;
      step?: number;
    }>;
  }
  | {
    type: "point_in_volume";
    paramName: string;
    title?: string;
    fields: [];
  };

export type ExecuteProtocolWizardPreview = {
  imageUrl?: string | null;
  width?: number | null;
  height?: number | null;
};

export type ExecuteProtocolWizardViewerItem = {
  id: string;
  label: string;
  index: number;
};

export type ExecuteProtocolWizardViewerState = {
  items: ExecuteProtocolWizardViewerItem[];
  selectedIndex: number;

  radius?: number;
  radiusMin?: number | null;
  radiusMax?: number | null;
  radiusStep?: number | null;
  radiusAngstrom?: number | null;

  innerRadius?: number;
  outerRadius?: number;
  innerRadiusMin?: number | null;
  outerRadiusMin?: number | null;
  innerRadiusAngstrom?: number | null;
  outerRadiusAngstrom?: number | null;
  primaryParam?: string | null;
  secondaryParam?: string | null;

  downsample?: number | null;
  downsampleMin?: number | null;
  downsampleMax?: number | null;
  downsampleStep?: number | null;

  lowFreq?: number | null;
  lowFreqMin?: number | null;
  lowFreqMax?: number | null;

  highFreq?: number | null;
  highFreqMin?: number | null;
  highFreqMax?: number | null;

  freqStep?: number | null;
  showInAngstroms?: boolean | null;

  downsampleParam?: string | null;
  lowFreqParam?: string | null;
  highFreqParam?: string | null;

  autoDownsampling?: boolean | null;
  autoDownsampleValue?: number | null;

  samplingRate?: number | null;
  preview?: {
    imageUrl?: string | null;
    width?: number | null;
    height?: number | null;
    caption?: string | null;
    sourceWidth?: number | null;
    sourceHeight?: number | null;
  } | null;

  micrographPreview?: {
    imageUrl?: string | null;
    width?: number | null;
    height?: number | null;
    caption?: string | null;
    sourceWidth?: number | null;
    sourceHeight?: number | null;
  } | null;

  psdPreview?: {
    imageUrl?: string | null;
    width?: number | null;
    height?: number | null;
    caption?: string | null;
    sourceWidth?: number | null;
    sourceHeight?: number | null;
  } | null;

  decay?: number | null;
  decayMin?: number | null;
  decayMax?: number | null;

  freqInAngstrom?: boolean | null;
  unitLabel?: string | null;
  filterMode?: string | null;
  decayParam?: string | null;

  originalPreview?: {
    imageUrl?: string | null;
    width?: number | null;
    height?: number | null;
    caption?: string | null;
    sourceWidth?: number | null;
    sourceHeight?: number | null;
  } | null;

  filteredPreview?: {
    imageUrl?: string | null;
    width?: number | null;
    height?: number | null;
    caption?: string | null;
    sourceWidth?: number | null;
    sourceHeight?: number | null;
  } | null;
  point?: {
    x: number;
    y: number;
    z: number;
  } | null;

  pointVoxel?: {
    x: number;
    y: number;
    z: number;
  } | null;

  dims?: [number, number, number] | number[];
  previewDims?: [number, number, number] | number[];
  previewValues?: number[];
  axisOrder?: string[];

  bounds?: {
    xMin: number;
    xMax: number;
    yMin: number;
    yMax: number;
    zMin: number;
    zMax: number;
  } | null;

};

export type ExecuteProtocolWizardPayload = {
  protocolId?: string | number | null;
  protocolClassName: string;
  paramName: string;
  wizardId: string;
  formValues: Record<string, any>;
  wizardInputs?: Record<string, any>;
};

export type ExecuteProtocolWizardResult = {
  success: boolean;
  wizardId: string;
  kind: string;
  paramUpdates: Record<string, any>;
  message?: string | null;

  availableValues?: Array<string | { value: string; label: string }> | null;

  requiresUserInput?: boolean;
  inputSchema?: ExecuteProtocolWizardInputSchema | null;

  preview?: {
    imageUrl?: string | null;
    width?: number | null;
    height?: number | null;
  } | null;

  viewerState?: ExecuteProtocolWizardViewerState | null;
};


//─────────────────────────────────────────────────────────────────────────────
// External viewers support (e.g., Imod, ChimeraX, etc.) — launched from 
// protocol actions or output previews
//─────────────────────────────────────────────────────────────────────────────

export type ExternalViewerDescriptor = {
  id: string;
  label: string;
  className?: string | null;
  moduleName?: string | null;
  available: boolean;
  reason?: string | null;
};

export type ExternalViewerListOptions = AuthenticatedRequestOptions & {
  objectId?: Id;
  objectKind?: string;
};

export type ExternalViewerLaunchPayload = {
  objectId?: Id;
  objectKind?: string;
  params?: Record<string, unknown>;
};

export type ExternalViewerLaunchResult = {
  success: boolean;
  viewerId: string;
  message?: string | null;
  pid?: number | null;
  data?: unknown;
};


//─────────────────────────────────────────────────────────────────────────────
// Protocol export (for sharing or external analysis)
//─────────────────────────────────────────────────────────────────────────────

export type ResolveBrowserPathsResult = {
  rootAbs?: string;
  startPath?: string;
  protocolRoot?: string;
};

export type ExportProtocolsRequestPayload = {
  protocolIds: Id[];
  directoryPath: string;
  filename: string;
};

export type ExportProtocolsResult = {
  success: boolean;
  path: string;
  filename: string;
  size?: number;
  mimeType?: string;
  protocolIds?: Array<Id>;
};

export type WorkflowExportRequestPayload = {
  protocolIds: Id[];
  includeUpstream?: boolean;
};

export type WorkflowExportResult = {
  sourceProjectId: Id;
  sourceProjectName?: string;
  protocolIds: Id[];
  workflow: unknown;
  scipionWeb?: {
    format?: string;
    version?: number;
    requiredPluginNames?: string[];
    protocolPlugins?: Array<{
      protocolId?: string;
      className?: string;
      pluginName?: string;
    }>;
    exportedAt?: string;
  };
  summary?: {
    protocolCount?: number;
    requiredPluginNames?: string[];
  };
};

export type WorkflowImportRequestPayload = {
  workflow: unknown;
  mode?: "append";
  sourceProjectId?: Id;
  sourceProjectName?: string;
};

export type WorkflowImportResult = {
  status: number;
  errors: string[];
  workflow?: unknown[];
  created?: Array<{
    sourceId?: Id;
    newId: Id;
  }>;
  protocolsCount?: number;
  dependenciesCount?: number;
};

export type WriteRemoteFilePayload = {
  path: string;
  content: string;
  mimeType?: string;
};

export type WriteRemoteFileResult = {
  success: boolean;
  path: string;
  size?: number;
  mimeType?: string;
};


// ─────────────────────────────────────────────────────────────────────────────
// Protocol workflows launch / execution options
// ─────────────────────────────────────────────────────────────────────────────  

export type ProtocolWorkflowExecutionMode = "continue" | "restart";
export type ProtocolWorkflowExecutionScope = "single" | "all";

export type ProtocolWorkflowAffectedProtocol = {
  protocolId: string;
  runName: string;
  status: string;
  level: number;
  active: boolean;
};

export type ProtocolWorkflowExecutionPreflight = {
  protocolId: string;
  mode: ProtocolWorkflowExecutionMode;
  requiresConfirmation: boolean;
  selectedProtocol?: ProtocolWorkflowAffectedProtocol | null;
  affectedProtocols: ProtocolWorkflowAffectedProtocol[];
  activeProtocolIds: string[];
};



// ─────────────────────────────────────────────────────────────────────────────
// ProjectService interface
// ─────────────────────────────────────────────────────────────────────────────  


/**
 * Optional generics to let consumers specify concrete return shapes.
 * - TProject: shape of a single project
 * - TProjectList: shape of the projects list (array or paginated object)
 * - TProtocol: shape of a single protocol / protocol details
 */
export interface ProjectService<
  TProject = any,
  TProjectList = any,
  TProtocol = any
> {

  /**
   * Generic authenticated resources
  */
  resolveBackendUrl(raw?: string | null): string | null;

  fetchJsonUrl(
    url: string,
    opts?: AuthenticatedRequestOptions,
  ): Promise<any>;

  fetchBlobObjectUrl(
    url: string,
    opts?: AuthenticatedRequestOptions,
  ): Promise<string>;

  // ─────────────────────────────────────────────────────────────────────────────
  // System version and updates
  // ─────────────────────────────────────────────────────────────────────────────

  fetchSystemVersion(): Promise<SystemVersionInfo>;

  fetchSystemUpdateCheck(): Promise<SystemUpdateCheck>;

  // ─────────────────────────────────────────────────────────────────────────────
  // Project thumbnails
  // ─────────────────────────────────────────────────────────────────────────────

  fetchProjectThumbnailItems(
    projectId: Id,
    opts?: ProjectThumbnailItemsOptions,
  ): Promise<ProjectThumbnailGroup[]>;

  fetchProjectThumbnailObjectUrl(
    projectId: Id,
    opts?: ProjectThumbnailObjectUrlOptions,
  ): Promise<string>;

  fetchProtocolOutputThumbnails: (
    projectId: Id,
    opts: ProtocolOutputThumbnailsOptions,
  ) => Promise<ProtocolOutputThumbnailsResponse>;


  /**
   * List projects. It can return an array or a paginated object.
   * Components should normalize the result.
   */
  fetchList(): Promise<TProjectList>;

  /** Get project by id or name. */
  fetchProject(projectId: Id): Promise<TProject>;

  /** Get protocol details by project/protocol ids. */
  fetchProtocolDetails(projectId: Id, protocolId: Id): Promise<TProtocol>;

  fetchProtocolRuntimeSummaries?: (projectId: Id, protocolIds: Id[],) => Promise<ProtocolRuntimeSummary[]>;

  /** Get "new protocol" details by class within a project. */
  fetchNewProtocolDetails(projectId: Id, protocolClass: string): Promise<TProtocol>;

  /** Create a new project. */
  createProject(payload: ProjectPayload): Promise<TProject>;

  /** Import an existing project from a filesystem location. */
  importProject(payload: ImportProjectPayload): Promise<TProject>;

  /** Rename a project (and optionally update description). */
  renameProject(id: Id, newName: string, newDescription?: string): Promise<TProject>;

  /** Delete a project by id. */
  deleteProject(id: Id): Promise<void | { success: boolean }>;

  /** Load all protocols for a project. */
  loadProtocols(projectId: Id): Promise<TProtocol[] | any>;

  /** Load the protocol steps. */
  fetchProtocolSteps(projectId: Id, protocolId: Id): Promise<ProtocolStep[]>;

  /** Update one protocol step status. */
  updateProtocolStepStatus(
    projectId: Id,
    protocolId: Id,
    stepIndex: number,
    status: ProtocolStepStatus,
  ): Promise<ProtocolStep>;

  /**
  * List predefined workflows / pipelines available for a project.
  * Backend may filter them by project type, owner, or permissions.
  */
  fetchWorkflows(): Promise<WorkflowDescriptor[] | any>;

  loadWorkflow(
    projectId: string | number,
    payload: loadWorkflowPayload,
  ): Promise<any>;


  /** Execute a protocol with given params. */
  executeProtocol(
    projectId: Id,
    protocolId: Id,
    protocolClassName: string,
    params: Record<string, unknown>,
    mode?: string
  ): Promise<TProtocol>;

  /** Save protocol parameters without executing. */
  saveProtocol(
    projectId: Id,
    protocolId: Id,
    protocolClassName: string,
    params: Record<string, unknown>
  ): Promise<TProtocol>;

  /** Protocol actions */
  renameProtocol(
    projectId: Id,
    protocolId: Id,
    payload: RenameProtocolPayload,
  ): Promise<TProtocol>;
  duplicateProtocol(
    projectId: Id,
    items: { id: string; name?: string }[],
  ): Promise<TProtocol>;
  deleteProtocol(projectId: Id, protocolIds: string[]): Promise<TProtocol>;
  restartAll(projectId: Id, protocolId: Id): Promise<TProject>;
  continueAll(projectId: Id, protocolId: Id): Promise<TProject>;
  resetFrom(projectId: Id, protocolId: Id): Promise<TProject>;
  stopProtocol(projectId: Id, ids: string[]): Promise<TProject>;
  resolveBrowserPaths(projectId: Id, protocolId: Id): Promise<ResolveBrowserPathsResult>;
  listRemoteDirectory(projectId: Id, protocolId: Id, path: string): Promise<any[]>;
  previewRemoteEntry(projectId: Id, protocolId: Id, path: string): Promise<any | null>;
  buildProtocolDownloadUrl(
    projectId: string,
    protocolId: string,
    path: string,
    inline: boolean
  ): string;
  fetchProtocolInlinePreviewBlob(
    projectId: string,
    protocolId: string,
    path: string
  ): Promise<{ blob: Blob; meta: any }>;
  fetchOutputPreview(
    projectId: string,
    protocolId: string,
    path: string,
    opts?: { table?: string; signal?: AbortSignal }
  ): Promise<any>;
  previewRemoteEntry(
    projectId: Id,
    protocolId: Id,
    path: string,
  ): Promise<any | null>;


  getNextProtocolSuggestions(
    projectId: Id,
    protocolId: Id,
    opts?: NextProtocolSuggestionsOptions
  ): Promise<NextProtocolSuggestion[]>;

  getProtocolWorkflowExecutionPreflight(
    projectId: Id,
    protocolId: Id,
    mode: ProtocolWorkflowExecutionMode): Promise<ProtocolWorkflowExecutionPreflight>;
  executeProtocolWorkflow(
    projectId: Id,
    protocolId: Id,
    protocolClassName: string,
    params: Record<string, unknown>,
    mode: ProtocolWorkflowExecutionMode,
    scope: ProtocolWorkflowExecutionScope): Promise<TProject>;

  // ─────────────────────────────────────────────────────────────────────────────
  // Analyze Results (FSCs)
  // ─────────────────────────────────────────────────────────────────────────────
  fetchFscRows(projectId: Id, protocolId: Id, outputName: string): Promise<FscPoint[]>;

  // ─────────────────────────────────────────────────────────────────────────────
  // Analyze Results (Volumes) — used by the "Analyze Results" viewer.
  // ─────────────────────────────────────────────────────────────────────────────

  /**
  * Ask the backend whether an output should be handled by an external viewer (e.g., Flask).
  * If handled is true, the frontend should not open the React modal and should open the returned url instead.
  */
  resolveAnalyzeViewer(
    ctx: AnalyzeViewerResolveContext
  ): Promise<AnalyzeViewerResolveDecision>;


  resolveTableViewerAction(
    context: TableViewerContext,
    request: TableViewerActionRequest
  ): Promise<TableViewerPaneContent>;

  executeTableViewerEditAction(
    context: TableViewerContext,
    request: TableViewerEditActionRequest
  ): Promise<TableViewerEditActionResult>;

  resolveTableViewerChildren(
    context: TableViewerContext,
    request: TableViewerChildrenRequest
  ): Promise<TableViewerChildrenData>;

  fetchIntegratedAnalyzeContext(
    projectId: Id,
    protocolId: Id,
    outputName: string,
    opts?: AuthenticatedRequestOptions,
  ): Promise<IntegratedAnalyzeContext | null>;


  listOutputVolumes(
    projectId: Id,
    protocolId: Id,
    outputName: string
  ): Promise<VolumeListItem[]>;

  getVolumeInfo(
    projectId: Id,
    protocolId: Id,
    outputName: string,
    volumeId: Id
  ): Promise<VolumeInfo>;

  getVolumeHistogram(
    projectId: Id,
    protocolId: Id,
    outputName: string,
    volumeId: Id,
    opts?: VolumeHistogramOptions
  ): Promise<VolumeHistogram>;

  buildVolumeSliceUrl(
    projectId: Id,
    protocolId: Id,
    outputName: string,
    volumeId: Id,
    sliceIndex: number,
    opts?: VolumeSliceOptions
  ): Promise<string>;

  fetchVolumeSliceObjectUrl(
    projectId: Id,
    protocolId: Id,
    outputName: string,
    volumeId: Id,
    sliceIndex: number,
    opts?: VolumeSliceOptions
  ): Promise<VolumeSliceObjectUrl>;

  getVolumeSurfaceMesh(
    projectId: string | number,
    protocolId: string | number,
    outputName: string,
    volumeId: string | number,
    opts?: VolumeSurfaceMeshOptions,
  ): Promise<VolumeSurfaceMesh>;

  getVolumeData3d(
    projectId: Id,
    protocolId: Id,
    outputName: string,
    volumeId: Id,
    opts?: VolumeData3dOptions
  ): Promise<VolumeData3d>;

  // ─────────────────────────────────────────────────────────────────────────────
  // Analyze Results (Coordinates 3D + linked tomograms)
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * List tomograms associated with a SetOfCoordinates3D output.
   * Each entry can optionally point to the underlying tomogram volume.
   */
  listCoords3dTomograms(
    projectId: Id,
    protocolId: Id,
    coordsOutputName: string
  ): Promise<Coordinates3dTomogram[]>;

  /**
   * Fetch all 3D coordinates for a given tomogram within a SetOfCoordinates3D.
   */
  fetchCoords3dForTomogram(
    projectId: Id,
    protocolId: Id,
    coordsOutputName: string,
    tomoId: Id
  ): Promise<Coordinates3dTomogramPoints>;

  /**
   * Fetch a tomogram slice (image) associated with a SetOfCoordinates3D tomogram.
   * This mirrors the volume slice API but targeted to tomograms linked to coords.
   */
  fetchCoords3dTomogramSliceObjectUrl(
    projectId: Id,
    protocolId: Id,
    coordsOutputName: string,
    tomoId: Id,
    sliceIndex: number,
    opts?: {
      axis?: "z" | "y" | "x";
      cmap?: string;
      normalize?: "minmax" | "zscore" | "none";
      scale?: number;
      format?: "png" | "webp" | "jpeg";
      thumb?: number;
      fast?: boolean;
      quality?: number;
      signal?: AbortSignal;
    }
  ): Promise<VolumeSliceObjectUrl>;

  /**
 * Create a new SetOfCoordinates3D output from an edited point list for a given tomogram.
 * `coordsOutputName` is the source output currently being edited/viewed.
 */
  createCoords3dOutputFromPoints(
    projectId: Id,
    protocolId: Id,
    coordsOutputName: string,
    payload: any,
  ): Promise<CreateCoords3dOutputFromPointsResult>;

  // ─────────────────────────────────────────────────────────────────────────────
  // Analyze Results (Metadata tables + thumbnails)
  // ─────────────────────────────────────────────────────────────────────────────

  fetchOutputMetadataTables(
    projectId: Id,
    protocolId: Id,
    outputName: string
  ): Promise<MetadataTableInfo[]>;

  fetchMetadataTableSchema(
    projectId: Id,
    protocolId: Id,
    outputName: string,
    tableName: string
  ): Promise<MetadataTableSchema>;

  fetchMetadataTablePage(
    projectId: Id,
    protocolId: Id,
    outputName: string,
    tableName: string,
    opts?: {
      page?: number;
      pageSize?: number;
      sortBy?: string;
      asc?: boolean;
      selectionOnly?: boolean;
    }
  ): Promise<MetadataPage>;

  exportMetadataTable(
    projectId: Id,
    protocolId: Id,
    outputName: string,
    tableName: string,
    opts?: {
      format?: "csv" | "xlsx";
      selectionOnly?: boolean;
      ids?: number[];
    }
  ): Promise<Blob>;

  fetchMetadataTableWindow(
    projectId: Id,
    protocolId: Id,
    outputName: string,
    tableName: string,
    opts?: {
      offset?: number;
      limit?: number;
      selectionOnly?: boolean;
      sortBy?: string;
      asc?: boolean;
    }
  ): Promise<{
    offset: number;
    limit: number;
    totalRows: number;
    rows: MetadataRow[];
  }>;

  fetchMetadataImageCellObjectUrl(
    projectId: Id,
    protocolId: Id,
    outputName: string,
    tableName: string,
    rowIndex: number,
    columnName: string,
    opts?: {
      size?: number;
      applyTransform?: boolean;
      inline?: boolean;
      format?: string;
      signal?: AbortSignal;
    }
  ): Promise<{ url: string; revoke: () => void }>;

  getMetadataImageCellUrl(
    projectId: Id,
    protocolId: Id,
    outputName: string,
    tableName: string,
    rowIndex: number,
    columnName: string,
    opts?: {
      size?: number;
      applyTransform?: boolean;
      inline?: boolean;
      format?: string;
    }
  ): string;

  runMetadataTableAction(
    projectId: Id,
    protocolId: Id,
    outputName: string,
    tableName: string,
    payload: MetadataTableActionPayload,
  ): Promise<MetadataTableActionResult>;


  // ─────────────────────────────────────────────────────────────────────────────
  // Analyze Results (Tilt series)
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * List tilt series for a SetOfTiltSeries output.
   */
  listOutputTiltSeries(
    projectId: Id,
    protocolId: Id,
    outputName: string,
  ): Promise<any[]>;

  // Tilt series: fetch all views/frames for one tilt series
  fetchTiltSeriesFrames(
    projectId: Id,
    protocolId: Id,
    outputName: string,
    tiltSeriesId: Id,
  ): Promise<any>;

  // Tilt series: fetch image object URL for a single view
  fetchTiltSeriesViewImageObjectUrl(
    projectId: Id,
    protocolId: Id,
    outputName: string,
    tiltSeriesId: Id,
    viewIndex: number,
    opts?: FetchImageSliceOptions,
  ): Promise<ObjectUrlResult>;

  fetchTiltSeriesViewImagesBatch(
    projectId: Id,
    protocolId: Id,
    outputName: string,
    tiltSeriesId: Id,
    opts: TiltSeriesBatchPreviewOptions,
  ): Promise<TiltSeriesBatchPreviewResult>;

  // Tilt series: create a new SetOfTiltSeries based on current exclusions
  createNewSetOfTiltSeries(
    projectId: Id,
    protocolId: Id,
    outputName: string,
    exclusions: TiltExclusionsPayload,
    restack: boolean,
  ): Promise<void>;

  // ─────────────────────────────────────────────────────────────────────────────
  // Analyze Results (CTF tomography / CTF tilt series)
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * List CTF tomo series for a SetOfCTFTomoSeries output.
   * The concrete payload shape is left to the backend; viewers will normalize it.
   */
  listOutputCTFTomoSeries(
    projectId: Id,
    protocolId: Id,
    outputName: string,
  ): Promise<any[]>;

  /**
   * Fetch all CTF estimation views for a single CTF tomo series.
   * This should return one entry per tilt with defocus, resolution, etc.
   */
  fetchCTFTomoSeriesViews(
    projectId: Id,
    protocolId: Id,
    outputName: string,
    ctfSeriesId: Id,
  ): Promise<any>;

  /**
   * Create a new SetOfCTFTomoSeries based on the current exclusions.
   * The payload uses the same exclusion structure as SetOfTiltSeries.
   */
  createNewSetOfCTFTomoSeries(
    projectId: Id,
    protocolId: Id,
    outputName: string,
    exclusions: CTFTomoExclusionsPayload,
  ): Promise<void>;

  fetchCTFPsdImage(
    projectId: Id,
    protocolId: Id,
    outputName: string,
    psdPath: string,
    opts?: AuthenticatedRequestOptions,
  ): Promise<Blob>;


  // ─────────────────────────────────────────────────────────────────────────────
  // Analyze Results (External viewers for custom outputs)
  // ─────────────────────────────────────────────────────────────────────────────
  listExternalViewers(
    projectId: Id,
    protocolId: Id,
    outputName: string,
    opts?: ExternalViewerListOptions,
  ): Promise<ExternalViewerDescriptor[]>;

  launchExternalViewer(
    projectId: Id,
    protocolId: Id,
    outputName: string,
    viewerId: string,
    payload?: ExternalViewerLaunchPayload,
  ): Promise<ExternalViewerLaunchResult>;

  // ─────────────────────────────────────────────────────────────────────────────
  // Project sharing / collaboration
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * List users that can be used as targets for project sharing.
   * The concrete payload shape is left to the backend; callers can normalize it.
   */
  listUsers(): Promise<ShareableUser[] | any>;

  /**
   * Share a project with one or more users.
   * Backend decides whether this overwrites or appends to existing shares.
   */
  shareProject(
    projectId: Id,
    userIds: Id[],
  ): Promise<void | { success: boolean }>;

  listProjectShares(
    projectId: Id,
  ): Promise<ShareableUser[] | any>;

  revokeProjectShare(
    projectId: Id,
    userId: Id,
  ): Promise<void | { success: boolean }>;


  // ─────────────────────────────────────────────────────────────────────────────
  // Settings (user + instance + host)
  // ─────────────────────────────────────────────────────────────────────────────

  fetchUserSettings(): Promise<UserSettings>;
  putUserSettings(payload: UserSettings): Promise<UserSettings>;
  patchUserSettings(patch: UserSettingsPatch): Promise<UserSettings>;

  fetchInstanceSettings(): Promise<InstanceSettings>;
  fetchInstanceResources(): Promise<InstanceResources>;
  putInstanceSettings(payload: InstanceSettings): Promise<InstanceSettings>;
  patchInstanceSettings(patch: InstanceSettingsPatch): Promise<InstanceSettings>;

  fetchJobsOverview(recentLimit?: number): Promise<JobMonitoringOverview>;

  fetchEnvironmentVariables: () => Promise<EnvironmentVariable[]>;
  patchEnvironmentVariables: (patch: EnvironmentVariablesPatch) => Promise<EnvironmentVariable[]>;

  fetchHostSettings(): Promise<HostSettings>;
  putHostSettings(payload: HostSettings): Promise<HostSettings | null>;
  patchHostSettings(patch: HostSettingsPatch): Promise<HostSettings | null>;

  // ─────────────────────────────────────────────────────────────────────────────
  // Optional runtime capabilities
  // ─────────────────────────────────────────────────────────────────────────────

  getCapabilities?: () => ProjectServiceCapabilities;

  fetchProjectEffectiveSettings?: (
    projectId: Id,
  ) => Promise<ProjectEffectiveSettings>;

  // ─────────────────────────────────────────────────────────────────────────────
  // Protocol logs (dynamic channels)
  // ─────────────────────────────────────────────────────────────────────────────

  fetchProtocolLogChannels(
    projectId: Id,
    protocolId: Id,
  ): Promise<ProtocolLogChannelsResponse>;

  fetchProtocolLogsChunk(
    projectId: Id,
    protocolId: Id,
    offsets: ProtocolLogOffsets,
    opts?: {
      limit?: number;
      signal?: AbortSignal;
    },
  ): Promise<ProtocolLogsChunkResponse>;


  // ─────────────────────────────────────────────────────────────────────────────
  // Protocol tags
  // ─────────────────────────────────────────────────────────────────────────────

  listProjectTags(projectId: Id): Promise<ProtocolTag[]>;
  createProjectTag(projectId: Id, payload: ProtocolTagCreatePayload): Promise<ProtocolTag>;
  updateProjectTag(projectId: Id, tagId: string, payload: ProtocolTagUpdatePayload): Promise<ProtocolTag>;
  deleteProjectTag(projectId: Id, tagId: string): Promise<{ success: boolean }>;

  listProtocolTagIds(projectId: Id, protocolId: Id): Promise<string[]>;
  setProtocolTagIds(projectId: Id, protocolId: Id, tagIds: string[]): Promise<ProtocolTagIdsResult>;

  // ─────────────────────────────────────────────────────────────────────────────
  // Context menu visibility policy
  // ─────────────────────────────────────────────────────────────────────────────
  getContextMenuVisibilityPolicy(
    projectId: Id,
  ): Promise<ContextMenuVisibilityPolicy>;

  // ─────────────────────────────────────────────────────────────────────────────
  // Wizards support
  // ─────────────────────────────────────────────────────────────────────────────  

  executeProtocolWizard: (
    projectId: string | number,
    payload: ExecuteProtocolWizardPayload
  ) => Promise<ExecuteProtocolWizardResult>;

  // ─────────────────────────────────────────────────────────────────────────────
  // Protocol export (for sharing or external analysis)
  // ─────────────────────────────────────────────────────────────────────────────
  exportProtocols(
    projectId: Id,
    payload: ExportProtocolsRequestPayload,
  ): Promise<ExportProtocolsResult>;

  exportWorkflowProtocols(
    projectId: Id,
    payload: WorkflowExportRequestPayload,
  ): Promise<WorkflowExportResult>;

  importWorkflowProtocols(
    projectId: Id,
    payload: WorkflowImportRequestPayload,
  ): Promise<WorkflowImportResult>;

  writeRemoteFile(
    projectId: Id,
    protocolId: Id,
    payload: WriteRemoteFilePayload,
  ): Promise<WriteRemoteFileResult>;

  //-────────────────────────────────────────────────────────────────────────────
  // 2D Coordinates picking (for CTF, particle picking, etc.)
  //-────────────────────────────────────────────────────────────────────────────
  listCoords2dMicrographs(
    projectId: Id,
    protocolId: Id,
    outputName: string,
  ): Promise<Coords2dMicrographsResult>;

  fetchCoords2dForMicrograph(
    projectId: Id,
    protocolId: Id,
    outputName: string,
    micId: Id,
  ): Promise<Coords2dPoint[]>;

  fetchCoords2dMicrographImageObjectUrl(
    projectId: Id,
    protocolId: Id,
    outputName: string,
    micId: Id,
    opts?: {
      size?: number;
      format?: "png" | "webp" | "jpeg";
      signal?: AbortSignal;
    },
  ): Promise<ObjectUrlResult>;

  fetchCoords2dMicrographThumbnailObjectUrl(
    projectId: Id,
    protocolId: Id,
    outputName: string,
    micId: Id,
    opts?: {
      size?: number;
      format?: "png" | "webp" | "jpeg";
      signal?: AbortSignal;
    },
  ): Promise<ObjectUrlResult>;

  createCoords2dOutputFromCurrentCoordinates(
    projectId: Id,
    protocolId: Id,
    outputName: string,
    payload: CreateCoords2dOutputPayload,
  ): Promise<CreateCoords2dOutputResult>;

}
