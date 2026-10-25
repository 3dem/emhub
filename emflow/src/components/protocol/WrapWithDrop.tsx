import React from "react";
import { useDrag } from "./DragContext";
import { Box } from "@mui/material";

export type WrapWithDropProps = {
  control: React.ReactNode;
  def: any;
  paramKey: string;
  setProtocolDetails: React.Dispatch<React.SetStateAction<any>>;
  setDragOverKey: (key: string | null) => void;
  dragOverKey: string | null;
};

function splitClassTokens(value: unknown): string[] {
  if (value === null || value === undefined) return [];

  if (Array.isArray(value)) {
    return value.flatMap(splitClassTokens);
  }

  if (typeof value !== "string") return [];

  return value
    .split(/[,;|]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizeClassToken(value: string): string {
  return value
    .trim()
    .replace(/^["']+|["']+$/g, "")
    .replace(/^class\s+/i, "");
}

function expandClassToken(value: string): string[] {
  const normalized = normalizeClassToken(value);
  if (!normalized) return [];

  const shortName = normalized.split(".").filter(Boolean).pop() ?? normalized;

  return Array.from(
    new Set([
      normalized,
      shortName,
      normalized.toLowerCase(),
      shortName.toLowerCase(),
    ]),
  );
}

function getExpectedClasses(def: any): string[] {
  if (!def) return [];

  const candidates = [
    def.pointerClass,
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

  return Array.from(
    new Set(
      candidates
        .flatMap(splitClassTokens)
        .map(normalizeClassToken)
        .filter(Boolean),
    ),
  );
}

function getDraggedOutputClasses(output: any): string[] {
  if (!output) return [];

  const candidates = [
    output.pointerClass,
    output.className,
    output.outputClassName,
    output.objectClass,
    output.type,
    output._type,
    output.class,
    output.info?.pointerClass,
    output.info?.className,
    output.info?.outputClassName,
    output.info?.objectClass,
    output.info?.type,
    output.info?._type,
    output.info?.class,
  ];

  return Array.from(
    new Set(
      candidates
        .flatMap(splitClassTokens)
        .map(normalizeClassToken)
        .filter(Boolean),
    ),
  );
}

function classesMatch(expectedClasses: string[], draggedClasses: string[]): boolean {
  if (expectedClasses.length === 0) return true;
  if (draggedClasses.length === 0) return false;

  const draggedExpanded = new Set(draggedClasses.flatMap(expandClassToken));

  return expectedClasses.some((expectedClass) =>
    expandClassToken(expectedClass).some((candidate) => draggedExpanded.has(candidate)),
  );
}

export default function WrapWithDrop({
  control,
  def,
  paramKey,
  setProtocolDetails,
  setDragOverKey,
  dragOverKey,
}: WrapWithDropProps) {
  const { currentDraggedOutput } = useDrag();

  const expectedClasses = getExpectedClasses(def);
  const draggedClasses = getDraggedOutputClasses(currentDraggedOutput);
  const isMatch = classesMatch(expectedClasses, draggedClasses);
  const isActive = dragOverKey === paramKey && Boolean(currentDraggedOutput);

  const handleDragOver = (event: React.DragEvent) => {
    event.preventDefault();
    setDragOverKey(paramKey);
  };

  const handleDragLeave = () => {
    setDragOverKey(null);
  };

  const handleDrop = (event: React.DragEvent) => {
    event.preventDefault();
    setDragOverKey(null);

    if (!isMatch || !currentDraggedOutput) return;

    setProtocolDetails((prev: any) => ({
      ...prev,
      params: {
        ...prev.params,
        [paramKey]: {
          ...prev.params[paramKey],
          editableValue: currentDraggedOutput.value ?? "",
          value: currentDraggedOutput.value ?? "",
          info: currentDraggedOutput.info ?? "",
          parentId: currentDraggedOutput.parentId ?? null,
        },
      },
    }));
  };

  return (
    <Box
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      sx={{
        display: "block",
        width: "98%",
        minWidth: 0,
        borderRadius: 1,
        mt: 1,
        outline: "2px dashed #5f5d5dff",
        outlineOffset: 2,
        backgroundColor: isActive ? (isMatch ? "#b7f5c7" : "#f5b7b7") : "transparent",
        transition: "background-color 0.2s",
      }}
    >
      {control}
    </Box>
  );
}