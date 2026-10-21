# SPDX-License-Identifier: GPL-3.0-or-later
"""One typed coroutine per EMhub REST endpoint used by the server.

Processing endpoints always address a project by ``entry_id``. File endpoints
take the project folder from the project's entry (resolved by the domain
layer), never from the caller.
"""

from __future__ import annotations

import logging
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
    ProjectLabel,
    RunPayload,
    WorkflowNode,
    WorkflowTemplateInfo,
)

T = TypeVar("T")
logger = logging.getLogger(__name__)

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


def _parse_items(adapter: TypeAdapter[T], data: Any, method: str) -> list[T]:
    """Parse a list item by item: one malformed record is skipped (and logged)
    instead of making the whole answer unusable."""
    if not isinstance(data, list):
        raise EmhubMcpError(
            ErrorKind.UPSTREAM_ERROR,
            f"EMhub returned an unexpected payload for '{method}' (not a list).",
            hint="The EMhub version may not be supported by this server.",
            log_detail=repr(data)[:3000],
        )
    items = []
    for raw in data:
        try:
            items.append(adapter.validate_python(raw))
        except ValidationError as exc:
            logger.warning("Skipping a malformed item from '%s': %s", method, str(exc)[:500])
    return items


def _field(data: Any, key: str, method: str) -> Any:
    if not isinstance(data, dict) or key not in data:
        raise EmhubMcpError(
            ErrorKind.UPSTREAM_ERROR,
            f"EMhub returned an unexpected payload for '{method}' (no '{key}').",
            log_detail=repr(data)[:3000],
        )
    return data[key]


_USERS = TypeAdapter(EmhubUser)
_ENTRIES = TypeAdapter(EmhubEntry)
_PROJECTS = TypeAdapter(EmhubProject)
_NODE = TypeAdapter(WorkflowNode)
_FLAT = TypeAdapter(FlatJob)
_RUN = TypeAdapter(RunPayload)
_LABELS = TypeAdapter(LabelsPayload)
_TEMPLATES = TypeAdapter(WorkflowTemplateInfo)
_JOB_TYPES = TypeAdapter(JobTypeInfo)
_DIR = TypeAdapter(DirItem)
_PREVIEW = TypeAdapter(FilePreview)
_ENTRY = TypeAdapter(EmhubEntry)
_LABEL = TypeAdapter(ProjectLabel)


