"""Demo agents end to end: the real Agents SDK and the real adapter, driven by
a scripted model.

The interrupt tests build each resume from the previous run's
MESSAGES_SNAPSHOT, the way a client does, so they also show that nothing on
the server carries over between the two runs.
"""

from __future__ import annotations

from typing import Any

import httpx
import pytest
from ag_ui.core import Context, EventType, ResumeEntry, UserMessage
from ag_ui_openai_agents import OpenAIAgentsAgent
from scripted_model import ScriptedModel, call, collect, run_input, text

from demo_agents._header_forwarding import get_forwarded_headers
from demo_agents.gen_ui_agent import gen_ui_agent
from demo_agents.interrupt_agent import SchedulerAgent, interrupt_agent
from demo_agents.shared_state import shared_state_read_write_agent
from demo_agents.shared_state_streaming import (
    DocumentStreamingAgent,
    shared_state_streaming_agent,
)


def kinds(events) -> list[str]:
    return [event.type for event in events]


def finished(events):
    [event] = [e for e in events if e.type == EventType.RUN_FINISHED]
    return event


@pytest.mark.asyncio
async def test_tool_state_streams_between_the_call_and_its_result():
    model = ScriptedModel(
        [
            call(
                "set_steps",
                {"steps": [{"id": "1", "title": "Plan", "status": "pending"}]},
                "c1",
            )
        ],
        [text("All planned.")],
    )
    agent = OpenAIAgentsAgent(gen_ui_agent.clone(model=model))
    events = await collect(
        agent, run_input([UserMessage(id="u1", role="user", content="plan")])
    )
    order = kinds(events)

    assert EventType.RUN_ERROR not in order
    snapshot = order.index(EventType.STATE_SNAPSHOT)
    assert (
        order.index(EventType.TOOL_CALL_START)
        < snapshot
        < order.index(EventType.TOOL_CALL_RESULT)
    )
    assert events[snapshot].snapshot == {
        "steps": [{"id": "1", "title": "Plan", "status": "pending"}]
    }


@pytest.mark.asyncio
async def test_the_model_sees_the_state_and_the_app_context():
    model = ScriptedModel([text("Hi Atai.")])
    agent = OpenAIAgentsAgent(shared_state_read_write_agent.clone(model=model))
    await collect(
        agent,
        run_input(
            [UserMessage(id="u1", role="user", content="hi")],
            state={"preferences": {"tone": "formal"}},
            context=[Context(description="User name", value="Atai")],
        ),
    )
    instructions = model.calls[0]["instructions"]
    assert '"tone": "formal"' in instructions
    assert "User name: Atai" in instructions


@pytest.mark.asyncio
async def test_the_document_streams_into_state_before_the_call_ends():
    document = "Crimson and amber in slow descent."
    model = ScriptedModel(
        [call("write_document", {"document": document}, "c1")],
        [text("Written.")],
        chunk=8,
    )
    agent = DocumentStreamingAgent(shared_state_streaming_agent.clone(model=model))
    events = await collect(
        agent,
        run_input(
            [UserMessage(id="u1", role="user", content="poem about autumn leaves")]
        ),
    )
    order = kinds(events)
    end = order.index(EventType.TOOL_CALL_END)
    streamed = [
        event.delta[0].value
        for event in events[:end]
        if event.type == EventType.STATE_DELTA
    ]

    assert EventType.RUN_ERROR not in order
    assert len(streamed) > 2
    assert all(document.startswith(part) for part in streamed)
    assert streamed[-1] == document
    # The tool body commits the same text once the call runs.
    [committed] = [e for e in events if e.type == EventType.STATE_SNAPSHOT]
    assert committed.snapshot == {"document": document}


# ── Interrupts ──────────────────────────────────────────────────────────────

PICK = {"chosen_time": "2026-11-04T10:00:00Z", "chosen_label": "Wed 10:00"}


async def book(*turns: list[Any]) -> tuple[ScriptedModel, SchedulerAgent, list]:
    """Runs the scheduler until it pauses on ``schedule_meeting``."""
    model = ScriptedModel(
        [call("schedule_meeting", {"topic": "Intro call"}, "c1")], *turns
    )
    agent = SchedulerAgent(interrupt_agent.clone(model=model))
    events = await collect(
        agent,
        run_input([UserMessage(id="u1", role="user", content="book an intro call")]),
    )
    return model, agent, events


async def resume(agent: SchedulerAgent, paused: list, payload: dict) -> list:
    """Answers the paused call from the paused run's snapshot alone."""
    [snapshot] = [e for e in paused if e.type == EventType.MESSAGES_SNAPSHOT]
    run = run_input(snapshot.messages).model_copy(
        update={
            "resume": [
                ResumeEntry(interrupt_id="c1", status="resolved", payload=payload)
            ]
        }
    )
    return await collect(agent, run)


def tool_result(events) -> str:
    [result] = [e for e in events if e.type == EventType.TOOL_CALL_RESULT]
    return result.content


@pytest.mark.asyncio
async def test_schedule_meeting_pauses_with_an_interrupt():
    model, _, events = await book()
    outcome = finished(events).outcome

    assert outcome.type == "interrupt"
    [interrupt] = outcome.interrupts
    assert interrupt.id == interrupt.tool_call_id == "c1"
    assert interrupt.metadata["tool_input"] == {"topic": "Intro call"}
    assert EventType.TOOL_CALL_RESULT not in kinds(events)
    assert len(model.calls) == 1


@pytest.mark.asyncio
async def test_the_picked_time_reaches_the_tool():
    model, agent, paused = await book([text("Booked for Wed 10:00.")])
    events = await resume(agent, paused, {"approved": True, **PICK})

    assert tool_result(events) == "Meeting scheduled for Wed 10:00: Intro call"
    assert finished(events).outcome.type == "success"
    sent = model.calls[-1]["input"]
    assert any(
        item.get("type") == "function_call_output"
        and "Wed 10:00" in item.get("output", "")
        for item in sent
    )


@pytest.mark.asyncio
async def test_a_cancelled_pick_does_not_run_the_tool():
    _, agent, paused = await book([text("No meeting, then.")])
    events = await resume(agent, paused, {"approved": False})

    assert "not approved" in tool_result(events)


# ── HTTP ────────────────────────────────────────────────────────────────────


class RecordingModel(ScriptedModel):
    """Records the forwarded headers each model call would carry."""

    def __init__(self, *turns: list[Any]) -> None:
        super().__init__(*turns)
        self.headers: list[dict[str, str]] = []

    def stream_response(self, *args, **kwargs):
        self.headers.append(dict(get_forwarded_headers()))
        return super().stream_response(*args, **kwargs)


@pytest.mark.asyncio
async def test_a_request_s_mock_headers_reach_its_model_calls(monkeypatch):
    import agent_server

    model = RecordingModel([text("Hello.")])
    wrapper = agent_server.AGENTS["agentic_chat"]
    monkeypatch.setattr(wrapper, "agent", wrapper.agent.clone(model=model))

    transport = httpx.ASGITransport(app=agent_server.app)
    async with httpx.AsyncClient(
        transport=transport, base_url="http://agent"
    ) as client:
        response = await client.post(
            "/agentic_chat",
            json=run_input(
                [UserMessage(id="u1", role="user", content="hi")]
            ).model_dump(by_alias=True),
            headers={"x-test-id": "t-1", "accept": "text/event-stream"},
        )

    assert response.status_code == 200
    assert "RUN_FINISHED" in response.text
    assert model.headers and model.headers[0].get("x-test-id") == "t-1"
