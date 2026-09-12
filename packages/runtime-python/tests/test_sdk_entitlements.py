import asyncio
import copy
import time

import httpx
import pytest

import copilotkit_intelligence.client as client_module
from copilotkit_intelligence import Intelligence, IntelligenceError, RuntimeEntitlementError


def ready(active=True):
    return {
        "status": "ready",
        "entitlement": {
            "active": active,
            "source": "managedOrgSubscription",
            "features": {"memory": True},
            "limits": {"threads": 100},
            "planCode": "pro",
        },
    }


@pytest.mark.parametrize("legacy", [False, True])
async def test_entitlements_normalize_current_and_legacy_responses(legacy):
    expected = ready()
    payload = {**expected["entitlement"], "organizationId": "org"} if legacy else expected
    requests = []

    def platform(request):
        requests.append(request)
        return httpx.Response(200, json=payload)

    async with httpx.AsyncClient(transport=httpx.MockTransport(platform)) as http:
        sdk = Intelligence(api_key="server-key", http_client=http)
        method = getattr(sdk, "get_runtime_entitlements", None)
        assert callable(method), "standalone SDK must expose runtime entitlements"

        result = await method()

    assert result == expected
    assert requests[0].url.path == "/api/entitlements/runtime"
    assert requests[0].method == "GET" and requests[0].content == b""
    assert requests[0].headers["authorization"] == "Bearer server-key"


@pytest.mark.parametrize("status", ["degraded", "misconfigured", "unavailable"])
async def test_entitlements_preserve_structured_nonready_results(status):
    payload = {
        "status": status,
        "error": {
            "code": "UNAVAILABLE",
            "message": "Try later",
            "retryable": True,
            "requestId": "request",
            "traceId": "trace",
        },
    }
    async with httpx.AsyncClient(
        transport=httpx.MockTransport(lambda _: httpx.Response(200, json=payload))
    ) as http:
        sdk = Intelligence(api_key="key", http_client=http)

        result = await sdk.get_runtime_entitlements()

    assert result == payload


@pytest.mark.parametrize(
    "mutation",
    [
        lambda value: value.update(extra=True),
        lambda value: value["entitlement"].update(active=1),
        lambda value: value["entitlement"].update(source="unknown"),
        lambda value: value["entitlement"].update(features={"memory": 1}),
        lambda value: value["entitlement"].update(limits={"threads": True}),
        lambda value: value["entitlement"].update(planCode=None),
    ],
)
async def test_entitlements_reject_invalid_authority(mutation):
    payload = copy.deepcopy(ready())
    mutation(payload)
    async with httpx.AsyncClient(
        transport=httpx.MockTransport(lambda _: httpx.Response(200, json=payload))
    ) as http:
        sdk = Intelligence(api_key="key", http_client=http)

        with pytest.raises(IntelligenceError) as caught:
            await sdk.get_runtime_entitlements()

    assert caught.value.status == 502
    assert caught.value.retryable is False


async def test_entitlements_share_inflight_requests_and_copy_each_result():
    started = asyncio.Event()
    release = asyncio.Event()
    calls = []

    async def platform(request):
        calls.append(request)
        started.set()
        await release.wait()
        return httpx.Response(200, json=ready())

    async with httpx.AsyncClient(transport=httpx.MockTransport(platform)) as http:
        sdk = Intelligence(api_key="key", http_client=http)
        tasks = [asyncio.create_task(sdk.get_runtime_entitlements()) for _ in range(8)]
        await started.wait()
        await asyncio.sleep(0)
        release.set()
        results = await asyncio.gather(*tasks)
        results[0]["entitlement"]["features"]["memory"] = False
        cached = await sdk.get_runtime_entitlements()

    assert len(calls) == 1
    assert cached == ready() and all(result == ready() for result in results[1:])


@pytest.mark.parametrize("active, ttl", [(True, 30), (False, 5)])
async def test_entitlements_expire_without_serving_stale_authority(monkeypatch, active, ttl):
    now = [100.0]
    monkeypatch.setattr(client_module, "_entitlement_now", lambda: now[0], raising=False)
    calls = []

    def platform(request):
        calls.append(request)
        return httpx.Response(200, json=ready(active)) if len(calls) == 1 else httpx.Response(503)

    async with httpx.AsyncClient(transport=httpx.MockTransport(platform)) as http:
        sdk = Intelligence(api_key="key", http_client=http)
        assert await sdk.get_runtime_entitlements() == ready(active)
        now[0] += ttl - 0.01
        assert await sdk.get_runtime_entitlements() == ready(active)
        now[0] += 0.02
        with pytest.raises(IntelligenceError) as caught:
            await sdk.get_runtime_entitlements()

    assert caught.value.status == 503 and len(calls) == 2


