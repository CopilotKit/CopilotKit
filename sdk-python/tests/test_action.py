"""Tests for resolving action handler results."""

import asyncio
import inspect

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient

from copilotkit import Action, CopilotKitRemoteEndpoint
from copilotkit.integrations.fastapi import add_fastapi_endpoint


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "handler_kind", ["sync", "async", "callable", "wrapper", "future", "awaitable"]
)
async def test_execute_resolves_handler_result(handler_kind):
    calls = []

    def double(value):
        calls.append(value)
        return value * 2

    async def async_double(value):
        return double(value)

    class AsyncHandler:
        async def __call__(self, value):
            return double(value)

    def future_double(value):
        future = asyncio.get_running_loop().create_future()
        future.set_result(double(value))
        return future

    class AwaitableResult:
        def __init__(self, value):
            self.value = value

        def __await__(self):
            return async_double(self.value).__await__()

    handler = {
        "sync": double,
        "async": async_double,
        "callable": AsyncHandler(),
        "wrapper": lambda value: async_double(value),
        "future": future_double,
        "awaitable": AwaitableResult,
    }[handler_kind]
    action = Action(name="double", handler=handler)
    result = await action.execute(arguments={"value": 3})

    try:
        assert result == {"result": 6}
        assert calls == [3]
    finally:
        if inspect.iscoroutine(result["result"]):
            result["result"].close()


@pytest.mark.asyncio
@pytest.mark.parametrize("error_type", [ValueError, asyncio.CancelledError])
async def test_execute_propagates_wrapped_handler_errors(error_type):
    error = error_type("handler failed")

    async def fail():
        raise error

    coroutine = fail()
    action = Action(name="fail", handler=lambda: coroutine)
    try:
        with pytest.raises(error_type) as raised:
            await action.execute(arguments={})
        assert raised.value is error
    finally:
        coroutine.close()


@pytest.mark.asyncio
async def test_endpoint_serializes_wrapped_async_handler_result():
    async def double(value):
        return value * 2

    coroutines = []

    def wrapped_double(value):
        coroutine = double(value)
        coroutines.append(coroutine)
        return coroutine

    sdk = CopilotKitRemoteEndpoint(
        actions=[Action(name="double", handler=wrapped_double)]
    )
    app = FastAPI()
    add_fastapi_endpoint(app, sdk, "/copilotkit")

    try:
        async with AsyncClient(
            transport=ASGITransport(app=app), base_url="http://test"
        ) as client:
            response = await client.post(
                "/copilotkit/action/double", json={"arguments": {"value": 3}}
            )
        assert response.status_code == 200
        assert response.json() == {"result": 6}
    finally:
        for coroutine in coroutines:
            coroutine.close()
