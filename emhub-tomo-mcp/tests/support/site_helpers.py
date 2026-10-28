# SPDX-License-Identifier: GPL-3.0-or-later
"""Helpers for contract tests: a test site with stub launchers, tiny data, REST set-up."""

from __future__ import annotations

import json
import struct
import time
from pathlib import Path
from typing import Any

import httpx2

MDOC = Path(__file__).resolve().parents[1] / "fixtures" / "data" / "TS_1.mrc.mdoc"
TERMINAL = {"finished", "failed", "aborted"}
PROGRAMS = (
    "WARP",
    "RELION",
    "PYTOM",
    "MOTIONCOR2",
    "MOTIONCOR3",
    "ARETOMO2",
    "ARETOMO3",
    "IMOD",
    "CTFFIND",
    "CRYOCARE",
    "DENOISET",
    "MISSALIGNMENT",
)
STUB_ERROR = "stub program failed on purpose (contract test)"


FRAMES = (
    "2Dvs3D_53-1_00041_-40.0_Jul31_11.05.12.tif",  # the frames named in the mdoc
    "2Dvs3D_53-1_00040_-38.0_Jul31_11.04.30.tif",
)


def tiny_tiff(width: int = 16, height: int = 8, pages: int = 3) -> bytes:
    """A valid uncompressed 8-bit grey multi-page TIFF, like a movie of sub-frames.
    Import only reads its dimensions (and needs more than one page)."""
    ifd_size = 2 + 9 * 12 + 4
    page_size = ifd_size + width * height
    out = b"II*\x00" + struct.pack("<I", 8)
    for page in range(pages):
        offset = 8 + page * page_size
        entries = [
            (256, 3, width),
            (257, 3, height),
            (258, 3, 8),
            (259, 3, 1),
            (262, 3, 1),
            (273, 4, offset + ifd_size),
            (277, 3, 1),
            (278, 3, height),
            (279, 4, width * height),
        ]
        following = offset + page_size if page < pages - 1 else 0
        out += struct.pack("<H", len(entries))
        out += b"".join(struct.pack("<HHII", t, k, 1, v) for t, k, v in entries)
        out += struct.pack("<I", following) + bytes(width * height)
    return out


def make_test_site(site: Path, installation: Path) -> Path:
    """A site folder for emhub_instance(): the installation's Python environment,
    the local queue only, and stub launchers for every external program. The
    stubs fail by default; set_stub_mode() makes them succeed or run for a while."""
    site.mkdir(parents=True)
    stub = site / "stub_fail.sh"
    stub.write_text(
        "#!/bin/bash\n"
        'echo "stub launcher called: $*"\n'
        f'mode=$(cat "{site}/stub_mode" 2>/dev/null || echo fail)\n'
        'case "$mode" in\n'
        "  ok) exit 0 ;;\n"
        '  sleep*) sleep "${mode#sleep }"; exit 0 ;;\n'
        f'  *) echo "ERROR: {STUB_ERROR}" >&2; exit 1 ;;\n'
        "esac\n"
    )
    programs = {name: {"launcher": str(stub)} for name in PROGRAMS}
    programs["EMWRAP"] = {"launcher": f"{site}/emh-tomo --launch"}
    config = json.dumps({"queues": [{"name": "None"}], "programs": programs})
    (site / "emwrap.bashrc").write_text(
        "#!/bin/bash\n"
        f'export ROOT="{site}"\n'
        f'export SCRIPTS="{site}"\n'
        f'. "{installation}/bashrc" > /dev/null\n'
        f"export EMWRAP_CONFIG='{config}'\n"
    )
    launcher = site / "emh-tomo"
    launcher.write_text(
        "#!/bin/bash\n"
        f'export EMHUB_TOMO_HOME="{site}"\n'
        f'. "{site}/emwrap.bashrc"\n'
        'exec python -m emwrap.tomo "$@"\n'
    )
    for script in (stub, launcher):
        script.chmod(0o755)
    return site


class Rest:
    """Minimal synchronous EMhub client for setting up test data."""

    def __init__(self, url: str) -> None:
        self.http = httpx2.Client(base_url=url, timeout=120, trust_env=False)

    def __call__(self, method: str, attrs: Any = None, **body: Any) -> Any:
        if attrs is not None:
            body["attrs"] = attrs
        data = self.http.post(f"/api/{method}", json=body).json()
        if isinstance(data, dict) and ("error" in data or "errors" in data):
            raise RuntimeError(f"{method}: {str(data)[:800]}")
        return data


def set_stub_mode(site: Path, mode: str) -> None:
    """'fail' (the default), 'ok', or 'sleep <seconds>'."""
    (site / "stub_mode").write_text(mode + "\n")


def create_entry(
    rest: Rest, container: int, path: Path, data: Path, title: str, share: list[dict[str, str]]
) -> int:
    attrs = {
        "project_id": container,
        "type": "tomo_processing",
        "title": title,
        "description": "",
        "date": "2026-10-21T10:00:00Z",
        "extra": {
            "data": {"processing_path": str(path), "data_path": str(data), "share_table": share}
        },
    }
    return int(rest("create_entry", attrs)["entry"]["id"])


def wait_status(rest: Rest, entry: int, job: str, timeout: float = 240) -> str:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        jobs = rest("get_session_workflow", {"entry_id": entry, "widget": False})["workflow"]
        status = next(j["status"] for j in jobs if j["id"] == job)
        if status in TERMINAL:
            return str(status)
        time.sleep(2)
    raise TimeoutError(f"{job} did not finish in {timeout} s")
