import asyncio
import base64
import gc
import json
from pathlib import Path
from unittest.mock import AsyncMock

import pytest
from copilotkit_intelligence import Intelligence, LearnedSkillsError
from google.adk.agents import LlmAgent, ParallelAgent
from google.adk.models.base_llm import BaseLlm
from google.adk.models.llm_response import LlmResponse
from google.adk.runners import Runner
from google.adk.sessions import InMemorySessionService
from google.genai import types
from pydantic import PrivateAttr

from copilotkit_intelligence_adk import SkillRegistry, SkillToolset

FIXTURES = json.loads(
    (
        Path(__file__).parents[2]
        / "intelligence-delivery-python-core/conformance/snapshots.v1.json"
    ).read_text()
)


def response(name="text-skill"):
    item = next(item for item in FIXTURES["cases"] if item["name"] == name)
    return {
        "status": "snapshot",
        "bytes": base64.b64decode(item["archiveBase64"]),
        "revision": item["revision"],
        "etag": item["etag"],
        "contentType": "application/zip",
    }


class Fake(BaseLlm):
    _seen: list = PrivateAttr(default_factory=list)
    _after_model: object = PrivateAttr(default=None)
    _file: str = PrivateAttr(default="reference.txt")

    async def generate_content_async(self, llm_request, stream=False):
        self._seen.append((str(llm_request.config.system_instruction), list(llm_request.contents)))
        if self._after_model:
            self._after_model()
        if any(part.function_response for part in llm_request.contents[-1].parts or []):
            yield LlmResponse(content=types.Content(role="model", parts=[types.Part(text="done")]))
        else:
            yield LlmResponse(
                content=types.Content(
                    role="model",
                    parts=[
                        types.Part(
                            function_call=types.FunctionCall(
                                name="copilotkit_load_skill", args={"skill_name": "refund-policy"}
                            )
                        ),
                        types.Part(
                            function_call=types.FunctionCall(
                                name="copilotkit_read_skill_file",
                                args={"skill_name": "refund-policy", "path": self._file},
                            )
                        ),
                    ],
                )
            )


def setup(**options):
    client = AsyncMock(spec=Intelligence)
    client.get_learned_skills_snapshot.return_value = response()
    registry = SkillRegistry(client=client, container_id="c", freshness_window=0, **options)
    return registry, client.get_learned_skills_snapshot


async def make_runner(registry, model=None, parallel=False):
    service = InMemorySessionService()
    await service.create_session(app_name="skills", user_id="u", session_id="s")
    toolset = SkillToolset(registry)
    model = model or Fake(model="fake")
    if parallel:
        agent = ParallelAgent(
            name="root",
            sub_agents=[
                LlmAgent(name=name, model=model, tools=[toolset]) for name in ("one", "two")
            ],
        )
    else:
        agent = LlmAgent(
            name="agent",
            model=model,
            instruction="Host instructions outrank skills.",
            tools=[toolset],
        )
    return Runner(agent=agent, app_name="skills", session_service=service), service, model, toolset


async def run(runner):
    return [
        event
        async for event in runner.run_async(
            user_id="u",
            session_id="s",
            new_message=types.Content(role="user", parts=[types.Part(text="help")]),
        )
    ]


async def test_native_model_tool_loop_pins_then_next_run_refreshes():
    registry, fetch = setup()
    runner, service, model, _ = await make_runner(registry)
    model._after_model = lambda: setattr(fetch, "return_value", response("empty-r2"))
    first = await run(runner)
    assert fetch.await_count == 1
    assert any("# Refund policy" in event.model_dump_json() for event in first)
    assert any("30 days" in event.model_dump_json() for event in first)
    assert "Host instructions outrank skills." in model._seen[0][0]
    assert "Use when handling refunds." in model._seen[0][0]
    assert "# Refund policy" not in model._seen[0][0]
    assert all("refund-policy" in instruction for instruction, _ in model._seen)
    second = await run(runner)
    assert fetch.await_count == 2 and registry.status.revision == "r2"
    assert any('"error"' in event.model_dump_json() for event in second)
    for event in first + second:
        assert "temp:copilotkit" not in event.model_dump_json()
    stored = await service.get_session(app_name="skills", user_id="u", session_id="s")
    assert not any(key.startswith("temp:copilotkit") for key in stored.state)
    assert "VerifiedSnapshot" not in stored.model_dump_json()
    del first, second, stored
    gc.collect()
    assert not registry._pins
    await runner.close()
    await registry.aclose()


async def test_parallel_subagents_share_pin_after_await_and_release_gc():
    registry, fetch = setup()
    runner, _, model, _ = await make_runner(registry, parallel=True)

    async def get(**kwargs):
        await asyncio.sleep(0.01)
        return response()

    fetch.side_effect = get
    events = await run(runner)
    assert fetch.await_count == 1
    assert all("refund-policy" in instruction for instruction, _ in model._seen)
    assert len([event for event in events if event.get_function_responses()]) == 2
    del events
    gc.collect()
    assert not registry._pins
    await runner.close()


