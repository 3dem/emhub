import type { ExecuteProtocolWizardResult } from "@/services/ProjectService";

import type {
  WizardDialogOption,
  WizardInputDialogField,
  WizardInputDialogState,
} from "./protocol_wizard_types";

export function normalizeWizardAvailableValues(raw: unknown): WizardDialogOption[] {
  if (!Array.isArray(raw)) return [];

  return Array.from(
    new Map(
      raw
        .map((item) => String(item ?? "").trim())
        .filter(Boolean)
        .map((item) => [item, { value: item, label: item }]),
    ).values(),
  );
}

export function normalizeWizardDialogOptions(
  result: ExecuteProtocolWizardResult | any,
): WizardDialogOption[] {
  const normalized: WizardDialogOption[] = [];

  const pushOption = (valueRaw: unknown, labelRaw?: unknown) => {
    const value = String(valueRaw ?? "").trim();
    if (!value) return;

    const label = String(labelRaw ?? value).trim() || value;

    if (!normalized.some((item) => item.value === value)) {
      normalized.push({ value, label });
    }
  };

  const rawAvailableValues = result?.availableValues;

  if (Array.isArray(rawAvailableValues)) {
    for (const item of rawAvailableValues) {
      if (item && typeof item === "object") {
        pushOption((item as any).value, (item as any).label);
      } else {
        pushOption(item);
      }
    }
  }

  const inputSchema = result?.inputSchema;
  if (
    inputSchema &&
    inputSchema.type === "select" &&
    Array.isArray(inputSchema.options)
  ) {
    for (const option of inputSchema.options) {
      if (option && typeof option === "object") {
        pushOption(option.value, option.label);
      }
    }
  }

  return normalized;
}

export function resolveWizardPreviewUrl(svc: any, raw: unknown): string | null {
  const value = String(raw ?? "").trim();
  if (!value) return null;

  if (
    value.startsWith("data:") ||
    value.startsWith("blob:") ||
    value.startsWith("http://") ||
    value.startsWith("https://")
  ) {
    return value;
  }

  return svc.resolveBackendUrl(value) ?? value;
}

export function buildWizardInputState(args: {
  stateKey: string;
  paramName: string;
  wizardId: string;
  result: any;
  mergedDef: any;
  svc: any;
}): WizardInputDialogState {
  const { stateKey, paramName, wizardId, result, mergedDef, svc } = args;

  const schema = result?.inputSchema;
  const fields = Array.isArray(schema?.fields) ? schema.fields : [];

  const values: Record<string, string> = {};
  for (const field of fields) {
    const fieldName = String(field?.name ?? "").trim();
    if (!fieldName) continue;
    values[fieldName] = String(field?.value ?? "");
  }

  const previewImageUrl =
    resolveWizardPreviewUrl(svc, result?.preview?.imageUrl) ?? "";

  return {
    kind: "input",
    open: true,
    stateKey,
    paramName,
    wizardId,
    title: String(schema?.title ?? mergedDef?.label ?? paramName),
    fields: fields as WizardInputDialogField[],
    values,
    message: String(result?.message ?? "").trim(),
    previewImageUrl,
  };
}