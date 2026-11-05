import { FolderOpen, RefreshCw, X } from "lucide-react";

import type { WorkflowCategory } from "@/services/ProjectService";

import type { WorkflowCategoryInfo } from "./workflowCategories";

import styles from "./WorkflowsHeader.module.css";

export type WorkflowsHeaderProps<C extends WorkflowCategory> = {
  title: string;
  subtitle?: string;
  /** Folder (or file) shown under the subtitle; hidden when empty. */
  path?: string | null;
  /** Text before the path, e.g. "Saved to". */
  pathLabel?: string;
  categories: (WorkflowCategoryInfo & { id: C })[];
  category: C;
  onCategoryChange: (category: C) => void;
  /** Reload button right of the tabs (only when given). */
  onRefresh?: () => void;
  loading?: boolean;
  /** Disables the tabs and the close button (e.g. while saving). */
  disabled?: boolean;
  onClose: () => void;
  closeLabel?: string;
};

/**
 * Dark header of the workflows panel and the export dialog: title,
 * subtitle, the folder of the workflows and the Built-in / Site / Project
 * tabs with a reload button.
 */
export function WorkflowsHeader<C extends WorkflowCategory>({
  title,
  subtitle,
  path,
  pathLabel,
  categories,
  category,
  onCategoryChange,
  onRefresh,
  loading = false,
  disabled = false,
  onClose,
  closeLabel = "Close",
}: WorkflowsHeaderProps<C>) {
  return (
    <div className={styles.header}>
      <div className={styles.headerLeft}>
        <span className={styles.headerTitle}>{title}</span>
        {subtitle ? <span className={styles.headerSubtitle}>{subtitle}</span> : null}
        {path ? (
          <div className={styles.pathLine} title={path}>
            <FolderOpen className={styles.pathIcon} aria-hidden />
            {pathLabel ? <span className={styles.pathLabel}>{pathLabel}</span> : null}
            <span className={styles.pathText}>
              <bdi className={styles.pathTextInner}>{path}</bdi>
            </span>
          </div>
        ) : null}
        <div className={styles.categoryRow}>
          <div className={styles.categoryTabs} role="tablist" aria-label="Workflow category">
            {categories.map((c) => (
              <button
                key={c.id}
                type="button"
                role="tab"
                aria-selected={c.id === category}
                title={c.hint}
                disabled={disabled}
                className={[
                  styles.categoryTab,
                  c.id === category ? styles.categoryTabActive : "",
                ].join(" ")}
                onClick={() => {
                  if (c.id !== category) onCategoryChange(c.id);
                }}
              >
                {c.label}
              </button>
            ))}
          </div>
          {onRefresh ? (
            <button
              type="button"
              className={styles.categoryRefresh}
              onClick={onRefresh}
              disabled={loading || disabled}
              title="Reload the list"
              aria-label="Reload the workflows list"
            >
              <RefreshCw className={styles.categoryRefreshIcon} />
            </button>
          ) : null}
        </div>
      </div>

      <button
        type="button"
        onClick={onClose}
        disabled={disabled}
        className={styles.closeButton}
        aria-label={closeLabel}
      >
        <X className={styles.closeIcon} />
      </button>
    </div>
  );
}

export default WorkflowsHeader;
