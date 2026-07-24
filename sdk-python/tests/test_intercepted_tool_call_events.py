"""End-to-end coverage for intercepted SDK Action tool-call emission.

Covers the real LangChain `create_agent(..., tools=[])` path the regression
was reported against:

  - current main emits no AG-UI TOOL_CALL_* events for intercepted SDK Actions
  - this branch emits exactly one TOOL_CALL_START/ARGS/END triple
  - `after_agent` still restores the tool call into the final snapshot without
    causing a duplicate stream emission
"""

import asyncio
from typing import Any
from unittest.mock import patch

from ag_ui.core import EventType, MessagesSnapshotEvent, Tool, UserMessage
from ag_ui_langgraph import LangGraphAgent as AGUIBase
from ag_ui.core.types import RunAgentInput
from langchain.agents import create_agent
from langchain_core.language_models.chat_models import BaseChatModel
from langchain_core.messages import AIMessage
from langchain_core.outputs import ChatGeneration, ChatResult
from langgraph.checkpoint.memory import InMemorySaver
from pydantic import Field

from copilotkit import CopilotKitMiddleware
from copilotkit.langgraph_agui_agent import LangGraphAGUIAgent


class BoundFakeToolModel(BaseChatModel):
    """Minimal fake chat model that supports `bind_tools()` for `create_agent()`."""

    responses: list[AIMessage]
    i: int = 0
    bound_tools: list[Any] = Field(default_factory=list)

    def bind_tools(self, tools, **kwargs):
        return self.__class__(
            responses=self.responses,
            i=self.i,
            bound_tools=list(tools),
        )

    @property
    def _llm_type(self) -> str:
        return "bound-fake-tool-model"

    def _generate(self, messages, stop=None, run_manager=None, **kwargs):
        response = self.responses[self.i]
        if self.i < len(self.responses) - 1:
            self.i += 1
        return ChatResult(generations=[ChatGeneration(message=response)])


def _frontend_tool() -> Tool:
    return Tool(
        name="ask_user_name",
        description="Frontend SDK Action",
        parameters={
            "type": "object",
            "properties": {"prompt": {"type": "string"}},
            "required": ["prompt"],
        },
    )


def _collect_intercepted_tool_run():
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
        ]
    )
    graph = create_agent(
        model=model,
        tools=[],
        middleware=[CopilotKitMiddleware()],
        checkpointer=InMemorySaver(),
    )
    agent = LangGraphAGUIAgent(name="test", graph=graph)
    run_input = RunAgentInput(
        threadId="t1",
        runId="r1",
        state={},
        messages=[UserMessage(id="u1", content="hi")],
        tools=[_frontend_tool()],
        context=[],
        forwardedProps={},
    )

    async def _run():
        dispatched = []
        yielded = []
        original = AGUIBase._dispatch_event

        def _track(self_inner, event):
            dispatched.append(event)
            return original(self_inner, event)

        with patch.object(AGUIBase, "_dispatch_event", new=_track):
            async for event in agent.run(run_input):
                yielded.append(event)

        return dispatched, yielded

    return asyncio.run(_run())


def test_intercepted_sdk_action_emits_single_tool_call_triple_end_to_end():
    dispatched, _ = _collect_intercepted_tool_run()

    tool_call_starts = [
        event for event in dispatched if getattr(event, "type", None) == EventType.TOOL_CALL_START
    ]
    tool_call_args = [
        event for event in dispatched if getattr(event, "type", None) == EventType.TOOL_CALL_ARGS
    ]
    tool_call_ends = [
        event for event in dispatched if getattr(event, "type", None) == EventType.TOOL_CALL_END
    ]
    manual_emit_events = [
        event
        for event in dispatched
        if getattr(event, "type", None) == EventType.CUSTOM
        and getattr(event, "name", None) == "copilotkit_manually_emit_tool_call"
    ]

    assert len(manual_emit_events) == 1
    assert len(tool_call_starts) == 1
    assert len(tool_call_args) == 1
    assert len(tool_call_ends) == 1

    assert tool_call_starts[0].tool_call_id == "tc-1"
    assert tool_call_args[0].tool_call_id == "tc-1"
    assert tool_call_args[0].delta == '{"prompt": "what is your name?"}'
    assert tool_call_ends[0].tool_call_id == "tc-1"


def test_after_agent_restores_tool_call_without_duplicate_stream_events():
    dispatched, yielded = _collect_intercepted_tool_run()

    final_snapshot = next(
        event
        for event in reversed(yielded)
        if isinstance(event, MessagesSnapshotEvent)
    )
    assistant_message = final_snapshot.messages[-1]

    tool_call_ids = [
        event.tool_call_id
        for event in dispatched
        if getattr(event, "type", None) in {
            EventType.TOOL_CALL_START,
            EventType.TOOL_CALL_ARGS,
            EventType.TOOL_CALL_END,
        }
    ]

    assert len(tool_call_ids) == 3
    assert tool_call_ids == ["tc-1", "tc-1", "tc-1"]

    assert len(assistant_message.tool_calls) == 1
    assert assistant_message.tool_calls[0].id == "tc-1"
    assert assistant_message.tool_calls[0].function.name == "ask_user_name"
    assert assistant_message.tool_calls[0].function.arguments == '{"prompt": "what is your name?"}'
