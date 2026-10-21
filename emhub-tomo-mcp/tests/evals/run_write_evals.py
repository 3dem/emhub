#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-3.0-or-later
"""Agentic evals with write access, on a throw-away EMhub whose programs are stubs.

A fresh EMhub instance is created for the run, with tiny test data and stub
launchers for every external program (the import itself runs, on the tiny
data), so nothing real is computed and no GPU is used. Each scenario gets its
own project, prepared through this server at access level 'admin' (``setup``).
Claude Code then acts through a second server with access 'operate', no
default queue and no GPU jobs on the EMhub host, and only that server's tools.

Besides the answer checks of run_evals.py (``must``, ``must_not``,
``max_calls``), a scenario checks the state afterwards:

- ``audit_done``: actions that must have been carried out (audit log);
- ``audit_not_done``: actions that must not have been carried out (dry runs and
  refusals are fine);
- ``audit_never``: actions that must not even have been attempted, dry runs included;
- ``saved_except``: every job must still be 'saved' except jobs of these types;
- ``status``: job type -> regular expression for the status of its jobs;
- ``params``: job type -> {parameter: regular expression for its value};
- ``labels``: job type -> labels its jobs must carry;
- ``project_path``: a project with this folder must exist (it is then checked).

``setup`` may hold ``template`` (load the ApoF tutorial, part 1), ``save``
(job type -> parameters), ``comment`` (job type -> comment) and ``duplicate``
(job types to copy). Prompts can use {project}, {root}, {data} and {run}
(the attempt number, for names that must be new).

    EMHUB_TOMO_HOME=... python tests/evals/run_write_evals.py \
        --workdir DIR [--only NAME ...] [--repeat 3] [--out FILE]

Needs the ``claude`` CLI; costs API usage (the report lists the cost).
"""

from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import sys
import time
from pathlib import Path
from typing import Any

import anyio

HERE = Path(__file__).resolve().parent
sys.path[:0] = [str(HERE), str(HERE.parent / "support")]

from emhub_instance import EmhubInstance, emhub_instance  # noqa: E402
from mcp import Client  # noqa: E402
from run_evals import grade, run_claude  # noqa: E402
from site_helpers import FRAMES, MDOC, make_test_site, set_stub_mode, tiny_tiff  # noqa: E402

from emhub_tomo_mcp.config import load_settings  # noqa: E402
from emhub_tomo_mcp.server import build_server  # noqa: E402
from emhub_tomo_mcp.services import Services  # noqa: E402

TEMPLATE = "apof-warp-tutorial-part1"
SERVER = Path(sys.executable).with_name("emhub-tomo-mcp")


def prepare_data(root: Path) -> None:
    data = root / "data"
    (data / "mdoc").mkdir(parents=True)
    (data / "frames").mkdir()
    mdoc = data / "mdoc" / MDOC.name
    shutil.copy(MDOC, mdoc)
    old = time.time() - 600  # import takes mdoc files unchanged for a minute
    os.utime(mdoc, (old, old))
    for frame in FRAMES:
        (data / "frames" / frame).write_bytes(tiny_tiff())
    (data / "gain_ref.mrc").write_bytes(b"")
    (root / "projects").mkdir()


def write_mcp_config(inst: EmhubInstance, root: Path) -> Path:
    password_file = root / "eval_password"
    password_file.touch(mode=0o600)
    password_file.write_text(inst.password + "\n")
    env = {
        "EMHUB_SERVER_URL": inst.url,
        "EMHUB_TOMO_MCP_AUTH": "password",
        "EMHUB_USER": "admin",
        "EMHUB_PASSWORD_FILE": str(password_file),
        "EMHUB_TOMO_MCP_ACCESS": "operate",
        "EMHUB_TOMO_MCP_ALLOWED_ROOTS": str(root),
        "EMHUB_TOMO_MCP_STATE_DIR": str(root / "state-eval"),
    }
    config = root / "mcp.json"
    config.write_text(
        json.dumps({"mcpServers": {"emhub-tomo": {"command": str(SERVER), "env": env}}}, indent=2)
    )
    return config


