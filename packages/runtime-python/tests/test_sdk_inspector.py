import asyncio

import httpx
import pytest

from copilotkit_intelligence import Intelligence, IntelligenceError
from copilotkit_intelligence.inspector import parse_inspector_metadata


async def test_inspector_metadata_uses_server_auth_and_sanitizes_each_module():
    requests = []

    def platform(request):
        requests.append(request)
        return httpx.Response(
            200,
            json={
                "schemaVersion": 1,
                "identity": {"organizationName": " Org ", "projectName": " App ", "id": "private"},
                "plan": {"code": " team ", "label": " Team ", "secret": "private"},
                "license": {"state": "valid", "token": "private"},
                "action": {"kind": "manage_plan", "url": " https://cloud.test/manage "},
                "usage": {
                    "used": 3,
                    "limit": {"kind": "finite", "value": 10},
                    "expiringSoonCount": 2,
                },
                "private": "private",
            },
        )

    async with httpx.AsyncClient(transport=httpx.MockTransport(platform)) as http:
        sdk = Intelligence(
            api_key="server-key", api_url="https://platform.test/base", http_client=http
        )
        result = await sdk.get_inspector_metadata()

    assert result == {
        "schemaVersion": 1,
        "identity": {"organizationName": "Org", "projectName": "App"},
        "plan": {"code": "team", "label": "Team"},
        "license": {"state": "valid"},
        "action": {"kind": "manage_plan", "url": "https://cloud.test/manage"},
        "usage": {"used": 3, "limit": {"kind": "finite", "value": 10}, "expiringSoonCount": 2},
    }
    assert len(requests) == 1
    assert requests[0].url == "https://platform.test/base/api/inspector/metadata"
    assert requests[0].method == "GET" and requests[0].content == b""
    assert requests[0].headers["authorization"] == "Bearer server-key"
    assert "x-cpki-user-id" not in requests[0].headers


@pytest.mark.parametrize("status", [204, 404])
async def test_inspector_absence_does_not_parse_response_body(status):
    async with httpx.AsyncClient(
        transport=httpx.MockTransport(lambda _: httpx.Response(status, content=b"not json"))
    ) as http:
        sdk = Intelligence(api_key="key", http_client=http)

        assert await sdk.get_inspector_metadata() is None


async def test_inspector_deadline_covers_a_stalled_response_body():
    closed = asyncio.Event()

    class Body(httpx.AsyncByteStream):
        async def __aiter__(self):
            yield b'{"schemaVersion":'
            await asyncio.Event().wait()

        async def aclose(self):
            closed.set()

    async with httpx.AsyncClient(
        transport=httpx.MockTransport(lambda _: httpx.Response(200, stream=Body()))
    ) as http:
        sdk = Intelligence(api_key="key", http_client=http, request_timeout=0.02)

        with pytest.raises(TimeoutError, match="Inspector metadata request timed out"):
            await asyncio.wait_for(sdk.get_inspector_metadata(), 0.3)

        assert closed.is_set()


@pytest.mark.parametrize(
    "url",
    [
        "https://cloud.test/manage",
        "https://cloud.test/manage/plan",
        "http://localhost/manage",
        "http://localhost:3000/manage",
        "http://127.0.0.1:3000/manage",
        "http://[::1]:3000/manage",
    ],
)
def test_inspector_accepts_safe_action_urls(url):
    result = parse_inspector_metadata({"schemaVersion": 1, "action": {"kind": "renew", "url": url}})

    assert result == {"schemaVersion": 1, "action": {"kind": "renew", "url": url}}


@pytest.mark.parametrize(
    "url",
    [
        "",
        " ",
        "/manage",
        "mailto:billing@cloud.test",
        "ftp://cloud.test/manage",
        "http://cloud.test/manage",
        "http://localhost.example.com/manage",
        "http://sub.localhost/manage",
        "http://127.0.0.2/manage",
        "http://[::2]/manage",
        "http://0.0.0.0/manage",
        "https://@cloud.test/manage",
        "https://user@cloud.test/manage",
        "https://user:pass@cloud.test/manage",
        "https://cloud.test/manage?source=inspector",
        "https://cloud.test/manage?",
        "https://cloud.test/manage#billing",
        "https://cloud.test/manage#",
        "https://bad host/manage",
        "https://cloud.test:bad/manage",
        "https://cloud.test:65536/manage",
        "https://[broken/manage",
        "https://%20/manage",
    ],
)
def test_inspector_rejects_unsafe_action_without_hiding_valid_plan(url):
    result = parse_inspector_metadata(
        {
            "schemaVersion": 1,
            "action": {"kind": "renew", "url": url},
            "plan": {"code": "team", "label": "Team"},
        }
    )

    assert result == {"schemaVersion": 1, "plan": {"code": "team", "label": "Team"}}


