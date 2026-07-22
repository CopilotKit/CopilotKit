from __future__ import annotations

import asyncio

import pytest
from agent_framework import AgentSession, SessionContext
from copilotkit import IntelligenceUnavailableError

from conftest import CONTAINER_ID, FakeClock, FakeSkillsClient, client, skill_set


def _context() -> SessionContext:
    return SessionContext(input_messages=[], instructions=["existing"])


@pytest.mark.asyncio
async def test_provider_loads_before_context_generation(tmp_path) -> None:
    from copilotkit_intelligence_agent_framework import SkillRegistryContextProvider

    skills = FakeSkillsClient()
    skills.get_outcomes.append(skill_set(tmp_path, texts=("# First\n", "# Second\n")))
    provider = SkillRegistryContextProvider(client(skills), CONTAINER_ID)
    context = _context()

    await provider.before_run(
        agent=object(), session=AgentSession(), context=context, state={}
    )

    assert context.instructions == ["existing", "# First\n", "# Second\n"]
    assert skills.get_calls == [CONTAINER_ID]


@pytest.mark.asyncio
async def test_retry_after_failed_throttle_window(tmp_path) -> None:
    from copilotkit_intelligence_agent_framework import SkillRegistryContextProvider

    clock = FakeClock()
    skills = FakeSkillsClient()
    skills.get_outcomes.extend(
        [
            IntelligenceUnavailableError("offline"),
            skill_set(tmp_path, registry_revision="revision-2"),
        ]
    )
    provider = SkillRegistryContextProvider(client(skills), CONTAINER_ID, clock=clock)

    with pytest.raises(Exception) as first:
        await provider.load()
    clock.seconds = 29.999
    with pytest.raises(Exception) as throttled:
        await provider.load()
    assert throttled.value is first.value
    assert len(skills.get_calls) == 1

    clock.seconds = 30
    assert (await provider.load()).registry_revision == "revision-2"


@pytest.mark.asyncio
async def test_joined_callers_share_telemetry_sink_failure(tmp_path) -> None:
    from copilotkit_intelligence_agent_framework import SkillRegistryContextProvider

    sink_error = RuntimeError("sink failed")

    def telemetry(name: str, metadata: dict[str, object]) -> None:
        del metadata
        if name == "status.changed":
            raise sink_error

    pending = asyncio.get_running_loop().create_future()
    skills = FakeSkillsClient()
    skills.get_outcomes.append(pending)
    provider = SkillRegistryContextProvider(
        client(skills), CONTAINER_ID, telemetry=telemetry
    )
    first = asyncio.create_task(provider.load())
    while not skills.get_calls:
        await asyncio.sleep(0)
    second = asyncio.create_task(provider.load())
    await asyncio.sleep(0)
    pending.set_result(skill_set(tmp_path))
    results = await asyncio.gather(first, second, return_exceptions=True)

    assert results[0] is results[1]
    assert results[0].code == "LEARNING_TELEMETRY_SINK_FAILED"
    assert results[0].__cause__ is sink_error


@pytest.mark.asyncio
async def test_future_load_after_close_rejects() -> None:
    from copilotkit_intelligence_agent_framework import SkillRegistryContextProvider

    skills = FakeSkillsClient()
    provider = SkillRegistryContextProvider(client(skills), CONTAINER_ID)
    await provider.aclose()

    for operation in (provider.load, provider.preload, provider.preload_cached):
        with pytest.raises(Exception) as closed:
            await operation()
        assert closed.value.code == "LEARNING_REGISTRY_CLOSED"
    assert skills.get_calls == []


@pytest.mark.asyncio
async def test_cancelled_native_hook_does_not_cancel_shared_registry_load(
    tmp_path,
) -> None:
    from copilotkit_intelligence_agent_framework import SkillRegistryContextProvider

    pending = asyncio.get_running_loop().create_future()
    skills = FakeSkillsClient()
    skills.get_outcomes.append(pending)
    provider = SkillRegistryContextProvider(client(skills), CONTAINER_ID)
    context = _context()
    invocation = asyncio.create_task(
        provider.before_run(
            agent=object(), session=AgentSession(), context=context, state={}
        )
    )
    while not skills.get_calls:
        await asyncio.sleep(0)

    invocation.cancel()
    with pytest.raises(asyncio.CancelledError):
        await invocation
    pending.set_result(skill_set(tmp_path))

    snapshot = await provider.load()
    assert snapshot.status == "ready"
    assert context.instructions == ["existing"]
    assert skills.get_calls == [CONTAINER_ID]


@pytest.mark.asyncio
async def test_telemetry_callback_reentrant_load_rejects_without_deadlock(
    tmp_path,
) -> None:
    from copilotkit_intelligence_agent_framework import SkillRegistryContextProvider

    skills = FakeSkillsClient()
    skills.get_outcomes.append(skill_set(tmp_path))
    provider = None
    reentrant = None

    async def telemetry(name: str, metadata: dict[str, object]) -> None:
        nonlocal reentrant
        del metadata
        if name == "load.started" and reentrant is None:
            assert provider is not None
            reentrant = asyncio.create_task(provider.load())
            await reentrant

    provider = SkillRegistryContextProvider(
        client(skills), CONTAINER_ID, telemetry=telemetry
    )
    with pytest.raises(Exception) as outer:
        await asyncio.wait_for(provider.load(), 0.2)

    assert reentrant is not None
    assert reentrant.done()
    assert reentrant.exception().code == "LEARNING_REGISTRY_REENTRANT_LOAD"
    assert outer.value.code == "LEARNING_TELEMETRY_SINK_FAILED"
    assert outer.value.__cause__ is reentrant.exception()
    assert skills.get_calls == []


@pytest.mark.asyncio
async def test_telemetry_callback_reentrant_close_rejects_without_deadlock() -> None:
    from copilotkit_intelligence_agent_framework import SkillRegistryContextProvider

    provider = None
    reentrant = None

    async def telemetry(name: str, metadata: dict[str, object]) -> None:
        nonlocal reentrant
        if name == "status.changed" and metadata["status"] == "closed":
            assert provider is not None
            reentrant = asyncio.create_task(provider.aclose())
            await reentrant

    provider = SkillRegistryContextProvider(
        client(FakeSkillsClient()), CONTAINER_ID, telemetry=telemetry
    )
    with pytest.raises(Exception) as outer:
        await asyncio.wait_for(provider.aclose(), 0.2)

    assert reentrant is not None
    assert reentrant.exception().code == "LEARNING_REGISTRY_REENTRANT_CLOSE"
    assert outer.value.code == "LEARNING_TELEMETRY_SINK_FAILED"
    assert outer.value.__cause__ is reentrant.exception()
    assert provider.status == "closed"
