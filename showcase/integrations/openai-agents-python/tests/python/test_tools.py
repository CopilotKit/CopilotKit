"""The package's own tools, instructions and model-call wiring, one at a time.

``test_runs.py`` drives them through the adapter.
"""

from __future__ import annotations

import json
from types import SimpleNamespace
from typing import Any

import httpx
import pytest
from ag_ui.core import EventType
from ag_ui_openai_agents import SharedState, use_shared_state
from agents import Agent, FunctionTool, RunContextWrapper
from agents.tool_context import ToolContext

from demo_agents._common import SLUG, _forward_request_headers
from demo_agents._header_forwarding import set_forwarded_headers


async def invoke(tool: FunctionTool, state: SharedState, args: dict[str, Any]) -> Any:
    """Runs ``tool`` the way the SDK does, inside a run with ``state``."""
    arguments = json.dumps(args)
    context = ToolContext(
        context=None,
        tool_name=tool.name,
        tool_call_id="call_test",
        tool_arguments=arguments,
    )
    with use_shared_state(state):
        return await tool.on_invoke_tool(context, arguments)


def snapshots(state: SharedState) -> list[Any]:
    events = state.drain()
    assert all(event.type == EventType.STATE_SNAPSHOT for event in events)
    return [event.snapshot for event in events]


# ── State-writing tools ─────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_set_notes_replaces_the_notes_slot():
    from demo_agents.shared_state import set_notes

    state = SharedState({"preferences": {"name": "Ada"}, "notes": ["old"]})
    assert await invoke(set_notes, state, {"notes": ["old", "new"]}) == "Notes updated."
    assert snapshots(state) == [
        {"preferences": {"name": "Ada"}, "notes": ["old", "new"]}
    ]


@pytest.mark.asyncio
async def test_set_steps_publishes_steps():
    from demo_agents.gen_ui_agent import set_steps

    state = SharedState()
    steps = [{"id": "s1", "title": "Plan", "status": "in_progress"}]
    await invoke(set_steps, state, {"steps": steps})
    assert snapshots(state) == [{"steps": steps}]


@pytest.mark.asyncio
async def test_manage_todos_assigns_ids_and_get_todos_reads_them():
    from demo_agents.beautiful_chat import get_todos, manage_todos

    state = SharedState()
    todos = [{"id": "", "title": "Read docs", "status": "pending"}]
    await invoke(manage_todos, state, {"todos": todos})
    stored = state.value["todos"]
    assert stored[0]["id"]  # a fresh id was assigned
    assert await invoke(get_todos, state, {}) == stored


@pytest.mark.asyncio
async def test_write_document_commits_the_final_text():
    from demo_agents.shared_state_streaming import write_document

    state = SharedState({"document": "partial"})
    await invoke(write_document, state, {"document": "full text"})
    assert state.value == {"document": "full text"}


@pytest.mark.asyncio
async def test_subagent_delegations_are_logged(monkeypatch):
    from demo_agents import subagents

    async def fake_run(agent, task):
        return SimpleNamespace(final_output=f"{agent.name} did {task}")

    monkeypatch.setattr(subagents.Runner, "run", fake_run)
    state = SharedState({"delegations": []})
    output = await invoke(subagents.research_agent, state, {"task": "topic"})

    assert output == "research_agent did topic"
    [snapshot] = snapshots(state)
    [entry] = snapshot["delegations"]
    assert {k: entry[k] for k in ("sub_agent", "task", "status", "result")} == {
        "sub_agent": "research_agent",
        "task": "topic",
        "status": "completed",
        "result": "research_agent did topic",
    }


@pytest.mark.asyncio
async def test_empty_subagent_output_is_marked(monkeypatch):
    from demo_agents import subagents

    async def fake_run(agent, task):
        return SimpleNamespace(final_output="  ")

    monkeypatch.setattr(subagents.Runner, "run", fake_run)
    output = await invoke(subagents.critique_agent, SharedState(), {"task": "draft"})
    assert output == subagents.SUB_AGENT_EMPTY_SENTINEL


# ── Instructions ────────────────────────────────────────────────────────────


def test_with_state_adds_the_state_as_json():
    from demo_agents.shared_state import with_state

    with use_shared_state(SharedState({"recipe": {"title": "Soup"}})):
        text = with_state("Cook.")(RunContextWrapper(context=None), Agent(name="a"))
    assert text.startswith("Cook.")
    assert json.dumps({"recipe": {"title": "Soup"}}) in text


def test_with_state_is_the_prompt_when_there_is_no_state():
    from demo_agents.shared_state import with_state

    with use_shared_state(SharedState()):
        assert (
            with_state("Cook.")(RunContextWrapper(context=None), Agent(name="a"))
            == "Cook."
        )


# ── Header forwarding ───────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_model_calls_carry_mock_headers_and_this_slug():
    set_forwarded_headers(
        {
            "x-aimock-strict": "1",
            "x-aimock-context": "someone-else",
            "x-test-id": "t-1",
            "x-diag-run-id": "r-1",
            "x-forwarded-for": "10.0.0.1",
        }
    )
    request = httpx.Request("POST", "http://aimock/v1/responses")
    await _forward_request_headers(request)
    assert request.headers["x-aimock-context"] == SLUG
    assert request.headers["x-aimock-strict"] == "1"
    assert request.headers["x-test-id"] == "t-1"
    assert request.headers["x-diag-run-id"] == "r-1"
    assert "x-forwarded-for" not in request.headers


# ── A2UI ────────────────────────────────────────────────────────────────────


def test_render_args_accept_json_strings_and_values():
    from demo_agents.a2ui_dynamic import coerce_render_args

    as_strings = coerce_render_args(
        {"surfaceId": "s", "components": '{"id": "root"}', "data": "{}"}
    )
    assert as_strings == {"surfaceId": "s", "components": [{"id": "root"}], "data": {}}
    as_values = coerce_render_args({"surfaceId": "s", "components": [{"id": "root"}]})
    assert as_values["components"] == [{"id": "root"}]
    broken = coerce_render_args({"surfaceId": "s", "components": "[not json"})
    assert broken["components"] == "[not json"  # left for validation to reject
