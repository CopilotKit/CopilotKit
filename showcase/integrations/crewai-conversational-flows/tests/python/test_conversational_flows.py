from types import SimpleNamespace

import pytest

import agents.conversational_flows as conversational_flows
from agents.conversational_flows import CONVERSATIONAL_FLOW_TYPES


EXPECTED_FEATURES = {
    "chat",
    "declarative-gen-ui",
    "a2ui-fixed-schema",
    "byoc-hashbrown",
    "byoc-json-render",
    "beautiful-chat",
    "mcp-apps",
    "shared-state-read-write",
    "shared-state-read",
    "shared-state-streaming",
    "multimodal",
    "frontend-tools",
    "a2ui-recovery",
    "subagents",
    "gen-ui-agent",
    "reasoning",
    "interrupt",
    "tool-rendering",
    "tool-rendering-reasoning",
}


def test_every_showcase_backend_has_a_native_conversational_flow():
    assert set(CONVERSATIONAL_FLOW_TYPES) == EXPECTED_FEATURES

    for flow_type in CONVERSATIONAL_FLOW_TYPES.values():
        flow = flow_type()
        assert flow.conversational is True
        assert callable(flow.stream_turn)
        assert flow.conversational_config.defer_trace_finalization is False


def test_conversational_flows_complete_each_public_turn_without_terminating_session():
    for flow_type in CONVERSATIONAL_FLOW_TYPES.values():
        flow = flow_type()
        assert flow.route_turn(None) == "ag_ui_complete"
        assert flow.end_conversation() is None
        assert flow.finish_ag_ui_turn() is None


def test_base_chat_prompt_preserves_exact_user_chosen_names_across_turns():
    assert "exact spelling" in conversational_flows.BASE_CHAT_PROMPT
    assert "proper names" in conversational_flows.BASE_CHAT_PROMPT


def test_server_registers_one_public_conversational_endpoint_per_backend():
    from agent_server import app

    paths = {
        route.path
        for route in app.routes
        if route.path.startswith("/conversational_flows/")
    }

    assert paths == {
        f"/conversational_flows/{feature}" for feature in EXPECTED_FEATURES
    }


@pytest.mark.asyncio
async def test_prompted_chat_omits_tool_options_when_no_actions(monkeypatch):
    captured = {}

    async def fake_completion(**kwargs):
        captured.update(kwargs)
        return object()

    async def fake_stream(_response):
        return SimpleNamespace(
            choices=[SimpleNamespace(message={"role": "assistant", "content": "ok"})]
        )

    monkeypatch.setattr(conversational_flows, "acompletion", fake_completion)
    monkeypatch.setattr(conversational_flows, "copilotkit_stream", fake_stream)

    flow = conversational_flows.PromptedChatFlow()
    flow.state.messages = [{"role": "user", "content": "hello"}]
    await flow.chat()

    assert "tools" not in captured
    assert "parallel_tool_calls" not in captured
