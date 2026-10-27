"""The reasoning config asks the Responses API for a reasoning summary."""

from __future__ import annotations

import asyncio
import json

import httpx2

from agents._reasoning_summary import reasoning_config


def _send(path: str, payload: dict) -> dict:
    seen = {}

    def handler(request: httpx2.Request) -> httpx2.Response:
        seen.update(json.loads(request.read()))
        return httpx2.Response(200, json={})

    async def go():
        client = reasoning_config("gpt-5-mini").http_client
        client._transport = httpx2.MockTransport(handler)
        async with client:
            await client.post(f"http://openai.test{path}", json=payload)

    asyncio.run(go())
    return seen


def test_responses_request_gets_a_reasoning_summary():
    body = _send("/v1/responses", {"model": "gpt-5-mini", "input": "hi"})
    assert body["reasoning"] == {"effort": "medium", "summary": "auto"}
    assert body["input"] == "hi"


def test_other_requests_are_left_alone():
    body = _send("/v1/files", {"purpose": "x"})
    assert "reasoning" not in body
