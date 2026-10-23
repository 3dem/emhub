# SPDX-License-Identifier: GPL-3.0-or-later
"""Changes to projects: creating projects, loading templates, editing,
running, scheduling, stopping, annotating, labelling, copying, exporting and
deleting jobs.

Every change is checked before anything is sent to EMhub:

- the access level, on the server and on the project (see ``policy.py``);
- the job's status: running jobs are never edited, re-run or deleted, and a
  finished job is only re-run when asked to explicitly (EMhub itself would
  silently reset a finished job when its parameters are saved);
- the parameters, against the job type's form and then by EMhub's own
  validation, without saving anything;
- where GPU jobs run: on a cluster queue, unless running them on the EMhub host
  is allowed; with the configured default queue when a job names none;
- limits on launches per hour, GPUs per job and GPU jobs active at once.

Changes to one project are serialized, every attempt is written to the audit
log, and the result reports the jobs' statuses after the change. With
``dry_run`` the checks run and the result says what would be done.
"""

from __future__ import annotations

import difflib
import logging
import posixpath
import re
import time
from collections.abc import Awaitable, Callable, Iterable, Sequence
from typing import Any

import anyio

from ..config import Settings
from ..emhub.endpoints import EmhubApi
from ..emhub.models import WorkflowNode
from ..errors import EmhubMcpError, ErrorKind, denied, invalid, not_found
from ..policy import AuditLog, LaunchLimiter, Level, ProjectLocks, require_level
from .job_types import JobTypeService
from .jobs import ACTIVE, JobService
from .models import ChangeResult, JobState
from .paths import normalize_project_path
from .projects import ENTRY_TYPE, ProjectCatalog, ProjectRef, folder_must_exist
from .validation import GPU_PARAMS, form_params, job_gpus, validate_params

logger = logging.getLogger(__name__)

EDITABLE = frozenset({"saved", "failed", "aborted"})
TEXT_RE = re.compile(r"^[^\x00-\x1f\x7f]*$")
COMMENT_RE = re.compile(r"^[^\x00-\x09\x0b-\x1f\x7f]*$")  # line breaks allowed
LABEL_COLORS = ("#1f77b4", "#ff7f0e", "#2ca02c", "#d62728", "#9467bd", "#8c564b", "#e377c2")
EXPORT_NAME_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.\-]{0,100}\.json$")


def _text(value: str, what: str, limit: int, pattern: re.Pattern[str] = TEXT_RE) -> str:
    if len(value) > limit:
        raise invalid(f"{what} is longer than {limit} characters.")
    if not pattern.match(value):
        raise invalid(f"{what} contains control characters.")
    return value


_GPU_HINT = (
    "Lower the job's GPU count: 'gpus', or 'gpu_ids' for RELION jobs, whose 'gpus' "
    "emwrap ignores (EMHUB_TOMO_MCP_MAX_GPUS_PER_JOB)."
)


