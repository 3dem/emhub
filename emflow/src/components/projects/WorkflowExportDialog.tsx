import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import toast from "react-hot-toast";
import {
  Alert,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  TextField,
} from "@mui/material";
import { FileText } from "lucide-react";

import { useProjectService } from "@/ProjectServiceContext";
import type {
  Id,
  SaveWorkflowResult,
  WritableWorkflowCategory,
} from "@/services/ProjectService";

import {
  WORKFLOW_ID_PATTERN,
  WRITABLE_WORKFLOW_CATEGORIES,
  getWorkflowCategoryInfo,
  joinWorkflowPath,
  normalizeWorkflowId,
  unpackWorkflowsListing,
} from "./workflowCategories";
import { WorkflowsHeader } from "./WorkflowsHeader";
import styles from "./WorkflowExportDialog.module.css";

type ExistingWorkflow = {
  id: string;
  name: string;
  description: string;
  file: string;
  protocolsCount?: number;
};

export type WorkflowExportDialogProps = {
  open: boolean;
  onClose: () => void;
  projectId: Id;
  /** Protocols (jobs) to save as the workflow. */
  protocolIds: string[];
  onSaved?: (result: SaveWorkflowResult) => void;
};

// The labels always sit on the border above the inputs (never inside them);
// focus only changes their color
const LABEL_ABOVE = { shrink: true } as const;

function errorMessage(e: any, fallback: string): string {
  if (typeof e === "string") return e;
  return e?.message || e?.data?.message || fallback;
}

/**
 * Save the selected protocols as a workflow of the Site or the Project
 * (ProjectService.saveWorkflow). The workflows of the chosen category are
 * listed on the left; selecting one fills the form to replace it, which is
 * confirmed before overwriting.
 */
