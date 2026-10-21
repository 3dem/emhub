# SPDX-License-Identifier: GPL-3.0-or-later
from __future__ import annotations

import pytest

from emhub_tomo_mcp.domain.shaping import (
    clean_log,
    decode_cursor,
    encode_cursor,
    is_error_line,
    omitted_lines,
    paginate,
    take_window,
    truncate,
)
from emhub_tomo_mcp.errors import EmhubMcpError, ErrorKind


def test_clean_log() -> None:
    text = (
        "\x1b[32mgreen\x1b[0m line\n"
        "progress 1\rprogress 2\rprogress 3 done   \n"
        "bell\x07 and \x1b]0;title\x07osc\n"
        "\r\n"
        "tab\tkept\n\n\n"
    )
    assert clean_log(text) == [
        "green line",
        "progress 3 done",
        "bell and osc",
        "",
        "tab\tkept",
    ]
    assert clean_log("") == []


@pytest.mark.parametrize(
    ("line", "expected"),
    [
        ("Traceback (most recent call last):", True),
        ("RuntimeError: AreTomo3 exited with code 1", True),
        ("Exception: Could not load acquisition parameters", True),
        ("slurmstepd: error: *** JOB 1 CANCELLED AT 2026 DUE TO TIME LIMIT ***", True),
        ("CUDA error: out of memory", True),
        ("Killed", True),
        ("Job failed", True),
        ("Done, 41 tilts processed", False),
        ("Errorbars disabled", False),
    ],
)
def test_error_lines(line: str, expected: bool) -> None:
    assert is_error_line(line) is expected


def test_omitted_lines() -> None:
    assert omitted_lines(["a", "=============== OMITTED 123 LINES ============", "b"]) == 123
    assert omitted_lines(["a", "b"]) == 0


LINES = [f"line {i}" for i in range(1, 101)]


def test_tail_window() -> None:
    w = take_window(LINES, tail=10, max_bytes=10_000)
    assert w.text.splitlines() == LINES[-10:]
    assert (w.first_line, w.total_lines, w.truncated) == (91, 100, True)


def test_head_and_start_windows() -> None:
    w = take_window(LINES, head=5, max_bytes=10_000)
    assert w.text.splitlines() == LINES[:5] and w.first_line == 1 and w.truncated
    w = take_window(LINES, start_line=50, head=3, max_bytes=10_000)
    assert w.text.splitlines() == ["line 50", "line 51", "line 52"] and w.first_line == 50
    w = take_window(LINES, start_line=500, head=3, max_bytes=10_000)
    assert w.text == "" and w.first_line == 0 and w.truncated
    w = take_window(LINES[:3], max_bytes=10_000)
    assert w.text.splitlines() == LINES[:3] and not w.truncated


def test_window_byte_budget() -> None:
    w = take_window(LINES, tail=100, max_bytes=40)
    kept = w.text.splitlines()
    assert kept == LINES[-len(kept) :] and len(w.text.encode()) <= 40
    assert w.first_line == 101 - len(kept) and w.truncated
    w = take_window(LINES, head=100, max_bytes=40)
    assert w.text.splitlines() == LINES[: len(w.text.splitlines())]


def test_long_lines_are_clipped() -> None:
    w = take_window(["x" * 5000], head=1, max_bytes=10_000, max_line_chars=100)
    assert len(w.text) == 100 and w.text.endswith("[line truncated]")


def test_empty_window() -> None:
    w = take_window([], tail=10, max_bytes=100)
    assert (w.text, w.first_line, w.total_lines, w.truncated) == ("", 0, 0, False)


def test_truncate() -> None:
    assert truncate(None, 5) is None
    assert truncate("  short  ", 10) == "short"
    assert truncate("a" * 20, 10) == "a" * 9 + "…"


def test_cursor_round_trip() -> None:
    query = {"path": "x", "limit": 2}
    cursor = encode_cursor(4, query)
    assert decode_cursor(cursor, query) == 4
    assert decode_cursor(None, query) == 0
    page, following = paginate(list(range(10)), 4, 2, query)
    assert page == [4, 5] and following is not None
    assert decode_cursor(following, query) == 6
    assert paginate(list(range(5)), 4, 2, query) == ([4], None)


@pytest.mark.parametrize(
    "cursor", ["!!!", "e30", "abc/def", "abc+def", "a" * 500, encode_cursor(1, {"other": True})]
)
def test_bad_cursors(cursor: str) -> None:
    with pytest.raises(EmhubMcpError) as info:
        decode_cursor(cursor, {"path": "x"})
    assert info.value.kind is ErrorKind.VALIDATION
