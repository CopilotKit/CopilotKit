"""Regression coverage for request-local ``useAgentContext`` forwarding."""

from __future__ import annotations

import asyncio
from collections.abc import AsyncGenerator
from types import SimpleNamespace
from typing import Any

import pytest
from agent_framework_ag_ui import AgentFrameworkAgent

from agents.readonly_state_agent_context import (
    SYSTEM_PROMPT,
    ReadonlyContextFrameworkAgent,
)


def _context_message(input_data: dict[str, Any]) -> dict[str, Any]:
    return next(
        message for message in input_data["messages"] if message.get("role") == "system"
    )


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

    await asyncio.gather(*(consume(input_data) for input_data in inputs.values()))

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
