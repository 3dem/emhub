import { JSX } from "react";
import {
  Typography,
  Link,
} from "@mui/material";


function renderBoldLabel(label: string, keyPrefix: string): Array<JSX.Element | string> {
  // renderBoldLabel
  const parts: Array<JSX.Element | string> = [];
  const boldRegex = /\*[^*]+\*/g;

  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let segIndex = 0;

  while ((match = boldRegex.exec(label)) !== null) {
    const token = match[0];
    const start = match.index;

    if (start > lastIndex) {
      parts.push(label.slice(lastIndex, start));
    }

    const boldText = token.slice(1, -1);
    parts.push(<strong key={`${keyPrefix}-b-${segIndex++}`}>{boldText}</strong>);

    lastIndex = boldRegex.lastIndex;
  }

  if (lastIndex < label.length) {
    parts.push(label.slice(lastIndex));
  }

  return parts;
}


// richHelpTextRenderer
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

  const href = hrefToken.startsWith("http://") || hrefToken.startsWith("https://")
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
  const label = String(rawLabel ?? rawUrl);

  if (!href) return null;
  return { href, label };
}

function renderRichHelpText(helpText: string): JSX.Element {
  // renderRichHelpText
  const normalized = normalizeHelpText(helpText);
  const lines = normalized.split("\n");

  // Matches:
  // - [[url][label]] (Scipion/Org-mode style)
  // - *boldText*
  // - http(s)://...
  // - www....
  const tokenPattern =
    /(\[\[[^\]]+\](?:\[[^\]]+\])?\]|\*[^*]+\*|https?:\/\/[^\s<>()]+|www\.[^\s<>()]+)/g;

  const renderLineTokens = (line: string, lineIndex: number) => {
    // renderLineTokens
    const parts: JSX.Element[] = [];
    let lastIndex = 0;
    let match: RegExpExecArray | null;
    let keyIndex = 0;

    const tokenRegex = new RegExp(tokenPattern.source, "g");

    while ((match = tokenRegex.exec(line)) !== null) {
      const token = match[0];
      const start = match.index;

      if (start > lastIndex) {
        parts.push(
          <span key={`t-${lineIndex}-${keyIndex++}`}>{line.slice(lastIndex, start)}</span>
        );
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
              {renderBoldLabel(orgLink.label, linkKey)}
            </Link>
          );

        } else {
          // Fallback: render as text if parsing failed
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
        mt: 1,
        whiteSpace: "normal",
        wordBreak: "break-word",
      }}
    >
      {lines.map((line, i) => (
        <span key={`hl-${i}`}>
          {renderLineTokens(line, i)}
          {i < lines.length - 1 ? <br /> : null}
        </span>
      ))}
    </Typography>
  );
}

export default renderRichHelpText