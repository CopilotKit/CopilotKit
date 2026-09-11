"""End-to-end coverage for ``CopilotKitMiddleware(interrupt_frontend_tools=True)``.

These run real ``create_agent`` graphs through ``LangGraphAGUIAgent`` so the
whole path is exercised: the batched ``interrupt()`` raised from ``after_model``,
the AG-UI event the client sees, the ``forwardedProps.command.resume`` round
trip, and the message history the model ends up with.

The default (strip-and-restore) behaviour is covered by
``test_intercepted_tool_call_events.py``; the tests here that touch it only
assert that turning the flag off changes nothing.
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
from copilotkit.exc import CopilotKitMisuseError
from copilotkit.langgraph_agui_agent import LangGraphAGUIAgent

FE_TOOL_NAME = "navigate"
INTERRUPT_KEY = "__copilotkit_frontend_tool_calls__"

# LangGraph's interrupt() reads the run config through a contextvar, which does
# not propagate into asyncio tasks before Python 3.11 — so no interrupt can fire
# from an async node on 3.10. That is a platform limit, not a CopilotKit one;
# the middleware turns it into an actionable error, pinned by
# test_async_on_python_310_explains_the_version_requirement below.
requires_async_interrupt = pytest.mark.skipif(
    sys.version_info < (3, 11),
    reason="interrupt() from an async node requires Python 3.11+",
)


class _ScriptedModel(BaseChatModel):
    """Replays a scripted list of AIMessages and records what it was sent.

    ``script`` is a plain dict shared *by reference* across the copies
    ``bind_tools`` makes, so both the response queue and the record of what each
    call saw survive re-binding — which ``create_agent`` does on every turn.
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
        # Hold on the final response so an unexpected extra turn surfaces as a
        # failed assertion rather than an IndexError.
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

    ``ag-ui-langgraph`` 0.0.42 — the floor the CI matrix pins — has no
    ``RunFinished(outcome=...)`` support, so the legacy CustomEvent is the only
    channel an interrupt reaches the client through.
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


@pytest.mark.skipif(
    sys.version_info >= (3, 11), reason="only 3.10 hits the contextvar limit"
)
def test_async_on_python_310_explains_the_version_requirement():
    """Rather than LangGraph's "Called get_config outside of a runnable context",
    which says nothing about the flag or the fix."""
    graph, _ = _build(responses=[_ai([_fe_call()])], tools=[])

    with pytest.raises(CopilotKitMisuseError, match="Python 3.11"):
        _run(graph)
