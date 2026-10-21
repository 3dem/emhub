# SPDX-License-Identifier: GPL-3.0-or-later
"""Job types and their parameter forms; workflow templates.

The job-type registry comes from ``/api/get_job_types``. Older EMhub servers
do not have it; then the types listed in EMhub's processing menu are used,
which can miss some types.

Forms are fetched through ``get_session_run`` with a project as context,
because EMhub adds the server's queue parameters to every form.
"""

from __future__ import annotations

import difflib
import time
from collections.abc import Callable, Iterator
from typing import Any, Literal

import anyio

from ..emhub.endpoints import EmhubApi
from ..errors import EmhubMcpError, ErrorKind, not_found
from .models import (
    JobTypeDescription,
    JobTypeList,
    JobTypeSummary,
    ParamSpec,
    WorkflowTemplate,
    WorkflowTemplateList,
)
from .projects import ProjectRef, folder_must_exist
from .shaping import truncate

REGISTRY_TTL = 300.0
CONTAINER_CLASSES = frozenset({"Group", "Line"})
PARAM_TYPES = {
    "StringParam": "string",
    "IntParam": "int",
    "FloatParam": "float",
    "BooleanParam": "bool",
    "EnumParam": "enum",
    "PathParam": "path",
    "TextParam": "text",
}
COMPACT_HELP_CHARS = 160
FULL_HELP_CHARS = 1500

Detail = Literal["compact", "full"]


class JobTypeService:
    def __init__(self, api: EmhubApi, *, clock: Callable[[], float] = time.monotonic) -> None:
        self._api = api
        self._clock = clock
        self._lock = anyio.Lock()
        self._registry: JobTypeList | None = None
        self._registry_time = 0.0

    async def registry(self) -> JobTypeList:
        async with self._lock:
            if self._registry is None or self._clock() - self._registry_time > REGISTRY_TTL:
                self._registry = await self._load_registry()
                self._registry_time = self._clock()
            return self._registry

    async def _load_registry(self) -> JobTypeList:
        try:
            infos = await self._api.get_job_types()
        except EmhubMcpError as exc:
            if exc.kind is not ErrorKind.UNSUPPORTED:
                raise
        else:
            return JobTypeList(
                job_types=[
                    JobTypeSummary(
                        id=i.id, label=i.label or i.id, output_type=i.output, visible=i.visible
                    )
                    for i in infos
                ],
                source="registry",
            )
        menus = await self._api.get_config("processing_menus")
        seen: dict[str, str] = {}
        for value, text in _menu_protocols(menus):
            seen.setdefault(value, text)
        return JobTypeList(
            job_types=[
                JobTypeSummary(id=v, label=t, output_type="", visible=True) for v, t in seen.items()
            ],
            source="menu",
        )

    async def require(self, job_type: str) -> JobTypeSummary:
        registry = await self.registry()
        for item in registry.job_types:
            if item.id == job_type:
                return item
        close = difflib.get_close_matches(job_type, [i.id for i in registry.job_types], n=3)
        raise not_found(
            f"Job type '{job_type}'",
            candidates=close,
            hint="list_job_types lists the job types of this server.",
        )

    async def form(self, job_type: str, ref: ProjectRef) -> dict[str, Any]:
        await self.require(job_type)
        with folder_must_exist(ref):
            return await self._api.get_job_form(ref.id, job_type)

    async def describe(
        self, job_type: str, ref: ProjectRef, *, detail: Detail
    ) -> JobTypeDescription:
        summary = await self.require(job_type)
        with folder_must_exist(ref):
            form = await self._api.get_job_form(ref.id, job_type)
        params: list[ParamSpec] = []
        hidden = 0
        queue_names: list[str] = []
        help_limit = COMPACT_HELP_CHARS if detail == "compact" else FULL_HELP_CHARS
        for section, group, raw in _walk_form(form):
            name = str(raw["name"])
            condition = str(raw.get("condition") or "").strip() or None
            if condition is not None and condition.lower().startswith("false"):
                hidden += 1
                continue
            choices = _choices(raw.get("choices"))
            if name == "queue.name" and choices:
                queue_names = choices
            params.append(
                ParamSpec(
                    name=name,
                    label=_label(raw.get("label")),
                    type=PARAM_TYPES.get(str(raw.get("paramClass")), "other"),
                    default=raw.get("default"),
                    choices=choices,
                    condition=condition,
                    section=section,
                    group=group,
                    help=_help(raw.get("help"), help_limit, first_sentence=detail == "compact"),
                    expert=bool(raw.get("expertLevel")),
                )
            )
        if not params and not hidden:
            # EMhub answers with an empty placeholder form for job types without one.
            raise EmhubMcpError(
                ErrorKind.NOT_FOUND,
                f"Job type '{job_type}' has no parameter form on this server.",
                hint="It may be an internal or unfinished job type.",
            )
        return JobTypeDescription(
            job_type=job_type,
            label=summary.label,
            help=_help(
                form.get("help"), 400 if detail == "compact" else 4000, first_sentence=False
            ),
            detail=detail,
            params=params,
            hidden_params=hidden,
            queue_names=queue_names,
        )

    async def templates(self) -> WorkflowTemplateList:
        try:
            infos = await self._api.get_workflow_templates()
        except EmhubMcpError as exc:
            if exc.kind is ErrorKind.UNSUPPORTED:
                raise EmhubMcpError(
                    ErrorKind.UNSUPPORTED,
                    "This EMhub server cannot list workflow templates (no /api/get_workflows).",
                    hint="It needs an EMhub version with that endpoint.",
                ) from None
            raise
        return WorkflowTemplateList(
            templates=[
                WorkflowTemplate(
                    id=i.id,
                    title=(i.title or i.id).strip(),
                    description=(i.description or "").strip(),
                )
                for i in infos
            ]
        )


