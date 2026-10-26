import { useState, useMemo, useEffect, useRef } from "react";
import {
  Box,
  Button,
} from "@mui/material";
import { Copy } from "lucide-react";

// jsonSyntaxColors
const jsonPunctColor = "var(--json-punct-color, #000000)"; // braces, brackets, commas, colon
const jsonKeyColor = "var(--json-key-color, #000000)";
const jsonStringColor = "var(--json-string-color, #16a34a)";
const jsonNumberColor = "var(--json-number-color, #f97316)";
const jsonBooleanColor = "var(--json-boolean-color, #7c3aed)";
const jsonNullColor = "var(--json-null-color, #6b7280)";
const jsonFallbackColor = "var(--json-fallback-color, #111827)";

const jsonIndentPx = 14;
const jsonToggleColWidthPx = 18;

function useAncestorDarkMode<T extends HTMLElement>() {
  const rootRef = useRef<T | null>(null);
  const [isDark, setIsDark] = useState(false);

  useEffect(() => {
    const updateDarkMode = () => {
      setIsDark(Boolean(rootRef.current?.closest(".dark")));
    };

    updateDarkMode();

    const observer = new MutationObserver(updateDarkMode);
    observer.observe(document.documentElement, {
      attributes: true,
      childList: true,
      subtree: true,
      attributeFilter: ["class"],
    });

    return () => observer.disconnect();
  }, []);

  return { rootRef, isDark };
}

function getJsonScalarColor(value: any): string {
  // getJsonScalarColor
  if (value === null || value === undefined) return jsonNullColor;
  if (typeof value === "string") return jsonStringColor;
  if (typeof value === "number" || typeof value === "bigint") return jsonNumberColor;
  if (typeof value === "boolean") return jsonBooleanColor;
  return jsonFallbackColor;
}

function renderJsonScalar(value: any) {
  // renderJsonScalar
  return <span style={{ color: getJsonScalarColor(value) }}>{formatJsonScalar(value)}</span>;
}

// jsonTreeViewer
function formatJsonScalar(value: any): string {
  // formatJsonScalar
  if (value === null) return "null";
  if (value === undefined) return "null";
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (typeof value === "bigint") return JSON.stringify(value.toString());
  if (typeof value === "function") return JSON.stringify("[Function]");
  if (typeof value === "symbol") return JSON.stringify("[Symbol]");
  return JSON.stringify(String(value));
}

function makeSafeJsonReplacer() {
  // makeSafeJsonReplacer
  const seen = new WeakSet<object>();

  return (_key: string, value: any) => {
    if (typeof value === "bigint") return value.toString();
    if (typeof value === "function") return "[Function]";
    if (typeof value === "symbol") return "[Symbol]";

    if (value && typeof value === "object") {
      if (seen.has(value)) return "[Circular]";
      seen.add(value);
    }
    return value;
  };
}

function copyTextToClipboard(text: string) {
  // copyTextToClipboard
  if (navigator.clipboard?.writeText) {
    return navigator.clipboard.writeText(text);
  }

  // fallbackCopy
  return new Promise<void>((resolve, reject) => {
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.top = "-1000px";
      ta.style.left = "-1000px";
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      const ok = document.execCommand("copy");
      document.body.removeChild(ta);
      ok ? resolve() : reject(new Error("Copy failed"));
    } catch (e) {
      reject(e);
    }
  });
}

type JsonRowProps = {
  indent: number;
  toggle: React.ReactNode;
  children: React.ReactNode;
};

function JsonRow({ indent, toggle, children }: JsonRowProps) {
  // JsonRow
  return (
    <div
      style={{
        paddingLeft: indent * jsonIndentPx,
        display: "grid",
        gridTemplateColumns: `${jsonToggleColWidthPx}px 1fr`,
        columnGap: 6,
        alignItems: "start",
      }}
    >
      <div style={{ width: jsonToggleColWidthPx, lineHeight: 1 }}>{toggle}</div>
      <div
        style={{
          minWidth: 0,
          whiteSpace: "pre-wrap",
          overflowWrap: "anywhere",
          wordBreak: "break-word",
        }}
      >
        {children}
      </div>
    </div>
  );
}

