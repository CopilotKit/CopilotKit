"""Responses summaries and tool outputs survive the Langroid AG-UI boundary."""

import json

import httpx
import openai
import pytest
from ag_ui.core import RunAgentInput
from agents import (
    agui_adapter,
)  # Import Langroid types before patching the client factory.
from agents.reasoning_agent import _run_reasoning_agent


def provider_response(output):
    return {
        "id": "resp_test",
        "object": "response",
        "created_at": 0,
        "model": "gpt-6-luna",
        "status": "completed",
        "output": output,
    }


def summary_item(id="rs_test"):
    return {
        "id": id,
        "type": "reasoning",
        "summary": [{"type": "summary_text", "text": "Compare the options first."}],
        "encrypted_content": "opaque-test-reasoning",
    }


def answer_item():
    return {
        "id": "msg_test",
        "type": "message",
        "role": "assistant",
        "status": "completed",
        "content": [
            {"type": "output_text", "text": "The answer is 42.", "annotations": []}
        ],
    }


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "with_tools,override,effort",
    [
        (True, None, "max"),
        (False, None, "medium"),
        (True, "o3", "medium"),
    ],
)
async def test_luna_chain_effort_preserves_display_and_model_overrides(
    monkeypatch, with_tools, override, effort
):
    requests = []
    if override is None:
        monkeypatch.delenv("OPENAI_REASONING_MODEL", raising=False)
    else:
        monkeypatch.setenv("OPENAI_REASONING_MODEL", override)

    def transport(request):
        requests.append(json.loads(request.content))
        return httpx.Response(200, json=provider_response([answer_item()]))

    client = openai.AsyncOpenAI(
        api_key="test",
        http_client=httpx.AsyncClient(transport=httpx.MockTransport(transport)),
    )
    monkeypatch.setattr(openai, "AsyncOpenAI", lambda: client)
    events = [
        event
        async for event in _run_reasoning_agent(
            RunAgentInput(
                thread_id="thread",
                run_id="run",
                state={},
                messages=[
                    {
                        "id": "user",
                        "role": "user",
                        "content": "Compare AAPL and MSFT stocks for me.",
                    }
                ],
                tools=[],
                context=[],
                forwarded_props={},
            ),
            with_tools=with_tools,
        )
    ]
    assert len(requests) == 1
    assert requests[0]["model"] == (override or "gpt-6-luna")
    assert requests[0]["reasoning"] == {"effort": effort, "summary": "detailed"}
    assert events[-1].type == "RUN_FINISHED"


@pytest.mark.asyncio
async def test_summaryless_chain_preserves_tools_and_answer_without_fabricating_reasoning(
    monkeypatch,
):
    requests = []
    monkeypatch.delenv("OPENAI_REASONING_MODEL", raising=False)

    def transport(request):
        requests.append(json.loads(request.content))
        leg = len(requests) - 1
        if leg == 0:
            # A run keeps its resolved model and reasoning budget on every leg.
            monkeypatch.setenv("OPENAI_REASONING_MODEL", "o3")
        if leg < 2:
            reasoning = {**summary_item(f"rs_{leg}"), "summary": []}
            output = [
                reasoning,
                {
                    "type": "function_call",
                    "id": f"fc_{leg}",
                    "call_id": f"call_{leg}",
                    "name": "get_stock_price",
                    "arguments": json.dumps({"ticker": "AAPL" if leg == 0 else "MSFT"}),
                    "status": "completed",
                },
            ]
        else:
            output = [answer_item()]
        return httpx.Response(200, json=provider_response(output))

    client = openai.AsyncOpenAI(
        api_key="test",
        http_client=httpx.AsyncClient(transport=httpx.MockTransport(transport)),
    )
    monkeypatch.setattr(openai, "AsyncOpenAI", lambda: client)
    events = [
        event
        async for event in _run_reasoning_agent(
            RunAgentInput(
                thread_id="thread",
                run_id="run",
                state={},
                messages=[
                    {
                        "id": "user",
                        "role": "user",
                        "content": "Compare AAPL and MSFT stocks for me.",
                    }
                ],
                tools=[],
                context=[],
                forwarded_props={},
            ),
            with_tools=True,
        )
    ]
    assert len(requests) == 3
    assert all(request["model"] == "gpt-6-luna" for request in requests)
    assert all(
        request["reasoning"] == {"effort": "max", "summary": "detailed"}
        for request in requests
    )
    assert sum(event.type == "TOOL_CALL_RESULT" for event in events) == 2
    assert sum(event.type == "REASONING_ENCRYPTED_VALUE" for event in events) == 2
    assert not any(event.type.startswith("REASONING_MESSAGE_") for event in events)
    assert any(
        event.type == "TEXT_MESSAGE_CONTENT" and event.delta == "The answer is 42."
        for event in events
    )
    assert events[-1].type == "RUN_FINISHED"


