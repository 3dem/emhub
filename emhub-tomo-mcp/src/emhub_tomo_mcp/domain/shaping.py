# SPDX-License-Identifier: GPL-3.0-or-later
"""Output shaping: pagination cursors, log cleaning and text windows."""

from __future__ import annotations

import base64
import binascii
import hashlib
import json
import re
from collections.abc import Sequence
from dataclasses import dataclass
from typing import TypeVar

from ..errors import invalid

T = TypeVar("T")

# CSI and OSC escape sequences (emtools colours its log output).
_ANSI = re.compile(r"\x1b\[[0-?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[@-Z\\-_]")
_CONTROL = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]")

# Lines worth showing when diagnosing a failed job.
_ERROR_LINE = re.compile(
    r"traceback \(most recent call last\)|\b\w*(error|exception)\b|(?<!\b0 )\bfailed\b"
    r"|\bfatal\b|killed|out of memory|\boom\b|segmentation fault|core dumped|no such file"
    r"|permission denied|cuda error|exit code:? *[1-9]|cancelled|time limit|does not exist",
    re.IGNORECASE,
)
# Cursors are URL-safe base64 without padding.
_CURSOR_CHARS = re.compile(r"[A-Za-z0-9_-]{1,400}")
# Marker EMhub inserts when it shortens a long log.
_OMITTED = re.compile(r"=+ OMITTED (\d+) LINES =+")


def clean_log(text: str) -> list[str]:
    """Split a log into lines without colour codes, control characters or
    carriage-return progress bars (only the last state of such a line is kept)."""
    lines = []
    # Split on newlines only: a bare carriage return redraws the same line.
    for raw in text.replace("\r\n", "\n").split("\n"):
        line = _ANSI.sub("", raw)
        if "\r" in line:
            parts = [p for p in line.split("\r") if p.strip()]
            line = parts[-1] if parts else ""
        lines.append(_CONTROL.sub("", line).rstrip())
    while lines and not lines[-1]:
        lines.pop()
    return lines


def omitted_lines(lines: Sequence[str]) -> int:
    """Lines EMhub left out of a long log (it keeps the first and last 1000)."""
    for line in lines:
        if match := _OMITTED.search(line):
            return int(match.group(1))
    return 0


def is_error_line(line: str) -> bool:
    return bool(_ERROR_LINE.search(line))


@dataclass(frozen=True)
class Window:
    text: str
    first_line: int
    total_lines: int
    truncated: bool


def take_window(
    lines: Sequence[str],
    *,
    tail: int | None = None,
    head: int | None = None,
    start_line: int | None = None,
    max_bytes: int,
    max_line_chars: int = 2000,
) -> Window:
    """Select ``tail`` last lines, ``head`` first lines, or ``head`` lines from
    ``start_line`` (1-based), within ``max_bytes`` of UTF-8 text."""
    total = len(lines)
    if start_line is not None:
        begin = max(start_line - 1, 0)
        end = min(begin + (head or total), total)
    elif tail is not None:
        begin, end = max(total - tail, 0), total
    else:
        begin, end = 0, min(head if head is not None else total, total)

    selected = [_clip(line, max_line_chars) for line in lines[begin:end]]
    budget = max_bytes
    kept: list[str] = []
    from_end = tail is not None and start_line is None
    for line in reversed(selected) if from_end else selected:
        cost = len(line.encode("utf-8")) + 1
        if cost > budget:
            break
        kept.append(line)
        budget -= cost
    if from_end:
        kept.reverse()
        begin = end - len(kept)
    truncated = begin > 0 or begin + len(kept) < total
    first = begin + 1 if kept else 0
    return Window(text="\n".join(kept), first_line=first, total_lines=total, truncated=truncated)


CLIP_MARK = " …[line truncated]"


def _clip(line: str, limit: int) -> str:
    return line if len(line) <= limit else line[: limit - len(CLIP_MARK)] + CLIP_MARK


def truncate(text: str | None, limit: int) -> str | None:
    if text is None:
        return None
    text = text.strip()
    return text if len(text) <= limit else text[: limit - 1].rstrip() + "…"


# ------------------------------------------------------------------ cursors


def _fingerprint(query: object) -> str:
    raw = json.dumps(query, sort_keys=True, default=str).encode()
    return hashlib.sha256(raw).hexdigest()[:12]


def encode_cursor(offset: int, query: object) -> str:
    raw = json.dumps({"o": offset, "q": _fingerprint(query)}).encode()
    return base64.urlsafe_b64encode(raw).decode().rstrip("=")


def decode_cursor(cursor: str | None, query: object) -> int:
    """Offset stored in ``cursor``; it must come from the same listing."""
    if not cursor:
        return 0
    if not _CURSOR_CHARS.fullmatch(cursor):
        raise invalid("Invalid cursor.", hint="Pass back 'next_cursor' unchanged.")
    try:
        padded = cursor + "=" * (-len(cursor) % 4)
        data = json.loads(base64.urlsafe_b64decode(padded.encode()))
        offset = int(data["o"])
        fingerprint = str(data["q"])
    except (ValueError, KeyError, TypeError, binascii.Error):
        raise invalid("Invalid cursor.", hint="Pass back 'next_cursor' unchanged.") from None
    if fingerprint != _fingerprint(query) or offset < 0:
        raise invalid(
            "This cursor belongs to a different listing.",
            hint="Repeat the call with the same arguments as the call that returned it.",
        )
    return offset


def paginate(
    items: Sequence[T], offset: int, limit: int, query: object
) -> tuple[list[T], str | None]:
    page = list(items[offset : offset + limit])
    following = offset + limit
    return page, (encode_cursor(following, query) if following < len(items) else None)
