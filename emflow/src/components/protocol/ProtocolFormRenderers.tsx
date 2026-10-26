import type { JSX, ReactNode } from "react";
import {
  Box,
  FormControlLabel,
  MenuItem,
  Radio,
  RadioGroup,
  Switch,
  TextField,
} from "@mui/material";

import ParamRow from "./ParamRow";
import WrapWithDrop from "./WrapWithDrop";

import {
  clearParamValue,
  setParamEditableValue,
  setParamValueAndEditableValue,
} from "@/utils/protocolform.state";
import {
  coerceBooleanValue,
  coerceReadOnlyFlag,
  normalizeEnumOptions,
  normalizeEnumSelection,
} from "@/utils/protocolform.utils";
import type { WizardUiProps } from "./wizards/protocol_wizard_meta";

type LayoutVariant = "standard" | "inline";

type CommonRendererProps = {
  stableKey: string;
  label: string;
  helpText?: string;
  rowIndex: number;
  layoutVariant: LayoutVariant;
  isInline: boolean;
  fieldWidth: number;
  fieldContainerSx: any;
  advancedSlot: ReactNode;
  stateKey: string;
  protocolDetails: any;
  setProtocolDetails: (updater: (prev: any) => any) => void;
  wizardUi?: WizardUiProps;
};

type PointerRendererProps = CommonRendererProps & {
  def: any;
  defResolved: any;
  dragOverKey: string | null;
  setDragOverKey: (value: string | null) => void;
  onOpenFind: (stateKey: string) => void;
};

type PathRendererProps = CommonRendererProps & {
  def: any;
  dragOverKey: string | null;
  setDragOverKey: (value: string | null) => void;
  onBrowsePath: () => void;
  onOpenFind: (stateKey: string) => void;
};

type EnumRendererProps = CommonRendererProps & {
  def: any;
  value: any;
};

type BooleanRendererProps = CommonRendererProps & {
  def: any;
  value: any;
};

type DefaultRendererProps = CommonRendererProps & {
  def: any;
  value: any;
};

export function renderPointerParamRow({
  stableKey,
  label,
  helpText,
  rowIndex,
  layoutVariant,
  isInline,
  fieldWidth,
  advancedSlot,
  stateKey,
  protocolDetails,
  setProtocolDetails,
  def,
  defResolved,
  dragOverKey,
  setDragOverKey,
  onOpenFind,
  wizardUi,
}: PointerRendererProps): JSX.Element {
  const liveDef = {
    ...defResolved,
    ...(protocolDetails.params?.[stateKey] || {}),
    paramClass: "PointerParam",
  };

  const isReadOnly = coerceReadOnlyFlag(def?.readOnly);

  const field = (
    <TextField
      size="small"
      fullWidth={!isInline}
      value={String(
        protocolDetails.params?.[stateKey]?.editableValue ??
          protocolDetails.params?.[stateKey]?.value ??
          def.default ??
          "",
      )}
      onChange={
        isReadOnly
          ? undefined
          : (e) =>
              setProtocolDetails((prev: any) =>
                setParamValueAndEditableValue(prev, stateKey, e.target.value),
              )
      }
      InputProps={isReadOnly ? { readOnly: true } : undefined}
      onClick={isReadOnly ? () => onOpenFind(stateKey) : undefined}
      sx={{
        width: isInline ? fieldWidth : "100%",
        minWidth: 0,
        "& .MuiInputBase-root": { minHeight: 36 },
        "& .MuiInputBase-input, & input, & input[readonly]": {
          fontSize: 12,
          padding: "8px 10px",
          lineHeight: 1.2,
          color: "#111827",
          WebkitTextFillColor: "#111827",
          opacity: 1,
          userSelect: isReadOnly ? "none" : "text",
          cursor: isReadOnly ? "pointer" : "text",
        },
      }}
    />
  );

  return (
    <ParamRow
      key={stableKey}
      label={label}
      control={
        <Box sx={{ display: "flex", alignItems: "center", gap: 1, minWidth: 0, width: "100%" }}>
          {advancedSlot}
          <Box
            sx={{
              width: "100%",
              maxWidth: fieldWidth,
              minWidth: 0,
            }}
          >
            <WrapWithDrop
              control={field}
              def={liveDef}
              paramKey={stateKey}
              setProtocolDetails={setProtocolDetails}
              setDragOverKey={setDragOverKey}
              dragOverKey={dragOverKey}
            />
          </Box>
        </Box>
      }
      helpText={helpText}
      isPointerParam
      onClear={() => setProtocolDetails((prev: any) => clearParamValue(prev, stateKey))}
      rowIndex={rowIndex}
      onOpenFind={() => onOpenFind(stateKey)}
      layoutVariant={layoutVariant}
      hasWizard={wizardUi?.hasWizard ?? false}
      onOpenWizard={wizardUi?.onOpenWizard}
      wizardTooltip={wizardUi?.wizardTooltip}
    />
  );
}

