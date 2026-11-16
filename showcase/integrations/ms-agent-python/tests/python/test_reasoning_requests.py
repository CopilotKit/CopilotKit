"""Real Responses SDK serialization and Agent Framework -> AG-UI mapping."""

import json

import httpx
import openai
import pytest
from agents.reasoning_agent import create_reasoning_agent
from agents.tool_rendering_reasoning_chain_agent import (
    create_tool_rendering_reasoning_chain_agent,
)


def response_sse():
    events = [
        {
            "type": "response.created",
            "response": {
                "id": "resp_test",
                "object": "response",
                "created_at": 0,
                "status": "in_progress",
                "model": "gpt-6-luna",
                "output": [],
            },
        },
        {
            "type": "response.reasoning_summary_text.delta",
            "item_id": "rs_test",
            "output_index": 0,
            "summary_index": 0,
            "delta": "Compare the options first.",
        },
        {
            "type": "response.output_text.delta",
            "item_id": "msg_test",
            "output_index": 1,
            "content_index": 0,
            "delta": "The answer is 42.",
        },
        {
            "type": "response.completed",
            "response": {
                "id": "resp_test",
                "object": "response",
                "created_at": 0,
                "status": "completed",
                "model": "gpt-6-luna",
                "output": [],
            },
        },
    ]
    return "".join(
        f"event: {event['type']}\ndata: {json.dumps(event)}\n\n" for event in events
    )


def tool_sse(name="get_weather", arguments=None, step=0):
    reasoning = {
        "id": f"rs_tool_{step}",
        "type": "reasoning",
        "summary": [],
        "encrypted_content": "opaque-test",
    }
    call = {
        "type": "function_call",
        "id": f"fc_test_{step}",
        "call_id": f"call_test_{step}",
        "name": name,
        "arguments": json.dumps(arguments or {"location": "Tokyo"}),
        "status": "completed",
    }
    events = [
        {
            "type": "response.created",
            "response": {
                "id": "resp_tool",
                "object": "response",
                "created_at": 0,
                "status": "in_progress",
                "model": "gpt-6-luna",
                "output": [],
            },
        },
        {
            "type": "response.output_item.added",
            "output_index": 0,
            "item": {**reasoning, "encrypted_content": None},
        },
        {
            "type": "response.reasoning_summary_text.delta",
            "item_id": f"rs_tool_{step}",
            "output_index": 0,
            "summary_index": 0,
            "delta": "Check the weather first.",
        },
        {"type": "response.output_item.done", "output_index": 0, "item": reasoning},
        {
            "type": "response.output_item.added",
            "output_index": 1,
            "item": {**call, "arguments": ""},
        },
        {
            "type": "response.function_call_arguments.delta",
            "item_id": f"fc_test_{step}",
            "output_index": 1,
            "delta": call["arguments"],
        },
        {"type": "response.output_item.done", "output_index": 1, "item": call},
        {
            "type": "response.completed",
            "response": {
                "id": "resp_tool",
                "object": "response",
                "created_at": 0,
                "status": "completed",
                "model": "gpt-6-luna",
                "output": [reasoning, call],
            },
        },
    ]
    return "".join(
        f"event: {event['type']}\ndata: {json.dumps(event)}\n\n" for event in events
    )


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "factory",
    [create_reasoning_agent, lambda: create_tool_rendering_reasoning_chain_agent(None)],
)
async def test_visible_reasoning_requested_and_mapped(monkeypatch, factory):
    requests = []
    monkeypatch.setenv("OPENAI_API_KEY", "test")
    monkeypatch.delenv("OPENAI_REASONING_MODEL", raising=False)
    wrapper = factory()

    def transport(request):
        assert request.url.path == "/v1/responses"
        requests.append(json.loads(request.content))
        return httpx.Response(
            200, text=response_sse(), headers={"content-type": "text/event-stream"}
        )

    client = wrapper.agent.client
    await client.client.close()
    client.client = openai.AsyncOpenAI(
        api_key="test",
        http_client=httpx.AsyncClient(transport=httpx.MockTransport(transport)),
    )
    try:
        events = [
            event
            async for event in wrapper.run(
                {
                    "thread_id": "thread",
                    "run_id": "run",
                    "state": {},
                    "messages": [
                        {"id": "user", "role": "user", "content": "Compare the options"}
                    ],
                    "tools": [],
                    "context": [],
                    "forwarded_props": {},
                }
            )
        ]
        assert len(requests) == 1
        assert requests[0]["model"] == "gpt-6-luna"
        assert requests[0]["reasoning"] == {"effort": "medium", "summary": "detailed"}
        assert any(
            e.type == "REASONING_MESSAGE_CONTENT"
            and e.delta == "Compare the options first."
            for e in events
        )
        assert any(
            e.type == "TEXT_MESSAGE_CONTENT" and e.delta == "The answer is 42."
            for e in events
        )
        assert events[-1].type == "RUN_FINISHED"
    finally:
        await client.client.close()


