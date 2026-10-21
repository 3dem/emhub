# SPDX-License-Identifier: GPL-3.0-or-later
"""Resources: background guides, a project's job graph and job-type forms."""

# No "from __future__ import annotations": the SDK reads these annotations.
import json
from collections.abc import Callable
from importlib import resources as importlib_resources

from mcp.server.mcpserver import MCPServer

from ..errors import invalid
from ..services import Services
from .responses import guarded_resource
from .tools_read import _any_project

GUIDES = {
    "overview": ("EMhub-Tomo overview", "Projects, jobs and the usual tomography pipeline."),
    "jobs": ("Jobs, statuses and logs", "Job ids, statuses, and where to look when a job fails."),
    "queues-and-launchers": (
        "Queues and launchers",
        "How jobs reach programs and cluster queues; site set-up problems.",
    ),
    "apof-tutorial": ("The ApoF tutorial workflows", "What the tutorial templates do."),
}


def guide_text(topic: str) -> str:
    return (
        importlib_resources.files("emhub_tomo_mcp.server") / "guides" / f"{topic}.md"
    ).read_text(encoding="utf-8")


def _constant(text: str) -> Callable[[], str]:
    def read() -> str:
        return text

    return read


def register_resources(mcp: MCPServer, services: Services) -> None:
    for topic, (title, description) in GUIDES.items():
        mcp.resource(
            f"emhub-tomo://guides/{topic}",
            name=f"guide-{topic}",
            title=title,
            description=description,
            mime_type="text/markdown",
        )(_constant(guide_text(topic)))

    @mcp.resource(
        "emhub-tomo://projects/{project_id}/workflow",
        name="project-workflow",
        title="Project job graph",
        mime_type="application/json",
        description="Jobs of a project with type, status, parents and children (JSON).",
    )
    @guarded_resource
    async def project_workflow(project_id: str) -> str:
        if not project_id.isdigit():
            raise invalid("project_id must be a number.")
        ref = await services.projects.get(int(project_id))
        detail = await services.jobs.project_detail(ref, limit=10_000)
        return json.dumps(detail.model_dump(mode="json")["jobs"], separators=(",", ":"))

    @mcp.resource(
        "emhub-tomo://job-types/{job_type}/form",
        name="job-type-form",
        title="Job type form",
        mime_type="application/json",
        description="The complete EMhub form definition of a job type (JSON).",
    )
    @guarded_resource
    async def job_type_form(job_type: str) -> str:
        ref = await _any_project(services)
        form = await services.job_types.form(job_type, ref)
        return json.dumps(form, separators=(",", ":"))
