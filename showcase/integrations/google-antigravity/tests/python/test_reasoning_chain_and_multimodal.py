"""The reasoning-chain and multimodal agents, and the fixtures that drive them."""

from __future__ import annotations

import inspect
import json
import pathlib

import pytest

from agents import _common, multimodal, reasoning, tool_rendering_reasoning_chain

FIXTURES = pathlib.Path(__file__).resolve().parents[4] / "aimock/d6/google-antigravity"


@pytest.fixture
def captured_build(monkeypatch):
    """Replaces each module's ``build`` so the factories run without a harness."""
    calls = []

    def fake_build(**kwargs):
        calls.append(kwargs)
        return kwargs

    for module in (multimodal, reasoning, tool_rendering_reasoning_chain):
        monkeypatch.setattr(module, "build", fake_build)
    return calls


class TestRollDice:
    def test_defaults_to_a_six_sided_die(self):
        result = tool_rendering_reasoning_chain.roll_dice()
        assert result["sides"] == 6
        assert 1 <= result["result"] <= 6

    @pytest.mark.parametrize("sides", [6, 20])
    def test_result_stays_in_range(self, sides):
        for _ in range(200):
            result = tool_rendering_reasoning_chain.roll_dice(sides=sides)
            assert result == {"sides": sides, "result": result["result"]}
            assert 1 <= result["result"] <= sides


class TestReasoningChainAgent:
    def test_tool_names_match_the_page_and_probe(self):
        # The probe and the e2e spec select catch-all cards by
        # data-tool-name="get_stock_price" / "roll_dice"; the page has
        # branded renderers for get_weather and search_flights.
        names = [t.__name__ for t in tool_rendering_reasoning_chain.TOOLS]
        assert names == [
            "get_weather",
            "search_flights",
            "get_stock_price",
            "roll_dice",
        ]

    def test_runs_on_the_reasoning_model(self, captured_build):
        tool_rendering_reasoning_chain.tool_rendering_reasoning_chain_agent()
        (kwargs,) = captured_build
        assert kwargs["model"] == _common.REASONING_MODEL
        assert kwargs["tools"] == tool_rendering_reasoning_chain.TOOLS
        assert "CHAIN" in kwargs["system_instructions"]


def test_multimodal_agent_uses_the_attachment_prompt(captured_build):
    multimodal.multimodal_agent()
    (kwargs,) = captured_build
    assert "attach" in kwargs["system_instructions"]
    # No tools: the attachment arrives as message media, not through a tool.
    assert "tools" not in kwargs


def _fixtures(name):
    return json.loads((FIXTURES / name).read_text())["fixtures"]


def test_every_chain_fixture_tool_call_binds_to_a_registered_tool():
    # The harness aborts a run on an unknown tool name, and a call whose
    # arguments do not bind to the Python signature fails the same way.
    tools = {t.__name__: t for t in tool_rendering_reasoning_chain.TOOLS}
    seen = set()
    for fixture in _fixtures("tool-rendering-reasoning-chain.json"):
        for call in fixture["response"].get("toolCalls", []):
            assert call["name"] in tools, call["name"]
            inspect.signature(tools[call["name"]]).bind(**json.loads(call["arguments"]))
            seen.add(call["name"])
    assert seen == set(tools)


def test_every_chain_tool_leg_carries_reasoning():
    # The probe asserts one more reasoning block per turn; the reasoning
    # rides on the tool legs, so a leg without it can drop a turn's block.
    for fixture in _fixtures("tool-rendering-reasoning-chain.json"):
        response = fixture["response"]
        if response.get("toolCalls"):
            assert response.get("reasoning"), fixture["match"]


def test_reasoning_fixtures_carry_reasoning():
    for fixture in _fixtures("reasoning.json"):
        assert fixture["response"].get("reasoning"), fixture["match"]
