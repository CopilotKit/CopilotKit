"""Production-path regressions for middleware-intercepted SDK Action calls."""

import asyncio
import json
from contextlib import nullcontext
from typing import Any, ClassVar
from unittest.mock import MagicMock, patch

from ag_ui.core import EventType, MessagesSnapshotEvent, Tool, UserMessage
from ag_ui_langgraph import LangGraphAgent as AGUIBase
from ag_ui.core.types import RunAgentInput
from langchain.agents import create_agent
from langchain_core.language_models.chat_models import BaseChatModel
from langchain_core.messages import AIMessage, AIMessageChunk
from langchain_core.outputs import ChatGeneration, ChatGenerationChunk, ChatResult
from langgraph.checkpoint.memory import InMemorySaver
from pydantic import Field

from copilotkit import CopilotKitMiddleware
from copilotkit.langgraph_agui_agent import LangGraphAGUIAgent


class BoundFakeToolModel(BaseChatModel):
    """Small model that proves create_agent selects its streaming path."""

    responses: list[AIMessage]
    i: int = 0
    bound_tools: list[Any] = Field(default_factory=list)
    streaming: bool = False
    generate_calls: ClassVar[int] = 0
    astream_calls: ClassVar[int] = 0

    def bind_tools(self, tools, **kwargs):
        return self.__class__(
            responses=self.responses,
            i=self.i,
            bound_tools=list(tools),
            streaming=self.streaming,
        )

    @property
    def _llm_type(self) -> str:
        return "bound-fake-tool-model"

    def _generate(self, messages, stop=None, run_manager=None, **kwargs):
        type(self).generate_calls += 1
        response = self.responses[self.i]
        if self.i < len(self.responses) - 1:
            self.i += 1
        return ChatResult(generations=[ChatGeneration(message=response)])

    async def _astream(self, messages, stop=None, run_manager=None, **kwargs):
        type(self).astream_calls += 1
        yield ChatGenerationChunk(
            message=AIMessageChunk(
                content="",
                id="ai-1",
                tool_call_chunks=[
                    {"id": "tc-1", "name": "ask_user_name", "args": "", "index": 0}
                ],
            )
        )
        yield ChatGenerationChunk(
            message=AIMessageChunk(
                content="",
                id="ai-1",
                tool_call_chunks=[
                    {"args": '{"prompt": "what is your name?"}', "index": 0}
                ],
            )
        )
        yield ChatGenerationChunk(message=AIMessageChunk(content="", id="ai-1"))


def _frontend_tool(name="ask_user_name") -> Tool:
    return Tool(
        name=name,
        description="Frontend SDK Action",
        parameters={
            "type": "object",
            "properties": {"prompt": {"type": "string"}},
            "required": ["prompt"],
        },
    )


def _collect_intercepted_tool_run(
    *,
    streaming=False,
    tools=None,
    forwarded_props=None,
    config_metadata=None,
    observed_events=None,
):
    BoundFakeToolModel.generate_calls = 0
    BoundFakeToolModel.astream_calls = 0
    model = BoundFakeToolModel(
        responses=[
            AIMessage(
                content="",
                id="ai-1",
                tool_calls=[
                    {
                        "id": "tc-1",
                        "name": "ask_user_name",
                        "args": {"prompt": "what is your name?"},
                    }
                ],
            )
        ],
        streaming=streaming,
    )
    graph = create_agent(
        model=model,
        tools=[],
        middleware=[CopilotKitMiddleware()],
        checkpointer=InMemorySaver(),
    )
    agent = LangGraphAGUIAgent(
        name="test",
        graph=graph,
        config={"metadata": config_metadata} if config_metadata else None,
    )
    run_input = RunAgentInput(
        threadId="t1",
        runId="r1",
        state={},
        messages=[UserMessage(id="u1", content="hi")],
        tools=tools or [_frontend_tool()],
        context=[],
        forwardedProps=forwarded_props or {},
    )

    async def _run():
        dispatched = []
        yielded = []
        original = AGUIBase._dispatch_event

        def _track(self_inner, event):
            dispatched.append(event)
            return original(self_inner, event)

        original_adapter = LangGraphAGUIAgent._dispatch_event

        def _track_adapter(self_inner, event):
            if observed_events is not None:
                observed_events.append(event)
            return original_adapter(self_inner, event)

        adapter_patch = (
            patch.object(LangGraphAGUIAgent, "_dispatch_event", new=_track_adapter)
            if observed_events is not None
            else nullcontext()
        )
        with adapter_patch:
            with patch.object(AGUIBase, "_dispatch_event", new=_track):
                async for event in agent.run(run_input):
                    yielded.append(event)
        return dispatched, yielded, model

    return asyncio.run(_run())