@pytest.mark.parametrize(
    "value", [None, [], 1, "1", {}, {"schemaVersion": True}, {"schemaVersion": 2}]
)
def test_inspector_rejects_unsupported_top_level_schema(value):
    assert parse_inspector_metadata(value) is None


@pytest.mark.parametrize(
    "invalid", [None, True, -1, 1.5, 9007199254740992, float("inf"), float("nan"), "1"]
)
def test_inspector_drops_invalid_usage_numbers_independently(invalid):
    valid_usage = {"used": 3, "limit": {"kind": "finite", "value": 10}}

    assert parse_inspector_metadata(
        {"schemaVersion": 1, "usage": {**valid_usage, "used": invalid}}
    ) == {"schemaVersion": 1}
    assert parse_inspector_metadata(
        {
            "schemaVersion": 1,
            "usage": {**valid_usage, "limit": {"kind": "finite", "value": invalid}},
        }
    ) == {"schemaVersion": 1}
    assert parse_inspector_metadata(
        {"schemaVersion": 1, "usage": {**valid_usage, "expiringSoonCount": invalid}}
    ) == {"schemaVersion": 1, "usage": valid_usage}


def test_inspector_copies_fields_and_keeps_valid_modules():
    value = {
        "schemaVersion": 1.0,
        "identity": {"organizationName": "\ufeff Org \ufeff", "projectName": "\u0085"},
        "plan": {"code": "", "label": "Invalid"},
        "license": {"state": "unknown", "secret": "private"},
        "action": {"kind": "invalid", "url": "https://cloud.test"},
        "usage": {
            "used": 0.0,
            "limit": {"kind": "unlimited", "private": True},
            "expiringSoonCount": 0,
        },
    }

    result = parse_inspector_metadata(value)
    value["identity"]["organizationName"] = "changed"

    assert result == {
        "schemaVersion": 1,
        "identity": {"organizationName": "Org", "projectName": "\u0085"},
        "license": {"state": "unknown"},
        "usage": {"used": 0, "limit": {"kind": "unlimited"}, "expiringSoonCount": 0},
    }


@pytest.mark.parametrize("status", [301, 302, 401, 403, 429, 500, 503])
async def test_inspector_retains_error_status_without_following_redirects_or_disclosing_body(
    status,
):
    requests = []

    def platform(request):
        requests.append(request)
        return httpx.Response(
            status, headers={"location": "https://elsewhere.test"}, content=b"private-key"
        )

    async with httpx.AsyncClient(
        transport=httpx.MockTransport(platform), follow_redirects=True
    ) as http:
        sdk = Intelligence(api_key="key", http_client=http)
        with pytest.raises(IntelligenceError) as captured:
            await sdk.get_inspector_metadata()

    assert captured.value.status == status
    assert "private-key" not in str(captured.value)
    assert captured.value.__cause__ is None
    assert len(requests) == 1


async def test_inspector_rejects_malformed_json_and_redacts_transport_errors():
    def disconnected(_):
        raise httpx.ConnectError("private-key")

    for platform in (lambda _: httpx.Response(200, content=b"private-key"), disconnected):
        async with httpx.AsyncClient(transport=httpx.MockTransport(platform)) as http:
            sdk = Intelligence(api_key="key", http_client=http)
            with pytest.raises(IntelligenceError) as captured:
                await sdk.get_inspector_metadata()

        assert captured.value.status == 502
        assert "private-key" not in str(captured.value)
        assert captured.value.__suppress_context__


async def test_inspector_deadline_is_five_seconds_and_cancels_header_wait(monkeypatch):
    import copilotkit_intelligence.client as module

    assert module._INSPECTOR_METADATA_TIMEOUT == 5
    monkeypatch.setattr(module, "_INSPECTOR_METADATA_TIMEOUT", 0.02)
    cancelled = asyncio.Event()

    async def platform(_):
        try:
            await asyncio.Event().wait()
        finally:
            cancelled.set()

    async with httpx.AsyncClient(transport=httpx.MockTransport(platform)) as http:
        sdk = Intelligence(api_key="key", http_client=http, request_timeout=30)
        with pytest.raises(TimeoutError, match="Inspector metadata request timed out"):
            await asyncio.wait_for(sdk.get_inspector_metadata(), 0.3)
        assert cancelled.is_set()


async def test_inspector_preserves_caller_cancellation():
    started = asyncio.Event()

    async def platform(_):
        started.set()
        await asyncio.Event().wait()

    async with httpx.AsyncClient(transport=httpx.MockTransport(platform)) as http:
        sdk = Intelligence(api_key="key", http_client=http)
        task = asyncio.create_task(sdk.get_inspector_metadata())
        await asyncio.wait_for(started.wait(), 1)
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task
