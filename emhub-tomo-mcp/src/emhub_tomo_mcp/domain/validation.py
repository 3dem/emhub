# SPDX-License-Identifier: GPL-3.0-or-later
"""Checking job parameters against a job type's form before they are sent.

Parameter names must exist in the form, values must fit the parameter's type
(choices for enums, numbers for numeric parameters), and no value may contain
control characters or line breaks. Queue parameters (``queue.name`` and
``queue.param.<queue>.<name>``) without a fixed list of choices must also match
a conservative pattern.

Scalar values are sent as strings, the way the EMhub web forms send them;
booleans stay booleans, and table parameters (lists of rows) stay lists.
"""

from __future__ import annotations

import difflib
import re
from collections.abc import Iterator, Mapping
from dataclasses import dataclass
from typing import Any

from .job_types import _choices, _walk_form

NAME_RE = re.compile(r"^[A-Za-z0-9_.\-]{1,120}$")
CONTROL_RE = re.compile(r"[\x00-\x1f\x7f]")
QUEUE_VALUE_RE = re.compile(r"^[A-Za-z0-9_.,:@/=+\-]{0,200}$")
MAX_VALUE_CHARS = 4096
NUMBER_RE = re.compile(r"^[+-]?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?$")


@dataclass(frozen=True)
class FormParam:
    name: str
    kind: str  # the form's paramClass, e.g. "IntParam"
    choices: tuple[str, ...] | None
    hidden: bool  # never shown in the form (condition starting with "false")


def form_params(form: Mapping[str, Any]) -> dict[str, FormParam]:
    params = {}
    for _, _, raw in _walk_form(dict(form)):
        condition = str(raw.get("condition") or "").strip().lower()
        choices = _choices(raw.get("choices"))
        params[str(raw["name"])] = FormParam(
            name=str(raw["name"]),
            kind=str(raw.get("paramClass") or ""),
            choices=tuple(choices) if choices else None,
            hidden=condition.startswith("false"),
        )
    return params


def is_queue_param(name: str) -> bool:
    return name == "queue.name" or name.startswith("queue.param.")


def _strings(value: Any) -> Iterator[str]:
    if isinstance(value, str):
        yield value
    elif isinstance(value, Mapping):
        for k, v in value.items():
            yield str(k)
            yield from _strings(v)
    elif isinstance(value, list):
        for v in value:
            yield from _strings(v)


def _scalar_text(value: Any) -> str | None:
    if isinstance(value, bool) or value is None:
        return None
    if isinstance(value, (int, float, str)):
        return str(value).strip() if not isinstance(value, str) else value
    return None


def _coerce(param: FormParam, value: Any) -> tuple[Any, str | None]:
    """The value to send, or an error message."""
    kind = param.kind
    if kind == "BooleanParam":
        if isinstance(value, bool):
            return value, None
        if isinstance(value, str) and value.strip().lower() in ("true", "false", "yes", "no"):
            return value.strip().lower() in ("true", "yes"), None
        return None, "must be true or false"
    if kind == "TableParam":
        if isinstance(value, list) and all(isinstance(r, Mapping) for r in value):
            rows = []
            for row in value:
                bad = [k for k, v in row.items() if not isinstance(v, (str, int, float, bool))]
                if bad:
                    return None, f"table cells must be text or numbers (column {bad[0]})"
                rows.append({str(k): v for k, v in row.items()})
            return rows, None
        return None, "must be a list of rows (objects)"
    if kind == "MultiPointerParam" and isinstance(value, list):
        if all(isinstance(v, str) for v in value):
            return value, None
        return None, "must be a list of paths"
    text = _scalar_text(value)
    if text is None:
        return None, "must be text or a number"
    if kind == "IntParam":
        if not re.fullmatch(r"[+-]?\d+", text.strip()) and text.strip():
            return None, f"must be a whole number, got {text!r}"
        return text.strip(), None
    if kind == "FloatParam":
        if text.strip() and not NUMBER_RE.match(text.strip()):
            return None, f"must be a number, got {text!r}"
        return text.strip(), None
    if kind == "EnumParam" and param.choices and text not in param.choices:
        return None, f"must be one of: {', '.join(param.choices)}"
    return text, None


