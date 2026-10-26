import { JSX, useState } from "react";
import {
  Box,
  Typography,
  IconButton,
  Tooltip,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Link,
} from "@mui/material";
import { CloseIcon, FindIcon, HelpIcon, TrashBinIcon } from "../../icons";
import { FolderOpen as FolderIcon, Wand2 as WizardIcon } from "lucide-react";
import styles from "./paramrow.module.css";

type ParamRowLayoutVariant = "standard" | "inline" | "fullWidth";

type ParamRowProps = {
  label: string;
  control: JSX.Element;
  helpText?: string;
  isPointerParam?: boolean;
  onClear?: () => void;
  rowIndex?: number;

  // Wizard
  hasWizard?: boolean;
  onOpenWizard?: () => void;
  wizardTooltip?: string;

  // PointerParam
  onOpenFind?: () => void;

  // PathParam
  isPathParam?: boolean;
  onBrowsePath?: () => void;

  // Layout
  layoutVariant?: ParamRowLayoutVariant;
};

function normalizeHelpText(raw: string): string {
  // normalizeHelpText
  return String(raw ?? "").replace(/\\n/g, "\n");
}

function sanitizeHref(rawUrl: string): string {
  // sanitizeHref
  let hrefToken = String(rawUrl ?? "").trim();

  // Trim common trailing punctuation
  while (/[.,;:!?)]$/.test(hrefToken)) {
    hrefToken = hrefToken.slice(0, -1);
  }

  if (!hrefToken) return "";

  const href =
    hrefToken.startsWith("http://") || hrefToken.startsWith("https://")
      ? hrefToken
      : `https://${hrefToken}`;

  return href;
}

function sanitizeUrlToken(token: string): { display: string; href: string } {
  // sanitizeUrlToken
  const display = token;

  let hrefToken = token;
  while (/[.,;:!?)]$/.test(hrefToken)) {
    hrefToken = hrefToken.slice(0, -1);
  }

  const href = sanitizeHref(hrefToken);
  return { display, href };
}

function parseOrgLinkToken(token: string): { href: string; label: string } | null {
  // parseOrgLinkToken
  // Matches [[url][label]] or [[url]]
  const orgRegex = /^\[\[([^\]]+)\](?:\[([^\]]+)\])?\]$/;
  const match = orgRegex.exec(token);
  if (!match) return null;

  const rawUrl = match[1] ?? "";
  const rawLabel = match[2];

  const href = sanitizeHref(rawUrl);
  if (!href) return null;

  const label = String(rawLabel ?? rawUrl);
  return { href, label };
}

function renderBoldInline(text: string, keyPrefix: string): Array<JSX.Element | string> {
  // renderBoldInline
  const parts: Array<JSX.Element | string> = [];
  const boldRegex = /\*[^*]+\*/g;

  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let segIndex = 0;

  while ((match = boldRegex.exec(text)) !== null) {
    const token = match[0];
    const start = match.index;

    if (start > lastIndex) {
      parts.push(text.slice(lastIndex, start));
    }

    const boldText = token.slice(1, -1);
    parts.push(<strong key={`${keyPrefix}-b-${segIndex++}`}>{boldText}</strong>);

    lastIndex = boldRegex.lastIndex;
  }

  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex));
  }

  return parts;
}

