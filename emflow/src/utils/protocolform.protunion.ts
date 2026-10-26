import { normalizeEnumOptions, resolveParamClass } from "@/utils/protocolform.utils";

export function getEnumDisplayText(param: any): string | null {
  // getEnumDisplayText
  if (!param) return null;

  const options = normalizeEnumOptions(param.choices);
  const raw = param.editableValue ?? param.value ?? param.default ?? null;

  if (raw === null || raw === undefined) return null;

  if (typeof raw === "number" && Number.isFinite(raw)) {
    return options[raw]?.label?.trim() || null;
  }

  const rawText = String(raw).trim();
  if (!rawText) return null;

  const byValue = options.find((opt) => opt.value === rawText);
  if (byValue) return byValue.label.trim();

  const byLabel = options.find((opt) => opt.label === rawText);
  if (byLabel) return byLabel.label.trim();

  return rawText;
}

export function mapProtUnionSetInputTypeToPointerClass(
  inputTextRaw: string | null
): string | null {
  // mapProtUnionSetInputTypeToPointerClass
  const inputText = String(inputTextRaw ?? "").trim();
  if (!inputText) return null;

  if (inputText === "All") {
    return "EMSet";
  }

  let pointerClass = `SetOf${inputText}`;

  if (inputText === "Volumes" || inputText === "Volume") {
    pointerClass += ",Volume";
  } else if (inputText === "CTFs" || inputText === "CTF") {
    pointerClass = "SetOfCTF,CTFModel";
  }

  return pointerClass;
}

export function getProtUnionDerivedPointerClass(
  params: Record<string, any>
): string | null {
  // getProtUnionDerivedPointerClass
  const inputTypeKey = Object.keys(params ?? {}).find((key) => key.endsWith("_inputType"));
  if (!inputTypeKey) return null;

  const inputTypeParam = params[inputTypeKey];
  const inputText = getEnumDisplayText(inputTypeParam);

  return mapProtUnionSetInputTypeToPointerClass(inputText);
}

export function applyProtUnionPointerClassToParams(
  params: Record<string, any>,
  pointerClass: string | null
): Record<string, any> {
  // applyProtUnionPointerClassToParams
  if (!pointerClass) return params;

  let changed = false;
  const nextParams: Record<string, any> = { ...params };

  for (const [stateKey, param] of Object.entries(nextParams)) {
    if (stateKey.endsWith("_inputType")) continue;

    const resolvedClass = resolveParamClass(param);

    if (resolvedClass !== "PointerParam" && resolvedClass !== "MultiPointerParam") {
      continue;
    }

    if ((param as any)?.pointerClass === pointerClass) {
      continue;
    }

    nextParams[stateKey] = {
      ...(param as any),
      pointerClass,
    };
    changed = true;
  }

  return changed ? nextParams : params;
}

export function syncProtUnionPointerClassInParams(
  params: Record<string, any>
): Record<string, any> {
  // syncProtUnionPointerClassInParams
  const pointerClass = getProtUnionDerivedPointerClass(params);
  return applyProtUnionPointerClassToParams(params, pointerClass);
}