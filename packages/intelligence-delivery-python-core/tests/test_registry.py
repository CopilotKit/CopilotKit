import asyncio
import dataclasses
from collections import deque
from unittest.mock import AsyncMock

import httpx
import pytest
from conftest import LIFECYCLE, response
from copilotkit_intelligence import Intelligence, LearnedSkillsError

from _delivery import registry as registry_module
from _delivery.registry import Registry


def setup(**options):
    client = AsyncMock(spec=Intelligence)
    return Registry(
        client=client, container_id="container", **options
    ), client.get_learned_skills_snapshot


@pytest.mark.parametrize("case", LIFECYCLE["cases"], ids=lambda case: case["name"])
async def test_lifecycle_conformance(case, monkeypatch):
    now = [0]
    monkeypatch.setattr(registry_module, "monotonic", lambda: now[0])
    monkeypatch.setattr(registry_module, "time", lambda: now[0])
    registry, fetch = setup(**case.get("config", {}))
    replies = deque()

    async def get(**kwargs):
        if case.get("config", {}).get("revision"):
            assert kwargs["revision"] == case["config"]["revision"]
        reply = replies.popleft()
        if "error" in reply:
            raise LearnedSkillsError(reply["error"], reply["retryable"])
        if "unchanged" in reply:
            initial = response(reply["unchanged"])
            return {"status": "unchanged", "revision": initial["revision"], "etag": initial["etag"]}
        return response(reply["snapshot"])

    fetch.side_effect = get
    for step in case["steps"]:
        now[0] += step.get("advanceMs", 0) / 1000
        if "reply" in step:
            replies.append(step["reply"])
        expected = step["expect"]
        if "error" in expected:
            with pytest.raises(LearnedSkillsError) as error:
                await registry.acquire_snapshot()
            assert error.value.code == expected["error"]
        else:
            assert (await registry.acquire_snapshot()).revision == expected["revision"]
        assert fetch.await_count == expected["requests"]
        for name, value in expected.items():
            if name not in ("requests", "error"):
                assert (
                    getattr(registry.status, "last_checked_at" if name == "lastCheckedAt" else name)
                    == value
                )


async def test_cold_waiters_share_refresh_and_cancellation_does_not_cancel_it():
    registry, fetch = setup()
    entered, release = asyncio.Event(), asyncio.Event()

    async def get(**kwargs):
        entered.set()
        await release.wait()
        return response()

    fetch.side_effect = get
    first = asyncio.create_task(registry.initialize())
    second = asyncio.create_task(registry.acquire_snapshot())
    await entered.wait()
    first.cancel()
    with pytest.raises(asyncio.CancelledError):
        await first
    release.set()
    pinned = await second
    assert pinned is await registry.acquire_snapshot()
    assert fetch.await_count == 1


async def test_warm_concurrency_replaces_atomically_and_denial_coalesces(monkeypatch):
    now = [0]
    monkeypatch.setattr(registry_module, "monotonic", lambda: now[0])
    registry, fetch = setup()
    fetch.return_value = response()
    pinned = await registry.acquire_snapshot()
    now[0] = 5
    fetch.return_value = response("empty-r2")
    new = await asyncio.gather(*(registry.acquire_snapshot() for _ in range(10)))
    assert all(item is new[0] for item in new)
    assert pinned.revision == "r1" and new[0].revision == "r2"
    assert fetch.await_count == 2
    now[0] = 10
    fetch.side_effect = LearnedSkillsError("REVISION_REVOKED", False)
    errors = await asyncio.gather(
        *(registry.acquire_snapshot() for _ in range(10)), return_exceptions=True
    )
    assert all(item.code == "REVISION_REVOKED" for item in errors)
    assert fetch.await_count == 3