function renderHelpText(helpText: string): JSX.Element {
  // renderHelpText
  const normalized = normalizeHelpText(helpText);
  const lines = normalized.split("\n");

  // Matches:
  // - [[url][label]] or [[url]] (Scipion/Org-mode style)
  // - *boldText*
  // - http(s)://...
  // - www....
  const tokenPattern =
    /(\[\[[^\]]+\](?:\[[^\]]+\])?\]|\*[^*]+\*|https?:\/\/[^\s<>()]+|www\.[^\s<>()]+)/g;

  const renderLine = (line: string, lineIndex: number) => {
    // renderLine
    const parts: JSX.Element[] = [];
    let lastIndex = 0;
    let match: RegExpExecArray | null;
    let keyIndex = 0;

    const tokenRegex = new RegExp(tokenPattern.source, "g");

    while ((match = tokenRegex.exec(line)) !== null) {
      const token = match[0];
      const start = match.index;

      if (start > lastIndex) {
        const text = line.slice(lastIndex, start);
        parts.push(<span key={`t-${lineIndex}-${keyIndex++}`}>{text}</span>);
      }

      // Org-style link: [[url][label]] or [[url]]
      if (token.startsWith("[[")) {
        const orgLink = parseOrgLinkToken(token);

        if (orgLink) {
          const linkKey = `ol-${lineIndex}-${keyIndex++}`;
          parts.push(
            <Link
              key={linkKey}
              href={orgLink.href}
              target="_blank"
              rel="noopener noreferrer"
              underline="hover"
              sx={{ wordBreak: "break-word", fontWeight: 600 }}
            >
              {renderBoldInline(orgLink.label, linkKey)}
            </Link>
          );
        } else {
          parts.push(<span key={`ot-${lineIndex}-${keyIndex++}`}>{token}</span>);
        }
      }
      // Bold: *text*
      else if (token.startsWith("*") && token.endsWith("*") && token.length >= 2) {
        const boldText = token.slice(1, -1);
        parts.push(<strong key={`b-${lineIndex}-${keyIndex++}`}>{boldText}</strong>);
      }
      // Plain URL
      else {
        const { display, href } = sanitizeUrlToken(token);

        if (!href) {
          parts.push(<span key={`u-${lineIndex}-${keyIndex++}`}>{display}</span>);
        } else {
          parts.push(
            <Link
              key={`l-${lineIndex}-${keyIndex++}`}
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              underline="hover"
              sx={{ wordBreak: "break-word" }}
            >
              {display}
            </Link>
          );
        }
      }

      lastIndex = tokenRegex.lastIndex;
    }

    if (lastIndex < line.length) {
      parts.push(<span key={`t-${lineIndex}-${keyIndex++}`}>{line.slice(lastIndex)}</span>);
    }

    return parts;
  };

  return (
    <Typography
      variant="body2"
      component="div"
      sx={{
        lineHeight: 1.6,
        mt: 2,
        whiteSpace: "normal",
        wordBreak: "break-word",
        color: "text.primary",
      }}
    >
      {lines.map((line, i) => (
        <span key={`hl-${i}`}>
          {renderLine(line, i)}
          {i < lines.length - 1 ? <br /> : null}
        </span>
      ))}
    </Typography>
  );
}

