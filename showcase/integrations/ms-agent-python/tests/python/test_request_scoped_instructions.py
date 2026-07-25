from __future__ import annotations

import asyncio

import pytest

from agents._request_scoped_instructions import (
    _InstructionScopedAgent,
    run_with_request_instructions,
)


class _StubAgent:
    def __init__(self) -> None:
        self.default_options = {
            "instructions": "<fallback>",
            "metadata": {"shared": True},
        }
        self.calls: list[dict] = []

    async def run(self, messages=None, **kwargs):
        await asyncio.sleep(kwargs.pop("delay"))
        self.calls.append(kwargs["options"])
        return kwargs["options"]["instructions"]


def test_request_scoped_instructions_do_not_mutate_shared_defaults():
    async def run() -> tuple[str, str, dict, list[dict]]:
        shared_agent = _StubAgent()
        first = _InstructionScopedAgent(shared_agent, "<first>")
        second = _InstructionScopedAgent(shared_agent, "<second>")

        first_result, second_result = await asyncio.gather(
            first.run(options={"store": True}, delay=0.02),
            second.run(options={"metadata": {"request": 2}}, delay=0.01),
        )

        return (
            first_result,
            second_result,
            shared_agent.default_options,
            shared_agent.calls,
        )

    first_result, second_result, default_options, calls = asyncio.run(run())

    assert first_result == "<first>"
    assert second_result == "<second>"
    assert default_options == {
        "instructions": "<fallback>",
        "metadata": {"shared": True},
    }

    calls_by_instruction = {call["instructions"]: call for call in calls}
    assert calls_by_instruction == {
        "<first>": {"store": True, "instructions": "<first>"},
        "<second>": {
            "metadata": {"request": 2},
            "instructions": "<second>",
        },
    }


def test_run_with_request_instructions_scopes_concurrent_runs():
    seen_runs: list[dict] = []
    wrapper: _PublicWrapper | None = None

    class _PublicWrapper:
        def __init__(self, agent):
            self.agent = agent
            self.shared_state = {"approval": "pending"}

        async def run(self, input_data):
            assert wrapper is not None
            assert self is not wrapper
            assert self.shared_state is wrapper.shared_state
            agent = self.agent
            await asyncio.sleep(input_data["delay"])
            result = await agent.run(
                options=input_data["options"],
                delay=input_data["delay"],
            )
            run_options = agent.calls[-1]
            seen_runs.append(
                {
                    "input": input_data["name"],
                    "default_instructions": agent.default_options["instructions"],
                    "run_options": run_options,
                }
            )
            yield result

    async def run() -> tuple[list[str], list[dict], list[dict]]:
        shared_agent = _StubAgent()
        nonlocal wrapper
        wrapper = _PublicWrapper(shared_agent)

        first_events, second_events = await asyncio.gather(
            _collect_events(
                run_with_request_instructions(
                    wrapper,
                    {"name": "first", "options": {"store": True}, "delay": 0.02},
                    "<first>",
                )
            ),
            _collect_events(
                run_with_request_instructions(
                    wrapper,
                    {
                        "name": "second",
                        "options": {"metadata": {"request": 2}},
                        "delay": 0.01,
                    },
                    "<second>",
                )
            ),
        )

        return [*first_events, *second_events], seen_runs, shared_agent.calls

    events, runs, calls = asyncio.run(run())

    assert sorted(events) == ["<first>", "<second>"]
    runs_by_instruction = {run["default_instructions"]: run for run in runs}
    assert runs_by_instruction["<first>"]["run_options"] == {
        "store": True,
        "instructions": "<first>",
    }
    assert runs_by_instruction["<second>"]["run_options"] == {
        "metadata": {"request": 2},
        "instructions": "<second>",
    }
    assert {
        run["default_instructions"] for run in runs
    } == {"<first>", "<second>"}

    calls_by_instruction = {call["instructions"]: call for call in calls}
    assert calls_by_instruction["<first>"]["store"] is True
    assert calls_by_instruction["<second>"]["metadata"] == {"request": 2}


def test_run_with_request_instructions_supports_beta_public_entry_point():
    seen: list[str] = []

    class _BetaWrapper:
        def __init__(self, agent):
            self.agent = agent

        async def run_agent(self, input_data):
            seen.append(self.agent.default_options["instructions"])
            yield input_data["event"]

    async def run():
        wrapper = _BetaWrapper(_StubAgent())
        return [
            event
            async for event in run_with_request_instructions(
                wrapper, {"event": "ok"}, "<beta>"
            )
        ]

    assert asyncio.run(run()) == ["ok"]
    assert seen == ["<beta>"]


def test_instructionless_default_produces_one_final_instruction():
    """Exercise Agent Framework's real merge semantics, not a local fake."""
    agents_module = pytest.importorskip("agent_framework._agents")
    merge_options = agents_module._merge_options

    final_options = merge_options({}, {"instructions": "<request>"})

    assert final_options["instructions"] == "<request>"
    assert "<fallback>\n<request>" == merge_options(
        {"instructions": "<fallback>"}, {"instructions": "<request>"}
    )["instructions"]


async def _collect_events(stream):
    return [event async for event in stream]