export function WorkflowExportDialog({
  open,
  onClose,
  projectId,
  protocolIds,
  onSaved,
}: WorkflowExportDialogProps) {
  const svc = useProjectService();

  const [category, setCategory] = useState<WritableWorkflowCategory>("project");
  const [workflows, setWorkflows] = useState<ExistingWorkflow[]>([]);
  const [listLoading, setListLoading] = useState(false);
  const [listError, setListError] = useState<string | null>(null);
  // Folder of the category, where the workflow is saved (when the host gives it)
  const [folder, setFolder] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const [filename, setFilename] = useState("");
  const [label, setLabel] = useState("");
  const [description, setDescription] = useState("");

  const [busy, setBusy] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [confirmOverwrite, setConfirmOverwrite] = useState(false);

  const requestRef = useRef(0);

  const loadList = useCallback(async (cat: WritableWorkflowCategory) => {
    const requestId = ++requestRef.current;
    setListLoading(true);
    setListError(null);
    try {
      const { workflows: data, folder: catFolder } = unpackWorkflowsListing(
        await svc.fetchWorkflows(cat),
      );
      if (requestId !== requestRef.current) return;
      setFolder(catFolder);
      const list: ExistingWorkflow[] = Array.isArray(data)
        ? data
          .filter((wf: any) => !wf?.category || wf.category === cat)
          .map((wf: any) => {
            const count = wf.protocolsCount ?? wf.jobs;
            return {
              id: String(wf.id ?? ""),
              name: String(wf.name ?? wf.title ?? wf.id ?? ""),
              description: String(wf.description ?? ""),
              file: String(wf.file ?? `${wf.id}.json`),
              protocolsCount: Number.isFinite(Number(count)) ? Number(count) : undefined,
            };
          })
          .filter((wf: ExistingWorkflow) => wf.id)
        : [];
      setWorkflows(list);
    } catch (e) {
      if (requestId !== requestRef.current) return;
      setWorkflows([]);
      setFolder(null);
      setListError(errorMessage(e, "Failed to list the workflows."));
    } finally {
      if (requestId === requestRef.current) setListLoading(false);
    }
  }, [svc]);

  // Reset the form every time the dialog opens
  useEffect(() => {
    if (!open) return;
    setSelectedId(null);
    setFilename("");
    setLabel("");
    setDescription("");
    setSaveError(null);
    setConfirmOverwrite(false);
    void loadList(category);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Empty the form (file name, label, description) and the list selection
  const clearForm = () => {
    setSelectedId(null);
    setFilename("");
    setLabel("");
    setDescription("");
    setSaveError(null);
  };

  const handleCategoryChange = (next: WritableWorkflowCategory) => {
    if (next === category || busy) return;
    setCategory(next);
    setFolder(null);
    // The form may hold a workflow of the previous category
    clearForm();
    void loadList(next);
  };

  const handleSelect = (wf: ExistingWorkflow) => {
    setSelectedId(wf.id);
    setFilename(wf.id);
    setLabel(wf.name);
    setDescription(wf.description);
    setSaveError(null);
  };

  const workflowId = normalizeWorkflowId(filename);
  const filenameValid = WORKFLOW_ID_PATTERN.test(workflowId);
  const existing = useMemo(
    () => workflows.find((wf) => wf.id === workflowId) ?? null,
    [workflows, workflowId],
  );

  const doSave = async (overwrite: boolean) => {
    setBusy(true);
    setSaveError(null);
    try {
      const result = await svc.saveWorkflow(projectId, {
        protocolIds,
        category,
        workflowId,
        name: label.trim() || workflowId,
        description: description.trim(),
        overwrite,
      });
      const where = getWorkflowCategoryInfo(category).label.toLowerCase();
      toast.success(`Workflow "${label.trim() || workflowId}" saved in the ${where} workflows.`);
      onSaved?.(result);
      onClose();
    } catch (e) {
      setSaveError(errorMessage(e, "Failed to save the workflow."));
      // Someone else may have created it meanwhile: refresh the list
      void loadList(category);
    } finally {
      setBusy(false);
    }
  };

  const handleSave = () => {
    if (!filenameValid) {
      setSaveError("Use a file name with letters, digits, '.', '_' or '-' (no folders).");
      return;
    }
    if (!protocolIds.length) {
      setSaveError("No protocols selected to export.");
      return;
    }
    if (existing) {
      setConfirmOverwrite(true);
      return;
    }
    void doSave(false);
  };

  const categoryInfo = getWorkflowCategoryInfo(category);
  // File the workflow is saved to (the folder until the name is valid)
  const savePath = folder
    ? joinWorkflowPath(folder, filenameValid ? `${workflowId}.json` : "")
    : null;
  const protocolsText = protocolIds.length === 1 ? "1 protocol" : `${protocolIds.length} protocols`;

  return (
    <>
      <Dialog
        open={open}
        onClose={busy ? undefined : onClose}
        maxWidth="md"
        fullWidth
        slotProps={{ paper: { sx: { borderRadius: "16px", overflow: "hidden" } } }}
      >
        <WorkflowsHeader
          title="Export workflow"
          subtitle={`Save ${protocolsText} as a reusable workflow.`}
          path={savePath}
          pathLabel="Save to"
          categories={WRITABLE_WORKFLOW_CATEGORIES}
          category={category}
          onCategoryChange={handleCategoryChange}
          onRefresh={() => void loadList(category)}
          loading={listLoading}
          disabled={busy}
          onClose={onClose}
          closeLabel="Close export dialog"
        />

        <DialogContent className={styles.content}>
          <div className={styles.columns}>
            <div className={styles.listPane}>
              <div className={styles.paneLabel}>
                {categoryInfo.label} workflows
              </div>
              <div className={styles.list} role="listbox" aria-label={`${categoryInfo.label} workflows`}>
                {listLoading && workflows.length === 0 ? (
                  <div className={styles.listMessage}>
                    <CircularProgress size={16} /> Loading…
                  </div>
                ) : listError ? (
                  <div className={styles.listError}>{listError}</div>
                ) : workflows.length === 0 ? (
                  <div className={styles.listMessage}>
                    No {categoryInfo.label.toLowerCase()} workflows yet.
                  </div>
                ) : (
                  workflows.map((wf) => (
                    <button
                      key={wf.id}
                      type="button"
                      role="option"
                      aria-selected={wf.id === selectedId}
                      className={[
                        styles.listItem,
                        wf.id === selectedId ? styles.listItemSelected : "",
                      ].join(" ")}
                      onClick={() => handleSelect(wf)}
                      title={wf.description || wf.file}
                    >
                      <FileText className={styles.listIcon} />
                      <span className={styles.listText}>
                        <span className={styles.listName}>{wf.name}</span>
                        <span className={styles.listFile}>
                          {wf.file}
                          {typeof wf.protocolsCount === "number" ? ` · ${wf.protocolsCount} jobs` : ""}
                        </span>
                      </span>
                    </button>
                  ))
                )}
              </div>
            </div>

            <div className={styles.formPane}>
              <TextField
                label="File name"
                value={filename}
                onChange={(e) => {
                  setFilename(e.target.value);
                  setSelectedId(null);
                }}
                placeholder="my-workflow"
                error={filename.length > 0 && !filenameValid}
                helperText={
                  filename.length > 0 && !filenameValid
                    ? "Letters, digits, '.', '_' or '-' (no folders)"
                    : existing
                      ? `${existing.file} exists and will be replaced`
                      : `Saved as ${workflowId || "<name>"}.json`
                }
                slotProps={{
                  inputLabel: LABEL_ABOVE,
                  input: { endAdornment: <span className={styles.ext}>.json</span> },
                }}
                fullWidth
                autoFocus
              />
              <TextField
                label="Label"
                slotProps={{ inputLabel: LABEL_ABOVE }}
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder={workflowId || "Workflow name shown in the lists"}
                fullWidth
              />
              <TextField
                label="Description"
                slotProps={{ inputLabel: LABEL_ABOVE }}
                className={styles.descriptionField}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                multiline
                minRows={3}
                fullWidth
              />
              {saveError ? <Alert severity="error">{saveError}</Alert> : null}
            </div>
          </div>
        </DialogContent>

        <DialogActions>
          <Button
            onClick={clearForm}
            disabled={busy || !(filename || label || description || selectedId)}
            title="Clear the file name, label and description"
            sx={{ textTransform: "none", mr: "auto" }}
          >
            Clear
          </Button>
          <Button onClick={onClose} disabled={busy} sx={{ textTransform: "none" }}>
            Cancel
          </Button>
          <Button
            variant="contained"
            onClick={handleSave}
            disabled={busy || !filenameValid || protocolIds.length === 0}
            sx={{ textTransform: "none" }}
          >
            {busy ? "Saving…" : existing ? "Replace" : "Save"}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={open && confirmOverwrite} onClose={() => setConfirmOverwrite(false)} maxWidth="xs">
        <DialogTitle>Replace workflow?</DialogTitle>
        <DialogContent>
          <DialogContentText>
            The {categoryInfo.label.toLowerCase()} workflow <strong>{existing?.file ?? `${workflowId}.json`}</strong>
            {existing?.name && existing.name !== workflowId ? ` ("${existing.name}")` : ""} already
            exists. Do you want to overwrite it?
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmOverwrite(false)} sx={{ textTransform: "none" }}>
            Cancel
          </Button>
          <Button
            color="warning"
            variant="contained"
            onClick={() => {
              setConfirmOverwrite(false);
              void doSave(true);
            }}
            sx={{ textTransform: "none" }}
          >
            Overwrite
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}

export default WorkflowExportDialog;