export function renderPathParamRow({
  stableKey,
  label,
  helpText,
  rowIndex,
  layoutVariant,
  isInline,
  fieldWidth,
  advancedSlot,
  stateKey,
  protocolDetails,
  setProtocolDetails,
  def,
  dragOverKey,
  setDragOverKey,
  onBrowsePath,
  onOpenFind,
  wizardUi,
}: PathRendererProps): JSX.Element {
  const current = protocolDetails.params?.[stateKey] || {};
  const textValue = current.editableValue ?? current.value ?? def.value ?? def.default ?? "";

  const isPointerEnabled =
    typeof current.pointerClass === "string"
      ? current.pointerClass.trim().length > 0
      : typeof def.pointerClass === "string" && def.pointerClass.trim().length > 0;

  const field = (
    <TextField
      size="small"
      fullWidth={!isInline}
      name={stateKey}
      value={textValue}
      onChange={(e) =>
        setProtocolDetails((prev: any) =>
          setParamValueAndEditableValue(prev, stateKey, e.target.value),
        )
      }
      sx={{
        width: isInline ? fieldWidth : "98%",
        minWidth: 0,
        "& .MuiInputBase-root": { minHeight: 36 },
        "& .MuiInputBase-input": { fontSize: 12, padding: "8px 10px", lineHeight: 1.2 },
      }}
    />
  );

  return (
    <ParamRow
      key={stableKey}
      label={label}
      control={
        <Box sx={{ display: "flex", alignItems: "center", gap: 1, minWidth: 0, width: "100%" }}>
          {advancedSlot}
          <Box
            sx={{
              width: "100%",
              maxWidth: fieldWidth,
              minWidth: 0,
            }}
          >
            {isPointerEnabled ? (
              <WrapWithDrop
                control={field}
                def={{ ...def, ...current }}
                paramKey={stateKey}
                setProtocolDetails={setProtocolDetails}
                setDragOverKey={setDragOverKey}
                dragOverKey={dragOverKey}
              />
            ) : (
              field
            )}
          </Box>
        </Box>
      }
      helpText={helpText}
      isPathParam
      onBrowsePath={onBrowsePath}
      onClear={() => setProtocolDetails((prev: any) => clearParamValue(prev, stateKey))}
      isPointerParam={isPointerEnabled}
      onOpenFind={isPointerEnabled ? () => onOpenFind(stateKey) : undefined}
      rowIndex={rowIndex}
      layoutVariant={layoutVariant}
      hasWizard={wizardUi?.hasWizard ?? false}
      onOpenWizard={wizardUi?.onOpenWizard}
      wizardTooltip={wizardUi?.wizardTooltip}
    />
  );
}

