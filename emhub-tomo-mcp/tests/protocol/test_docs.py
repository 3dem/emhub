# SPDX-License-Identifier: GPL-3.0-or-later
"""docs/tools.md must match the code."""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path

SCRIPT = Path(__file__).resolve().parents[2] / "scripts" / "gen_tool_docs.py"


def test_tool_reference_is_current() -> None:
    proc = subprocess.run(
        [sys.executable, str(SCRIPT), "--check"],
        capture_output=True,
        text=True,
        timeout=120,
        check=False,
    )
    assert proc.returncode == 0, proc.stderr + " Run: python scripts/gen_tool_docs.py"
