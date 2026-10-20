# SPDX-License-Identifier: GPL-3.0-or-later
"""Throw-away EMhub-Tomo server for development and contract tests.

``emhub_instance()`` creates a minimal EMhub instance in a temporary folder,
sets a random admin password, copies the processing extras and serves the
Flask app on a free localhost port. Commands run inside an existing EMhub-Tomo
installation, i.e. the folder holding ``emwrap.bashrc`` (``EMHUB_TOMO_HOME``),
so the server uses that installation's Python environment and EMWRAP_CONFIG.

The server never runs in debug mode and never auto-logs users in. Only the
standard library is used, so the caller may run any Python >= 3.9,
independently of the installation's Python.
"""

from __future__ import annotations

import os
import secrets
import shutil
import signal
import socket
import subprocess
import tempfile
import time
import urllib.error
import urllib.request
from collections.abc import Iterator
from contextlib import contextmanager
from dataclasses import dataclass
from pathlib import Path

# Activates the installation's environment, then runs the given command.
_ENV_WRAPPER = 'source "$1/emwrap.bashrc" > /dev/null && shift && exec "$@"'

# Variables that would turn on auto-login or debug mode, or point elsewhere.
_UNSAFE_ENV = ("EMHUB_LOGGED_USER", "FLASK_DEBUG", "EMHUB_INSTANCE")

# The password is passed through the environment, never on a command line
# (other users can read command lines with ps).
_SET_ADMIN_PASSWORD = """
import os, sys
from emhub.data.data_manager import DataManager
dm = DataManager(sys.argv[1])
user = dm.get_user_by(username='admin')
user.set_password(os.environ['EMHUB_TEST_ADMIN_PASSWORD'])
dm.commit()
"""

# Same location 'emh-tomo --run' copies the processing extras from.
_FIND_EXTRAS = """
import os, emhub
stack = os.environ.get('EMSTACK_HOME')
root = os.path.join(stack, 'emhub') if stack else os.path.dirname(os.path.dirname(emhub.__file__))
print(os.path.join(root, 'extras', 'processing'))
"""


@dataclass(frozen=True)
class EmhubInstance:
    """A running throw-away EMhub server."""

    url: str
    username: str
    password: str
    root: Path  # temporary folder holding everything below
    instance_dir: Path  # EMHUB_INSTANCE: SQLite database, extras
    log_file: Path  # server stdout and stderr


def _in_installation(home: Path, *args: str) -> list[str]:
    return ["bash", "-c", _ENV_WRAPPER, "bash", str(home), *args]


def _free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


def _log_tail(log_file: Path) -> str:
    return log_file.read_text(errors="replace")[-3000:]


def _wait_until_serving(url: str, proc: subprocess.Popen, log_file: Path, timeout: float) -> None:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if proc.poll() is not None:
            raise RuntimeError(f"EMhub server exited early:\n{_log_tail(log_file)}")
        try:
            urllib.request.urlopen(url, timeout=2).close()
            return
        except urllib.error.HTTPError:
            return  # any HTTP answer means the server is up
        except OSError:
            time.sleep(0.5)
    raise TimeoutError(f"EMhub server not ready after {timeout:.0f} s:\n{_log_tail(log_file)}")


def _stop(proc: subprocess.Popen) -> None:
    if proc.poll() is not None:
        return
    os.killpg(proc.pid, signal.SIGTERM)
    try:
        proc.wait(timeout=15)
    except subprocess.TimeoutExpired:
        os.killpg(proc.pid, signal.SIGKILL)
        proc.wait()


@contextmanager
def emhub_instance(
    home: str | os.PathLike[str] | None = None,
    workdir: str | os.PathLike[str] | None = None,
    keep: bool = False,
    timeout: float = 120,
) -> Iterator[EmhubInstance]:
    """Create, serve and finally remove a throw-away EMhub instance.

    Args:
        home: EMhub-Tomo installation folder (default: ``$EMHUB_TOMO_HOME``).
        workdir: where to create the temporary folder (default: system temp).
        keep: keep the temporary folder after the server has stopped.
        timeout: seconds to wait for the server to answer.
    """
    home = Path(home or os.environ["EMHUB_TOMO_HOME"]).resolve()
    if not (home / "emwrap.bashrc").is_file():
        raise FileNotFoundError(f"No emwrap.bashrc in EMhub-Tomo installation {home}")

    root = Path(tempfile.mkdtemp(prefix="emhub-instance-", dir=workdir))
    instance_dir = root / "instance"
    log_file = root / "server.log"
    password = secrets.token_urlsafe(18)
    env = {k: v for k, v in os.environ.items() if k not in _UNSAFE_ENV}

    proc = None
    try:
        with log_file.open("w") as log:
            subprocess.run(
                _in_installation(home, "emh-data", "--create_minimal", str(instance_dir)),
                env=env, stdout=log, stderr=subprocess.STDOUT, check=True)
            extras = subprocess.run(
                _in_installation(home, "python", "-c", _FIND_EXTRAS),
                env=env, capture_output=True, text=True, check=True).stdout.strip()
            shutil.copytree(extras, instance_dir / "extra", dirs_exist_ok=True)
            subprocess.run(
                _in_installation(home, "python", "-c", _SET_ADMIN_PASSWORD, str(instance_dir)),
                env={**env, "EMHUB_TEST_ADMIN_PASSWORD": password},
                stdout=log, stderr=subprocess.STDOUT, check=True)

        port = _free_port()
        url = f"http://127.0.0.1:{port}"
        server_env = {**env, "FLASK_APP": "emhub", "EMHUB_INSTANCE": str(instance_dir)}
        with log_file.open("a") as log:
            proc = subprocess.Popen(
                _in_installation(home, "flask", "run", "--host", "127.0.0.1",
                                 "--port", str(port), "--no-reload"),
                env=server_env, stdout=log, stderr=subprocess.STDOUT, start_new_session=True)
        _wait_until_serving(url, proc, log_file, timeout)
        yield EmhubInstance(url=url, username="admin", password=password, root=root,
                            instance_dir=instance_dir, log_file=log_file)
    finally:
        if proc is not None:
            _stop(proc)
        if not keep:
            shutil.rmtree(root, ignore_errors=True)