async def test_entitlements_cache_safe_error_copies_for_five_seconds(monkeypatch):
    now = [100.0]
    monkeypatch.setattr(client_module, "_entitlement_now", lambda: now[0], raising=False)
    calls = []

    def platform(request):
        calls.append(request)
        return httpx.Response(403, content=b"provider-secret-payload")

    async with httpx.AsyncClient(transport=httpx.MockTransport(platform)) as http:
        sdk = Intelligence(api_key="key", http_client=http)
        with pytest.raises(IntelligenceError) as first:
            await sdk.get_runtime_entitlements()
        first.value.status = 999
        first.value.retryable = True
        with pytest.raises(IntelligenceError) as second:
            await sdk.get_runtime_entitlements()
        assert len(calls) == 1
        now[0] += 5
        with pytest.raises(IntelligenceError):
            await sdk.get_runtime_entitlements()

    assert second.value is not first.value
    assert second.value.status == 403 and second.value.retryable is False
    assert "provider-secret-payload" not in str(second.value)
    assert len(calls) == 2


@pytest.mark.parametrize(
    "status, retryable",
    [(401, False), (403, False), (404, False), (408, True), (425, True), (429, True), (500, True)],
)
async def test_entitlement_http_errors_retain_retryability(status, retryable):
    async with httpx.AsyncClient(
        transport=httpx.MockTransport(
            lambda _: httpx.Response(status, content=b"provider-secret-payload")
        )
    ) as http:
        sdk = Intelligence(api_key="key", http_client=http)
        with pytest.raises(IntelligenceError) as caught:
            await sdk.get_runtime_entitlements()

    assert caught.value.status == status and caught.value.retryable is retryable
    assert "provider-secret-payload" not in str(caught.value)


async def test_entitlements_deadline_includes_streamed_body():
    closed = asyncio.Event()

    class PendingBody(httpx.AsyncByteStream):
        async def __aiter__(self):
            await asyncio.Event().wait()
            yield b"{}"

        async def aclose(self):
            closed.set()

    async with httpx.AsyncClient(
        transport=httpx.MockTransport(lambda _: httpx.Response(200, stream=PendingBody()))
    ) as http:
        sdk = Intelligence(api_key="key", http_client=http)
        started = time.monotonic()
        with pytest.raises(IntelligenceError) as caught:
            await asyncio.wait_for(sdk.get_runtime_entitlements(), 3)

    assert caught.value.status == 504 and caught.value.retryable is True
    assert time.monotonic() - started < 3 and closed.is_set()


async def test_entitlement_cancellation_keeps_other_waiters_and_cancels_last_waiter():
    started = asyncio.Event()
    release = asyncio.Event()
    cancelled = asyncio.Event()
    calls = []

    async def platform(request):
        calls.append(request)
        started.set()
        try:
            await release.wait()
        except asyncio.CancelledError:
            cancelled.set()
            raise
        return httpx.Response(200, json=ready())

    async with httpx.AsyncClient(transport=httpx.MockTransport(platform)) as http:
        sdk = Intelligence(api_key="key", http_client=http)
        first = asyncio.create_task(sdk.get_runtime_entitlements())
        second = asyncio.create_task(sdk.get_runtime_entitlements())
        await started.wait()
        first.cancel()
        with pytest.raises(asyncio.CancelledError):
            await first
        assert not cancelled.is_set()
        second.cancel()
        with pytest.raises(asyncio.CancelledError):
            await second
        assert cancelled.is_set()
        release.set()
        assert await sdk.get_runtime_entitlements() == ready()

    assert len(calls) == 2


async def test_entitlement_sdk_close_cancels_request_but_preserves_borrowed_http():
    started = asyncio.Event()

    async def platform(request):
        if request.url.path == "/health":
            return httpx.Response(200)
        started.set()
        await asyncio.Event().wait()

    async with httpx.AsyncClient(transport=httpx.MockTransport(platform)) as http:
        sdk = Intelligence(api_key="key", http_client=http)
        task = asyncio.create_task(sdk.get_runtime_entitlements())
        await started.wait()
        await sdk.aclose()
        with pytest.raises(asyncio.CancelledError):
            await task
        assert (await http.get("https://platform.test/health")).status_code == 200


