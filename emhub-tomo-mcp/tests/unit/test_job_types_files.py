# SPDX-License-Identifier: GPL-3.0-or-later
from __future__ import annotations

import pytest
from fake_emhub import FakeEmhub

from emhub_tomo_mcp.errors import EmhubMcpError, ErrorKind
from emhub_tomo_mcp.services import Services

pytestmark = pytest.mark.anyio


async def test_registry(services: Services) -> None:
    registry = await services.job_types.registry()
    assert registry.source == "registry"
    assert [t.id for t in registry.job_types] == [
        "emw-import-ts",
        "emw-warp-mctf",
        "emw-warp-tsalign",
        "emw-warp-ctfrec",
        "emw-pytme",
    ]
    assert registry.job_types[1].output_type == "WarpMctf"
    await services.job_types.registry()
    assert len(services.job_types._api.client.__dict__) > 0


async def test_registry_falls_back_to_menu(services: Services, fake: FakeEmhub) -> None:
    fake.has_job_types = False
    registry = await services.job_types.registry()
    assert registry.source == "menu"
    ids = [t.id for t in registry.job_types]
    assert "emw-import-ts" in ids and "emw-warp-mctf" in ids
    assert len(ids) == len(set(ids))


async def test_require_unknown_type(services: Services) -> None:
    with pytest.raises(EmhubMcpError) as info:
        await services.job_types.require("emw-warp-mctff")
    assert info.value.kind is ErrorKind.NOT_FOUND and "emw-warp-mctf" in info.value.message


async def test_describe(services: Services, fake: FakeEmhub) -> None:
    ref = await services.projects.get(1)
    compact = await services.job_types.describe("emw-warp-mctf", ref, detail="compact")
    names = [p.name for p in compact.params]
    assert names[0] == "input_tiltseries" and "queue.name" in names
    # Hidden queue_name params ("false and ...") are counted, not listed.
    assert compact.hidden_params == 3 and not any("queue_name" in n for n in names)
    assert compact.queue_names == ["None", "cryo", "cryo_core", "rtx5000"]
    gpu = next(p for p in compact.params if p.name == "queue.param.cryo.gpu_type")
    assert (gpu.type, gpu.choices, gpu.condition) == (
        "enum",
        ["any", "V100", "A100"],
        "queue.name == 'cryo'",
    )
    line = next(p for p in compact.params if p.name == "fs_motion_and_ctf.c_range_min")
    assert (line.section, line.group, line.type) == ("CTF", "Resolution range", "float")
    full = await services.job_types.describe("emw-warp-mctf", ref, detail="full")
    long_help = [p for p in full.params if p.help and len(p.help) > 160]
    assert long_help, "full detail keeps the complete help texts"
    assert all(p.help is None or len(p.help) <= 160 for p in compact.params)
    # The form request asks for a new job of this type (run_id null).
    request = fake.calls_to("get_session_run")[-1]["attrs"]
    assert request == {
        "entry_id": 1,
        "run_id": None,
        "job_type": "emw-warp-mctf",
        "output": ["form"],
    }


async def test_describe_type_without_form(services: Services, fake: FakeEmhub) -> None:
    ref = await services.projects.get(1)
    fake.form = {
        "name": "emw-pytme",
        "sections": [{"label": "Parameters", "params": []}],
        "source": "jobstar",
    }
    with pytest.raises(EmhubMcpError) as info:
        await services.job_types.describe("emw-pytme", ref, detail="compact")
    assert info.value.kind is ErrorKind.NOT_FOUND and "no parameter form" in info.value.message


async def test_templates(services: Services, fake: FakeEmhub) -> None:
    templates = await services.job_types.templates()
    assert [t.id for t in templates.templates][:1] == ["apof-aretomo3"]
    assert templates.templates[1].title == "apof-warp-tutorial-otf"
    fake.has_workflows = False
    with pytest.raises(EmhubMcpError) as info:
        await services.job_types.templates()
    assert info.value.kind is ErrorKind.UNSUPPORTED and "get_workflows" in info.value.message


