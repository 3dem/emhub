// src/components/protocol/ProtocolNodeCardWrapper.tsx
import type React from "react";
import { useMemo } from "react";
import type { NodeProps } from "reactflow";
import { useReactFlow } from "reactflow";

import ProtocolNodeCard, { type ExternalAnalyzeViewerService } from "./ProtocolNodeCard";
import type { NodeMenuVisibility } from "@/types/protocol-node-menu-items";

type NodeActions = {
  onEdit?: (id: string) => void;
  onRename?: (id: string) => void;
  onDuplicate?: (id: string) => void;
  onCopyWorkflow?: (id: string) => void;
  onPasteWorkflow?: (id: string) => void;
  onDelete?: (id: string) => void;
  onRestartAll?: (id: string) => void;
  onContinueAll?: (id: string) => void;
  onResetFrom?: (id: string) => void;
  onSelectFrom?: (id: string) => void;
  onSelectTo?: (id: string) => void;
  onStop?: (id: string) => void;

  onManageTags?: (
    protocolId: string,
    projectId?: string | number,
    protocolLabel?: string
  ) => void;

  onOpenProtocolClass?: (
    protocolClass: string,
    projectId?: string | number,
    sourceProtocolId?: string,
    sourceProtocolLabel?: string
  ) => void;
};

export const createStatusNodeWrapper = (
  onClick: (data: any, evt?: React.MouseEvent) => void,
  onDoubleClick: (data: any) => void,
  getSelectedNodeId: () => string | undefined,
  getHoveredNodeId: () => string | undefined,
  setHoveredNodeId?: React.Dispatch<React.SetStateAction<string | null>>,
  getGraphDirection?: () => "TB" | "LR",
  getViewMode?: () => "hierarchical" | "grid" | "table",
  getNodeActions?: () => NodeActions,
  getPathSelectionNodeIds?: () => Set<string>,
  onBrowse?: (protocolId: string, projectId?: string | number, protocolLabel?: string) => void,
  getProjectId?: () => string | number | undefined,
  getAnalyzeViewerService?: () => ExternalAnalyzeViewerService | undefined,
  getContextMenuVisibility?: () => NodeMenuVisibility | undefined,
  getProtocolOutputThumbnailsEnabled?: () => boolean,
) => {
  return function StatusNodeWrapper(props: NodeProps) {
    const { data, id, ...rest } = props;

    const { getViewport } = useReactFlow();
    const { zoom } = getViewport();

    const selectedNodeId = getSelectedNodeId?.();
    const hoveredNodeId = getHoveredNodeId?.();
    const graphDirection = getGraphDirection?.() ?? "TB";
    const viewMode = getViewMode?.() ?? "hierarchical";

    const handleMouseEnter = () => setHoveredNodeId?.(String(id));
    const handleMouseLeave = () => setHoveredNodeId?.(null);

    const actions = getNodeActions?.() ?? {};

    const pathSelectedSet = getPathSelectionNodeIds?.() ?? new Set<string>();
    const inPathSelection = pathSelectedSet.has(String(id));
    const pathSelectionActive = pathSelectedSet.size > 0;

    const resolvedProjectId = getProjectId?.();
    const analyzeViewerService = getAnalyzeViewerService?.();
    const contextMenuVisibility = getContextMenuVisibility?.();
    const protocolOutputThumbnailsEnabled =
      getProtocolOutputThumbnailsEnabled?.() === true;

    const mergedData = useMemo(() => {
      const d = (data as any) ?? {};
      return {
        ...d,
        projectId: d.projectId ?? resolvedProjectId,
        protocolOutputThumbnailsEnabled,
      };
    }, [data, resolvedProjectId, protocolOutputThumbnailsEnabled]);

    return (
      <div
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        style={{ display: "inline-block" }}
      >
        <ProtocolNodeCard
          {...rest}
          id={String(id)}
          data={mergedData}
          selectedNodeId={selectedNodeId}
          onClick={(evt?: React.MouseEvent) => onClick(mergedData, evt)}
          onDoubleClick={() => onDoubleClick(mergedData)}
          graphDirection={graphDirection}
          zoomLevel={zoom}
          hoveredNodeId={hoveredNodeId}
          setHoveredNodeId={setHoveredNodeId}
          isHovered={typeof hoveredNodeId === "string" && String(id) === String(hoveredNodeId)}
          onEdit={actions.onEdit}
          onRename={actions.onRename}
          onDuplicate={actions.onDuplicate}
          onCopyWorkflow={actions.onCopyWorkflow}
          onPasteWorkflow={actions.onPasteWorkflow}
          onDelete={actions.onDelete}
          onRestartAll={actions.onRestartAll}
          onContinueAll={actions.onContinueAll}
          onResetFrom={actions.onResetFrom}
          onSelectFrom={actions.onSelectFrom}
          onSelectTo={actions.onSelectTo}
          onStop={actions.onStop}
          onManageTags={actions.onManageTags}
          onOpenProtocolClass={actions.onOpenProtocolClass}
          inPathSelection={inPathSelection}
          pathSelectionActive={pathSelectionActive}
          onBrowse={onBrowse}
          showHandles={viewMode !== "grid"}
          service={analyzeViewerService}
          contextMenuVisibility={contextMenuVisibility}
        />
      </div>
    );
  };
};
