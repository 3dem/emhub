# SPDX-License-Identifier: GPL-3.0-or-later
"""Path containment: every accepted path stays inside the project folder."""

from __future__ import annotations

import posixpath

import pytest
from hypothesis import given
from hypothesis import strategies as st

from emhub_tomo_mcp.domain.paths import file_kind, normalize_project_path
from emhub_tomo_mcp.errors import EmhubMcpError, ErrorKind


@pytest.mark.parametrize(
    ("path", "expected"),
    [
        ("", "."),
        (".", "."),
        ("  ./ ", "."),
        ("WarpMctf/job002", "WarpMctf/job002"),
        ("WarpMctf/job002/", "WarpMctf/job002"),
        ("./WarpMctf//job002/./run.out", "WarpMctf/job002/run.out"),
        ("data/frames", "data/frames"),
        ("a..b/c..", "a..b/c.."),
        ("%2e%2e/etc", "%2e%2e/etc"),  # a literal folder name; nothing decodes it
        ("…", "…"),  # one character (horizontal ellipsis), not '..'
    ],
)
def test_accepted(path: str, expected: str) -> None:
    assert normalize_project_path(path) == expected


@pytest.mark.parametrize(
    "path",
    [
        "/etc/passwd",
        "//server/share",
        "~/secret",
        "~root",
        "..",
        "../x",
        "a/../../b",
        "a/..",
        "WarpMctf/job002/../../../etc",
        "a\\..\\b",
        "a\x00b",
        "a\nb",
        "a\x7fb",
        "．．/x",  # fullwidth dots fold to '..'
        "／etc",  # fullwidth solidus folds to '/'
        "x" * 2000,
    ],
)
def test_rejected(path: str) -> None:
    with pytest.raises(EmhubMcpError) as info:
        normalize_project_path(path)
    assert info.value.kind is ErrorKind.VALIDATION


def check_inside(path: str) -> None:
    try:
        result = normalize_project_path(path)
    except EmhubMcpError:
        return
    assert not result.startswith("/")
    assert ".." not in result.split("/")
    joined = posixpath.normpath(posixpath.join("/project", result))
    assert joined == "/project" or joined.startswith("/project/")


@given(st.text(max_size=60))
def test_accepted_paths_stay_inside(path: str) -> None:
    check_inside(path)


@given(st.lists(st.sampled_from(["a", "..", ".", "", "b", "~", "\\"]), max_size=8))
def test_segment_combinations(segments: list[str]) -> None:
    check_inside("/".join(segments))


@pytest.mark.parametrize(
    ("name", "kind"),
    [
        ("run.out", "text"),
        ("x.STAR", "text"),
        ("a.png", "image"),
        ("t.mrc", "em"),
        ("m.population", "text"),
        ("noext", "other"),
        ("a.bin", "other"),
    ],
)
def test_file_kind(name: str, kind: str) -> None:
    assert file_kind(name) == kind