def _tool_events(dispatched):
    return [
        event
        for event in dispatched
        if getattr(event, "type", None)
        in {
            EventType.TOOL_CALL_START,
            EventType.TOOL_CALL_ARGS,
            EventType.TOOL_CALL_END,
        }
    ]


def _assert_single_tool_call_triple(dispatched, tool_call_id="tc-1"):
    events = _tool_events(dispatched)
    assert [event.type for event in events] == [
        EventType.TOOL_CALL_START,
        EventType.TOOL_CALL_ARGS,
        EventType.TOOL_CALL_END,
    ]
    assert [event.tool_call_id for event in events] == [tool_call_id] * 3
    assert events[1].delta == '{"prompt": "what is your name?"}'


def test_intercepted_sdk_action_non_streaming_reproduces_issue_and_emits_once():
    dispatched, yielded, model = _collect_intercepted_tool_run(streaming=False)
    _assert_single_tool_call_triple(dispatched)
    _assert_single_tool_call_triple(yielded)
    assert BoundFakeToolModel.generate_calls == 1
    assert BoundFakeToolModel.astream_calls == 0


def test_intercepted_sdk_action_streaming_emits_once():
    dispatched, yielded, model = _collect_intercepted_tool_run(streaming=True)
    _assert_single_tool_call_triple(dispatched)
    _assert_single_tool_call_triple(yielded)
    assert BoundFakeToolModel.astream_calls == 1
    assert BoundFakeToolModel.generate_calls == 0


def test_after_agent_restores_tool_call_in_both_modes():
    for streaming in (False, True):
        dispatched, yielded, _ = _collect_intercepted_tool_run(streaming=streaming)
        final_snapshot = next(
            event
            for event in reversed(yielded)
            if isinstance(event, MessagesSnapshotEvent)
        )
        assistant_message = final_snapshot.messages[-1]
        _assert_single_tool_call_triple(dispatched)
        assert len(assistant_message.tool_calls) == 1
        assert assistant_message.tool_calls[0].id == "tc-1"
        assert assistant_message.tool_calls[0].function.name == "ask_user_name"
        assert assistant_message.tool_calls[0].function.arguments == json.dumps(
            {"prompt": "what is your name?"}
        )


async def _state_event(agent, state, *, calls, parent_message_id="ai-1", metadata=None):
    event = {
        "event": "on_chain_end",
        "metadata": metadata or {},
        "data": {
            "output": {
                "copilotkit": {
                    "intercepted_tool_calls": calls,
                    "original_ai_message_id": parent_message_id,
                }
            }
        },
    }
    return [result async for result in agent._handle_single_event(event, state)]


def _bridge_agent():
    # Construct for real rather than via object.__new__: the base class sets
    # behavior flags that its own dispatch path reads, so an instance that
    # skipped __init__ raised AttributeError mid-dispatch as soon as
    # ag-ui-langgraph started reading one of them.
    graph = MagicMock()
    graph.nodes = {}
    agent = LangGraphAGUIAgent(name="bridge", graph=graph)
    agent.active_run = {"streamed_tool_call_ids": {"streamed"}}
    agent._copilotkit_runtime_payload = {"actions": [{"function": None}]}
    return agent


