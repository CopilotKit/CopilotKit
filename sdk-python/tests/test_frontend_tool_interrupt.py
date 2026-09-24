"""End-to-end coverage for ``CopilotKitMiddleware(interrupt_frontend_tools=True)``.

These run real ``create_agent`` graphs through ``LangGraphAGUIAgent``: one
``interrupt()`` per frontend call from ``wrap_tool_call``, the AG-UI events the
client sees, the resume round trip, and the resulting history. The default path
is covered by ``test_intercepted_tool_call_events.py``.

Two resume channels are covered. The legacy ``forwardedProps.command.resume``
works on every supported ag-ui-langgraph, but carries no interrupt id, so it can
only answer one pending call. The AG-UI standard ``RunAgentInput.resume[]`` (with
``emit_interrupt_outcome=True``, ag-ui-langgraph >= 0.0.43) addresses each call's
interrupt by id, which is what parallel calls need.
"""

import asyncio
import inspect
import json
import sys
from typing import Any

from ag_ui.core import EventType, Tool, UserMessage
from ag_ui.core.types import ResumeEntry, RunAgentInput
from ag_ui_langgraph import LangGraphAgent
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
HITL_TOOL_NAME = "confirm"

requires_async_interrupt = pytest.mark.skipif(
    sys.version_info < (3, 11),
    reason="LangGraph's interrupt() needs Python 3.11+ under async",
)

requires_standard_resume = pytest.mark.skipif(
    "emit_interrupt_outcome"
    not in inspect.signature(LangGraphAgent.__init__).parameters,
    reason=(
        "installed ag-ui-langgraph predates RUN_FINISHED(outcome=interrupt) and "
        "RunAgentInput.resume[] (added in 0.0.43)"
    ),
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


def _fe_call(call_id="fe-1", path="/x", name=FE_TOOL_NAME):
    return {"id": call_id, "name": name, "args": {"path": path}}


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


def _run(
    graph,
    *,
    thread_id="t1",
    run_id="r1",
    forwarded_props=None,
    resume=None,
    message_id="u1",
    agent_cls=LangGraphAGUIAgent,
    **agent_kwargs,
):
    agent = agent_cls(name="test", graph=graph, **agent_kwargs)
    run_input = RunAgentInput(
        threadId=thread_id,
        runId=run_id,
        state={},
        messages=[UserMessage(id=message_id, content="hi")],
        tools=[_fe_tool(), _fe_tool(HITL_TOOL_NAME)],
        context=[],
        forwardedProps=forwarded_props or {},
        **({"resume": resume} if resume is not None else {}),
    )

    async def _go():
        return [event async for event in agent.run(run_input)]

    return asyncio.run(_go())


def _run_standard(graph, **kwargs):
    """Run with the AG-UI standard interrupt outcome switched on."""
    return _run(graph, emit_interrupt_outcome=True, **kwargs)


def _interrupt_payloads(events):
    """Frontend-tool interrupt values carried by legacy ``on_interrupt`` events.

    ``ag-ui-langgraph`` 0.0.42 (the CI floor) has no ``RunFinished(outcome=...)``,
    so the legacy CustomEvent is the only channel for an interrupt there.
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
        if isinstance(value, dict) and value.get("reason") == "tool_call":
            payloads.append(value)
    return payloads


def _open_interrupts(events):
    """``(interrupt_id, tool_call_id)`` for each interrupt in the run's outcome."""
    errors = [e for e in events if e.type == EventType.RUN_ERROR]
    assert not errors, errors[0].message
    finished = [e for e in events if e.type == EventType.RUN_FINISHED][-1]
    if finished.outcome is None:
        return []
    assert all(i.reason == "tool_call" for i in finished.outcome.interrupts)
    return [(i.id, i.tool_call_id) for i in finished.outcome.interrupts]


def _answer(interrupt_id, payload=None, status="resolved"):
    return ResumeEntry(interrupt_id=interrupt_id, status=status, payload=payload)


def _legacy_resume(value):
    return {"command": {"resume": value}}


def _tool_messages(messages):
    return [m for m in messages if isinstance(m, ToolMessage)]


# --- legacy resume channel: works on every supported ag-ui-langgraph ---------


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
        {
            "reason": "tool_call",
            "toolCallId": "fe-1",
            "name": FE_TOOL_NAME,
            "args": {"path": "/x"},
        }
    ]
    assert len(script["seen"]) == 1, "the run must pause, not call the model again"

    _run(graph, run_id="r2", forwarded_props=_legacy_resume({"page": "/x"}))

    assert len(script["seen"]) == 2, "resuming must re-enter the model"
    second_call = script["seen"][1]
    ai = next(m for m in second_call if isinstance(m, AIMessage))
    assert [tc["id"] for tc in ai.tool_calls] == ["fe-1"], (
        "the frontend call stays on the AIMessage — it is not stripped"
    )
    results = _tool_messages(second_call)
    assert [(m.tool_call_id, json.loads(m.content)) for m in results] == [
        ("fe-1", {"page": "/x"})
    ]
    assert second_call.index(ai) < second_call.index(results[0])


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

    assert _interrupt_payloads(_run(graph))[0]["toolCallId"] == "fe-1"

    second = _run(graph, run_id="r2", forwarded_props=_legacy_resume("first"))
    assert _interrupt_payloads(second)[0]["toolCallId"] == "fe-2"

    _run(graph, run_id="r3", forwarded_props=_legacy_resume("second"))

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