async def test_nonready_entitlements_expire_after_five_seconds(monkeypatch):
    now = [100.0]
    monkeypatch.setattr(client_module, "_entitlement_now", lambda: now[0])
    calls = []
    payload = {
        "status": "degraded",
        "error": {"code": "WAIT", "message": "Try later", "retryable": True},
    }

    def platform(request):
        calls.append(request)
        return httpx.Response(200, json=payload)

    async with httpx.AsyncClient(transport=httpx.MockTransport(platform)) as http:
        sdk = Intelligence(api_key="key", http_client=http)
        first = await sdk.get_runtime_entitlements()
        first["error"]["retryable"] = False
        now[0] += 4.99
        assert await sdk.get_runtime_entitlements() == payload and len(calls) == 1
        now[0] += 0.01
        assert await sdk.get_runtime_entitlements() == payload and len(calls) == 2


async def test_entitlements_reject_overflowed_numbers_as_invalid_authority():
    body = (
        '{"status":"ready","entitlement":{"active":true,"source":"managedOrgSubscription","features":{},"limits":{"threads":'
        + "9" * 400
        + "}}}"
    )
    async with httpx.AsyncClient(
        transport=httpx.MockTransport(lambda _: httpx.Response(200, text=body))
    ) as http:
        sdk = Intelligence(api_key="key", http_client=http)

        with pytest.raises(IntelligenceError) as caught:
            await sdk.get_runtime_entitlements()

    assert caught.value.status == 502 and caught.value.retryable is False


@pytest.mark.parametrize("failure", [httpx.ConnectError, OSError, RuntimeError])
async def test_entitlements_sanitize_transport_failures(failure):
    def platform(_):
        raise failure("provider-secret-payload")

    async with httpx.AsyncClient(transport=httpx.MockTransport(platform)) as http:
        sdk = Intelligence(api_key="key", http_client=http)
        with pytest.raises(IntelligenceError) as caught:
            await sdk.get_runtime_entitlements()

    assert caught.value.status == 502 and caught.value.retryable is True
    assert "provider-secret-payload" not in str(caught.value)
    assert caught.value.__cause__ is None


async def test_entitlements_sanitize_typed_transport_errors_before_caching():
    requests = []

    def platform(request):
        requests.append(request)
        raise RuntimeEntitlementError(502, "provider-secret-payload", False)

    errors = []
    async with httpx.AsyncClient(transport=httpx.MockTransport(platform)) as http:
        sdk = Intelligence(api_key="key", http_client=http)
        for _ in range(2):
            with pytest.raises(RuntimeEntitlementError) as caught:
                await sdk.get_runtime_entitlements()
            errors.append(caught.value)

    assert len(requests) == 1
    assert errors[0] is not errors[1]
    for error in errors:
        assert error.status == 502 and error.retryable is False
        assert "provider-secret-payload" not in str(error)
        assert error.__cause__ is None


async def test_entitlements_preserve_shorter_request_deadlines():
    async def platform(_):
        await asyncio.Event().wait()

    async with httpx.AsyncClient(transport=httpx.MockTransport(platform)) as http:
        sdk = Intelligence(api_key="key", http_client=http, request_timeout=0.025)
        with pytest.raises(IntelligenceError) as caught:
            await asyncio.wait_for(sdk.get_runtime_entitlements(), 0.5)

    assert caught.value.status == 504 and caught.value.retryable is True


@pytest.mark.parametrize(
    "payload",
    [
        None,
        [],
        {},
        {"status": "ready"},
        {"status": "ready", "entitlement": {**ready()["entitlement"], "extra": True}},
        {"status": "misconfigured", "error": {"code": "X", "message": "X", "retryable": 1}},
        {
            "status": "unavailable",
            "error": {"code": "X", "message": "X", "retryable": True, "traceId": None},
        },
        {**ready()["entitlement"], "organizationId": "org", "extra": True},
    ],
)
async def test_entitlements_reject_unknown_or_incomplete_response_shapes(payload):
    async with httpx.AsyncClient(
        transport=httpx.MockTransport(lambda _: httpx.Response(200, json=payload))
    ) as http:
        sdk = Intelligence(api_key="key", http_client=http)
        with pytest.raises(IntelligenceError) as caught:
            await sdk.get_runtime_entitlements()

    assert caught.value.status == 502 and caught.value.retryable is False
