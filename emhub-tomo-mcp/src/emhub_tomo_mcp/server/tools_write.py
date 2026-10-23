# SPDX-License-Identifier: GPL-3.0-or-later
"""Tools that change projects (access levels 'operate' and 'admin').

They exist only when the server's access level allows them; the checks behind
them are in ``domain/operations.py``.
"""

# No "from __future__ import annotations": the SDK reads these annotations.
from typing import Annotated, Any

from mcp.server.mcpserver import MCPServer
from mcp.types import CallToolResult, ToolAnnotations
from pydantic import Field

from ..domain.models import ChangeResult
from ..services import Services
from .responses import guarded_tool, respond
from .tools_read import JobId, JobTypeId, ProjectId

CHANGE = ToolAnnotations(
    read_only_hint=False, destructive_hint=False, idempotent_hint=False, open_world_hint=False
)
IDEMPOTENT_CHANGE = ToolAnnotations(
    read_only_hint=False, destructive_hint=False, idempotent_hint=True, open_world_hint=False
)
DESTRUCTIVE = ToolAnnotations(
    read_only_hint=False, destructive_hint=True, idempotent_hint=False, open_world_hint=False
)

JobIds = Annotated[list[JobId], Field(min_length=1, max_length=50)]
DryRun = Annotated[bool, Field(description="Only check and report what would be done.")]
Params = Annotated[
    dict[str, Any],
    Field(
        max_length=200,
        description="Parameter names and values, e.g. {'gpus': '3', 'queue.name': 'phys-a'}; "
        "describe_job_type lists them.",
    ),
]


def _summary(result: ChangeResult) -> str:
    lead = "Dry run" if result.dry_run else "Done"
    parts = [f"{lead}: {result.action}"]
    if result.project_id is not None:
        parts.append(f"project {result.project_id}")
    if result.created:
        parts.append("created " + ", ".join(result.created[:10]))
    if result.jobs:
        parts.append("; ".join(f"{j.id}: {j.status}" for j in result.jobs[:10]))
    text = "; ".join(parts) + "."
    if result.warnings:
        text += " Note: " + " ".join(result.warnings)
    return text