export function renderEnumParamRow({
  stableKey,
  label,
  helpText,
  rowIndex,
  layoutVariant,
  isInline,
  fieldWidth,
  advancedSlot,
  stateKey,
  setProtocolDetails,
  def,
  value,
  wizardUi,
}: EnumRendererProps): JSX.Element | null {
  const options = normalizeEnumOptions(def.choices);
  if (options.length === 0) return null;

  const safeSel = normalizeEnumSelection(value ?? def.default ?? "", def.choices, def.default);

  const onChange = (nextValue: any) =>
    setProtocolDetails((prev: any) => setParamEditableValue(prev, stateKey, nextValue));

  const controlBase =
    def.display === 0 ? (
      <RadioGroup row value={safeSel} onChange={(e) => onChange(e.target.value)}>
        {options.map((opt, i) => (
          <FormControlLabel
            key={i}
            value={opt.value}
            control={<Radio size="small" />}
            label={opt.label}
            sx={{ "& .MuiFormControlLabel-label": { fontSize: 12, lineHeight: 1.2 } }}
          />
        ))}
      </RadioGroup>
    ) : (
      <TextField
        select
        size="small"
        value={safeSel}
        onChange={(e) => onChange(e.target.value)}
        sx={{
          width: isInline ? fieldWidth : "69%",
          minWidth: 0,
          "& .MuiInputBase-input": { fontSize: 12 },
          "& .MuiSelect-select": { fontSize: 12, display: "flex", alignItems: "center" },
        }}
      >
        {options.map((opt, i) => (
          <MenuItem key={i} value={opt.value} sx={{ fontSize: 12 }}>
            {opt.label}
          </MenuItem>
        ))}
      </TextField>
    );

  return (
    <ParamRow
      key={stableKey}
      label={label}
      control={
        <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
          {advancedSlot}
          {controlBase}
        </Box>
      }
      helpText={helpText}
      rowIndex={rowIndex}
      layoutVariant={layoutVariant}
      hasWizard={wizardUi?.hasWizard ?? false}
      onOpenWizard={wizardUi?.onOpenWizard}
      wizardTooltip={wizardUi?.wizardTooltip}
    />
  );
}

export function renderBooleanParamRow({
  stableKey,
  label,
  helpText,
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
}: BooleanRendererProps): JSX.Element {
  const checked = coerceBooleanValue(
    value !== undefined
      ? value
      : protocolDetails.params?.[stateKey]?.value ?? def.value ?? def.default,
  );

  return (
    <ParamRow
      key={stableKey}
      label={label}
      control={
        <Box
          sx={{
            display: "flex",
            alignItems: "center",
            gap: 1,
            minWidth: 0,
            width: isInline ? fieldWidth : "100%",
          }}
        >
          {advancedSlot}
          <Box sx={fieldContainerSx}>
            <Switch
              checked={checked}
              onChange={(e) =>
                setProtocolDetails((prev: any) =>
                  setParamValueAndEditableValue(prev, stateKey, e.target.checked),
                )
              }
              color="primary"
              sx={{ m: 0 }}
            />
          </Box>
        </Box>
      }
      helpText={helpText}
      rowIndex={rowIndex}
      layoutVariant={layoutVariant}
      hasWizard={wizardUi?.hasWizard ?? false}
      onOpenWizard={wizardUi?.onOpenWizard}
      wizardTooltip={wizardUi?.wizardTooltip}
    />
  );
}

export function renderDefaultParamRow({
  stableKey,
  label,
  helpText,
  rowIndex,
  layoutVariant,
  isInline,
  fieldWidth,
  fieldContainerSx,
  advancedSlot,
  stateKey,
  setProtocolDetails,
  def,
  value,
  wizardUi,
}: DefaultRendererProps): JSX.Element {
  const defaultControl = (
    <Box sx={{ display: "flex", alignItems: "center", gap: 1, minWidth: 0, width: "77%" }}>
      {advancedSlot}
      <Box sx={fieldContainerSx}>
        <TextField
          size="small"
          fullWidth={!isInline}
          name={stateKey}
          value={value ?? def.default ?? ""}
          onChange={(e) =>
            setProtocolDetails((prev: any) =>
              setParamEditableValue(prev, stateKey, e.target.value),
            )
          }
          sx={{
            width: isInline ? fieldWidth : "100%",
            minWidth: 0,
            "& .MuiInputBase-root": { minHeight: 36 },
            "& .MuiInputBase-input": { fontSize: 12, padding: "8px 10px", lineHeight: 1.2 },
          }}
        />
      </Box>
    </Box>
  );

  return (
    <ParamRow
      key={stableKey}
      label={label}
      control={defaultControl}
      helpText={helpText}
      rowIndex={rowIndex}
      layoutVariant={layoutVariant}
      hasWizard={wizardUi?.hasWizard ?? false}
      onOpenWizard={wizardUi?.onOpenWizard}
      wizardTooltip={wizardUi?.wizardTooltip}
    />
  );
}