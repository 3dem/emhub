# SPDX-License-Identifier: GPL-3.0-or-later
"""Tool results and error handling shared by tools, resources and prompts."""

import functools
import inspect
import json
import logging
import time
from collections.abc import Awaitable, Callable, Sequence
from typing import Any, ParamSpec, TypeVar

from mcp.server.mcpserver.exceptions import ResourceError, ToolError
from mcp.types import CallToolResult, ContentBlock, TextContent
from pydantic import BaseModel

from ..errors import EmhubMcpError, new_correlation_id

logger = logging.getLogger("emhub_tomo_mcp.tools")

P = ParamSpec("P")
R = TypeVar("R")


def respond(model: BaseModel, summary: str, extra: Sequence[ContentBlock] = ()) -> CallToolResult:
    """A result with the data as structured content, and as compact JSON after
    a one-line summary in the text content (for clients that only show text)."""
    data = model.model_dump(mode="json")
    text = summary + "\n" + json.dumps(data, ensure_ascii=False, separators=(",", ":"))
    return CallToolResult(
        content=[TextContent(type="text", text=text), *extra], structured_content=data
    )


def _log_failure(name: str, cid: str, exc: EmhubMcpError) -> None:
    logger.warning("%s failed [%s] %s (ref %s)", name, exc.kind.value, exc.message, cid)
    if exc.log_detail:
        logger.warning("ref %s detail: %s", cid, exc.log_detail)


def guarded_tool(fn: Callable[P, Awaitable[R]]) -> Callable[P, Awaitable[R]]:
    """Turn anticipated errors into short tool errors with a correlation id;
    log unexpected ones with their traceback and hide their text."""
    name = fn.__name__

    @functools.wraps(fn)
    async def wrapper(*args: P.args, **kwargs: P.kwargs) -> R:
        cid = new_correlation_id()
        started = time.monotonic()
        try:
            return await fn(*args, **kwargs)
        except EmhubMcpError as exc:
            _log_failure(name, cid, exc)
            raise ToolError(exc.to_tool_message(cid)) from None
        except ToolError:
            raise
        except Exception:
            logger.exception("%s crashed (ref %s)", name, cid)
            raise ToolError(
                f"[internal_error] Unexpected error in the MCP server (ref {cid}); "
                "details are in its log."
            ) from None
        finally:
            logger.info("%s took %.2f s", name, time.monotonic() - started)

    # Tool descriptions come from docstrings: send them without source indentation.
    wrapper.__doc__ = inspect.cleandoc(fn.__doc__ or "")
    return wrapper


def guarded_resource(fn: Callable[P, Awaitable[R]]) -> Callable[P, Awaitable[R]]:
    name = fn.__name__

    @functools.wraps(fn)
    async def wrapper(*args: P.args, **kwargs: P.kwargs) -> R:
        cid = new_correlation_id()
        try:
            return await fn(*args, **kwargs)
        except EmhubMcpError as exc:
            _log_failure(name, cid, exc)
            raise ResourceError(exc.to_tool_message(cid)) from None

    return wrapper


IRREGULAR_PLURALS = {"entry": "entries"}


def plural(n: int, word: str) -> str:
    if n == 1:
        return f"{n} {word}"
    return f"{n} {IRREGULAR_PLURALS.get(word, word + 's')}"


def counts_text(counts: dict[str, Any]) -> str:
    return ", ".join(f"{v} {k}" for k, v in sorted(counts.items(), key=lambda kv: -int(kv[1])))