function JsonToggleButton({
  expanded,
  onToggle,
  disabled,
}: {
  expanded: boolean;
  onToggle: () => void;
  disabled?: boolean;
}) {
  // JsonToggleButton
  if (disabled) return <span />;

  return (
    <button
      type="button"
      onClick={onToggle}
      style={{
        width: jsonToggleColWidthPx,
        background: "transparent",
        border: "none",
        padding: 0,
        cursor: "pointer",
        color: "inherit",
        fontFamily: "inherit",
        fontSize: "inherit",
        lineHeight: 1,
      }}
      aria-label={expanded ? "Collapse" : "Expand"}
    >
      {expanded ? "▾" : "▸"}
    </button>
  );
}

function encodePathSegment(seg: string) {
  // encodePathSegment
  try {
    return encodeURIComponent(seg);
  } catch {
    return seg;
  }
}


type JsonNodeProps = {
  value: any;
  path: string;
  indent: number;
  isLast: boolean;
  expandedPaths: Set<string>;
  togglePath: (path: string) => void;
  seen: WeakSet<object>;
  keyName?: string;
  isArrayItem?: boolean;
};

function JsonNode({
  value,
  path,
  indent,
  isLast,
  expandedPaths,
  togglePath,
  seen,
  keyName,
  isArrayItem,
}: JsonNodeProps) {
  // JsonNode
  const comma = isLast ? "" : ",";

  const isObjLike = value !== null && typeof value === "object";
  const isArr = Array.isArray(value);

  const renderKeyPrefix = () => {
    // renderKeyPrefix
    if (typeof keyName !== "string" || !keyName) return null;

    const renderedKey = isArrayItem ? keyName : JSON.stringify(keyName);

    return (
      <>
        <span style={{ color: jsonKeyColor }}>{renderedKey}</span>
        <span style={{ color: jsonPunctColor }}>: </span>
      </>
    );
  };

  if (!isObjLike) {
    return (
      <JsonRow indent={indent} toggle={<span />}>
        {renderKeyPrefix()}
        {renderJsonScalar(value)}
        <span style={{ color: jsonPunctColor }}>{comma}</span>
      </JsonRow>
    );
  }

  if (seen.has(value)) {
    return (
      <JsonRow indent={indent} toggle={<span />}>
        {renderKeyPrefix()}
        <span style={{ color: jsonNullColor }}>{JSON.stringify("[Circular]")}</span>
        <span style={{ color: jsonPunctColor }}>{comma}</span>
      </JsonRow>
    );
  }
  seen.add(value);

  const entries: Array<[string, any]> = isArr
    ? (value as any[]).map((v, i) => [String(i), v])
    : Object.entries(value as Record<string, any>);

  const isExpandable = entries.length > 0;
  const isExpanded = isExpandable && expandedPaths.has(path);

  const itemsLabel = `${entries.length} items`;
  const collapsedToken = isArr ? `[${itemsLabel}]` : `{ ${itemsLabel}}`;
  const open = isArr ? "[" : "{";
  const close = isArr ? "]" : "}";

  // Render empty object/array as a single token: { 0 items } / [0 items]
  if (!isExpandable) {
    return (
      <JsonRow indent={indent} toggle={<span />}>
        {renderKeyPrefix()}
        <span style={{ color: jsonPunctColor }}>{collapsedToken}</span>
        <span style={{ color: jsonPunctColor }}>{comma}</span>
      </JsonRow>
    );
  }

  // Collapsed node: "key": { 3 items }  OR  [20 items]
  if (!isExpanded) {
    return (
      <JsonRow
        indent={indent}
        toggle={<JsonToggleButton expanded={false} onToggle={() => togglePath(path)} />}
      >
        {renderKeyPrefix()}
        <span style={{ color: jsonPunctColor }}>{collapsedToken}</span>
        <span style={{ color: jsonPunctColor }}>{comma}</span>
      </JsonRow>
    );
  }

  // Expanded node:
  // - Opening line contains optional key + the opening brace/bracket
  // - Children lines
  // - Closing line contains only closing brace/bracket + comma
  return (
    <>
      <JsonRow
        indent={indent}
        toggle={<JsonToggleButton expanded={true} onToggle={() => togglePath(path)} />}
      >
        {renderKeyPrefix()}
        <span style={{ color: jsonPunctColor }}>{open}</span>
      </JsonRow>

      {entries.map(([k, v], idx) => {
        const childIsLast = idx === entries.length - 1;
        const childPath = `${path}/${encodePathSegment(k)}`;

        if (isArr) {
          return (
            <JsonNode
              key={childPath}
              value={v}
              path={childPath}
              indent={indent + 1}
              isLast={childIsLast}
              expandedPaths={expandedPaths}
              togglePath={togglePath}
              seen={seen}
            />
          );
        }

        return (
          <JsonNode
            key={childPath}
            value={v}
            path={childPath}
            indent={indent + 1}
            isLast={childIsLast}
            expandedPaths={expandedPaths}
            togglePath={togglePath}
            seen={seen}
            keyName={k}
          />
        );
      })}

      <JsonRow indent={indent} toggle={<span />}>
        <span style={{ color: jsonPunctColor }}>{close}</span>
        <span style={{ color: jsonPunctColor }}>{comma}</span>
      </JsonRow>
    </>
  );
}



