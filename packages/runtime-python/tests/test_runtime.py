import asyncio

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


@pytest.mark.parametrize("cause", ["stop", "lease_failure"])
async def test_authoritative_stop_cancels_idle_producer_and_acks_before_cleanup(cause):
    from dataclasses import replace

    from copilotkit_runtime.gateway import Gateway

    stopped = asyncio.Event()
    cleanup = []

    class IdleAgent:
        description = "idle"

        async def run(self, input):
            try:
                await asyncio.Event().wait()
                yield {"type": "RUN_FINISHED"}
            finally:
                stopped.set()

    class TestGateway(Gateway):
        async def keepalive(self):
            await asyncio.Event().wait()

        async def send_many(self, events):
            cleanup.extend(event["type"] for event in events)

    app = runtime(lambda request: cleanup.append("unlock") or httpx.Response(200, json={}))
    app.agents["default"] = IdleAgent()
    if cause == "lease_failure":
        app.config = replace(app.config, lock_heartbeat_seconds=0.01)

        async def failed_renewal(*args, **kwargs):
            if args[0] == "PATCH":
                raise ConnectionError("lease lost")
            cleanup.append("unlock")
            return {}

        app.platform.request = failed_renewal
    gateway = TestGateway(app.config, "thread", "run", app.telemetry)
    task = asyncio.create_task(app._execute("default", {}, [], gateway))
    await asyncio.sleep(0.01)
    if cause == "stop":
        gateway.stop_requested.set()
    await asyncio.wait_for(asyncio.shield(task), 0.2)
    assert stopped.is_set()
    assert cleanup[0] == "RUN_STARTED"
    assert cleanup[-2:] == ["RUN_FINISHED" if cause == "stop" else "RUN_ERROR", "unlock"]
    await app.aclose()


async def test_shutdown_cancels_work_that_exceeds_deadline():
    from dataclasses import replace

    cancelled_twice = asyncio.Event()

    async def stuck_cleanup():
        try:
            await asyncio.Event().wait()
        except asyncio.CancelledError:
            try:
                await asyncio.Event().wait()
            finally:
                cancelled_twice.set()

    app = runtime(lambda request: httpx.Response(200, json={}))
    app.config = replace(app.config, shutdown_timeout=0.02)
    task = asyncio.create_task(stuck_cleanup())
    app._runs["thread"] = (task, "user", "default")
    await asyncio.sleep(0)
    await app.aclose()
    await asyncio.sleep(0)
    try:
        assert cancelled_twice.is_set()
    finally:
        task.cancel()
        await asyncio.gather(task, return_exceptions=True)


async def test_join_finishing_after_shutdown_cannot_launch_agent(monkeypatch):
    from copilotkit_runtime.gateway import Gateway

    joining, release = asyncio.Event(), asyncio.Event()
    cleanup = []

    async def join(self):
        joining.set()
        await release.wait()

    monkeypatch.setattr(Gateway, "join", join)

    def platform(request):
        if request.method == "DELETE":
            cleanup.append(request.url.path)
        if request.method == "POST":
            return httpx.Response(
                200, json={"threadId": "canonical", "runId": "canonical-run", "joinToken": "token"}
            )
        return httpx.Response(200, json={"messages": []})

    app = runtime(platform)
    app._owned_client = True
    startup = asyncio.create_task(
        app._run("default", {"threadId": "thread", "runId": "run"}, User("user"))
    )
    await joining.wait()
    await app.aclose()
    try:
        assert startup.done(), "Shutdown must drain pending startup before returning"
        with pytest.raises(asyncio.CancelledError):
            await startup
        assert not app._runs
        assert cleanup == ["/api/threads/canonical/lock"]
        assert app.client.is_closed
    finally:
        release.set()
        await asyncio.gather(startup, return_exceptions=True)
        await app.aclose()


@pytest.mark.parametrize("blocked_phase", ["join", "history"])
async def test_lease_renews_and_cancels_startup_while_join_is_blocked(monkeypatch, blocked_phase):
    from dataclasses import replace

    from copilotkit_runtime.gateway import Gateway
    from copilotkit_runtime.models import PlatformError

    joining = asyncio.Event()
    calls = []

    async def join(self):
        joining.set()
        await asyncio.Event().wait()

    monkeypatch.setattr(Gateway, "join", join)

    async def platform(request):
        calls.append(request.method)
        if blocked_phase == "history" and request.url.path.endswith("/messages"):
            joining.set()
            await asyncio.Event().wait()
        if request.method == "PATCH":
            return httpx.Response(409)
        if request.method == "POST":
            return httpx.Response(
                200, json={"threadId": "canonical", "runId": "canonical-run", "joinToken": "token"}
            )
        return httpx.Response(200, json={"messages": []})

    app = runtime(platform)
    app.config = replace(app.config, lock_heartbeat_seconds=0.01)
    startup = asyncio.create_task(
        app._run("default", {"threadId": "thread", "runId": "run"}, User("user"))
    )
    await joining.wait()
    try:
        with pytest.raises(PlatformError):
            await asyncio.wait_for(asyncio.shield(startup), 0.2)
        assert "PATCH" in calls and calls[-1] == "DELETE"
        assert not app._runs
    finally:
        startup.cancel()
        await asyncio.gather(startup, return_exceptions=True)
        await app.aclose()


