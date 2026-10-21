# SPDX-License-Identifier: GPL-3.0-or-later
"""Jobs: the job graph of a project, job details, logs, and waiting for jobs.

Statuses are EMhub's lowercase REST statuses: saved, scheduled, launched,
running, finished (emwrap's "Succeeded"), failed and aborted.
"""

from __future__ import annotations

import difflib
import time
from collections import Counter
from collections.abc import Awaitable, Callable, Collection, Sequence
from typing import Literal

import anyio

from ..emhub.endpoints import EmhubApi
from ..emhub.models import RunPayload, WorkflowNode
from ..errors import EmhubMcpError, ErrorKind, invalid, not_found
from .models import (
    JobDetail,
    JobLogs,
    JobNode,
    JobState,
    LabelInfo,
    LogLine,
    LogStream,
    LogWindow,
    OutputFile,
    ProjectDetail,
    WaitResult,
)
from .projects import ProjectRef, folder_must_exist
from .shaping import clean_log, is_error_line, omitted_lines, take_window

TERMINAL = frozenset({"finished", "failed", "aborted"})
ACTIVE = frozenset({"scheduled", "launched", "running"})
PROBLEM = frozenset({"failed", "aborted"})

MAX_LOG_LINES = 500
LIST_CAP = 50  # failed, active and ready lists in a project overview
MAX_LOG_BYTES = 32_000
MAX_ERROR_LINES = 30
STREAM_FILES: dict[LogStream, str] = {
    "stdout": "run.out",
    "stderr": "run.err",
    "job_log": "job.log",
}

ProgressCallback = Callable[[int, int, str], Awaitable[None]]


def _status(node: WorkflowNode) -> str:
    return (node.status or "unknown").lower()


def _parents(node: WorkflowNode) -> list[str]:
    # EMhub lists a parent once per linked output; keep each job once.
    return list(dict.fromkeys(p for p in node.parents if p != "PROJECT"))


def _children(node: WorkflowNode) -> list[str]:
    return list(dict.fromkeys(node.children))


