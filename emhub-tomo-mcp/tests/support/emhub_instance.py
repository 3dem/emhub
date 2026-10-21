# SPDX-License-Identifier: GPL-3.0-or-later
"""EMhub-Tomo servers for development and contract tests.

``emhub_instance()`` creates a throw-away minimal EMhub instance in a temporary
folder, serves it on a free localhost port and removes it afterwards. The
building blocks (``create_instance``, ``start_server``, ``wait_until_serving``,
``stop_server``) are also used by ``scripts/dev_server.py`` for a long-lived
development server.

Commands run inside an existing EMhub-Tomo installation, i.e. the folder
holding ``emwrap.bashrc`` (``EMHUB_TOMO_HOME``), so the server uses that
installation's Python environment and EMWRAP_CONFIG. Servers never run in
debug mode, never auto-log users in, and listen on 127.0.0.1 only; the admin
password is random. Only the standard library is used, so the caller may run
any Python >= 3.9, independently of the installation's Python.
"""

from __future__ import annotations

import contextlib
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
from typing import IO

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


def installation_home(home: str | os.PathLike[str] | None = None) -> Path:
    """Resolve the EMhub-Tomo installation folder (default: ``$EMHUB_TOMO_HOME``)."""
    path = Path(home or os.environ["EMHUB_TOMO_HOME"]).resolve()
    if not (path / "emwrap.bashrc").is_file():
        raise FileNotFoundError(f"No emwrap.bashrc in EMhub-Tomo installation {path}")
    return path


def _in_installation(home: Path, *args: str) -> list[str]:
    return ["bash", "-c", _ENV_WRAPPER, "bash", str(home), *args]


def _safe_env() -> dict[str, str]:
    return {k: v for k, v in os.environ.items() if k not in _UNSAFE_ENV}


def free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


def _log_tail(log_file: Path) -> str:
    return log_file.read_text(errors="replace")[-3000:]


def create_instance(home: Path, instance_dir: Path, log: IO[str]) -> str:
    """Create a minimal instance with the processing extras in ``instance_dir``
    (which must not exist yet) and return its random admin password."""
    env = _safe_env()
    subprocess.run(
        _in_installation(home, "emh-data", "--create_minimal", str(instance_dir)),
        env=env,
        stdout=log,
        stderr=subprocess.STDOUT,
        check=True,
    )
    extras = subprocess.run(
        _in_installation(home, "python", "-c", _FIND_EXTRAS),
        env=env,
        capture_output=True,
        text=True,
        check=True,
    ).stdout.strip()
    shutil.copytree(extras, instance_dir / "extra", dirs_exist_ok=True)
    password = secrets.token_urlsafe(18)
    subprocess.run(
        _in_installation(home, "python", "-c", _SET_ADMIN_PASSWORD, str(instance_dir)),
        env={**env, "EMHUB_TEST_ADMIN_PASSWORD": password},
        stdout=log,
        stderr=subprocess.STDOUT,
        check=True,
    )
    return password


def start_server(home: Path, instance_dir: Path, port: int, log_file: Path) -> subprocess.Popen:
    """Serve ``instance_dir`` on 127.0.0.1:port in a new process group."""
    # Flask only accepts an absolute instance path.
    env = {**_safe_env(), "FLASK_APP": "emhub", "EMHUB_INSTANCE": str(instance_dir.resolve())}
    with log_file.open("a") as log:
        return subprocess.Popen(
            _in_installation(
                home, "flask", "run", "--host", "127.0.0.1", "--port", str(port), "--no-reload"
            ),
            env=env,
            stdout=log,
            stderr=subprocess.STDOUT,
            start_new_session=True,
        )


def wait_until_serving(url: str, proc: subprocess.Popen, log_file: Path, timeout: float) -> None:
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


def stop_child_server(proc: subprocess.Popen, timeout: float = 15) -> None:
    """Stop a server started by ``start_server`` in this process, and reap it."""
    try:
        os.killpg(proc.pid, signal.SIGTERM)
    except ProcessLookupError:
        return
    try:
        proc.wait(timeout=timeout)
    except subprocess.TimeoutExpired:
        os.killpg(proc.pid, signal.SIGKILL)
        proc.wait()
    # Jobs the server launched on the local queue run in the same process group.
    with contextlib.suppress(ProcessLookupError):
        os.killpg(proc.pid, signal.SIGKILL)


def stop_server(pid: int, timeout: float = 15) -> None:
    """Stop the server process group started by ``start_server`` in another
    process (see scripts/dev_server.py); polls until the group is gone."""
    try:
        os.killpg(pid, signal.SIGTERM)
    except ProcessLookupError:
        return
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        try:
            os.killpg(pid, 0)
        except ProcessLookupError:
            return
        time.sleep(0.2)
    os.killpg(pid, signal.SIGKILL)


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
    home = installation_home(home)
    root = Path(tempfile.mkdtemp(prefix="emhub-instance-", dir=workdir)).resolve()
    instance_dir = root / "instance"
    log_file = root / "server.log"

    proc = None
    try:
        with log_file.open("w") as log:
            password = create_instance(home, instance_dir, log)
        port = free_port()
        url = f"http://127.0.0.1:{port}"
        proc = start_server(home, instance_dir, port, log_file)
        wait_until_serving(url, proc, log_file, timeout)
        yield EmhubInstance(
            url=url,
            username="admin",
            password=password,
            root=root,
            instance_dir=instance_dir,
            log_file=log_file,
        )
    finally:
        if proc is not None:
            stop_child_server(proc)
        if not keep:
            shutil.rmtree(root, ignore_errors=True)
