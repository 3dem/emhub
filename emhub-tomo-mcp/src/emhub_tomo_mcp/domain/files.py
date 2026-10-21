# SPDX-License-Identifier: GPL-3.0-or-later
"""Files inside a project folder: listing and reading.

EMhub's file preview returns a whole text file (or a PNG preview of an image
or MRC file), so sizes are checked from the folder listing first and large
text files are refused instead of transferred.
"""

from __future__ import annotations

import base64
import binascii
import difflib
import fnmatch
import posixpath
from collections.abc import Sequence
from dataclasses import dataclass

from ..emhub.client import clean_server_message
from ..emhub.endpoints import EmhubApi
from ..emhub.models import DirItem
from ..errors import EmhubMcpError, ErrorKind, invalid, not_found
from .models import (
    FileContent,
    FileEntry,
    FileKind,
    FileList,
    StarTableContent,
    StarTableSummary,
)
from .paths import file_kind, normalize_project_path
from .projects import ProjectRef
from .shaping import clean_log, decode_cursor, paginate, take_window
from .star import StarTable, parse_star

MAX_TEXT_FILE_BYTES = 16 * 1024 * 1024
MAX_IMAGE_BYTES = 4 * 1024 * 1024
MAX_READ_LINES = 1000
MAX_READ_BYTES = 48_000


@dataclass(frozen=True)
class FileRead:
    content: FileContent
    png: bytes | None = None


def _entry(item: DirItem, folder: str) -> FileEntry:
    kind: FileKind = "dir" if item.is_dir else file_kind(item.name)
    path = posixpath.normpath(posixpath.join(folder, item.name))
    return FileEntry(name=item.name, path=path, kind=kind, size=None if item.is_dir else item.size)


