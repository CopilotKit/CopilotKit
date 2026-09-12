import asyncio
import base64
import json
from pathlib import Path
from unittest.mock import AsyncMock

import pytest
from copilotkit_intelligence import Intelligence, LearnedSkillsError
from langchain.agents import create_agent
from langchain_core.language_models.chat_models import BaseChatModel
from langchain_core.messages import AIMessage, ToolMessage
from langchain_core.outputs import ChatGeneration, ChatResult
from langgraph.checkpoint.memory import InMemorySaver
from pydantic import PrivateAttr

from copilotkit_intelligence_langgraph import create_skill_registry_middleware

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


class FakeModel(BaseChatModel):
    _calls: list = PrivateAttr(default_factory=list)
    _bound: list = PrivateAttr(default_factory=list)
    _on_call: object = PrivateAttr(default=None)
    _tool_calls: list | None = PrivateAttr(default=None)

    @property
    def _llm_type(self):
        return "learned-skills-test"

    def bind_tools(self, tools, **kwargs):
        self._bound = tools
        return self

    def _generate(self, messages, stop=None, run_manager=None, **kwargs):
        self._calls.append(messages)
        if self._on_call:
            self._on_call()
        if any(isinstance(message, ToolMessage) for message in messages):
            message = AIMessage(content="done")
        else:
            message = AIMessage(
                content="",
                tool_calls=self._tool_calls
                or [
                    {
                        "name": "copilotkit_load_skill",
                        "args": {"skill_name": "refund-policy"},
                        "id": "load",
                    },
                    {
                        "name": "copilotkit_read_skill_file",
                        "args": {"skill_name": "refund-policy", "path": "reference.txt"},
                        "id": "read",
                    },
                ],
            )
        return ChatResult(generations=[ChatGeneration(message=message)])


def setup(**options):
    client = AsyncMock(spec=Intelligence)
    client.get_learned_skills_snapshot.return_value = response()
    middleware = create_skill_registry_middleware(
        client=client, container_id="c", freshness_window=0, **options
    )
    return middleware, client.get_learned_skills_snapshot


async def test_native_loop_catalog_tools_pin_and_host_instructions():
    middleware, fetch = setup()
    model = FakeModel()
    model._on_call = lambda: setattr(fetch, "return_value", response("empty-r2"))
    agent = create_agent(model, system_prompt="Developer policy wins.", middleware=[middleware])
    result = await agent.ainvoke({"messages": [{"role": "user", "content": "refund help"}]})
    tools = [item for item in result["messages"] if isinstance(item, ToolMessage)]
    assert any("# Refund policy" in item.content for item in tools)
    assert any("30 days" in item.content for item in tools)
    first_system = model._calls[0][0].content
    assert "Developer policy wins." in first_system
    assert "refund-policy" in first_system and "Use when handling refunds." in first_system
    assert "# Refund policy" not in first_system
    assert "outrank" in first_system
    assert fetch.await_count == 1
    assert {tool.name for tool in model._bound} == {
        "copilotkit_load_skill",
        "copilotkit_read_skill_file",
    }
    assert middleware.status.revision == "r1"


async def test_tool_first_resume_captures_fresh_pin_without_checkpointing_snapshot():
    middleware, fetch = setup()
    saver = InMemorySaver()
    model = FakeModel()
    agent = create_agent(
        model, middleware=[middleware], checkpointer=saver, interrupt_before=["tools"]
    )
    config = {"configurable": {"thread_id": "resume"}}
    await agent.ainvoke({"messages": [{"role": "user", "content": "help"}]}, config)
    before = repr(saver.storage) + repr(saver.writes)
    assert "# Refund policy" not in before and "SnapshotFile" not in before
    fetch.return_value = response("empty-r2")
    result = await agent.ainvoke(None, config)
    tools = [message for message in result["messages"] if isinstance(message, ToolMessage)]
    assert len(tools) == 2 and all(message.status == "error" for message in tools)
    assert fetch.await_count == 2
    assert middleware.status.revision == "r2"
    assert not any("pin" in key.lower() for key in result)


async def test_empty_snapshot_still_registers_both_tools_and_returns_native_errors():
    middleware, fetch = setup()
    fetch.return_value = response("empty")
    model = FakeModel()
    result = await create_agent(model, middleware=[middleware]).ainvoke(
        {"messages": [{"role": "user", "content": "help"}]}
    )
    assert len(model._bound) == 2
    assert all(
        message.status == "error"
        for message in result["messages"]
        if isinstance(message, ToolMessage)
    )


