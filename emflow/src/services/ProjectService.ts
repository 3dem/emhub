// src/services/ProjectService.ts

export interface loadWorkflowPayload {
  workflowId: string;
  /** Category of the workflow (default "builtin"). */
  category?: WorkflowCategory;
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

// ─────────────────────────────────────────────────────────────────────────────
// Coordinates3D + linked tomograms (SetOfCoordinates3D support)
// ─────────────────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────────────
// Metadata table basic types (en paralelo a los de api/projects.ts)
// ─────────────────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────────────
// Analyze Results (FSCs)
// ─────────────────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────────────
// Analyze Results (Tilt series)
// ─────────────────────────────────────────────────────────────────────────────

// Shared object-url result type used by image viewers

// Generic options for fetching 2D image slices / previews from the API

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

/** The action resolved when the table is shown (its row is selected), as if
 * clicked: actionId is one of the row's actions (its defaultAction, actions,
 * cell actions or column actions), the row's defaultAction if omitted. */
export type TableViewerInitialAction = {
  rowId: string | number;
  actionId?: string;
  columnId?: string;
};

/** Other versions of a table the host can load (e.g. the iterations of a
 * Relion job), shown as a select in the table toolbar; choosing one calls
 * loadTableViewerVariant. */
export type TableViewerVariants = {
  /** Label of the select ("Iteration"). */
  label: string;
  /** Id of the shown version. */
  value: string;
  options: { id: string; label: string }[];
};

/** A version of a table and the context of its requests (e.g. its path). */
export type TableViewerVariantData = {
  context: TableViewerContext;
  table: TableViewerData;
};

export type TableViewerData = {
  title?: string;
  columns: TableViewerColumn[];
  rows: TableViewerRow[];

  initialAction?: TableViewerInitialAction;
  variants?: TableViewerVariants;

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
  | TableViewerTiltSeriesContent
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
  /** Å per voxel of a volume ([x, y, z] or a single number); needed for correct measurements. */
  voxelSize?: number | number[] | null;
  /** VolumeViewer config (tabs, initialTab, tools, initialTool, defaults,
   * viewSize), see VolumeViewerConfig in components/viewers/VolumeViewer.tsx. */
  viewerConfig?: Record<string, unknown>;
  /** Density of the volume for VolumeViewer's "3D volume" tab (and its Slices
   * when there are no `axes`): inline, or {path, payload} to load it with the
   * DataLoader. See VolumeDensity in components/viewers/volume/volumeMath.ts. */
  density?: Record<string, unknown> | null;
  /** "volume": shown by VolumeViewer (X, Y and Z slices, or only a density);
   * "stack": one slider per axis. */
  layout?: "volume" | "stack";
  /** Small cells (e.g. the 2 x 2 grid of the classes of an iteration): no
   * "Volume dimensions" line (the host puts the box in the title) and less
   * padding, so the viewer takes the cell. */
  compact?: boolean;
  /** Picking coordinates overlaid on the Z-axis slider. */
  coordinates?: {
    x: number[];
    y: number[];
    z: number[];
    /** [rot, tilt, psi] in degrees per particle (RELION convention). */
    angles?: number[][];
    /** Surface of the picking template: flat vertices (Å) and triangle indices;
     * `density` (shape z,y,x, base64 uint8, voxelSize, level) to pick the threshold. */
    template?: {
      vertices: number[];
      faces: number[];
      density?: { shape: [number, number, number]; data: string; voxelSize: number; level: number };
    };
  };
};

/** One tilt of a TableViewerTiltSeriesContent; values from the per tilt
 * series STAR, null when it does not have them. */
export type TiltSeriesTilt = {
  /** Base64 PNG (without data: prefix) of the unaligned tilt image. */
  image: string;
  /** rlnTomoTiltMovieIndex */
  movieIndex: number | null;
  /** rlnTomoNominalStageTiltAngle (°) */
  tiltAngle: number | null;
  /** rlnTomoXTilt, rlnTomoYTilt, rlnTomoZRot (°) */
  xTilt: number | null;
  yTilt: number | null;
  zRot: number | null;
  /** rlnTomoXShiftAngst, rlnTomoYShiftAngst (Å) */
  shiftX: number | null;
  shiftY: number | null;
  /** rlnMicrographPreExposure (e/Å²) */
  dose: number | null;
  /** rlnDefocusU, rlnDefocusV (Å) */
  defocusU: number | null;
  defocusV: number | null;
  /** rlnCtfMaxResolution (Å) */
  ctfMaxResolution: number | null;
  /** Section of the stack the image comes from. */
  section?: number;
  /** rlnTomoDeformationCoefficients: the local alignment of the tilt (see
   * TableViewerTiltSeriesContent.deformation). */
  deformation?: number[];
};

/** Local alignment of a tilt series: RELION 5 2D deformations
 * (rlnTomoDeformationType, rlnTomoDeformationGridSizeX / Y of the global
 * STAR), evaluated in pixels of the full size tilt images (imageSize). */
export type TiltSeriesDeformation = {
  type: "spline" | "Fourier" | "linear" | string;
  gridSize: [number, number];
  imageSize: [number, number];
};

/** A tilt series for TiltSeriesViewer: its tilt images, sorted by tilt
 * angle, with their RELION alignment, so the viewer can apply it. */
export type TableViewerTiltSeriesContent = {
  kind: "tiltSeries";
  title?: string;
  tilts: TiltSeriesTilt[];
  /** [width, height] of the images in pixels. */
  imageSize: [number, number];
  /** Å per pixel of the images (the shifts are divided by it); null: unknown. */
  pixelSize: number | null;
  /** rlnTomoNominalTiltAxisAngle (°), drawn when there is no alignment. */
  tiltAxisAngle?: number | null;
  /** Whether the tilts have rlnTomoZRot and the X / Y shifts. */
  hasAlignment: boolean;
  /** Local alignment, when the STAR has it (per tilt `deformation`). */
  deformation?: TiltSeriesDeformation | null;
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
  }
  | {
    // A map or a mask (VolumeViewerDialog): the VolumeViewer pane content
    // inline (`data`) or loaded with the DataLoader (`source`); its
    // viewerConfig sets the viewer (e.g. the mask over its map)
    handled: true;
    viewer: "volume";
    title?: string;
    pointerClass?: string;
    data?: Record<string, any>;
    source?: { path: string; payload?: Record<string, unknown> };
  }
  | {
    // A PDF file (PdfViewerDialog): the browser renders the file at `url`
    // (given by the host, e.g. EMhub's /api/get_pdf_file) in an iframe
    handled: true;
    viewer: "pdf";
    url: string;
    title?: string;
    pointerClass?: string;
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

/**
 * Where a workflow lives: shipped with the processing code (builtin,
 * read-only), the site (EMhub instance folder) or the project folder.
 */
export type WorkflowCategory = "builtin" | "site" | "project";

/** Categories a workflow can be saved to (saveWorkflow). */
export type WritableWorkflowCategory = Exclude<WorkflowCategory, "builtin">;

export type WorkflowDescriptor = {
  /** Workflow identifier (index, db id, or slug); the file name without .json for the categories. */
  id: Id;
  /** Human-friendly workflow name to display in the UI. */
  name: string;
  /** Short description explaining what this workflow does. */
  description?: string;
  /** Category the workflow was listed from. */
  category?: WorkflowCategory;
  /** File name (e.g. "spa-otf.json"). */
  file?: string;
  /** Number of jobs / protocols in the workflow. */
  protocolsCount?: number;
  /** The file could not be read. */
  parseError?: string | null;
};

/**
 * fetchWorkflows result of the hosts that know where the workflows of the
 * category are stored: `folder` is shown in the workflows panel and the
 * export dialog (a plain array is still accepted).
 */
export type WorkflowsListing = {
  workflows: WorkflowDescriptor[];
  /** Absolute folder the workflows are read from and saved to. */
  folder?: string | null;
};

export type SaveWorkflowPayload = {
  /** Protocols (jobs) to save as the workflow, in order. */
  protocolIds: Id[];
  category: WritableWorkflowCategory;
  /** File name without .json (letters, digits, ".", "_", "-"). */
  workflowId: string;
  /** Label shown in the workflow lists. */
  name: string;
  description?: string;
  /** Replace an existing workflow with the same workflowId (asked to the user first). */
  overwrite?: boolean;
};

export type SaveWorkflowResult = {
  id: string;
  file?: string;
  category: WritableWorkflowCategory;
  protocolsCount?: number;
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

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────
// Wizards support: a dialog that sets some params of a protocol form
// (form `wizards` + param `wizard: <id>`, emwrap.base.wizards on the server)
// ─────────────────────────────────────────────────────────────────────────────────────────────────────────

// Wizard declared by a form (the params that show its button)
export type FormWizard = {
  id: string;
  label?: string;
  params?: string[];
};

// Answer of openWizard; errors means the wizard can not run
export type WizardOpenResult = {
  errors?: string[];
  id?: string;
  label?: string;
  ui?: string;                       // emflow component (components/wizards)
  inputs?: Record<string, any>;      // initial values of the editable fields
  data?: Record<string, any>;        // read-only values
  warnings?: string[];
};

// Answer of previewWizard: data merged into the wizard's data while it is
// open (e.g. a tentative mask), or the errors of the values
export type WizardPreviewResult = {
  errors?: string[];
  data?: Record<string, any>;
  warnings?: string[];
};

// Answer of applyWizard: the form params to update (nothing is saved)
export type WizardApplyResult = {
  errors?: string[];
  params?: Record<string, any>;
  warnings?: string[];
};

//─────────────────────────────────────────────────────────────────────────────
// External viewers support (e.g., Imod, ChimeraX, etc.) — launched from 
// protocol actions or output previews
//─────────────────────────────────────────────────────────────────────────────

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
  /**
   * Params emptied because they referenced protocols that were not copied
   * (pasting from another project): sourceId is the copied protocol id.
   */
  clearedInputs?: Array<{
    sourceId: Id;
    param: string;
    value?: string;
  }>;
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

  /**
  * List predefined workflows / pipelines available for a project, of the
  * given category (default "builtin"). Hosts without categories ignore it.
  */
  fetchWorkflows(category?: WorkflowCategory): Promise<WorkflowDescriptor[] | WorkflowsListing | any>;

  /**
  * Save the given protocols as a workflow of the site or the project
  * (the workflow export dialog). Rejects when the workflow exists and
  * payload.overwrite is not set.
  */
  saveWorkflow(
    projectId: Id,
    payload: SaveWorkflowPayload,
  ): Promise<SaveWorkflowResult>;

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

  /** Optional: another version of the table (TableViewerData.variants), with
   * the context of its requests; null when the host has none (default). */
  loadTableViewerVariant(
    context: TableViewerContext,
    variantId: string
  ): Promise<TableViewerVariantData | null>;

  // ─────────────────────────────────────────────────────────────────────────────
  // Analyze Results (Coordinates 3D + linked tomograms)
  // ─────────────────────────────────────────────────────────────────────────────

  // ─────────────────────────────────────────────────────────────────────────────
  // Analyze Results (Metadata tables + thumbnails)
  // ─────────────────────────────────────────────────────────────────────────────

  // ─────────────────────────────────────────────────────────────────────────────
  // Analyze Results (Tilt series)
  // ─────────────────────────────────────────────────────────────────────────────

  // Tilt series: fetch all views/frames for one tilt series

  // Tilt series: fetch image object URL for a single view

  // Tilt series: create a new SetOfTiltSeries based on current exclusions

  // ─────────────────────────────────────────────────────────────────────────────
  // Analyze Results (CTF tomography / CTF tilt series)
  // ─────────────────────────────────────────────────────────────────────────────

  // ─────────────────────────────────────────────────────────────────────────────
  // Analyze Results (External viewers for custom outputs)
  // ─────────────────────────────────────────────────────────────────────────────

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
  // Wizards support (optional: without openWizard the wizard buttons are hidden,
  // e.g. in the workflow template editor). params are the current, unsaved
  // form values; protocolId is empty for a new protocol.
  // ─────────────────────────────────────────────────────────────────────────────
  openWizard?(
    projectId: Id,
    protocolId: Id | null,
    protocolClassName: string,
    wizardId: string,
    params: Record<string, any>,
  ): Promise<WizardOpenResult>;

  applyWizard?(
    projectId: Id,
    protocolId: Id | null,
    protocolClassName: string,
    wizardId: string,
    params: Record<string, any>,
    outputs: Record<string, any>,
  ): Promise<WizardApplyResult>;

  // New data for the values being selected in an open wizard (optional:
  // only the wizards with a preview, e.g. MaskCreateWizard, use it)
  previewWizard?(
    projectId: Id,
    protocolId: Id | null,
    protocolClassName: string,
    wizardId: string,
    params: Record<string, any>,
    outputs: Record<string, any>,
  ): Promise<WizardPreviewResult>;

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

  // Optional (without it the menu item is hidden): URL of a host page with the
  // computing resources (node, queue, CPUs, GPUs, memory) used by the given
  // protocols, opened from the node menu "Workflow > Computing Summary".
  getComputingSummaryUrl?(projectId: Id, protocolIds: Id[]): Promise<string>;

  writeRemoteFile(
    projectId: Id,
    protocolId: Id,
    payload: WriteRemoteFilePayload,
  ): Promise<WriteRemoteFileResult>;

  //-────────────────────────────────────────────────────────────────────────────
  // 2D Coordinates picking (for CTF, particle picking, etc.)
  //-────────────────────────────────────────────────────────────────────────────

}