@pytest.mark.asyncio
@pytest.mark.parametrize("with_summary", [True, False])
async def test_reasoning_requests_visible_summary_and_maps_both_channels(
    monkeypatch, with_summary
):
    requests = []

    def transport(request):
        requests.append((request.url.path, json.loads(request.content)))
        return httpx.Response(
            200,
            json=provider_response(
                [summary_item(), answer_item()] if with_summary else [answer_item()]
            ),
        )

    original = openai.AsyncOpenAI
    client = original(
        api_key="test",
        http_client=httpx.AsyncClient(transport=httpx.MockTransport(transport)),
    )
    monkeypatch.setattr(openai, "AsyncOpenAI", lambda: client)
    try:
        events = [
            event
            async for event in _run_reasoning_agent(
                RunAgentInput(
                    thread_id="thread",
                    run_id="run",
                    state={},
                    messages=[
                        {"id": "user", "role": "user", "content": "Compare options"}
                    ],
                    tools=[],
                    context=[],
                    forwarded_props={},
                )
            )
        ]
        assert requests[0][0] == "/v1/responses"
        assert requests[0][1]["model"] == "gpt-6-luna"
        assert requests[0][1]["reasoning"] == {
            "effort": "medium",
            "summary": "detailed",
        }
        assert [
            (e.type, getattr(e, "delta", None)) for e in events if hasattr(e, "delta")
        ] == (
            [
                ("REASONING_MESSAGE_CONTENT", "Compare the options first."),
                ("TEXT_MESSAGE_CONTENT", "The answer is 42."),
            ]
            if with_summary
            else [("TEXT_MESSAGE_CONTENT", "The answer is 42.")]
        )
        assert events[-1].type == "RUN_FINISHED"
    finally:
        await client.close()


