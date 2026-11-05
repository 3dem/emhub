import type { WorkflowCategory, WritableWorkflowCategory } from "@/services/ProjectService";

export type WorkflowCategoryInfo = {
  id: WorkflowCategory;
  label: string;
  /** Where the workflows of the category are stored. */
  hint: string;
};

export const WORKFLOW_CATEGORIES: WorkflowCategoryInfo[] = [
  { id: "builtin", label: "Built-in", hint: "Shipped with the processing software" },
  { id: "site", label: "Site", hint: "Shared by the whole facility" },
  { id: "project", label: "Project", hint: "Stored in this project folder" },
];

export const WRITABLE_WORKFLOW_CATEGORIES = WORKFLOW_CATEGORIES.filter(
  (c): c is WorkflowCategoryInfo & { id: WritableWorkflowCategory } => c.id !== "builtin",
);

export function getWorkflowCategoryInfo(id: WorkflowCategory): WorkflowCategoryInfo {
  return WORKFLOW_CATEGORIES.find((c) => c.id === id) ?? WORKFLOW_CATEGORIES[0];
}

/** Same rule as the EMhub backend: a file name without folders (".json" is added). */
export const WORKFLOW_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

export function normalizeWorkflowId(value: string): string {
  return String(value ?? "").trim().replace(/\.json$/i, "");
}

/**
 * Split a fetchWorkflows result: a plain array (hosts without folders) or
 * {workflows, folder}.
 */
export function unpackWorkflowsListing(data: unknown): { workflows: any[]; folder: string | null } {
  if (Array.isArray(data)) return { workflows: data, folder: null };
  const obj = (data ?? {}) as { workflows?: unknown; folder?: unknown };
  return {
    workflows: Array.isArray(obj.workflows) ? obj.workflows : [],
    folder: typeof obj.folder === "string" && obj.folder ? obj.folder : null,
  };
}

/** Path of a file in a workflows folder. */
export function joinWorkflowPath(folder: string, file: string): string {
  return `${folder.replace(/\/+$/, "")}/${file}`;
}