function JsonTree({ data }: { data: any }) {
  // JsonTree
  const { rootRef, isDark } = useAncestorDarkMode<HTMLDivElement>();
  const [copied, setCopied] = useState(false);
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(() => new Set(["$"]));

  const togglePath = (path: string) => {
    // togglePath
    setExpandedPaths((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  const jsonText = useMemo(() => {
    // jsonText
    try {
      return JSON.stringify(data, makeSafeJsonReplacer(), 2);
    } catch {
      return String(data);
    }
  }, [data]);

  const handleCopy = async () => {
    // handleCopy
    try {
      await copyTextToClipboard(jsonText);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 900);
    } catch {
      // noOp
    }
  };

  const seen = new WeakSet<object>();

  return (
    <Box
      ref={rootRef}
      sx={{
        height: "100%",
        maxHeight: "100%",
        display: "flex",
        flexDirection: "column",
        gap: 1,
      }}
    >
      <Box sx={{ display: "flex", justifyContent: "flex-end" }}>
        <Button
          size="small"
          variant="outlined"
          onClick={handleCopy}
          startIcon={<Copy size={16} />}
          sx={{ textTransform: "none" }}
        >
          {copied ? "Copying..." : "Copy JSON"}
        </Button>
      </Box>

      <Box
        sx={{
          flex: 1,
          minHeight: 0,
          backgroundColor: isDark ? "rgba(2, 6, 23, 0.72)" : "#f5f5f5",
          color: isDark ? "#e5e7eb" : "#111827",
          border: "1px solid",
          borderColor: isDark ? "rgba(148, 163, 184, 0.26)" : "#e5e7eb",
          borderRadius: 2,
          p: 1.5,
          fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
          fontSize: 12,
          lineHeight: 1.5,
          overflow: "auto",
          boxShadow: isDark
            ? "inset 0 1px 0 rgba(255, 255, 255, 0.04), 0 12px 28px rgba(0, 0, 0, 0.18)"
            : "none",
          scrollbarColor: isDark
            ? "rgba(148, 163, 184, 0.45) rgba(15, 23, 42, 0.55)"
            : undefined,
          "--json-punct-color": isDark ? "#cbd5e1" : "#000000",
          "--json-key-color": isDark ? "#93c5fd" : "#000000",
          "--json-string-color": isDark ? "#86efac" : "#16a34a",
          "--json-number-color": isDark ? "#fdba74" : "#f97316",
          "--json-boolean-color": isDark ? "#c4b5fd" : "#7c3aed",
          "--json-null-color": isDark ? "#94a3b8" : "#6b7280",
          "--json-fallback-color": isDark ? "#e5e7eb" : "#111827",
        }}
      >
        <JsonNode
          value={data}
          path="$"
          indent={0}
          isLast={true}
          expandedPaths={expandedPaths}
          togglePath={togglePath}
          seen={seen}
        />
      </Box>
    </Box>
  );
}

export default JsonTree;
