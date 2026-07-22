from __future__ import annotations

import asyncio
import threading

import pytest
from copilotkit import IntelligenceAccessDeniedError, IntelligenceUnavailableError
from langchain.agents.middleware import AgentMiddleware, ModelRequest
from langchain_core.language_models.fake_chat_models import FakeListChatModel
from langchain_core.messages import AIMessage, SystemMessage

from conftest import CONTAINER_ID, FakeSkillsClient, client, skill_set


def model_request() -> ModelRequest:
    return ModelRequest(
        model=FakeListChatModel(responses=["ok"]),
        messages=[],
        system_message=SystemMessage(
            content="base",
            additional_kwargs={"preserved": True},
            name="system-name",
        ),
        tools=[],
        state={"messages": [], "custom": "state"},
        runtime=None,
        model_settings={"temperature": 0},
    )


@pytest.mark.asyncio
async def test_native_middleware_loads_before_model(tmp_path) -> None:
    from copilotkit_intelligence_langgraph import createSkillRegistryMiddleware

    pending = asyncio.get_running_loop().create_future()
    skills = FakeSkillsClient()
    skills.get_outcomes.append(pending)
    middleware = createSkillRegistryMiddleware(client(skills), CONTAINER_ID)
    assert isinstance(middleware, AgentMiddleware)
    request = model_request()
    forwarded: ModelRequest | None = None

    async def handler(candidate: ModelRequest) -> AIMessage:
        nonlocal forwarded
        forwarded = candidate
        return AIMessage("done")

    call = asyncio.create_task(middleware.awrap_model_call(request, handler))
    for _ in range(10):
        await asyncio.sleep(0)
        if skills.get_calls:
            break
    assert skills.get_calls == [CONTAINER_ID]
    assert forwarded is None

    pending.set_result(skill_set(tmp_path, texts=("# First\n", "# Second\n")))
    assert await call == AIMessage("done")
    assert forwarded is not None
    assert forwarded is not request
    assert request.system_message is not None
    assert request.system_message.text == "base"
    assert forwarded.messages is request.messages
    assert forwarded.tools is request.tools
    assert forwarded.state is request.state
    assert forwarded.runtime is request.runtime
    assert forwarded.model_settings is request.model_settings
    assert forwarded.system_message is not None
    assert forwarded.system_message.additional_kwargs == {"preserved": True}
    assert forwarded.system_message.name == "system-name"
    assert forwarded.system_message.text.startswith(
        "base\n\nCopilotKit Intelligence Registry skills (verified, ordered):"
    )
    assert forwarded.system_message.text.index(
        "# First"
    ) < forwarded.system_message.text.index("# Second")


@pytest.mark.asyncio
async def test_joined_callers_share_telemetry_sink_failure(tmp_path) -> None:
    from copilotkit_intelligence_langgraph import createSkillRegistryMiddleware

    sink_error = RuntimeError("sink failed")
    pending = asyncio.get_running_loop().create_future()
    skills = FakeSkillsClient()
    skills.get_outcomes.append(pending)

    def telemetry(name: str, metadata: dict[str, object]) -> None:
        del metadata
        if name == "status.changed":
            raise sink_error

    middleware = createSkillRegistryMiddleware(
        client(skills), CONTAINER_ID, telemetry=telemetry
    )
    callers = [asyncio.create_task(middleware.load()) for _ in range(2)]
    for _ in range(10):
        await asyncio.sleep(0)
        if skills.get_calls:
            break
    pending.set_result(skill_set(tmp_path))
    results = await asyncio.gather(*callers, return_exceptions=True)

    assert results[0] is results[1]
    assert results[0].code == "LEARNING_TELEMETRY_SINK_FAILED"
    assert results[0].__cause__ is sink_error
    assert skills.get_calls == [CONTAINER_ID]