def _run_state_event(calls, streamed=None, metadata=None):
    agent = _bridge_agent()
    if streamed is not None:
        agent.active_run["streamed_tool_call_ids"] = set(streamed)
    dispatched = []
    parent_events = []
    original = AGUIBase._dispatch_event

    def _track(self_inner, event):
        dispatched.append(event)
        return original(self_inner, event)

    async def _parent(self_inner, event, state):
        parent_events.append((event, state))
        yield "parent-event"

    async def _run():
        with patch.object(AGUIBase, "_handle_single_event", new=_parent):
            with patch.object(AGUIBase, "_dispatch_event", new=_track):
                return await _state_event(agent, {}, calls=calls, metadata=metadata)

    parent_results = asyncio.run(_run())
    return dispatched, agent, parent_events, parent_results


def test_multiple_intercepted_calls_dedupe_per_id():
    dispatched, agent, _, _ = _run_state_event(
        [
            {"id": "streamed", "name": "one", "args": {}},
            {"id": "fresh", "name": "two", "args": {"x": 1}},
        ]
    )
    assert [event.tool_call_id for event in _tool_events(dispatched)] == [
        "fresh",
        "fresh",
        "fresh",
    ]
    assert agent.active_run["streamed_tool_call_ids"] == {"streamed", "fresh"}


def test_backend_call_is_not_published_by_intercepted_state_bridge():
    backend_and_frontend = AIMessage(
        content="",
        id="ai-1",
        tool_calls=[
            {"id": "frontend", "name": "frontend", "args": {}},
            {"id": "backend", "name": "backend", "args": {"x": 1}},
        ],
    )
    middleware = CopilotKitMiddleware()
    result = middleware.after_model(
        {
            "messages": [backend_and_frontend],
            "copilotkit": {"actions": [{"name": "frontend"}]},
        },
        None,
    )
    assert result is not None
    assert [call["id"] for call in result["copilotkit"]["intercepted_tool_calls"]] == [
        "frontend"
    ]
    assert [call["id"] for call in result["messages"][-1].tool_calls] == ["backend"]

    dispatched, _, _, _ = _run_state_event(
        result["copilotkit"]["intercepted_tool_calls"]
    )
    assert {event.tool_call_id for event in _tool_events(dispatched)} == {"frontend"}


def test_intercepted_state_metadata_opt_out_is_not_recreated_by_bridge():
    observed = []
    _, yielded, _ = _collect_intercepted_tool_run(
        config_metadata={"copilotkit:emit-tool-calls": False},
        observed_events=observed,
    )
    observed_tool_events = [
        event
        for event in observed
        if event.type
        in {
            EventType.TOOL_CALL_START,
            EventType.TOOL_CALL_ARGS,
            EventType.TOOL_CALL_END,
        }
    ]
    assert observed_tool_events
    assert all(
        event.raw_event["metadata"]["copilotkit:emit-tool-calls"] is False
        for event in observed_tool_events
    )
    assert _tool_events(yielded) == []


def test_bridge_ignores_runtime_action_catalog_shapes():
    dispatched, _, _, _ = _run_state_event(
        [{"id": "safe", "name": "ask_user_name", "args": {}}]
    )
    assert [event.tool_call_id for event in _tool_events(dispatched)] == [
        "safe",
        "safe",
        "safe",
    ]


def test_malformed_intercepted_entries_emit_no_partial_lifecycle():
    dispatched, _, parent_events, parent_results = _run_state_event(
        [
            None,
            {"id": "bad", "name": "bad", "args": object()},
            {"id": "missing-name", "name": "", "args": {}},
            {"id": "missing-args", "name": "ignored"},
            {"id": "good", "name": "good", "args": {}},
        ]
    )
    assert [event.tool_call_id for event in _tool_events(dispatched)] == [
        "good",
        "good",
        "good",
    ]
    assert len(parent_events) == 1
    assert parent_events[0][0]["event"] == "on_chain_end"
    assert parent_results[0] == "parent-event"
    assert [event.tool_call_id for event in _tool_events(parent_results)] == [
        "good",
        "good",
        "good",
    ]