const ParamRow = ({
  label,
  control,
  helpText,
  isPointerParam,
  onClear,
  rowIndex = 0,
  hasWizard = false,
  onOpenWizard,
  wizardTooltip,
  onOpenFind,
  isPathParam,
  onBrowsePath,
  layoutVariant = "standard",
}: ParamRowProps) => {
  const [openHelp, setOpenHelp] = useState(false);
  const [openSelector, setOpenSelector] = useState(false); // fallback

  const isInline = layoutVariant === "inline";
  const isFullWidth = layoutVariant === "fullWidth";
  const hasWizardAction = typeof onOpenWizard === "function";

  const actionIconButtonSx = {
    // actionIconButtonSx
    p: 0.5,
    width: 32,
    height: 32,
    color: "text.secondary",
    "&:hover": {
      color: "text.primary",
      backgroundColor: "action.hover",
    },
  };

  const actionsSlotSx = {
    // actionsSlotSx
    display: "inline-flex",
    alignItems: "center",
    gap: 0,
    flex: "0 0 auto",
    whiteSpace: "nowrap",
    ml: isInline ? 0.25 : 0.0,
  } as const;

  return (
    <>
      <Box
        sx={{
          ...(isInline
            ? {
                display: "inline-flex",
                alignItems: "center",
                gap: 0.75,
                px: 1,
                py: 0.5,
                borderRadius: 1,
                minHeight: 42,
              }
            : isFullWidth
              ? {
                  // fullWidthLayout
                  display: "grid",
                  gridTemplateColumns: "1fr auto",
                  columnGap: 1,
                  alignItems: "center",
                  mb: 1,
                  mt: rowIndex === 0 ? 1.5 : 0, // firstRowTopMargin
                  position: "relative",
                }
              : {
                  // standardLayout
                  display: "grid",
                  gridTemplateColumns: "210px minmax(0, 1fr) auto",
                  columnGap: 1,
                  alignItems: "center",
                  mb: 1,
                  mt: rowIndex === 0 ? 1.5 : 0, // firstRowTopMargin
                  position: "relative",
                }),
        }}
      >
        <Typography
          variant="body2"
          className={styles.paramRowLabel}
          sx={{
            p: isInline ? 0 : 0.5,
            pr: isInline ? 0.75 : 2,
            fontSize: "0.75rem",
            fontWeight: 400,
            color: "text.primary",
            whiteSpace: isFullWidth ? "normal" : "nowrap",
            overflow: isFullWidth ? "visible" : "hidden",
            textOverflow: isFullWidth ? "clip" : "ellipsis",
            ...(isInline ? { maxWidth: 180 } : null),
          }}
          title={label}
        >
          {label}
        </Typography>

        {!isFullWidth && (
          <Box
            sx={{
              minWidth: 0,
              width: "100%", // allowControlToStretch
              ...(isInline
                ? {
                    display: "flex",
                    alignItems: "center",
                    gap: 0.75,
                    width: "auto",
                  }
                : null),
            }}
          >
            {control}
          </Box>
        )}

        <Box sx={actionsSlotSx}>
          {isPointerParam && (
            <Tooltip title="Find">
              <IconButton
                size="small"
                sx={actionIconButtonSx}
                onClick={onOpenFind ? onOpenFind : () => setOpenSelector(true)}
              >
                <FindIcon className="ml-0" fontSize="1.2rem" />
              </IconButton>
            </Tooltip>
          )}

          {isPathParam && (
            <Tooltip title="Browse files">
              <IconButton size="small" sx={actionIconButtonSx} onClick={onBrowsePath}>
                <FolderIcon className="ml-0" size={18} />
              </IconButton>
            </Tooltip>
          )}

          {onClear && (
            <Tooltip title="Clear">
              <IconButton size="small" sx={actionIconButtonSx} onClick={onClear}>
                <TrashBinIcon className="ml-0" fontSize="1.2rem" />
              </IconButton>
            </Tooltip>
          )}

          {hasWizard && (
            <Tooltip
              title={wizardTooltip || (hasWizardAction ? "Open wizard" : "Wizard available")}
            >
              <span>
                <IconButton
                  size="small"
                  sx={{
                    ...actionIconButtonSx,
                    color: hasWizardAction ? "text.secondary" : "text.disabled",
                    opacity: hasWizardAction ? 1 : 0.78,
                    cursor: hasWizardAction ? "pointer" : "default",
                  }}
                  onClick={hasWizardAction ? onOpenWizard : undefined}
                  disableRipple={!hasWizardAction}
                >
                  <WizardIcon className="ml-0" size={18} />
                </IconButton>
              </span>
            </Tooltip>
          )}

          {helpText && (
            <Tooltip title="Help">
              <IconButton size="small" sx={actionIconButtonSx} onClick={() => setOpenHelp(true)}>
                <HelpIcon className="ml-0" fontSize="1.2rem" />
              </IconButton>
            </Tooltip>
          )}
        </Box>
      </Box>

      {helpText && (
        <Dialog
          open={openHelp}
          onClose={() => setOpenHelp(false)}
          maxWidth="sm"
          fullWidth
          slotProps={{
            backdrop: {
              sx: { backgroundColor: "transparent" },
            },
          }}
          PaperProps={{
            sx: {
              borderRadius: 4, // moreRounded
              overflow: "hidden",
              border: "1px solid",
              borderColor: "divider",
              boxShadow: "0 18px 50px rgba(0,0,0,0.35)",
              backgroundColor: "background.paper",
              color: "text.primary",
            },
          }}
        >
          {/* headerBar */}
          <DialogTitle
            sx={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              backgroundColor: "#333d49",
              color: "white",
              px: 2,
              py: 1.5,
              boxSizing: "border-box",
              m: 0,
            }}
          >
            <Box sx={{ minWidth: 0, pr: 1 }}>
              <Box
                component="div"
                sx={{
                  fontWeight: 600,
                  fontSize: 16,
                  lineHeight: 1.2,
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
              >
                Help
              </Box>
            </Box>

            <IconButton
              onClick={() => setOpenHelp(false)}
              aria-label="Close"
              size="small"
              sx={{
                color: "white",
                borderRadius: 2,
                "&:hover": { backgroundColor: "rgba(255,255,255,0.10)" },
                "&:focus-visible": {
                  outline: "2px solid rgba(255,255,255,0.55)",
                  outlineOffset: 2,
                },
              }}
            >
              <CloseIcon fontSize="small" />
            </IconButton>
          </DialogTitle>

          {/* body */}
          <DialogContent sx={{ px: 2, py: 1.5, backgroundColor: "background.paper" }}>
            <Box sx={{ maxHeight: "60vh", overflow: "auto", pr: 0.5 }}>
              {renderHelpText(helpText)}
            </Box>
          </DialogContent>

          {/* footer */}
          <DialogActions
            sx={{
              justifyContent: "center",
              px: 2,
              py: 1.5,
              borderTop: "1px solid",
              borderColor: "divider",
              backgroundColor: "background.paper",
            }}
          >
            <Button
              variant="outlined"
              onClick={() => setOpenHelp(false)}
              sx={{ textTransform: "none", minWidth: 112 }}
            >
              Close
            </Button>
          </DialogActions>
        </Dialog>
      )}

      <Dialog open={openSelector} onClose={() => setOpenSelector(false)} maxWidth="sm" fullWidth>
        <DialogTitle className={styles.formHeader}>Select output</DialogTitle>
        <DialogContent sx={{ p: 2, backgroundColor: "background.paper", color: "text.primary" }}>
          <Typography variant="body2" sx={{ lineHeight: 1.6 }}>
            No selector implemented here. Use onOpenFind/onBrowsePath from the parent.
          </Typography>
        </DialogContent>
        <DialogActions sx={{ justifyContent: "center", backgroundColor: "background.paper" }}>
          <Button variant="outlined" onClick={() => setOpenSelector(false)} startIcon={<CloseIcon />}>
            Close
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
};

export default ParamRow;
