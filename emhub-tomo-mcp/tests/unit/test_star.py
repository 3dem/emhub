# SPDX-License-Identifier: GPL-3.0-or-later
from __future__ import annotations

import pytest

from emhub_tomo_mcp.domain.star import parse_star
from emhub_tomo_mcp.errors import EmhubMcpError, ErrorKind
from emhub_tomo_mcp.services import Services

pytestmark = pytest.mark.anyio
PATH = "Export/job007/particles.star"


def test_parse_star() -> None:
    text = (
        "# comment\n\ndata_general\n\n_rlnA   1\n_rlnB 'two words'\n\n"
        'data_list\nloop_ \n_rlnX #1\n_rlnY #2\n1 a\n2 "b c"\n# in between\n3\n\n'
        "data_empty\nloop_\n_rlnZ #1\n"
    )
    general, table, empty = parse_star(text)
    assert (general.name, general.is_loop, general.columns, general.rows) == (
        "general",
        False,
        ["rlnA", "rlnB"],
        [["1", "two words"]],
    )
    assert table.is_loop and table.columns == ["rlnX", "rlnY"]
    assert table.rows == [["1", "a"], ["2", "b c"], ["3"]]
    assert empty.columns == ["rlnZ"] and empty.rows == []
    assert parse_star("no star here") == []
    assert parse_star("data_x\n_rlnBroken 'unclosed\n")[0].rows == [["'unclosed"]]


async def test_star_table_defaults_to_largest_loop(services: Services) -> None:
    ref = await services.projects.get(1)
    result = await services.files.star_table(
        ref, PATH, table=None, columns=None, limit=2, cursor=None, count_by=None
    )
    assert result.table == "particles" and result.total_rows == 4
    assert [(t.name, t.rows) for t in result.tables] == [
        ("general", 1),
        ("optics", 2),
        ("particles", 4),
    ]
    assert result.rows == [["TS_1", "10.0", "0.5"], ["TS_1", "-5.0", "0.4"]]
    assert result.first_row == 1 and result.next_cursor
    rest = await services.files.star_table(
        ref, PATH, table=None, columns=None, limit=2, cursor=result.next_cursor, count_by=None
    )
    # A short row is padded so every row has every selected column.
    assert rest.rows == [["TS_11", "3.0", "0.9"], ["TS_17", "1.0", ""]]
    assert rest.first_row == 3 and rest.next_cursor is None


async def test_star_table_columns_and_counts(services: Services) -> None:
    ref = await services.projects.get(1)
    result = await services.files.star_table(
        ref,
        PATH,
        table=None,
        columns=["TomoName", "rlnLCCmax"],
        limit=0,
        cursor=None,
        count_by="TomoName",
    )
    assert result.columns == ["rlnTomoName", "rlnLCCmax"] and result.rows == []
    assert result.counts == {"TS_1": 2, "TS_11": 1, "TS_17": 1}
    assert result.count_by == "rlnTomoName" and result.next_cursor is None
    optics = await services.files.star_table(
        ref, PATH, table="optics", columns=None, limit=10, cursor=None, count_by=None
    )
    assert optics.rows == [["1", "opticsGroup1"], ["2", "group two"]]


@pytest.mark.parametrize(
    ("kwargs", "kind", "fragment"),
    [
        ({"path": "Export/job007/nope.star"}, ErrorKind.NOT_FOUND, "particles.star"),
        ({"path": "Export/job007/empty.star"}, ErrorKind.VALIDATION, "no STAR tables"),
        ({"table": "particle"}, ErrorKind.NOT_FOUND, "Closest matches: particles"),
        ({"columns": ["LCC"]}, ErrorKind.NOT_FOUND, "rlnLCCmax"),
        ({"count_by": "zzz"}, ErrorKind.NOT_FOUND, "rlnTomoName"),
        ({"path": "../x.star"}, ErrorKind.VALIDATION, "'..'"),
    ],
)
async def test_star_table_errors(
    services: Services, kwargs: dict[str, object], kind: ErrorKind, fragment: str
) -> None:
    ref = await services.projects.get(1)
    args: dict[str, object] = {
        "path": PATH,
        "table": None,
        "columns": None,
        "limit": 10,
        "cursor": None,
        "count_by": None,
        **kwargs,
    }
    with pytest.raises(EmhubMcpError) as info:
        await services.files.star_table(ref, **args)  # type: ignore[arg-type]
    assert info.value.kind is kind and fragment in info.value.message
