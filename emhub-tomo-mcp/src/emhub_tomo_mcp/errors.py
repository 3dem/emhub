# SPDX-License-Identifier: GPL-3.0-or-later
"""Error taxonomy.

Every failure the server anticipates is raised as an :class:`EmhubMcpError`
with a :class:`ErrorKind`. The MCP layer turns it into a short tool error that
names the kind, the message, an optional hint and a correlation id; the full
detail (for example an EMhub traceback) only goes to the server log.
"""

from __future__ import annotations

import enum
import uuid
from collections.abc import Sequence


class ErrorKind(str, enum.Enum):
    UNREACHABLE = "unreachable"
    AUTH = "auth"
    NOT_FOUND = "not_found"
    VALIDATION = "validation"
    CONFLICT = "conflict"
    POLICY_DENIED = "policy_denied"
    UNSUPPORTED = "unsupported"
    UPSTREAM_ERROR = "upstream_error"
    INTERNAL = "internal_error"


def new_correlation_id() -> str:
    return uuid.uuid4().hex[:10]


class EmhubMcpError(Exception):
    """An anticipated failure, safe to show to the model."""

    def __init__(
        self,
        kind: ErrorKind,
        message: str,
        *,
        hint: str | None = None,
        details: Sequence[str] = (),
        log_detail: str | None = None,
    ) -> None:
        super().__init__(message)
        self.kind = kind
        self.message = message
        self.hint = hint
        self.details = list(details)
        # Extra context for the server log only (never shown to the model).
        self.log_detail = log_detail

    def to_tool_message(self, correlation_id: str) -> str:
        parts = [f"[{self.kind.value}] {self.message}"]
        parts.extend(f"- {d}" for d in self.details)
        if self.hint:
            parts.append(f"Hint: {self.hint}")
        parts.append(f"(ref {correlation_id})")
        return "\n".join(parts)


def not_found(
    what: str, *, candidates: Sequence[str] = (), hint: str | None = None
) -> EmhubMcpError:
    message = f"{what} not found."
    if candidates:
        message += " Closest matches: " + ", ".join(candidates) + "."
    return EmhubMcpError(ErrorKind.NOT_FOUND, message, hint=hint)


def invalid(message: str, *, details: Sequence[str] = (), hint: str | None = None) -> EmhubMcpError:
    return EmhubMcpError(ErrorKind.VALIDATION, message, details=details, hint=hint)


def denied(message: str, *, hint: str | None = None) -> EmhubMcpError:
    return EmhubMcpError(ErrorKind.POLICY_DENIED, message, hint=hint)