async def test_304_clears_stale_error(monkeypatch):
    now = [0]
    monkeypatch.setattr(registry_module, "monotonic", lambda: now[0])
    registry, fetch = setup()
    initial = response()
    fetch.return_value = initial
    pinned = await registry.acquire_snapshot()
    now[0] = 5
    fetch.side_effect = LearnedSkillsError("NETWORK_ERROR", True)
    assert await registry.acquire_snapshot() is pinned
    assert registry.status.stale
    fetch.side_effect = None
    fetch.return_value = {
        "status": "unchanged",
        "revision": initial["revision"],
        "etag": initial["etag"],
    }
    assert await registry.acquire_snapshot() is pinned
    assert not registry.status.stale and registry.status.last_error is None


@pytest.mark.parametrize(
    "code",
    [
        "AUTHENTICATION_FAILED",
        "AUTHORIZATION_FAILED",
        "ENTITLEMENT_REQUIRED",
        "DELIVERY_DISABLED",
        "REVISION_REVOKED",
    ],
)
async def test_denial_blocks_until_success_without_changing_old_pin(code, monkeypatch):
    now = [0]
    monkeypatch.setattr(registry_module, "monotonic", lambda: now[0])
    registry, fetch = setup()
    fetch.return_value = response()
    pinned = await registry.acquire_snapshot()
    now[0] = 5
    fetch.side_effect = LearnedSkillsError(code, False)
    with pytest.raises(LearnedSkillsError):
        await registry.acquire_snapshot()
    fetch.side_effect = LearnedSkillsError("NETWORK_ERROR", True)
    with pytest.raises(LearnedSkillsError) as error:
        await registry.acquire_snapshot()
    assert error.value.code == code
    fetch.side_effect = None
    fetch.return_value = response("empty-r2")
    assert (await registry.acquire_snapshot()).revision == "r2"
    assert pinned.revision == "r1"


async def test_remaining_deadline_bounds_validation_without_late_install(monkeypatch):
    import threading

    from _delivery.snapshot import validate_snapshot

    registry, fetch = setup(request_timeout=0.02)
    release, finished = threading.Event(), threading.Event()
    now = [0.0]
    monkeypatch.setattr(registry_module, "monotonic", lambda: now[0])

    async def get(**kwargs):
        assert kwargs["request_timeout"] == 0.02
        now[0] = 0.015
        return response()

    def validate(value):
        release.wait()
        try:
            return validate_snapshot(value)
        finally:
            finished.set()

    fetch.side_effect = get
    monkeypatch.setattr(registry_module, "validate_snapshot", validate)
    try:
        with pytest.raises(LearnedSkillsError) as error:
            await asyncio.wait_for(registry.acquire_snapshot(), 0.5)
        assert error.value.code == "TIMEOUT"
        assert not registry.status.initialized
    finally:
        release.set()
        await asyncio.to_thread(finished.wait)
    assert not registry.status.initialized


async def test_known_403_beats_registry_deadline():
    class Body(httpx.AsyncByteStream):
        async def __aiter__(self):
            await asyncio.Event().wait()
            yield b""

    async with httpx.AsyncClient(
        transport=httpx.MockTransport(lambda _: httpx.Response(403, stream=Body()))
    ) as http:
        registry = Registry(
            client=Intelligence(api_key="secret", http_client=http),
            container_id="c",
            request_timeout=0.01,
        )
        with pytest.raises(LearnedSkillsError) as error:
            await registry.acquire_snapshot()
        assert error.value.code == "AUTHORIZATION_FAILED"


@pytest.mark.parametrize("debug", [False, True])
async def test_status_and_logs_are_safe_and_immutable(debug, caplog, monkeypatch):
    caplog.set_level("DEBUG")
    now = [0]
    monkeypatch.setattr(registry_module, "monotonic", lambda: now[0])
    registry, fetch = setup(debug=debug)
    fetch.return_value = response()
    await registry.initialize()
    now[0] = 5
    fetch.side_effect = LearnedSkillsError(
        "NETWORK_ERROR", True, ValueError("secret skill prompt key")
    )
    await registry.acquire_snapshot()
    status = registry.status
    with pytest.raises(dataclasses.FrozenInstanceError):
        status.stale = False
    assert not hasattr(status.last_error, "cause")
    assert all(secret not in caplog.text for secret in ("secret", "Refund", "30 days"))
    assert bool(caplog.records) is debug


