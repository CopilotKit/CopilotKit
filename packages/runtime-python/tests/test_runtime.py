import httpx
import pytest

from copilotkit_runtime import IntelligenceRuntime, RuntimeConfig, User


async def identify(request):
    return User(id="trusted-user", name="Trusted")


def runtime(handler, **kwargs):
    return IntelligenceRuntime(
        RuntimeConfig(
            api_key="secret",
            api_url="http://platform",
            runner_url="ws://runner",
            client_url="ws://client",
            telemetry_enabled=False,
        ),
        agents={},
        identify_user=identify,
        http_client=httpx.AsyncClient(transport=httpx.MockTransport(handler)),
        **kwargs,
    )


async def test_memory_identity_cannot_be_spoofed():
    seen = []

    def platform(request):
        seen.append(request)
        return httpx.Response(200, json={"memories": []})

    app = runtime(platform)
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://runtime"
    ) as client:
        response = await client.get(
            "/copilotkit/memories?userId=attacker", headers={"x-cpki-user-id": "attacker"}
        )
    assert response.status_code == 200
    assert seen[0].headers["x-cpki-user-id"] == "trusted-user"
    assert "attacker" not in str(seen[0].url)
    await app.aclose()


async def test_invalid_json_array_is_bad_request():
    app = runtime(lambda request: pytest.fail("must not contact platform"))
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://runtime"
    ) as client:
        response = await client.post("/copilotkit/memories", json=[])
    assert response.status_code == 400
    await app.aclose()


async def test_connect_preserves_dependency_status():
    from copilotkit_runtime import HttpAgent

    app = runtime(lambda request: httpx.Response(503, text="private upstream diagnostic"))
    app.agents["default"] = HttpAgent("http://agent")
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://runtime"
    ) as client:
        response = await client.post(
            "/copilotkit/agent/default/connect", json={"threadId": "thread"}
        )
    assert response.status_code == 503
    assert "private upstream" not in response.text
    await app.aclose()


async def test_inspection_checks_ownership_before_privileged_fetch():
    calls = []

    def platform(request):
        calls.append(request.url.path)
        return httpx.Response(403, json={"error": "forbidden"})

    app = runtime(platform)
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://runtime"
    ) as client:
        response = await client.get("/copilotkit/threads/private/events")
    assert response.status_code == 403
    assert calls == ["/api/threads/private"]
    await app.aclose()


async def test_missing_identity_denies_access():
    async def anonymous(request):
        return None

    app = IntelligenceRuntime(
        RuntimeConfig(api_key="secret", telemetry_enabled=False), agents={}, identify_user=anonymous
    )
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://runtime"
    ) as client:
        response = await client.get("/copilotkit/memories")
    assert response.status_code == 401
    await app.aclose()


async def test_state_response_matches_browser_shape():
    def platform(request):
        if request.url.path.endswith("/state"):
            return httpx.Response(200, json={"kind": "snapshot", "state": {"count": 3}})
        return httpx.Response(200, json={"thread": {"id": "owned"}})

    app = runtime(platform)
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://runtime"
    ) as client:
        response = await client.get("/copilotkit/threads/owned/state")
    assert response.json() == {"state": {"count": 3}}
    await app.aclose()


def test_managed_endpoint_defaults_match_typescript():
    config = RuntimeConfig(api_key="fixture")
    assert config.runner_url == "wss://realtime.intelligence.copilotkit.ai/runner"
    assert config.client_url == "wss://realtime.intelligence.copilotkit.ai/client"


async def test_application_error_handler_is_separate_and_failure_isolated():
    errors = []

    async def on_error(error, phase):
        errors.append((type(error).__name__, phase))
        raise ValueError("private handler error")

    app = runtime(lambda request: httpx.Response(503), on_error=on_error)
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://runtime"
    ) as client:
        response = await client.get("/copilotkit/memories")
    assert response.status_code == 502
    assert "private handler" not in response.text
    assert errors == [("PlatformError", "platform")]
    await app.aclose()
