"""CopilotKitMiddleware ``context_placement``: keep the cached prompt prefix.

Providers cache an unchanged request prefix (tools, system message,
messages). With ``context_placement="message"``, the app context and the
exposed state go into the newest human message, so the system message and
the earlier messages stay the same between turns.
"""

from __future__ import annotations

import asyncio
from typing import Any
from unittest.mock import MagicMock

import pytest
from langchain.agents.middleware import ModelRequest
from langchain_core.messages import AIMessage, HumanMessage, SystemMessage

from copilotkit.copilotkit_lg_middleware import CopilotKitMiddleware

PROMPT = "You are a CRM assistant."


def _tool(name: str) -> dict[str, Any]:
    return {"type": "function", "function": {"name": name, "parameters": {}}}


def _request(turn: int) -> ModelRequest:
    """One model call of turn ``turn``. The page, the state and the order of
    the frontend tools change between turns, as they do in a real app."""
    messages: list[Any] = []
    for i in range(1, turn + 1):
        messages.append(HumanMessage(content=f"Question {i}", id=f"h{i}"))
        if i < turn:
            messages.append(AIMessage(content=f"Answer {i}"))
    actions = [_tool("a_tool"), _tool("b_tool")]
    if turn % 2:
        actions.reverse()
    runtime = MagicMock(name="runtime")
    runtime.context = None
    return ModelRequest(
        model=MagicMock(name="model"),
        messages=messages,
        system_message=SystemMessage(content=PROMPT),
        tools=[],
        state={
            "messages": messages,
            "selected": f"c-{turn}",
            "copilotkit": {
                "context": [{"description": "Current page", "value": f"/page-{turn}"}],
                "actions": actions,
            },
        },
        runtime=runtime,
    )


def _call(middleware: CopilotKitMiddleware, request: ModelRequest) -> ModelRequest:
    seen: dict[str, ModelRequest] = {}

    def handler(req: ModelRequest):
        seen["req"] = req
        return "ok"

    middleware.wrap_model_call(request, handler)
    return seen["req"]


def test_message_placement_keeps_system_message_and_history_stable():
    middleware = CopilotKitMiddleware(expose_state=True, context_placement="message")

    first = _call(middleware, _request(1))
    second = _call(middleware, _request(2))

    assert first.system_message.content == PROMPT
    assert second.system_message.content == PROMPT
    # The earlier human message goes to the model without its old context.
    assert second.messages[0].content == "Question 1"


def test_message_placement_puts_context_and_state_in_newest_human_message():
    middleware = CopilotKitMiddleware(expose_state=True, context_placement="message")
    request = _request(2)

    seen = _call(middleware, request)
    newest = seen.messages[-1]

    assert isinstance(newest, HumanMessage)
    assert newest.id == "h2"
    assert "App Context:" in newest.content
    assert "/page-2" in newest.content
    assert "Current agent state:" in newest.content
    assert "c-2" in newest.content
    assert newest.content.endswith("Question 2")
    # Only the request changes, never the thread's stored messages.
    assert request.state["messages"][-1].content == "Question 2"


def test_message_placement_adds_a_text_block_to_multipart_content():
    middleware = CopilotKitMiddleware(context_placement="message")
    request = _request(1)
    request = request.override(
        messages=[HumanMessage(content=[{"type": "text", "text": "Look"}], id="h1")]
    )

    newest = _call(middleware, request).messages[-1]

    assert newest.content[0]["type"] == "text"
    assert "/page-1" in newest.content[0]["text"]
    assert newest.content[1] == {"type": "text", "text": "Look"}


def test_message_placement_falls_back_to_system_without_a_human_message():
    middleware = CopilotKitMiddleware(context_placement="message")
    request = _request(1).override(messages=[AIMessage(content="Welcome")])

    seen = _call(middleware, request)

    assert "/page-1" in seen.system_message.content


def test_default_placement_keeps_context_in_system_message():
    middleware = CopilotKitMiddleware(expose_state=True)

    seen = _call(middleware, _request(2))

    assert "/page-2" in seen.system_message.content
    assert "c-2" in seen.system_message.content
    assert seen.messages[-1].content == "Question 2"


def test_frontend_tools_are_sorted_by_name():
    middleware = CopilotKitMiddleware()

    odd = _call(middleware, _request(1))
    even = _call(middleware, _request(2))

    assert [t["function"]["name"] for t in odd.tools] == ["a_tool", "b_tool"]
    assert [t["function"]["name"] for t in even.tools] == ["a_tool", "b_tool"]


def test_async_path_places_context_the_same_way():
    middleware = CopilotKitMiddleware(context_placement="message")
    seen: dict[str, ModelRequest] = {}

    async def handler(req: ModelRequest):
        seen["req"] = req
        return "ok"

    asyncio.run(middleware.awrap_model_call(_request(2), handler))

    assert seen["req"].system_message.content == PROMPT
    assert "/page-2" in seen["req"].messages[-1].content
    assert [t["function"]["name"] for t in seen["req"].tools] == ["a_tool", "b_tool"]


def test_rejects_an_unknown_placement():
    with pytest.raises(ValueError):
        CopilotKitMiddleware(context_placement="user")  # type: ignore[arg-type]
