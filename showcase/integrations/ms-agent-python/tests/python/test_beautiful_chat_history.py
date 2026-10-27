"""Exercise history retention through the real adapter and provider serialization."""

import json
from copy import deepcopy

import httpx
import pytest
from agent_framework.openai import OpenAIChatCompletionClient
from agents.beautiful_chat import create_beautiful_chat_agent
from openai import AsyncOpenAI


@pytest.mark.asyncio
@pytest.mark.parametrize("tool_name", ["query_data", "render_chart", "mcp_counter"])
@pytest.mark.parametrize(
    "followup", [False, True], ids=["tool-resume", "user-followup"]
)
async def test_completed_tool_history_reaches_provider_once(tool_name, followup):
    """Local, frontend, and runtime tool results survive a later user turn."""
    result = json.dumps({"fixture": "counter-v1", "initialCount": 0})
    messages = [
        {"id": "user-one", "role": "user", "content": "Read the counter."},
        {
            "id": "assistant-one",
            "role": "assistant",
            "content": "Checking the counter.",
            "toolCalls": [
                {
                    "id": "counter-call",
                    "type": "function",
                    "function": {"name": tool_name, "arguments": "{}"},
                }
            ],
        },
        {
            "id": "counter-result",
            "role": "tool",
            "toolCallId": "counter-call",
            "content": result,
        },
    ]
    if followup:
        messages.extend(
            [
                {
                    "id": "assistant-two",
                    "role": "assistant",
                    "content": "The initial count is zero.",
                },
                {
                    "id": "user-two",
                    "role": "user",
                    "content": "What was the initial count?",
                },
            ]
        )
    input_data = {
        "threadId": "history-thread",
        "runId": "followup-run",
        "messages": messages,
        "state": {},
        "tools": [],
        "context": [],
    }
    original = deepcopy(input_data)
    requests = []

    def respond(request):
        requests.append(json.loads(request.content))
        chunk = {
            "id": "answer",
            "object": "chat.completion.chunk",
            "created": 0,
            "model": "test-model",
            "choices": [
                {
                    "index": 0,
                    "delta": {
                        "role": "assistant",
                        "content": "The initial count was zero.",
                    },
                    "finish_reason": None,
                }
            ],
        }
        end = {**chunk, "choices": [{"index": 0, "delta": {}, "finish_reason": "stop"}]}
        return httpx.Response(
            200,
            headers={"content-type": "text/event-stream"},
            text=f"data: {json.dumps(chunk)}\n\ndata: {json.dumps(end)}\n\ndata: [DONE]\n\n",
        )

    async with httpx.AsyncClient(transport=httpx.MockTransport(respond)) as http_client:
        client = OpenAIChatCompletionClient(
            model="test-model",
            async_client=AsyncOpenAI(api_key="test-key", http_client=http_client),
        )
        adapter = create_beautiful_chat_agent(client)
        events = [event async for event in adapter.run(input_data)]

    assert input_data == original
    assert not [event for event in events if event.type == "RUN_ERROR"]
    assert len(requests) == 1
    provider_messages = [
        message for message in requests[0]["messages"] if message["role"] != "system"
    ]
    # The adapter may serialize assistant text and tool calls as separate
    # messages; both must survive, in their original conversational order.
    calls = [(i, m) for i, m in enumerate(provider_messages) if m.get("tool_calls")]
    results = [(i, m) for i, m in enumerate(provider_messages) if m["role"] == "tool"]
    assert len(calls) == len(results) == 1
    assert calls[0][0] < results[0][0]
    assert calls[0][1]["tool_calls"][0]["id"] == "counter-call"
    assert results[0][1]["tool_call_id"] == "counter-call"
    assert results[0][1]["content"] == result
    assert [m["content"] for m in provider_messages if m.get("content")] == [
        m["content"] for m in messages
    ]