async def test_get_tools_stable_empty_but_model_hook_initialization_errors_propagate():
    registry, fetch = setup()
    runner, _, model, toolset = await make_runner(registry)
    names = {tool.name for tool in await toolset.get_tools()}
    assert names == {"copilotkit_load_skill", "copilotkit_read_skill_file"}
    fetch.side_effect = LearnedSkillsError("AUTHORIZATION_FAILED", False)
    with pytest.raises(LearnedSkillsError) as error:
        await run(runner)
    assert error.value.code == "AUTHORIZATION_FAILED"
    assert not model._seen
    fetch.side_effect = None
    fetch.return_value = response("empty")
    await run(runner)
    assert {tool.name for tool in await toolset.get_tools()} == names
    await runner.close()


async def test_warm_stale_then_denial_blocks_new_run():
    registry, fetch = setup()
    runner, _, model, _ = await make_runner(registry)
    await run(runner)
    fetch.side_effect = LearnedSkillsError("NETWORK_ERROR", True)
    await run(runner)
    assert registry.status.stale
    seen = len(model._seen)
    fetch.side_effect = LearnedSkillsError("REVISION_REVOKED", False)
    with pytest.raises(LearnedSkillsError) as error:
        await run(runner)
    assert error.value.code == "REVISION_REVOKED"
    assert len(model._seen) == seen
    await runner.close()


@pytest.mark.parametrize("path", ["../SKILL.md", "SKILL.md", "/etc/passwd", "missing.txt"])
async def test_tool_paths_stay_inside_supporting_text_membership(path):
    registry, _ = setup()
    model = Fake(model="fake")
    model._file = path
    runner, _, _, _ = await make_runner(registry, model)
    events = await run(runner)
    replies = [reply for event in events for reply in event.get_function_responses()]
    read = next(reply for reply in replies if reply.name == "copilotkit_read_skill_file")
    assert "error" in read.response
    await runner.close()


async def test_startup_failure_retry_and_injected_close_ownership():
    registry, fetch = setup()
    fetch.side_effect = LearnedSkillsError("NETWORK_ERROR", True)
    with pytest.raises(LearnedSkillsError):
        await registry.initialize()
    fetch.side_effect = None
    await registry.initialize()
    await SkillToolset(registry).close()
    assert registry.status.initialized
    await registry.aclose()


async def test_cancelled_invocation_does_not_cancel_shared_refresh_and_releases_pins():
    registry, fetch = setup()
    entered, release = asyncio.Event(), asyncio.Event()

    async def get(**kwargs):
        entered.set()
        await release.wait()
        return response()

    fetch.side_effect = get
    first, _, _, _ = await make_runner(registry)
    second, _, _, _ = await make_runner(registry)
    one = asyncio.create_task(run(first))
    two = asyncio.create_task(run(second))
    await entered.wait()
    one.cancel()
    with pytest.raises(asyncio.CancelledError):
        await one
    release.set()
    assert await two
    assert fetch.await_count == 1
    del one, two
    gc.collect()
    assert not registry._pins
    await first.close()
    await second.close()


async def test_copied_state_and_invocation_id_cannot_select_another_session_pin():
    from google.adk.agents.invocation_context import InvocationContext
    from google.adk.agents.readonly_context import ReadonlyContext

    registry, fetch = setup()
    service = InMemorySessionService()
    session = await service.create_session(app_name="skills", user_id="u", session_id="one")
    agent = LlmAgent(name="agent", model=Fake(model="fake"))
    original = ReadonlyContext(
        InvocationContext(
            session_service=service, invocation_id="same-id", agent=agent, session=session
        )
    )
    await registry._pin(original)
    copied = session.model_copy(deep=True)
    copied.state.update(
        {"temp:copilotkit_skills": str(next(iter(registry._pins))), "invocation_id": "same-id"}
    )
    other = ReadonlyContext(
        InvocationContext(
            session_service=service, invocation_id="same-id", agent=agent, session=copied
        )
    )
    fetch.side_effect = LearnedSkillsError("REVISION_REVOKED", False)
    with pytest.raises(LearnedSkillsError) as error:
        await registry._pin(other)
    assert error.value.code == "REVISION_REVOKED"
    assert fetch.await_count == 2


