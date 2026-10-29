// src/components/protocol/CollapsedGroupNodeCard.tsx
// Node of a collapsed group: the root job with its whole subtree hidden
// (graph_utils collapseProtocols). Same size as a ProtocolNodeCard, darker
// green; its only action is expand (double-click or the [ ] button).
import type { MouseEvent as ReactMouseEvent } from "react";
import { Tooltip } from "@mui/material";
import { Handle, Position } from "reactflow";
import { Layers, Scan } from "lucide-react";

import styles from "./ProtocolNodeCard.module.css";

type CollapsedGroupNodeCardProps = {
  data: {
    id: string;
    label?: string;
    title?: string;
    runName?: string;
    comment?: string;
    collapsedCount?: number;
  };
  isSelected: boolean;
  isHovered: boolean;
  inPathSelection: boolean;
  graphDirection: "TB" | "LR";
  showHandles: boolean;
  onClick?: (evt?: ReactMouseEvent) => void;
  onExpand?: (id: string) => void;
};

export default function CollapsedGroupNodeCard({
  data,
  isSelected,
  isHovered,
  inPathSelection,
  graphDirection,
  showHandles,
  onClick,
  onExpand,
}: CollapsedGroupNodeCardProps) {
  const id = String(data.id);
  const protocolLabel = String(data.label ?? "").trim();
  const runName = String(data.runName ?? "").trim();
  const comment = String(data.comment ?? "").trim();
  const count = Number(data.collapsedCount) || 1;

  // Same hover as the job id pill of a normal node
  const jobInfoTooltipProps = {
    title: (
      <div className={styles.jobInfoTooltip}>
        <div className={styles.jobInfoType}>{protocolLabel || String(data.title ?? "")}</div>
        {runName ? <div className={styles.jobInfoTitle}>{runName}</div> : null}
        {comment ? <div className={styles.jobInfoMessage}>{comment}</div> : null}
      </div>
    ),
    placement: "top-start" as const,
    arrow: true,
    enterDelay: 300,
    slotProps: {
      popper: { sx: { zIndex: 26000 } },
      tooltip: { sx: { maxWidth: 560, fontSize: "0.95rem", lineHeight: 1.35 } },
    },
  };

  const classNames = [
    styles.card,
    styles.crispText,
    styles.collapsedGroup,
    isHovered ? styles.hovered : "",
    isSelected ? styles.selected : "",
    inPathSelection ? styles.inPathSelection : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div
      className={classNames}
      onClick={(e) => onClick?.(e)}
      onDoubleClick={(e) => {
        e.stopPropagation();
        onExpand?.(id);
      }}
      onContextMenu={(e) => e.preventDefault()}
    >
      <div className={[styles.header, styles.headerProtocol].join(" ")}>
        <div className={styles.headerLeft}>
          <Tooltip {...jobInfoTooltipProps}>
            <div className={styles.nodeIdBadge} style={{ fontSize: "2.3rem" }}>
              <span>{id}</span>
            </div>
          </Tooltip>
          {runName ? (
            <Tooltip {...jobInfoTooltipProps}>
              <div className={[styles.label, styles.annotationTitle].join(" ")}>{runName}</div>
            </Tooltip>
          ) : null}
        </div>

        <div className={styles.headerRight}>
          <button
            type="button"
            className={`${styles.iconButton} nodrag`}
            onPointerDown={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              onExpand?.(id);
            }}
            onDoubleClick={(e) => e.stopPropagation()}
            draggable={false}
            data-nodrag
            aria-label="Expand group"
            title="Expand"
          >
            <Scan className={styles.scanIcon} />
          </button>
        </div>
      </div>

      <div className={[styles.content, styles.contentExpanded].join(" ")}>
        <div className={styles.cardContent}>
          <div className={styles.outputsReserved}>
            <div className={styles.outputsList}>
              <div className={styles.sectionHeader}>
                <span className={styles.sectionTitle}>Collapsed</span>
              </div>
              <div className={styles.sectionContent}>
                <div className={styles.outputPill}>
                  <Layers className={styles.outputIcon} />
                  <span className={styles.outputText}>
                    {count} {count === 1 ? "job" : "jobs"}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Same footer row as a normal node (keeps the same size) */}
        <div className={styles.footer}>
          <div className={styles.footerTopRow}>
            <span className={styles.statusBadge} style={{ backgroundColor: "#3f8f36" }}>
              collapsed
            </span>
          </div>
        </div>
      </div>

      {showHandles && (
        <>
          <Handle
            type="target"
            position={graphDirection === "TB" ? Position.Top : Position.Left}
            style={graphDirection === "TB" ? {} : { top: "50%", transform: "translateY(-50%)" }}
          />
          <Handle
            type="source"
            position={graphDirection === "TB" ? Position.Bottom : Position.Right}
            style={graphDirection === "TB" ? {} : { top: "50%", transform: "translateY(-50%)" }}
          />
        </>
      )}
    </div>
  );
}
