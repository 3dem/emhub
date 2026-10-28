# SPDX-License-Identifier: GPL-3.0-or-later
"""Who may do what: access levels, the launch rate limit, locks and the audit log.

The configured access level (``EMHUB_TOMO_MCP_ACCESS``) decides which tools
exist at all. On each project the effective level is the lower of that and the
user's right on the project: owner -> admin, editor -> operate, viewer -> read;
an EMhub admin who is not the owner gets the configured level.
"""

from __future__ import annotations

import json
import logging
import os
import time
from collections import deque
from collections.abc import Callable
from datetime import datetime, timezone
from typing import Any, Literal

import anyio

from .config import AccessLevel, Settings
from .domain.models import ProjectRight
from .errors import denied

logger = logging.getLogger(__name__)

LEVELS: dict[str, int] = {"read": 0, "operate": 1, "admin": 2}
RIGHT_LEVEL: dict[ProjectRight, AccessLevel] = {
    "owner": "admin",
    "editor": "operate",
    "viewer": "read",
    "admin": "admin",
}
Level = Literal["read", "operate", "admin"]


def effective_level(configured: AccessLevel, right: ProjectRight) -> AccessLevel:
    granted = RIGHT_LEVEL[right]
    return granted if LEVELS[granted] < LEVELS[configured] else configured


def require_level(
    configured: AccessLevel, right: ProjectRight, needed: Level, project_id: int, action: str
) -> None:
    level = effective_level(configured, right)
    if LEVELS[level] < LEVELS[needed]:
        if LEVELS[configured] < LEVELS[needed]:
            hint = f"The server's access level is '{configured}' (EMHUB_TOMO_MCP_ACCESS)."
        else:
            hint = f"Your right on project {project_id} is '{right}'."
        raise denied(f"Not allowed to {action} in project {project_id}.", hint=hint)


class LaunchLimiter:
    """At most ``per_hour`` launches (run or schedule) in any hour."""

    def __init__(self, per_hour: int, clock: Callable[[], float] = time.monotonic) -> None:
        self._per_hour = per_hour
        self._clock = clock
        self._times: deque[float] = deque()

    def _prune(self) -> None:
        cutoff = self._clock() - 3600
        while self._times and self._times[0] < cutoff:
            self._times.popleft()

    def check(self, count: int = 1) -> None:
        self._prune()
        if len(self._times) + count > self._per_hour:
            wait_min = 0.0
            if self._times:
                wait_min = max(0.0, (self._times[0] + 3600 - self._clock()) / 60)
            raise denied(
                f"Launch limit reached: at most {self._per_hour} launches per hour "
                f"({len(self._times)} in the last hour).",
                hint=f"The next launch is possible in about {wait_min:.0f} min "
                "(EMHUB_TOMO_MCP_MAX_LAUNCHES_PER_HOUR).",
            )

    def record(self, count: int = 1) -> None:
        now = self._clock()
        self._times.extend([now] * count)


class ProjectLocks:
    """One lock per project, so that changes to a project do not interleave."""

    def __init__(self) -> None:
        self._locks: dict[int, anyio.Lock] = {}

    def __call__(self, project_id: int) -> anyio.Lock:
        if project_id not in self._locks:
            self._locks[project_id] = anyio.Lock()
        return self._locks[project_id]


class AuditLog:
    """Append-only JSON-lines record of every change attempted through the server."""

    def __init__(self, state_dir: str, user: Callable[[], str]) -> None:
        self.path = os.path.join(state_dir, "audit.jsonl")
        self._state_dir = state_dir
        self._user = user

    def write(self, **record: Any) -> None:
        entry = {
            "time": datetime.now(timezone.utc).isoformat(timespec="seconds"),
            "user": self._user(),
            **record,
        }
        try:
            os.makedirs(self._state_dir, mode=0o700, exist_ok=True)
            fd = os.open(self.path, os.O_WRONLY | os.O_CREAT | os.O_APPEND, 0o600)
            with os.fdopen(fd, "a", encoding="utf-8") as f:
                f.write(json.dumps(entry, default=str, ensure_ascii=False) + "\n")
        except OSError as exc:  # never fail a change because the audit log is unwritable
            logger.error("Cannot write the audit log %s: %s", self.path, exc)


def make_audit(settings: Settings) -> AuditLog:
    return AuditLog(settings.state_dir, lambda: settings.identity_username)