def test_agent_without_backend_tools_still_has_a_tool_node():
    """Interrupt mode runs frontend calls in the tool node, so it must exist.

    ``create_agent`` builds the tools node when there are tools *or* a middleware
    wraps tool calls, so ``CopilotKitMiddleware``'s wrappers keep the node — and
    the conditional edge to it — alive even at ``tools=[]``. Without them a
    frontend call would end the run instead of pausing it.
    """
    graph, _ = _build(responses=[_ai([_fe_call()])], tools=[])
    drawable = graph.get_graph()

    assert "tools" in drawable.nodes, (
        "create_agent built no ToolNode for a tools=[] agent. CopilotKitMiddleware "
        "has to keep defining wrap_tool_call/awrap_tool_call, which is where "
        "interrupt mode pauses each frontend call."
    )
    after_model_targets = {
        edge.target for edge in drawable.edges if edge.source.endswith(".after_model")
    }
    assert "tools" in after_model_targets, sorted(after_model_targets)


# --- standard resume channel: parallel calls, one interrupt each -------------


@requires_async_interrupt
@requires_standard_resume
def test_parallel_frontend_calls_each_get_their_own_interrupt():
    """One ordinary call and one that needs the user, answered in one resume.

    Each call carries its own ``tool_call_id``, so a client can route every
    interrupt to the right tool and answer it by id.
    """
    graph, script = _build(
        responses=[
            _ai([_fe_call("fe-1"), _fe_call("fe-2", name=HITL_TOOL_NAME)]),
            AIMessage(content="done", id="ai-2"),
        ],
        tools=[],
    )

    pending = _open_interrupts(_run_standard(graph))

    assert [tool_call_id for _, tool_call_id in pending] == ["fe-1", "fe-2"]
    assert len({interrupt_id for interrupt_id, _ in pending}) == 2
    assert len(script["seen"]) == 1

    by_call = dict((call, iid) for iid, call in pending)
    after = _run_standard(
        graph,
        run_id="r2",
        resume=[
            _answer(by_call["fe-1"], {"page": "/x"}),
            _answer(by_call["fe-2"], {"approved": True}),
        ],
    )

    assert _open_interrupts(after) == []
    assert len(script["seen"]) == 2
    results = {
        m.tool_call_id: json.loads(m.content) for m in _tool_messages(script["seen"][1])
    }
    assert results == {"fe-1": {"page": "/x"}, "fe-2": {"approved": True}}


@requires_async_interrupt
@requires_standard_resume
def test_unanswered_call_stays_pending_instead_of_getting_a_placeholder():
    graph, script = _build(
        responses=[
            _ai([_fe_call("fe-1"), _fe_call("fe-2", name=HITL_TOOL_NAME)]),
            AIMessage(content="done", id="ai-2"),
        ],
        tools=[],
    )
    by_call = {call: iid for iid, call in _open_interrupts(_run_standard(graph))}

    # Answer only the ordinary call.
    partial = _run_standard(
        graph, run_id="r2", resume=[_answer(by_call["fe-1"], "navigated")]
    )

    assert [call for _, call in _open_interrupts(partial)] == ["fe-2"], (
        "only the unanswered call may still be open"
    )
    assert len(script["seen"]) == 1, "the model must not run with a result missing"

    # The user declines.
    _run_standard(
        graph, run_id="r3", resume=[_answer(by_call["fe-2"], status="cancelled")]
    )

    assert len(script["seen"]) == 2
    results = {m.tool_call_id: m for m in _tool_messages(script["seen"][1])}
    assert results["fe-1"].content == "navigated"
    assert results["fe-2"].status == "error"
    assert json.loads(results["fe-2"].content) == {"ok": False, "error": "cancelled"}


@requires_async_interrupt
@requires_standard_resume
def test_mixed_turn_runs_the_backend_call_once_and_pauses_the_frontend_one():
    backend_runs = []

    @tool
    def counted_search(q: str) -> str:
        """Search the backend."""
        backend_runs.append(q)
        return "backend-result"

    graph, script = _build(
        responses=[
            _ai(
                [
                    {"id": "be-1", "name": "counted_search", "args": {"q": "hi"}},
                    _fe_call(),
                ]
            ),
            AIMessage(content="all done", id="ai-2"),
        ],
        tools=[counted_search],
    )

    pending = _open_interrupts(_run_standard(graph))
    assert [call for _, call in pending] == ["fe-1"]

    _run_standard(
        graph, run_id="r2", resume=[_answer(pending[0][0], "frontend-result")]
    )

    assert backend_runs == ["hi"], "resuming must not re-run the finished backend call"
    assert len(script["seen"]) == 2
    results = {m.tool_call_id: m.content for m in _tool_messages(script["seen"][1])}
    assert results == {"fe-1": "frontend-result", "be-1": "backend-result"}


@requires_async_interrupt
@requires_standard_resume
@pytest.mark.xfail(
    strict=True,
    raises=RuntimeError,
    reason=(
        "Upstream ag-ui-langgraph resumes several entries as one "
        "{'__agui_resume_map__': ...} value. LangGraph only accepts a resume keyed "
        "by interrupt id while more than one interrupt is pending, so it raises "
        "'When there are multiple pending interrupts, you must specify the "
        "interrupt id when resuming'. LangGraphAGUIAgent overrides "
        "_build_command_from_agui_resume to fix this; remove the xfail once "
        "upstream does the same."
    ),
)
def test_upstream_adapter_cannot_resume_parallel_interrupts():
    graph, script = _build(
        responses=[
            _ai([_fe_call("fe-1"), _fe_call("fe-2", name=HITL_TOOL_NAME)]),
            AIMessage(content="done", id="ai-2"),
        ],
        tools=[],
    )
    pending = _open_interrupts(_run_standard(graph, agent_cls=LangGraphAgent))

    _run_standard(
        graph,
        run_id="r2",
        agent_cls=LangGraphAgent,
        resume=[_answer(iid, f"result-{call}") for iid, call in pending],
    )

    assert len(script["seen"]) == 2