async def test_already_failed_lease_never_enters_agent():
    from copilotkit_runtime.gateway import Gateway
    from copilotkit_runtime.runtime import _Lease

    entered = []

    class Agent:
        description = "must not start"

        async def run(self, input):
            entered.append(True)
            yield {"type": "RUN_FINISHED"}

    class TestGateway(Gateway):
        async def send_many(self, events):
            return None

        async def keepalive(self):
            await asyncio.Event().wait()

    app = runtime(lambda request: httpx.Response(200, json={}))
    app.agents["default"] = Agent()
    lease = _Lease(None, error=ConnectionError("expired"))
    await app._execute(
        "default", {}, [], TestGateway(app.config, "thread", "run", app.telemetry), lease
    )
    assert not entered
    await app.aclose()


async def test_immediate_agent_error_persists_input_before_finalization():
    from copilotkit_runtime.gateway import Gateway

    events = []

    class Agent:
        description = "throws"

        async def run(self, input):
            raise ValueError("private")
            yield {}

    class TestGateway(Gateway):
        async def send_many(self, batch):
            events.extend(batch)

        async def keepalive(self):
            await asyncio.Event().wait()

    app = runtime(lambda request: httpx.Response(200, json={}))
    app.agents["default"] = Agent()
    fresh = [{"id": "new", "role": "user", "content": "persist me"}]
    await app._execute(
        "default",
        {"threadId": "canonical", "runId": "run"},
        fresh,
        TestGateway(app.config, "canonical", "run", app.telemetry),
    )
    assert [event["type"] for event in events] == ["RUN_STARTED", "RUN_ERROR"]
    assert events[0]["input"]["messages"] == fresh
    await app.aclose()


@pytest.mark.parametrize(
    "grant,status",
    [
        ({"user": "none", "project": "none"}, 403),
        (None, 403),
        ({"user": "invalid", "project": "none"}, 500),
        ([], 500),
    ],
)
async def test_denied_or_invalid_memory_policy_never_contacts_platform(grant, status):
    calls = []
    app = runtime(
        lambda request: calls.append(request) or httpx.Response(200, json={"memories": []}),
        memory_policy=lambda *_: grant,
    )
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://runtime"
    ) as client:
        response = await client.get("/copilotkit/memories")
    assert response.status_code == status
    assert not calls
    await app.aclose()


@pytest.mark.parametrize(
    "scenario,status,stopped",
    [
        ("malformed", 400, False),
        ("revoked", 403, False),
        ("alias", 200, True),
        ("transferred", 200, True),
        ("different_agent", 403, False),
    ],
)
async def test_stop_uses_current_scoped_canonical_ownership(scenario, status, stopped):
    from copilotkit_runtime import HttpAgent
    from copilotkit_runtime.gateway import Gateway

    calls = []

    def platform(request):
        calls.append(request)
        return (
            httpx.Response(403)
            if scenario == "revoked"
            else httpx.Response(
                200,
                json={
                    "thread": {
                        "id": "canonical",
                        "agentId": "other" if scenario == "different_agent" else "default",
                    }
                },
            )
        )

    app = runtime(platform)
    app.agents["default"] = HttpAgent("http://agent")
    task = asyncio.create_task(asyncio.Event().wait())
    gateway = Gateway(app.config, "canonical", "run", app.telemetry)
    app._runs["canonical"] = (
        task,
        "previous-owner" if scenario == "transferred" else "trusted-user",
        "default",
    )
    app._gateways["canonical"] = gateway
    try:
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app), base_url="http://runtime"
        ) as client:
            response = await client.post(
                "/copilotkit/agent/default/stop/"
                + ("alias" if scenario == "alias" else "canonical"),
                json={"runId": False if scenario == "malformed" else "run"},
            )
        assert response.status_code == status
        assert gateway.stop_requested.is_set() == stopped
        if scenario == "malformed":
            assert not calls
        else:
            assert calls[0].url.params["userId"] == "trusted-user"
    finally:
        task.cancel()
        await asyncio.gather(task, return_exceptions=True)
        app._runs.clear()
        app._gateways.clear()
        await app.aclose()
