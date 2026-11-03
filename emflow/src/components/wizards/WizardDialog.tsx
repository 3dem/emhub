// Dialog of a protocol form wizard (see the wizards section of the
// emflow-components skill). The server (svc.openWizard) says which wizard
// component renders the body (`ui`) and gives its inputs and read-only data;
// the component reports the selected values with onChange and OK sends them
// to svc.applyWizard (done by the caller, onApply).
import { JSX, useEffect, useState } from "react";
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
} from "@mui/material";
import type { WizardOpenResult } from "@/services/ProjectService";
import ExportTomoParticlesWizard from "./ExportTomoParticlesWizard";
import VolumeMaskWizard from "./VolumeMaskWizard";

export type WizardComponentProps = {
  inputs: Record<string, any>;
  data: Record<string, any>;
  onChange: (outputs: Record<string, any>) => void;
};

// Wizard components by the `ui` name sent by the server
const WIZARD_COMPONENTS: Record<string, (props: WizardComponentProps) => JSX.Element> = {
  ExportTomoParticlesWizard,
  VolumeMaskWizard,
};
// Wider dialogs (md by default)
const WIZARD_WIDTHS: Record<string, "md" | "lg"> = { VolumeMaskWizard: "lg" };

type WizardDialogProps = {
  wizard: WizardOpenResult | null;
  onClose: () => void;
  // Returns the errors to show (the dialog stays open), or nothing to close
  onApply: (outputs: Record<string, any>) => Promise<string[] | void>;
};

export default function WizardDialog({ wizard, onClose, onApply }: WizardDialogProps) {
  const [outputs, setOutputs] = useState<Record<string, any>>({});
  const [errors, setErrors] = useState<string[]>([]);
  const [applying, setApplying] = useState(false);

  useEffect(() => {
    setOutputs(wizard?.inputs ?? {});
    setErrors([]);
  }, [wizard]);

  const Component = wizard?.ui ? WIZARD_COMPONENTS[wizard.ui] : undefined;

  const handleOk = async () => {
    setApplying(true);
    try {
      const result = await onApply(outputs);
      if (result && result.length) setErrors(result);
    } finally {
      setApplying(false);
    }
  };

  return (
    <Dialog open={Boolean(wizard)} onClose={applying ? undefined : onClose}
            maxWidth={WIZARD_WIDTHS[wizard?.ui ?? ""] ?? "md"} fullWidth>
      <DialogTitle sx={{ fontSize: "1.05rem", fontWeight: 600 }}>
        {wizard?.label || "Wizard"}
      </DialogTitle>

      <DialogContent dividers>
        {(wizard?.warnings ?? []).map((w, i) => (
          <Alert key={`w${i}`} severity="warning" sx={{ mb: 1 }}>{w}</Alert>
        ))}
        {errors.map((e, i) => (
          <Alert key={`e${i}`} severity="error" sx={{ mb: 1, whiteSpace: "pre-wrap" }}>{e}</Alert>
        ))}

        {wizard && Component ? (
          <Component inputs={wizard.inputs ?? {}} data={wizard.data ?? {}} onChange={setOutputs} />
        ) : (
          <Box sx={{ py: 2 }}>
            <Alert severity="error">There is no wizard component '{String(wizard?.ui ?? "")}'.</Alert>
          </Box>
        )}
      </DialogContent>

      <DialogActions>
        <Button onClick={onClose} disabled={applying} sx={{ textTransform: "none" }}>
          Cancel
        </Button>
        <Button
          variant="contained"
          onClick={handleOk}
          disabled={applying || !Component}
          startIcon={applying ? <CircularProgress size={16} color="inherit" /> : undefined}
          sx={{ textTransform: "none" }}
        >
          OK
        </Button>
      </DialogActions>
    </Dialog>
  );
}
