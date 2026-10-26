export type WizardDescriptor = {
  id: string;
  className?: string;
  module?: string;
  kind?: string;
  interactive?: boolean;
  webSupported?: boolean;
  webView?: string | null;
  displayParam?: string | null;
  targetParams?: string[];
};

export type WizardUiProps = {
  hasWizard: boolean;
  onOpenWizard?: () => void;
  wizardTooltip?: string;
};

export function getWizardDescriptor(paramDef: any): WizardDescriptor | null {
  const candidates: any[] = [];

  if (paramDef?.wizard && typeof paramDef.wizard === "object") {
    candidates.push(paramDef.wizard);
  }

  if (Array.isArray(paramDef?.wizards)) {
    candidates.push(...paramDef.wizards);
  }

  for (const item of candidates) {
    if (!item || typeof item !== "object") continue;

    const id = String(item.id ?? "").trim();
    if (!id) continue;

    return {
      id,
      className: typeof item.className === "string" ? item.className : undefined,
      module: typeof item.module === "string" ? item.module : undefined,
      kind: typeof item.kind === "string" ? item.kind : undefined,
      interactive: typeof item.interactive === "boolean" ? item.interactive : undefined,
      webSupported: typeof item.webSupported === "boolean" ? item.webSupported : undefined,
      webView: typeof item.webView === "string" ? item.webView : null,
      displayParam: typeof item.displayParam === "string" ? item.displayParam : null,
      targetParams: Array.isArray(item.targetParams) ? item.targetParams : undefined,
    };
  }

  return null;
}

export function hasWizardMetadata(paramDef: any): boolean {
  if (!paramDef || typeof paramDef !== "object") return false;

  if (paramDef.hasWizard === true) return true;
  if (paramDef.wizard && typeof paramDef.wizard === "object") return true;
  if (Array.isArray(paramDef.wizards) && paramDef.wizards.length > 0) return true;

  return false;
}

export function getWizardTooltip(
  stateKey: string,
  paramDef: any,
  paramsByStateKey?: Record<string, any>,
): string {
  const liveParam = paramsByStateKey?.[stateKey] ?? {};
  const mergedDef = { ...(paramDef ?? {}), ...liveParam };
  const wizard = getWizardDescriptor(mergedDef);

  if (!wizard) return "Wizard available";

  const kindLabel = String(wizard.kind ?? "")
    .replace(/_/g, " ")
    .trim();

  if (wizard.webSupported === false) {
    return kindLabel
      ? `Wizard available (${kindLabel}, not supported yet)`
      : "Wizard available (not supported yet)";
  }

  if (wizard.className) {
    return kindLabel
      ? `Open wizard (${wizard.className} · ${kindLabel})`
      : `Open wizard (${wizard.className})`;
  }

  return kindLabel ? `Open wizard (${kindLabel})` : "Open wizard";
}

export function buildWizardUiProps(args: {
  stateKey?: string | null;
  paramDef: any;
  paramsByStateKey?: Record<string, any>;
  onOpenWizardForParam?: (stateKey: string, paramDef: any) => void;
}): WizardUiProps {
  const {
    stateKey,
    paramDef,
    paramsByStateKey,
    onOpenWizardForParam,
  } = args;

  const hasWizard = hasWizardMetadata(paramDef);

  if (!hasWizard) {
    return { hasWizard: false };
  }

  if (!stateKey) {
    return { hasWizard: true };
  }

  return {
    hasWizard: true,
    onOpenWizard:
      onOpenWizardForParam != null
        ? () => onOpenWizardForParam(stateKey, paramDef)
        : undefined,
    wizardTooltip: getWizardTooltip(stateKey, paramDef, paramsByStateKey),
  };
}