async def test_list_files(services: Services) -> None:
    ref = await services.projects.get(1)
    listing = await services.files.list(ref, ".", limit=3, cursor=None)
    assert [(e.name, e.kind) for e in listing.entries] == [
        ("data", "dir"),
        ("EMwrap", "dir"),
        ("WarpMctf", "dir"),
    ]
    assert listing.total == 6 and listing.next_cursor
    rest = await services.files.list(ref, ".", limit=3, cursor=listing.next_cursor)
    assert [(e.path, e.size) for e in rest.entries] == [
        ("default_pipeline.star", 14),
        ("latin1.log", 17),
        ("notes.txt", 21),
    ]
    stars = await services.files.list(
        ref, "WarpMctf/job003/", limit=10, cursor=None, pattern="*.star"
    )
    assert [e.path for e in stars.entries] == [
        "WarpMctf/job003/big.star",
        "WarpMctf/job003/job.star",
        "WarpMctf/job003/tilt_series.star",
    ]
    with pytest.raises(EmhubMcpError) as info:
        await services.files.list(ref, "Nope", limit=10, cursor=None)
    assert info.value.kind is ErrorKind.NOT_FOUND
    with pytest.raises(EmhubMcpError) as info:
        await services.files.list(ref, "../other", limit=10, cursor=None)
    assert info.value.kind is ErrorKind.VALIDATION


async def test_read_text(services: Services, fake: FakeEmhub) -> None:
    ref = await services.projects.get(1)
    path = "WarpMctf/job003/tilt_series.star"
    head = (
        await services.files.read(
            ref, path, tail_lines=None, head_lines=None, start_line=None, want_image=False
        )
    ).content
    assert head.first_line == 1 and head.total_lines == 500 and head.truncated
    assert head.text is not None and len(head.text.splitlines()) == 200
    tail = (
        await services.files.read(
            ref, path, tail_lines=2, head_lines=None, start_line=None, want_image=False
        )
    ).content
    assert tail.text == "row 499\nrow 500" and tail.first_line == 499
    middle = (
        await services.files.read(
            ref, path, tail_lines=None, head_lines=2, start_line=10, want_image=False
        )
    ).content
    assert middle.text == "row 10\nrow 11"
    # The file preview always gets the root from the project, never from the caller.
    assert fake.calls_to("get_file_preview")[-1]["attrs"] == {
        "root": "/data/projects/apof",
        "path": path,
    }


async def test_read_refusals(services: Services, fake: FakeEmhub) -> None:
    ref = await services.projects.get(1)

    async def read(path: str, image: bool = False) -> object:
        return (
            await services.files.read(
                ref, path, tail_lines=None, head_lines=None, start_line=None, want_image=image
            )
        ).content

    big = await read("WarpMctf/job003/big.star")
    assert "too large" in (big.note or "") and big.text is None  # type: ignore[attr-defined]
    other = await read("WarpMctf/job003/weird.bin")
    assert "cannot show this file type" in (other.note or "")  # type: ignore[attr-defined]
    for path, kind in (
        ("WarpMctf", ErrorKind.VALIDATION),
        (".", ErrorKind.VALIDATION),
        ("WarpMctf/job003/run.err", ErrorKind.NOT_FOUND),
        ("/etc/passwd", ErrorKind.VALIDATION),
    ):
        with pytest.raises(EmhubMcpError) as info:
            await read(path)
        assert info.value.kind is kind, path
    calls_before = len(fake.calls_to("get_file_preview"))
    with pytest.raises(EmhubMcpError) as info:
        await read("WarpMctf/job003/run.ou")
    assert "WarpMctf/job003/run.out" in info.value.message
    assert len(fake.calls_to("get_file_preview")) == calls_before


async def test_read_image(services: Services) -> None:
    ref = await services.projects.get(1)
    no_image = await services.files.read(
        ref,
        "WarpMctf/job003/preview.mrc",
        tail_lines=None,
        head_lines=None,
        start_line=None,
        want_image=False,
    )
    assert no_image.png is None and "as_image=true" in (no_image.content.note or "")
    image = await services.files.read(
        ref,
        "WarpMctf/job003/preview.mrc",
        tail_lines=None,
        head_lines=None,
        start_line=None,
        want_image=True,
    )
    assert image.png is not None and image.png.startswith(b"\x89PNG")
    assert image.content.image == {"name": "WarpMctf/job003/preview.mrc"}


async def test_unreadable_text_file(services: Services) -> None:
    ref = await services.projects.get(1)
    read = await services.files.read(
        ref, "latin1.log", tail_lines=None, head_lines=None, start_line=None, want_image=False
    )
    assert read.content.text is None
    assert "could not read this file as text" in (read.content.note or "")
    assert "utf-8" in (read.content.note or "")