class FileService:
    def __init__(self, api: EmhubApi) -> None:
        self._api = api

    async def _list(self, ref: ProjectRef, folder: str) -> list[DirItem]:
        try:
            return await self._api.list_dir(ref.root, folder)
        except EmhubMcpError as exc:
            if exc.kind is ErrorKind.UPSTREAM_ERROR and (
                "No such file" in exc.message or "Not a directory" in exc.message
            ):
                raise not_found(f"Folder '{folder}' in project {ref.id}") from None
            raise

    async def list(
        self,
        ref: ProjectRef,
        path: str,
        *,
        limit: int,
        cursor: str | None,
        pattern: str | None = None,
    ) -> FileList:
        folder = normalize_project_path(path)
        query = {"project": ref.id, "path": folder, "pattern": pattern, "limit": limit}
        offset = decode_cursor(cursor, query)
        entries = [_entry(item, folder) for item in await self._list(ref, folder)]
        if pattern:
            entries = [e for e in entries if fnmatch.fnmatch(e.name, pattern)]
        entries.sort(key=lambda e: (e.kind != "dir", e.name.lower()))
        page, next_cursor = paginate(entries, offset, limit, query)
        return FileList(
            project_id=ref.id,
            path=folder,
            entries=page,
            total=len(entries),
            next_cursor=next_cursor,
        )

    async def read(
        self,
        ref: ProjectRef,
        path: str,
        *,
        tail_lines: int | None,
        head_lines: int | None,
        start_line: int | None,
        want_image: bool,
    ) -> FileRead:
        rel = normalize_project_path(path)
        if rel == ".":
            raise invalid("Give a file path; use list_project_files for folders.")
        folder, name = posixpath.split(rel)
        items = await self._list(ref, folder or ".")
        item = next((i for i in items if i.name == name), None)
        if item is None:
            close = difflib.get_close_matches(name, [i.name for i in items], n=3)
            raise not_found(
                f"File '{rel}' in project {ref.id}",
                candidates=[posixpath.join(folder, c) if folder else c for c in close],
            )
        if item.is_dir:
            raise invalid(f"'{rel}' is a folder; use list_project_files.")

        kind = file_kind(name)
        base = FileContent(project_id=ref.id, path=rel, kind=kind, size=item.size)
        if kind == "text":
            if item.size > MAX_TEXT_FILE_BYTES:
                return FileRead(
                    base.model_copy(
                        update={
                            "note": (
                                f"The file is {item.size / 1e6:.0f} MB, too large to read "
                                f"through EMhub "
                                f"(limit {MAX_TEXT_FILE_BYTES // 2**20} MiB)."
                            )
                        }
                    )
                )
            preview = await self._api.get_file_preview(ref.root, rel)
            if preview.error or preview.text is None:
                reason = clean_server_message(preview.error or preview.note or "no text returned")
                return FileRead(
                    base.model_copy(
                        update={"note": f"EMhub could not read this file as text: {reason}"}
                    )
                )
            lines = clean_log(preview.text)
            if start_line is not None:
                window = take_window(
                    lines,
                    start_line=start_line,
                    head=min(head_lines or 200, MAX_READ_LINES),
                    max_bytes=MAX_READ_BYTES,
                )
            elif tail_lines is not None:
                window = take_window(
                    lines, tail=min(tail_lines, MAX_READ_LINES), max_bytes=MAX_READ_BYTES
                )
            else:
                window = take_window(
                    lines, head=min(head_lines or 200, MAX_READ_LINES), max_bytes=MAX_READ_BYTES
                )
            return FileRead(
                base.model_copy(
                    update={
                        "text": window.text,
                        "first_line": window.first_line,
                        "total_lines": window.total_lines,
                        "truncated": window.truncated,
                    }
                )
            )

        if kind in ("image", "em"):
            if not want_image:
                return FileRead(
                    base.model_copy(
                        update={
                            "note": "Image file; call again with as_image=true for a PNG preview."
                        }
                    )
                )
            preview = await self._api.get_file_preview(ref.root, rel)
            data = (preview.source or {}).get("dataBase64")
            if not data or preview.error:
                note = "EMhub could not make a preview of this file."
                return FileRead(base.model_copy(update={"note": note}))
            try:
                png = base64.b64decode(data, validate=True)
            except (binascii.Error, ValueError):
                return FileRead(base.model_copy(update={"note": "EMhub sent an invalid preview."}))
            if len(png) > MAX_IMAGE_BYTES:
                return FileRead(base.model_copy(update={"note": "The preview image is too large."}))
            meta = {k: v for k, v in preview.meta.items() if isinstance(v, (str, int, float, bool))}
            return FileRead(base.model_copy(update={"image": meta}), png=png)

        return FileRead(
            base.model_copy(
                update={"note": "EMhub cannot show this file type; only text, image and MRC files."}
            )
        )

    async def star_table(
        self,
        ref: ProjectRef,
        path: str,
        *,
        table: str | None,
        columns: Sequence[str] | None,
        limit: int,
        cursor: str | None,
        count_by: str | None,
    ) -> StarTableContent:
        rel = normalize_project_path(path)
        folder, name = posixpath.split(rel)
        items = await self._list(ref, folder or ".")
        item = next((i for i in items if i.name == name), None)
        if item is None or item.is_dir:
            close = difflib.get_close_matches(name, [i.name for i in items], n=3)
            raise not_found(
                f"STAR file '{rel}' in project {ref.id}",
                candidates=[posixpath.join(folder, c) if folder else c for c in close],
            )
        if item.size > MAX_TEXT_FILE_BYTES:
            raise invalid(f"{rel} is {item.size / 1e6:.0f} MB, too large to read through EMhub.")
        preview = await self._api.get_file_preview(ref.root, rel)
        if preview.error or preview.text is None:
            raise invalid(
                f"EMhub could not read {rel} as text: "
                f"{clean_server_message(preview.error or preview.note or '')}"
            )
        tables = parse_star(preview.text)
        if not tables:
            raise invalid(f"{rel} contains no STAR tables (no 'data_' blocks).")
        chosen = _choose_table(tables, table, rel)
        wanted = _resolve_columns(chosen, columns) if columns else list(chosen.columns)
        index = [chosen.columns.index(c) for c in wanted]
        query = {
            "project": ref.id,
            "path": rel,
            "table": chosen.name,
            "columns": wanted,
            "limit": limit,
        }
        offset = decode_cursor(cursor, query)
        page, next_cursor = paginate(chosen.rows, offset, limit, query)
        if limit == 0:  # only counting: there is no next page
            next_cursor = None
        counts = None
        count_column = None
        if count_by:
            (count_column,) = _resolve_columns(chosen, [count_by])
            position = chosen.columns.index(count_column)
            tally: dict[str, int] = {}
            for row in chosen.rows:
                value = row[position] if position < len(row) else ""
                tally[value] = tally.get(value, 0) + 1
            counts = dict(sorted(tally.items(), key=lambda kv: (-kv[1], kv[0]))[:500])
        return StarTableContent(
            project_id=ref.id,
            path=rel,
            tables=[
                StarTableSummary(name=t.name, columns=len(t.columns), rows=len(t.rows))
                for t in tables
            ],
            table=chosen.name,
            columns=wanted,
            rows=[[row[i] if i < len(row) else "" for i in index] for row in page],
            total_rows=len(chosen.rows),
            first_row=offset + 1 if page else 0,
            next_cursor=next_cursor,
            count_by=count_column,
            counts=counts,
        )


def _choose_table(tables: list[StarTable], name: str | None, rel: str) -> StarTable:
    if name is not None:
        for t in tables:
            if t.name == name:
                return t
        close = difflib.get_close_matches(name, [t.name for t in tables], n=3)
        raise not_found(
            f"Table '{name}' in {rel}", candidates=close or [t.name for t in tables][:5]
        )
    loops = [t for t in tables if t.is_loop]
    return max(loops, key=lambda t: len(t.rows)) if loops else tables[0]


def _resolve_columns(table: StarTable, names: Sequence[str]) -> list[str]:
    resolved = []
    for name in names:
        bare = name.lstrip("_")
        for candidate in (bare, f"rln{bare}"):
            if candidate in table.columns:
                resolved.append(candidate)
                break
        else:
            close = difflib.get_close_matches(bare, table.columns, n=3)
            raise not_found(
                f"Column '{name}' in table '{table.name}'",
                candidates=close or table.columns[:8],
                hint=f"The table has {len(table.columns)} columns.",
            )
    return resolved
