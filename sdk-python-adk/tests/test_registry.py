from __future__ import annotations

import asyncio
from dataclasses import FrozenInstanceError

import pytest
from copilotkit import (
    IntelligenceAccessDeniedError,
    IntelligenceUnavailableError,
)

from conftest import CONTAINER_ID, FakeClock, FakeSkillsClient, client, skill_set


@pytest.mark.asyncio
async def test_load_is_singleflight_and_retries_after_failed_window(tmp_path) -> None:
    from copilotkit_intelligence_adk import SkillRegistry

    clock = FakeClock()
    skills = FakeSkillsClient()
    first = asyncio.get_running_loop().create_future()
    skills.get_outcomes.extend(
        [
            first,
            IntelligenceUnavailableError("offline"),
            skill_set(tmp_path, registry_revision="revision-2"),
        ]
    )
    registry = SkillRegistry(client(skills), CONTAINER_ID, clock=clock)

    callers = [asyncio.create_task(registry.load()) for _ in range(20)]
    for _ in range(10):
        await asyncio.sleep(0)
        if skills.get_calls:
            break
    assert len(skills.get_calls) == 1
    first.set_result(skill_set(tmp_path))
    snapshots = await asyncio.gather(*callers)
    assert len({id(snapshot) for snapshot in snapshots}) == 1

    clock.seconds = 30
    with pytest.raises(Exception) as first_failure:
        await registry.load()
    assert first_failure.value.code == "LEARNING_REGISTRY_STALE"
    assert registry.status == "stale"

    clock.seconds = 59.999
    with pytest.raises(Exception) as throttled:
        await registry.load()
    assert throttled.value is first_failure.value
    assert len(skills.get_calls) == 2

    clock.seconds = 60
    refreshed = await registry.load()
    assert refreshed.registry_revision == "revision-2"
    assert len(skills.get_calls) == 3


@pytest.mark.asyncio
async def test_wait_until_ready_success_timeout_and_immediate_rejections(
    tmp_path,
) -> None:
    from copilotkit_intelligence_adk import SkillRegistry

    skills = FakeSkillsClient()
    pending = asyncio.get_running_loop().create_future()
    skills.get_outcomes.append(pending)
    registry = SkillRegistry(client(skills), CONTAINER_ID)
    load = asyncio.create_task(registry.load())
    waiter = asyncio.create_task(registry.wait_until_ready(1))
    await asyncio.sleep(0)
    pending.set_result(skill_set(tmp_path))
    assert await waiter is await load

    cold = SkillRegistry(client(FakeSkillsClient()), CONTAINER_ID)
    with pytest.raises(Exception) as timeout:
        await cold.wait_until_ready(0.001)
    assert timeout.value.code == "LEARNING_REGISTRY_READINESS_TIMEOUT"

    denied_skills = FakeSkillsClient()
    denied_skills.get_outcomes.append(
        IntelligenceAccessDeniedError(
            "denied", code="LEARNING_REGISTRY_DENIED", category="permission"
        )
    )
    denied = SkillRegistry(client(denied_skills), CONTAINER_ID)
    with pytest.raises(IntelligenceAccessDeniedError):
        await denied.load()
    with pytest.raises(IntelligenceAccessDeniedError):
        await denied.wait_until_ready(0)

    stale_skills = FakeSkillsClient()
    stale_skills.get_outcomes.extend(
        [skill_set(tmp_path), IntelligenceUnavailableError("offline")]
    )
    clock = FakeClock()
    stale = SkillRegistry(client(stale_skills), CONTAINER_ID, clock=clock)
    await stale.load()
    clock.seconds = 30
    with pytest.raises(Exception) as stale_load:
        await stale.load()
    with pytest.raises(Exception) as stale_wait:
        await stale.wait_until_ready(0)
    assert stale_wait.value is stale_load.value

    await cold.aclose()
    with pytest.raises(Exception) as closed:
        await cold.wait_until_ready(0)
    assert closed.value.code == "LEARNING_REGISTRY_CLOSED"


@pytest.mark.asyncio
async def test_close_rejects_future_loads() -> None:
    from copilotkit_intelligence_adk import SkillRegistry

    skills = FakeSkillsClient()
    registry = SkillRegistry(client(skills), CONTAINER_ID)
    await registry.aclose()
    await registry.aclose()

    for operation in (registry.load, registry.preload, registry.preload_cached):
        with pytest.raises(Exception) as closed:
            await operation()
        assert closed.value.code == "LEARNING_REGISTRY_CLOSED"
    assert registry.status == "closed"
    assert not registry.ready
    assert skills.get_calls == []
    assert skills.cached_calls == []


@pytest.mark.asyncio
async def test_joined_callers_share_telemetry_sink_failure(tmp_path) -> None:
    from copilotkit_intelligence_adk import SkillRegistry

    sink_error = RuntimeError("sink failed")
    events: list[str] = []

    def telemetry(name: str, metadata: dict[str, object]) -> None:
        del metadata
        events.append(name)
        if name == "status.changed" and events.count(name) == 1:
            raise sink_error

    skills = FakeSkillsClient()
    pending = asyncio.get_running_loop().create_future()
    skills.get_outcomes.append(pending)
    registry = SkillRegistry(client(skills), CONTAINER_ID, telemetry=telemetry)
    first = asyncio.create_task(registry.load())
    await asyncio.sleep(0)
    second = asyncio.create_task(registry.load())
    await asyncio.sleep(0)
    pending.set_result(skill_set(tmp_path))
    results = await asyncio.gather(first, second, return_exceptions=True)

    assert results[0] is results[1]
    assert results[0].code == "LEARNING_TELEMETRY_SINK_FAILED"
    assert results[0].__cause__ is sink_error
    assert registry.status == "denied"
    assert not registry.ready
    assert len(skills.get_calls) == 1


