import { LogChannel } from "@/hooks/useProtocolLogs";
import { Box, Tab, Tabs, Typography } from "@mui/material";
import type { RefObject } from "react";
import { JSX, useEffect, useRef, useState } from "react";

type ProtocolLogsPanelProps = {
  sortedLogChannels: LogChannel[];
  activeLogChannelId: string;
  setActiveLogChannelId: (id: string) => void;
  activeLogText: string;
  logsError: string | null;
  logsContainerRef: RefObject<HTMLDivElement | null>;
  updateStickToBottom: () => void;
};

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

function parseAnsi(line: string): JSX.Element[] {
  const regex = /\x1b\[(\d+)m/g;
  const parts: JSX.Element[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let currentColor: string | null = null;
  let key = 0;

  while ((match = regex.exec(line)) !== null) {
    if (match.index > lastIndex) {
      parts.push(
        <span key={key++} style={{ color: currentColor ?? "inherit" }}>
          {line.slice(lastIndex, match.index)}
        </span>
      );
    }

    const code = Number.parseInt(match[1], 10);
    switch (code) {
      case 31:
        currentColor = "#f87171";
        break;
      case 32:
        currentColor = "#4ade80";
        break;
      case 33:
        currentColor = "#fbbf24";
        break;
      case 35:
        currentColor = "#e879f9";
        break;
      case 0:
        currentColor = null;
        break;
      default:
        currentColor = null;
        break;
    }

    lastIndex = regex.lastIndex;
  }

  if (lastIndex < line.length) {
    parts.push(
      <span key={key++} style={{ color: currentColor ?? "inherit" }}>
        {line.slice(lastIndex)}
      </span>
    );
  }

  return parts;
}

export default function ProtocolLogsPanel({
  sortedLogChannels,
  activeLogChannelId,
  setActiveLogChannelId,
  activeLogText,
  logsError,
  logsContainerRef,
  updateStickToBottom,
}: ProtocolLogsPanelProps) {
  const { rootRef, isDark } = useAncestorDarkMode<HTMLDivElement>();

  const panelBg = isDark ? "rgba(2, 6, 23, 0.72)" : "#f5f5f5";
  const panelText = isDark ? "#e5e7eb" : "#111827";
  const panelBorder = isDark ? "rgba(148, 163, 184, 0.26)" : "#e5e7eb";
  const panelShadow = isDark
    ? "inset 0 1px 0 rgba(255, 255, 255, 0.04), 0 12px 28px rgba(0, 0, 0, 0.18)"
    : "none";

  return (
    <Box
      ref={rootRef}
      sx={{
        flex: 1,
        minHeight: 0,
        minWidth: 0,
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
      }}
    >
      <Tabs
        value={activeLogChannelId}
        onChange={(_, val) => setActiveLogChannelId(String(val))}
        variant="scrollable"
        scrollButtons="auto"
        allowScrollButtonsMobile
        sx={{
          flex: "0 0 auto",
          mb: 0.5,
          "& .MuiTab-root": {
            textTransform: "none",
            fontSize: "0.8rem",
            fontWeight: 500,
          },
        }}
      >
        {sortedLogChannels.map((ch) => (
          <Tab key={ch.id} value={ch.id} label={ch.label} />
        ))}
      </Tabs>

      <Box
        sx={{
          flex: 1,
          minHeight: 0,
          minWidth: 0,
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          p: 1,
        }}
      >
        {logsError && (
          <Typography variant="body2" color="error" sx={{ mb: 1 }}>
            {logsError}
          </Typography>
        )}

        <Box
          ref={logsContainerRef}
          onScroll={updateStickToBottom}
          sx={{
            flex: 1,
            minHeight: 0,
            minWidth: 0,
            backgroundColor: panelBg,
            color: panelText,
            borderRadius: 2,
            border: "1px solid",
            borderColor: panelBorder,
            boxShadow: panelShadow,
            p: 1.5,
            fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
            fontSize: 12,
            lineHeight: 1.4,
            overflowY: "auto",
            overflowX: "auto",
            whiteSpace: "pre",
            scrollbarColor: isDark
              ? "rgba(148, 163, 184, 0.45) rgba(15, 23, 42, 0.55)"
              : undefined,
          }}
        >
          {activeLogText && activeLogText.length > 0 ? (
            activeLogText.split("\n").map((line, idx) => {
              const lineNoColor = activeLogChannelId === "stderr" ? "#f87171" : "#60a5fa";

              return (
                <div key={idx} style={{ display: "flex", minWidth: 0 }}>
                  <span
                    style={{
                      color: lineNoColor,
                      userSelect: "none",
                      marginRight: 8,
                      flex: "0 0 auto",
                    }}
                  >
                    {String(idx + 1).padStart(5, "0")}:
                  </span>
                  <span style={{ flex: "1 1 auto", minWidth: 0 }}>{parseAnsi(line)}</span>
                </div>
              );
            })
          ) : (
            <Typography variant="body2" sx={{ opacity: 0.7, color: isDark ? "#94a3b8" : "#6b7280" }}>
              No logs yet.
            </Typography>
          )}
        </Box>
      </Box>
    </Box>
  );
}
