"""Regression tests for auxiliary A2UI model header forwarding."""

from __future__ import annotations

import asyncio
from contextlib import contextmanager
from types import SimpleNamespace

import httpx
import pytest
from copilotkit import copilotkit_lg_middleware
from langchain_core.runnables.config import var_child_runnable_config

from src.agents._header_forwarding_middleware import (
    AuxiliaryModelHeaderForwardingMiddleware,
)


_HEADER_CASES = (
    ("run-a", {"x-test-id": "run-a", "x-aimock-context": "run-a"}),
    ("run-b", {"x-test-id": "run-b", "x-aimock-context": "run-b"}),
    ("empty", {}),
    ("run-a", {"x-test-id": "run-a", "x-aimock-context": "run-a"}),
)


@pytest.fixture(autouse=True)
def clear_copilotkit_hooked_clients():
    copilotkit_lg_middleware._hooked_clients.clear()
    yield
    copilotkit_lg_middleware._hooked_clients.clear()


@contextmanager
def active_child_runnable_config(headers):
    token = var_child_runnable_config.set(
        {"configurable": headers, "context": {}, "metadata": {}}
    )
    try:
        yield
    finally:
        var_child_runnable_config.reset(token)


def observed_pair(request):
    return (
        request.headers.get("x-test-id"),
        request.headers.get("x-aimock-context"),
    )


def expected_pair(headers):
    return (
        headers.get("x-test-id"),
        headers.get("x-aimock-context"),
    )


def test_auxiliary_model_tool_calls_forward_current_request_headers():
    sync_observed = []
    async_observed = []

    def sync_transport(request):
        sync_observed.append(observed_pair(request))
        return httpx.Response(200)

    async def async_transport(request):
        async_observed.append(observed_pair(request))
        return httpx.Response(200)

    async def drive_tool_calls():
        with httpx.Client(
            transport=httpx.MockTransport(sync_transport),
            base_url="https://inner-model.test",
        ) as client:
            async with httpx.AsyncClient(
                transport=httpx.MockTransport(async_transport),
                base_url="https://inner-model.test",
            ) as async_client:
                model = SimpleNamespace(client=client, async_client=async_client)
                middleware = AuxiliaryModelHeaderForwardingMiddleware(model)

                def sync_handler(request):
                    response = model.client.get("/v1/responses")
                    response.raise_for_status()
                    return request

                async def async_handler(request):
                    response = await model.async_client.get("/v1/chat/completions")
                    response.raise_for_status()
                    return request

                for case_name, headers in _HEADER_CASES:
                    request = SimpleNamespace(tool_call={"name": case_name})
                    with active_child_runnable_config(headers):
                        assert (
                            middleware.wrap_tool_call(request, sync_handler) is request
                        )
                        assert (
                            await middleware.awrap_tool_call(request, async_handler)
                            is request
                        )

    asyncio.run(drive_tool_calls())

    expected = [expected_pair(headers) for _, headers in _HEADER_CASES]
    assert sync_observed == expected
    assert async_observed == expected
