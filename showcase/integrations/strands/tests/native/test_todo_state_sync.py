"""Browser edits must reach native state even on turns without a write tool."""

import asyncio
import sys
from pathlib import Path
from types import SimpleNamespace

from strands import Agent
from strands.hooks import BeforeInvocationEvent
from strands.models.openai import OpenAIModel

ROOT = Path(__file__).resolve().parents[2]
sys.path[:0] = [str(ROOT / "src"), str(ROOT)]
from agents.todo_state_sync import TodoStateAgent, TodoStateHook


class CaptureDelegate:
    async def run(self, input_data, *, invocation_state):
        yield invocation_state


def test_browser_edits_are_request_scoped_and_include_empty_lists():
    wrapper = TodoStateAgent(CaptureDelegate())

    async def capture(state):
        return [event async for event in wrapper.run(SimpleNamespace(state=state))]

    supplied = {
        "todos": [
            {
                "id": "cedar",
                "title": "Cedar",
                "description": "Follow up Cedar",
                "status": "pending",
            }
        ]
    }
    payload = asyncio.run(capture(supplied))[0]
    agent = Agent(
        model=OpenAIModel(client_args={"api_key": "unused"}, model_id="gpt-4o"),
        state={"todos": [{"id": "cedar", "title": "Cedar", "status": "completed"}]},
        callback_handler=None,
    )
    hook = TodoStateHook()
    hook.sync(BeforeInvocationEvent(agent=agent, invocation_state=payload))
    assert agent.state.get("todos")[0]["status"] == "pending"
    assert agent.state.get("todos")[0]["description"] == "Follow up Cedar"
    saved = agent.state.get("todos")
    # No incoming todos means keep the restored session, not reset it.
    hook.sync(
        BeforeInvocationEvent(agent=agent, invocation_state=asyncio.run(capture({}))[0])
    )
    assert agent.state.get("todos") == saved
    # An explicitly cleared board is authoritative.
    hook.sync(
        BeforeInvocationEvent(
            agent=agent, invocation_state=asyncio.run(capture({"todos": []}))[0]
        )
    )
    assert agent.state.get("todos") == []
    assert supplied["todos"][0]["id"] == "cedar"


def test_closing_wrapper_closes_delegate():
    closed = []

    class Delegate:
        async def run(self, _input, *, invocation_state):
            try:
                yield invocation_state
            finally:
                closed.append(True)

    async def cancel():
        events = TodoStateAgent(Delegate()).run(SimpleNamespace(state={}))
        await anext(events)
        await events.aclose()
        assert closed == [True]

    asyncio.run(cancel())
