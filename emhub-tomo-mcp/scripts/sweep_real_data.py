#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-3.0-or-later
"""Exercise every read tool against the projects of a real EMhub server.

Calls the tools through an in-memory MCP client, for every visible project
(or the ones given), every job, and the files of every job folder, then
reports errors, response sizes and latencies. Everything is read-only.

    EMHUB_SERVER_URL=... [EMHUB_USER=... EMHUB_PASSWORD_FILE=...] \
        python scripts/sweep_real_data.py [--projects 2 3] [--max-files 40] [--previews 2]

Exit code 1 if any call failed unexpectedly or broke a size budget.
"""

from __future__ import annotations

import argparse
import json
import statistics
import sys
import time
from collections import defaultdict
from typing import Any

import anyio
from mcp import Client

from emhub_tomo_mcp.config import load_settings
from emhub_tomo_mcp.server import build_server
from emhub_tomo_mcp.services import Services

TEXT_BUDGET = 64_000  # characters of text content per call (about 16k tokens)


class Sweep:
    def __init__(self, client: Client) -> None:
        self.client = client
        self.latency: dict[str, list[float]] = defaultdict(list)
        self.sizes: dict[str, list[int]] = defaultdict(list)
        self.failures: list[str] = []
        self.expected_errors: list[str] = []
        self.calls = 0

    async def call(
        self, tool: str, expect_error: bool = False, **args: Any
    ) -> dict[str, Any] | None:
        started = time.monotonic()
        result = await self.client.call_tool(tool, args)
        elapsed = time.monotonic() - started
        self.calls += 1
        self.latency[tool].append(elapsed)
        text = "".join(getattr(c, "text", "") for c in result.content)
        self.sizes[tool].append(len(text))
        label = f"{tool}({json.dumps(args)[:120]})"
        if result.is_error:
            target = self.expected_errors if expect_error else self.failures
            target.append(f"{label}: {text[:300]}")
            return None
        if expect_error:
            self.failures.append(f"{label}: expected an error, got success")
        if len(text) > TEXT_BUDGET:
            self.failures.append(f"{label}: {len(text)} characters (budget {TEXT_BUDGET})")
        if "Traceback (most recent call last)" in text and tool not in (
            "get_job",
            "get_job_logs",
            "read_project_file",
        ):
            self.failures.append(f"{label}: traceback text in a non-log tool")
        return result.structured_content

    def report(self) -> int:
        print(f"\n{self.calls} calls")
        print(f"{'tool':26} {'calls':>5} {'p50 s':>7} {'p95 s':>7} {'max s':>7} {'max chars':>10}")
        for tool in sorted(self.latency):
            lat = sorted(self.latency[tool])
            p95 = lat[min(len(lat) - 1, int(0.95 * len(lat)))]
            print(
                f"{tool:26} {len(lat):5} {statistics.median(lat):7.2f} {p95:7.2f} "
                f"{lat[-1]:7.2f} {max(self.sizes[tool]):10}"
            )
        print(f"\nExpected errors: {len(self.expected_errors)}")
        for line in self.expected_errors[:10]:
            print("  " + line)
        print(f"Failures: {len(self.failures)}")
        for line in self.failures:
            print("  " + line)
        return 1 if self.failures else 0


async def sweep_project(s: Sweep, project_id: int, max_files: int, previews: int) -> None:
    detail = await s.call("get_project", project_id=project_id)
    if detail is None:
        return
    print(f"project {project_id}: {detail['job_count']} jobs, {detail['status_counts']}")
    await s.call("list_projects", search=str(project_id), include_job_counts=True)
    for job in detail["jobs"]:
        job_id = job["id"]
        await s.call("get_job", project_id=project_id, job_id=job_id, log_tail_lines=50)
        await s.call(
            "get_job_logs",
            project_id=project_id,
            job_id=job_id,
            streams=["stdout", "stderr", "job_log"],
            tail_lines=500,
        )
        await s.call("get_job_logs", project_id=project_id, job_id=job_id, contains="error")
        listing = await s.call("list_project_files", project_id=project_id, path=job_id)
        if listing is None:
            continue
        files = [e for e in listing["entries"] if e["kind"] == "text"][:max_files]
        for entry in files:
            await s.call("read_project_file", project_id=project_id, path=entry["path"])
            await s.call(
                "read_project_file", project_id=project_id, path=entry["path"], tail_lines=20
            )
    # Image previews of a few MRC files (tomograms are large, so only a few).
    if previews:
        mrcs: list[str] = []
        for job in detail["jobs"]:
            if job["type"] == "emw-warp-ctfrec" and job["status"] == "finished":
                rec = await s.call(
                    "list_project_files",
                    project_id=project_id,
                    path=f"{job['id']}/warp_tiltseries/reconstruction",
                    pattern="*.mrc",
                )
                if rec:
                    mrcs += [e["path"] for e in rec["entries"]]
        for path in mrcs[:previews]:
            await s.call("read_project_file", project_id=project_id, path=path, as_image=True)
    # Edge cases that must fail cleanly.
    for path in ("../x", "/etc/passwd", "data/../../etc/passwd", "~/.ssh/id_rsa"):
        await s.call("read_project_file", expect_error=True, project_id=project_id, path=path)
    await s.call("get_job", expect_error=True, project_id=project_id, job_id="Nope/job999")


async def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--projects", type=int, nargs="*")
    parser.add_argument("--max-files", type=int, default=40)
    parser.add_argument("--previews", type=int, default=2)
    args = parser.parse_args()

    loaded = load_settings()
    async with Client(build_server(Services.create(loaded.settings))) as client:
        s = Sweep(client)
        status = await s.call("get_server_status")
        if not status or status["error"]:
            print(f"EMhub problem: {status}")
            return 1
        listing = await s.call("list_projects", scope="all", limit=200)
        assert listing is not None
        ids = args.projects or [p["id"] for p in listing["projects"]]
        await s.call("list_job_types", include_hidden=True)
        registry = await s.call("list_job_types", include_hidden=True)
        for job_type in (registry or {}).get("job_types", []):
            await s.call(
                "describe_job_type",
                job_type=job_type["id"],
                detail="full",
                expect_error=job_type["id"] == "emw-pytme",
            )
        await s.call("list_workflow_templates")
        for project_id in ids:
            await sweep_project(s, project_id, args.max_files, args.previews)
        await s.call("get_project", expect_error=True, project_id=999_999)
        return s.report()


if __name__ == "__main__":
    sys.exit(anyio.run(main))
