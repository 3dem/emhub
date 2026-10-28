#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-3.0-or-later
"""Run the ApoF Warp tutorial through a running EMhub-Tomo server.

Checks the path the MCP server relies on: EMhub launches each job, and emwrap
submits it to the cluster through a configured queue. The script creates a
new project, loads the apof-warp-tutorial-part1 workflow, sets the queue (and
the GPU count, where the job has one) on the selected jobs, schedules them,
and follows their status until all have finished or one fails.

    run_tutorial_via_emhub.py --instance INSTANCE_DIR --data DATA_DIR \
        --projects-dir DIR [--queue phys-a] [--gpus 3] [--jobs small|part1]

INSTANCE_DIR is a server started with scripts/dev_server.py. DATA_DIR is the
downloaded WarpApofTutorial dataset. Exit code 0 means every job finished.
"""

from __future__ import annotations

import argparse
import datetime as dt
import http.cookiejar
import json
import sys
import time
import urllib.request
from pathlib import Path
from typing import Any

WORKFLOW_ID = "apof-warp-tutorial-part1"
JOBS = {
    "small": ["emw-import-ts", "emw-warp-mctf", "emw-warp-tsalign", "emw-warp-ctfrec"],
    "part1": None,  # every job of the workflow
}
LOCAL_JOB_TYPES = {"emw-import-ts"}  # light enough for the server host
TERMINAL = {"finished", "failed", "aborted"}


class Api:
    """Minimal EMhub REST client (cookie session)."""

    def __init__(self, url: str) -> None:
        self.url = url
        self.opener = urllib.request.build_opener(
            urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar())
        )

    def __call__(self, method: str, attrs: dict[str, Any] | None = None, **body: Any) -> Any:
        if attrs is not None:
            body["attrs"] = attrs
        request = urllib.request.Request(
            f"{self.url}/api/{method}",
            data=json.dumps(body).encode(),
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        with self.opener.open(request, timeout=300) as resp:
            data = json.loads(resp.read())
        if isinstance(data, dict) and ("error" in data or "errors" in data):
            message = data.get("error") or data.get("errors")
            raise RuntimeError(f"{method}: {str(message)[:1000]}")
        return data


def log(message: str) -> None:
    print(f"{time.strftime('%H:%M:%S')} {message}", flush=True)


def create_project(api: Api, data_dir: Path, projects_dir: Path) -> int:
    users = api("get_users", attrs=["id", "username"])
    admin_id = next(u["id"] for u in users if u["username"] == "admin")
    container = next(
        (
            p
            for p in api("get_projects")
            if p.get("status") == "special:processing_tomo" and p.get("user_id") == admin_id
        ),
        None,
    )
    if container is None:
        container = api(
            "create_project",
            {
                "user_id": admin_id,
                "status": "special:processing_tomo",
                "user_can_edit": True,
                "is_confidential": False,
                "title": "Default Project for tomo_processing entries",
                "description": "",
            },
        )["project"]

    stamp = time.strftime("%Y%m%d_%H%M%S")
    processing_path = projects_dir / f"emhub_tutorial_{stamp}"
    entry = api(
        "create_entry",
        {
            "project_id": container["id"],
            "type": "tomo_processing",
            "title": f"ApoF tutorial via EMhub ({stamp})",
            "description": "",
            "date": dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
            "extra": {
                "data": {
                    "processing_path": str(processing_path),
                    "data_path": str(data_dir),
                    "share_table": [],
                }
            },
        },
    )["entry"]
    log(f"Project {entry['id']}: {processing_path}")
    return entry["id"]


def job_params(api: Api, sel: dict[str, Any], job_id: str) -> dict[str, Any]:
    run = api("get_session_run", {**sel, "run_id": job_id, "output": ["json"]})
    return run["run"]["json"]["values"]


def show_logs(api: Api, sel: dict[str, Any], job_id: str, lines: int = 30) -> None:
    run = api("get_session_run", {**sel, "run_id": job_id, "output": ["stdout", "stderr"]})["run"]
    for stream in ("stdout", "stderr"):
        tail = (run.get(stream) or "").splitlines()[-lines:]
        print(f"----- {job_id} {stream} (last {len(tail)} lines) -----")
        print("\n".join(tail))


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--instance", type=Path, required=True)
    parser.add_argument("--data", type=Path, required=True)
    parser.add_argument("--projects-dir", type=Path, required=True)
    parser.add_argument("--queue", default="phys-a")
    parser.add_argument("--gpus", default="3")
    parser.add_argument("--jobs", choices=sorted(JOBS), default="small")
    parser.add_argument("--interval", type=int, default=1, help="watcher interval (minutes)")
    parser.add_argument("--hours", type=float, default=12, help="give up after this long")
    parser.add_argument(
        "--tilt-series",
        metavar="NAME",
        help="import only this tilt series, e.g. TS_1 (smaller and faster)",
    )
    args = parser.parse_args()

    info = json.loads((args.instance / "dev_server.json").read_text())
    api = Api(info["url"])
    api(
        "login", username=info["username"], password=Path(info["password_file"]).read_text().strip()
    )

    entry_id = create_project(api, args.data.resolve(), args.projects_dir.resolve())
    sel = {"entry_id": entry_id}
    api("load_workflow", {**sel, "workflow_id": WORKFLOW_ID})
    jobs = api("get_session_workflow", {**sel, "widget": False})["workflow"]
    wanted = JOBS[args.jobs]
    selected = [(j["id"], j["type"]) for j in jobs if wanted is None or j["type"] in wanted]

    for job_id, job_type in selected:
        params: dict[str, Any] = {
            "queue.name": "None" if job_type in LOCAL_JOB_TYPES else args.queue
        }
        if "gpus" in job_params(api, sel, job_id) and job_type not in LOCAL_JOB_TYPES:
            params["gpus"] = args.gpus
        if job_type == "emw-import-ts" and args.tilt_series:
            params["mdoc_files"] = f"data/mdoc/{args.tilt_series}.mrc.mdoc"
        api("save_job", {**sel, "run_id": job_id, "params": params})
        api("schedule_job", {**sel, "run_id": job_id, "interval": args.interval})
        log(f"Scheduled {job_id} ({job_type}) {params}")

    ids = {job_id for job_id, _ in selected}
    last: dict[str, str] = {}
    deadline = time.time() + args.hours * 3600
    while time.time() < deadline:
        flat = api("get_session_workflow", {**sel, "widget": False})["workflow"]
        status = {j["id"]: j["status"] for j in flat if j["id"] in ids}
        for job_id, state in status.items():
            if last.get(job_id) != state:
                log(f"{job_id}: {state}")
        last = status
        failed = [job_id for job_id, state in status.items() if state in ("failed", "aborted")]
        if failed:
            for job_id in failed:
                show_logs(api, sel, job_id)
            pending = [job_id for job_id, state in status.items() if state not in TERMINAL]
            if pending:
                api("stop_jobs", {**sel, "run_ids": pending})
                log(f"Stopped the remaining jobs: {pending}")
            return 1
        if all(state == "finished" for state in status.values()):
            log(f"All {len(status)} jobs finished")
            return 0
        time.sleep(60)
    log("Timed out")
    return 2


if __name__ == "__main__":
    sys.exit(main())
