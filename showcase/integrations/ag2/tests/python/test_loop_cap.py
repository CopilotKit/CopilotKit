"""The per-run model-call cap that replaces ``max_consecutive_auto_reply``."""

from __future__ import annotations

import asyncio

from ag2 import Agent
from ag2.events import ToolCallEvent
from ag2.testing import TestConfig

from agents._loop_cap import LOOP_CAP_REPLY, loop_cap

calls = 0


def ping() -> str:
    """Count a tool call."""
    global calls
    calls += 1
    return "pong"


def _agent(cap: int, *turns) -> Agent:
    return Agent(
        "looping",
        config=TestConfig(*turns),
        tools=[ping],
        middleware=[loop_cap(cap)],
    )


def test_cap_ends_a_runaway_tool_loop():
    global calls
    calls = 0
    # The script would keep calling tools for 10 rounds; the cap stops it at 3.
    agent = _agent(3, *[ToolCallEvent("ping") for _ in range(10)], "done")

    reply = asyncio.run(agent.ask("go"))

    assert reply.body == LOOP_CAP_REPLY
    assert calls == 3


def test_cap_leaves_a_short_turn_alone():
    global calls
    calls = 0
    agent = _agent(3, ToolCallEvent("ping"), "done")

    reply = asyncio.run(agent.ask("go"))

    assert reply.body == "done"
    assert calls == 1


def test_cap_resets_between_runs_of_the_same_agent():
    global calls
    calls = 0
    # Each run spends the whole allowance: two tool rounds plus the final reply.
    # Agents are defined once at module level, so a count that leaked across
    # runs would cap the second run on its first model call.
    agent = _agent(3, ToolCallEvent("ping"), ToolCallEvent("ping"), "done")

    first = asyncio.run(agent.ask("go"))
    second = asyncio.run(agent.ask("go"))

    assert first.body == "done"
    assert second.body == "done"
    assert calls == 4