def validate_params(
    form: Mapping[str, Any], params: Mapping[str, Any], *, allow_unknown: bool = False
) -> tuple[dict[str, Any], list[str]]:
    """Return the values to send and a list of problems (empty if all is fine)."""
    spec = form_params(form)
    queues = spec["queue.name"].choices if "queue.name" in spec else None
    clean: dict[str, Any] = {}
    errors: list[str] = []
    for name, value in params.items():
        if not isinstance(name, str) or not NAME_RE.match(name):
            errors.append(f"{name!r}: not a valid parameter name")
            continue
        texts = list(_strings(value))
        if any(CONTROL_RE.search(t) for t in texts):
            errors.append(f"{name}: control characters and line breaks are not allowed")
            continue
        if any(len(t) > MAX_VALUE_CHARS for t in texts):
            errors.append(f"{name}: value longer than {MAX_VALUE_CHARS} characters")
            continue
        param = spec.get(name)
        if param is None:
            if allow_unknown and not is_queue_param(name):
                clean[name] = value
                continue
            close = difflib.get_close_matches(name, list(spec), n=3)
            hint = f" (did you mean {', '.join(close)}?)" if close else ""
            errors.append(f"{name}: not a parameter of this job type{hint}")
            continue
        if param.hidden:
            errors.append(f"{name}: an internal parameter that cannot be set")
            continue
        coerced, problem = _coerce(param, value)
        if problem:
            errors.append(f"{name}: {problem}")
            continue
        if is_queue_param(name):
            problem = _check_queue_value(name, coerced, param, queues)
            if problem:
                errors.append(f"{name}: {problem}")
                continue
        clean[name] = coerced
    return clean, errors


def _check_queue_value(
    name: str, value: Any, param: FormParam, queues: tuple[str, ...] | None
) -> str | None:
    if not isinstance(value, str):
        return "must be text"
    if name == "queue.name":
        if queues and value not in queues:
            return f"unknown queue; configured queues: {', '.join(queues)}"
        return None
    if param.choices:
        return None  # already checked against the choices
    if not QUEUE_VALUE_RE.match(value):
        return "may only contain letters, digits and _ . , : @ / = + -"
    return None


# A job type can use GPUs if its form has emwrap's 'gpus' or RELION's 'gpu_ids'.
GPU_PARAMS = ("gpus", "gpu_ids")


def job_gpus(params: Mapping[str, Any]) -> int:
    """GPUs a job of a GPU-capable type uses, counted as emwrap counts them when it
    submits the job to a cluster queue (``ProjectManager._count_job_gpus``): the
    distinct ids in RELION's ``gpu_ids`` if set ("0:1" -> 2), otherwise in emwrap's
    ``gpus`` ("3" -> 3, "0 0 1" -> 2, "0,1 2,3" -> 4). To stay on the safe side, a
    count that is empty, zero or unreadable is one, unless RELION's ``use_gpu`` is off
    and no ids are given."""
    gpu_ids = str(params.get("gpu_ids") or "").strip()
    if gpu_ids:
        return max(1, len(_ids(gpu_ids.replace(":", ","))))
    if str(params.get("use_gpu", "")).strip().lower() in ("no", "false", "0"):
        return 0
    text = str(params.get("gpus") if params.get("gpus") is not None else "").strip()
    quoted = len(text) > 1 and text[0] == text[-1] and text[0] in "\"'"
    if quoted:
        text = text[1:-1].strip()
    parts = text.split()
    if len(parts) == 1 and not quoted and "," not in parts[0]:
        return max(1, int(parts[0])) if parts[0].isdigit() else 1
    return max(1, len(_ids(",".join(parts))))


def _ids(text: str) -> set[str]:
    return {token.strip() for token in text.split(",") if token.strip()}