def register_write_tools(mcp: MCPServer, services: Services) -> None:
    projects = services.projects
    ops = services.operations

    @mcp.tool(title="Create a project", annotations=CHANGE)
    @guarded_tool
    async def create_project(
        title: Annotated[str, Field(min_length=1, max_length=200)],
        processing_path: Annotated[
            str,
            Field(
                max_length=1024,
                description="Absolute path of the project folder. EMhub creates it "
                "(its parent must exist), or registers it if it already holds a project.",
            ),
        ],
        data_path: Annotated[
            str,
            Field(
                max_length=1024,
                description="Absolute path of the raw data folder (frames, mdoc "
                "files, gain); linked as 'data/' inside the project.",
            ),
        ],
        description: Annotated[str, Field(max_length=2000)] = "",
        dry_run: DryRun = False,
    ) -> Annotated[CallToolResult, ChangeResult]:
        """Create a new tomography processing project in EMhub. Both folders must be inside
        the folders this server may use. Only do this when the user asks for a new project."""
        result = await ops.create_project(
            title=title,
            processing_path=processing_path,
            data_path=data_path,
            description=description,
            dry_run=dry_run,
        )
        return respond(result, _summary(result))

    @mcp.tool(title="Load a workflow template", annotations=CHANGE)
    @guarded_tool
    async def load_workflow_template(
        project_id: ProjectId,
        workflow_id: Annotated[
            str,
            Field(
                pattern=r"^[A-Za-z0-9_.\-]+$",
                max_length=100,
                description="Template id, from list_workflow_templates.",
            ),
        ],
        allow_duplicate: Annotated[
            bool,
            Field(description="Load it although the project already has jobs of all its types."),
        ] = False,
        dry_run: DryRun = False,
    ) -> Annotated[CallToolResult, ChangeResult]:
        """Add a workflow template's jobs to a project, as saved (not running) jobs linked to
        each other. Returns the new job ids. Nothing runs until run_job or schedule_jobs."""
        ref = await projects.get(project_id)
        result = await ops.load_template(
            ref, workflow_id, allow_duplicate=allow_duplicate, dry_run=dry_run
        )
        return respond(result, _summary(result))

    @mcp.tool(title="Save job parameters", annotations=IDEMPOTENT_CHANGE)
    @guarded_tool
    async def save_job(
        project_id: ProjectId,
        params: Params,
        job_id: Annotated[JobId | None, Field(description="Existing job to edit.")] = None,
        job_type: Annotated[
            JobTypeId | None, Field(description="Type of a new job to create.")
        ] = None,
        allow_unknown: Annotated[
            bool, Field(description="Accept parameter names the job type's form does not list.")
        ] = False,
        dry_run: DryRun = False,
    ) -> Annotated[CallToolResult, ChangeResult]:
        """Change parameters of a saved, failed or aborted job (only the given parameters
        change), or create a new job of a type. Parameters are checked against the job
        type's form and by EMhub before anything is saved. Running and finished jobs cannot
        be edited."""
        ref = await projects.get(project_id)
        result = await ops.save_job(
            ref,
            job_id=job_id,
            job_type=job_type,
            params=params,
            allow_unknown=allow_unknown,
            dry_run=dry_run,
        )
        return respond(result, _summary(result))

    @mcp.tool(title="Run a job", annotations=DESTRUCTIVE)
    @guarded_tool
    async def run_job(
        project_id: ProjectId,
        job_id: JobId,
        params: Annotated[
            dict[str, Any],
            Field(max_length=200, description="Parameters to change before running."),
        ] = {},  # noqa: B006
        rerun: Annotated[
            bool, Field(description="Allow running a finished job again (overwrites its results).")
        ] = False,
        clean: Annotated[
            bool, Field(description="Move the job's folder to .Trash first (admin access only).")
        ] = False,
        dry_run: DryRun = False,
    ) -> Annotated[CallToolResult, ChangeResult]:
        """Launch a job now. GPU jobs go to a cluster queue (the default queue if the job names
        none); limits on GPUs and launches apply. Returns right away: use wait_for_jobs or
        get_project to follow it. Only run jobs the user asked to run; use dry_run=true to show
        the queue and GPUs first."""
        ref = await projects.get(project_id)
        result = await ops.run_job(
            ref, job_id, params=params, rerun=rerun, clean=clean, dry_run=dry_run
        )
        return respond(result, _summary(result))

    @mcp.tool(title="Schedule jobs", annotations=CHANGE)
    @guarded_tool
    async def schedule_jobs(
        project_id: ProjectId,
        job_ids: JobIds,
        interval_minutes: Annotated[
            int,
            Field(
                ge=1, le=60, description="How often each job checks whether its parents finished."
            ),
        ] = 5,
        rerun: Annotated[bool, Field(description="Allow scheduling finished jobs again.")] = False,
        dry_run: DryRun = False,
    ) -> Annotated[CallToolResult, ChangeResult]:
        """Schedule saved jobs: each starts by itself once its parent jobs have finished, so a
        whole pipeline can be scheduled at once. The same queue, GPU and launch limits apply
        as for run_job. Stop scheduled jobs with stop_jobs."""
        ref = await projects.get(project_id)
        result = await ops.schedule_jobs(
            ref, job_ids, interval_minutes=interval_minutes, rerun=rerun, dry_run=dry_run
        )
        return respond(result, _summary(result))

    @mcp.tool(title="Stop jobs", annotations=DESTRUCTIVE)
    @guarded_tool
    async def stop_jobs(
        project_id: ProjectId, job_ids: JobIds
    ) -> Annotated[CallToolResult, ChangeResult]:
        """Stop scheduled, launched or running jobs: scheduled jobs go back to saved; launched
        and running jobs are aborted (cluster jobs are cancelled). Only on the user's request."""
        ref = await projects.get(project_id)
        result = await ops.stop_jobs(ref, job_ids)
        return respond(result, _summary(result))

    @mcp.tool(title="Annotate a job", annotations=IDEMPOTENT_CHANGE)
    @guarded_tool
    async def annotate_job(
        project_id: ProjectId,
        job_id: JobId,
        run_name: Annotated[str | None, Field(max_length=200)] = None,
        comment: Annotated[str | None, Field(max_length=4000)] = None,
    ) -> Annotated[CallToolResult, ChangeResult]:
        """Set a job's run name and/or comment (shown in EMhub)."""
        ref = await projects.get(project_id)
        result = await ops.annotate_job(ref, job_id, run_name=run_name, comment=comment)
        return respond(result, _summary(result))

    @mcp.tool(title="Label jobs", annotations=IDEMPOTENT_CHANGE)
    @guarded_tool
    async def tag_jobs(
        project_id: ProjectId,
        job_ids: JobIds,
        add: Annotated[
            list[str],
            Field(max_length=10, description="Label names to add; missing labels are created."),
        ] = [],  # noqa: B006
        remove: Annotated[list[str], Field(max_length=10)] = [],  # noqa: B006
    ) -> Annotated[CallToolResult, ChangeResult]:
        """Add or remove labels on jobs, by label name."""
        ref = await projects.get(project_id)
        result = await ops.tag_jobs(ref, job_ids, add=add, remove=remove)
        return respond(result, _summary(result))

    @mcp.tool(title="Copy jobs", annotations=CHANGE)
    @guarded_tool
    async def duplicate_jobs(
        project_id: ProjectId, job_ids: JobIds
    ) -> Annotated[CallToolResult, ChangeResult]:
        """Copy jobs as new saved jobs with the same parameters; links among the copied jobs
        point at the copies. Use it to try different parameters without touching the
        original, or to re-run a finished job's settings."""
        ref = await projects.get(project_id)
        result = await ops.duplicate_jobs(ref, job_ids)
        return respond(result, _summary(result))

    @mcp.tool(title="Export jobs as a workflow", annotations=CHANGE)
    @guarded_tool
    async def export_workflow(
        project_id: ProjectId,
        job_ids: JobIds,
        file_name: Annotated[
            str,
            Field(
                max_length=105,
                description="A file name ending in .json, written in the project folder.",
            ),
        ],
        overwrite: bool = False,
    ) -> Annotated[CallToolResult, ChangeResult]:
        """Write the given jobs and their parameters as a workflow JSON file in the project
        folder, e.g. to reuse a tuned pipeline."""
        ref = await projects.get(project_id)
        result = await ops.export_workflow(ref, job_ids, file_name=file_name, overwrite=overwrite)
        return respond(result, _summary(result))

    if services.settings.access == "admin":

        @mcp.tool(title="Delete jobs", annotations=DESTRUCTIVE)
        @guarded_tool
        async def delete_jobs(
            project_id: ProjectId, job_ids: JobIds, dry_run: DryRun = False
        ) -> Annotated[CallToolResult, ChangeResult]:
            """Delete jobs: their folders move to the project's .Trash folder and they leave
            the pipeline. Running jobs and jobs whose outputs other jobs use are refused.
            Only on the user's explicit request."""
            ref = await projects.get(project_id)
            result = await ops.delete_jobs(ref, job_ids, dry_run=dry_run)
            return respond(result, _summary(result))
