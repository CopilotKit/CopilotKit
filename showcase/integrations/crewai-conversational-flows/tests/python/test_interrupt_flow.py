"""Contracts for CrewAI's native async Flow interrupt/resume path."""

import json

from pathlib import Path
from types import SimpleNamespace

import pytest
from crewai.flow import HumanFeedbackResult
from crewai.flow.async_feedback import HumanFeedbackPending
from crewai.flow.persistence.sqlite import SQLiteFlowPersistence


INTEGRATION_ROOT = Path(__file__).resolve().parents[2]
AGENT_SERVER = INTEGRATION_ROOT / "src" / "agent_server.py"
INLINE_PAGE = (
    INTEGRATION_ROOT / "src" / "app" / "demos" / "gen-ui-interrupt" / "page.tsx"
)
HEADLESS_PAGE = (
    INTEGRATION_ROOT / "src" / "app" / "demos" / "interrupt-headless" / "page.tsx"
)
TIME_PICKER = (
    INTEGRATION_ROOT
    / "src"
    / "app"
    / "demos"
    / "gen-ui-interrupt"
    / "_components"
    / "time-picker-card.tsx"
)
AIMOCK_ROOT = (
    INTEGRATION_ROOT.parents[1] / "aimock" / "d6" / "crewai-conversational-flows"
)


def _response(message):
    return SimpleNamespace(choices=[SimpleNamespace(message=message)])


@pytest.mark.asyncio
async def test_interrupt_flow_calls_llm_before_and_after_feedback(monkeypatch):
    from agents import interrupt_flow as module

    flow = module.InterruptFlow()
    flow.state.messages = [
        {"role": "user", "content": "Book an intro call with sales."}
    ]
    first_message = {
        "role": "assistant",
        "content": "Let me find times.",
        "tool_calls": [
            {
                "id": "call_schedule_1",
                "type": "function",
                "function": {
                    "name": "schedule_meeting",
                    "arguments": '{"topic":"Sales intro","attendee":"Sales"}',
                },
            }
        ],
    }
    final_message = {"role": "assistant", "content": "Booked for Monday."}
    streamed = [
        _response(first_message),
        _response(final_message),
    ]

    async def fake_completion(**_kwargs):
        return object()

    async def fake_stream(_response_value):
        return streamed.pop(0)

    emitted = []

    async def fake_emit(tool_call_id, content, **_kwargs):
        emitted.append((tool_call_id, json.loads(content)))
        return True

    monkeypatch.setattr(module, "acompletion", fake_completion)
    monkeypatch.setattr(module, "copilotkit_stream", fake_stream)
    monkeypatch.setattr(module, "copilotkit_emit_tool_result", fake_emit)

    payload = await flow.request_schedule()
    assert payload["topic"] == "Sales intro"
    assert flow.state.pending_tool_call_id == "call_schedule_1"

    await flow.confirm_schedule(
        HumanFeedbackResult(
            output=payload,
            feedback='{"chosen_time":"2026-08-06T14:00:00Z","chosen_label":"Monday 2 PM"}',
            method_name="request_schedule",
        )
    )

    assert flow.state.meeting == {
        "topic": "Sales intro",
        "attendee": "Sales",
        "time": "2026-08-06T14:00:00Z",
        "label": "Monday 2 PM",
        "cancelled": False,
    }
    assert flow.state.messages[-1] == final_message
    assert emitted[0][0] == "call_schedule_1"
    assert emitted[0][1]["label"] == "Monday 2 PM"


@pytest.mark.asyncio
async def test_interrupt_flow_persists_pause_and_resumes(monkeypatch, tmp_path):
    from agents import interrupt_flow as module

    persistence = SQLiteFlowPersistence(str(tmp_path / "interrupt-flow.db"))
    flow_id = "thread-native-interrupt"
    first_message = {
        "role": "assistant",
        "content": "Let me find times.",
        "tool_calls": [
            {
                "id": "call_persisted_schedule",
                "type": "function",
                "function": {
                    "name": "schedule_meeting",
                    "arguments": '{"topic":"Persisted meeting"}',
                },
            }
        ],
    }
    streamed = [
        _response(first_message),
        _response({"role": "assistant", "content": "Meeting confirmed."}),
    ]

    async def fake_completion(**_kwargs):
        return object()

    async def fake_stream(_response_value):
        return streamed.pop(0)

    async def fake_emit(_tool_call_id, _content, **_kwargs):
        return True

    monkeypatch.setattr(module, "acompletion", fake_completion)
    monkeypatch.setattr(module, "copilotkit_stream", fake_stream)
    monkeypatch.setattr(module, "copilotkit_emit_tool_result", fake_emit)

    flow = module.InterruptFlow(persistence=persistence)
    pending = await flow.kickoff_async(
        inputs={
            "id": flow_id,
            "messages": [{"role": "user", "content": "Book it."}],
            "copilotkit": {"actions": []},
        }
    )
    assert isinstance(pending, HumanFeedbackPending)

    resumed = module.InterruptFlow.from_pending(flow_id, persistence)
    await resumed.resume_async(
        '{"chosen_time":"2026-08-06T14:00:00Z","chosen_label":"Monday 2 PM"}'
    )

    assert resumed.state.meeting["time"] == "2026-08-06T14:00:00Z"
    assert resumed.state.messages[-1]["content"] == "Meeting confirmed."


def test_server_registers_structured_interrupt_outcome_only():
    source = AGENT_SERVER.read_text()

    assert 'interrupt_feature = feature == "interrupt"' in source
    assert "emit_interrupt_outcome=interrupt_feature" in source
    assert "enable_legacy_on_interrupt_event=not interrupt_feature" in source
    assert "InterruptScheduling" not in source


def test_both_interrupt_surfaces_use_standard_resume_entries():
    inline = INLINE_PAGE.read_text()
    headless = HEADLESS_PAGE.read_text()
    picker = TIME_PICKER.read_text()

    assert "useInterrupt" in inline
    assert "useHumanInTheLoop" not in inline
    assert "useInterrupt" in headless
    assert "renderInChat: false" in headless
    assert "forwardedProps" not in headless
    assert 'data-testid="interrupt-headless-resolving"' in headless
    assert "requestAnimationFrame" in headless
    assert 'data-testid="time-picker-picked"' not in picker


@pytest.mark.parametrize(
    "fixture_name", ["gen-ui-interrupt.json", "interrupt-headless.json"]
)
def test_interrupt_fixtures_separate_initial_and_resumed_legs(fixture_name):
    payload = json.loads((AIMOCK_ROOT / fixture_name).read_text())
    initial_legs = [
        fixture
        for fixture in payload["fixtures"]
        if fixture["match"].get("toolName") == "schedule_meeting"
    ]

    assert len(initial_legs) == 2
    assert all(
        fixture["match"].get("hasToolResult") is False for fixture in initial_legs
    )
