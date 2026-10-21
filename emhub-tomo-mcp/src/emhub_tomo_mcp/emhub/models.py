# SPDX-License-Identifier: GPL-3.0-or-later
"""Pydantic models of the EMhub payloads this server reads.

They are deliberately tolerant: unknown fields are ignored and most fields are
optional, so small changes in EMhub do not break parsing. Field names follow
EMhub (camelCase where EMhub uses it).
"""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel, ConfigDict, Field, field_validator


class _Payload(BaseModel):
    model_config = ConfigDict(extra="ignore", populate_by_name=True)


class EmhubUser(_Payload):
    id: int
    username: str
    email: str | None = None
    name: str | None = None
    roles: list[str] = Field(default_factory=list)

    @property
    def is_admin(self) -> bool:
        return "admin" in self.roles


class EmhubProject(_Payload):
    """An EMhub project. Tomo processing entries are grouped under per-user
    container projects with status ``special:processing_tomo``."""

    id: int
    status: str | None = None
    title: str | None = None
    user_id: int | None = None


class ShareRow(_Payload):
    user_email: str = ""
    user_perms: str = ""


class EntryData(_Payload):
    processing_path: str = ""
    data_path: str = ""
    share_table: list[ShareRow] = Field(default_factory=list)

    @field_validator("share_table", mode="before")
    @classmethod
    def _rows(cls, value: Any) -> Any:
        # The UI table keeps empty rows; drop them and anything malformed.
        if not isinstance(value, list):
            return []
        return [r for r in value if isinstance(r, dict) and str(r.get("user_email") or "").strip()]


class EmhubEntry(_Payload):
    id: int
    type: str = ""
    title: str | None = ""
    description: str | None = ""
    project_id: int | None = None
    date: str | None = None
    creation_date: str | None = None
    last_update_date: str | None = None
    creation_user_id: int | None = None
    extra: dict[str, Any] = Field(default_factory=dict)

    @property
    def data(self) -> EntryData:
        raw = self.extra.get("data") if isinstance(self.extra, dict) else None
        return EntryData.model_validate(raw if isinstance(raw, dict) else {})


class WorkflowOutput(_Payload):
    output_name: str | None = Field(default=None, alias="outputName")
    pointer_class: str | None = Field(default=None, alias="pointerClass")
    value: str | None = None
    info: str | None = None


class WorkflowNode(_Payload):
    """One job of the widget workflow (``get_session_workflow`` with ``widget``)."""

    id: str
    type: str = ""
    label: str | None = ""
    status: str | None = ""
    parents: list[str] = Field(default_factory=list)
    children: list[str] = Field(default_factory=list)
    outputs: list[WorkflowOutput] = Field(default_factory=list)
    elapsed_time: float | None = Field(default=None, alias="elapsedTime")
    run_name: str | None = Field(default="", alias="runName")
    comment: str | None = ""
    tags: list[str] = Field(default_factory=list)

    @field_validator("elapsed_time", mode="before")
    @classmethod
    def _seconds(cls, value: Any) -> Any:
        if value in ("", None):
            return None
        try:
            return float(value)
        except (TypeError, ValueError):
            return None


class FlatJob(_Payload):
    """One job of the flat workflow (``get_session_workflow`` without ``widget``)."""

    id: str
    type: str = ""
    status: str | None = ""


class RunJson(_Payload):
    values: dict[str, Any] = Field(default_factory=dict)
    info: dict[str, Any] = Field(default_factory=dict)
    inputs: list[str] = Field(default_factory=list)
    outputs: list[str] = Field(default_factory=list)


class RunPayload(_Payload):
    run_json: RunJson | None = Field(default=None, alias="json")
    stdout: str | None = None
    stderr: str | None = None
    form: dict[str, Any] | None = None


class ProjectLabel(_Payload):
    id: str
    name: str = ""
    color: str | None = None


class LabelsPayload(_Payload):
    labels: list[ProjectLabel] = Field(default_factory=list)
    jobs: dict[str, list[str]] = Field(default_factory=dict)


class WorkflowTemplateInfo(_Payload):
    id: str
    title: str | None = None
    description: str | None = None
    file: str | None = None


class JobTypeInfo(_Payload):
    id: str
    label: str = ""
    output: str = ""
    visible: bool = True
    has_form: bool = True


class DirItem(_Payload):
    name: str
    path: str
    is_dir: bool = Field(default=False, alias="isDir")
    size: int = 0
    mime: str | None = None


class FilePreview(_Payload):
    kind: str = "none"
    mime: str | None = None
    meta: dict[str, Any] = Field(default_factory=dict)
    truncated: bool = False
    note: str | None = None
    text: str | None = None
    source: dict[str, Any] | None = None
    error: str | None = None