def _walk_form(form: dict[str, Any]) -> Iterator[tuple[str | None, str | None, dict[str, Any]]]:
    """Yield (section, group, param) for every named parameter of a form."""

    def walk(
        items: Any, section: str | None, group: str | None
    ) -> Iterator[tuple[str | None, str | None, dict[str, Any]]]:
        if not isinstance(items, list):
            return
        for item in items:
            if not isinstance(item, dict):
                continue
            if item.get("paramClass") in CONTAINER_CLASSES or (
                "params" in item and not item.get("name")
            ):
                label = _label(item.get("label"))
                yield from walk(item.get("params"), section, label or group)
            elif item.get("name"):
                yield section, group, item

    for section in form.get("sections") or []:
        if isinstance(section, dict):
            yield from walk(section.get("params"), _label(section.get("label")), None)


def _label(value: Any) -> str | None:
    text = str(value or "").strip().rstrip(":").strip()
    return text or None


def _choices(value: Any) -> list[str] | None:
    if isinstance(value, dict):
        return [str(k) for k in value]
    if isinstance(value, list):
        return [str(v) for v in value]
    return None


def _help(value: Any, limit: int, *, first_sentence: bool) -> str | None:
    text = " ".join(str(value or "").split())
    if not text:
        return None
    if first_sentence:
        cut = text.find(". ")
        if 0 < cut < limit:
            text = text[: cut + 1]
    return truncate(text, limit)


def _menu_protocols(menus: dict[str, Any]) -> Iterator[tuple[str, str]]:
    def walk(node: Any) -> Iterator[tuple[str, str]]:
        if isinstance(node, dict):
            if node.get("tag") == "protocol" and node.get("value"):
                yield str(node["value"]), str(node.get("text") or node["value"])
            for child in node.get("childs") or []:
                yield from walk(child)
            for key, value in node.items():
                if key != "childs" and isinstance(value, (dict, list)):
                    yield from walk(value)
        elif isinstance(node, list):
            for child in node:
                yield from walk(child)

    yield from walk(menus.get("menu_widget", menus))
