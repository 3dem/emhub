// src/components/ProtocolForm.tsx
import { useState, useEffect, useCallback, JSX, useRef, useMemo } from "react";
import * as React from "react";
import toast from "react-hot-toast";
import {
  Tabs,
  Tab,
  Box,
  Typography,
  Button,
  Tooltip,
  CircularProgress,
  IconButton,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  MenuItem,
  FormControl,
  InputLabel,
  Select,
} from "@mui/material";
import styles from "./protocolform.module.css";
import {
  ChevronDownIcon,
  ChevronUpIcon,
  CloseIcon,
  ExecuteIcon,
  SaveIcon,
  HelpIcon,
} from "@/icons";
import MultiParamRow from "./MultiParamRow";
import TableParamRow from "./TableParamRow";
import ParamRow from "./ParamRow";
import OutputSelectorDialog from "./outputSelectorDialog";
import { useProjectService } from "@/ProjectServiceContext";
import RemoteFileDialog from "@/components/files/RemoteFileDialog";
import ExecuteModeButton from "./ExecuteModeButton";
import { useProtocolLogs } from "@/hooks/useProtocolLogs";
import ProtocolLogsPanel from "./ProtocolLogsPanel";
import ProtocolOutputsPanel from "./ProtocolOutputsPanel";
import ProtocolMetadataPanel from "./ProtocolMetadataPanel";
import ProtocolHelpDialog from "./ProtocolHelpDialog";
import ExecErrorDialog from "./ExecErrorDialog";
import ValidationErrorsDialog from "./ValidationErrorsDialog";
import {
  getParamClass,
  isNonEmptyString,
  resolveParamClass,
  withResolvedParamClass,
  unwrapParamDef,
  parseFromJSONValue,
  coerceBooleanValue,
  coerceReadOnlyFlag,
  coerceCollapsedFlag,
  getParamNameFromStateKey,
  getInitialRawForParam,
  normalizePointerToken,
  normalizeEnumOptions,
  normalizeEnumSelection,
  normalizeMultiPointerValue,
  buildEmptyTableRow,
  getTableColumns,
  normalizeTableParamValue,
  serializeTableParamValue,
  validateTableRows,
} from "@/utils/protocolform.utils";

import {
  getBackendPayloadFromError,
  getHttpStatusFromError,
  getErrorsFromBackendPayload,
  formatErrorsForDialog,
} from "@/utils/protocolform.errors";

import {
  buildPointerSelectionItem,
  removeMultiPointerItemAndPad,
  replaceMultiPointerItem,
  setMultiPointerSelection,
  setParamValueAndEditableValue,
  setPointerSelection,
  updateMultiPointerItem,
  updateTableCell,
  addTableRow,
  removeTableRow,
} from "@/utils/protocolform.state";

import {
  renderBooleanParamRow,
  renderDefaultParamRow,
  renderEnumParamRow,
  renderPathParamRow,
  renderPointerParamRow,
} from "./ProtocolFormRenderers"

import {
  applyProtUnionPointerClassToParams,
  getProtUnionDerivedPointerClass,
  syncProtUnionPointerClassInParams,
} from "@/utils/protocolform.protunion";

import { ProjectEffectiveSettings, ProtocolWorkflowExecutionPreflight, ProtocolWorkflowExecutionScope } from "@/services/ProjectService";
import WizardDialogHost from "./wizards/wizard-dialog-host";
import { useProtocolWizards } from "./wizards/use_protocol_wizards";
import { buildWizardUiProps } from "./wizards/protocol_wizard_meta";
import WizardLoadingDialog from "./wizards/WizardLoadingDialog";


type ProtocolFormProps = {
  data: any;
  projectProtocols: any;
  onClose: () => void;
  onExecuted?: () => void;
  onSaved?: () => void;
  /** Presentation variant: "drawer" (default) slides in from the right; "docked" fills its parent panel. */
  variant?: "drawer" | "docked";
  projectEffectiveSettings?: ProjectEffectiveSettings | null;
  interactivePreviewLoading?: boolean;
};

type EffectiveHostQueueParam = {
  variableName: string;
  value: string;
  label: string;
  help: string;
};

type EffectiveHostQueue = {
  name: string;
  params: EffectiveHostQueueParam[];
};

type QueueLaunchDraftParam = {
  stateKey: string | null;
  variableName: string;
  value: string;
  label: string;
  help: string;
};

type QueueLaunchDraft = {
  queueName: string;
  params: QueueLaunchDraftParam[];
};

type PendingWorkflowExecution = {
  modeKey: "continue" | "restart";
  queueOverride: QueueLaunchDraft | null;
  preflight: ProtocolWorkflowExecutionPreflight;
};

function normalizeEffectiveHostQueues(raw: unknown): EffectiveHostQueue[] {
  if (!Array.isArray(raw)) return [];

  return raw
    .map((queue: any) => {
      const name = String(queue?.name ?? "").trim();
      if (!name) return null;

      const paramsRaw = Array.isArray(queue?.params) ? queue.params : [];
      const params = paramsRaw
        .map((param: any) => {
          const variableName = String(param?.variableName ?? "").trim();
          if (!variableName) return null;

          return {
            variableName,
            value: String(param?.value ?? ""),
            label: String(param?.label ?? ""),
            help: String(param?.help ?? ""),
          };
        })
        .filter(Boolean) as EffectiveHostQueueParam[];

      return { name, params };
    })
    .filter(Boolean) as EffectiveHostQueue[];
}

function isEmptyProtocolValue(raw: unknown): boolean {
  if (raw == null) return true;

  if (typeof raw === "string") {
    return raw.trim() === "";
  }

  if (Array.isArray(raw)) {
    if (raw.length === 0) return true;

    return raw.every((item: any) => {
      const token = normalizePointerToken(item?.object ?? item?.value ?? item);
      return !token;
    });
  }

  return false;
}