class Admin:
    """This server at access level 'admin', in process: prepares and inspects projects."""

    def __init__(self, inst: EmhubInstance, root: Path) -> None:
        settings = load_settings(
            {
                "EMHUB_SERVER_URL": inst.url,
                "EMHUB_TOMO_MCP_AUTH": "password",
                "EMHUB_USER": "admin",
                "EMHUB_PASSWORD": inst.password,
                "EMHUB_TOMO_MCP_ACCESS": "admin",
                "EMHUB_TOMO_MCP_ALLOWED_ROOTS": str(root),
                "EMHUB_TOMO_MCP_STATE_DIR": str(root / "state-setup"),
                "EMHUB_TOMO_MCP_CACHE_TTL": "0.01",  # sees projects the eval just created
            }
        ).settings
        self.client = Client(build_server(Services.create(settings)))
        self.root = root

    async def call(self, tool: str, **args: Any) -> dict[str, Any]:
        result = await self.client.call_tool(tool, args)
        text = "".join(getattr(c, "text", "") for c in result.content)
        if result.is_error or result.structured_content is None:
            raise RuntimeError(f"{tool}: {text}")
        return result.structured_content

    async def jobs_by_type(self, pid: int) -> dict[str, list[dict[str, Any]]]:
        detail = await self.call("get_project", project_id=pid, limit=200)
        by_type: dict[str, list[dict[str, Any]]] = {}
        for job in detail["jobs"]:
            by_type.setdefault(job["type"], []).append(job)
        return by_type

    async def setup(self, name: str, spec: dict[str, Any]) -> int | None:
        if not spec:
            return None
        created = await self.call(
            "create_project",
            title=name,
            processing_path=str(self.root / "projects" / name),
            data_path=str(self.root / "data"),
        )
        pid = int(created["project_id"])
        if spec.get("template"):
            await self.call("load_workflow_template", project_id=pid, workflow_id=TEMPLATE)
        jobs = await self.jobs_by_type(pid)
        for job_type, params in spec.get("save", {}).items():
            await self.call(
                "save_job", project_id=pid, job_id=jobs[job_type][0]["id"], params=params
            )
        for job_type, comment in spec.get("comment", {}).items():
            await self.call(
                "annotate_job", project_id=pid, job_id=jobs[job_type][0]["id"], comment=comment
            )
        for job_type in spec.get("duplicate", []):
            await self.call("duplicate_jobs", project_id=pid, job_ids=[jobs[job_type][0]["id"]])
        return pid

    async def find_project(self, path: str) -> int | None:
        listed = await self.call("list_projects", scope="all", limit=200)
        for project in listed["projects"]:
            if Path(project["processing_path"]) == Path(path):
                return int(project["id"])
        return None

    async def check_state(
        self, scenario: dict[str, Any], pid: int | None, audit: list[dict[str, Any]], fill: Any
    ) -> list[str]:
        problems = []
        done = {a["action"] for a in audit if a.get("outcome") == "done"}
        attempted = {a["action"] for a in audit}
        problems += [f"not done: {a}" for a in scenario.get("audit_done", []) if a not in done]
        problems += [f"done: {a}" for a in scenario.get("audit_not_done", []) if a in done]
        problems += [f"attempted: {a}" for a in scenario.get("audit_never", []) if a in attempted]
        if "project_path" in scenario:
            pid = await self.find_project(fill(scenario["project_path"]))
            if pid is None:
                return [*problems, "project not created"]
        if pid is None:
            return problems
        jobs = await self.jobs_by_type(pid)
        if "saved_except" in scenario:
            allowed = set(scenario["saved_except"])
            for job_type, group in jobs.items():
                if job_type not in allowed:
                    problems += [
                        f"{j['id']} is {j['status']}" for j in group if j["status"] != "saved"
                    ]
        for job_type, pattern in scenario.get("status", {}).items():
            for job in jobs.get(job_type, [{"id": job_type, "status": "missing"}]):
                if not re.fullmatch(pattern, job["status"]):
                    problems.append(f"{job['id']} is {job['status']}, expected /{pattern}/")
        for job_type, expected in scenario.get("params", {}).items():
            job = await self.call("get_job", project_id=pid, job_id=jobs[job_type][0]["id"])
            for name, pattern in expected.items():
                value = str(job["params"].get(name, ""))
                if not re.fullmatch(pattern, value):
                    problems.append(f"{job['id']} {name}={value!r}, expected /{pattern}/")
        for job_type, labels in scenario.get("labels", {}).items():
            for job in jobs.get(job_type, []):
                missing = set(labels) - set(job.get("labels", []))
                if missing:
                    problems.append(f"{job['id']} lacks labels {sorted(missing)}")
        return problems


