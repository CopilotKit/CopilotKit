import asyncio

import httpx
import pytest

from copilotkit_intelligence import Intelligence
from copilotkit_runtime import IntelligenceRuntime


async def test_runtime_serves_private_sanitized_metadata_with_server_credentials():
    requests = []

    def platform(request):
        requests.append(request)
        return httpx.Response(
            200,
            json={
                "schemaVersion": 1,
                "identity": {"organizationName": "Org", "projectName": "App"},
                "license": {"state": "valid", "private": "key"},
                "private": "key",
            },
        )

    async with httpx.AsyncClient(transport=httpx.MockTransport(platform)) as http:
        sdk = Intelligence(api_key="server-key", http_client=http)
        runtime = IntelligenceRuntime(intelligence=sdk, agents={}, identify_user=lambda _: None)
        async with (
            runtime.app.router.lifespan_context(runtime.app),
            httpx.AsyncClient(
                transport=httpx.ASGITransport(app=runtime), base_url="http://runtime"
            ) as browser,
        ):
            response = await browser.get(
                "/copilotkit/inspector-metadata",
                headers={
                    "Authorization": "Bearer browser-key",
                    "Cookie": "session=private",
                },
            )
            info = await browser.get("/copilotkit/info")

    assert response.status_code == 200
    assert response.json() == {
        "schemaVersion": 1,
        "identity": {"organizationName": "Org", "projectName": "App"},
        "license": {"state": "valid"},
    }
    assert response.headers["cache-control"] == "no-store, private"
    metadata_requests = [
        request for request in requests if request.url.path == "/api/inspector/metadata"
    ]
    assert len(metadata_requests) == 1
    assert metadata_requests[0].headers["authorization"] == "Bearer server-key"
    assert "cookie" not in metadata_requests[0].headers
    assert info.json()["inspectorMetadata"] is True


@pytest.mark.parametrize(
    "status, body",
    [
        (204, b""),
        (404, b"private"),
        (403, b"private"),
        (500, b"private"),
        (200, b"private"),
        (200, b'{"schemaVersion":2}'),
        (200, b"null"),
    ],
)
async def test_runtime_metadata_absence_and_provider_errors_are_private_empty_responses(
    status, body, caplog
):
    async with httpx.AsyncClient(
        transport=httpx.MockTransport(lambda _: httpx.Response(status, content=body))
    ) as http:
        sdk = Intelligence(api_key="server-key", http_client=http)
        runtime = IntelligenceRuntime(intelligence=sdk, agents={}, identify_user=lambda _: None)
        async with (
            runtime.app.router.lifespan_context(runtime.app),
            httpx.AsyncClient(
                transport=httpx.ASGITransport(app=runtime), base_url="http://runtime"
            ) as browser,
        ):
            response = await browser.get("/copilotkit/inspector-metadata")

    assert response.status_code == 204 and response.content == b""
    assert response.headers["cache-control"] == "no-store, private"
    assert "private" not in caplog.text and "server-key" not in caplog.text


async def test_runtime_metadata_timeout_returns_private_absence_and_keeps_cancellation():
    started = asyncio.Event()

    async def platform(_):
        started.set()
        await asyncio.Event().wait()

    async with httpx.AsyncClient(transport=httpx.MockTransport(platform)) as http:
        sdk = Intelligence(api_key="server-key", http_client=http, request_timeout=0.02)
        runtime = IntelligenceRuntime(intelligence=sdk, agents={}, identify_user=lambda _: None)
        async with (
            runtime.app.router.lifespan_context(runtime.app),
            httpx.AsyncClient(
                transport=httpx.ASGITransport(app=runtime), base_url="http://runtime"
            ) as browser,
        ):
            response = await asyncio.wait_for(browser.get("/copilotkit/inspector-metadata"), 0.3)
            assert response.status_code == 204 and response.content == b""
            assert response.headers["cache-control"] == "no-store, private"
            started.clear()
            request = asyncio.create_task(browser.get("/copilotkit/inspector-metadata"))
            await asyncio.wait_for(started.wait(), 1)
            request.cancel()
            with pytest.raises(asyncio.CancelledError):
                await request


async def test_runtime_metadata_rejects_wrong_methods_before_provider_io():
    requests = []

    def platform(request):
        requests.append(request)
        return httpx.Response(200, json={"schemaVersion": 1})

    async with httpx.AsyncClient(transport=httpx.MockTransport(platform)) as http:
        sdk = Intelligence(api_key="server-key", http_client=http)
        runtime = IntelligenceRuntime(intelligence=sdk, agents={}, identify_user=lambda _: None)
        async with (
            runtime.app.router.lifespan_context(runtime.app),
            httpx.AsyncClient(
                transport=httpx.ASGITransport(app=runtime), base_url="http://runtime"
            ) as browser,
        ):
            for method in ("POST", "PATCH", "PUT", "DELETE"):
                response = await browser.request(method, "/copilotkit/inspector-metadata")
                assert response.status_code == 405 and response.headers["allow"] == "GET"

    assert requests == []


async def test_runtime_sanitizes_a_custom_sdk_provider_again(monkeypatch):
    async def metadata():
        return {
            "schemaVersion": 1,
            "plan": {"code": "team", "label": "Team", "secret": "private"},
            "action": {"kind": "manage_plan", "url": "https://cloud.test?token=private"},
        }

    async with Intelligence(api_key="server-key") as sdk:
        monkeypatch.setattr(sdk, "get_inspector_metadata", metadata)
        runtime = IntelligenceRuntime(intelligence=sdk, agents={}, identify_user=lambda _: None)
        async with (
            runtime.app.router.lifespan_context(runtime.app),
            httpx.AsyncClient(
                transport=httpx.ASGITransport(app=runtime), base_url="http://runtime"
            ) as browser,
        ):
            response = await browser.get("/copilotkit/inspector-metadata")

    assert response.status_code == 200
    assert response.json() == {"schemaVersion": 1, "plan": {"code": "team", "label": "Team"}}