@pytest.mark.asyncio
async def test_fresh_cached_revoked_and_empty_snapshots(tmp_path) -> None:
    from copilotkit_intelligence_adk import SkillRegistry

    skills = FakeSkillsClient()
    skills.cached_outcomes.append(skill_set(tmp_path, freshness="cached"))
    skills.get_outcomes.extend(
        [skill_set(tmp_path, revoked=True, texts=()), skill_set(tmp_path, texts=())]
    )
    registry = SkillRegistry(client(skills), CONTAINER_ID, refresh_interval=0)

    cached = await registry.preload_cached()
    assert cached.source == "cached"
    assert cached.skills[0].text == "# Skill\n"
    with pytest.raises(FrozenInstanceError):
        cached.status = "stale"

    revoked = await registry.preload()
    assert revoked.status == "revoked"
    assert revoked.skills == ()
    assert registry.ready

    empty = await registry.preload()
    assert empty.status == "ready"
    assert empty.skills == ()


@pytest.mark.asyncio
async def test_denial_clears_active_snapshot(tmp_path) -> None:
    from copilotkit_intelligence_adk import SkillRegistry

    skills = FakeSkillsClient()
    skills.get_outcomes.extend(
        [
            skill_set(tmp_path),
            IntelligenceAccessDeniedError(
                "denied",
                code="LEARNING_REGISTRY_DENIED",
                category="permission",
                status=403,
            ),
        ]
    )
    registry = SkillRegistry(client(skills), CONTAINER_ID, refresh_interval=0)
    assert (await registry.load()).skills
    with pytest.raises(IntelligenceAccessDeniedError):
        await registry.load()
    assert registry.status == "denied"
    assert registry.snapshot.skills == ()
    assert not registry.ready


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("kwargs", "code"),
    [
        (
            {"texts": tuple("# Skill\n" for _ in range(129))},
            "INTELLIGENCE_ADAPTER_TOO_MANY_SKILLS",
        ),
        ({"texts": ("x" * 262145,)}, "INTELLIGENCE_ADAPTER_SKILL_TOO_LARGE"),
        (
            {"texts": tuple(chr(97 + index) * 220000 for index in range(5))},
            "INTELLIGENCE_ADAPTER_CONTEXT_TOO_LARGE",
        ),
        (
            {"texts": ("# Skill\n",), "roles": ("script",)},
            "INTELLIGENCE_ADAPTER_SCRIPT_DISABLED",
        ),
        (
            {"texts": ("# Skill\n",), "paths": ("scripts/run.py",)},
            "INTELLIGENCE_ADAPTER_SCRIPT_DISABLED",
        ),
    ],
)
async def test_adapter_limits_and_script_denial(tmp_path, kwargs, code) -> None:
    from copilotkit_intelligence_adk import SkillRegistry

    skills = FakeSkillsClient()
    skills.get_outcomes.append(skill_set(tmp_path, **kwargs))
    registry = SkillRegistry(client(skills), CONTAINER_ID)
    with pytest.raises(Exception) as failure:
        await registry.load()
    assert failure.value.code == code
    assert registry.status == "denied"


@pytest.mark.asyncio
async def test_invalid_utf8_and_legacy_projection_fail_closed(tmp_path) -> None:
    from copilotkit_intelligence_adk import SkillRegistry

    invalid = skill_set(tmp_path / "invalid")
    (invalid.skill_descriptors[0].directory / "SKILL.md").write_bytes(b"\xff")
    legacy = skill_set(tmp_path / "legacy", legacy_only=True)
    invalid_skills = FakeSkillsClient()
    invalid_skills.get_outcomes.append(invalid)
    registry = SkillRegistry(client(invalid_skills), CONTAINER_ID)

    with pytest.raises(Exception) as invalid_failure:
        await registry.load()
    assert invalid_failure.value.code == "INTELLIGENCE_ADAPTER_INVALID_UTF8"

    legacy_skills = FakeSkillsClient()
    legacy_skills.get_outcomes.append(legacy)
    registry = SkillRegistry(client(legacy_skills), CONTAINER_ID)
    with pytest.raises(Exception) as legacy_failure:
        await registry.load()
    assert (
        legacy_failure.value.code == "INTELLIGENCE_ADAPTER_UNSUPPORTED_SDK_PROJECTION"
    )


@pytest.mark.asyncio
async def test_telemetry_contains_only_allowlisted_metadata(tmp_path) -> None:
    from copilotkit_intelligence_adk import SkillRegistry

    records: list[tuple[str, dict[str, object]]] = []
    skills = FakeSkillsClient()
    skills.get_outcomes.append(skill_set(tmp_path))
    registry = SkillRegistry(
        client(skills),
        CONTAINER_ID,
        telemetry=lambda name, metadata: records.append((name, metadata)),
    )
    await registry.load()

    allowed = {
        "adapterVersion",
        "errorCategory",
        "errorCode",
        "framework",
        "freshness",
        "latencyMs",
        "outcome",
        "reason",
        "registryRevision",
        "requestId",
        "retryable",
        "skillCount",
        "source",
        "status",
        "traceId",
    }
    assert [name for name, _ in records] == [
        "load.started",
        "status.changed",
        "load.succeeded",
    ]
    assert all(set(metadata) <= allowed for _, metadata in records)
    serialized = repr(records)
    assert CONTAINER_ID not in serialized
    assert "# Skill" not in serialized
    assert str(tmp_path) not in serialized