@pytest.mark.asyncio
async def test_reasoning_chain_replays_provider_reasoning_and_tool_output(monkeypatch):
    requests = []
    monkeypatch.setenv("OPENAI_API_KEY", "test")
    wrapper = create_tool_rendering_reasoning_chain_agent(None)

    def transport(request):
        assert request.url.path == "/v1/responses"
        requests.append(json.loads(request.content))
        return httpx.Response(
            200,
            text=tool_sse() if len(requests) == 1 else response_sse(),
            headers={"content-type": "text/event-stream"},
        )

    client = wrapper.agent.client
    await client.client.close()
    client.client = openai.AsyncOpenAI(
        api_key="test",
        http_client=httpx.AsyncClient(transport=httpx.MockTransport(transport)),
    )
    try:
        events = [
            event
            async for event in wrapper.run(
                {
                    "thread_id": "thread",
                    "run_id": "run",
                    "state": {},
                    "messages": [
                        {"id": "user", "role": "user", "content": "Weather in Tokyo?"}
                    ],
                    "tools": [],
                    "context": [],
                    "forwarded_props": {},
                }
            )
        ]
        assert len(requests) == 2
        assert requests[0]["store"] is False
        assert requests[1]["reasoning"] == {"effort": "medium", "summary": "detailed"}
        assert any(
            item.get("encrypted_content") == "opaque-test"
            for item in requests[1]["input"]
        )
        result = next(
            item
            for item in requests[1]["input"]
            if item.get("type") == "function_call_output"
        )
        assert result["call_id"] == "call_test_0"
        assert json.loads(result["output"])["city"] == "Tokyo"
        assert any(
            e.type == "TOOL_CALL_RESULT" and e.tool_call_id == "call_test_0"
            for e in events
        )
        assert any(
            e.type == "REASONING_MESSAGE_CONTENT"
            and e.delta == "Check the weather first."
            for e in events
        )
        assert events[-1].type == "RUN_FINISHED"
    finally:
        await client.client.close()


@pytest.mark.asyncio
async def test_default_stock_chip_executes_two_quotes_before_answer(monkeypatch):
    requests = []
    monkeypatch.setenv("OPENAI_API_KEY", "test")
    wrapper = create_tool_rendering_reasoning_chain_agent(None)

    def transport(request):
        requests.append(json.loads(request.content))
        step = len(requests) - 1
        payload = (
            tool_sse(
                "get_stock_price", {"ticker": "AAPL" if step == 0 else "MSFT"}, step
            )
            if step < 2
            else response_sse()
        )
        return httpx.Response(
            200, text=payload, headers={"content-type": "text/event-stream"}
        )

    client = wrapper.agent.client
    await client.client.close()
    client.client = openai.AsyncOpenAI(
        api_key="test",
        http_client=httpx.AsyncClient(transport=httpx.MockTransport(transport)),
    )
    try:
        events = [
            event
            async for event in wrapper.run(
                {
                    "thread_id": "thread",
                    "run_id": "run",
                    "state": {},
                    "messages": [
                        {
                            "id": "user",
                            "role": "user",
                            "content": "Compare AAPL and MSFT stocks for me.",
                        }
                    ],
                    "tools": [],
                    "context": [],
                    "forwarded_props": {},
                }
            )
        ]
        assert len(requests) == 3
        assert all(
            request["reasoning"] == {"effort": "medium", "summary": "detailed"}
            for request in requests
        )
        assert [
            json.loads(item["output"])["ticker"]
            for item in requests[-1]["input"]
            if item.get("type") == "function_call_output"
        ] == ["AAPL", "MSFT"]
        assert sum(event.type == "TOOL_CALL_RESULT" for event in events) == 2
        assert any(event.type == "REASONING_MESSAGE_CONTENT" for event in events)
        assert events[-1].type == "RUN_FINISHED"
    finally:
        await client.client.close()
