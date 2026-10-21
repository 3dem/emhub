# SPDX-License-Identifier: GPL-3.0-or-later
"""docs/tools.md must match the code."""

from __future__ import annotations

import re
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


def _anchors(markdown: str) -> set[str]:
    """GitHub's heading anchors: lower case, punctuation dropped, spaces as '-'."""
    headings = re.findall(r"^#+ (.+)$", markdown, re.MULTILINE)
    return {re.sub(r"[^\w\- ]", "", h).strip().lower().replace(" ", "-") for h in headings}


def test_relative_links_resolve() -> None:
    root = SCRIPT.parents[1]
    broken = []
    for page in [root / "README.md", root / "CHANGELOG.md", *sorted((root / "docs").glob("*.md"))]:
        text = re.sub(r"```.*?```", "", page.read_text(), flags=re.DOTALL)
        for target in re.findall(r"\]\(([^)\s]+)\)", text):
            if re.match(r"[a-z]+:", target):
                continue
            path, _, anchor = target.partition("#")
            dest = (page.parent / path).resolve() if path else page
            if not dest.exists():
                broken.append(f"{page.name}: {target}")
            elif anchor and dest.suffix == ".md" and anchor not in _anchors(dest.read_text()):
                broken.append(f"{page.name}: {target} (no such heading)")
    assert not broken, broken
