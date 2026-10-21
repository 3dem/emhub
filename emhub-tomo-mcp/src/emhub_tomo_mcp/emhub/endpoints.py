# SPDX-License-Identifier: GPL-3.0-or-later
"""One typed coroutine per EMhub REST endpoint used by the server.

Processing endpoints always address a project by ``entry_id``. File endpoints
take the project folder from the project's entry (resolved by the domain
layer), never from the caller.
"""

from __future__ import annotations

from collections.abc import Sequence
from typing import Any, TypeVar

from pydantic import TypeAdapter, ValidationError

from ..errors import EmhubMcpError, ErrorKind
from .client import EmhubClient
from .models import (
    DirItem,
    EmhubEntry,
    EmhubProject,
    EmhubUser,
    FilePreview,
    FlatJob,
    JobTypeInfo,
    LabelsPayload,
    RunPayload,
    WorkflowNode,
    WorkflowTemplateInfo,
)

T = TypeVar("T")

USER_ATTRS = ["id", "username", "email", "name", "roles"]


def _parse(adapter: TypeAdapter[T], data: Any, method: str) -> T:
    try:
        return adapter.validate_python(data)
    except ValidationError as exc:
        raise EmhubMcpError(
            ErrorKind.UPSTREAM_ERROR,
            f"EMhub returned an unexpected payload for '{method}'.",
            hint="The EMhub version may not be supported by this server.",
            log_detail=str(exc)[:3000],
        ) from None


def _field(data: Any, key: str, method: str) -> Any:
    if not isinstance(data, dict) or key not in data:
        raise EmhubMcpError(
            ErrorKind.UPSTREAM_ERROR,
            f"EMhub returned an unexpected payload for '{method}' (no '{key}').",
            log_detail=repr(data)[:3000],
        )
    return data[key]


_USERS = TypeAdapter(list[EmhubUser])
_ENTRIES = TypeAdapter(list[EmhubEntry])
_PROJECTS = TypeAdapter(list[EmhubProject])
_WIDGET = TypeAdapter(dict[str, WorkflowNode])
_FLAT = TypeAdapter(list[FlatJob])
_RUN = TypeAdapter(RunPayload)
_LABELS = TypeAdapter(LabelsPayload)
_TEMPLATES = TypeAdapter(list[WorkflowTemplateInfo])
_JOB_TYPES = TypeAdapter(list[JobTypeInfo])
_DIR = TypeAdapter(list[DirItem])
_PREVIEW = TypeAdapter(FilePreview)


class EmhubApi:
    def __init__(self, client: EmhubClient) -> None:
        self.client = client

    async def get_users(self) -> list[EmhubUser]:
        data = await self.client.call("get_users", body={"attrs": USER_ATTRS})
        return _parse(_USERS, data, "get_users")

    async def get_entries(self) -> list[EmhubEntry]:
        data = await self.client.call("get_entries", {})
        return _parse(_ENTRIES, data, "get_entries")

    async def get_projects(self) -> list[EmhubProject]:
        data = await self.client.call("get_projects", {})
        return _parse(_PROJECTS, data, "get_projects")

    async def get_workflow_graph(self, entry_id: int) -> dict[str, WorkflowNode]:
        """Job graph keyed by job id, without EMhub's synthetic ``PROJECT`` node."""
        data = await self.client.call(
            "get_session_workflow", {"entry_id": entry_id, "widget": True}
        )
        nodes = _parse(
            _WIDGET, _field(data, "workflow", "get_session_workflow"), "get_session_workflow"
        )
        nodes.pop("PROJECT", None)
        return nodes

    async def get_job_statuses(self, entry_id: int) -> list[FlatJob]:
        data = await self.client.call(
            "get_session_workflow", {"entry_id": entry_id, "widget": False}
        )
        return _parse(
            _FLAT,
            _field(data, "workflow", "get_session_workflow"),
            "get_session_workflow",
        )

    async def get_run(self, entry_id: int, job_id: str, outputs: Sequence[str]) -> RunPayload:
        data = await self.client.call(
            "get_session_run", {"entry_id": entry_id, "run_id": job_id, "output": list(outputs)}
        )
        return _parse(_RUN, _field(data, "run", "get_session_run"), "get_session_run")

    async def get_job_form(self, entry_id: int, job_type: str) -> dict[str, Any]:
        """Form of a job type, including the server's queue parameters.

        ``run_id`` must be sent as null for a job type without a job.
        """
        data = await self.client.call(
            "get_session_run",
            {"entry_id": entry_id, "run_id": None, "job_type": job_type, "output": ["form"]},
        )
        run = _parse(_RUN, _field(data, "run", "get_session_run"), "get_session_run")
        if not run.form:
            raise EmhubMcpError(
                ErrorKind.NOT_FOUND, f"EMhub has no form for job type '{job_type}'."
            )
        return run.form

    async def get_project_labels(self, entry_id: int) -> LabelsPayload:
        data = await self.client.call("get_project_labels", {"entry_id": entry_id})
        return _parse(
            _LABELS,
            _field(data, "labels", "get_project_labels"),
            "get_project_labels",
        )

    async def get_workflow_templates(self) -> list[WorkflowTemplateInfo]:
        data = await self.client.call("get_workflows", {})
        return _parse(_TEMPLATES, data, "get_workflows")

    async def get_job_types(self) -> list[JobTypeInfo]:
        data = await self.client.call("get_job_types", {})
        return _parse(_JOB_TYPES, data, "get_job_types")

    async def get_config(self, name: str) -> dict[str, Any]:
        data = await self.client.call("get_config", {"config": name})
        config = _field(data, "config", "get_config")
        return config if isinstance(config, dict) else {}

    async def list_dir(self, root: str, path: str) -> list[DirItem]:
        data = await self.client.call("list_project_dir", {"root": root, "path": path})
        return _parse(
            _DIR,
            _field(data, "items", "list_project_dir"),
            "list_project_dir",
        )

    async def get_file_preview(self, root: str, path: str) -> FilePreview:
        data = await self.client.call(
            "get_file_preview", {"root": root, "path": path}, http_timeout=120
        )
        return _parse(
            _PREVIEW,
            _field(data, "preview", "get_file_preview"),
            "get_file_preview",
        )
