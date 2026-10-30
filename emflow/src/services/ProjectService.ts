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
  /** Å per voxel of a volume ([x, y, z] or a single number); needed for correct measurements. */
  voxelSize?: number | number[] | null;
  /** VolumeViewer config (tabs, tools, initialTool, viewSize, particleTolerance),
   * see VolumeViewerConfig in components/viewers/VolumeViewer.tsx. */
  viewerConfig?: Record<string, unknown>;
  /** "volume": X, Y and Z slices shown by VolumeViewer (Slices and 3D tabs);
   * "stack": one slider per axis. */
  layout?: "volume" | "stack";
  /** Picking coordinates overlaid on the Z-axis slider. */
  coordinates?: {
    x: number[];
    y: number[];
    z: number[];
    /** [rot, tilt, psi] in degrees per particle (RELION convention). */
    angles?: number[][];
    /** Surface of the picking template: flat vertices (Å) and triangle indices. */
    template?: { vertices: number[]; faces: number[] };
  };
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

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────
// Wizards support (protocols that can launch a multi-step form instead of the regular parameter form)
// ─────────────────────────────────────────────────────────────────────────────────────────────────────────

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
  // Wizards support
  // ─────────────────────────────────────────────────────────────────────────────  

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

}