@pytest.mark.parametrize("value", [None, {"status": "unchanged", "revision": "r1", "etag": '"x"'}])
async def test_invalid_cold_response(value):
    registry, fetch = setup()
    fetch.return_value = value
    with pytest.raises(LearnedSkillsError) as error:
        await registry.initialize()
    assert error.value.code == "INVALID_SNAPSHOT"


async def test_known_403_with_async_cleanup_beats_registry_deadline():
    closed = asyncio.Event()

    class Body(httpx.AsyncByteStream):
        async def __aiter__(self):
            await asyncio.Event().wait()
            yield b""

        async def aclose(self):
            await asyncio.sleep(0)
            closed.set()

    async with httpx.AsyncClient(
        transport=httpx.MockTransport(lambda _: httpx.Response(403, stream=Body()))
    ) as http:
        registry = Registry(
            client=Intelligence(api_key="secret", http_client=http),
            container_id="c",
            request_timeout=0.01,
        )
        with pytest.raises(LearnedSkillsError) as error:
            await registry.acquire_snapshot()
        assert error.value.code == "AUTHORIZATION_FAILED"
        await asyncio.wait_for(closed.wait(), 0.5)


async def test_captures_response_before_validation_worker_and_checks_verified_pin():
    import threading
    from concurrent.futures import ThreadPoolExecutor

    executor = ThreadPoolExecutor(max_workers=1)
    release = threading.Event()
    blocker = executor.submit(release.wait)
    loop = asyncio.get_running_loop()
    old_executor = loop._default_executor
    loop.set_default_executor(executor)
    registry, fetch = setup(revision="r1")
    mutable = response()
    fetch.return_value = mutable
    pending = asyncio.create_task(registry.acquire_snapshot())
    try:
        while fetch.await_count == 0:
            await asyncio.sleep(0)
        # The worker is blocked; the response must already belong to the registry.
        mutable.clear()
        mutable.update(response("empty-r2"))
        release.set()
        assert (await pending).revision == "r1"
    finally:
        release.set()
        await asyncio.gather(pending, return_exceptions=True)
        blocker.result()
        loop._default_executor = old_executor
        executor.shutdown()


async def test_denial_status_replaces_stale_error_and_survives_network_failure(monkeypatch):
    now = [0]
    monkeypatch.setattr(registry_module, "monotonic", lambda: now[0])
    registry, fetch = setup()
    fetch.return_value = response()
    await registry.initialize()
    now[0] = 5
    fetch.side_effect = LearnedSkillsError("NETWORK_ERROR", True)
    await registry.acquire_snapshot()
    assert registry.status.stale
    fetch.side_effect = LearnedSkillsError("REVISION_REVOKED", False)
    with pytest.raises(LearnedSkillsError):
        await registry.acquire_snapshot()
    assert not registry.status.stale
    fetch.side_effect = LearnedSkillsError("NETWORK_ERROR", True)
    with pytest.raises(LearnedSkillsError):
        await registry.acquire_snapshot()
    assert registry.status.last_error.code == "REVISION_REVOKED"


async def test_close_awaits_owned_refresh_cancellation_without_closing_injected_client():
    registry, fetch = setup()
    started, finished = asyncio.Event(), asyncio.Event()

    async def get(**kwargs):
        started.set()
        try:
            await asyncio.Event().wait()
        finally:
            finished.set()

    fetch.side_effect = get
    pending = asyncio.create_task(registry.acquire_snapshot())
    await started.wait()
    await registry.aclose()
    assert finished.is_set()
    with pytest.raises(asyncio.CancelledError):
        await pending
    with pytest.raises(LearnedSkillsError) as error:
        await registry.acquire_snapshot()
    assert error.value.code == "INVALID_CONFIG"
