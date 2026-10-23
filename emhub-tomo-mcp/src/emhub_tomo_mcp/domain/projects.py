# SPDX-License-Identifier: GPL-3.0-or-later
"""Projects: identity, visibility and access rights, listing and lookup.

A tomo processing project is an EMhub *entry* of type ``tomo_processing``,
grouped under a per-user container project. The configured user sees the
projects EMhub's processing page would show them: projects in their containers
(owner) and projects shared with their e-mail (editor or viewer); EMhub admins
can also see every other project. An optional allowlist
(``EMHUB_TOMO_MCP_PROJECTS``) narrows this further.

User, project and entry lists are cached for ``EMHUB_TOMO_MCP_CACHE_TTL``
seconds to avoid fetching them on every tool call.
"""

from __future__ import annotations

import contextlib
import difflib
import time
from collections.abc import Callable, Iterator
from dataclasses import dataclass
from typing import Literal

import anyio

from ..config import Settings
from ..emhub.endpoints import EmhubApi
from ..emhub.models import EmhubEntry, EmhubProject, EmhubUser
from ..errors import EmhubMcpError, ErrorKind, denied, not_found
from .models import Identity, ProjectList, ProjectRight, ProjectSummary
from .shaping import decode_cursor, paginate

ENTRY_TYPE = "tomo_processing"
Scope = Literal["mine", "all"]


@dataclass(frozen=True)
class UserIdentity:
    user: EmhubUser

    @property
    def public(self) -> Identity:
        return Identity(
            username=self.user.username,
            email=self.user.email,
            roles=list(self.user.roles),
            is_admin=self.user.is_admin,
        )


@dataclass(frozen=True)
class ProjectRef:
    """A project the current user may read."""

    entry: EmhubEntry
    summary: ProjectSummary

    @property
    def id(self) -> int:
        return self.entry.id

    @property
    def root(self) -> str:
        return self.summary.processing_path


@dataclass(frozen=True)
class _Snapshot:
    entries: list[EmhubEntry]
    projects: dict[int, EmhubProject]
    users: dict[int, EmhubUser]


class ProjectFolderMissing(EmhubMcpError):
    """The project's EMhub entry points at a folder that no longer exists."""


@contextlib.contextmanager
def folder_must_exist(ref: ProjectRef) -> Iterator[None]:
    """Turn EMhub's error for a missing project folder into a clear not_found."""
    try:
        yield
    except EmhubMcpError as exc:
        if exc.kind is ErrorKind.UPSTREAM_ERROR and "can't load processing path" in exc.message:
            raise ProjectFolderMissing(
                ErrorKind.NOT_FOUND,
                f"The folder of project {ref.id} ({ref.root}) does not exist.",
                hint="It may have been moved or deleted; its EMhub entry still points there.",
            ) from None
        raise


def project_right(
    user: EmhubUser, entry: EmhubEntry, container: EmhubProject | None
) -> ProjectRight | None:
    if container is not None and container.user_id == user.id:
        return "owner"
    email = (user.email or "").strip().lower()
    if email:
        for row in entry.data.share_table:
            if row.user_email.strip().lower() == email:
                return "editor" if row.user_perms.strip().lower() == "editor" else "viewer"
    if user.is_admin:
        return "admin"
    return None


class ProjectCatalog:
    def __init__(
        self, api: EmhubApi, settings: Settings, *, clock: Callable[[], float] = time.monotonic
    ) -> None:
        self._api = api
        self._settings = settings
        self._clock = clock
        self._lock = anyio.Lock()
        self._snapshot: _Snapshot | None = None
        self._snapshot_time = 0.0

    def invalidate(self) -> None:
        self._snapshot = None

    async def _get_snapshot(self) -> _Snapshot:
        async with self._lock:
            now = self._clock()
            if self._snapshot is None or now - self._snapshot_time > self._settings.cache_ttl:
                users = await self._api.get_users()
                projects = await self._api.get_projects()
                entries = await self._api.get_entries()
                self._snapshot = _Snapshot(
                    entries=[e for e in entries if e.type == ENTRY_TYPE],
                    projects={p.id: p for p in projects},
                    users={u.id: u for u in users},
                )
                self._snapshot_time = now
            return self._snapshot

    async def identity(self) -> UserIdentity:
        snapshot = await self._get_snapshot()
        username = self._settings.identity_username
        for user in snapshot.users.values():
            if user.username == username:
                return UserIdentity(user)
        raise EmhubMcpError(
            ErrorKind.AUTH,
            f"EMhub has no user '{username}'.",
            hint="Set EMHUB_USER to the EMhub account this server acts as.",
        )

    async def _visible(self) -> list[tuple[EmhubEntry, ProjectSummary]]:
        snapshot = await self._get_snapshot()
        user = (await self.identity()).user
        allow = self._settings.project_allowlist
        visible = []
        for entry in snapshot.entries:
            if allow is not None and entry.id not in allow:
                continue
            container = snapshot.projects.get(entry.project_id) if entry.project_id else None
            right = project_right(user, entry, container)
            if right is None:
                continue
            visible.append((entry, self._summary(entry, container, right, snapshot)))
        visible.sort(key=lambda pair: pair[1].last_update or pair[1].created or "", reverse=True)
        return visible

    @staticmethod
    def _summary(
        entry: EmhubEntry, container: EmhubProject | None, right: ProjectRight, snapshot: _Snapshot
    ) -> ProjectSummary:
        data = entry.data
        owner = snapshot.users.get(container.user_id) if container and container.user_id else None
        path = data.processing_path.rstrip("/")
        title = (entry.title or "").strip() or path.rsplit("/", 1)[-1] or f"Project {entry.id}"
        return ProjectSummary(
            id=entry.id,
            title=title,
            processing_path=data.processing_path,
            data_path=data.data_path,
            owner=owner.username if owner else None,
            access=right,
            created=entry.creation_date or entry.date,
            last_update=entry.last_update_date,
        )

    async def list(
        self,
        *,
        scope: Scope = "mine",
        search: str | None = None,
        limit: int = 50,
        cursor: str | None = None,
    ) -> ProjectList:
        query = {"scope": scope, "search": search, "limit": limit}
        offset = decode_cursor(cursor, query)
        summaries = [s for _, s in await self._visible()]
        if scope == "mine":
            summaries = [s for s in summaries if s.access != "admin"]
        if search:
            needle = search.strip().lower()
            summaries = [
                s
                for s in summaries
                if needle in s.title.lower()
                or needle in s.processing_path.lower()
                or needle == str(s.id)
            ]
        page, next_cursor = paginate(summaries, offset, limit, query)
        return ProjectList(projects=page, total=len(summaries), next_cursor=next_cursor)

    async def get(self, project_id: int) -> ProjectRef:
        """The project, if the current user may read it."""
        allow = self._settings.project_allowlist
        if allow is not None and project_id not in allow:
            raise denied(
                f"Project {project_id} is not in this server's project allowlist.",
                hint="The allowlist is set with EMHUB_TOMO_MCP_PROJECTS.",
            )
        visible = await self._visible()
        for entry, summary in visible:
            if entry.id == project_id:
                return ProjectRef(entry=entry, summary=summary)
        candidates = [f"{s.id} ({s.title})" for _, s in visible]
        close = difflib.get_close_matches(str(project_id), [str(s.id) for _, s in visible], n=3)
        suggestions = [c for c in candidates if c.split(" ", 1)[0] in close] or candidates[:3]
        raise not_found(
            f"Project {project_id}",
            candidates=suggestions,
            hint="Projects you cannot access are not shown; use list_projects.",
        )

    async def count(self) -> int:
        return len(await self._visible())
