# SPDX-License-Identifier: GPL-3.0-or-later
"""Live test: preprocessing of one ApoF tilt series, driven only through the MCP
tools, on a real EMhub-Tomo with real programs on a cluster queue.

Opt-in, and it uses GPUs. Set:

    EMHUB_TOMO_MCP_LIVE=1
    EMHUB_SERVER_URL, EMHUB_USER, EMHUB_PASSWORD_FILE   the EMhub-Tomo server to use
    LIVE_DATA=/path/to/WarpApofTutorial                  the downloaded test data
    LIVE_ROOT=/path/for/test/projects                    where the project is created
    LIVE_QUEUE=phys-a                                    a cluster queue of the server
    [LIVE_GPUS=3] [LIVE_TILT_SERIES=TS_1]

The project is kept for inspection (about 6 GB for one tilt series).
"""

from __future__ import annotations

import os
import time
from typing import Any

import pytest
from mcp import Client

from emhub_tomo_mcp.config import load_settings
from emhub_tomo_mcp.server import build_server
from emhub_tomo_mcp.services import Services

pytestmark = pytest.mark.skipif(
    os.environ.get("EMHUB_TOMO_MCP_LIVE") != "1",
    reason="live test: set EMHUB_TOMO_MCP_LIVE=1 (uses GPUs)",
)


async def call(client: Client, tool: str, **args: Any) -> dict[str, Any]:
    result = await client.call_tool(tool, args)
    text = "".join(getattr(c, "text", "") for c in result.content)
    assert not result.is_error, text
    print(text.split("\n", 1)[0], flush=True)
    assert result.structured_content is not None
    return result.structured_content


@pytest.mark.anyio
async def test_preprocessing_on_the_cluster() -> None:
    data, root, queue = (os.environ[k] for k in ("LIVE_DATA", "LIVE_ROOT", "LIVE_QUEUE"))
    gpus = os.environ.get("LIVE_GPUS", "3")
    tilt_series = os.environ.get("LIVE_TILT_SERIES", "TS_1")
    env = {
        **os.environ,
        "EMHUB_TOMO_MCP_ACCESS": "operate",
        "EMHUB_TOMO_MCP_ALLOWED_ROOTS": f"{root}:{data}",
        "EMHUB_TOMO_MCP_DEFAULT_QUEUE": queue,
        "EMHUB_TOMO_MCP_MAX_GPUS_PER_JOB": gpus,
    }
    settings = load_settings(env).settings
    async with Client(build_server(Services.create(settings))) as client:
        name = time.strftime("mcp_live_%Y%m%d_%H%M%S")
        created = await call(
            client,
            "create_project",
            title=f"MCP live test {name}",
            processing_path=f"{root}/{name}",
            data_path=data,
        )
        pid = created["project_id"]
        loaded = await call(
            client, "load_workflow_template", project_id=pid, workflow_id="apof-warp-tutorial-part1"
        )
        types = {}
        for job_id in loaded["created"]:
            job = await call(client, "get_job", project_id=pid, job_id=job_id)
            types[job["type"]] = job_id
        imp = types["emw-import-ts"]
        chain = [imp, types["emw-warp-mctf"], types["emw-warp-tsalign"], types["emw-warp-ctfrec"]]
        await call(
            client,
            "save_job",
            project_id=pid,
            job_id=imp,
            params={"mdoc_files": f"data/mdoc/{tilt_series}.mrc.mdoc"},
        )
        for job_id in chain[1:]:
            await call(client, "save_job", project_id=pid, job_id=job_id, params={"gpus": gpus})
        plan = await call(client, "schedule_jobs", project_id=pid, job_ids=chain, dry_run=True)
        assert any(f"default queue '{queue}'" in w for w in plan["warnings"])
        await call(client, "schedule_jobs", project_id=pid, job_ids=chain, interval_minutes=1)
        deadline = time.monotonic() + 3 * 3600
        while True:
            done = await call(
                client,
                "wait_for_jobs",
                project_id=pid,
                job_ids=chain,
                timeout_s=600,
                poll_interval_s=30,
            )
            if done["satisfied"] or time.monotonic() > deadline:
                break
        states = {j["id"]: j["status"] for j in done["jobs"]}
        assert all(s == "finished" for s in states.values()), states
        for job_id in chain:
            job = await call(client, "get_job", project_id=pid, job_id=job_id)
            assert job["warnings"] == [], (job_id, job["warnings"])
        rec = await call(
            client,
            "list_project_files",
            project_id=pid,
            path=f"{types['emw-warp-ctfrec']}/warp_tiltseries/reconstruction",
            pattern="*.mrc",
        )
        assert rec["total"] >= 1
        preview = await client.call_tool(
            "read_project_file",
            {"project_id": pid, "path": rec["entries"][0]["path"], "as_image": True},
        )
        assert not preview.is_error and len(preview.content) == 2
