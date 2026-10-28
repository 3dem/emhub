# SPDX-License-Identifier: GPL-3.0-or-later
"""Project-relative paths.

File tools take a path *inside* a project. The project folder itself always
comes from the project's EMhub entry, never from the caller, and a path must
stay inside it: no absolute paths, no ``~``, no ``..`` segments (also not in
Unicode look-alike forms), no backslashes and no control characters. The
check is lexical; links inside the project (such as ``data/``, which points
at the raw data) are followed by EMhub as usual.
"""

from __future__ import annotations

import posixpath
import unicodedata
from typing import Literal

from ..errors import invalid

MAX_PATH_CHARS = 1024


def normalize_project_path(path: str) -> str:
    """Return the normalised relative path (``'.'`` for the project folder)."""
    if len(path) > MAX_PATH_CHARS:
        raise invalid(f"Path is longer than {MAX_PATH_CHARS} characters.")
    stripped = path.strip()
    if stripped in ("", "."):
        return "."
    if any(ord(c) < 32 or ord(c) == 127 for c in stripped):
        raise invalid("Path contains control characters.")
    if "\\" in stripped:
        raise invalid("Use '/' as the path separator.")
    folded = unicodedata.normalize("NFKC", stripped)
    if folded.startswith(("/", "~")):
        raise invalid(
            "Path must be relative to the project folder.",
            hint="For example 'WarpMctf/job002/run.out'; list files with list_project_files.",
        )
    segments = stripped.split("/")
    if any(unicodedata.normalize("NFKC", seg) == ".." for seg in segments):
        raise invalid("Path must not leave the project folder ('..' is not allowed).")
    normalized = posixpath.normpath(stripped)
    if normalized.startswith(("/", "..")):
        raise invalid("Path must stay inside the project folder.")
    return normalized


def file_kind(name: str) -> Literal["text", "image", "em", "other"]:
    """Rough kind of a file from its extension: text, image, em or other."""
    ext = posixpath.splitext(name)[1].lower().lstrip(".")
    if ext in TEXT_EXTENSIONS:
        return "text"
    if ext in IMAGE_EXTENSIONS:
        return "image"
    if ext in EM_EXTENSIONS:
        return "em"
    return "other"


# Mirrors emtools.utils.path (what EMhub's file preview can show as text or image).
TEXT_EXTENSIONS = frozenset(
    {
        "txt",
        "log",
        "err",
        "out",
        "json",
        "csv",
        "star",
        "sh",
        "bashrc",
        "xml",
        "script",
        "settings",
        "job",
        "tomostar",
        "mdoc",
        "population",
        "species",
        "yaml",
        "id",
        "aln",
        "com",
        "rawtlt",
        "tlt",
        "xf",
        "xtilt",
    }
)
IMAGE_EXTENSIONS = frozenset({"tiff", "tif", "png", "jpg", "jpeg"})
EM_EXTENSIONS = frozenset({"mrc", "mrcs", "eer", "gain"})
