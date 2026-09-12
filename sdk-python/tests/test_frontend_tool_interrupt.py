"""End-to-end coverage for ``CopilotKitMiddleware(interrupt_frontend_tools=True)``.

These run real ``create_agent`` graphs through ``LangGraphAGUIAgent``: the
batched ``interrupt()`` from ``after_model``, the AG-UI event the client sees,
the ``forwardedProps.command.resume`` round trip, and the resulting history. The
default path is covered by ``test_intercepted_tool_call_events.py``.
"""

import asyncio
import json
import sys
from typing import Any

from ag_ui.core import EventType, Tool, UserMessage
from ag_ui.core.types import RunAgentInput
from langchain.agents import create_agent
from langchain_core.language_models.chat_models import BaseChatModel
from langchain_core.messages import AIMessage, ToolMessage
from langchain_core.outputs import ChatGeneration, ChatResult
from langchain_core.tools import tool
from langgraph.checkpoint.memory import InMemorySaver
import pytest

from copilotkit import CopilotKitMiddleware
from copilotkit.langgraph_agui_agent import LangGraphAGUIAgent

FE_TOOL_NAME = "navigate"
INTERRUPT_KEY = "__copilotkit_frontend_tool_calls__"

requires_async_interrupt = pytest.mark.skipif(
    sys.version_info < (3, 11),
    reason="LangGraph's interrupt() needs Python 3.11+ under async",
)


class _ScriptedModel(BaseChatModel):
    """Replays a scripted list of AIMessages and records what it was sent.

    ``script`` is shared *by reference* across the copies ``bind_tools`` makes,
    which ``create_agent`` does on every turn.
    """

    script: dict

    def bind_tools(self, tools, **kwargs):
        self.script["bound_tools"] = list(tools)
        return self.__class__(script=self.script)

    @property
    def _llm_type(self) -> str:
        return "scripted"

    def _generate(self, messages, stop=None, run_manager=None, **kwargs):
        self.script["seen"].append(list(messages))
        responses = self.script["responses"]
        # Hold the final response so an extra turn fails an assert, not IndexError.
        response = responses.pop(0) if len(responses) > 1 else responses[0]
        return ChatResult(generations=[ChatGeneration(message=response)])


@tool
def backend_search(q: str) -> str:
    """Search the backend."""
    return "backend-result"


def _fe_tool(name: str = FE_TOOL_NAME) -> Tool:
    return Tool(
        name=name,
        description="A frontend tool",
        parameters={
            "type": "object",
            "properties": {"path": {"type": "string"}},
            "required": ["path"],
        },
    )


def _ai(tool_calls, *, msg_id="ai-1", content=""):
    return AIMessage(content=content, id=msg_id, tool_calls=list(tool_calls))


def _fe_call(call_id="fe-1", path="/x"):
    return {"id": call_id, "name": FE_TOOL_NAME, "args": {"path": path}}


def _build(*, responses, interrupt_frontend_tools=True, tools=()):
    script: dict[str, Any] = {"responses": list(responses), "seen": []}
    graph = create_agent(
        model=_ScriptedModel(script=script),
        tools=list(tools),
        middleware=[
            CopilotKitMiddleware(interrupt_frontend_tools=interrupt_frontend_tools)
        ],
        checkpointer=InMemorySaver(),
    )
    return graph, script


def _run(graph, *, thread_id="t1", run_id="r1", forwarded_props=None, message_id="u1"):
    agent = LangGraphAGUIAgent(name="test", graph=graph)
    run_input = RunAgentInput(
        threadId=thread_id,
        runId=run_id,
        state={},
        messages=[UserMessage(id=message_id, content="hi")],
        tools=[_fe_tool()],
        context=[],
        forwardedProps=forwarded_props or {},
    )

    async def _go():
        return [event async for event in agent.run(run_input)]

    return asyncio.run(_go())


def _interrupt_payloads(events):
    """Frontend-tool interrupt payloads carried by ``on_interrupt`` events.

    ``ag-ui-langgraph`` 0.0.42 (the CI floor) has no ``RunFinished(outcome=...)``,
    so the legacy CustomEvent is the only channel for an interrupt.
    """
    payloads = []
    for event in events:
        if getattr(event, "type", None) != EventType.CUSTOM:
            continue
        if getattr(event, "name", None) != "on_interrupt":
            continue
        value = getattr(event, "value", None)
        # 0.0.42 serialises the interrupt value to a JSON string on the wire.
        if isinstance(value, str):
            try:
                value = json.loads(value)
            except ValueError:
                continue
        if isinstance(value, dict) and INTERRUPT_KEY in value:
            payloads.append(value[INTERRUPT_KEY])
    return payloads


def _resume(tool_results):
    return {"command": {"resume": {"tool_results": tool_results}}}


def _tool_messages(messages):
    return [m for m in messages if isinstance(m, ToolMessage)]


