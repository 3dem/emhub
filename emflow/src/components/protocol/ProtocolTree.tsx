import { useState, useEffect, type FC } from "react";
import {
  DocsIcon,
  FolderIcon,
  OpenFolderIcon,
  ChevronDownIcon,
  ChevronUpIcon,
} from "@/icons";
import { HelpCircle } from "lucide-react";
import styles from "./protocoltree.module.css";

// --- Icon components ---
export const BetaIcon: FC<{ className?: string }> = ({ className }) => (
  <svg
    width="72"
    height="72"
    viewBox="0 0 140 60"
    xmlns="http://www.w3.org/2000/svg"
    className={className}
  >
    <rect width="140" height="60" fill="#dc3545" rx="14" ry="14" />
    <text
      x="70"
      y="30"
      fill="#ffffff"
      fontSize="30"
      fontFamily="Arial"
      fontWeight="bold"
      textAnchor="middle"
      dominantBaseline="middle"
    >
      BETA
    </text>
  </svg>
);

export const NewIcon: FC<{ className?: string }> = ({ className }) => (
  <svg
    width="72"
    height="72"
    viewBox="0 0 140 60"
    xmlns="http://www.w3.org/2000/svg"
    className={className}
  >
    <rect width="140" height="60" fill="#28a745" rx="14" ry="14" />
    <text
      x="70"
      y="30"
      fill="#ffffff"
      fontSize="28"
      fontFamily="Arial"
      fontWeight="bold"
      textAnchor="middle"
      dominantBaseline="middle"
    >
      NEW
    </text>
  </svg>
);

export const UpdatedIcon: FC<{ className?: string }> = ({ className }) => (
  <svg
    width="72"
    height="72"
    viewBox="0 0 140 60"
    xmlns="http://www.w3.org/2000/svg"
    className={className}
  >
    <rect width="140" height="60" fill="#ffc107" rx="14" ry="14" />
    <text
      x="70"
      y="30"
      fill="#000000"
      fontSize="28"
      fontFamily="Arial"
      fontWeight="bold"
      textAnchor="middle"
      dominantBaseline="middle"
    >
      UPDATED
    </text>
  </svg>
);

export const ProtocolIcons: Record<string, FC<{ className?: string }>> = {
  beta: BetaIcon,
  new: NewIcon,
  updated: UpdatedIcon,
};

// --- Types ---
export interface IconData {
  name: string;
  top: number;
  left: number;
  bottom: number;
  right: number;
}

export interface ProtocolNode {
  text: string;
  value?: string | null;
  icon?: IconData;
  tag?: string;
  openItem?: boolean | string;
  visible?: boolean;
  childs?: ProtocolNode[];
}

interface ProtocolsTreeProps {
  data: ProtocolNode[];
  searchText?: string;
  onNodeDoubleClick?: (protocolId: string) => void;
  onNodeHelpClick?: (protocolId: string, protocolLabel?: string) => void;
  isDark?: boolean;
}

// --- Recursive search ---
const filterTree = (nodes: ProtocolNode[], search: string): ProtocolNode[] => {
  const lowerSearch = search.toLowerCase();

  return nodes.map((node) => {
    const matches = node.text.toLowerCase().includes(lowerSearch);

    if (matches) return { ...node, childs: node.childs };

    const filteredChildren = node.childs ? filterTree(node.childs, search) : undefined;

    if (filteredChildren && filteredChildren.length > 0) return { ...node, childs: filteredChildren };

    return null;
  }).filter(Boolean) as ProtocolNode[];
};

// --- Highlight function ---
const highlightText = (text: string, search: string) => {
  if (!search) return text;

  // escapeSearchForRegex
  const escaped = search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const regex = new RegExp(`(${escaped})`, "gi");
  const parts = text.split(regex);

  return parts.map((part, idx) =>
    regex.test(part) ? (
      <mark key={idx} className={styles.highlight}>
        {part}
      </mark>
    ) : (
      part
    )
  );
};

// --- Main tree ---
export const ProtocolsTree: FC<ProtocolsTreeProps> = ({
  data,
  searchText = "",
  onNodeDoubleClick,
  onNodeHelpClick,
  isDark = false,
}) => {
  const filteredData = searchText ? filterTree(data, searchText) : data;

  return (
    <div className={[styles.treeRoot, isDark ? styles.dark : ""].filter(Boolean).join(" ")}>
      <div className={styles.treeScroll}>
        {filteredData.map((node, idx) => (
          <ProtocolNodeItem
            key={idx}
            node={node}
            searchText={searchText}
            isRoot
            onNodeDoubleClick={onNodeDoubleClick}
            onNodeHelpClick={onNodeHelpClick}
          />
        ))}
      </div>
    </div>
  );
};