@pytest.mark.asyncio
async def test_reasoning_chain_replays_reasoning_and_tool_result(monkeypatch):
    requests = []

    def transport(request):
        body = json.loads(request.content)
        requests.append(body)
        output = (
            [
                summary_item(),
                {
                    "type": "function_call",
                    "id": "fc_test",
                    "call_id": "call_test",
                    "name": "get_weather",
                    "arguments": '{"location":"Tokyo"}',
                    "status": "completed",
                },
            ]
            if len(requests) == 1
            else [answer_item()]
        )
        return httpx.Response(200, json=provider_response(output))

    original = openai.AsyncOpenAI
    client = original(
        api_key="test",
        http_client=httpx.AsyncClient(transport=httpx.MockTransport(transport)),
    )
    monkeypatch.setattr(openai, "AsyncOpenAI", lambda: client)
    try:
        events = [
            event
            async for event in _run_reasoning_agent(
                RunAgentInput(
                    thread_id="thread",
                    run_id="run",
                    state={},
                    messages=[
                        {"id": "user", "role": "user", "content": "Weather in Tokyo?"}
                    ],
                    tools=[],
                    context=[],
                    forwarded_props={},
                ),
                with_tools=True,
            )
        ]
        assert len(requests) == 2
        assert requests[0]["store"] is False
        assert "reasoning.encrypted_content" in requests[0]["include"]
        assert any(
            item.get("encrypted_content") == "opaque-test-reasoning"
            for item in requests[1]["input"]
        )
        result = next(
            item
            for item in requests[1]["input"]
            if item.get("type") == "function_call_output"
        )
        assert result["call_id"] == "call_test"
        assert json.loads(result["output"])["city"] == "Tokyo"
        assert any(
            e.type == "TOOL_CALL_RESULT" and e.tool_call_id == "call_test"
            for e in events
        )
        assert any(e.type == "REASONING_MESSAGE_CONTENT" for e in events)
        encrypted = next(e for e in events if e.type == "REASONING_ENCRYPTED_VALUE")
        assert encrypted.subtype == "tool-call"
        assert encrypted.entity_id == "call_test"
        assert json.loads(encrypted.encrypted_value) == {"reasoning": [summary_item()]}
        assert events[-1].type == "RUN_FINISHED"
    finally:
        await client.close()


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "chain",
    [
        [
            ("get_stock_price", {"ticker": "AAPL"}),
            ("get_stock_price", {"ticker": "MSFT"}),
        ],
        [("roll_dice", {"sides": 20}), ("roll_dice", {"sides": 6})],
        [
            ("search_flights", {"origin": "SFO", "destination": "JFK"}),
            ("get_weather", {"location": "JFK"}),
        ],
    ],
)
async def test_each_chain_chip_executes_two_tools_and_answers(monkeypatch, chain):
    requests = []

    def transport(request):
        requests.append(json.loads(request.content))
        leg = len(requests) - 1
        if leg < 2:
            name, args = chain[leg]
            output = [
                summary_item(f"rs_{leg}"),
                {
                    "type": "function_call",
                    "id": f"fc_{leg}",
                    "call_id": f"call_{leg}",
                    "name": name,
                    "arguments": json.dumps(args),
                    "status": "completed",
                },
            ]
        else:
            output = [answer_item()]
        return httpx.Response(200, json=provider_response(output))

    client = openai.AsyncOpenAI(
        api_key="test",
        http_client=httpx.AsyncClient(transport=httpx.MockTransport(transport)),
    )
    monkeypatch.setattr(openai, "AsyncOpenAI", lambda: client)
    try:
        events = [
            event
            async for event in _run_reasoning_agent(
                RunAgentInput(
                    thread_id="thread",
                    run_id="run",
                    state={},
                    messages=[
                        {"id": "user", "role": "user", "content": "Run the chain"}
                    ],
                    tools=[],
                    context=[],
                    forwarded_props={},
                ),
                with_tools=True,
            )
        ]
        assert len(requests) == 3
        assert {tool["name"] for tool in requests[0]["tools"]} == {
            "get_weather",
            "search_flights",
            "get_stock_price",
            "roll_dice",
        }
        results = [
            json.loads(item["output"])
            for item in requests[-1]["input"]
            if item.get("type") == "function_call_output"
        ]
        assert len(results) == 2
        assert all("error" not in result for result in results)
        if chain[0][0] == "get_stock_price":
            assert [result["ticker"] for result in results] == ["AAPL", "MSFT"]
        elif chain[0][0] == "roll_dice":
            assert [result["sides"] for result in results] == [20, 6]
        else:
            assert results[0]["origin"] == "SFO"
            assert len(results[0]["flights"]) == 3
        assert sum(e.type == "REASONING_MESSAGE_CONTENT" for e in events) == 2
        assert sum(e.type == "TOOL_CALL_RESULT" for e in events) == 2
        assert events[-1].type == "RUN_FINISHED"
    finally:
        await client.close()