class EmhubApi:
    def __init__(self, client: EmhubClient) -> None:
        self.client = client

    async def get_users(self) -> list[EmhubUser]:
        data = await self.client.call("get_users", body={"attrs": USER_ATTRS})
        return _parse_items(_USERS, data, "get_users")

    async def get_entries(self) -> list[EmhubEntry]:
        data = await self.client.call("get_entries", {})
        return _parse_items(_ENTRIES, data, "get_entries")

    async def get_projects(self) -> list[EmhubProject]:
        data = await self.client.call("get_projects", {})
        return _parse_items(_PROJECTS, data, "get_projects")

    async def get_workflow_graph(self, entry_id: int) -> dict[str, WorkflowNode]:
        """Job graph keyed by job id, without EMhub's synthetic ``PROJECT`` node."""
        data = await self.client.call(
            "get_session_workflow", {"entry_id": entry_id, "widget": True}
        )
        graph = _field(data, "workflow", "get_session_workflow")
        if not isinstance(graph, dict):
            raise EmhubMcpError(
                ErrorKind.UPSTREAM_ERROR,
                "EMhub returned an unexpected job graph (not a mapping).",
                log_detail=repr(graph)[:3000],
            )
        graph.pop("PROJECT", None)
        nodes = _parse_items(_NODE, list(graph.values()), "get_session_workflow")
        return {node.id: node for node in nodes}

    async def get_job_statuses(self, entry_id: int) -> list[FlatJob]:
        data = await self.client.call(
            "get_session_workflow", {"entry_id": entry_id, "widget": False}
        )
        return _parse_items(
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
        return _parse_items(_TEMPLATES, data, "get_workflows")

    async def get_job_types(self) -> list[JobTypeInfo]:
        data = await self.client.call("get_job_types", {})
        return _parse_items(_JOB_TYPES, data, "get_job_types")

    async def get_config(self, name: str) -> dict[str, Any]:
        data = await self.client.call("get_config", {"config": name})
        config = _field(data, "config", "get_config")
        return config if isinstance(config, dict) else {}

    async def list_dir(self, root: str, path: str) -> list[DirItem]:
        data = await self.client.call("list_project_dir", {"root": root, "path": path})
        return _parse_items(
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

    # ---------------------------------------------------------------- changes

    async def create_project_container(self, user_id: int) -> int:
        """Create the per-user EMhub project that groups tomo processing entries."""
        data = await self.client.mutate(
            "create_project",
            {
                "user_id": user_id,
                "status": "special:processing_tomo",
                "user_can_edit": True,
                "is_confidential": False,
                "title": "Default Project for tomo_processing entries",
                "description": "",
            },
        )
        return int(_field(_field(data, "project", "create_project"), "id", "create_project"))

    async def create_entry(self, attrs: dict[str, Any]) -> EmhubEntry:
        data = await self.client.mutate("create_entry", attrs)
        return _parse(_ENTRY, _field(data, "entry", "create_entry"), "create_entry")

    async def load_workflow(self, entry_id: int, workflow_id: str) -> dict[str, str] | None:
        """Load a template; the map of template job ids to new job ids, if EMhub returns it."""
        data = await self.client.mutate(
            "load_workflow", {"entry_id": entry_id, "workflow_id": workflow_id}
        )
        result = _field(data, "workflow", "load_workflow")
        ids = result.get("job_ids") if isinstance(result, dict) else None
        return {str(k): str(v) for k, v in ids.items()} if isinstance(ids, dict) else None

    async def validate_job(
        self,
        entry_id: int,
        run_id: str | None,
        job_type: str | None,
        params: dict[str, Any],
        *,
        for_schedule: bool = False,
    ) -> list[str]:
        """EMhub's own parameter validation (no changes); the list of problems."""
        attrs: dict[str, Any] = {
            "entry_id": entry_id,
            "params": params,
            "for_schedule": for_schedule,
        }
        if run_id:
            attrs["run_id"] = run_id
        else:
            attrs["job_type"] = job_type
        data = await self.client.call("validate_job", attrs)
        result = _field(data, "validation", "validate_job")
        errors = result.get("errors") if isinstance(result, dict) else None
        return [str(e) for e in errors] if isinstance(errors, list) else []

    async def save_job(
        self, entry_id: int, run_id: str | None, job_type: str | None, params: dict[str, Any]
    ) -> None:
        attrs: dict[str, Any] = {"entry_id": entry_id, "params": params}
        if run_id:
            attrs["run_id"] = run_id
        else:
            attrs.update(run_id=None, job_type=job_type)
        await self.client.mutate("save_job", attrs)

    async def launch_job(
        self, entry_id: int, run_id: str, params: dict[str, Any], *, clean: bool
    ) -> None:
        await self.client.mutate(
            "launch_job",
            {
                "entry_id": entry_id,
                "run_id": run_id,
                "params": params,
                "clean": clean,
            },
        )

    async def schedule_job(self, entry_id: int, run_id: str, interval_minutes: int) -> None:
        await self.client.mutate(
            "schedule_job",
            {
                "entry_id": entry_id,
                "run_id": run_id,
                "interval": interval_minutes,
            },
        )

    async def stop_jobs(self, entry_id: int, run_ids: Sequence[str]) -> None:
        await self.client.mutate("stop_jobs", {"entry_id": entry_id, "run_ids": list(run_ids)})

    async def save_job_annotation(
        self, entry_id: int, run_id: str, run_name: str, comment: str
    ) -> None:
        await self.client.mutate(
            "save_job_annotation",
            {
                "entry_id": entry_id,
                "run_id": run_id,
                "runName": run_name,
                "comment": comment,
            },
        )

    async def save_project_label(self, entry_id: int, name: str, color: str) -> ProjectLabel:
        data = await self.client.mutate(
            "save_project_label", {"entry_id": entry_id, "label": {"name": name, "color": color}}
        )
        return _parse(_LABEL, _field(data, "label", "save_project_label"), "save_project_label")

    async def set_job_labels(self, entry_id: int, run_id: str, label_ids: Sequence[str]) -> None:
        await self.client.mutate(
            "set_job_labels",
            {
                "entry_id": entry_id,
                "run_id": run_id,
                "label_ids": list(label_ids),
            },
        )

    async def duplicate_jobs(self, entry_id: int, run_ids: Sequence[str]) -> dict[str, str]:
        data = await self.client.mutate(
            "duplicate_jobs", {"entry_id": entry_id, "run_ids": list(run_ids)}
        )
        workflow = _field(data, "workflow", "duplicate_jobs")
        pairs = workflow.get("duplicated", []) if isinstance(workflow, dict) else []
        return {
            str(p["sourceId"]): str(p["newId"])
            for p in pairs
            if isinstance(p, dict) and "sourceId" in p and "newId" in p
        }

    async def export_workflow(
        self, entry_id: int, run_ids: Sequence[str], output_path: str
    ) -> None:
        await self.client.mutate(
            "export_workflow",
            {
                "entry_id": entry_id,
                "run_ids": list(run_ids),
                "output_path": output_path,
            },
        )

    async def delete_jobs(self, entry_id: int, run_ids: Sequence[str]) -> None:
        await self.client.mutate("delete_jobs", {"entry_id": entry_id, "run_ids": list(run_ids)})