export default function ProtocolForm({
  data,
  projectProtocols = [],
  onClose,
  onExecuted,
  onSaved,
  variant = "drawer",
  projectEffectiveSettings = null,
}: ProtocolFormProps) {
  const svc = useProjectService();

  // unwrapEnvelope
  const info = useMemo(() => {
    if (data && typeof data === "object" && "info" in data) return (data as any).info ?? {};
    return {};
  }, [data]);

  // unwrapFormEnvelope
  const form = useMemo(() => {
    if (data && typeof data === "object" && "form" in data) return (data as any).form ?? {};
    return data ?? {};
  }, [data]);

  const formHelpText = useMemo(() => {
    // formHelpText
    const raw = (form as any)?.help ?? (form as any)?.helpText ?? "";
    return typeof raw === "string" ? raw : "";
  }, [form]);

  const hasFormHelp = isNonEmptyString(formHelpText);
  const [openFormHelp, setOpenFormHelp] = useState(false);

  // keepValuesForLater
  const values = useMemo(() => {
    if (!data || typeof data !== "object") return null;

    if ("values" in data) return (data as any).values ?? null;

    const formObj = (data as any).form;
    if (formObj && typeof formObj === "object" && "values" in formObj) {
      return (formObj as any).values ?? null;
    }

    return null;
  }, [data]);

  // normalizeSections
  const sections = useMemo(() => {
    const s = (form as any)?.sections ?? (form as any)?.definition ?? [];
    return Array.isArray(s) ? s : [];
  }, [form]);

  // normalizeIdsAndCoreInfo
  const projectId = info?.projectId ?? (form as any)?.projectId ?? (form as any)?.project?.id ?? null;
  const protocolId =
    info?.protocolId ?? info?.id ?? (form as any)?.protocolId ?? (form as any)?.id ?? null;
  const protocolClassName =
    info?.protocolClassName ?? (form as any)?.protocolClassName ?? null;


  const outputsFromApi = useMemo(() => {
    const arr =
      Array.isArray(info?.outputs) ? info.outputs :
        Array.isArray((form as any)?.outputs) ? (form as any).outputs :
          [];
    return arr;
  }, [info, form]);


  const executeModeMap = useMemo(() => {
    const raw = (info as any)?.executeMode ?? null;
    if (!raw || typeof raw !== "object") return null;
    return raw as Record<string, { label?: string; help?: string }>;
  }, [info]);

  const [selectedExecuteMode, setSelectedExecuteMode] = useState<string | null>(null);

  const effectiveSettingsRoot = useMemo(() => {
    const root = (projectEffectiveSettings as any)?.settings ?? projectEffectiveSettings ?? null;
    return root && typeof root === "object" ? root : null;
  }, [projectEffectiveSettings]);

  const effectiveUserSettings: any = effectiveSettingsRoot?.user ?? null;
  const effectiveInstanceSettings: any = effectiveSettingsRoot?.instance ?? null;
  const effectiveHostSettings: any = effectiveSettingsRoot?.host ?? null;

  const effectiveHostQueues = useMemo(
    () => normalizeEffectiveHostQueues(effectiveHostSettings?.queues),
    [effectiveHostSettings]
  );

  const effectiveQueueMandatory = Boolean(effectiveHostSettings?.mandatory);

  const effectiveDefaultQueueName = useMemo(() => {
    const candidates = [
      effectiveInstanceSettings?.defaultQueueName,
      effectiveInstanceSettings?.defaultQueue,
      effectiveUserSettings?.defaultQueueName,
      effectiveUserSettings?.defaultQueue,
      effectiveHostSettings?.defaultQueueName,
      effectiveHostSettings?.defaultQueue,
    ]
      .map((value) => String(value ?? "").trim())
      .filter(Boolean);

    const explicit = candidates.find((name) =>
      effectiveHostQueues.some((queue) => queue.name === name)
    );

    if (explicit) return explicit;
    return effectiveHostQueues[0]?.name ?? "";
  }, [
    effectiveInstanceSettings,
    effectiveUserSettings,
    effectiveHostSettings,
    effectiveHostQueues,
  ]);

  const preferredExecuteMode = useMemo(() => {
    const token = String(
      effectiveUserSettings?.preferredExecuteMode ??
      effectiveUserSettings?.defaultExecuteMode ??
      effectiveInstanceSettings?.preferredExecuteMode ??
      effectiveInstanceSettings?.defaultExecuteMode ??
      ""
    ).trim();

    if (!token || !executeModeMap) return "";
    return executeModeMap[token] ? token : "";
  }, [effectiveUserSettings, effectiveInstanceSettings, executeModeMap]);

  useEffect(() => {
    if (!executeModeMap) return;

    const keys = Object.keys(executeModeMap);
    if (keys.length === 0) return;

    setSelectedExecuteMode((prev) => {
      if (prev && executeModeMap[prev]) return prev;
      if (preferredExecuteMode && executeModeMap[preferredExecuteMode]) return preferredExecuteMode;
      return keys[0];
    });
  }, [executeModeMap, preferredExecuteMode]);


  const [topTab, setTopTab] = useState(0);
  const [sectionTab, setSectionTab] = useState(0);
  const [protocolDetails, setProtocolDetails] = useState<any>({});
  const effectiveProtocolId = String(protocolDetails?.id ?? protocolId ?? "").trim();
  const protocolDisplayName = useMemo(() => {
    const candidates = [
      protocolDetails?.runName,
      info?.runName,
      (form as any)?.runName,
      protocolDetails?.label,
      info?.protocolName,
      info?.label,
      (form as any)?.protocolName,
      protocolId,
    ];

    for (const candidate of candidates) {
      const value = String(candidate ?? "").trim();
      if (value) return value;
    }

    return "";
  }, [protocolDetails?.runName, protocolDetails?.label, info, form, protocolId]);

  const [expandedGroups, setExpandedGroups] = useState<{ [key: string]: boolean }>({});

  // actionLoadingState
  const [actionLoading, setActionLoading] = useState<"save" | "execute" | null>(null);
  const isSaving = actionLoading === "save";
  const isExecuting = actionLoading === "execute";
  const isBusy = actionLoading !== null;

  // Exit animation state
  const [isClosing, setIsClosing] = useState(false);

  // Drag/drop state
  const [dragOverKey, setDragOverKey] = useState<string | null>(null);
  const [currentDraggedOutput] = useState<any>(null);

  //Logs
  const {
    sortedLogChannels,
    activeLogChannelId,
    setActiveLogChannelId,
    activeLogText,
    logsError,
    logsContainerRef,
    updateStickToBottom,
  } = useProtocolLogs({
    svc,
    enabled: topTab === 2,
    projectId,
    protocolId: effectiveProtocolId,
    protocolStatus: protocolDetails.status,
  });

  const [validationErrors, setValidationErrors] = useState<string[]>([]);
  const [showValidationDialog, setShowValidationDialog] = useState(false);
  const [execErrorDialogOpen, setExecErrorDialogOpen] = useState(false);
  const [execErrorDialogTitle, setExecErrorDialogTitle] = useState("Error");
  const [execErrorDialogMessage, setExecErrorDialogMessage] = useState<string>("");

  const [queueDialogOpen, setQueueDialogOpen] = useState(false);
  const [pendingExecuteMode, setPendingExecuteMode] = useState<string | null>(null);
  const [queueDraft, setQueueDraft] = useState<QueueLaunchDraft | null>(null);
  const [pendingWorkflowExecution, setPendingWorkflowExecution] = useState<PendingWorkflowExecution | null>(null);

  // Global Output Selector
  const [openSelector, setOpenSelector] = useState(false);
  const [selectorTarget, setSelectorTarget] = useState<{
    key: string;
    def?: any;
    expectedClass?: string | string[] | null;
  } | null>(null);
  const [expectedClass, setExpectedClass] = useState<string | string[] | null | undefined>(undefined);
  const [allOutputs, setAllOutputs] = useState<any[]>([]);
  // Tracks last committed label for inputType to detect user changes
  const prevSelectedInputTypeRef = useRef<string | null>(null);
  const initializedProtocolKeyRef = useRef<string | null>(null);

  // --------------------------------------------
  // Metadata tab snapshot
  // --------------------------------------------
  const [metadataSnapshot, setMetadataSnapshot] = useState<any>(data);

  const [pathDialog, setPathDialog] = useState<{
    open: boolean;
    stateKey: string | null;
    title: string | null;
  }>({
    open: false,
    stateKey: null,
    title: null,
  });

  const [groupHelpDialog, setGroupHelpDialog] = useState<{
    open: boolean;
    text: string;
  }>({
    open: false,
    text: "",
  });


  const headerActionBtnSx = {
    // headerActionBtnSx
    color: "#e5e7eb",
    border: "1px solid rgba(255,255,255,0.18)",
    background: "rgba(255,255,255,0.06)",
    "&:hover": {
      background: "rgba(255,255,255,0.12)",
      borderColor: "rgba(255,255,255,0.28)",
    },
  };

  // Use this instead of onClose() directly to play exit animation
  const requestClose = () => setIsClosing(true);
  const handleAnimationEnd = () => {
    // Only propagate close to parent after the exit animation completes
    if (isClosing) onClose();
  };


  const coerceToken = (raw: any) => {
    if (raw === undefined || raw === null) return "";
    if (typeof raw === "boolean" || typeof raw === "number") return raw;
    if (typeof raw !== "string") return raw;
    const trimmed = raw.trim();
    if (/^["'].*["']$/.test(trimmed)) return trimmed.slice(1, -1);
    if (/^(True|true)$/.test(trimmed)) return true;
    if (/^(False|false)$/.test(trimmed)) return false;
    if (!isNaN(Number(trimmed))) return Number(trimmed);
    return trimmed;
  };

  const getParamCurrentValue = (sectionIdx: number, paramName: string) => {
    const key = `${sectionIdx}_${paramName}`;
    const state = protocolDetails.params?.[key];
    if (!state) return "";
    if (getParamClass(state) === "EnumParam" && state.choices) {
      const choicesRaw = state.choices;

      // arrayChoicesReturnIndexForLegacyConditions
      if (Array.isArray(choicesRaw)) {
        const v = state.editableValue ?? state.default ?? "";
        if (typeof v === "number") return v;

        if (typeof v === "string" && /^\d+$/.test(v.trim())) {
          return Number(v.trim());
        }

        const idx = choicesRaw.indexOf(v);
        return idx >= 0 ? idx : 0;
      }

      // dictChoicesReturnKey
      if (choicesRaw && typeof choicesRaw === "object") {
        const options = normalizeEnumOptions(choicesRaw);
        const v = state.editableValue ?? state.default ?? "";

        if (typeof v === "number" && Number.isFinite(v)) {
          return options[v]?.value ?? options[0]?.value ?? "";
        }

        if (typeof v === "string") {
          const trimmed = v.trim();

          // ifKeyExistsReturnKey
          if (Object.prototype.hasOwnProperty.call(choicesRaw, trimmed)) return trimmed;

          // ifValueProvidedReturnMatchingKey
          const byLabel = options.find((o) => o.label === trimmed);
          if (byLabel) return byLabel.value;

          // numericStringAsIndex
          if (/^\d+$/.test(trimmed)) {
            const idx = Number(trimmed);
            return options[idx]?.value ?? options[0]?.value ?? "";
          }

          return options[0]?.value ?? "";
        }

        return options[0]?.value ?? "";
      }
    }

    return state.editableValue ?? "";
  };

  // Locate the global expertLevel EnumParam if present
  const findGeneralExpertLocator = useCallback(() => {
    if (!Array.isArray(sections)) return null;

    for (let i = 0; i < sections.length; i++) {
      const section = sections[i];
      const params = section?.params ?? [];
      for (const p of params) {
        const { paramName, paramDef: def } = unwrapParamDef(p);
        if (paramName === "expertLevel" && getParamClass(def) === "EnumParam") {
          return { sectionIdx: i, name: paramName };
        }
      }
    }
    return null;
  }, [sections]);

  // 0 = Normal, 1 = Advanced
  const generalExpertLevel = (() => {
    const loc = findGeneralExpertLocator();
    if (!loc) return null;
    const v = getParamCurrentValue(loc.sectionIdx, "expertLevel");
    return typeof v === "number" ? v : Number(v) || 0;
  })();

  // Show/hide params with logical conditions
  const evalAtom = (sectionIdx: number, atom: string): boolean => {
    let a = atom.replace(/[()]/g, "").trim();
    let neg = false;
    if (/^not\s+/i.test(a)) {
      neg = true;
      a = a.replace(/^not\s+/i, "").trim();
    } else if (a.startsWith("!")) {
      neg = true;
      a = a.slice(1).trim();
    }
    const m = a.match(/^(.*?)\s*(==|!=|>=|<=|>|<|=)\s*(.*)$/);
    let res = false;
    if (m) {
      const [, leftRaw, opRaw, rightRaw] = m;
      const left = coerceToken(getParamCurrentValue(sectionIdx, leftRaw.trim()));
      const op = opRaw === "=" ? "==" : opRaw;
      const right = coerceToken(rightRaw.replace(/[()]/g, "").trim());
      switch (op) {
        case "==":
          res = left === right;
          break;
        case "!=":
          res = left !== right;
          break;
        case ">":
          res = (left as any) > (right as any);
          break;
        case "<":
          res = (left as any) < (right as any);
          break;
        case ">=":
          res = (left as any) >= (right as any);
          break;
        case "<=":
          res = (left as any) <= (right as any);
          break;
      }
    } else {
      const v = coerceToken(getParamCurrentValue(sectionIdx, a));
      res = !!(v === true || v === "True" || v === 1 || v === "1");
    }
    return neg ? !res : res;
  };

  const evalExpr = (sectionIdx: number, exprRaw: string): boolean => {
    const expr = exprRaw
      .replace(/[()]/g, " ")
      .replace(/\band\b/gi, "&&")
      .replace(/\bor\b/gi, "||")
      .replace(/\s+/g, " ")
      .trim();
    if (!expr) return true;
    return expr
      .split("||")
      .some((part) => part.split("&&").every((atom) => evalAtom(sectionIdx, atom.trim())));
  };

  // Load initial parameters into protocolDetails
  useEffect(() => {
    if (!form) {
      setProtocolDetails({});
      initializedProtocolKeyRef.current = null;
      return;
    }

    const protocolKey = `${protocolId ?? "new"}:${protocolClassName ?? ""}`;

    if (initializedProtocolKeyRef.current === protocolKey) {
      setProtocolDetails((prev: any) => ({
        ...prev,
        label:
          info?.protocolName ??
          info?.label ??
          (form as any)?.protocolName ??
          prev?.label ??
          "",
        runName:
          info?.runName ??
          (form as any)?.runName ??
          info?.protocolName ??
          (form as any)?.protocolName ??
          prev?.runName ??
          prev?.label ??
          "",
        status:
          info?.status ??
          (form as any)?.status ??
          prev?.status ??
          "",
        id: protocolId ?? prev?.id ?? "",
        color:
          info?.color ??
          (form as any)?.color ??
          prev?.color ??
          "",
      }));

      setMetadataSnapshot(data);
      return;
    }

    initializedProtocolKeyRef.current = protocolKey;

    const valuesMap = values && typeof values === "object" ? values : null;

    const params: any = {};
    const walk = (secIdx: number, paramLike: any) => {
      // walkParamDefinitionTree
      const { paramName: name, paramDef: def } = unwrapParamDef(paramLike);
      if (!def) return;

      const rawDef = def;
      const defResolved = withResolvedParamClass(rawDef);
      const cls = resolveParamClass(defResolved);

      // Always traverse decorators even when name is missing
      // Decorators should never create state keys; just traverse children if present
      if (cls === "Group" || cls === "Line") {
        const children = Array.isArray(rawDef?.params) ? rawDef.params : [];
        children.forEach((c: any) => walk(secIdx, c));
        return;
      }

      // Label is a pure decorator (no value stored)
      if (cls === "Label") {
        return;
      }


      // For real params, name is required to create a state key
      if (!name) return;

      const key = `${secIdx}_${name}`;

      // Use values[name] as source of truth (fallback to def.value/def.default)
      const rawFromApi = getInitialRawForParam(name, def, valuesMap);
      const parsedFromApi = parseFromJSONValue(rawFromApi);

      if (cls === "BooleanParam") {
        const initBool = coerceBooleanValue(parsedFromApi);

        const defObjValue = parseFromJSONValue(def.value);
        const defDefault = parseFromJSONValue(def.default);

        params[key] = {
          ...defResolved,
          value: coerceBooleanValue(defObjValue),
          default: coerceBooleanValue(defDefault),
          editableValue: initBool,
        };
        return;
      }

      if (cls === "MultiPointerParam") {
        // If valuesMap provides an empty/null value, fallback to def.value/def.default
        const rawCandidate = getInitialRawForParam(name, def, valuesMap);
        const fallbackRaw = def?.value ?? def?.default ?? [];
        const rawEffective =
          rawCandidate === null || rawCandidate === undefined || rawCandidate === ""
            ? fallbackRaw
            : rawCandidate;

        const initList = normalizeMultiPointerValue(rawEffective);

        params[key] = {
          ...def,
          editableValue: initList,
        };
        return;
      }

      if (cls === "TableParam") {
        const columns = getTableColumns(def);
        const rawCandidate = getInitialRawForParam(name, def, valuesMap);
        const fallbackRaw = def?.value ?? def?.default ?? "[]";
        const rawEffective =
          rawCandidate === null || rawCandidate === undefined || rawCandidate === ""
            ? fallbackRaw
            : rawCandidate;

        params[key] = {
          ...defResolved,
          paramClass: "TableParam",
          editableValue: normalizeTableParamValue(rawEffective, columns),
        };
        return;
      }


      if (cls === "PointerParam") {
        const token = normalizePointerToken(rawFromApi);
        params[key] = {
          ...defResolved,
          paramClass: "PointerParam",
          value: token,
          editableValue: token,
        };
        return;
      }

      if (cls === "PathParam") {
        const token = parsedFromApi ?? "";
        params[key] = {
          ...defResolved,
          paramClass: "PathParam",
          value: token,
          editableValue: token,
        };
        return;
      }

      if (cls === "EnumParam" && def.choices) {
        const selected = normalizeEnumSelection(rawFromApi, def.choices, def.default);
        params[key] = {
          ...defResolved,
          editableValue: selected,
        };
        return;
      }


      params[key] = {
        ...defResolved,
        editableValue: parsedFromApi ?? "",
      };
    };


    sections.forEach((section: any, i: number) => {
      section?.params?.forEach((p: any) => walk(i, p));
    });

    let finalParams = params;

    if (protocolClassName === "ProtUnionSet") {
      finalParams = syncProtUnionPointerClassInParams(params);
      prevSelectedInputTypeRef.current = getProtUnionDerivedPointerClass(finalParams);
    }

    setProtocolDetails({
      label: info?.protocolName ?? info?.label ?? (form as any)?.protocolName ?? "",
      runName:
        info?.runName ??
        (form as any)?.runName ??
        info?.protocolName ??
        (form as any)?.protocolName ??
        "",
      status: info?.status ?? (form as any)?.status ?? "",
      id: protocolId ?? "",
      color: info?.color ?? (form as any)?.color ?? "",
      params: finalParams,
    });
  }, [form, info, values, sections, protocolId, protocolClassName]);


  const findStateKeyByParamNames = useCallback(
    (paramsObj: Record<string, any> | undefined, names: string[]) => {
      const normalizedNames = new Set(
        names
          .map((name) => String(name ?? "").trim().toLowerCase())
          .filter(Boolean)
      );

      for (const stateKey of Object.keys(paramsObj ?? {})) {
        const paramName = String(getParamNameFromStateKey(stateKey) ?? "")
          .trim()
          .toLowerCase();

        if (normalizedNames.has(paramName)) {
          return stateKey;
        }
      }

      return null;
    },
    []
  );

  const queueNameStateKey = useMemo(
    () =>
      findStateKeyByParamNames(protocolDetails.params, [
        "queueName",
        "_queueName",
        "queue_name",
        "queue",
      ]),
    [protocolDetails.params, findStateKeyByParamNames]
  );

  const useQueueStateKey = useMemo(
    () =>
      findStateKeyByParamNames(protocolDetails.params, [
        "useQueue",
        "_useQueue",
        "use_queue",
      ]),
    [protocolDetails.params, findStateKeyByParamNames]
  );

  const activeQueueName = useMemo(() => {
    if (!queueNameStateKey) return effectiveDefaultQueueName;

    const current = protocolDetails.params?.[queueNameStateKey];
    const currentName = String(current?.editableValue ?? current?.value ?? "").trim();

    return currentName || effectiveDefaultQueueName;
  }, [protocolDetails.params, queueNameStateKey, effectiveDefaultQueueName]);

  const activeQueueDef = useMemo(() => {
    if (!activeQueueName) return null;
    return effectiveHostQueues.find((queue) => queue.name === activeQueueName) ?? null;
  }, [effectiveHostQueues, activeQueueName]);


  const useQueueEnabled = useMemo(() => {
    if (!useQueueStateKey) return false;

    const current = protocolDetails.params?.[useQueueStateKey];
    return coerceBooleanValue(
      current?.editableValue ?? current?.value ?? current?.default
    );
  }, [protocolDetails.params, useQueueStateKey]);

  const hasConfiguredQueues = effectiveHostQueues.length > 0;

  const hasAnyQueueParams = effectiveHostQueues.some(
    (queue) => Array.isArray(queue.params) && queue.params.length > 0
  );

  const buildQueueDraft = useCallback(
    (queueNameRaw?: string): QueueLaunchDraft | null => {
      if (!effectiveHostQueues.length) return null;

      const requestedQueueName = String(
        queueNameRaw ?? activeQueueName ?? effectiveDefaultQueueName ?? ""
      ).trim();

      const selectedQueue =
        effectiveHostQueues.find((queue) => queue.name === requestedQueueName) ??
        effectiveHostQueues[0];

      if (!selectedQueue) return null;

      return {
        queueName: selectedQueue.name,
        params: selectedQueue.params.map((queueParam) => {
          const stateKey = findStateKeyByParamNames(protocolDetails.params, [
            queueParam.variableName,
          ]);

          return {
            stateKey,
            variableName: queueParam.variableName,
            value: String(queueParam.value ?? ""),
            label: String(queueParam.label ?? ""),
            help: String(queueParam.help ?? ""),
          };
        }),
      };
    },
    [
      effectiveHostQueues,
      activeQueueName,
      effectiveDefaultQueueName,
      protocolDetails.params,
      findStateKeyByParamNames,
    ]
  );

  const handleQueueDraftQueueChange = useCallback(
    (nextQueueName: string) => {
      setQueueDraft(() => {
        const selectedQueue =
          effectiveHostQueues.find((queue) => queue.name === nextQueueName) ?? null;

        if (!selectedQueue) return null;

        return {
          queueName: selectedQueue.name,
          params: selectedQueue.params.map((queueParam) => {
            const stateKey = findStateKeyByParamNames(protocolDetails.params, [
              queueParam.variableName,
            ]);

            return {
              stateKey,
              variableName: queueParam.variableName,
              value: String(queueParam.value ?? ""),
              label: String(queueParam.label ?? ""),
              help: String(queueParam.help ?? ""),
            };
          }),
        };
      });
    },
    [effectiveHostQueues, protocolDetails.params, findStateKeyByParamNames]
  );

  const applyQueueDraftToProtocolState = useCallback(
    (draft: QueueLaunchDraft) => {
      setProtocolDetails((prev: any) => {
        const currentParams = prev?.params ?? {};
        let nextParams = currentParams;

        const ensureClone = () => {
          if (nextParams === currentParams) {
            nextParams = { ...currentParams };
          }
        };

        if (queueNameStateKey) {
          const current = nextParams[queueNameStateKey] ?? currentParams[queueNameStateKey] ?? {};
          const currentValue = String(current?.editableValue ?? current?.value ?? "").trim();

          if (currentValue !== draft.queueName) {
            ensureClone();
            nextParams[queueNameStateKey] = {
              ...current,
              editableValue: draft.queueName,
            };
          }
        }

        if (useQueueStateKey) {
          const current = nextParams[useQueueStateKey] ?? currentParams[useQueueStateKey] ?? {};
          const currentValue = coerceBooleanValue(
            current?.editableValue ?? current?.value ?? current?.default
          );

          if (!currentValue) {
            ensureClone();
            nextParams[useQueueStateKey] = {
              ...current,
              editableValue: true,
            };
          }
        }

        for (const queueParam of draft.params) {
          if (!queueParam.stateKey) continue;

          const current =
            nextParams[queueParam.stateKey] ?? currentParams[queueParam.stateKey] ?? {};

          const currentValue = String(current?.editableValue ?? current?.value ?? "");
          if (currentValue !== queueParam.value) {
            ensureClone();
            nextParams[queueParam.stateKey] = {
              ...current,
              editableValue: queueParam.value,
            };
          }
        }

        if (nextParams === currentParams) return prev;
        return { ...prev, params: nextParams };
      });
    },
    [queueNameStateKey, useQueueStateKey]
  );

  const mergeQueueDraftIntoParams = useCallback(
    (baseParams: Record<string, any>, draft: QueueLaunchDraft | null) => {
      if (!draft) return baseParams;

      const merged: Record<string, any> = {
        ...baseParams,
        _useQueue: true,
        _queueName: draft.queueName,
      };

      const queueParamsMap: Record<string, string> = {};

      for (const queueParam of draft.params) {
        queueParamsMap[queueParam.variableName] = queueParam.value;
        merged[queueParam.variableName] = queueParam.value;
      }

      merged._queueParams = queueParamsMap;
      return merged;
    },
    []
  );

  useEffect(() => {
    if (!effectiveHostQueues.length) return;

    setProtocolDetails((prev: any) => {
      const currentParams = prev?.params ?? {};
      let nextParams = currentParams;

      const ensureClone = () => {
        if (nextParams === currentParams) {
          nextParams = { ...currentParams };
        }
      };

      if (queueNameStateKey && effectiveDefaultQueueName) {
        const current = currentParams[queueNameStateKey] ?? {};
        const currentValue = String(current?.editableValue ?? current?.value ?? "").trim();

        if (!currentValue) {
          ensureClone();
          nextParams[queueNameStateKey] = {
            ...current,
            editableValue: effectiveDefaultQueueName,
          };
        }
      }

      if (useQueueStateKey) {
        const current = currentParams[useQueueStateKey] ?? {};
        const currentValue = current?.editableValue ?? current?.value ?? current?.default;

        const shouldEnableQueue = effectiveQueueMandatory || Boolean(effectiveDefaultQueueName);
        const isUnset =
          currentValue === undefined || currentValue === null || currentValue === "";

        const shouldWrite =
          effectiveQueueMandatory
            ? !coerceBooleanValue(currentValue)
            : shouldEnableQueue && isUnset;

        if (shouldWrite) {
          ensureClone();
          nextParams[useQueueStateKey] = {
            ...current,
            editableValue: true,
          };
        }
      }

      if (nextParams === currentParams) return prev;
      return { ...prev, params: nextParams };
    });
  }, [
    effectiveHostQueues,
    effectiveDefaultQueueName,
    effectiveQueueMandatory,
    queueNameStateKey,
    useQueueStateKey,
  ]);

  useEffect(() => {
    if (!activeQueueDef) return;

    setProtocolDetails((prev: any) => {
      const currentParams = prev?.params ?? {};
      let nextParams = currentParams;

      const ensureClone = () => {
        if (nextParams === currentParams) {
          nextParams = { ...currentParams };
        }
      };

      for (const queueParam of activeQueueDef.params) {
        const paramStateKey = findStateKeyByParamNames(currentParams, [
          queueParam.variableName,
        ]);

        if (!paramStateKey) continue;

        const current = nextParams[paramStateKey] ?? currentParams[paramStateKey] ?? {};
        let nextParam = current;

        if (
          isEmptyProtocolValue(current?.editableValue) &&
          !isEmptyProtocolValue(queueParam.value)
        ) {
          nextParam = {
            ...nextParam,
            editableValue: queueParam.value,
          };
        }

        if (!isNonEmptyString(current?.label) && isNonEmptyString(queueParam.label)) {
          if (nextParam === current) nextParam = { ...nextParam };
          nextParam.label = queueParam.label;
        }

        if (!isNonEmptyString(current?.help) && isNonEmptyString(queueParam.help)) {
          if (nextParam === current) nextParam = { ...nextParam };
          nextParam.help = queueParam.help;
        }

        if (nextParam !== current) {
          ensureClone();
          nextParams[paramStateKey] = nextParam;
        }
      }

      if (nextParams === currentParams) return prev;
      return { ...prev, params: nextParams };
    });
  }, [activeQueueDef, findStateKeyByParamNames]);

  const isWildcardExpectedClass = (raw: unknown): boolean => {
    const tokens = splitClassList(raw).map((item) => item.replace(/\s+/g, "").toLowerCase());
    return tokens.includes("all") || tokens.includes("emset");
  };

  const splitClassList = (raw: unknown): string[] => {
    if (Array.isArray(raw)) {
      return Array.from(new Set(raw.flatMap((item) => splitClassList(item))));
    }

    const text = String(raw ?? "").trim();
    if (!text) return [];

    return Array.from(
      new Set(
        text
          .split(",")
          .map((part) => part.trim())
          .filter((part) => part.length > 0)
      )
    );
  };


  // Live expected-class reader for pointer-like params
  const getExpectedClass = (def: any): string | string[] | null => {
    if (!def) return null;

    const candidates = [
      def.pointerClass,
      def.pointerClassName,
      def.accept,
      def.accepts,
      def.accepted,
      def.objectClass,
      def.targetClass,
      def._expectedClass,
      def.acceptsClass,
      def.type,
      def._type,
      def._classAccepted,
      def.class,
    ];

    const flat: string[] = [];

    for (const candidate of candidates) {
      const tokens = splitClassList(candidate);
      for (const token of tokens) {
        if (!flat.includes(token)) {
          flat.push(token);
        }
      }
    }

    const isParamMeta = (s: string) =>
      /pointerparam$/i.test(s) || /multipointerparam$/i.test(s);

    const filtered = flat.filter((s) => !isParamMeta(s));

    if (filtered.length === 0) return null;
    return filtered.length === 1 ? filtered[0] : filtered;
  };

  // Collect outputs from all protocols (for the input selector)
  const gatherAllOutputs = useCallback((): { outputs: any[]; dependencyMap: Record<string, string[]> } => {
    if (!projectProtocols) return { outputs: [], dependencyMap: {} };

    const protocolsArray = Array.isArray(projectProtocols) ? projectProtocols : Object.values(projectProtocols);

    const outputs: any[] = [];
    const dependencyMap: Record<string, string[]> = {};

    for (const prot of protocolsArray) {
      const pid = String(prot.id);
      dependencyMap[pid] = (prot.children ?? []).map(String);
      if (!Array.isArray(prot.outputs)) continue;

      for (const outRaw of prot.outputs) {
        const hasOutputName = outRaw && typeof outRaw === "object" && "outputName" in outRaw;
        const out = hasOutputName ? (outRaw as any) : (outRaw as any);
        const key = String(out?.outputName ?? out?._key ?? out?.name ?? "");
        if (!key) continue;

        outputs.push({
          protocol: prot.label ?? prot.protocolName ?? prot.id ?? "Unknown",
          key,
          info: out?.info ?? "",
          paramClass: String(out?.paramClass ?? "PointerParam"),
          pointerClass: String(out?.pointerClass ?? ""),
          value: String(out?.value ?? ""),
          protocolId: pid,
          parentId: out?.parentId ?? null,
        });
      }
    }

    return { outputs, dependencyMap };
  }, [projectProtocols]);


  const currentUnionPointerClass = useMemo(() => {
    if (protocolClassName !== "ProtUnionSet") return null;
    return getProtUnionDerivedPointerClass(protocolDetails.params ?? {});
  }, [protocolClassName, protocolDetails.params]);


  useEffect(() => {
    if (protocolClassName !== "ProtUnionSet") return;
    if (!currentUnionPointerClass) return;

    const previousPointerClass = prevSelectedInputTypeRef.current;
    if (previousPointerClass === currentUnionPointerClass) return;

    setProtocolDetails((prev: any) => {
      const currentParams = prev?.params ?? {};
      const nextParams = applyProtUnionPointerClassToParams(
        currentParams,
        currentUnionPointerClass
      );

      if (nextParams === currentParams) return prev;

      return {
        ...prev,
        params: nextParams,
      };
    });

    prevSelectedInputTypeRef.current = currentUnionPointerClass;
  }, [protocolClassName, currentUnionPointerClass]);

  // Serialize protocol parameters before save/execute
  const getSerializedParams = useCallback(() => {
    // getSerializedParams
    const out: any = {};

    Object.entries(protocolDetails.params || {}).forEach(([k, pRaw]: any) => {
      const newKey = getParamNameFromStateKey(k);

      const p = pRaw ?? {};
      const cls = resolveParamClass(p);

      if (cls === "PointerParam") {
        const editable = p.editableValue ?? "";
        let normalized = "";

        const token = (p.value ?? "").toString().trim();
        if (token) normalized = token;
        else if (editable) normalized = String(editable);
        else normalized = "";

        out[newKey] = normalized;
        return;
      }

      if (cls === "MultiPointerParam" && Array.isArray(p.editableValue)) {
        const list = p.editableValue.map((item: any) => {
          const token = item?.object ?? item?.value ?? "";
          return token ? String(token) : "";
        });

        out[newKey] = list;
        return;
      }

      if (cls === "TableParam" && Array.isArray(p.editableValue)) {
        out[newKey] = serializeTableParamValue(p.editableValue, getTableColumns(p));
        return;
      }

      if (cls === "BooleanParam") {
        const boolVal = coerceBooleanValue(p.editableValue ?? p.value ?? p.value ?? p.default);
        out[newKey] = boolVal ? true : false;
        return;
      }

      if (cls === "PathParam") {
        const token = (p.value ?? p.editableValue ?? "").toString();
        out[newKey] = token;
        return;
      }

      out[newKey] = p.editableValue;
    });

    return out;
  }, [protocolDetails.params]);



  const applyWizardParamUpdates = useCallback(
    (paramUpdates: Record<string, any>) => {
      setProtocolDetails((prev: any) => {
        const currentParams = prev?.params ?? {};
        let nextParams = currentParams;

        const ensureClone = () => {
          if (nextParams === currentParams) {
            nextParams = { ...currentParams };
          }
        };

        for (const [paramName, rawValue] of Object.entries(paramUpdates ?? {})) {
          const stateKey = findStateKeyByParamNames(currentParams, [paramName]);
          if (!stateKey) continue;

          const current = nextParams[stateKey] ?? currentParams[stateKey] ?? {};
          const cls = resolveParamClass(current);
          const nextParam = { ...current };

          if (cls === "BooleanParam") {
            const boolValue = coerceBooleanValue(rawValue);
            nextParam.value = boolValue;
            nextParam.editableValue = boolValue;
          } else if (cls === "PointerParam") {
            const token = normalizePointerToken(rawValue);
            nextParam.value = token;
            nextParam.editableValue = token;
          } else if (cls === "PathParam") {
            const token = rawValue == null ? "" : String(rawValue);
            nextParam.value = token;
            nextParam.editableValue = token;
          } else if (cls === "MultiPointerParam") {
            nextParam.editableValue = normalizeMultiPointerValue(rawValue);
          } else if (cls === "TableParam") {
            nextParam.editableValue = normalizeTableParamValue(
              rawValue,
              getTableColumns(current)
            );
          } else if (cls === "EnumParam" && current?.choices) {
            nextParam.editableValue = normalizeEnumSelection(
              rawValue,
              current.choices,
              current.default
            );
          } else {
            const parsed = parseFromJSONValue(rawValue);
            nextParam.editableValue = parsed ?? rawValue ?? "";
          }

          ensureClone();
          nextParams[stateKey] = nextParam;
        }

        if (nextParams === currentParams) return prev;

        if (protocolClassName === "ProtUnionSet") {
          nextParams = syncProtUnionPointerClassInParams(nextParams);
          prevSelectedInputTypeRef.current = getProtUnionDerivedPointerClass(nextParams);
        }

        return {
          ...prev,
          params: nextParams,
        };
      });
    },
    [
      findStateKeyByParamNames,
      protocolClassName,
    ]
  );

  useEffect(() => {
    // syncMetadataSnapshot
    const liveValues = getSerializedParams();

    setMetadataSnapshot(() => {
      if (!data || typeof data !== "object") return data;

      // shallowCopyBase
      const snapshot: any = Array.isArray(data) ? [...data] : { ...(data as any) };

      // patchValuesInMostLikelyPlace
      if ("values" in snapshot) {
        snapshot.values = liveValues;
        return snapshot;
      }

      if (snapshot.form && typeof snapshot.form === "object") {
        snapshot.form = { ...snapshot.form, values: liveValues };
        return snapshot;
      }

      // fallbackExposeValuesAnyway
      snapshot.values = liveValues;
      return snapshot;
    });
  }, [data, getSerializedParams]);


  function openExecErrorDialog(title: string, message: string) {
    // openExecErrorDialog
    setExecErrorDialogTitle(title);
    setExecErrorDialogMessage(message);
    setExecErrorDialogOpen(true);
  }

  const {
    wizardState,
    openingWizard,
    interactivePreviewLoading,
    openWizardForParam,
    closeWizard,
    confirmWizard,
    setOptionsSelectedValue,
    setInputFieldValue,
    setMaskRadiusValue,
    commitMaskRadiusValue,
    setMaskRadiusSelectedIndex,
    setMaskRadiiInnerValue,
    commitMaskRadiiInnerValue,
    setMaskRadiiOuterValue,
    commitMaskRadiiOuterValue,
    setMaskRadiiSelectedIndex,
    setCtfDownsampleValue,
    commitCtfDownsampleValue,
    setCtfLowFreqValue,
    commitCtfLowFreqValue,
    setCtfHighFreqValue,
    commitCtfHighFreqValue,
    setCtfSelectedIndex,
    setFilterLowFreqValue,
    commitFilterLowFreqValue,
    setFilterHighFreqValue,
    commitFilterHighFreqValue,
    setFilterDecayValue,
    commitFilterDecayValue,
    setFilterSelectedIndex,
    setDownsamplePreviewValue,
    commitDownsamplePreviewValue,
    setDownsamplePreviewSelectedIndex,
    setPointInVolumePoint,
    setPointInVolumeVoxel,
  } = useProtocolWizards({
    projectId,
    protocolId: effectiveProtocolId,
    protocolClassName,
    protocolDetails,
    svc,
    getSerializedParams,
    applyWizardParamUpdates,
    openExecErrorDialog,
  });

  const adoptCreatedProtocolId = (payload: any) => {
    const returnedProtocolId = String(payload?.protocolId ?? "").trim();

    if (!returnedProtocolId || effectiveProtocolId) return;

    setProtocolDetails((prev: any) => ({ ...prev, id: returnedProtocolId, status: String(prev?.status ?? "").trim().toLowerCase() === "new" ? "saved" : prev?.status }));
    onSaved?.();
  };

  const executeNow = async (
    modeKey: string,
    queueOverride: QueueLaunchDraft | null = null
  ) => {
    setActionLoading("execute");
    setValidationErrors([]);

    try {
      const pid = effectiveProtocolId;
      const serializedParams = getSerializedParams();
      const finalParams = mergeQueueDraftIntoParams(serializedParams, queueOverride);

      const res: any = await svc.executeProtocol(
        projectId,
        pid,
        protocolClassName,
        finalParams,
        modeKey
      );

      const errors = getErrorsFromBackendPayload(res);

      if (errors.length > 0) {
        setValidationErrors(errors);
        setShowValidationDialog(true);
        return;
      }

      onExecuted?.();
      requestClose();
    } catch (err: any) {
      const httpStatus = getHttpStatusFromError(err);
      const backendPayload = getBackendPayloadFromError(err);
      adoptCreatedProtocolId(backendPayload);
      const errors = getErrorsFromBackendPayload(backendPayload);

      if (errors.length > 0) {
        if (httpStatus === 422) {
          setValidationErrors(errors);
          setShowValidationDialog(true);
          return;
        }

        openExecErrorDialog("Execution error", formatErrorsForDialog(errors));
        return;
      }

      const fallbackMsg =
        err?.message ||
        (typeof backendPayload?.detail === "string" ? backendPayload.detail : null) ||
        "Error launching the protocol";

      openExecErrorDialog("Execution error", String(fallbackMsg));
    } finally {
      setActionLoading(null);
    }
  };

  const beginExecute = async (modeKey: string, queueOverride: QueueLaunchDraft | null = null) => {
    const normalizedModeKey = String(modeKey ?? "").trim().toLowerCase();

    if (normalizedModeKey !== "continue" && normalizedModeKey !== "restart") {
      await executeNow(modeKey, queueOverride);
      return;
    }

    setActionLoading("execute");

    try {
      const pid = effectiveProtocolId;
      const preflight = await svc.getProtocolWorkflowExecutionPreflight(projectId, pid, normalizedModeKey);

      if (!preflight?.requiresConfirmation) {
        setActionLoading(null);
        await executeNow(normalizedModeKey, queueOverride);
        return;
      }

      setPendingWorkflowExecution({ modeKey: normalizedModeKey, queueOverride, preflight });
    } catch (err: any) {
      const backendPayload = getBackendPayloadFromError(err);
      const errors = getErrorsFromBackendPayload(backendPayload);
      const message = errors.length > 0 ? formatErrorsForDialog(errors) : String(err?.message || "Failed to prepare workflow execution");
      openExecErrorDialog("Execution error", message);
    } finally {
      setActionLoading(null);
    }
  };

  const executeWorkflowScope = async (scope: ProtocolWorkflowExecutionScope) => {
    const pending = pendingWorkflowExecution;

    if (!pending) return;

    setPendingWorkflowExecution(null);
    setActionLoading("execute");
    setValidationErrors([]);

    try {
      const pid = effectiveProtocolId;
      const serializedParams = getSerializedParams();
      const finalParams = mergeQueueDraftIntoParams(serializedParams, pending.queueOverride);
      const res: any = await svc.executeProtocolWorkflow(projectId, pid, protocolClassName, finalParams, pending.modeKey, scope);
      const errors = getErrorsFromBackendPayload(res);

      if (errors.length > 0) {
        setValidationErrors(errors);
        setShowValidationDialog(true);
        return;
      }

      onExecuted?.();
      requestClose();
    } catch (err: any) {
      const httpStatus = getHttpStatusFromError(err);
      const backendPayload = getBackendPayloadFromError(err);
      const errors = getErrorsFromBackendPayload(backendPayload);

      if (errors.length > 0 && httpStatus === 422) {
        setValidationErrors(errors);
        setShowValidationDialog(true);
        return;
      }

      const message = errors.length > 0 ? formatErrorsForDialog(errors) : String(err?.message || "Error executing workflow");
      openExecErrorDialog("Execution error", message);
    } finally {
      setActionLoading(null);
    }
  };

  // handleExecute
  const handleExecute = async (modeKey: string) => {
    const normalizedModeKey = String(modeKey ?? "").trim().toLowerCase();

    if (normalizedModeKey === "stop") {
      await executeNow(modeKey, null);
      return;
    }

    const shouldUseQueue = useQueueEnabled || effectiveQueueMandatory;

    if (!shouldUseQueue) {
      await beginExecute(modeKey, null);
      return;
    }

    if (!hasConfiguredQueues) {
      toast.error("No queues are configured for this host.");
      return;
    }

    if (!hasAnyQueueParams) {
      toast.error("No queue parameters are available for the configured queues.");
      return;
    }

    const draft = buildQueueDraft(effectiveQueueMandatory ? effectiveDefaultQueueName : activeQueueName);

    if (!draft) {
      toast.error("Unable to prepare queue settings.");
      return;
    }

    if (effectiveQueueMandatory) {
      await beginExecute(modeKey, draft);
      return;
    }

    setPendingExecuteMode(modeKey);
    setQueueDraft(draft);
    setQueueDialogOpen(true);
  };

  const confirmQueueAndExecute = async () => {
    if (!pendingExecuteMode || !queueDraft) {
      setQueueDialogOpen(false);
      setPendingExecuteMode(null);
      return;
    }

    const modeKey = pendingExecuteMode;
    const draft = queueDraft;

    applyQueueDraftToProtocolState(draft);
    setQueueDialogOpen(false);
    setPendingExecuteMode(null);

    await beginExecute(modeKey, draft);
  };

  // handleSave
  const handleSave = async () => {
    setActionLoading("save");

    try {
      const pid = effectiveProtocolId;
      const serialized = getSerializedParams();

      const res: any = await svc.saveProtocol(projectId, pid, protocolClassName, serialized);
      const errors = getErrorsFromBackendPayload(res);

      const returnedProtocolId = String(res?.protocolId ?? pid);

      if (errors.length === 0) {
        toast.success(`Saved protocol ${returnedProtocolId} successfully.`);
        onSaved?.();
        requestClose();
        return;
      }

      const msg = formatErrorsForDialog(errors);
      toast.error(`Saved with warnings: ${msg}`);
      onSaved?.();
      requestClose();
    } catch (err: any) {
      const payload = getBackendPayloadFromError(err);
      const errors = getErrorsFromBackendPayload(payload);

      if (errors.length > 0) {
        const msg = formatErrorsForDialog(errors);
        toast.error(msg);
        openExecErrorDialog("Save error", msg);
        return;
      }

      const fallbackMsg =
        err?.message || (typeof payload?.detail === "string" ? payload.detail : null) || "Save failed";

      toast.error(String(fallbackMsg));
      openExecErrorDialog("Save error", String(fallbackMsg));
    } finally {
      setActionLoading(null);
    }
  };

  // Render a single parameter row
  const renderParam = useCallback(
    (
      paramLike: any,
      sectionIdx: number,
      rowIndex = 0,
      layoutVariant: "standard" | "inline" = "standard",
      parentKeyPrefix = ""
    ): JSX.Element | null => {
      // renderParamRow
      const { paramName: name, paramDef: def } = unwrapParamDef(paramLike);
      if (!def) return null;

      // State key only exists for real params with a name
      const stateKey = name ? `${sectionIdx}_${name}` : null;
      const liveState = stateKey ? protocolDetails.params?.[stateKey] ?? {} : {};

      const rawDef = {
        ...def,
        ...(isNonEmptyString((liveState as any)?.label) ? { label: (liveState as any).label } : {}),
        ...(isNonEmptyString((liveState as any)?.help) ? { help: (liveState as any).help } : {}),
      };

      const wizardUi = buildWizardUiProps({
        stateKey,
        paramDef: rawDef,
        paramsByStateKey: protocolDetails.params,
        onOpenWizardForParam: openWizardForParam,
      });

      const defResolved = withResolvedParamClass(rawDef);
      const defClass = resolveParamClass(defResolved);

      // Stable key for React + decorator state (even when name is missing)
      const basePrefix = parentKeyPrefix || `sec${sectionIdx}`;
      const stableKey = `${basePrefix}|${name ? `param:${name}` : `decorator:${defClass}:${rowIndex}`}`;

      const value = stateKey ? protocolDetails.params?.[stateKey]?.editableValue : undefined;

      const isInline = layoutVariant === "inline";

      // fieldWidthPx
      const inlineFieldWidth = 50;
      const standardFieldWidth = variant === "docked" ? 280 : 460;
      const fieldWidth = isInline ? inlineFieldWidth : standardFieldWidth;

      const fieldContainerSx = isInline
        ? { width: fieldWidth, flex: "0 0 auto", minWidth: 0 }
        : { flex: 1, minWidth: 0, maxWidth: "100%" };

      if (typeof def?.condition === "string" && def.condition.trim()) {
        if (!evalExpr(sectionIdx, def.condition)) return null;
      }

      const expertLocator = findGeneralExpertLocator();
      const isExpertSelector =
        !!expertLocator && expertLocator.sectionIdx === sectionIdx && name === "expertLevel";

      if (generalExpertLevel === 0 && def?.expertLevel === 1 && !isExpertSelector) {
        return null;
      }

      const advancedSlot = isInline
        ? def.expertLevel === 1
          ? (
            <Tooltip title="Advanced">
              <Box
                sx={{
                  width: 18,
                  height: 18,
                  bgcolor: "#777",
                  color: "white",
                  borderRadius: "50%",
                  fontSize: "0.7rem",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  flex: "0 0 auto",
                }}
              >
                A
              </Box>
            </Tooltip>
          )
          : null
        : (
          <Box
            sx={{
              width: "1.5rem",
              height: "1.5rem",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            {def.expertLevel === 1 ? (
              <Tooltip title="Advanced">
                <Box
                  sx={{
                    width: "1.5rem",
                    height: "1.5rem",
                    bgcolor: "#777",
                    color: "white",
                    borderRadius: "50%",
                    fontSize: "0.8rem",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  A
                </Box>
              </Tooltip>
            ) : null}
          </Box>
        );

      // TableParam (requires stateKey)
      if (defClass === "TableParam") {
        if (!stateKey) return null;

        const columns = getTableColumns(defResolved);
        const rows = Array.isArray(value)
          ? value
          : normalizeTableParamValue(def.default ?? "[]", columns);
        const cellErrors = validateTableRows(rows, columns);
        const emptyRow = buildEmptyTableRow(columns);

        return (
          <ParamRow
            key={stableKey}
            label={def.label || name || ""}
            control={
              <Box sx={{ display: "flex", alignItems: "center", gap: 1, width: "100%" }}>
                {advancedSlot}
                <TableParamRow
                  def={defResolved}
                  rows={rows}
                  cellErrors={cellErrors}
                  onCellChange={(rowIndex, colName, nextValue) => {
                    setProtocolDetails((prev: any) =>
                      updateTableCell(prev, stateKey, rowIndex, colName, nextValue)
                    );
                  }}
                  onAddRow={() => {
                    setProtocolDetails((prev: any) =>
                      addTableRow(prev, stateKey, emptyRow)
                    );
                  }}
                  onRemoveRow={(rowIndex) => {
                    setProtocolDetails((prev: any) =>
                      removeTableRow(prev, stateKey, rowIndex, emptyRow)
                    );
                  }}
                />
              </Box>
            }
            helpText={def.help}
            rowIndex={rowIndex}
            hasWizard={wizardUi.hasWizard}
            onOpenWizard={wizardUi.onOpenWizard}
            wizardTooltip={wizardUi.wizardTooltip}
          />
        );
      }

      // MultiPointerParam (requires stateKey)
      if (defClass === "MultiPointerParam") {
        if (!stateKey) return null;

        const items = Array.isArray(value) ? value : def.default ?? [];

        // By default editable; if def.readOnly is true => block manual typing in MultiParamRow
        const isReadOnly = coerceReadOnlyFlag(def?.readOnly);

        // onRowEdit
        const onRowEdit = (rowIndexInner: number, patch: { object?: string; info?: string }) => {
          setProtocolDetails((prev: any) =>
            updateMultiPointerItem(prev, stateKey, rowIndexInner, patch, {
              syncObjectToValue: true,
            })
          );
        };

        const onClear = (i: number) => {
          setProtocolDetails((prev: any) => removeMultiPointerItemAndPad(prev, stateKey, i));
        };

        const onRowDrop = (i: number, dragged: any) => {
          const liveParam = protocolDetails.params?.[stateKey];
          const expected = getExpectedClass(liveParam);
          const norm = (s: any) => (typeof s === "string" ? s.replace(/\s+/g, "").toLowerCase() : "");
          const draggedClass = norm(dragged.pointerClass);

          const matches =
            expected === null
              ? true
              : Array.isArray(expected)
                ? expected.some((e) => norm(e) === draggedClass)
                : norm(expected) === draggedClass;

          if (!matches) return;

          setProtocolDetails((prev: any) =>
            replaceMultiPointerItem(prev, stateKey, i, buildPointerSelectionItem(dragged))
          );
        };

        const handlePickFromDialog = (rowIndexInner: number, picked: any) => {
          setProtocolDetails((prev: any) =>
            replaceMultiPointerItem(prev, stateKey, rowIndexInner, buildPointerSelectionItem(picked))
          );
        };

        const liveDef = {
          ...defResolved,
          ...(protocolDetails.params?.[stateKey] || {}),
          paramClass: "MultiPointerParam",
        };

        return (
          <ParamRow
            key={stableKey}
            label={def.label || name || ""}
            control={
              <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                {advancedSlot}
                <MultiParamRow
                  label={def.label || name || ""}
                  items={items}
                  helpText={def.help}
                  onRowClear={onClear}
                  onRowDrop={onRowDrop}
                  dragOverKey={dragOverKey}
                  setDragOverKey={setDragOverKey}
                  currentDraggedOutput={currentDraggedOutput}
                  paramKey={stateKey}
                  def={liveDef}
                  getAvailableOutputs={() => getFilteredOutputsForKey(stateKey)}
                  onPickForRow={handlePickFromDialog}
                  readOnly={isReadOnly}
                  onRowEdit={onRowEdit}
                />
              </Box>
            }
            helpText={def.help}
            rowIndex={rowIndex}
            hasWizard={wizardUi.hasWizard}
            onOpenWizard={wizardUi.onOpenWizard}
            wizardTooltip={wizardUi.wizardTooltip}
          />
        );
      }

      // PointerParam (requires stateKey)
      if (defClass === "PointerParam") {
        if (!stateKey) return null;

        const handleOpenFind = (targetKey: string) => {
          const liveParam = protocolDetails.params?.[targetKey];
          const expected = getExpectedClass(liveParam);
          setExpectedClass(expected);
          setSelectorTarget({ key: targetKey, def: liveParam, expectedClass: expected });

          const finalOutputs = getFilteredOutputsForKey(targetKey);
          setAllOutputs(finalOutputs);
          setOpenSelector(true);
        };

        return renderPointerParamRow({
          stableKey,
          label: def.label || name || "",
          helpText: def.help,
          rowIndex,
          layoutVariant,
          isInline,
          fieldWidth,
          fieldContainerSx,
          advancedSlot,
          stateKey,
          protocolDetails,
          setProtocolDetails,
          def,
          defResolved,
          dragOverKey,
          setDragOverKey,
          onOpenFind: handleOpenFind,
          wizardUi,
        });
      }

      // PathParam (requires stateKey)
      if (defClass === "PathParam") {
        if (!stateKey) return null;

        const current = protocolDetails.params?.[stateKey] || {};
        const label = current["label"] ?? def.label ?? name ?? "";

        const handleBrowsePath = () => {
          if (!projectId) {
            console.warn("Missing projectId for PathParam browse.");
            return;
          }
          setPathDialog({ open: true, stateKey, title: label });
        };

        const handleOpenFind = (targetKey: string) => {
          const liveParam = protocolDetails.params?.[targetKey];
          const expected = getExpectedClass(liveParam);
          setExpectedClass(expected);
          setSelectorTarget({ key: targetKey, def: liveParam, expectedClass: expected });

          const finalOutputs = getFilteredOutputsForKey(targetKey);
          setAllOutputs(finalOutputs);
          setOpenSelector(true);
        };

        return renderPathParamRow({
          stableKey,
          label: def.label || name || "",
          helpText: def.help,
          rowIndex,
          layoutVariant,
          isInline,
          fieldWidth,
          fieldContainerSx,
          advancedSlot,
          stateKey,
          protocolDetails,
          setProtocolDetails,
          def,
          dragOverKey,
          setDragOverKey,
          onBrowsePath: handleBrowsePath,
          onOpenFind: handleOpenFind,
          wizardUi,
        });
      }

      // EnumParam (requires stateKey)
      if (defClass === "EnumParam" && def.choices) {
        if (!stateKey) return null;

        return renderEnumParamRow({
          stableKey,
          label: def.label || name || "",
          helpText: def.help,
          rowIndex,
          layoutVariant,
          isInline,
          fieldWidth,
          fieldContainerSx,
          advancedSlot,
          stateKey,
          protocolDetails,
          setProtocolDetails,
          def,
          value,
          wizardUi
        });
      }


      // Line (decorator, name optional)
      if (defClass === "Line") {
        const title = String(def?.label || name || "").trim();
        const lineParams = Array.isArray(def?.params) ? def.params : [];

        const children = lineParams
          .map((child: any, idx: number) => {
            const childEl = renderParam(child, sectionIdx, idx, "inline", stableKey);
            if (!childEl) return null;

            return (
              <Box
                key={`${stableKey}|lineChild:${idx}`}
                sx={{
                  flex: "0 0 auto",
                  minWidth: 0,
                  display: "flex",
                  alignItems: "center",
                }}
              >
                {childEl}
              </Box>
            );
          })
          .filter(Boolean);

        // If Line has no children, render only the label (if present) and stay stable
        if (children.length === 0) {
          if (!title) return null;

          return (
            <ParamRow
              key={stableKey}
              label={title}
              control={<></>}
              helpText={def?.help}
              rowIndex={rowIndex}
              layoutVariant="fullWidth"
              hasWizard={wizardUi.hasWizard}
              onOpenWizard={wizardUi.onOpenWizard}
              wizardTooltip={wizardUi.wizardTooltip}
            />
          );
        }

        if (!title) {
          return (
            <Box
              key={stableKey}
              sx={{
                mb: 1,
                display: "flex",
                alignItems: "center",
                gap: 1,
                flexWrap: "nowrap",
                overflowX: "auto",
                overflowY: "hidden",
                pb: 0.25,
              }}
            >
              {children as any}
            </Box>
          );
        }

        return (
          <ParamRow
            key={stableKey}
            label={title}
            control={
              <Box
                sx={{
                  display: "flex",
                  alignItems: "center",
                  gap: 1,
                  flexWrap: "nowrap",
                  overflowX: "auto",
                  overflowY: "hidden",
                  minWidth: 0,
                  pb: 0.25,
                  ml: 3,
                }}
              >
                {children as any}
              </Box>
            }
            helpText={def?.help}
            rowIndex={rowIndex}
            layoutVariant="standard"
            hasWizard={wizardUi.hasWizard}
            onOpenWizard={wizardUi.onOpenWizard}
            wizardTooltip={wizardUi.wizardTooltip}
          />
        );
      }

      // Group (decorator, name optional)
      // Group (decorator, name optional)
      if (defClass === "Group") {
        const groupKey = `${stableKey}|group`;

        const collapsedByDefault = coerceCollapsedFlag(def?.collapsed);
        const expanded = expandedGroups[groupKey] ?? !collapsedByDefault;

        const toggleExpand = () => setExpandedGroups((prev) => ({ ...prev, [groupKey]: !expanded }));

        const groupLabel = String(def?.label || name || "Group").trim();
        const groupParams = Array.isArray(def?.params) ? def.params : [];

        const groupHelpText = typeof def?.help === "string" ? def.help : "";
        const hasGroupHelp = isNonEmptyString(groupHelpText);

        const handleOpenGroupHelp = (e: React.MouseEvent) => {
          // handleOpenGroupHelp
          e.preventDefault();
          e.stopPropagation();
          setGroupHelpDialog({ open: true, text: groupHelpText });
        };

        return (
          <Box
            key={stableKey}
            sx={{
              mb: 2,
              border: "1px dashed #ccc",
              borderRadius: 1,
              p: 1,
              backgroundColor: (theme) => (theme.palette.mode === "dark" ? "#2c2c2c" : "#f9fafb"),
            }}
          >
            <Box
              sx={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                cursor: "pointer",
                mb: 1,

                // headerBackground
                px: 1,
                py: 0.75,
                borderRadius: 1,
                backgroundColor: (theme) =>
                  theme.palette.mode === "dark" ? "rgba(255,255,255,0.06)" : "#e2e2e4",
                border: "1px solid",
                borderColor: (theme) =>
                  theme.palette.mode === "dark" ? "rgba(255,255,255,0.10)" : "#e2e2e4",

                "&:hover": {
                  backgroundColor: (theme) =>
                    theme.palette.mode === "dark" ? "rgba(255,255,255,0.10)" : "#e2e2e4",
                },
              }}
              onClick={toggleExpand}
            >
              <Typography
                variant="subtitle2"
                sx={(theme) => ({
                  color: theme.palette.mode === "dark" ? "#ffffff" : "#000000",
                })}
              >
                {groupLabel || "Group"}
              </Typography>

              <Box sx={{ display: "inline-flex", alignItems: "center", gap: 0.5 }}>
                {hasGroupHelp && (
                  <Tooltip title="Help">
                    <IconButton size="small" onClick={handleOpenGroupHelp}>
                      <HelpIcon fontSize="large" />
                    </IconButton>
                  </Tooltip>
                )}

                <IconButton size="small">
                  {expanded ? <ChevronUpIcon fontSize="small" /> : <ChevronDownIcon fontSize="small" />}
                </IconButton>
              </Box>
            </Box>

            {expanded && (
              <>
                {groupParams.length === 0 ? (
                  <Typography variant="caption" sx={{ opacity: 0.7, pl: 1 }}>
                    No parameters.
                  </Typography>
                ) : (
                  groupParams.map((child: any, idx: number) =>
                    renderParam(child, sectionIdx, idx, "standard", stableKey)
                  )
                )}
              </>
            )}
          </Box>
        );
      }


      // BooleanParam (requires stateKey)
      if (defClass === "BooleanParam") {
        if (!stateKey) return null;

        return renderBooleanParamRow({
          stableKey,
          label: def.label || name || "",
          helpText: def.help,
          rowIndex,
          layoutVariant,
          isInline,
          fieldWidth,
          fieldContainerSx,
          advancedSlot,
          stateKey,
          protocolDetails,
          setProtocolDetails,
          def,
          value,
          wizardUi,
        });
      }


      // LabelParam (decorator, name optional)
      if (defClass === "Label") {
        return (
          <ParamRow
            key={stableKey}
            label={String(def.label || name || "")}
            control={<></>}
            helpText={def.help}
            rowIndex={rowIndex}
            layoutVariant="fullWidth"
            hasWizard={wizardUi.hasWizard}
            onOpenWizard={wizardUi.onOpenWizard}
            wizardTooltip={wizardUi.wizardTooltip}
          />
        );
      }

      // Default text param (requires stateKey)
      if (!stateKey) return null;

      return renderDefaultParamRow({
        stableKey,
        label: def.label || name || "",
        helpText: def.help,
        rowIndex,
        layoutVariant,
        isInline,
        fieldWidth,
        fieldContainerSx,
        advancedSlot,
        stateKey,
        protocolDetails,
        setProtocolDetails,
        def,
        value,
        wizardUi,
      });
    },
    [
      protocolDetails.params,
      dragOverKey,
      currentDraggedOutput,
      expandedGroups,
      generalExpertLevel,
      findGeneralExpertLocator,
      getExpectedClass,
      projectId,
      protocolId,
      variant,
      protocolClassName,
      openWizardForParam,
    ]
  );

  const getOutputStableIdentity = (item: any): string => {
    const normalizedToken = normalizePointerToken(
      item?.value ?? item?.object ?? item?.editableValue ?? ""
    );

    if (normalizedToken) return normalizedToken;

    const protocolToken = String(item?.protocolId ?? item?.parentId ?? "");
    const keyToken = String(item?.key ?? "").trim();

    return `${protocolToken}::${keyToken}`;
  };

  const getCurrentSelectionIdentities = (paramState: any): Set<string> => {
    const ids = new Set<string>();
    const cls = resolveParamClass(paramState);

    if (cls === "MultiPointerParam") {
      const items = Array.isArray(paramState?.editableValue) ? paramState.editableValue : [];
      for (const item of items) {
        const id = getOutputStableIdentity(item);
        if (id && !id.endsWith("::")) ids.add(id);
      }
      return ids;
    }

    if (cls === "PointerParam") {
      const id = getOutputStableIdentity({
        value: paramState?.value ?? paramState?.editableValue ?? "",
        key: paramState?.key ?? "",
        protocolId: paramState?.protocolId ?? paramState?.parentId ?? "",
      });
      if (id && !id.endsWith("::")) ids.add(id);
    }

    return ids;
  };

  // Filter outputs for a given paramKey, excluding self and descendants
  const getFilteredOutputsForKey = (paramKey: string) => {
    const liveParam = protocolDetails.params?.[paramKey];
    const expected = getExpectedClass(liveParam);

    const { outputs, dependencyMap } = gatherAllOutputs();

    const normalizeIdToken = (value: any): string => {
      const token = String(value ?? "").trim();
      if (!token || token === "null" || token === "undefined") return "";
      return token;
    };

    const currentProtocolIds = new Set(
      [
        protocolId,
        info?.protocolId,
        info?.id,
        (form as any)?.protocolId,
        (form as any)?.id,
        protocolDetails?.id,
      ]
        .map(normalizeIdToken)
        .filter(Boolean)
    );

    const blocked = new Set<string>(currentProtocolIds);
    const stack = [...currentProtocolIds];

    while (stack.length > 0) {
      const parent = stack.pop()!;
      const children = dependencyMap[parent] || [];

      for (const child of children) {
        const childId = normalizeIdToken(child);
        if (childId && !blocked.has(childId)) {
          blocked.add(childId);
          stack.push(childId);
        }
      }
    }

    const currentSelectionIds = getCurrentSelectionIdentities(liveParam);

    const pool = outputs.filter((o) => {
      const outputProtocolId = normalizeIdToken(o.protocolId);
      const outputParentId = normalizeIdToken(o.parentId);

      if (
        (outputProtocolId && blocked.has(outputProtocolId)) ||
        (outputParentId && blocked.has(outputParentId))
      ) {
        return false;
      }

      const outputId = getOutputStableIdentity(o);
      if (currentSelectionIds.has(outputId)) return false;

      return true;
    });

    const norm = (s: any) => String(s ?? "").replace(/\s+/g, "").toLowerCase();

    if (expected === null) {
      return pool.filter((o) => {
        const outputClasses = splitClassList(o.pointerClass).map(norm);
        return outputClasses.some((cls) => cls.startsWith("setof"));
      });
    }

    const expectedList = Array.isArray(expected) ? expected : [expected];

    if (expectedList.some((item) => isWildcardExpectedClass(item))) {
      return pool;
    }

    const expectedClasses = expectedList.flatMap((item) => splitClassList(item)).map(norm);

    return pool.filter((o) => {
      const outputClasses = splitClassList(o.pointerClass).map(norm);
      return expectedClasses.some((cls) => outputClasses.includes(cls));
    });
  };

  // Handle selected output in OutputSelectorDialog
  const handleSelectOutput = (selected: any | any[]) => {
    if (!selectorTarget) return;

    const { key, def } = selectorTarget;
    const picks = Array.isArray(selected) ? selected : [selected];

    setProtocolDetails((prev: any) => {
      const defClass = resolveParamClass(def);

      if (defClass === "MultiPointerParam") {
        return setMultiPointerSelection(prev, key, picks);
      }

      return setPointerSelection(prev, key, picks[0]);
    });

    setOpenSelector(false);
  };

  const safeDefinition = sections;
  const isDocked = variant === "docked";

  return (
    <div
      className={[
        styles.protocolForm,
        isDocked ? styles.asDocked : "",
        isClosing ? styles.slideOutRight : styles.slideInRight,
      ]
        .filter(Boolean)
        .join(" ")}
      onAnimationEnd={handleAnimationEnd}
    >
      {/* HEADER */}
      <div className={styles.formHeader}>
        <div className={styles.formTitleWrapper}>
          <Box className="inline-flex items-center justify-center rounded-full bg-green-500 text-black text-xs font-bold px-2 py-1">
            {effectiveProtocolId}
          </Box>
          <span className="text-white">{protocolDetails.label}</span>
          <span
            className={styles.nodeStatusPill}
            style={{
              backgroundColor: protocolDetails.color,
              color: "black",
            }}
          >
            {protocolDetails.status || "Unknown"}
          </span>
        </div>

        <Box sx={{ ml: "auto", display: "inline-flex", alignItems: "center", gap: 0.75 }}>
          {hasFormHelp && (
            <Tooltip title="Help">
              <IconButton
                onClick={() => setOpenFormHelp(true)}
                aria-label="Open protocol help"
                size="small"
                sx={headerActionBtnSx}
              >
                <span style={{ fontSize: "1.1rem" }} className="ml-2 mr-2 text-white">?</span>
              </IconButton>
            </Tooltip>
          )}

          <IconButton
            onClick={requestClose}
            aria-label="Close analyze dialog"
            size="small"
            sx={headerActionBtnSx}
          >
            <CloseIcon fontSize="small" />
          </IconButton>
        </Box>
      </div>

      {/* Protocol form help dialog */}
      {hasFormHelp && (
        <ProtocolHelpDialog
          open={openFormHelp}
          onClose={() => setOpenFormHelp(false)}
          text={formHelpText}
          title="Help"
        />
      )}


      {/* BODY */}
      <div
        className={styles.formBody}
        style={{
          display: "flex",
          flexDirection: "column",
          flex: 1,
          overflow: "hidden",
        }}
      >
        <Box
          sx={{
            flex: 1,
            display: "flex",
            flexDirection: "column",
            overflow: "hidden",
            backgroundColor: "#f9fafb",
            borderRadius: 2,
            boxShadow: "0px 2px 6px rgba(0,0,0,0.2)",
            p: 1,
          }}
        >
          <Tabs
            value={topTab}
            onChange={(_, val) => setTopTab(val)}
            variant="scrollable"
            scrollButtons="auto"
            allowScrollButtonsMobile
            sx={{
              "& .MuiTab-root": {
                textTransform: "none",
                fontSize: "0.8rem",
                fontWeight: 500,
                minHeight: 48,
              },
              "& .Mui-selected": {
                backgroundColor: "white",
                borderRadius: 1,
              },
            }}
          >
            <Tab label="Inputs and Parameters" />
            <Tab label="Outputs" />
            <Tab label="Logs" />
            <Tab label="Metadata" />
          </Tabs>

          <Box
            className={styles.topTabContent}
            sx={{
              flex: 1,
              minHeight: 0,
              p: 1,
              display: "flex",
              flexDirection: "column",
            }}
          >
            {/*Input and parameters */}
            {topTab === 0 && (
              <>
                <Tabs
                  value={sectionTab}
                  onChange={(_, val) => setSectionTab(val)}
                  variant="scrollable"
                  scrollButtons="auto"
                  allowScrollButtonsMobile
                  sx={{
                    mb: 1,
                    "& .MuiTab-root": {
                      textTransform: "none",
                      fontSize: "0.8rem",
                      fontWeight: 500,
                    },
                  }}
                >
                  {safeDefinition.map((section: any, idx: number) => (
                    <Tab
                      key={idx}
                      label={section.label || `Section ${idx + 1}`}
                    />
                  ))}
                </Tabs>

                <Box
                  sx={{
                    flex: 1,
                    minHeight: 0,
                    overflowY: "auto",
                    overflowX: "hidden",
                    pr: 1,
                    pb: 1,
                  }}
                >
                  {safeDefinition[sectionTab]?.params?.map((paramObj: any, idx: number) =>
                    renderParam(paramObj, sectionTab, idx)
                  )}
                </Box>
              </>
            )}

            {/* Outputs */}


            {/* Logs */}
            {topTab === 2 && (
              <ProtocolLogsPanel
                sortedLogChannels={sortedLogChannels}
                activeLogChannelId={activeLogChannelId}
                setActiveLogChannelId={setActiveLogChannelId}
                activeLogText={activeLogText}
                logsError={logsError}
                logsContainerRef={logsContainerRef}
                updateStickToBottom={updateStickToBottom}
              />
            )}

            {topTab === 1 && (
              <ProtocolOutputsPanel
                projectId={projectId}
                protocolId={effectiveProtocolId}
                protocolLabel={protocolDisplayName}
                outputsFromApi={outputsFromApi}
              />
            )}

            {/* Metadata */}
            {topTab === 3 && (
              <ProtocolMetadataPanel metadataSnapshot={metadataSnapshot} />
            )}
          </Box>
        </Box>
      </div>

      <ProtocolHelpDialog
        open={groupHelpDialog.open}
        onClose={() => setGroupHelpDialog({ open: false, text: "" })}
        text={groupHelpDialog.text}
        title="Help"
      />


      {/* FOOTER */}
      <div className={styles.formFooter}>
        <Button
          variant="contained"
          startIcon={<CloseIcon />}
          onClick={requestClose}
          sx={{ textTransform: "none" }}
          color="error"
        >
          Close
        </Button>
        <Button
          variant="contained"
          startIcon={isSaving ? <CircularProgress size={16} color="inherit" /> : <SaveIcon />}
          onClick={handleSave}
          disabled={
            isBusy ||
            protocolDetails.status === "running" ||
            protocolDetails.status === "scheduled"
          }
          sx={{ textTransform: "none" }}
        >
          {isSaving ? "Saving..." : "Save"}
        </Button>

        {executeModeMap && Object.keys(executeModeMap).length > 0 ? (
          <ExecuteModeButton
            executeModeMap={executeModeMap}
            selectedMode={selectedExecuteMode}
            onSelectedModeChange={setSelectedExecuteMode}
            onExecute={handleExecute}
            disabled={
              isBusy //||
              //protocolDetails.status === "running" ||
              //protocolDetails.status === "scheduled"
            }
            loading={isExecuting}
          />

        ) : (
          <Button
            variant="contained"
            startIcon={isExecuting ? <CircularProgress size={16} color="inherit" /> : <ExecuteIcon />}
            color="success"
            onClick={() => handleExecute("launch")}
            disabled={
              isBusy //||
              //protocolDetails.status === "running" ||
              // protocolDetails.status === "scheduled"
            }
            sx={{ textTransform: "none" }}
          >
            {isExecuting ? "Processing..." : "Launch"}
          </Button>
        )}

      </div>

      {/* PathParam RemoteFileDialog */}
      {pathDialog.open && pathDialog.stateKey && projectId && (

        <RemoteFileDialog
          open={pathDialog.open}
          onClose={() =>
            setPathDialog({
              open: false,
              stateKey: null,
              title: null,
            })
          }
          title={`Select file for: ${pathDialog.title ?? pathDialog.stateKey}`}
          projectId={projectId}
          protocolId={effectiveProtocolId}
          resolveBrowserPaths={() => svc.resolveBrowserPaths(projectId, effectiveProtocolId)}
          listRemoteDirectory={(p) => svc.listRemoteDirectory(projectId, effectiveProtocolId, p)}
          previewRemoteEntry={(p) => svc.previewRemoteEntry(projectId, effectiveProtocolId, p)}
          buildDownloadUrl={(p, inline) => svc.buildProtocolDownloadUrl(projectId, effectiveProtocolId, p, !!inline)}
          onPick={(relativePath) => {
            const stateKey = pathDialog.stateKey;

            if (stateKey) {
              setProtocolDetails((prev: any) =>
                setParamValueAndEditableValue(prev, stateKey, relativePath)
              );
            }

            setPathDialog({
              open: false,
              stateKey: null,
              title: null,
            });
          }}
        />
      )}

      <OutputSelectorDialog
        open={openSelector}
        onClose={() => setOpenSelector(false)}
        expectedClass={expectedClass ?? undefined}
        allOutputs={allOutputs}
        onSelect={handleSelectOutput}
        multiSelect={false}
      />

      {/* Workflow execution confirmation */}
      <Dialog
        open={Boolean(pendingWorkflowExecution)}
        onClose={() => {
          if (!isBusy) setPendingWorkflowExecution(null);
        }}
        maxWidth="sm"
        fullWidth
        PaperProps={{
          sx: {
            borderRadius: "22px",
            overflow: "hidden",
            border: "1px solid rgba(51, 61, 73, 0.16)",
            boxShadow: "0 28px 80px rgba(15, 23, 42, 0.30)",
            backgroundImage: "none",
          },
        }}
      >
        <DialogTitle
          sx={{
            m: 0,
            p: 0,
            backgroundColor: "#333d49",
            color: "#ffffff",
            borderBottom: "1px solid rgba(255,255,255,0.08)",
          }}
        >
          <Box sx={{ display: "flex", alignItems: "flex-start", gap: 1.5, px: 2.5, py: 2 }}>
            <Box
              sx={{
                width: 38,
                height: 38,
                borderRadius: "10px",
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                flex: "0 0 auto",
                backgroundColor: "rgba(255,255,255,0.10)",
                border: "1px solid rgba(255,255,255,0.15)",
                color: pendingWorkflowExecution?.modeKey === "continue" ? "#bae6fd" : "#fde68a",
              }}
            >
              <ExecuteIcon fontSize="small" />
            </Box>

            <Box sx={{ minWidth: 0, flex: 1 }}>
              <Typography component="div" sx={{ color: "#ffffff", fontSize: "1rem", fontWeight: 600, lineHeight: 1.5 }}>
                {pendingWorkflowExecution?.modeKey === "continue" ? "Continue workflow?" : "Restart workflow?"}
              </Typography>

              <Typography sx={{ mt: 0.4, color: "rgba(255,255,255,0.75)", fontSize: "0.875rem", lineHeight: 1.45 }}>
                This action affects protocols that depend on the selected protocol.
              </Typography>
            </Box>

            <IconButton
              size="small"
              onClick={() => setPendingWorkflowExecution(null)}
              disabled={isBusy}
              sx={{
                mt: -0.25,
                mr: -0.5,
                color: "rgba(255,255,255,0.82)",
                border: "1px solid rgba(255,255,255,0.14)",
                backgroundColor: "rgba(255,255,255,0.06)",
                "&:hover": {
                  backgroundColor: "rgba(255,255,255,0.12)",
                },
              }}
            >
              <CloseIcon fontSize="small" />
            </IconButton>
          </Box>
        </DialogTitle>

        <DialogContent sx={{ px: 2.5, py: 2.5 }}>
          <Box
            sx={(theme) => ({
              borderRadius: "12px",
              border: "1px solid",
              borderColor: theme.palette.mode === "dark" ? "rgba(148,163,184,0.24)" : "#e2e8f0",
              backgroundColor: theme.palette.mode === "dark" ? "rgba(30,41,59,0.45)" : "#f8fafc",
              px: 2,
              py: 1.75,
            })}
          >
            <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 1.5 }}>
              <Box
                sx={{
                  width: 8,
                  height: 8,
                  borderRadius: "50%",
                  backgroundColor: pendingWorkflowExecution?.modeKey === "continue" ? "#0ea5e9" : "#f59e0b",
                }}
              />

              <Typography sx={{ fontSize: "0.875rem", fontWeight: 700 }}>
                {pendingWorkflowExecution?.preflight?.affectedProtocols?.length === 1
                  ? "1 dependent protocol will be affected"
                  : `${pendingWorkflowExecution?.preflight?.affectedProtocols?.length ?? 0} dependent protocols will be affected`}
              </Typography>
            </Box>

            <Box sx={{ display: "grid", gap: 1, maxHeight: 190, overflowY: "auto", pr: 0.5 }}>
              {(pendingWorkflowExecution?.preflight?.affectedProtocols ?? []).map((protocol) => (
                <Box
                  key={protocol.protocolId}
                  sx={(theme) => ({
                    display: "flex",
                    alignItems: "center",
                    gap: 1,
                    minWidth: 0,
                    px: 1.5,
                    py: 1,
                    borderRadius: "9px",
                    backgroundColor: theme.palette.mode === "dark" ? "rgba(15,23,42,0.50)" : "#ffffff",
                    border: "1px solid",
                    borderColor: theme.palette.mode === "dark" ? "rgba(148,163,184,0.18)" : "#e2e8f0",
                  })}
                >
                  <Box
                    component="span"
                    sx={(theme) => ({
                      flex: "0 0 auto",
                      borderRadius: "999px",
                      px: 1,
                      py: 0.35,
                      fontFamily: "monospace",
                      fontSize: "0.72rem",
                      fontWeight: 700,
                      backgroundColor: theme.palette.mode === "dark" ? "rgba(51,65,85,0.90)" : "#f1f5f9",
                      color: theme.palette.mode === "dark" ? "#e2e8f0" : "#475569",
                      border: "1px solid",
                      borderColor: theme.palette.mode === "dark" ? "rgba(148,163,184,0.22)" : "#e2e8f0",
                    })}
                  >
                    {protocol.protocolId}
                  </Box>

                  <Typography sx={{ minWidth: 0, flex: 1, fontSize: "0.875rem", fontWeight: 600 }} noWrap>
                    {protocol.runName}
                  </Typography>

                  <Box
                    component="span"
                    sx={{
                      flex: "0 0 auto",
                      borderRadius: "999px",
                      px: 1,
                      py: 0.35,
                      fontSize: "0.72rem",
                      fontWeight: 700,
                      textTransform: "capitalize",
                      backgroundColor: protocol.active ? "#ffedd5" : "#f1f5f9",
                      color: protocol.active ? "#c2410c" : "#64748b",
                    }}
                  >
                    {protocol.status}
                  </Box>
                </Box>
              ))}
            </Box>
          </Box>

          <Box
            sx={(theme) => ({
              mt: 2,
              borderRadius: "12px",
              border: "1px solid",
              borderColor: theme.palette.mode === "dark" ? "rgba(245,158,11,0.30)" : "#fde68a",
              backgroundColor: theme.palette.mode === "dark" ? "rgba(120,53,15,0.20)" : "#fffbeb",
              px: 2,
              py: 1.5,
            })}
          >
            <Typography sx={{ fontSize: "0.875rem", fontWeight: 700 }}>
              Do you really want to {String(pendingWorkflowExecution?.modeKey ?? "").toUpperCase()} the workflow?
            </Typography>

            <Typography sx={(theme) => ({ mt: 0.5, fontSize: "0.82rem", color: theme.palette.mode === "dark" ? "#cbd5e1" : "#64748b", lineHeight: 1.5 })}>
              Choose whether to execute only the selected protocol or the complete affected subworkflow.
            </Typography>
          </Box>

          <Box sx={{ mt: 2, display: "grid", gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr" }, gap: 1.5 }}>
            <Box
              sx={(theme) => ({
                borderRadius: "12px",
                border: "1px solid",
                borderColor: theme.palette.mode === "dark" ? "rgba(59,130,246,0.30)" : "#bfdbfe",
                backgroundColor: theme.palette.mode === "dark" ? "rgba(30,58,138,0.15)" : "#eff6ff",
                px: 1.75,
                py: 1.5,
              })}
            >
              <Typography sx={{ fontSize: "0.875rem", fontWeight: 700, color: "#2563eb" }}>
                Single
              </Typography>

              <Typography sx={(theme) => ({ mt: 0.4, fontSize: "0.78rem", lineHeight: 1.45, color: theme.palette.mode === "dark" ? "#cbd5e1" : "#64748b" })}>
                Execute only this protocol. All listed descendants will be reset to Saved.
              </Typography>
            </Box>

            <Box
              sx={(theme) => ({
                borderRadius: "12px",
                border: "1px solid",
                borderColor: theme.palette.mode === "dark" ? "rgba(245,158,11,0.30)" : "#fde68a",
                backgroundColor: theme.palette.mode === "dark" ? "rgba(120,53,15,0.15)" : "#fffbeb",
                px: 1.75,
                py: 1.5,
              })}
            >
              <Typography sx={{ fontSize: "0.875rem", fontWeight: 700, color: "#d97706" }}>
                All
              </Typography>

              <Typography sx={(theme) => ({ mt: 0.4, fontSize: "0.78rem", lineHeight: 1.45, color: theme.palette.mode === "dark" ? "#cbd5e1" : "#64748b" })}>
                Execute this protocol and every affected descendant in the subworkflow.
              </Typography>
            </Box>
          </Box>
        </DialogContent>

        <DialogActions
          sx={(theme) => ({
            px: 2.5,
            py: 2,
            gap: 1,
            borderTop: "1px solid",
            borderColor: theme.palette.mode === "dark" ? "rgba(148,163,184,0.18)" : "#e2e8f0",
            backgroundColor: theme.palette.mode === "dark" ? "rgba(15,23,42,0.45)" : "#f8fafc",
          })}
        >
          <Button
            variant="outlined"
            onClick={() => setPendingWorkflowExecution(null)}
            disabled={isBusy}
            sx={{ textTransform: "none", minWidth: 90, borderRadius: "9px" }}
          >
            Cancel
          </Button>

          <Button
            variant="contained"
            onClick={() => executeWorkflowScope("single")}
            disabled={isBusy}
            sx={{ textTransform: "none", minWidth: 90, borderRadius: "9px" }}
          >
            Single
          </Button>

          <Button
            variant="contained"
            onClick={() => executeWorkflowScope("all")}
            disabled={isBusy}
            sx={{
              textTransform: "none",
              minWidth: 90,
              borderRadius: "9px",
              backgroundColor: "#f59e0b",
              color: "#ffffff",
              "&:hover": {
                backgroundColor: "#d97706",
              },
            }}
          >
            All
          </Button>
        </DialogActions>
      </Dialog>

      {/* Queue dialog */}
      <Dialog
        open={queueDialogOpen}
        onClose={() => {
          if (isBusy) return;
          setQueueDialogOpen(false);
          setPendingExecuteMode(null);
        }}
        maxWidth="md"
        fullWidth
        PaperProps={{
          sx: {
            borderRadius: "26px",
            overflow: "hidden",
            border: "1px solid rgba(51, 61, 73, 0.14)",
            boxShadow: "0 30px 90px rgba(15, 23, 42, 0.30)",
            backgroundImage: "none",
          },
        }}
      >
        <DialogTitle
          sx={{
            m: 0,
            px: 2.5,
            py: 2,
            background:
              "linear-gradient(135deg, #333d49 0%, #3d4957 55%, #465567 100%)",
            color: "#ffffff",
            borderBottom: "1px solid rgba(255,255,255,0.08)",
          }}
        >
          <Box
            sx={{
              display: "flex",
              alignItems: "flex-start",
              justifyContent: "space-between",
              gap: 2,
            }}
          >
            <Box
              sx={{
                display: "flex",
                alignItems: "flex-start",
                gap: 1.5,
                minWidth: 0,
              }}
            >
              <Box
                sx={{
                  width: 38,
                  height: 38,
                  borderRadius: "12px",
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  background:
                    "linear-gradient(135deg, rgba(255,255,255,0.16), rgba(255,255,255,0.08))",
                  border: "1px solid rgba(255,255,255,0.14)",
                  boxShadow: "inset 0 1px 0 rgba(255,255,255,0.12)",
                  flex: "0 0 auto",
                  fontWeight: 800,
                  fontSize: "0.95rem",
                  color: "#ffffff",
                }}
              >
                Q
              </Box>

              <Box sx={{ minWidth: 0 }}>
                <Typography
                  variant="h6"
                  sx={{
                    fontSize: "1rem",
                    fontWeight: 700,
                    lineHeight: 1.15,
                    color: "inherit",
                  }}
                >
                  Queue settings
                </Typography>

                <Typography
                  variant="body2"
                  sx={{
                    mt: 0.6,
                    color: "rgba(255,255,255,0.78)",
                    lineHeight: 1.5,
                    maxWidth: 720,
                  }}
                >
                  Select the execution queue and adjust its submission parameters before launching the protocol.
                </Typography>

                {!!queueDraft?.queueName && (
                  <Box
                    sx={{
                      mt: 1.2,
                      display: "inline-flex",
                      alignItems: "center",
                      px: 1.2,
                      py: 0.45,
                      borderRadius: "999px",
                      backgroundColor: "rgba(255,255,255,0.12)",
                      border: "1px solid rgba(255,255,255,0.14)",
                      color: "#ffffff",
                      fontSize: "0.76rem",
                      fontWeight: 700,
                      letterSpacing: "0.02em",
                    }}
                  >
                    Active queue:&nbsp;{queueDraft.queueName}
                  </Box>
                )}
              </Box>
            </Box>

            <IconButton
              onClick={() => {
                if (isBusy) return;
                setQueueDialogOpen(false);
                setPendingExecuteMode(null);
              }}
              size="small"
              sx={{
                color: "#e5e7eb",
                border: "1px solid rgba(255,255,255,0.14)",
                backgroundColor: "rgba(255,255,255,0.06)",
                "&:hover": {
                  backgroundColor: "rgba(255,255,255,0.12)",
                  borderColor: "rgba(255,255,255,0.22)",
                },
              }}
            >
              <CloseIcon fontSize="small" />
            </IconButton>
          </Box>
        </DialogTitle>

        <DialogContent
          dividers
          sx={{
            px: 2.5,
            py: 2.5,
            background:
              "linear-gradient(180deg, #f8fafc 0%, #f4f7fb 100%)",
            borderColor: "rgba(15,23,42,0.08)",
          }}
        >
          <Box sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
            <Box
              sx={{
                p: 1.75,
                borderRadius: "20px",
                backgroundColor: "#ffffff",
                border: "1px solid rgba(15,23,42,0.08)",
                boxShadow: "0 10px 26px rgba(15,23,42,0.06)",
              }}
            >
              <Typography
                variant="body2"
                sx={{
                  mb: 1,
                  fontWeight: 700,
                  color: "#334155",
                  letterSpacing: "0.01em",
                }}
              >
                Queue selection
              </Typography>

              <FormControl fullWidth size="small">
                <InputLabel id="queue-select-label">Queue</InputLabel>
                <Select
                  labelId="queue-select-label"
                  value={queueDraft?.queueName ?? ""}
                  label="Queue"
                  onChange={(e) => handleQueueDraftQueueChange(String(e.target.value))}
                  sx={{
                    borderRadius: "14px",
                    backgroundColor: "#ffffff",
                    "& .MuiOutlinedInput-notchedOutline": {
                      borderColor: "rgba(15,23,42,0.12)",
                    },
                  }}
                >
                  {effectiveHostQueues.map((queue) => (
                    <MenuItem key={queue.name} value={queue.name}>
                      {queue.name}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
            </Box>

            {(queueDraft?.params ?? []).length > 0 && (
              <Box
                key={queueDraft?.queueName || "queue-params"}
                sx={{
                  display: "grid",
                  gridTemplateColumns: {
                    xs: "1fr",
                    md: "1fr 1fr",
                  },
                  gap: 1.5,
                  animation: "ppQueueFadeIn 180ms ease-out",
                  "@keyframes ppQueueFadeIn": {
                    from: {
                      opacity: 0,
                      transform: "translateY(6px) scale(0.995)",
                    },
                    to: {
                      opacity: 1,
                      transform: "translateY(0) scale(1)",
                    },
                  },
                }}
              >
                {(queueDraft?.params ?? []).map((param) => (
                  <Box
                    key={param.variableName}
                    sx={{
                      p: 1.5,
                      borderRadius: "18px",
                      backgroundColor: "#ffffff",
                      border: "1px solid rgba(15,23,42,0.08)",
                      boxShadow: "0 8px 22px rgba(15,23,42,0.05)",
                      transition:
                        "transform 180ms ease, box-shadow 180ms ease, border-color 180ms ease",
                      "&:hover": {
                        transform: "translateY(-1px)",
                        boxShadow: "0 14px 28px rgba(15,23,42,0.08)",
                        borderColor: "rgba(51,61,73,0.16)",
                      },
                    }}
                  >
                    <Typography
                      variant="caption"
                      sx={{
                        display: "block",
                        mb: 0.9,
                        fontWeight: 700,
                        color: "#64748b",
                        letterSpacing: "0.03em",
                        textTransform: "uppercase",
                      }}
                    >
                      {param.variableName}
                    </Typography>

                    <TextField
                      label={param.label || param.variableName}
                      value={param.value}
                      onChange={(e) => {
                        const nextValue = e.target.value;
                        setQueueDraft((prev) => {
                          if (!prev) return prev;

                          return {
                            ...prev,
                            params: prev.params.map((item) =>
                              item.variableName === param.variableName
                                ? { ...item, value: nextValue }
                                : item
                            ),
                          };
                        });
                      }}
                      fullWidth
                      size="small"
                      helperText={param.help || param.variableName}
                      sx={{
                        "& .MuiOutlinedInput-root": {
                          borderRadius: "14px",
                          backgroundColor: "#ffffff",
                          "& .MuiOutlinedInput-notchedOutline": {
                            borderColor: "rgba(15,23,42,0.12)",
                          },
                        },
                        "& .MuiFormHelperText-root": {
                          marginLeft: 0,
                          marginRight: 0,
                          marginTop: 0.8,
                          color: "text.secondary",
                          lineHeight: 1.4,
                        },
                      }}
                    />
                  </Box>
                ))}
              </Box>
            )}
          </Box>
        </DialogContent>

        <DialogActions
          sx={{
            px: 2.5,
            py: 2,
            backgroundColor: "#ffffff",
            borderTop: "1px solid rgba(15,23,42,0.08)",
            justifyContent: "space-between",
            alignItems: "center",
            gap: 2,
            flexWrap: "wrap",
          }}
        >
          <Box>
            <Typography
              variant="caption"
              sx={{
                display: "block",
                color: "text.secondary",
                lineHeight: 1.45,
              }}
            >
              These queue values will be sent together with the protocol launch request.
            </Typography>
          </Box>

          <Box sx={{ display: "flex", gap: 1.25 }}>
            <Button
              onClick={() => {
                setQueueDialogOpen(false);
                setPendingExecuteMode(null);
              }}
              disabled={isBusy}
              variant="outlined"
              sx={{
                textTransform: "none",
                borderRadius: "12px",
                px: 2,
                fontWeight: 600,
              }}
            >
              Cancel
            </Button>

            <Button
              variant="contained"
              color="success"
              onClick={confirmQueueAndExecute}
              disabled={isBusy}
              sx={{
                textTransform: "none",
                borderRadius: "12px",
                px: 2.25,
                fontWeight: 700,
                boxShadow: "0 10px 24px rgba(22,163,74,0.24)",
              }}
            >
              Launch
            </Button>
          </Box>
        </DialogActions>
      </Dialog>

      {/* Wizard Loading Dialog */}
      <WizardLoadingDialog
        open={openingWizard.open}
        title={openingWizard.title}
        message={openingWizard.message}
      />

      {/* Wizard selector dialog */}
      <WizardDialogHost
        wizardState={wizardState}
        previewLoading={interactivePreviewLoading}
        onClose={closeWizard}
        onConfirm={confirmWizard}
        onOptionsSelectedValueChange={setOptionsSelectedValue}
        onInputValueChange={setInputFieldValue}
        onMaskRadiusChange={setMaskRadiusValue}
        onMaskRadiusCommit={commitMaskRadiusValue}
        onMaskRadiusSelectedIndexChange={setMaskRadiusSelectedIndex}
        onMaskRadiiInnerChange={setMaskRadiiInnerValue}
        onMaskRadiiInnerCommit={commitMaskRadiiInnerValue}
        onMaskRadiiOuterChange={setMaskRadiiOuterValue}
        onMaskRadiiOuterCommit={commitMaskRadiiOuterValue}
        onMaskRadiiSelectedIndexChange={setMaskRadiiSelectedIndex}
        onCtfDownsampleChange={setCtfDownsampleValue}
        onCtfDownsampleCommit={commitCtfDownsampleValue}
        onCtfLowFreqChange={setCtfLowFreqValue}
        onCtfLowFreqCommit={commitCtfLowFreqValue}
        onCtfHighFreqChange={setCtfHighFreqValue}
        onCtfHighFreqCommit={commitCtfHighFreqValue}
        onCtfSelectedIndexChange={setCtfSelectedIndex}
        onFilterLowFreqChange={setFilterLowFreqValue}
        onFilterLowFreqCommit={commitFilterLowFreqValue}
        onFilterHighFreqChange={setFilterHighFreqValue}
        onFilterHighFreqCommit={commitFilterHighFreqValue}
        onFilterDecayChange={setFilterDecayValue}
        onFilterDecayCommit={commitFilterDecayValue}
        onFilterSelectedIndexChange={setFilterSelectedIndex}
        onDownsamplePreviewChange={setDownsamplePreviewValue}
        onDownsamplePreviewCommit={commitDownsamplePreviewValue}
        onDownsamplePreviewSelectedIndexChange={setDownsamplePreviewSelectedIndex}
        onPointInVolumeChange={setPointInVolumePoint}
        onPointInVolumeVoxelChange={setPointInVolumeVoxel}

      />

      {/* Generic execute/save error dialog */}
      <ExecErrorDialog
        open={execErrorDialogOpen}
        onClose={() => setExecErrorDialogOpen(false)}
        title={execErrorDialogTitle}
        message={execErrorDialogMessage}
      />

      {/* Validation errors dialog */}
      <ValidationErrorsDialog
        open={showValidationDialog}
        onClose={() => setShowValidationDialog(false)}
        errors={validationErrors}
      />
    </div>
  );
}
