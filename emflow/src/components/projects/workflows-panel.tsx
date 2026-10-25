import { useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  FileText,
  PackageCheck,
  RefreshCw,
  Search,
  X,
} from "lucide-react";
import toast from "react-hot-toast";

import { useProjectService } from "@/ProjectServiceContext";

import styles from "./workflows-panel.module.css";

export interface ProjectWorkflow {
  id: string;
  name: string;
  description: string;
  source?: string;
  templatePath?: string;
  protocolsCount?: number;
  parseError?: string | null;
  requiredPluginNames?: string[];
  missingPluginNames?: string[];
  canLoad?: boolean;
  disabledReason?: string;
}

interface ProjectWorkflowsPanelProps {
  open: boolean;
  onClose: () => void;
  workflows: ProjectWorkflow[];
  loading?: boolean;
  errorMessage?: string | null;
  onRetry?: () => void;
  onWorkflowClick?: (workflow: ProjectWorkflow) => void;
  onWorkflowDoubleClick?: (workflow: ProjectWorkflow) => void;
  onWorkflowLoaded?: () => void | Promise<void>;
  projectId: string | number;
  projectName?: string;
}

function normalizeWorkflowDescriptionText(description?: string) {
  return String(description ?? "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/(ScipionWeb metadata format:)/g, "\n$1")
    .replace(/(ScipionWeb metadata version:)/g, "\n$1")
    .replace(/(ScipionWeb exported at UTC:)/g, "\n$1")
    .replace(/(Scipion required plugins:)/g, "\n$1")
    .replace(/(ScipionWeb required plugins:)/g, "\n$1")
    .replace(/(ScipionWeb protocol plugin:)/g, "\n$1")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function parseWorkflowDescription(description?: string) {
  const normalized = normalizeWorkflowDescriptionText(description);

  const lines = normalized
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  const metadataLines: string[] = [];
  const descriptionLines: string[] = [];

  for (const line of lines) {
    if (
      line.startsWith("ScipionWeb metadata") ||
      line.startsWith("ScipionWeb exported") ||
      line.startsWith("ScipionWeb protocol plugin:") ||
      /^Scipion(?:Web)? required plugins:/i.test(line)
    ) {
      metadataLines.push(line);
      continue;
    }

    descriptionLines.push(line);
  }

  return {
    lead: descriptionLines[0] || "No description available.",
    details: descriptionLines.slice(1),
    metadataLines,
  };
}

function canLoadWorkflow(workflow: ProjectWorkflow) {
  if (workflow.canLoad === false) return false;
  if (workflow.parseError) return false;
  return !(workflow.missingPluginNames?.length);
}

function getWorkflowDisabledReason(workflow: ProjectWorkflow) {
  if (workflow.disabledReason) return workflow.disabledReason;

  if (workflow.missingPluginNames?.length) {
    return `Missing required plugins: ${workflow.missingPluginNames.join(", ")}`;
  }

  if (workflow.parseError) {
    return "This workflow has a parse error.";
  }

  return "";
}

export function ProjectWorkflowsPanel({
  open,
  onClose,
  workflows,
  loading = false,
  errorMessage = null,
  onRetry,
  onWorkflowClick,
  onWorkflowDoubleClick,
  onWorkflowLoaded,
  projectId,
  projectName,
}: ProjectWorkflowsPanelProps) {
  const hasWorkflows = Array.isArray(workflows) && workflows.length > 0;

  const [selectedWorkflow, setSelectedWorkflow] =
    useState<ProjectWorkflow | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

  const handleRowDoubleClick = (wf: ProjectWorkflow) => {
    onWorkflowDoubleClick?.(wf);

    if (!canLoadWorkflow(wf)) {
      toast.error(getWorkflowDisabledReason(wf) || "This workflow cannot be loaded.");
      return;
    }

    setSelectedWorkflow(wf);
    setDialogOpen(true);
  };

  const normalizedSearch = searchQuery.trim().toLowerCase();

  const filteredWorkflows = normalizedSearch
    ? workflows.filter((wf) => {
      const haystack = [
        wf.name,
        wf.description,
        wf.source,
        wf.templatePath,
        ...(wf.requiredPluginNames ?? []),
        ...(wf.missingPluginNames ?? []),
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();

      return haystack.includes(normalizedSearch);
    })
    : workflows;

  const hasFilteredWorkflows =
    Array.isArray(filteredWorkflows) && filteredWorkflows.length > 0;

  const shellClassName = [
    styles.shell,
    open ? styles.shellOpen : styles.shellClosed,
  ].join(" ");

  return (
    <>
      <div className={styles.host}>
        <div className={shellClassName} aria-hidden={!open}>
          <div className={styles.panel}>
            <div className={styles.header}>
              <div className={styles.headerLeft}>
                <span className={styles.headerTitle}>Workflows</span>
                <span className={styles.headerSubtitle}>
                  Load predefined templates into the current project.
                </span>
              </div>

              <button
                type="button"
                onClick={onClose}
                className={styles.closeButton}
                aria-label="Close workflows panel"
              >
                <X className={styles.closeIcon} />
              </button>
            </div>

            <div className={styles.content}>
              {loading ? (
                <div className={styles.loadingWrap}>
                  <div className={styles.loadingPill}>
                    <span className={styles.loadingDot} />
                    <span>Loading workflows…</span>
                  </div>
                  <p className={styles.loadingHint}>
                    This may take a few seconds the first time.
                  </p>
                </div>
              ) : errorMessage ? (
                <div className={styles.errorWrap}>
                  <span className={styles.errorTitle}>
                    Could not load workflows.
                  </span>
                  <span className={styles.errorMessage} title={errorMessage}>
                    {errorMessage}
                  </span>

                  {onRetry && (
                    <button
                      type="button"
                      onClick={onRetry}
                      className={styles.retryButton}
                    >
                      <RefreshCw className={styles.retryIcon} />
                      Retry
                    </button>
                  )}
                </div>
              ) : !hasWorkflows ? (
                <p className={styles.emptyText}>
                  No workflows defined yet. You can add predefined pipelines
                  later.
                </p>
              ) : (
                <div className={styles.bodyWrap}>
                  <div className={styles.searchRow}>
                    <div className={styles.searchBox}>
                      <Search className={styles.searchIcon} />
                      <input
                        type="text"
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        placeholder="Search workflow, plugin or source…"
                        className={styles.searchInput}
                      />
                    </div>

                    <div className={styles.resultCount}>
                      {filteredWorkflows.length} of {workflows.length}
                    </div>
                  </div>

                  <div className={styles.table}>
                    <div className={styles.tableHeader}>
                      <span>Workflow</span>
                      <span>Description and requirements</span>
                    </div>

                    <div className={styles.tableBody}>
                      {!hasFilteredWorkflows ? (
                        <div className={styles.noMatch}>
                          No workflows match the current search.
                        </div>
                      ) : (
                        filteredWorkflows.map((wf) => {
                          const parsedDescription = parseWorkflowDescription(wf.description);
                          const isLoadable = canLoadWorkflow(wf);
                          const disabledReason = getWorkflowDisabledReason(wf);

                          return (
                            <button
                              key={wf.id}
                              type="button"
                              onClick={() => onWorkflowClick?.(wf)}
                              onDoubleClick={() => handleRowDoubleClick(wf)}
                              className={[
                                styles.rowButton,
                                !isLoadable ? styles.rowButtonDisabled : "",
                              ].join(" ")}
                              title={
                                isLoadable
                                  ? "Double-click to load this workflow"
                                  : disabledReason
                              }
                            >
                              <div className={styles.rowMain}>
                                <div className={styles.rowTitleLine}>
                                  <FileText className={styles.rowWorkflowIcon} />
                                  <span className={styles.rowName} title={wf.name}>
                                    {wf.name}
                                  </span>
                                </div>

                                <div className={styles.rowBadges}>
                                  {wf.source ? (
                                    <span className={styles.sourceBadge}>
                                      {wf.source}
                                    </span>
                                  ) : null}

                                  {typeof wf.protocolsCount === "number" ? (
                                    <span className={styles.countBadge}>
                                      {wf.protocolsCount} protocols
                                    </span>
                                  ) : null}

                                  {isLoadable ? (
                                    <span className={styles.readyBadge}>
                                      <CheckCircle2 className={styles.badgeIcon} />
                                      ready
                                    </span>
                                  ) : (
                                    <span className={styles.warningBadge}>
                                      <AlertTriangle className={styles.badgeIcon} />
                                      unavailable
                                    </span>
                                  )}
                                </div>

                                {wf.templatePath ? (
                                  <div className={styles.templatePath} title={wf.templatePath}>
                                    {wf.templatePath}
                                  </div>
                                ) : null}
                              </div>

                              <div className={styles.rowDescription}>
                                <div className={styles.rowDescriptionLead}>
                                  {parsedDescription.lead}
                                </div>

                                {parsedDescription.details.length ? (
                                  <div className={styles.rowDescriptionDetails}>
                                    {parsedDescription.details.slice(0, 2).join(" ")}
                                  </div>
                                ) : null}

                                {wf.requiredPluginNames?.length ? (
                                  <div className={styles.pluginLine}>
                                    <PackageCheck className={styles.pluginLineIcon} />
                                    <span>{wf.requiredPluginNames.join(", ")}</span>
                                  </div>
                                ) : null}

                                {wf.missingPluginNames?.length ? (
                                  <div className={styles.missingPluginLine}>
                                    Missing: {wf.missingPluginNames.join(", ")}
                                  </div>
                                ) : null}

                                {wf.parseError ? (
                                  <div className={styles.parseErrorLine}>
                                    Parse error: {wf.parseError}
                                  </div>
                                ) : null}
                              </div>
                            </button>
                          );
                        })
                      )}
                    </div>
                  </div>
                </div>
              )}
            </div>

            <div className={styles.footer}>
              Double-click a workflow to apply it to the current project.
            </div>
          </div>
        </div>
      </div>

      <ApplyWorkflowToCurrentProjectDialog
        open={dialogOpen}
        workflow={selectedWorkflow}
        projectId={projectId}
        projectName={projectName}
        onWorkflowLoaded={onWorkflowLoaded}
        onClose={() => setDialogOpen(false)}
      />
    </>
  );
}

interface ApplyWorkflowToCurrentProjectDialogProps {
  open: boolean;
  workflow: ProjectWorkflow | null;
  projectId: string | number;
  projectName?: string;
  onWorkflowLoaded?: () => void | Promise<void>;
  onClose: () => void;
}

function ApplyWorkflowToCurrentProjectDialog({
  open,
  workflow,
  projectId,
  projectName,
  onWorkflowLoaded,
  onClose,
}: ApplyWorkflowToCurrentProjectDialogProps) {
  const svc = useProjectService();

  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  if (!open || !workflow) return null;

  const isLoadable = canLoadWorkflow(workflow);
  const disabledReason = getWorkflowDisabledReason(workflow);
  const parsedDescription = parseWorkflowDescription(workflow.description);

  const handleApply = async () => {
    if (!canLoadWorkflow(workflow)) {
      setSubmitError(
        getWorkflowDisabledReason(workflow) || "This workflow cannot be loaded.",
      );
      return;
    }

    setSubmitError(null);
    setSubmitting(true);

    try {
      await svc.loadWorkflow(projectId, {
        workflowId: String(workflow.id),
      });

      const targetName = projectName ?? String(projectId);

      toast.success(
        `Workflow "${workflow.name}" applied to project "${targetName}".`,
      );
      await onWorkflowLoaded?.();
      onClose();
    } catch (err: any) {
      console.error(
        "[ApplyWorkflowToCurrentProjectDialog] handleApply error:",
        err,
      );
      setSubmitError(
        err?.message || "Failed to apply workflow. Please try again.",
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className={styles.applyOverlay} role="dialog" aria-modal="true">
      <div className={styles.applyCard}>
        <button
          type="button"
          onClick={onClose}
          className={styles.applyCloseButton}
          aria-label="Close apply workflow dialog"
          disabled={submitting}
        >
          <X className={styles.applyCloseIcon} />
        </button>

        <div className={styles.applyHeader}>
          <h2 className={styles.applyTitle}>Load workflow</h2>
          <p className={styles.applySubtitle}>{workflow.name}</p>
          <p className={styles.applyHint}>
            This workflow will be loaded into the current project.
          </p>
        </div>

        <div className={styles.applyMetaRow}>
          {workflow.source ? (
            <span className={styles.sourceBadge}>{workflow.source}</span>
          ) : null}

          {typeof workflow.protocolsCount === "number" ? (
            <span className={styles.countBadge}>
              {workflow.protocolsCount} protocols
            </span>
          ) : null}

          {isLoadable ? (
            <span className={styles.readyBadge}>
              <CheckCircle2 className={styles.badgeIcon} />
              ready
            </span>
          ) : (
            <span className={styles.warningBadge}>
              <AlertTriangle className={styles.badgeIcon} />
              unavailable
            </span>
          )}
        </div>

        {workflow.missingPluginNames?.length ? (
          <div className={styles.applyWarning}>
            <AlertTriangle className={styles.applyWarningIcon} />
            <span>
              This workflow cannot be loaded because these plugins are missing:{" "}
              <strong>{workflow.missingPluginNames.join(", ")}</strong>
            </span>
          </div>
        ) : null}

        {workflow.description ? (
          <div className={styles.applyDescriptionBlock}>
            <div className={styles.applyDescriptionLabel}>
              Workflow description
            </div>
            <div className={styles.applyDescriptionBox}>
              <div className={styles.applyDescriptionLead}>
                {parsedDescription.lead}
              </div>

              {parsedDescription.details.length ? (
                <div className={styles.applyDescriptionDetails}>
                  {parsedDescription.details.join("\n")}
                </div>
              ) : null}
            </div>
          </div>
        ) : null}

        {workflow.requiredPluginNames?.length ? (
          <div className={styles.applyPluginsBlock}>
            <div className={styles.applyDescriptionLabel}>
              Required plugins
            </div>
            <div className={styles.applyPluginChips}>
              {workflow.requiredPluginNames.map((pluginName) => {
                const isMissing = workflow.missingPluginNames?.includes(pluginName);

                return (
                  <span
                    key={`${workflow.id}-${pluginName}`}
                    className={isMissing ? styles.applyPluginChipMissing : styles.applyPluginChip}
                  >
                    {pluginName}
                  </span>
                );
              })}
            </div>
          </div>
        ) : null}

        {submitError ? (
          <div className={styles.applyError}>{submitError}</div>
        ) : null}

        <div className={styles.applyActions}>
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className={styles.cancelButton}
          >
            Cancel
          </button>

          <button
            type="button"
            onClick={handleApply}
            disabled={submitting || !isLoadable}
            className={styles.applyButton}
            title={isLoadable ? "Load workflow" : disabledReason}
          >
            {submitting ? "loading…" : "Load"}
          </button>
        </div>
      </div>
    </div>
  );
}