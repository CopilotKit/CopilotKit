"""Keep PydanticAI delegation results and AG-UI state events together."""

from __future__ import annotations

import asyncio
import os
from types import SimpleNamespace

os.environ.setdefault("OPENAI_API_KEY", "sk-test-subagent-state")

from ag_ui.core import EventType, RunAgentInput, StateSnapshotEvent, UserMessage  # noqa: E402
from pydantic_ai import ToolReturn  # noqa: E402
from pydantic_ai.models.test import TestModel  # noqa: E402
from pydantic_ai.ui import StateDeps  # noqa: E402
from pydantic_ai.ui.ag_ui import AGUIAdapter  # noqa: E402

from agents import subagents  # noqa: E402


def test_success_returns_result_and_shared_state_event(monkeypatch):
    """The browser receives a delegation even when the tool text is valid."""

    async def invoke(_agent, _task):
        return "Research result"

    monkeypatch.setattr(subagents, "_invoke_sub_agent", invoke)
    state = subagents.SubagentsState()
    ctx = SimpleNamespace(deps=SimpleNamespace(state=state))

    result = asyncio.run(
        subagents._delegate(
            ctx,
            sub_agent="research_agent",
            sub_agent_obj=subagents._research_agent,
            task="Research a topic",
        )
    )

    assert isinstance(result, ToolReturn)
    assert result.return_value == "Research result"
    assert len(result.metadata) == 1
    snapshot = result.metadata[0]
    assert isinstance(snapshot, StateSnapshotEvent)
    assert snapshot.snapshot["delegations"][0]["status"] == "completed"
    assert snapshot.snapshot["delegations"][0]["result"] == "Research result"
    assert len(state.delegations) == 1


def test_failed_subagent_returns_failure_and_shared_state_event(monkeypatch):
    """A failed delegation remains visible to the user and supervisor."""

    async def invoke(_agent, _task):
        raise RuntimeError("provider unavailable")

    monkeypatch.setattr(subagents, "_invoke_sub_agent", invoke)
    state = subagents.SubagentsState()
    ctx = SimpleNamespace(deps=SimpleNamespace(state=state))

    result = asyncio.run(
        subagents._delegate(
            ctx,
            sub_agent="writing_agent",
            sub_agent_obj=subagents._writing_agent,
            task="Write a draft",
        )
    )

    assert isinstance(result, ToolReturn)
    assert "RuntimeError" in result.return_value
    assert result.metadata[0].snapshot["delegations"][0]["status"] == "failed"
    assert len(state.delegations) == 1


def test_ag_ui_stream_sends_delegation_state_to_browser(monkeypatch):
    """The installed PydanticAI adapter forwards the tool's state event."""

    async def invoke(_agent, _task):
        return "Research result"

    monkeypatch.setattr(subagents, "_invoke_sub_agent", invoke)
    request = RunAgentInput(
        threadId="test-thread",
        runId="test-run",
        state={"delegations": []},
        messages=[UserMessage(id="user-1", content="Research a topic")],
        tools=[],
        context=[],
        forwardedProps={},
    )

    async def run():
        with subagents.agent.override(model=TestModel(call_tools=["research_agent"])):
            return [
                event
                async for event in AGUIAdapter(subagents.agent, request).run_stream(
                    deps=StateDeps(subagents.SubagentsState())
                )
            ]

    events = asyncio.run(run())
    snapshots = [event for event in events if event.type == EventType.STATE_SNAPSHOT]
    assert len(snapshots) == 1
    assert snapshots[0].snapshot["delegations"][0]["result"] == "Research result"
    assert events[-1].type == EventType.RUN_FINISHED