async def test_concurrent_agents_share_initialization_and_caller_cancellation():
    middleware, fetch = setup()
    entered, release = asyncio.Event(), asyncio.Event()

    async def get(**kwargs):
        entered.set()
        await release.wait()
        return response()

    fetch.side_effect = get
    one = create_agent(FakeModel(), middleware=[middleware])
    two = create_agent(FakeModel(), middleware=[middleware])
    first = asyncio.create_task(one.ainvoke({"messages": [{"role": "user", "content": "one"}]}))
    second = asyncio.create_task(two.ainvoke({"messages": [{"role": "user", "content": "two"}]}))
    await entered.wait()
    first.cancel()
    with pytest.raises(asyncio.CancelledError):
        await first
    release.set()
    assert (await second)["messages"][-1].content == "done"
    assert fetch.await_count == 1


async def test_initialization_failure_is_catchable_and_retryable():
    middleware, fetch = setup()
    fetch.side_effect = LearnedSkillsError("NETWORK_ERROR", True)
    with pytest.raises(LearnedSkillsError):
        await middleware.initialize()
    fetch.side_effect = None
    await middleware.initialize()
    assert middleware.status.initialized
    await middleware.aclose()


def test_sync_agent_invocation_fails_with_typed_async_guidance():
    middleware, fetch = setup()
    agent = create_agent(FakeModel(), middleware=[middleware])
    with pytest.raises(LearnedSkillsError) as error:
        agent.invoke({"messages": [{"role": "user", "content": "help"}]})
    assert error.value.code == "INVALID_CONFIG"
    assert "async" in str(error.value).lower() or any(
        "async" in note.lower() for note in getattr(error.value, "__notes__", [])
    )
    fetch.assert_not_called()


@pytest.mark.parametrize("path", ["../SKILL.md", "SKILL.md", "/etc/passwd", "missing.txt"])
async def test_tool_lookup_cannot_escape_supporting_manifest_membership(path):
    middleware, _ = setup()
    model = FakeModel()
    model._tool_calls = [
        {
            "name": "copilotkit_read_skill_file",
            "args": {"skill_name": "refund-policy", "path": path},
            "id": "bad",
        }
    ]
    result = await create_agent(model, middleware=[middleware]).ainvoke(
        {"messages": [{"role": "user", "content": "help"}]}
    )
    message = next(message for message in result["messages"] if isinstance(message, ToolMessage))
    assert message.status == "error"
    assert "# Refund policy" not in message.content


async def test_real_canonical_client_is_the_only_authenticated_transport(monkeypatch):
    import httpx

    initial = response()
    requests = []

    def platform(request):
        requests.append(request)
        return httpx.Response(
            200,
            content=initial["bytes"],
            headers={
                "content-type": "application/zip",
                "x-copilotkit-skills-revision": initial["revision"],
                "etag": initial["etag"],
            },
        )

    async with httpx.AsyncClient(transport=httpx.MockTransport(platform)) as http:
        sdk = Intelligence(api_key="owned-key", api_url="https://self.test", http_client=http)
        monkeypatch.setattr(
            httpx, "AsyncClient", lambda *args, **kwargs: pytest.fail("second HTTP pool")
        )
        middleware = create_skill_registry_middleware(client=sdk, container_id="container")
        await create_agent(FakeModel(), middleware=[middleware]).ainvoke(
            {"messages": [{"role": "user", "content": "help"}]}
        )
        await middleware.aclose()
        assert not http.is_closed
        await sdk.aclose()
    assert len(requests) == 1
    assert requests[0].url.path == "/api/v1/learning/containers/container/skills"
    assert requests[0].headers["authorization"] == "Bearer owned-key"


async def test_public_values_and_events_streams_never_expose_snapshot_objects():
    from pydantic import TypeAdapter

    middleware, _ = setup()
    agent = create_agent(FakeModel(), middleware=[middleware])
    serializer = TypeAdapter(object)
    async for value in agent.astream(
        {"messages": [{"role": "user", "content": "help"}]}, stream_mode="values"
    ):
        encoded = serializer.dump_json(value)
        assert b"SnapshotFile" not in encoded and b"sha256" not in encoded
        if "_copilotkit_skill_pin" in value:
            assert isinstance(value["_copilotkit_skill_pin"], str)
    async for event in agent.astream_events(
        {"messages": [{"role": "user", "content": "help"}]}, version="v2"
    ):
        serializer.dump_json(event)


