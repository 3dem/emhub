# SPDX-License-Identifier: GPL-3.0-or-later
"""Reading STAR files (RELION/emwrap metadata) into tables.

A STAR file holds named blocks (``data_<name>``). A block is either a loop
(``loop_``, column names ``_rlnName #n``, then one row per line) or a list of
``_rlnKey value`` pairs, read here as a table with one row.
"""

from __future__ import annotations

import shlex
from dataclasses import dataclass, field


@dataclass
class StarTable:
    name: str
    columns: list[str] = field(default_factory=list)
    rows: list[list[str]] = field(default_factory=list)
    is_loop: bool = False


def _split(line: str) -> list[str]:
    if "'" in line or '"' in line:
        try:
            return shlex.split(line, posix=True)
        except ValueError:
            pass
    return line.split()


def parse_star(text: str) -> list[StarTable]:
    tables: list[StarTable] = []
    current: StarTable | None = None
    in_header = False  # reading the column names of a loop
    for raw in text.splitlines():
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        if line.startswith("data_"):
            current = StarTable(name=line[5:].strip())
            tables.append(current)
            in_header = False
            continue
        if current is None:
            continue
        if line.split()[0] == "loop_":
            current.is_loop = True
            in_header = True
            continue
        if line.startswith("_"):
            parts = _split(line)
            name = parts[0][1:]
            if current.is_loop and in_header:
                current.columns.append(name)
            else:  # key-value block: one row that grows by one column per line
                current.columns.append(name)
                value = parts[1] if len(parts) > 1 else ""
                if not current.rows:
                    current.rows.append([])
                current.rows[0].append(value)
            continue
        if current.is_loop:
            in_header = False
            current.rows.append(_split(line))
    return tables
