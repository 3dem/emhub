export type WorkflowViewMode =
  | "treeTb"
  | "treeLr"
  | "grid"
  | "table";


export type ProjectUserSettings = {
  workflowViewMode: WorkflowViewMode;

  graphMiniMapEnabled: boolean;
  graphFocusModeEnabled: boolean;
  protocolOutputThumbnailsEnabled: boolean;

  workflowsAutoRefreshSec: number;
};


export type ProjectInstanceSettings = {
  defaultQueueName: string;
  maxConcurrentRunsPerUser: number;
};


export const DEFAULT_PROJECT_USER_SETTINGS:
  ProjectUserSettings = {
  workflowViewMode: "treeTb",

  graphMiniMapEnabled: true,
  graphFocusModeEnabled: false,
  protocolOutputThumbnailsEnabled: false,

  workflowsAutoRefreshSec: 15,
};


export const DEFAULT_PROJECT_INSTANCE_SETTINGS:
  ProjectInstanceSettings = {
  defaultQueueName: "default",
  maxConcurrentRunsPerUser: 4,
};