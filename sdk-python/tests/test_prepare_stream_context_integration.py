"""Integration test for context/properties injection through prepare_stream.

This is as close to a real end-to-end verification as we can get without a running
LangGraph server. It exercises the actual prepare_stream call path, including:
  - snapshotting copilotkit.context from the original state_input before merge_state
  - injecting context back after merge_state
  - injecting properties from CopilotKitContext after merge_state
  - verifying the state returned for streaming contains both fields

The graph is mocked at the LangGraph boundary and get_schema_keys is patched to
return (None, None, None) — the same thing a real graph returns when it has no
explicit input/output schema declared.
"""

import asyncio
from contextlib import contextmanager
from unittest.mock import MagicMock, AsyncMock, patch
from copilotkit.langgraph_agent import LangGraphAgent


def _make_agent_state(graph_values=None):
    """Minimal stand-in for langgraph's StateSnapshot."""
    state = MagicMock()
    state.tasks = []  # no pending interrupts
    state.values = dict(graph_values or {"messages": []})
    return state


def _make_graph():
    """Minimal mock of a CompiledStateGraph."""
    graph = MagicMock()
    graph.config = None
    graph.aget_state = AsyncMock()
    graph.aupdate_state = AsyncMock()

    async def _empty_stream(*args, **kwargs):
        return
        yield  # make it an async generator  # noqa: unreachable

    graph.astream_events = _empty_stream
    return graph


@contextmanager
def _no_schema(agent):
    """Patch get_schema_keys to behave like a graph with no declared schema."""
    with patch.object(agent, "get_schema_keys", return_value=(None, None, None)):
        yield


def _run(coro):
    """Run a coroutine synchronously and leave a fresh event loop for subsequent tests.

    asyncio.run() closes the loop when done, which breaks test files that use the
    deprecated asyncio.get_event_loop().run_until_complete() pattern. We restore
    a fresh loop so ordering does not matter.
    """
    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)
    try:
        return loop.run_until_complete(coro)
    finally:
        loop.close()
        asyncio.set_event_loop(asyncio.new_event_loop())


def _run_prepare_stream(agent, *, state_input, agent_state, context=None, actions=None, thread_id="test-thread"):
    """Helper: call prepare_stream synchronously and return the result dict."""
    config = {"configurable": {"thread_id": thread_id}}
    with _no_schema(agent):
        return _run(agent.prepare_stream(
            state_input=state_input,
            agent_state=agent_state,
            config=config,
            messages=[],
            thread_id=thread_id,
            actions=actions or [],
            context=context,
        ))


class TestPrepareStreamContextInjection:
    """prepare_stream must inject copilotkit.context and copilotkit.properties
    from CopilotKitContext into the state used for streaming."""

    def test_useCopilotReadable_context_reaches_stream_state(self):
        """Items registered with useCopilotReadable arrive in state.copilotkit.context."""
        context_items = [
            {"value": "User: Alice, premium plan"},
            {"value": "Locale: en-US"},
        ]
        agent_state = _make_agent_state()
        agent = LangGraphAgent(name="test", graph=_make_graph())

        state_input = {
            "messages": [],
            "copilotkit": {"context": context_items, "actions": []},
        }
        copilotkit_context = {"properties": {}, "frontend_url": None, "headers": {}}

        result = _run_prepare_stream(agent, state_input=state_input, agent_state=agent_state, context=copilotkit_context)

        assert result["state"]["copilotkit"]["context"] == context_items

    def test_copilotkit_properties_reach_stream_state(self):
        """Values from <CopilotKit properties={...} /> arrive in state.copilotkit.properties."""
        properties = {"appVersion": "3.0", "featureFlags": {"darkMode": True}}
        agent_state = _make_agent_state()
        agent = LangGraphAgent(name="test", graph=_make_graph())

        state_input = {"messages": [], "copilotkit": {"context": [], "actions": []}}
        copilotkit_context = {"properties": properties, "frontend_url": "http://localhost:3000", "headers": {}}

        result = _run_prepare_stream(agent, state_input=state_input, agent_state=agent_state, context=copilotkit_context)

        assert result["state"]["copilotkit"]["properties"] == properties

    def test_both_fields_injected_simultaneously(self):
        """Both context and properties are present in the same run."""
        context_items = [{"value": "User is on mobile"}]
        properties = {"plan": "enterprise", "region": "eu-west"}
        agent_state = _make_agent_state()
        agent = LangGraphAgent(name="test", graph=_make_graph())

        state_input = {"messages": [], "copilotkit": {"context": context_items, "actions": []}}
        copilotkit_context = {"properties": properties, "frontend_url": None, "headers": {}}

        result = _run_prepare_stream(agent, state_input=state_input, agent_state=agent_state, context=copilotkit_context)

        ck = result["state"]["copilotkit"]
        assert ck["context"] == context_items
        assert ck["properties"] == properties

    def test_context_survives_fresh_actions_list(self):
        """The whole point of the fix: merge_state used to wipe context when
        rebuilding copilotkit. Verify the injected context survives even when
        a fresh actions list triggers a copilotkit dict rebuild."""
        context_items = [{"value": "Critical context that must survive"}]
        agent_state = _make_agent_state()
        agent = LangGraphAgent(name="test", graph=_make_graph())

        state_input = {"messages": [], "copilotkit": {"context": context_items, "actions": []}}

        result = _run_prepare_stream(
            agent,
            state_input=state_input,
            agent_state=agent_state,
            context=None,
            actions=[],  # fresh actions list triggers copilotkit rebuild in merge_state
        )

        assert result["state"]["copilotkit"]["context"] == context_items

    def test_no_context_no_error(self):
        """Passing context=None is safe: properties defaults to empty dict."""
        agent_state = _make_agent_state()
        agent = LangGraphAgent(name="test", graph=_make_graph())

        state_input = {"messages": [], "copilotkit": {"context": [], "actions": []}}

        result = _run_prepare_stream(agent, state_input=state_input, agent_state=agent_state, context=None)

        assert result["state"]["copilotkit"]["properties"] == {}
        assert result["state"]["copilotkit"]["context"] == []
