"""Contracts for the neutral chat Flow shared by the plain-assistant cells."""

from types import SimpleNamespace

import pytest

import agents.chat_flow as chat_flow


def test_base_chat_prompt_preserves_exact_user_chosen_names_across_turns():
    assert "exact spelling" in chat_flow.BASE_CHAT_PROMPT
    assert "proper names" in chat_flow.BASE_CHAT_PROMPT


def test_base_chat_prompt_carries_no_crew_chat_boilerplate():
    """A crew endpoint would append CrewAI's purpose-reminder instructions.

    `build_system_message` tells the model to introduce itself and to steer
    every answer back to the crew's purpose. The plain-assistant cells are
    served by this Flow precisely so none of that reaches the model.
    """
    prompt = chat_flow.BASE_CHAT_PROMPT.lower()
    assert "crew" not in prompt
    assert "introduce yourself" not in prompt
    assert "research report" not in prompt


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

    monkeypatch.setattr(chat_flow, "acompletion", fake_completion)
    monkeypatch.setattr(chat_flow, "copilotkit_stream", fake_stream)

    flow = chat_flow.PromptedChatFlow()
    flow.state.messages = [{"role": "user", "content": "hello"}]
    await flow.chat()

    assert "tools" not in captured
    assert "parallel_tool_calls" not in captured


@pytest.mark.asyncio
async def test_prompted_chat_forwards_frontend_actions_as_tools(monkeypatch):
    captured = {}

    async def fake_completion(**kwargs):
        captured.update(kwargs)
        return object()

    async def fake_stream(_response):
        return SimpleNamespace(
            choices=[SimpleNamespace(message={"role": "assistant", "content": "ok"})]
        )

    monkeypatch.setattr(chat_flow, "acompletion", fake_completion)
    monkeypatch.setattr(chat_flow, "copilotkit_stream", fake_stream)

    action = {
        "type": "function",
        "function": {"name": "generate_haiku", "parameters": {"type": "object"}},
    }
    flow = chat_flow.PromptedChatFlow()
    flow.state.messages = [{"role": "user", "content": "Write me a haiku"}]
    flow.state.copilotkit.actions = [action]
    await flow.chat()

    assert captured["tools"] == [action]
    assert captured["parallel_tool_calls"] is False