def audit_size(path: Path) -> int:
    return path.stat().st_size if path.exists() else 0


def read_audit(path: Path, offset: int) -> list[dict[str, Any]]:
    if not path.exists():
        return []
    with path.open() as f:
        f.seek(offset)
        return [json.loads(line) for line in f if line.strip()]


async def run_one(
    args: argparse.Namespace,
    scenario: dict[str, Any],
    attempt: int,
    admin: Admin,
    config: Path,
    audit_file: Path,
) -> dict[str, Any]:
    started = time.monotonic()
    name = scenario["name"]
    root = admin.root
    pid = await admin.setup(f"{name}-{attempt}", scenario.get("setup", {}))

    def fill(text: str) -> str:
        return text.format(project=pid, root=root, data=root / "data", run=attempt)

    offset = await anyio.to_thread.run_sync(audit_size, audit_file)
    events, stderr = await anyio.to_thread.run_sync(
        run_claude, fill(scenario["prompt"]), config, args.max_turns, args.timeout
    )
    outcome = grade(scenario, events, stderr)
    audit = await anyio.to_thread.run_sync(read_audit, audit_file, offset)
    outcome["problems"] += await admin.check_state(scenario, pid, audit, fill)
    outcome["passed"] = not outcome["problems"]
    outcome["attempt"] = attempt
    outcome["audit"] = [f"{a['action']}:{a.get('outcome')}" for a in audit]
    mark = "PASS" if outcome["passed"] else "FAIL"
    print(
        f"{mark} {name:24} #{attempt} calls={outcome['tool_calls']:3} "
        f"errors={outcome['tool_errors']:2} ${outcome['cost_usd']:.2f} "
        f"{time.monotonic() - started:5.0f}s  {'; '.join(outcome['problems'])}",
        flush=True,
    )
    if args.out:
        with args.out.open("a") as f:
            f.write(json.dumps(outcome) + "\n")
    return outcome


async def run_scenarios(
    args: argparse.Namespace, scenarios: list[dict[str, Any]], inst: EmhubInstance, config: Path
) -> list[dict[str, Any]]:
    root = inst.root
    audit_file = root / "state-eval" / "audit.jsonl"
    admin = Admin(inst, root)
    results = []
    async with admin.client:
        for attempt in range(1, args.repeat + 1):
            for scenario in scenarios:
                results.append(await run_one(args, scenario, attempt, admin, config, audit_file))
    return results


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--scenarios", type=Path, default=HERE / "write_scenarios.json")
    parser.add_argument("--workdir", type=Path, required=True)
    parser.add_argument("--only", nargs="*")
    parser.add_argument("--repeat", type=int, default=1, help="runs of each scenario")
    parser.add_argument("--max-turns", type=int, default=30)
    parser.add_argument("--timeout", type=int, default=900)
    parser.add_argument("--keep", action="store_true", help="keep the EMhub instance folder")
    parser.add_argument("--out", type=Path)
    args = parser.parse_args()
    if not os.environ.get("EMHUB_TOMO_HOME"):
        parser.error("EMHUB_TOMO_HOME is not set (the EMhub-Tomo installation)")
    scenarios = json.loads(args.scenarios.read_text())
    if args.only:
        scenarios = [s for s in scenarios if s["name"] in args.only]

    workdir = args.workdir.resolve()
    workdir.mkdir(parents=True, exist_ok=True)
    site = make_test_site(
        workdir / f"site-{os.getpid()}", Path(os.environ["EMHUB_TOMO_HOME"]).resolve()
    )
    set_stub_mode(site, "ok")
    try:
        with emhub_instance(home=site, workdir=workdir, keep=args.keep) as inst:
            prepare_data(inst.root)
            config = write_mcp_config(inst, inst.root)
            results = anyio.run(run_scenarios, args, scenarios, inst, config)
            if args.keep:
                print(f"Kept the instance in {inst.root}")
    finally:
        shutil.rmtree(site, ignore_errors=True)
    passed = sum(r["passed"] for r in results)
    cost = sum(r["cost_usd"] for r in results)
    print(f"\n{passed}/{len(results)} passed; total cost ${cost:.2f}")
    return 0 if passed == len(results) else 1


if __name__ == "__main__":
    sys.exit(main())
