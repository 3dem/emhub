#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-3.0-or-later
"""Run a long-lived development EMhub-Tomo server.

    dev_server.py start  INSTANCE_DIR [--port PORT]
    dev_server.py status INSTANCE_DIR
    dev_server.py stop   INSTANCE_DIR

The instance is created on the first start: a minimal instance with the
processing extras, and a random admin password stored in
INSTANCE_DIR/dev_admin_password (mode 600). The server listens on 127.0.0.1
only, without debug mode or auto-login, and keeps running after this script
exits. Its url and pid are kept in INSTANCE_DIR/dev_server.json and its output
in INSTANCE_DIR/dev_server.log.

Requires EMHUB_TOMO_HOME, the EMhub-Tomo installation folder (emwrap.bashrc).
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "tests" / "support"))

from emhub_instance import (  # noqa: E402
    create_instance,
    free_port,
    installation_home,
    start_server,
    stop_server,
    wait_until_serving,
)


def _runtime_file(instance_dir: Path) -> Path:
    return instance_dir / "dev_server.json"


def _running(instance_dir: Path) -> dict | None:
    """Runtime info of the server, if it is still running."""
    try:
        info = json.loads(_runtime_file(instance_dir).read_text())
        os.killpg(info["pid"], 0)
        return info
    except (FileNotFoundError, ProcessLookupError, ValueError, KeyError):
        return None


def start(instance_dir: Path, port: int | None) -> None:
    if info := _running(instance_dir):
        print(f"Already running: {info['url']} (pid {info['pid']})")
        return

    home = installation_home()
    password_file = instance_dir / "dev_admin_password"
    if not instance_dir.exists():
        instance_dir.parent.mkdir(parents=True, exist_ok=True)
        create_log = instance_dir.with_name(instance_dir.name + ".create.log")
        with create_log.open("w") as log:
            password = create_instance(home, instance_dir, log)
        password_file.touch(mode=0o600)
        password_file.write_text(password + "\n")
        print(f"Created instance {instance_dir}")

    port = port or free_port()
    url = f"http://127.0.0.1:{port}"
    log_file = instance_dir / "dev_server.log"
    proc = start_server(home, instance_dir, port, log_file)
    wait_until_serving(url, proc, log_file, timeout=120)
    info = {"url": url, "port": port, "pid": proc.pid, "username": "admin",
            "password_file": str(password_file), "log_file": str(log_file),
            "started": time.strftime("%Y-%m-%d %H:%M:%S")}
    _runtime_file(instance_dir).write_text(json.dumps(info, indent=2) + "\n")
    print(f"Serving {url} (pid {proc.pid}); admin password in {password_file}")


def stop(instance_dir: Path) -> None:
    if info := _running(instance_dir):
        stop_server(info["pid"])
        print(f"Stopped {info['url']} (pid {info['pid']})")
    else:
        print("Not running")
    _runtime_file(instance_dir).unlink(missing_ok=True)


def status(instance_dir: Path) -> None:
    info = _running(instance_dir)
    print(json.dumps(info, indent=2) if info else "Not running")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("action", choices=["start", "status", "stop"])
    parser.add_argument("instance_dir", type=Path)
    parser.add_argument("--port", type=int)
    args = parser.parse_args()
    instance_dir = args.instance_dir.resolve()
    if args.action == "start":
        start(instance_dir, args.port)
    elif args.action == "stop":
        stop(instance_dir)
    else:
        status(instance_dir)
    return 0


if __name__ == "__main__":
    sys.exit(main())
