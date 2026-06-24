from __future__ import annotations

import asyncio

from agents._request_scoped_instructions import _InstructionScopedAgent


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
    async def run() -> tuple[str, str, dict]:
        shared_agent = _StubAgent()
        first = _InstructionScopedAgent(shared_agent, "<first>")
        second = _InstructionScopedAgent(shared_agent, "<second>")

        first_result, second_result = await asyncio.gather(
            first.run(options={"store": True}, delay=0.02),
            second.run(options={"metadata": {"request": 2}}, delay=0.01),
        )

        return first_result, second_result, shared_agent.default_options

    first_result, second_result, default_options = asyncio.run(run())

    assert first_result == "<first>"
    assert second_result == "<second>"
    assert default_options == {
        "instructions": "<fallback>",
        "metadata": {"shared": True},
    }
