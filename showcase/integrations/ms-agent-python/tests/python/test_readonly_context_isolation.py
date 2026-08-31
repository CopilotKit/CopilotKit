"""Regression coverage for request-local ``useAgentContext`` forwarding."""

from __future__ import annotations

import asyncio
from collections.abc import AsyncGenerator
from types import SimpleNamespace
from typing import Any

import pytest
from ag_ui.core import RunFinishedEvent, RunStartedEvent
from agent_framework_ag_ui import AgentFrameworkAgent

from agents.readonly_state_agent_context import (
    SYSTEM_PROMPT,
    ReadonlyContextFrameworkAgent,
    build_context_system_message,
)


def _context_message(input_data: dict[str, Any]) -> dict[str, Any]:
    return next(
        message for message in input_data["messages"] if message.get("role") == "system"
    )


def test_non_string_context_values_are_rendered_as_json() -> None:
    assert build_context_system_message(
        [
            {
                "description": "Recent activity",
                "value": ["Viewed the pricing page", "Watched the product demo"],
            }
        ]
    ) == (
        "## Context from the application\n\n"
        "Recent activity\n"
        "[\n"
        '  "Viewed the pricing page",\n'
        '  "Watched the product demo"\n'
        "]"
    )


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "message_input",
    [{}, {"messages": []}],
    ids=["missing-messages", "empty-messages"],
)
async def test_context_does_not_create_a_message_less_model_turn(
    message_input: dict[str, Any],
) -> None:
    """Context-only control input must not invoke the wrapped model."""
    wrapped_agent = SimpleNamespace(
        name="readonly_state_agent_context",
        description="",
        default_options={"instructions": SYSTEM_PROMPT},
        context_providers=[],
    )
    adapter = ReadonlyContextFrameworkAgent(agent=wrapped_agent)
    input_data = {
        "runId": "control-turn",
        "threadId": "thread",
        "context": [{"description": "User name", "value": "Ada"}],
        **message_input,
    }

    events = [event async for event in adapter.run(input_data)]

    assert [type(event) for event in events] == [RunStartedEvent, RunFinishedEvent]
    assert wrapped_agent.default_options == {"instructions": SYSTEM_PROMPT}


@pytest.mark.asyncio
async def test_concurrent_runs_keep_app_context_request_local(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Two overlapping requests must never observe each other's context."""
    entered = {"alpha": asyncio.Event(), "bravo": asyncio.Event()}
    alpha_observed = asyncio.Event()
    observed_inputs: dict[str, dict[str, Any]] = {}
    observed_instructions: dict[str, str] = {}

    async def capture_run(
        adapter: AgentFrameworkAgent,
        input_data: dict[str, Any],
    ) -> AsyncGenerator[object, None]:
        run_id = input_data["runId"]
        entered[run_id].set()

        if run_id == "alpha":
            await entered["bravo"].wait()
        else:
            await alpha_observed.wait()

        observed_inputs[run_id] = input_data
        observed_instructions[run_id] = adapter.agent.default_options["instructions"]

        if run_id == "alpha":
            alpha_observed.set()

        yield object()

    monkeypatch.setattr(AgentFrameworkAgent, "run", capture_run)

    wrapped_agent = SimpleNamespace(
        name="readonly_state_agent_context",
        description="",
        default_options={"instructions": SYSTEM_PROMPT},
    )
    adapter = ReadonlyContextFrameworkAgent(agent=wrapped_agent)
    inputs = {
        "alpha": {
            "runId": "alpha",
            "messages": [{"id": "alpha-user", "role": "user", "content": "Hi"}],
            "context": [{"description": "User name", "value": "Alpha"}],
        },
        "bravo": {
            "runId": "bravo",
            "messages": [{"id": "bravo-user", "role": "user", "content": "Hi"}],
            "context": [{"description": "User name", "value": "Bravo"}],
        },
    }
    original_message_lists = {
        run_id: input_data["messages"] for run_id, input_data in inputs.items()
    }

    async def consume(input_data: dict[str, Any]) -> None:
        async for _ in adapter.run(input_data):
            pass

    await asyncio.wait_for(
        asyncio.gather(*(consume(input_data) for input_data in inputs.values())),
        timeout=5,
    )

    assert "Alpha" in _context_message(observed_inputs["alpha"])["content"]
    assert "Bravo" not in _context_message(observed_inputs["alpha"])["content"]
    assert "Bravo" in _context_message(observed_inputs["bravo"])["content"]
    assert "Alpha" not in _context_message(observed_inputs["bravo"])["content"]
    assert observed_instructions == {
        "alpha": SYSTEM_PROMPT,
        "bravo": SYSTEM_PROMPT,
    }
    assert wrapped_agent.default_options == {"instructions": SYSTEM_PROMPT}
    assert inputs["alpha"]["messages"] is original_message_lists["alpha"]
    assert inputs["bravo"]["messages"] is original_message_lists["bravo"]


@pytest.mark.asyncio
async def test_missing_run_ids_get_unique_context_message_ids(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    observed_inputs: list[dict[str, Any]] = []

    async def capture_run(
        _adapter: AgentFrameworkAgent,
        input_data: dict[str, Any],
    ) -> AsyncGenerator[object, None]:
        observed_inputs.append(input_data)
        yield object()

    monkeypatch.setattr(AgentFrameworkAgent, "run", capture_run)

    wrapped_agent = SimpleNamespace(
        name="readonly_state_agent_context",
        description="",
        default_options={"instructions": SYSTEM_PROMPT},
    )
    adapter = ReadonlyContextFrameworkAgent(agent=wrapped_agent)

    async def consume() -> None:
        input_data = {
            "messages": [{"id": "user", "role": "user", "content": "Hi"}],
            "context": [{"description": "User name", "value": "Ada"}],
        }
        async for _ in adapter.run(input_data):
            pass
        assert "runId" not in input_data

    await consume()
    await consume()

    message_ids = [_context_message(input_data)["id"] for input_data in observed_inputs]
    assert message_ids[0] != message_ids[1]
    assert message_ids == [
        f"{input_data['runId']}-app-context" for input_data in observed_inputs
    ]
