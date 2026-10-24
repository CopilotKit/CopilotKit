"""Compat shims that let AG2 1.x talk to aimock.

* ``x-aimock-context`` must reach the LLM call: AG2 1.x builds its OpenAI client
  on ``httpx2``, so the global header hook has to patch it as well as ``httpx``.
* aimock's Responses handler omits ``input_tokens_details`` /
  ``output_tokens_details``; AG2's usage mapper must tolerate that.
"""

from __future__ import annotations

import asyncio
from types import SimpleNamespace

import httpx2

from agents._header_forwarding import (
    install_global_httpx_hook,
    set_forwarded_headers,
)
from agents._usage_compat import _normalize_responses_usage


def test_global_hook_forwards_headers_on_httpx2_clients():
    install_global_httpx_hook()
    seen = {}

    def handler(request: httpx2.Request) -> httpx2.Response:
        seen.update(request.headers)
        return httpx2.Response(200, json={})

    async def go():
        set_forwarded_headers({"x-aimock-context": "ag2"})
        async with httpx2.AsyncClient(transport=httpx2.MockTransport(handler)) as client:
            await client.get("http://aimock.test/v1/responses")

    asyncio.run(go())
    assert seen.get("x-aimock-context") == "ag2"


def test_usage_mapper_tolerates_missing_token_details():
    usage = SimpleNamespace(
        input_tokens=3,
        output_tokens=4,
        total_tokens=7,
        input_tokens_details=None,
        output_tokens_details=None,
    )
    normalized = _normalize_responses_usage(usage)
    assert normalized.prompt_tokens == 3
    assert normalized.completion_tokens == 4
    assert normalized.cache_read_input_tokens is None
    assert normalized.thinking_tokens is None