// --- Recursive node component ---
const ProtocolNodeItem: FC<{
  node: ProtocolNode;
  searchText?: string;
  isRoot?: boolean;
  onNodeDoubleClick?: (protocolId: string) => void;
  onNodeHelpClick?: (protocolId: string, protocolLabel?: string) => void;
}> = ({ node, searchText, isRoot = false, onNodeDoubleClick, onNodeHelpClick }) => {
  const hasChildren = !!(node.childs && node.childs.length > 0);

  const [expanded, setExpanded] = useState<boolean>(
    !!(node.openItem === true || node.openItem === "True")
  );

  useEffect(() => {
    if (searchText && searchText.length > 0) {
      setExpanded(
        !!(
          hasChildren &&
          (node.tag === "section" || node.tag === "protocol_group" || node.tag === "package" || isRoot)
        )
      );
    } else {
      setExpanded(!!(node.openItem === true || node.openItem === "True"));
    }
  }, [searchText, hasChildren, node.openItem, node.tag, isRoot]);

  const tagIcon = () => {
    if (node.tag?.startsWith("protocol") && node.tag != "protocol_group") {

      if (!node.icon?.name) { return <DocsIcon className={styles.iconDoc} />; }

      if (node.icon?.name) {
        const key = node.icon.name.split(".")[0];
        const IconComponent = ProtocolIcons[key];
        return IconComponent ? (
          <IconComponent className={styles.iconWideBadge} />
        ) : (
          <DocsIcon className={styles.iconDoc} />
        );
      }
    }

    if (node.tag === "protocol_group" || node.tag === "section" || node.tag === "package") {
      return expanded ? (
        <OpenFolderIcon className={styles.iconOpenFolder} />
      ) : (
        <FolderIcon className={styles.iconFolder} />
      );
    }

    return null;
  };

  const handleDoubleClick = () => {
    if (node.tag === "protocol" && node.value && onNodeDoubleClick) {
      onNodeDoubleClick(node.value);
    }
  };

  const handleHelpClick = (e: React.MouseEvent) => {
    // preventRowHandlersAndOpenHelp
    e.preventDefault();
    e.stopPropagation();
    if (node.tag === "protocol" && node.value && onNodeHelpClick) {
      onNodeHelpClick(node.value, node.text);
    }
  };

  const showHelp = node.tag === "protocol" && !!node.value && !!onNodeHelpClick;

  return (
    <div className={styles.nodeItem}>
      <div
        className={styles.nodeRow}
        onClick={() => {
          if (hasChildren) setExpanded((v) => !v);
        }}
        onDoubleClick={handleDoubleClick}
      >
        {hasChildren && (
          <span className={styles.chevronWrap} aria-hidden="true">
            {expanded ? (
              <ChevronUpIcon className={styles.chevronIcon} />
            ) : (
              <ChevronDownIcon className={styles.chevronIcon} />
            )}
          </span>
        )}

        {!hasChildren && <span className={styles.chevronWrap} aria-hidden="true" />}

        {tagIcon()}

        <span className={styles.nodeText} style={{ flex: 1, minWidth: 0 }}>
          {highlightText(node.text, searchText || "")}
        </span>

        {showHelp && (
          <button
            type="button"
            className={styles.helpButton}
            aria-label="Open protocol help"
            title="Help"
            onClick={handleHelpClick}
            onDoubleClick={(e) => {
              // preventDoubleClickFromFiringRowHandler
              e.preventDefault();
              e.stopPropagation();
            }}
          >
            <HelpCircle className={styles.helpIcon} />
          </button>
        )}
      </div>

      {hasChildren && (
        <div
          className={[
            styles.children,
            expanded ? styles.childrenOpen : styles.childrenClosed,
          ].join(" ")}
        >
          {node.childs!.map((child, idx) => (
            <ProtocolNodeItem
              key={idx}
              node={child}
              searchText={searchText}
              onNodeDoubleClick={onNodeDoubleClick}
              onNodeHelpClick={onNodeHelpClick}
            />
          ))}
        </div>
      )}
    </div>
  );
};