class JobService:
    def __init__(
        self,
        api: EmhubApi,
        *,
        sleep: Callable[[float], Awaitable[None]] = anyio.sleep,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        self._api = api
        self._sleep = sleep
        self._clock = clock

    async def _labels(self, ref: ProjectRef) -> tuple[dict[str, str], list[LabelInfo]]:
        """Label names by id and label summaries; empty if EMhub has no labels endpoint."""
        try:
            with folder_must_exist(ref):
                payload = await self._api.get_project_labels(ref.id)
        except EmhubMcpError as exc:
            if exc.kind is ErrorKind.UNSUPPORTED:
                return {}, []
            raise
        names = {label.id: label.name or label.id for label in payload.labels}
        counts = Counter(i for ids in payload.jobs.values() for i in ids)
        infos = [
            LabelInfo(name=names[label.id], color=label.color, jobs=counts.get(label.id, 0))
            for label in payload.labels
        ]
        return names, infos

    @staticmethod
    def _node(node: WorkflowNode, label_names: dict[str, str]) -> JobNode:
        return JobNode(
            id=node.id,
            type=node.type,
            status=_status(node),
            run_name=(node.run_name or "").strip() or None,
            parents=_parents(node),
            children=_children(node),
            elapsed_s=node.elapsed_time or None,
            labels=[label_names.get(t, t) for t in node.tags],
        )

    async def graph(self, ref: ProjectRef) -> dict[str, WorkflowNode]:
        with folder_must_exist(ref):
            return await self._api.get_workflow_graph(ref.id)

    async def status_counts(self, ref: ProjectRef) -> dict[str, int]:
        with folder_must_exist(ref):
            jobs = await self._api.get_job_statuses(ref.id)
        return dict(Counter((j.status or "unknown").lower() for j in jobs))

    async def project_detail(
        self,
        ref: ProjectRef,
        *,
        statuses: Collection[str] | None = None,
        job_types: Collection[str] | None = None,
        limit: int = 100,
    ) -> ProjectDetail:
        graph = await self.graph(ref)
        label_names, label_infos = await self._labels(ref)
        nodes = list(graph.values())
        counts = Counter(_status(n) for n in nodes)

        def finished(job_id: str) -> bool:
            parent = graph.get(job_id)
            return parent is not None and _status(parent) == "finished"

        ready = [
            n.id for n in nodes if _status(n) == "saved" and all(finished(p) for p in _parents(n))
        ]
        selected = [
            n
            for n in nodes
            if (not statuses or _status(n) in statuses) and (not job_types or n.type in job_types)
        ]
        shown = selected[:limit]
        return ProjectDetail(
            project=ref.summary,
            job_count=len(nodes),
            status_counts=dict(counts),
            failed=[n.id for n in nodes if _status(n) in PROBLEM][:LIST_CAP],
            active=[n.id for n in nodes if _status(n) in ACTIVE][:LIST_CAP],
            ready_to_run=ready[:LIST_CAP],
            labels=label_infos,
            jobs=[self._node(n, label_names) for n in shown],
            jobs_omitted=len(nodes) - len(shown),
        )

    async def require_job(
        self, ref: ProjectRef, job_id: str
    ) -> tuple[WorkflowNode, dict[str, WorkflowNode]]:
        graph = await self.graph(ref)
        node = graph.get(job_id)
        if node is None:
            close = difflib.get_close_matches(job_id, list(graph), n=3, cutoff=0.5)
            raise not_found(
                f"Job '{job_id}' in project {ref.id}",
                candidates=close,
                hint="Job ids look like 'WarpMctf/job002'; get_project lists them.",
            )
        return node, graph

    async def job_detail(
        self,
        ref: ProjectRef,
        job_id: str,
        *,
        include_empty_params: bool = False,
        log_tail_lines: int = 0,
    ) -> JobDetail:
        node, _ = await self.require_job(ref, job_id)
        # Logs are always read (EMhub caps them at 2000 lines) to spot failures that
        # did not change the job status.
        with folder_must_exist(ref):
            run = await self._api.get_run(ref.id, job_id, ["json", "stdout", "stderr"])
        label_names, _ = await self._labels(ref)
        run_json = run.run_json
        values = dict(run_json.values) if run_json else {}
        params = {k: v for k, v in values.items() if include_empty_params or not _empty(v)}

        windows: list[LogWindow] = []
        errors: list[LogLine] = []
        for stream in ("stdout", "stderr"):
            window, stream_errors = self._window(
                stream, job_id, _stream_text(run, stream), tail=max(log_tail_lines, 1)
            )
            if log_tail_lines:
                windows.append(window)
            errors.extend(stream_errors)

        output_files = self._outputs(node, run_json.outputs if run_json else [])
        return JobDetail(
            project_id=ref.id,
            id=node.id,
            type=node.type,
            status=_status(node),
            run_name=(node.run_name or "").strip() or None,
            comment=(node.comment or "").strip() or None,
            labels=[label_names.get(t, t) for t in node.tags],
            parents=_parents(node),
            children=_children(node),
            elapsed_s=node.elapsed_time or None,
            inputs=list(run_json.inputs) if run_json else [],
            outputs=output_files,
            params=params,
            empty_params_omitted=len(values) - len(params),
            logs=windows,
            error_lines=errors[-MAX_ERROR_LINES:],
            warnings=health_warnings(_status(node), run.stderr or "", errors, output_files),
        )

    @staticmethod
    def _outputs(node: WorkflowNode, run_outputs: Sequence[str]) -> list[OutputFile]:
        known: dict[str, bool | None] = {}
        for out in node.outputs:
            if out.value:
                known[out.value] = not (out.info or "").startswith(("File (Missing", "Missing"))
        for path in run_outputs:
            known.setdefault(path, None)
        return [OutputFile(path=p, exists=e) for p, e in known.items()]

    def _window(
        self,
        stream: LogStream,
        job_id: str,
        text: str,
        *,
        tail: int,
        contains: str | None = None,
    ) -> tuple[LogWindow, list[LogLine]]:
        lines = clean_log(text)
        errors = [
            LogLine(stream=stream, line=i + 1, text=line[:500])
            for i, line in enumerate(lines)
            if is_error_line(line)
        ]
        omitted = omitted_lines(lines)
        note = None
        if contains:
            needle = contains.lower()
            numbered = [(i, line) for i, line in enumerate(lines) if needle in line.lower()]
            lines = [f"{i + 1}: {line}" for i, line in numbered]
            note = f"Only lines containing '{contains}', prefixed with their line number."
        window = take_window(lines, tail=min(tail, MAX_LOG_LINES), max_bytes=MAX_LOG_BYTES)
        if omitted:
            extra = f"EMhub left out {omitted} lines in the middle of this log."
            note = f"{note} {extra}" if note else extra
        if not text:
            note = "The log is empty or does not exist yet."
        return (
            LogWindow(
                stream=stream,
                source=f"{job_id}/{STREAM_FILES[stream]}",
                text=window.text,
                first_line=window.first_line,
                total_lines=window.total_lines,
                truncated=window.truncated,
                note=note,
            ),
            errors[-MAX_ERROR_LINES:],
        )

    async def logs(
        self,
        ref: ProjectRef,
        job_id: str,
        *,
        streams: Sequence[LogStream],
        tail_lines: int,
        contains: str | None = None,
    ) -> JobLogs:
        node, _ = await self.require_job(ref, job_id)
        run_outputs = [s for s in streams if s in ("stdout", "stderr")]
        with folder_must_exist(ref):
            run = await self._api.get_run(ref.id, job_id, run_outputs) if run_outputs else None
        windows: list[LogWindow] = []
        errors: list[LogLine] = []
        for stream in streams:
            if stream == "job_log":
                text = await self._job_log(ref, job_id)
            else:
                assert run is not None
                text = _stream_text(run, stream)
            window, stream_errors = self._window(
                stream, job_id, text, tail=tail_lines, contains=contains
            )
            windows.append(window)
            errors.extend(stream_errors)
        stderr = (run.stderr or "") if run is not None else ""
        return JobLogs(
            project_id=ref.id,
            job_id=job_id,
            status=_status(node),
            logs=windows,
            error_lines=errors[-MAX_ERROR_LINES:],
            warnings=health_warnings(_status(node), stderr, errors, []),
        )

    async def _job_log(self, ref: ProjectRef, job_id: str) -> str:
        try:
            items = await self._api.list_dir(ref.root, job_id)
        except EmhubMcpError as exc:
            # The job folder does not exist until the job is first saved to disk.
            if exc.kind is ErrorKind.UPSTREAM_ERROR and "No such file" in exc.message:
                return ""
            raise
        if "job.log" not in {item.name for item in items}:
            return ""
        preview = await self._api.get_file_preview(ref.root, f"{job_id}/job.log")
        return preview.text or ""

    async def wait(
        self,
        ref: ProjectRef,
        job_ids: Sequence[str],
        *,
        mode: Literal["all", "any"],
        timeout_s: float,
        poll_s: float,
        progress: ProgressCallback | None = None,
    ) -> WaitResult:
        if not job_ids:
            raise invalid("Give at least one job id.")
        wanted = list(dict.fromkeys(job_ids))
        started = self._clock()
        states = await self._states(ref, wanted)

        def satisfied(current: dict[str, str]) -> bool:
            done = [current[j] in TERMINAL for j in wanted]
            return all(done) if mode == "all" else any(done)

        note = None
        timed_out = False
        while not satisfied(states):
            idle = [j for j in wanted if states[j] not in TERMINAL and states[j] not in ACTIVE]
            if idle and (mode == "all" or len(idle) == len(wanted)):
                note = (
                    f"Not waiting: {', '.join(idle)} is not scheduled or running "
                    f"(status {states[idle[0]]}), so it will not finish on its own."
                )
                break
            elapsed = self._clock() - started
            if elapsed >= timeout_s:
                timed_out = True
                note = "Timed out; the jobs keep running. Call wait_for_jobs again to keep waiting."
                break
            if progress is not None:
                finished = sum(states[j] in TERMINAL for j in wanted)
                summary = ", ".join(f"{j}: {states[j]}" for j in wanted[:5])
                await progress(finished, len(wanted), summary)
            await self._sleep(min(poll_s, timeout_s - elapsed))
            states = await self._states(ref, wanted)

        return WaitResult(
            project_id=ref.id,
            mode=mode,
            satisfied=satisfied(states),
            timed_out=timed_out,
            waited_s=round(self._clock() - started, 1),
            jobs=[JobState(id=j, status=states[j]) for j in wanted],
            note=note,
        )

    async def _states(self, ref: ProjectRef, wanted: Sequence[str]) -> dict[str, str]:
        with folder_must_exist(ref):
            statuses = await self._api.get_job_statuses(ref.id)
        jobs = {j.id: (j.status or "unknown").lower() for j in statuses}
        missing = [j for j in wanted if j not in jobs]
        if missing:
            close = difflib.get_close_matches(missing[0], list(jobs), n=3, cutoff=0.5)
            raise not_found(f"Job '{missing[0]}' in project {ref.id}", candidates=close)
        return {j: jobs[j] for j in wanted}


def health_warnings(
    status: str, stderr: str, errors: Sequence[LogLine], outputs: Sequence[OutputFile]
) -> list[str]:
    """Signs that a job marked finished did not fully succeed.

    emwrap marks a job finished even when a processing thread crashed, and its
    Warp jobs on purpose when some items (tilt series, movies) failed, so a
    Python traceback, error lines in the logs or a missing output deserve a warning.
    """
    if status != "finished":
        return []
    warnings = []
    if "Traceback (most recent call last)" in stderr:
        warnings.append(
            "The job is marked finished, but its stderr contains a Python traceback: part of "
            "the processing may have crashed and its outputs may be incomplete. Check "
            "get_job_logs (stderr)."
        )
    elif errors:
        warnings.append(
            f"The job is marked finished, but its logs have {len(errors)} error-like "
            f"line(s), e.g. {errors[0].stream} line {errors[0].line}: '{errors[0].text[:200]}'. "
            "Some items may have failed (Warp jobs list failed tilt series in "
            "failed_tilt_series.star)."
        )
    missing = [o.path for o in outputs if o.exists is False]
    if missing:
        warnings.append(
            f"The job is marked finished, but outputs are missing: {', '.join(missing)}."
        )
    return warnings


def _empty(value: object) -> bool:
    return value is None or (isinstance(value, (str, list, dict)) and len(value) == 0)


def _stream_text(run: RunPayload, stream: str) -> str:
    return (run.stdout if stream == "stdout" else run.stderr) or ""