async def test_channel_owners_release_holders_after_stream_and_resume():
    import gc

    from copilotkit_intelligence_langgraph import middleware as module

    before = set(module._holders)
    middleware, fetch = setup()
    saver = InMemorySaver()
    agent = create_agent(
        FakeModel(), middleware=[middleware], checkpointer=saver, interrupt_before=["tools"]
    )
    config = {"configurable": {"thread_id": "weak-pins"}}
    async for value in agent.astream(
        {"messages": [{"role": "user", "content": "help"}]}, config, stream_mode="values"
    ):
        pass
    fetch.return_value = response("empty-r2")
    await agent.ainvoke(None, config)
    del value, agent, saver
    gc.collect()
    assert set(module._holders) <= before


async def test_real_registry_refresh_mid_invocation_does_not_change_pin():
    middleware, fetch = setup()

    class RefreshingModel(FakeModel):
        async def _agenerate(self, messages, stop=None, run_manager=None, **kwargs):
            result = self._generate(messages, stop=stop, **kwargs)
            if len(self._calls) == 1:
                fetch.return_value = response("empty-r2")
                await middleware.initialize()
                assert middleware.status.revision == "r2"
            return result

    model = RefreshingModel()
    result = await create_agent(model, middleware=[middleware]).ainvoke(
        {"messages": [{"role": "user", "content": "help"}]}
    )
    assert fetch.await_count == 2
    assert any(
        "# Refund policy" in message.content
        for message in result["messages"]
        if isinstance(message, ToolMessage)
    )
    assert all("refund-policy" in call[0].content for call in model._calls)
    assert middleware.status.revision == "r2"


async def test_system_message_blocks_and_metadata_are_preserved():
    from langchain_core.messages import SystemMessage

    middleware, _ = setup()
    original = SystemMessage(
        content=[{"type": "text", "text": "Host block wins."}],
        additional_kwargs={"host": "metadata"},
        name="developer",
    )
    unchanged = original.model_dump()
    model = FakeModel()
    await create_agent(model, system_prompt=original, middleware=[middleware]).ainvoke(
        {"messages": [{"role": "user", "content": "help"}]}
    )
    sent = model._calls[0][0]
    assert sent.content[0] == original.content[0]
    assert sent.additional_kwargs == original.additional_kwargs
    assert sent.name == original.name
    assert "refund-policy" in sent.content[-1]["text"]
    assert original.model_dump() == unchanged


async def test_foreign_stream_token_cannot_bypass_resume_reauthorization():
    from langgraph.types import Command

    from copilotkit_intelligence_langgraph import middleware as module

    middleware, fetch = setup()
    first = create_agent(FakeModel(), middleware=[middleware])
    stream = first.astream(
        {"messages": [{"role": "user", "content": "first"}]}, stream_mode="values"
    )
    try:
        async for value in stream:
            token = value.get("_copilotkit_skill_pin")
            if token and module._holders[token].snapshot is not None:
                break
        second = create_agent(
            FakeModel(),
            middleware=[middleware],
            checkpointer=InMemorySaver(),
            interrupt_before=["tools"],
        )
        config = {"configurable": {"thread_id": "spoof"}}
        await second.ainvoke({"messages": [{"role": "user", "content": "second"}]}, config)
        previous = fetch.await_count
        fetch.side_effect = LearnedSkillsError("REVISION_REVOKED", False)
        with pytest.raises(LearnedSkillsError) as error:
            await second.ainvoke(Command(update={"_copilotkit_skill_pin": token}), config)
        assert error.value.code == "REVISION_REVOKED"
        assert fetch.await_count == previous + 1
    finally:
        await stream.aclose()


async def test_holder_cannot_resolve_against_another_registry():
    from copilotkit_intelligence_langgraph.middleware import _PinHolder

    first, _ = setup()
    second, fetch = setup()
    holder = _PinHolder()
    await holder.resolve(first._registry)
    with pytest.raises(LearnedSkillsError) as error:
        await holder.resolve(second._registry)
    assert error.value.code == "INVALID_CONFIG"
    fetch.assert_not_called()