@requires_async_interrupt
def test_all_frontend_turn_pauses_then_resumes_into_the_same_turn():
    """The feature itself: the model gets the real result back in-run, in the
    natural AIMessage -> ToolMessage order, without the turn ending first."""
    graph, script = _build(
        responses=[_ai([_fe_call()]), AIMessage(content="you are on /x", id="ai-2")],
        tools=[],
    )

    first = _run(graph)

    assert _interrupt_payloads(first) == [
        [{"id": "fe-1", "name": FE_TOOL_NAME, "args": {"path": "/x"}}]
    ]
    assert len(script["seen"]) == 1, "the run must pause, not call the model again"

    _run(
        graph,
        run_id="r2",
        forwarded_props=_resume([{"toolCallId": "fe-1", "content": '{"page": "/x"}'}]),
    )

    assert len(script["seen"]) == 2, "resuming must re-enter the model"
    second_call = script["seen"][1]
    ai = next(m for m in second_call if isinstance(m, AIMessage))
    assert [tc["id"] for tc in ai.tool_calls] == ["fe-1"], (
        "the frontend call stays on the AIMessage — it is not stripped"
    )
    results = _tool_messages(second_call)
    assert [(m.tool_call_id, m.content) for m in results] == [
        ("fe-1", '{"page": "/x"}')
    ]
    assert second_call.index(ai) < second_call.index(results[0])


@requires_async_interrupt
def test_mixed_turn_runs_only_the_backend_call_through_the_tool_node():
    """No ``jump_to`` is set, so the model->tools edge has to do the routing:
    send the still-pending backend call to the ToolNode, skip the frontend one
    now that it has a matching ToolMessage."""
    graph, script = _build(
        responses=[
            _ai(
                [
                    {"id": "be-1", "name": "backend_search", "args": {"q": "hi"}},
                    _fe_call(),
                ]
            ),
            AIMessage(content="all done", id="ai-2"),
        ],
        tools=[backend_search],
    )

    first = _run(graph)
    assert _interrupt_payloads(first) == [
        [{"id": "fe-1", "name": FE_TOOL_NAME, "args": {"path": "/x"}}]
    ]

    _run(
        graph,
        run_id="r2",
        forwarded_props=_resume([{"toolCallId": "fe-1", "content": "frontend-result"}]),
    )

    assert len(script["seen"]) == 2
    results = _tool_messages(script["seen"][1])
    assert {m.tool_call_id: m.content for m in results} == {
        "fe-1": "frontend-result",
        "be-1": "backend-result",
    }


@requires_async_interrupt
def test_two_frontend_turns_on_one_thread():
    graph, script = _build(
        responses=[
            _ai([_fe_call()]),
            _ai([_fe_call("fe-2", "/y")], msg_id="ai-2"),
            AIMessage(content="done", id="ai-3"),
        ],
        tools=[],
    )

    assert _interrupt_payloads(_run(graph))[0][0]["id"] == "fe-1"

    second = _run(
        graph,
        run_id="r2",
        forwarded_props=_resume([{"toolCallId": "fe-1", "content": "first"}]),
    )
    assert _interrupt_payloads(second)[0][0]["id"] == "fe-2"

    _run(
        graph,
        run_id="r3",
        forwarded_props=_resume([{"toolCallId": "fe-2", "content": "second"}]),
    )

    assert len(script["seen"]) == 3
    final = script["seen"][2]
    assert {m.tool_call_id: m.content for m in _tool_messages(final)} == {
        "fe-1": "first",
        "fe-2": "second",
    }


def test_flag_off_never_interrupts():
    """Guards the default path against anything the opt-in branch changed."""
    graph, script = _build(
        responses=[_ai([_fe_call()]), AIMessage(content="done", id="ai-2")],
        tools=[],
        interrupt_frontend_tools=False,
    )

    events = _run(graph)

    assert _interrupt_payloads(events) == []
    # Stripped, so the turn ends here and the result arrives on the next run.
    assert len(script["seen"]) == 1


def test_agent_without_backend_tools_still_loops_back_to_the_model():
    """Pins what makes ``jump_to`` unnecessary in ``_await_frontend_tool_calls``.

    ``create_agent`` builds the tools node when there are tools *or* a middleware
    wraps tool calls, so ``CopilotKitMiddleware``'s wrappers keep the node — and
    the conditional edge back to the model — alive even at ``tools=[]``. Without
    them every resume silently ends the run.
    """
    graph, _ = _build(responses=[_ai([_fe_call()])], tools=[])
    drawable = graph.get_graph()

    assert "tools" in drawable.nodes, (
        "create_agent built no ToolNode for a tools=[] agent. CopilotKitMiddleware "
        "has to keep defining wrap_tool_call/awrap_tool_call, or after_model's "
        "only edge is to the exit node and resuming silently ends the run."
    )

    after_model_targets = {
        edge.target
        for edge in drawable.edges
        if edge.source.endswith(".after_model")
    }
    assert "model" in after_model_targets, (
        "after_model cannot route back to the model, so the frontend results "
        f"would never reach it; edges go to {sorted(after_model_targets)}"
    )