class Operations:
    def __init__(
        self,
        settings: Settings,
        api: EmhubApi,
        projects: ProjectCatalog,
        jobs: JobService,
        job_types: JobTypeService,
        *,
        limiter: LaunchLimiter,
        locks: ProjectLocks,
        audit: AuditLog,
        sleep: Callable[[float], Awaitable[None]] = anyio.sleep,
    ) -> None:
        self._settings = settings
        self._api = api
        self._projects = projects
        self._jobs = jobs
        self._job_types = job_types
        self._limiter = limiter
        self._locks = locks
        self._audit = audit
        self._sleep = sleep
        self._gpu_types: dict[str, bool] = {}

    # ------------------------------------------------------------ helpers

    def _require(self, ref: ProjectRef, needed: Level, action: str) -> None:
        require_level(self._settings.access, ref.summary.access, needed, ref.id, action)

    async def _run_audited(
        self,
        action: str,
        project_id: int | None,
        args: dict[str, Any],
        work: Callable[[], Awaitable[ChangeResult]],
    ) -> ChangeResult:
        started = time.monotonic()
        try:
            result = await work()
        except EmhubMcpError as exc:
            self._audit.write(
                action=action,
                project_id=project_id,
                args=args,
                outcome=exc.kind.value,
                detail=exc.message,
            )
            raise
        except Exception as exc:
            self._audit.write(
                action=action,
                project_id=project_id,
                args=args,
                outcome="internal_error",
                detail=type(exc).__name__,
            )
            raise
        self._audit.write(
            action=action,
            project_id=project_id,
            args=args,
            outcome="dry_run" if result.dry_run else "done",
            seconds=round(time.monotonic() - started, 2),
            jobs=[f"{j.id}:{j.status}" for j in result.jobs],
            created=result.created,
        )
        return result

    async def _graph(self, ref: ProjectRef) -> dict[str, WorkflowNode]:
        return await self._jobs.graph(ref)

    def _node(self, graph: dict[str, WorkflowNode], ref: ProjectRef, job_id: str) -> WorkflowNode:
        node = graph.get(job_id)
        if node is None:
            close = difflib.get_close_matches(job_id, list(graph), n=3, cutoff=0.5)
            raise not_found(
                f"Job '{job_id}' in project {ref.id}",
                candidates=close,
                hint="get_project lists the project's jobs.",
            )
        return node

    @staticmethod
    def _status(node: WorkflowNode) -> str:
        return (node.status or "unknown").lower()

    async def _states(self, ref: ProjectRef, job_ids: Iterable[str]) -> list[JobState]:
        with folder_must_exist(ref):
            current = {
                j.id: (j.status or "unknown").lower()
                for j in await self._api.get_job_statuses(ref.id)
            }
        return [JobState(id=j, status=current.get(j, "deleted")) for j in job_ids]

    async def _settle(
        self, ref: ProjectRef, job_ids: Sequence[str], before: dict[str, str]
    ) -> list[JobState]:
        """Statuses after a change; EMhub may need a moment to report the new state."""
        states = await self._states(ref, job_ids)
        for _ in range(6):
            if all(s.status != before.get(s.id) for s in states):
                break
            await self._sleep(0.5)
            states = await self._states(ref, job_ids)
        return states

    async def _form(self, ref: ProjectRef, job_type: str) -> dict[str, Any]:
        return await self._job_types.form(job_type, ref)

    async def _is_gpu_type(self, ref: ProjectRef, job_type: str) -> bool:
        if job_type not in self._gpu_types:
            try:
                names = form_params(await self._form(ref, job_type))
                self._gpu_types[job_type] = any(p in names for p in GPU_PARAMS)
            except EmhubMcpError:
                self._gpu_types[job_type] = False
        return self._gpu_types[job_type]

    async def _job_gpus(self, ref: ProjectRef, job_type: str, params: dict[str, Any]) -> int:
        """GPUs the job would use with these parameters; 0 if it cannot use GPUs."""
        return job_gpus(params) if await self._is_gpu_type(ref, job_type) else 0

    @staticmethod
    def _placement(merged: dict[str, Any], gpus: int) -> str:
        queue = merged.get("queue.name") or "None"
        return f"queue '{queue}'" + (f", {gpus} GPU(s)" if gpus else ", no GPUs")

    async def _current_params(self, ref: ProjectRef, job_id: str) -> dict[str, Any]:
        with folder_must_exist(ref):
            run = await self._api.get_run(ref.id, job_id, ["json"])
        return dict(run.run_json.values) if run.run_json else {}

    async def _check_params(
        self,
        ref: ProjectRef,
        job_type: str,
        job_id: str | None,
        params: dict[str, Any],
        *,
        allow_unknown: bool,
        for_schedule: bool,
    ) -> tuple[dict[str, Any], list[str]]:
        """Client-side checks, then EMhub's validation of the merged parameters."""
        clean = await self._check_form(ref, job_type, params, allow_unknown=allow_unknown)
        return clean, await self._emhub_check(ref, job_type, job_id, clean, for_schedule)

    async def _check_form(
        self, ref: ProjectRef, job_type: str, params: dict[str, Any], *, allow_unknown: bool
    ) -> dict[str, Any]:
        form = await self._form(ref, job_type)
        clean, errors = validate_params(form, params, allow_unknown=allow_unknown)
        if errors:
            raise invalid(
                f"Invalid parameters for {job_type}:",
                details=errors,
                hint="describe_job_type lists the parameters and their choices.",
            )
        return clean

    async def _emhub_check(
        self,
        ref: ProjectRef,
        job_type: str,
        job_id: str | None,
        clean: dict[str, Any],
        for_schedule: bool,
    ) -> list[str]:
        """EMhub's own validation (nothing is saved); notes if it is not available."""
        notes = []
        try:
            problems = await self._api.validate_job(
                ref.id,
                job_id,
                job_type if job_id is None else None,
                clean,
                for_schedule=for_schedule,
            )
        except EmhubMcpError as exc:
            if exc.kind is not ErrorKind.UNSUPPORTED:
                raise
            notes.append(
                "EMhub's own validation is not available on this server; only the form was checked."
            )
        else:
            if problems:
                raise invalid(
                    f"EMhub rejected the parameters of {job_id or job_type}:", details=problems
                )
        return notes

    async def _queue_policy(
        self, ref: ProjectRef, job_type: str, merged: dict[str, Any], params: dict[str, Any]
    ) -> list[str]:
        """Apply the default queue and refuse GPU jobs on the EMhub host; returns notes."""
        if not await self._job_gpus(ref, job_type, merged):
            return []
        queue = str(merged.get("queue.name") or "").strip()
        notes = []
        if not queue and self._settings.default_queue:
            queues = form_params(await self._form(ref, job_type)).get("queue.name")
            if queues and queues.choices and self._settings.default_queue not in queues.choices:
                raise invalid(
                    f"The default queue '{self._settings.default_queue}' is not configured on "
                    f"this server; queues: {', '.join(queues.choices)}.",
                    hint="Fix EMHUB_TOMO_MCP_DEFAULT_QUEUE.",
                )
            params["queue.name"] = queue = self._settings.default_queue
            notes.append(f"No queue was set; using the default queue '{queue}'.")
        if queue in ("", "None") and not self._settings.allow_local_gpu:
            raise denied(
                f"{job_type} is a GPU job and would run on the EMhub host itself "
                f"(queue '{queue or 'None'}').",
                hint="Set queue.name to a cluster queue (describe_job_type lists them), or have "
                "the operator set EMHUB_TOMO_MCP_DEFAULT_QUEUE.",
            )
        return notes

    async def _active_gpu_jobs(self) -> list[str]:
        """Launched or running GPU jobs in all visible projects."""
        active = []
        listing = await self._projects.list(scope="all", limit=200)
        for summary in listing.projects:
            try:
                ref = await self._projects.get(summary.id)
                with folder_must_exist(ref):
                    jobs = await self._api.get_job_statuses(ref.id)
            except EmhubMcpError:
                continue
            for job in jobs:
                status = (job.status or "").lower()
                if status in ("launched", "running") and await self._is_gpu_type(ref, job.type):
                    active.append(f"{summary.id}:{job.id}")
        return active

    async def _gpu_limits(
        self, ref: ProjectRef, job_type: str, merged: dict[str, Any], new_parallel: int
    ) -> None:
        gpus = await self._job_gpus(ref, job_type, merged)
        if not gpus:
            return
        limit = self._settings.max_gpus_per_job
        if limit is not None and gpus > limit:
            raise denied(
                f"{job_type} asks for {gpus} GPUs; the limit is {limit} per job.",
                hint=_GPU_HINT,
            )
        cap = self._settings.max_active_gpu_jobs
        if cap is not None:
            active = await self._active_gpu_jobs()
            if len(active) + new_parallel > cap:
                raise denied(
                    f"At most {cap} GPU jobs may run at once; {len(active)} are active "
                    f"({', '.join(active[:5])}).",
                    hint="Wait for them to finish, or schedule the job so it starts later "
                    "(EMHUB_TOMO_MCP_MAX_ACTIVE_GPU_JOBS).",
                )

    # ------------------------------------------------------------ projects

    async def create_project(
        self,
        *,
        title: str,
        processing_path: str,
        data_path: str,
        description: str,
        dry_run: bool,
    ) -> ChangeResult:
        args = {"title": title, "processing_path": processing_path, "data_path": data_path}

        async def work() -> ChangeResult:
            if not self._settings.can_write:
                raise denied("This server is read-only.", hint="EMHUB_TOMO_MCP_ACCESS is 'read'.")
            if not self._settings.allowed_roots:
                raise denied(
                    "Creating projects is disabled on this server.",
                    hint="The operator can allow it with EMHUB_TOMO_MCP_ALLOWED_ROOTS.",
                )
            _text(title, "The title", 200)
            _text(description, "The description", 2000, COMMENT_RE)
            folder = self._inside_roots(processing_path, "processing_path")
            data = self._inside_roots(data_path, "data_path")
            for _, summary in [
                (None, s) for s in (await self._projects.list(scope="all", limit=200)).projects
            ]:
                if posixpath.normpath(summary.processing_path) == folder:
                    raise EmhubMcpError(
                        ErrorKind.CONFLICT, f"Project {summary.id} already uses {folder}."
                    )
            details = [
                f"Create project '{title}' in {folder}, with data from {data}.",
                "EMhub creates the folder if it does not exist (its parent must exist), "
                "or registers it if it already holds a project.",
            ]
            if dry_run:
                return ChangeResult(
                    action="create_project",
                    project_id=None,
                    dry_run=True,
                    done=False,
                    details=details,
                )
            identity = await self._projects.identity()
            container = await self._container(identity.user.id)
            entry = await self._api.create_entry(
                {
                    "project_id": container,
                    "type": ENTRY_TYPE,
                    "title": title,
                    "description": description,
                    "date": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                    "extra": {
                        "data": {"processing_path": folder, "data_path": data, "share_table": []}
                    },
                }
            )
            self._projects.invalidate()
            ref = await self._projects.get(entry.id)
            return ChangeResult(
                action="create_project",
                project_id=entry.id,
                dry_run=False,
                done=True,
                project=ref.summary,
                details=details,
            )

        return await self._run_audited("create_project", None, args, work)

    def _inside_roots(self, path: str, name: str) -> str:
        _text(path, name, 1024)
        if not path.startswith("/"):
            raise invalid(f"{name} must be an absolute path.")
        if any(part == ".." for part in path.split("/")):
            raise invalid(f"{name} must not contain '..'.")
        normalized = posixpath.normpath(path)
        for root in self._settings.allowed_roots:
            if normalized == root or normalized.startswith(root.rstrip("/") + "/"):
                return normalized
        raise denied(
            f"{name} {normalized} is outside the folders this server may use.",
            hint="Allowed: "
            + ", ".join(self._settings.allowed_roots)
            + " (EMHUB_TOMO_MCP_ALLOWED_ROOTS).",
        )

    async def _container(self, user_id: int) -> int:
        for project in await self._api.get_projects():
            if project.user_id == user_id and project.status == "special:processing_tomo":
                return project.id
        return await self._api.create_project_container(user_id)

    async def load_template(
        self, ref: ProjectRef, workflow_id: str, *, allow_duplicate: bool, dry_run: bool
    ) -> ChangeResult:
        args = {"workflow_id": workflow_id, "allow_duplicate": allow_duplicate}

        async def work() -> ChangeResult:
            self._require(ref, "operate", "load workflow templates")
            templates = {t.id: t for t in (await self._job_types.templates()).templates}
            template = templates.get(workflow_id)
            if template is None:
                close = difflib.get_close_matches(workflow_id, list(templates), n=3)
                raise not_found(f"Workflow template '{workflow_id}'", candidates=close)
            async with self._locks(ref.id):
                graph = await self._graph(ref)
                present = {n.type for n in graph.values()}
                types = [j.jobtype for j in template.jobs]
                if types and set(types) <= present and not allow_duplicate:
                    raise EmhubMcpError(
                        ErrorKind.CONFLICT,
                        f"Project {ref.id} already has jobs of every type in '{workflow_id}'; "
                        "loading it again would add a second copy of each.",
                        hint="Use allow_duplicate=true if a second copy is intended.",
                    )
                details = [
                    f"Add {len(types)} saved jobs: {', '.join(types)}."
                    if types
                    else "Add the template's jobs."
                ]
                if dry_run:
                    return ChangeResult(
                        action="load_workflow_template",
                        project_id=ref.id,
                        dry_run=True,
                        done=False,
                        details=details,
                    )
                before = set(graph)
                id_map = await self._api.load_workflow(ref.id, workflow_id)
                after = await self._graph(ref)
                created = list(id_map.values()) if id_map else [j for j in after if j not in before]
            return ChangeResult(
                action="load_workflow_template",
                project_id=ref.id,
                dry_run=False,
                done=True,
                created=created,
                jobs=await self._states(ref, created),
                details=details,
            )

        return await self._run_audited("load_workflow_template", ref.id, args, work)

    # --------------------------------------------------------------- jobs

    async def save_job(
        self,
        ref: ProjectRef,
        *,
        job_id: str | None,
        job_type: str | None,
        params: dict[str, Any],
        allow_unknown: bool,
        dry_run: bool,
    ) -> ChangeResult:
        args = {"job_id": job_id, "job_type": job_type, "params": params}

        async def work() -> ChangeResult:
            self._require(ref, "operate", "edit jobs")
            if (job_id is None) == (job_type is None):
                raise invalid("Give either job_id (to edit a job) or job_type (to create one).")
            async with self._locks(ref.id):
                graph = await self._graph(ref)
                if job_id is not None:
                    node = self._node(graph, ref, job_id)
                    status = self._status(node)
                    if status not in EDITABLE:
                        hint = (
                            "Stop it first."
                            if status in ACTIVE
                            else "Copy it with duplicate_jobs and edit the copy, or re-run it "
                            "with run_job(rerun=true, params=...)."
                        )
                        raise EmhubMcpError(
                            ErrorKind.CONFLICT,
                            f"{job_id} is {status}; only saved, failed or aborted jobs can be "
                            "edited.",
                            hint=hint,
                        )
                    type_ = node.type
                else:
                    assert job_type is not None
                    await self._job_types.require(job_type)
                    type_ = job_type
                clean, notes = await self._check_params(
                    ref, type_, job_id, params, allow_unknown=allow_unknown, for_schedule=True
                )
                details = [f"Set {k} = {v!r}" for k, v in clean.items()] or [
                    "No parameters changed."
                ]
                if dry_run:
                    return ChangeResult(
                        action="save_job",
                        project_id=ref.id,
                        dry_run=True,
                        done=False,
                        details=details,
                        warnings=notes,
                        jobs=await self._states(ref, [job_id]) if job_id else [],
                    )
                await self._api.save_job(ref.id, job_id, job_type, clean)
                created: list[str] = []
                if job_id is None:
                    after = await self._graph(ref)
                    created = [j for j in after if j not in graph]
                target = job_id or (created[0] if created else None)
            return ChangeResult(
                action="save_job",
                project_id=ref.id,
                dry_run=False,
                done=True,
                created=created,
                details=details,
                warnings=notes,
                jobs=await self._states(ref, [target]) if target else [],
            )

        return await self._run_audited("save_job", ref.id, args, work)

    async def run_job(
        self,
        ref: ProjectRef,
        job_id: str,
        *,
        params: dict[str, Any],
        rerun: bool,
        clean: bool,
        dry_run: bool,
    ) -> ChangeResult:
        args = {"job_id": job_id, "params": params, "rerun": rerun, "clean": clean}

        async def work() -> ChangeResult:
            self._require(
                ref,
                "admin" if clean else "operate",
                "re-run jobs from a clean folder" if clean else "run jobs",
            )
            async with self._locks(ref.id):
                graph = await self._graph(ref)
                node = self._node(graph, ref, job_id)
                status = self._status(node)
                self._check_runnable(job_id, status, rerun)
                # Policy first (queue, GPUs, launches), then EMhub's validation.
                clean_params = await self._check_form(ref, node.type, params, allow_unknown=False)
                merged = {**await self._current_params(ref, job_id), **clean_params}
                notes = await self._queue_policy(ref, node.type, merged, clean_params)
                merged.update(clean_params)
                await self._gpu_limits(ref, node.type, merged, new_parallel=1)
                self._limiter.check(1)
                notes += await self._emhub_check(ref, node.type, job_id, clean_params, False)
                gpus = await self._job_gpus(ref, node.type, merged)
                details = [f"Launch {job_id} ({node.type}) on {self._placement(merged, gpus)}."]
                details += [f"Set {k} = {v!r}" for k, v in clean_params.items()]
                if clean:
                    details.append("Move the current job folder to the project's .Trash first.")
                if dry_run:
                    return ChangeResult(
                        action="run_job",
                        project_id=ref.id,
                        dry_run=True,
                        done=False,
                        details=details,
                        warnings=notes,
                        jobs=await self._states(ref, [job_id]),
                    )
                await self._mutate_or_report(
                    ref, [job_id], self._api.launch_job(ref.id, job_id, clean_params, clean=clean)
                )
                self._limiter.record(1)
            states = await self._settle(ref, [job_id], {job_id: status})
            return ChangeResult(
                action="run_job",
                project_id=ref.id,
                dry_run=False,
                done=True,
                jobs=states,
                details=details,
                warnings=notes,
            )

        return await self._run_audited("run_job", ref.id, args, work)

    @staticmethod
    def _check_runnable(job_id: str, status: str, rerun: bool) -> None:
        if status in ACTIVE:
            raise EmhubMcpError(
                ErrorKind.CONFLICT,
                f"{job_id} is already {status}.",
                hint="Wait for it, or stop it with stop_jobs.",
            )
        if status == "finished" and not rerun:
            raise EmhubMcpError(
                ErrorKind.CONFLICT,
                f"{job_id} already finished; running it again overwrites its results.",
                hint="Pass rerun=true if that is intended, or duplicate it.",
            )

    async def _mutate_or_report(
        self, ref: ProjectRef, job_ids: Sequence[str], call: Awaitable[None]
    ) -> None:
        """Run a change; if EMhub does not answer in time, say what is known."""
        try:
            await call
        except EmhubMcpError as exc:
            if exc.kind is not ErrorKind.UNREACHABLE:
                raise
            try:
                states = await self._states(ref, job_ids)
                now = ", ".join(f"{s.id}: {s.status}" for s in states)
            except EmhubMcpError:
                now = "unknown (EMhub is not answering)"
            raise EmhubMcpError(
                ErrorKind.UNREACHABLE,
                f"EMhub did not confirm the change in time; the outcome is unknown. "
                f"Current status: {now}.",
                hint="Check the status before trying again, to avoid doing it twice.",
            ) from None

    async def schedule_jobs(
        self,
        ref: ProjectRef,
        job_ids: Sequence[str],
        *,
        interval_minutes: int,
        rerun: bool,
        dry_run: bool,
    ) -> ChangeResult:
        wanted = list(dict.fromkeys(job_ids))
        args = {"job_ids": wanted, "interval_minutes": interval_minutes, "rerun": rerun}

        async def work() -> ChangeResult:
            self._require(ref, "operate", "schedule jobs")
            if not wanted:
                raise invalid("Give at least one job id.")
            async with self._locks(ref.id):
                graph = await self._graph(ref)
                nodes = [self._node(graph, ref, j) for j in wanted]
                before = {n.id: self._status(n) for n in nodes}
                for node in nodes:
                    self._check_runnable(node.id, before[node.id], rerun)
                ordered = _topological(graph, wanted)
                updates: dict[str, dict[str, Any]] = {}
                notes: list[str] = []
                placements: list[str] = []
                for job_id in ordered:
                    node = graph[job_id]
                    _, job_notes = await self._check_params(
                        ref, node.type, job_id, {}, allow_unknown=False, for_schedule=True
                    )
                    merged = await self._current_params(ref, job_id)
                    params: dict[str, Any] = {}
                    job_notes += await self._queue_policy(ref, node.type, merged, params)
                    merged.update(params)
                    updates[job_id] = params
                    notes += [f"{job_id}: {n}" for n in job_notes]
                    gpus = await self._job_gpus(ref, node.type, merged)
                    placements.append(f"{job_id}: {self._placement(merged, gpus)}.")
                    max_gpus = self._settings.max_gpus_per_job
                    if max_gpus is not None and gpus > max_gpus:
                        raise denied(
                            f"{job_id} asks for {gpus} GPUs; the limit is {max_gpus} per job.",
                            hint=_GPU_HINT,
                        )
                parallel = await self._parallel_gpu_starts(ref, graph, ordered)
                if parallel and self._settings.max_active_gpu_jobs is not None:
                    gpu_node = graph[parallel[0]]
                    await self._gpu_limits(
                        ref,
                        gpu_node.type,
                        await self._current_params(ref, parallel[0]),
                        new_parallel=len(parallel),
                    )
                self._limiter.check(len(ordered))
                details = [
                    f"Schedule {', '.join(ordered)} (checked every {interval_minutes} "
                    "min; each starts when its parent jobs have finished).",
                    *placements,
                ]
                if dry_run:
                    return ChangeResult(
                        action="schedule_jobs",
                        project_id=ref.id,
                        dry_run=True,
                        done=False,
                        details=details,
                        warnings=notes,
                        jobs=await self._states(ref, ordered),
                    )
                for job_id in ordered:
                    if updates[job_id]:
                        await self._api.save_job(ref.id, job_id, None, updates[job_id])
                    await self._mutate_or_report(
                        ref, [job_id], self._api.schedule_job(ref.id, job_id, interval_minutes)
                    )
                    self._limiter.record(1)
            states = await self._settle(ref, ordered, before)
            return ChangeResult(
                action="schedule_jobs",
                project_id=ref.id,
                dry_run=False,
                done=True,
                jobs=states,
                details=details,
                warnings=notes,
            )

        return await self._run_audited("schedule_jobs", ref.id, args, work)

    async def _parallel_gpu_starts(
        self, ref: ProjectRef, graph: dict[str, WorkflowNode], ordered: Sequence[str]
    ) -> list[str]:
        """Scheduled GPU jobs that could run at the same time as the jobs already
        active: those without an unfinished GPU ancestor (which they would wait for)."""
        waiting = set(ordered) | {j for j, n in graph.items() if self._status(n) in ACTIVE}
        result = []
        for job_id in ordered:
            if not await self._is_gpu_type(ref, graph[job_id].type):
                continue
            ancestors = _ancestors(graph, job_id)
            gpu_ancestors = [
                a for a in ancestors if a in waiting and await self._is_gpu_type(ref, graph[a].type)
            ]
            if not gpu_ancestors:
                result.append(job_id)
        return result

    async def stop_jobs(self, ref: ProjectRef, job_ids: Sequence[str]) -> ChangeResult:
        wanted = list(dict.fromkeys(job_ids))

        async def work() -> ChangeResult:
            self._require(ref, "operate", "stop jobs")
            if not wanted:
                raise invalid("Give at least one job id.")
            async with self._locks(ref.id):
                graph = await self._graph(ref)
                before = {}
                for job_id in wanted:
                    status = self._status(self._node(graph, ref, job_id))
                    if status not in ACTIVE:
                        raise EmhubMcpError(
                            ErrorKind.CONFLICT,
                            f"{job_id} is {status}; only scheduled, launched "
                            "or running jobs can be stopped.",
                        )
                    before[job_id] = status
                await self._mutate_or_report(ref, wanted, self._api.stop_jobs(ref.id, wanted))
            states = await self._settle(ref, wanted, before)
            return ChangeResult(
                action="stop_jobs",
                project_id=ref.id,
                dry_run=False,
                done=True,
                jobs=states,
                details=[
                    "Scheduled jobs go back to saved; launched and running jobs are "
                    "aborted (cluster jobs are cancelled)."
                ],
            )

        return await self._run_audited("stop_jobs", ref.id, {"job_ids": wanted}, work)

    async def annotate_job(
        self, ref: ProjectRef, job_id: str, *, run_name: str | None, comment: str | None
    ) -> ChangeResult:
        args = {"job_id": job_id, "run_name": run_name, "comment": comment}

        async def work() -> ChangeResult:
            self._require(ref, "operate", "annotate jobs")
            if run_name is None and comment is None:
                raise invalid("Give run_name and/or comment.")
            async with self._locks(ref.id):
                node = self._node(await self._graph(ref), ref, job_id)
                name = _text(
                    run_name if run_name is not None else (node.run_name or ""), "run_name", 200
                )
                text = _text(
                    comment if comment is not None else (node.comment or ""),
                    "comment",
                    4000,
                    COMMENT_RE,
                )
                await self._api.save_job_annotation(ref.id, job_id, name, text)
            return ChangeResult(
                action="annotate_job",
                project_id=ref.id,
                dry_run=False,
                done=True,
                jobs=await self._states(ref, [job_id]),
                details=[f"run name: {name!r}", f"comment: {text[:200]!r}"],
            )

        return await self._run_audited("annotate_job", ref.id, args, work)

    async def tag_jobs(
        self,
        ref: ProjectRef,
        job_ids: Sequence[str],
        *,
        add: Sequence[str],
        remove: Sequence[str],
    ) -> ChangeResult:
        wanted = list(dict.fromkeys(job_ids))
        args = {"job_ids": wanted, "add": list(add), "remove": list(remove)}

        async def work() -> ChangeResult:
            self._require(ref, "operate", "label jobs")
            if not wanted or not (add or remove):
                raise invalid("Give job ids and labels to add or remove.")
            for name in [*add, *remove]:
                _text(name, "A label", 60)
                if not name.strip():
                    raise invalid("Label names must not be empty.")
            async with self._locks(ref.id):
                graph = await self._graph(ref)
                for job_id in wanted:
                    self._node(graph, ref, job_id)
                labels = await self._api.get_project_labels(ref.id)
                by_name = {lbl.name: lbl.id for lbl in labels.labels}
                created = []
                for i, name in enumerate(a for a in add if a not in by_name):
                    color = LABEL_COLORS[(len(by_name) + i) % len(LABEL_COLORS)]
                    label = await self._api.save_project_label(ref.id, name, color)
                    by_name[name] = label.id
                    created.append(name)
                add_ids = [by_name[n] for n in add]
                remove_ids = {by_name[n] for n in remove if n in by_name}
                for job_id in wanted:
                    current = labels.jobs.get(job_id, [])
                    new = [i for i in dict.fromkeys([*current, *add_ids]) if i not in remove_ids]
                    if new != current:
                        await self._api.set_job_labels(ref.id, job_id, new)
            details = [
                f"Labels added: {', '.join(add) or '-'}; removed: {', '.join(remove) or '-'}."
            ]
            if created:
                details.append(f"New labels created: {', '.join(created)}.")
            return ChangeResult(
                action="tag_jobs",
                project_id=ref.id,
                dry_run=False,
                done=True,
                jobs=await self._states(ref, wanted),
                details=details,
            )

        return await self._run_audited("tag_jobs", ref.id, args, work)

    async def duplicate_jobs(self, ref: ProjectRef, job_ids: Sequence[str]) -> ChangeResult:
        wanted = list(dict.fromkeys(job_ids))

        async def work() -> ChangeResult:
            self._require(ref, "operate", "copy jobs")
            if not wanted:
                raise invalid("Give at least one job id.")
            async with self._locks(ref.id):
                graph = await self._graph(ref)
                for job_id in wanted:
                    self._node(graph, ref, job_id)
                mapping = await self._api.duplicate_jobs(ref.id, wanted)
                if not mapping:
                    after = await self._graph(ref)
                    mapping = dict(zip(wanted, [j for j in after if j not in graph], strict=False))
            created = list(mapping.values())
            return ChangeResult(
                action="duplicate_jobs",
                project_id=ref.id,
                dry_run=False,
                done=True,
                created=created,
                jobs=await self._states(ref, created),
                details=[f"{src} -> {dst}" for src, dst in mapping.items()]
                + ["Links between the copied jobs point at the copies."],
            )

        return await self._run_audited("duplicate_jobs", ref.id, {"job_ids": wanted}, work)

    async def export_workflow(
        self, ref: ProjectRef, job_ids: Sequence[str], *, file_name: str, overwrite: bool
    ) -> ChangeResult:
        wanted = list(dict.fromkeys(job_ids))
        args = {"job_ids": wanted, "file_name": file_name, "overwrite": overwrite}

        async def work() -> ChangeResult:
            self._require(ref, "operate", "export workflows")
            if not EXPORT_NAME_RE.match(file_name):
                raise invalid(
                    "file_name must be a plain file name ending in .json, e.g. 'my_pipeline.json'."
                )
            normalize_project_path(file_name)
            if not wanted:
                raise invalid("Give at least one job id.")
            async with self._locks(ref.id):
                graph = await self._graph(ref)
                for job_id in wanted:
                    self._node(graph, ref, job_id)
                existing = {item.name for item in await self._api.list_dir(ref.root, ".")}
                if file_name in existing and not overwrite:
                    raise EmhubMcpError(
                        ErrorKind.CONFLICT,
                        f"{file_name} already exists.",
                        hint="Pass overwrite=true to replace it.",
                    )
                await self._api.export_workflow(ref.id, wanted, file_name)
            return ChangeResult(
                action="export_workflow",
                project_id=ref.id,
                dry_run=False,
                done=True,
                jobs=await self._states(ref, wanted),
                details=[f"Wrote {file_name} in the project folder with {len(wanted)} job(s)."],
            )

        return await self._run_audited("export_workflow", ref.id, args, work)

    async def delete_jobs(
        self, ref: ProjectRef, job_ids: Sequence[str], *, dry_run: bool
    ) -> ChangeResult:
        wanted = list(dict.fromkeys(job_ids))

        async def work() -> ChangeResult:
            self._require(ref, "admin", "delete jobs")
            if not wanted:
                raise invalid("Give at least one job id.")
            async with self._locks(ref.id):
                graph = await self._graph(ref)
                for job_id in wanted:
                    status = self._status(self._node(graph, ref, job_id))
                    if status in ACTIVE:
                        raise EmhubMcpError(
                            ErrorKind.CONFLICT,
                            f"{job_id} is {status}.",
                            hint="Stop it with stop_jobs first.",
                        )
                    orphans = [c for c in dict.fromkeys(graph[job_id].children) if c not in wanted]
                    if orphans:
                        raise EmhubMcpError(
                            ErrorKind.CONFLICT,
                            f"{job_id} has jobs that use its outputs: {', '.join(orphans)}.",
                            hint="Delete them together, or delete only leaf jobs.",
                        )
                details = [
                    f"Move {', '.join(wanted)} to the project's .Trash folder and "
                    "remove them from the pipeline."
                ]
                if dry_run:
                    return ChangeResult(
                        action="delete_jobs",
                        project_id=ref.id,
                        dry_run=True,
                        done=False,
                        details=details,
                        jobs=await self._states(ref, wanted),
                    )
                await self._mutate_or_report(ref, wanted, self._api.delete_jobs(ref.id, wanted))
            return ChangeResult(
                action="delete_jobs",
                project_id=ref.id,
                dry_run=False,
                done=True,
                jobs=await self._states(ref, wanted),
                details=details,
            )

        return await self._run_audited("delete_jobs", ref.id, {"job_ids": wanted}, work)


def _ancestors(graph: dict[str, WorkflowNode], job_id: str) -> set[str]:
    seen: set[str] = set()
    stack = [p for p in graph[job_id].parents if p in graph]
    while stack:
        parent = stack.pop()
        if parent not in seen:
            seen.add(parent)
            stack.extend(p for p in graph[parent].parents if p in graph)
    return seen


def _topological(graph: dict[str, WorkflowNode], job_ids: Sequence[str]) -> list[str]:
    """The given jobs, parents before children."""
    wanted = set(job_ids)
    order: list[str] = []
    visiting: set[str] = set()

    def visit(job_id: str) -> None:
        if job_id in order or job_id in visiting:
            return
        visiting.add(job_id)
        for parent in graph[job_id].parents:
            if parent in wanted:
                visit(parent)
        visiting.discard(job_id)
        order.append(job_id)

    for job_id in job_ids:
        visit(job_id)
    return order