@pytest.mark.asyncio
@pytest.mark.parametrize("path", ["/reasoning/", "/reasoning/tools/"])
async def test_reasoning_http_routes_and_forwarded_context(monkeypatch, path):
    # Import the real server: its middleware and the /reasoning mount are part
    # of this contract, including the tools sub-mount order.
    from agent_server import app

    requests = []

    def transport(request):
        assert request.url.path == "/v1/responses"
        assert request.headers["x-aimock-context"] == "langroid:reasoning-route-test"
        body = json.loads(request.content)
        requests.append(body)
        if path.endswith("tools/") and len(requests) <= 2:
            ticker = "AAPL" if len(requests) == 1 else "MSFT"
            output = [
                summary_item(f"rs_{ticker}"),
                {
                    "type": "function_call",
                    "id": f"fc_{ticker}",
                    "call_id": f"call_{ticker}",
                    "name": "get_stock_price",
                    "arguments": json.dumps({"ticker": ticker}),
                    "status": "completed",
                },
            ]
        else:
            output = [summary_item(), answer_item()]
        return httpx.Response(200, json=provider_response(output))

    client = openai.AsyncOpenAI(
        api_key="test",
        http_client=httpx.AsyncClient(transport=httpx.MockTransport(transport)),
    )
    monkeypatch.setattr(openai, "AsyncOpenAI", lambda: client)
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app), base_url="http://test"
    ) as browser:
        response = await browser.post(
            path,
            headers={"x-aimock-context": "langroid:reasoning-route-test"},
            json={
                "threadId": "thread",
                "runId": "run",
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
                "forwardedProps": {},
            },
        )
    events = [
        json.loads(line.removeprefix("data: "))
        for line in response.text.splitlines()
        if line.startswith("data: ")
    ]
    assert response.status_code == 200
    assert events[0]["type"] == "RUN_STARTED"
    assert events[-1]["type"] == "RUN_FINISHED"
    assert any(event["type"] == "REASONING_MESSAGE_CONTENT" for event in events)
    if path.endswith("tools/"):
        assert len(requests) == 3
        assert sum(event["type"] == "TOOL_CALL_RESULT" for event in events) == 2
        assert [
            json.loads(item["output"])["ticker"]
            for item in requests[-1]["input"]
            if item.get("type") == "function_call_output"
        ] == ["AAPL", "MSFT"]
    else:
        assert len(requests) == 1
        assert "tools" not in requests[0]


@pytest.mark.asyncio
async def test_chain_followup_http_preserves_prior_quotes_and_call_ids(monkeypatch):
    from agent_server import app

    requests = []
    previous_reasoning = summary_item("rs_previous")

    def transport(request):
        requests.append(json.loads(request.content))
        return httpx.Response(200, json=provider_response([answer_item()]))

    client = openai.AsyncOpenAI(
        api_key="test",
        http_client=httpx.AsyncClient(transport=httpx.MockTransport(transport)),
    )
    monkeypatch.setattr(openai, "AsyncOpenAI", lambda: client)
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app), base_url="http://test"
    ) as browser:
        response = await browser.post(
            "/reasoning/tools/",
            json={
                "threadId": "thread",
                "runId": "followup",
                "state": {},
                "tools": [],
                "context": [],
                "forwardedProps": {},
                "messages": [
                    {
                        "id": "user",
                        "role": "user",
                        "content": "Compare AAPL and MSFT stocks for me.",
                    },
                    {
                        "id": "assistant",
                        "role": "assistant",
                        "toolCalls": [
                            {
                                "id": "call_aapl",
                                "type": "function",
                                "function": {
                                    "name": "get_stock_price",
                                    "arguments": '{"ticker":"AAPL"}',
                                },
                                "encryptedValue": json.dumps(
                                    {"reasoning": [previous_reasoning]}
                                ),
                            },
                            {
                                "id": "call_msft",
                                "type": "function",
                                "function": {
                                    "name": "get_stock_price",
                                    "arguments": '{"ticker":"MSFT"}',
                                },
                            },
                        ],
                    },
                    {
                        "id": "result_aapl",
                        "role": "tool",
                        "toolCallId": "call_aapl",
                        "content": '{"ticker":"AAPL","price_usd":187.25}',
                    },
                    {
                        "id": "result_msft",
                        "role": "tool",
                        "toolCallId": "call_msft",
                        "content": '{"ticker":"MSFT","price_usd":412.50}',
                    },
                    {
                        "id": "question",
                        "role": "user",
                        "content": "Using those exact quotes, what is the price difference? Do not query again.",
                    },
                ],
            },
        )
    assert response.status_code == 200
    assert len(requests) == 1
    history = requests[0]["input"]
    assert [
        item["call_id"] for item in history if item.get("type") == "function_call"
    ] == ["call_aapl", "call_msft"]
    assert [
        json.loads(item["output"])["price_usd"]
        for item in history
        if item.get("type") == "function_call_output"
    ] == [187.25, 412.50]
    assert previous_reasoning in history
    stock = next(
        tool for tool in requests[0]["tools"] if tool["name"] == "get_stock_price"
    )
    assert stock["parameters"]["properties"]["price_usd"]["anyOf"] == [
        {"type": "number"},
        {"type": "null"},
    ]