async def test_same_session_new_invocation_cannot_reuse_prior_pin():
    from google.adk.agents.invocation_context import InvocationContext
    from google.adk.agents.readonly_context import ReadonlyContext

    registry, fetch = setup()
    service = InMemorySessionService()
    session = await service.create_session(app_name="skills", user_id="u", session_id="one")
    agent = LlmAgent(name="agent", model=Fake(model="fake"))
    first = ReadonlyContext(
        InvocationContext(
            session_service=service, invocation_id="one", agent=agent, session=session
        )
    )
    second = ReadonlyContext(
        InvocationContext(
            session_service=service, invocation_id="two", agent=agent, session=session
        )
    )
    await registry._pin(first)
    fetch.side_effect = LearnedSkillsError("REVISION_REVOKED", False)
    with pytest.raises(LearnedSkillsError):
        await registry._pin(second)
    assert fetch.await_count == 2


async def test_native_resume_reauthorizes_despite_supplied_state_delta():
    from google.adk.apps import App, ResumabilityConfig

    registry, fetch = setup()
    service = InMemorySessionService()
    await service.create_session(app_name="skills", user_id="u", session_id="resume")
    agent = LlmAgent(name="agent", model=Fake(model="fake"), tools=[SkillToolset(registry)])
    runner = Runner(
        app=App(
            name="skills",
            root_agent=agent,
            resumability_config=ResumabilityConfig(is_resumable=True),
        ),
        session_service=service,
    )
    stream = runner.run_async(
        user_id="u",
        session_id="resume",
        new_message=types.Content(role="user", parts=[types.Part(text="help")]),
    )
    try:
        async for event in stream:
            if event.get_function_calls():
                invocation = event.invocation_id
                break
        fetch.side_effect = LearnedSkillsError("REVISION_REVOKED", False)
        with pytest.raises(LearnedSkillsError) as error:
            async for _ in runner.run_async(
                user_id="u",
                session_id="resume",
                invocation_id=invocation,
                state_delta={"temp:copilotkit_skills": "foreign", "invocation_id": invocation},
            ):
                pass
        assert error.value.code == "REVISION_REVOKED"
        assert fetch.await_count == 2
    finally:
        await stream.aclose()
        await runner.close()


async def test_binary_supporting_file_returns_native_error():
    registry, fetch = setup()
    fetch.return_value = response("binary-resource")
    model = Fake(model="fake")
    model._file = "resource.bin"
    runner, _, _, _ = await make_runner(registry, model)
    events = await run(runner)
    read = next(
        reply
        for event in events
        for reply in event.get_function_responses()
        if reply.name == "copilotkit_read_skill_file"
    )
    assert "error" in read.response
    await runner.close()


async def test_denial_does_not_retain_session_through_cached_exception_traceback():
    import weakref

    from google.adk.agents.invocation_context import InvocationContext
    from google.adk.agents.readonly_context import ReadonlyContext

    registry, fetch = setup()
    fetch.side_effect = lambda **kwargs: (_ for _ in ()).throw(
        LearnedSkillsError("REVISION_REVOKED", False)
    )

    async def invoke():
        service = InMemorySessionService()
        session = await service.create_session(
            app_name="skills", user_id="u", session_id="gc-denial"
        )
        context = ReadonlyContext(
            InvocationContext(
                session_service=service,
                invocation_id="denied",
                agent=LlmAgent(name="agent", model=Fake(model="fake")),
                session=session,
            )
        )
        with pytest.raises(LearnedSkillsError):
            await registry._pin(context)
        return weakref.ref(session)

    reference = await invoke()
    # Release completed shield-future callbacks before asking GC about ownership.
    await asyncio.sleep(0)
    gc.collect()
    assert reference() is None
    assert not registry._pins


async def test_helper_owned_client_closes_but_injected_pool_remains_open(monkeypatch):
    import httpx

    monkeypatch.setenv("CPK_INTELLIGENCE_API_KEY", "key")
    monkeypatch.setenv("CPK_INTELLIGENCE_LEARNING_CONTAINER_ID", "c")
    helper = SkillRegistry()
    owned = helper._registry._config.client.http_client
    await helper.aclose()
    assert owned.is_closed
    async with httpx.AsyncClient() as borrowed:
        sdk = Intelligence(api_key="key", http_client=borrowed)
        registry = SkillRegistry(client=sdk)
        await registry.aclose()
        assert not borrowed.is_closed
        await sdk.aclose()


@pytest.mark.parametrize("debug", [False, True])
async def test_adapter_debug_logs_exclude_model_and_skill_content(debug, caplog):
    caplog.set_level("DEBUG", logger="copilotkit_intelligence_adk")
    registry, _ = setup(debug=debug)
    runner, _, _, _ = await make_runner(registry)
    await run(runner)
    records = [
        record for record in caplog.records if record.name.startswith("copilotkit_intelligence_adk")
    ]
    assert bool(records) is debug
    for record in records:
        assert all(
            secret not in record.getMessage()
            for secret in ("# Refund policy", "30 days", "Host instructions", "owned-key")
        )
    await runner.close()