def test_sync_hook_uses_the_same_native_request_copy_contract(tmp_path) -> None:
    from copilotkit_intelligence_langgraph import createSkillRegistryMiddleware

    installed = skill_set(tmp_path)

    class SyncSkills:
        def get(self, learning_container_id: str):
            assert learning_container_id == CONTAINER_ID
            return installed

        def get_cached(self, learning_container_id: str):
            raise AssertionError(learning_container_id)

    generic = type("Client", (), {"skills": SyncSkills()})()
    middleware = createSkillRegistryMiddleware(generic, CONTAINER_ID)
    request = model_request()
    forwarded: ModelRequest | None = None

    def handler(candidate: ModelRequest) -> AIMessage:
        nonlocal forwarded
        forwarded = candidate
        return AIMessage("done")

    assert middleware.wrap_model_call(request, handler) == AIMessage("done")
    assert forwarded is not None
    assert forwarded is not request
    assert request.system_message is not None
    assert request.system_message.text == "base"


@pytest.mark.asyncio
async def test_async_hook_offloads_a_synchronous_generic_client(tmp_path) -> None:
    from copilotkit_intelligence_langgraph import createSkillRegistryMiddleware

    installed = skill_set(tmp_path)
    started = threading.Event()
    release = threading.Event()

    class BlockingSkills:
        def get(self, learning_container_id: str):
            assert learning_container_id == CONTAINER_ID
            started.set()
            release.wait(2)
            return installed

    generic = type("Client", (), {"skills": BlockingSkills()})()
    middleware = createSkillRegistryMiddleware(generic, CONTAINER_ID)
    handler_called = False

    async def handler(candidate: ModelRequest) -> AIMessage:
        nonlocal handler_called
        handler_called = True
        return AIMessage(candidate.system_message.text)

    call = asyncio.create_task(middleware.awrap_model_call(model_request(), handler))
    try:
        for _ in range(100):
            await asyncio.sleep(0)
            if started.is_set():
                break
        assert started.is_set()
        assert not handler_called
        # This scheduling point completes while the synchronous SDK call is blocked.
        await asyncio.wait_for(asyncio.sleep(0), timeout=0.1)
    finally:
        release.set()
    await call
    assert handler_called


@pytest.mark.asyncio
async def test_native_hook_refuses_stale_snapshot_before_handler(tmp_path) -> None:
    from copilotkit_intelligence_langgraph import createSkillRegistryMiddleware

    skills = FakeSkillsClient()
    skills.get_outcomes.extend(
        [skill_set(tmp_path), IntelligenceUnavailableError("offline")]
    )
    middleware = createSkillRegistryMiddleware(
        client(skills), CONTAINER_ID, refresh_interval=0
    )
    await middleware.preload()
    called = False

    async def handler(candidate: ModelRequest) -> AIMessage:
        nonlocal called
        called = True
        return AIMessage(candidate.system_message.text)

    with pytest.raises(Exception) as stale:
        await middleware.awrap_model_call(model_request(), handler)
    assert stale.value.code == "LEARNING_REGISTRY_STALE"
    assert middleware.status == "stale"
    assert not called


@pytest.mark.asyncio
@pytest.mark.parametrize("failure", ["denied", "script", "oversize"])
async def test_native_hook_refuses_invalid_set_before_handler(
    tmp_path, failure: str
) -> None:
    from copilotkit_intelligence_langgraph import createSkillRegistryMiddleware

    skills = FakeSkillsClient()
    if failure == "denied":
        outcome = IntelligenceAccessDeniedError(
            "denied",
            code="LEARNING_REGISTRY_DENIED",
            category="permission",
        )
    elif failure == "script":
        outcome = skill_set(tmp_path, roles=("script",))
    else:
        outcome = skill_set(tmp_path, texts=("x" * 262145,))
    skills.get_outcomes.append(outcome)
    middleware = createSkillRegistryMiddleware(client(skills), CONTAINER_ID)
    called = False

    async def handler(candidate: ModelRequest) -> AIMessage:
        nonlocal called
        called = True
        return AIMessage(candidate.system_message.text)

    with pytest.raises(Exception):
        await middleware.awrap_model_call(model_request(), handler)
    assert middleware.status == "denied"
    assert not called
