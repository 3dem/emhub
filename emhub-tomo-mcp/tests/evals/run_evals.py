#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-3.0-or-later
"""Agentic evals: Claude Code (headless) answering questions through this server.

Each scenario in a JSON file has a prompt and deterministic checks:

- ``must``: regular expressions the answer has to match (all of them);
- ``must_not``: regular expressions the answer must not match;
- ``max_calls``: a budget for the number of MCP tool calls.

The run uses only this server's tools (``--strict-mcp-config``; the built-in
tools are disabled), so nothing outside EMhub can be read or changed. It costs
API usage: the report lists the cost of every scenario.

    python tests/evals/run_evals.py --mcp-config mcp.json \
        --scenarios tests/evals/apof_scenarios.json [--only NAME ...] [--repeat 1] [--out FILE]
"""

from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
import tempfile
import time
from pathlib import Path
from typing import Any

BUILTIN_TOOLS = "Bash,Read,Edit,Write,Glob,Grep,WebFetch,WebSearch,Task,NotebookEdit,TodoWrite"


def run_claude(
    prompt: str, mcp_config: Path, max_turns: int, timeout: int
) -> tuple[list[dict[str, Any]], str]:
    with tempfile.TemporaryDirectory(prefix="emhub-eval-") as cwd:
        proc = subprocess.run(
            [
                "claude",
                "-p",
                prompt,
                "--mcp-config",
                str(mcp_config.resolve()),  # claude runs in a temporary folder
                "--strict-mcp-config",
                "--allowedTools",
                "mcp__emhub-tomo",
                "--disallowedTools",
                BUILTIN_TOOLS,
                "--max-turns",
                str(max_turns),
                "--output-format",
                "stream-json",
                "--verbose",
            ],
            cwd=cwd,
            capture_output=True,
            text=True,
            timeout=timeout,
            stdin=subprocess.DEVNULL,
            check=False,
        )
    events = []
    for line in proc.stdout.splitlines():
        try:
            events.append(json.loads(line))
        except ValueError:
            continue
    return events, proc.stderr


def grade(scenario: dict[str, Any], events: list[dict[str, Any]], stderr: str) -> dict[str, Any]:
    calls, errors = [], 0
    for ev in events:
        if ev.get("type") == "assistant":
            for block in ev["message"].get("content", []):
                if block.get("type") == "tool_use" and block["name"].startswith("mcp__"):
                    calls.append(block["name"].removeprefix("mcp__emhub-tomo__"))
        if ev.get("type") == "user":
            for block in ev.get("message", {}).get("content", []):
                if (
                    isinstance(block, dict)
                    and block.get("type") == "tool_result"
                    and block.get("is_error")
                ):
                    errors += 1
    result = next((ev for ev in events if ev.get("type") == "result"), {})
    answer = result.get("result") or ""
    problems = []
    for pattern in scenario.get("must", []):
        if not re.search(pattern, answer, re.IGNORECASE | re.DOTALL):
            problems.append(f"missing /{pattern}/")
    for pattern in scenario.get("must_not", []):
        if re.search(pattern, answer, re.IGNORECASE | re.MULTILINE):
            problems.append(f"forbidden /{pattern}/")
    if len(calls) > scenario.get("max_calls", 40):
        problems.append(f"{len(calls)} tool calls > {scenario.get('max_calls', 40)}")
    if not result:
        problems.append(f"no result (timeout or crash): {stderr.strip()[-300:]}")
    return {
        "scenario": scenario["name"],
        "passed": not problems,
        "problems": problems,
        "tool_calls": len(calls),
        "tool_errors": errors,
        "tools": calls,
        "cost_usd": result.get("total_cost_usd", 0.0),
        "turns": result.get("num_turns"),
        "seconds": round(result.get("duration_ms", 0) / 1000),
        "answer": answer,
    }


def regrade(scenarios: list[dict[str, Any]], saved: Path) -> int:
    by_name = {s["name"]: s for s in scenarios}
    passed = total = 0
    for line in saved.read_text().splitlines():
        old = json.loads(line)
        scenario = by_name.get(old["scenario"])
        if scenario is None:
            continue
        events = [{"type": "result", "result": old["answer"]}] + [
            {
                "type": "assistant",
                "message": {"content": [{"type": "tool_use", "name": f"mcp__emhub-tomo__{t}"}]},
            }
            for t in old["tools"]
        ]
        outcome = grade(scenario, events, "")
        total += 1
        passed += outcome["passed"]
        mark = "PASS" if outcome["passed"] else "FAIL"
        print(f"{mark} {old['scenario']:28} {'; '.join(outcome['problems'])}")
    print(f"\n{passed}/{total} passed (regraded)")
    return 0 if passed == total else 1


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--mcp-config", type=Path, required=True)
    parser.add_argument("--scenarios", type=Path, required=True)
    parser.add_argument("--only", nargs="*")
    parser.add_argument("--repeat", type=int, default=1)
    parser.add_argument("--max-turns", type=int, default=30)
    parser.add_argument("--timeout", type=int, default=900)
    parser.add_argument("--out", type=Path)
    parser.add_argument(
        "--regrade",
        type=Path,
        help="re-apply the checks to the answers saved in this results file (no new runs)",
    )
    args = parser.parse_args()

    scenarios = json.loads(args.scenarios.read_text())
    if args.only:
        scenarios = [s for s in scenarios if s["name"] in args.only]
    if args.regrade:
        return regrade(scenarios, args.regrade)
    results = []
    for scenario in scenarios:
        for attempt in range(args.repeat):
            started = time.monotonic()
            events, stderr = run_claude(
                scenario["prompt"], args.mcp_config, args.max_turns, args.timeout
            )
            outcome = grade(scenario, events, stderr)
            outcome["attempt"] = attempt + 1
            results.append(outcome)
            mark = "PASS" if outcome["passed"] else "FAIL"
            print(
                f"{mark} {scenario['name']:28} calls={outcome['tool_calls']:3} "
                f"errors={outcome['tool_errors']:2} ${outcome['cost_usd']:.2f} "
                f"{time.monotonic() - started:5.0f}s  {'; '.join(outcome['problems'])}",
                flush=True,
            )
            if args.out:
                with args.out.open("a") as f:
                    f.write(json.dumps(outcome) + "\n")
    passed = sum(r["passed"] for r in results)
    cost = sum(r["cost_usd"] for r in results)
    print(f"\n{passed}/{len(results)} passed; total cost ${cost:.2f}")
    return 0 if passed == len(results) else 1


if __name__ == "__main__":
    sys.exit(main())
