#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-3.0-or-later
"""Record real EMhub REST request/response samples for the tests.

Starts a throw-away EMhub-Tomo server (tests/support/emhub_instance.py), walks
through the endpoints the MCP server uses, and writes one JSON file per call
to tests/fixtures/api/. Temporary paths are replaced by <ROOT> and passwords
are masked. No job is executed: the one launch attempt is made with invalid
parameters on purpose, to record the validation-error format.

Usage:
    EMHUB_TOMO_HOME=/path/to/emhub-tomo/installation \
    [EMHUB_TEST_WORKDIR=/scratch/dir] python scripts/record_api_samples.py
"""

from __future__ import annotations

import datetime as dt
import http.cookiejar
import json
import os
import sys
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any

PACKAGE_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PACKAGE_DIR / "tests" / "support"))

from emhub_instance import EmhubInstance, emhub_instance  # noqa: E402

FIXTURES_DIR = PACKAGE_DIR / "tests" / "fixtures" / "api"
WORKFLOW_ID = "apof-warp-tutorial-part1"


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    """Report redirects (e.g. to the login page) instead of following them."""

    def redirect_request(self, *args: Any, **kwargs: Any) -> None:
        return None


class Recorder:
    def __init__(self, inst: EmhubInstance) -> None:
        self.url = inst.url
        self.secrets = [inst.password]
        self.roots = sorted({str(inst.root), os.path.realpath(inst.root)}, key=len, reverse=True)
        # Server tracebacks contain source paths inside the installation.
        home = os.environ.get("EMHUB_TOMO_HOME", "")
        self.homes = sorted({home, os.path.realpath(home)} - {""}, key=len, reverse=True)
        self.opener = urllib.request.build_opener(
            urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()), _NoRedirect()
        )
        self.count = 0

    def call(
        self,
        name: str,
        method: str,
        payload: dict[str, Any] | None = None,
        opener: urllib.request.OpenerDirector | None = None,
    ) -> Any:
        request = urllib.request.Request(
            f"{self.url}/api/{method}",
            data=json.dumps(payload or {}).encode(),
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        location = None
        try:
            with (opener or self.opener).open(request, timeout=120) as resp:
                status, ctype, body = resp.status, resp.headers.get("Content-Type", ""), resp.read()
        except urllib.error.HTTPError as err:
            status, ctype, body = err.code, err.headers.get("Content-Type", ""), err.read()
            location = err.headers.get("Location")
        text = body.decode(errors="replace")
        try:
            response: Any = json.loads(text)
        except ValueError:
            response = text[:2000]
        self._save(name, method, payload, status, ctype, location, response)
        return response

    def _sanitize(self, text: str) -> str:
        for secret in self.secrets:
            text = text.replace(secret, "<PASSWORD>")
        for root in self.roots:  # roots live inside the installation: replace them first
            text = text.replace(root, "<ROOT>")
        for home in self.homes:
            text = text.replace(home, "<EMHUB_TOMO_HOME>")
        return text

    def _save(
        self,
        name: str,
        method: str,
        payload: Any,
        status: int,
        ctype: str,
        location: str | None,
        response: Any,
    ) -> None:
        self.count += 1
        sample = {
            "endpoint": f"/api/{method}",
            "request": payload,
            "status": status,
            "content_type": ctype,
            "location": location,
            "response": response,
        }
        text = self._sanitize(json.dumps(sample, indent=2, default=str))
        (FIXTURES_DIR / f"{self.count:02d}_{name}.json").write_text(text + "\n")
        preview = response if isinstance(response, str) else json.dumps(response, default=str)
        print(f"{self.count:02d} {name:<36} HTTP {status}  {self._sanitize(preview)[:110]}")


def _value(result: Any, *keys: Any) -> Any:
    """Dig into a response, failing with the response itself if it is an error."""
    try:
        for key in keys:
            result = result[key]
        return result
    except (KeyError, IndexError, TypeError):
        raise RuntimeError(f"Unexpected response, wanted {keys}: {str(result)[:1500]}") from None


def record(inst: EmhubInstance) -> None:
    rec = Recorder(inst)
    anonymous = urllib.request.build_opener(_NoRedirect())

    # --- authentication -------------------------------------------------------
    rec.call("get_entries_not_logged_in", "get_entries", {}, opener=anonymous)
    rec.call("login_wrong_password", "login", {"username": "admin", "password": "wrong"})
    rec.call("login", "login", {"username": inst.username, "password": inst.password})
    users = rec.call(
        "get_users_selected_attrs", "get_users", {"attrs": ["id", "username", "email", "roles"]}
    )
    admin_id = next(u["id"] for u in users if u["username"] == "admin")

    # --- a tomography project: EMhub project container + tomo_processing entry --
    project = rec.call(
        "create_project_container",
        "create_project",
        {
            "attrs": {
                "user_id": admin_id,
                "status": "special:processing_tomo",
                "user_can_edit": True,
                "is_confidential": False,
                "title": "Default Project for tomo_processing entries",
                "description": "",
            }
        },
    )
    project_id = _value(project, "project", "id")

    data_dir = inst.root / "data"
    (data_dir / "mdoc").mkdir(parents=True)
    (data_dir / "frames").mkdir()
    proc_path = inst.root / "projects" / "spike_project"
    proc_path.parent.mkdir()
    now = dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

    def entry_attrs(processing_path: Path, title: str) -> dict[str, Any]:
        return {
            "project_id": project_id,
            "type": "tomo_processing",
            "title": title,
            "description": "",
            "date": now,
            "extra": {
                "data": {
                    "processing_path": str(processing_path),
                    "data_path": str(data_dir),
                    "share_table": [],
                }
            },
        }

    rec.call(
        "create_entry_parent_missing",
        "create_entry",
        {"attrs": entry_attrs(inst.root / "missing" / "p", "bad path")},
    )
    entry = rec.call(
        "create_entry_tomo_processing",
        "create_entry",
        {"attrs": entry_attrs(proc_path, "API spike project")},
    )
    entry_id = _value(entry, "entry", "id")
    rec.call("get_entries", "get_entries", {})
    rec.call("get_projects", "get_projects", {})

    # --- workflow templates and the job graph -------------------------------
    sel = {"entry_id": entry_id}
    rec.call("get_workflows", "get_workflows", {})
    rec.call(
        "get_session_workflow_empty", "get_session_workflow", {"attrs": {**sel, "widget": False}}
    )
    rec.call("load_workflow", "load_workflow", {"attrs": {**sel, "workflow_id": WORKFLOW_ID}})
    flat = rec.call(
        "get_session_workflow_flat", "get_session_workflow", {"attrs": {**sel, "widget": False}}
    )
    rec.call(
        "get_session_workflow_widget", "get_session_workflow", {"attrs": {**sel, "widget": True}}
    )
    rec.call(
        "get_session_workflow_unknown_entry",
        "get_session_workflow",
        {"attrs": {"entry_id": 999999, "widget": False}},
    )

    # --- single jobs and forms ----------------------------------------------
    import_job = next(j["id"] for j in _value(flat, "workflow") if j["type"] == "emw-import-ts")
    rec.call(
        "get_session_run_json",
        "get_session_run",
        {"attrs": {**sel, "run_id": import_job, "output": ["json"]}},
    )
    rec.call(
        "get_session_run_all_outputs",
        "get_session_run",
        {"attrs": {**sel, "run_id": import_job, "output": ["json", "stdout", "stderr", "form"]}},
    )
    rec.call(
        "get_session_run_form_new_job_type",
        "get_session_run",
        {"attrs": {**sel, "run_id": None, "job_type": "emw-warp-mctf", "output": ["form"]}},
    )
    rec.call(
        "get_session_run_form_without_run_id",
        "get_session_run",
        {"attrs": {**sel, "job_type": "emw-warp-mctf", "output": ["form"]}},
    )
    # Invalid on purpose: records the validation-error format, launches nothing.
    rec.call(
        "launch_job_invalid_params",
        "launch_job",
        {
            "attrs": {
                **sel,
                "run_id": import_job,
                "clean": False,
                "params": {"acq.voltage": "not-a-number", "mdoc_files": "data/mdoc/none_*.mdoc"},
            }
        },
    )

    # --- annotations, labels, duplication -----------------------------------
    rec.call(
        "save_job_annotation",
        "save_job_annotation",
        {
            "attrs": {
                **sel,
                "run_id": import_job,
                "runName": "Import (API spike)",
                "comment": "recorded by record_api_samples.py",
            }
        },
    )
    label = rec.call(
        "save_project_label",
        "save_project_label",
        {"attrs": {**sel, "label": {"name": "spike", "color": "#1f77b4"}}},
    )
    rec.call(
        "set_job_labels",
        "set_job_labels",
        {"attrs": {**sel, "run_id": import_job, "label_ids": [_value(label, "label", "id")]}},
    )
    rec.call("get_project_labels", "get_project_labels", {"attrs": sel})
    dup = rec.call("duplicate_jobs", "duplicate_jobs", {"attrs": {**sel, "run_ids": [import_job]}})
    copy_id = _value(dup, "workflow", "duplicated", 0, "newId")
    rec.call("delete_jobs", "delete_jobs", {"attrs": {**sel, "run_ids": [copy_id]}})

    # --- files ---------------------------------------------------------------
    root = {"root": str(proc_path)}
    rec.call("list_project_dir_root", "list_project_dir", {"attrs": {**root, "path": "."}})
    rec.call("list_project_dir_job", "list_project_dir", {"attrs": {**root, "path": import_job}})
    rec.call(
        "get_file_preview_jobstar",
        "get_file_preview",
        {"attrs": {**root, "path": f"{import_job}/job.star"}},
    )

    # --- configuration and logout -------------------------------------------
    rec.call("get_config_processing_menus", "get_config", {"attrs": {"config": "processing_menus"}})
    rec.call("logout", "logout", {})


def main() -> int:
    FIXTURES_DIR.mkdir(parents=True, exist_ok=True)
    for old in FIXTURES_DIR.glob("*.json"):
        old.unlink()
    with emhub_instance(workdir=os.environ.get("EMHUB_TEST_WORKDIR")) as inst:
        print(f"Throw-away EMhub server at {inst.url}")
        try:
            record(inst)
        except Exception:
            print("--- server log (tail) ---\n" + inst.log_file.read_text(errors="replace")[-4000:])
            raise
    print(f"Samples written to {FIXTURES_DIR}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
