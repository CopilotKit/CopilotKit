"""Red-green proof for agent_server HITL conversion + reasoning RUN_ERROR.

Covers PR-A backlog fixes:

1. ``_convert_agui_messages`` tool-pairing / falsy-id dedup. A ``tool``
   message with a falsy ``tool_call_id`` (empty string, or a ``None`` set
   via ``model_construct``) poisons ``seen_tool_ids`` so every later
   falsy-id tool message is silently dropped, AND an orphan tool message
   (no matching assistant ``tool_calls`` id) gets emitted, which the
   OpenAI API rejects with a 400. The fix guards falsy ids on BOTH passes
   and only emits a tool result whose id was retained on an assistant
   ``tool_calls`` (and vice-versa) — orphans are dropped on both sides.

2. ``_run_reasoning_agent`` must NOT silently drop ``RUN_ERROR`` events
   from the inner agno stream — it has to surface a run error to the
   client instead of reporting a successful, empty/partial run.
"""

import asyncio.base_events
import sys
from contextlib import ExitStack
from unittest.mock import patch
from pathlib import Path

import pytest
from ag_ui.core import (
    EventType,
    RunErrorEvent,
    RunAgentInput,
    Tool,
    TextMessageContentEvent,
    ToolCallResultEvent,
)
from ag_ui.core.types import (
    AssistantMessage,
    FunctionCall,
    ToolCall,
    ToolMessage,
    UserMessage,
)

from agno.agent import Agent, _tools
from agno.models.openai import OpenAIChat
from agno.run.agent import RunCompletedEvent
from agno.tools.function import Function

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "src"))


from agents import _header_forwarding as hf  # noqa: E402

# Server bootstrap patches constructors and executors. Restore them after
# collection so the other tests start with their normal unpatched environment.
with ExitStack() as bootstrap_patches:
    bootstrap_patches.enter_context(
        patch.object(
            asyncio.base_events.BaseEventLoop,
            "run_in_executor",
            asyncio.base_events.BaseEventLoop.run_in_executor,
        )
    )
    for sentinel in ("_EXECUTOR_CTXVAR_PATCHED", "_GLOBAL_HTTPX_PATCHED"):
        bootstrap_patches.enter_context(
            patch.object(hf, sentinel, getattr(hf, sentinel))
        )
    for transport in hf._available_httpx_modules():
        for client in (transport.Client, transport.AsyncClient):
            bootstrap_patches.enter_context(
                patch.object(client, "__init__", client.__init__)
            )
    import agent_server


def _falsy_tool_msg(content: str) -> ToolMessage:
    """Build a ToolMessage with a falsy (None) tool_call_id.

    Pydantic rejects ``None`` via the normal constructor, but the runtime
    can hand us such a message (e.g. via ``model_construct`` or an older
    schema), so we reproduce that shape directly.
    """
    return ToolMessage.model_construct(
        id="x", role="tool", content=content, tool_call_id=None
    )


def _assistant_with_tool_call(call_id: str) -> AssistantMessage:
    return AssistantMessage(
        id="a1",
        role="assistant",
        content=None,
        tool_calls=[
            ToolCall(
                id=call_id,
                type="function",
                function=FunctionCall(name="do_thing", arguments="{}"),
            )
        ],
    )


# ---------------------------------------------------------------------------
# Bug 1a: falsy tool_call_id poisons dedup → later falsy-id tools dropped
# ---------------------------------------------------------------------------


def test_falsy_id_tool_messages_not_collapsed():
    """Two distinct falsy-id tool results must not collapse into one."""
    messages = [
        UserMessage(id="u1", role="user", content="hi"),
        _falsy_tool_msg("result A"),
        _falsy_tool_msg("result B"),
    ]
    out = agent_server._convert_agui_messages(messages)
    tool_msgs = [m for m in out if m.role == "tool"]
    # Falsy-id tool results are orphans (no paired assistant tool_calls)
    # and must be dropped entirely — never collapsed-to-one nor emitted.
    assert tool_msgs == [], (
        f"Falsy-id orphan tool messages must be dropped, got {tool_msgs!r}"
    )


# ---------------------------------------------------------------------------
# Bug 1b: orphan tool result (no matching assistant tool_calls) emitted → 400
# ---------------------------------------------------------------------------


def test_orphan_tool_result_dropped():
    """A tool result whose id is not on any assistant tool_calls is dropped."""
    messages = [
        UserMessage(id="u1", role="user", content="hi"),
        # assistant never called tool 'orphan-id'
        ToolMessage(id="t1", role="tool", content="r", tool_call_id="orphan-id"),
    ]
    out = agent_server._convert_agui_messages(messages)
    tool_msgs = [m for m in out if m.role == "tool"]
    assert tool_msgs == [], (
        f"Orphan tool result must be dropped to avoid OpenAI 400, got {tool_msgs!r}"
    )


def test_paired_tool_result_retained():
    """A tool result paired with an assistant tool_calls id is kept."""
    messages = [
        UserMessage(id="u1", role="user", content="hi"),
        _assistant_with_tool_call("call-1"),
        ToolMessage(id="t1", role="tool", content="r", tool_call_id="call-1"),
    ]
    out = agent_server._convert_agui_messages(messages)
    tool_msgs = [m for m in out if m.role == "tool"]
    assert len(tool_msgs) == 1 and tool_msgs[0].tool_call_id == "call-1"
    # And the assistant tool_calls must be retained (paired both ways).
    asst = [m for m in out if m.role == "assistant"]
    assert asst and asst[0].tool_calls, "paired assistant tool_calls must be kept"


def test_assistant_tool_call_without_result_dropped():
    """An assistant turn with content + an orphaned tool_call keeps the
    content but drops the orphan tool_call (pair incomplete)."""
    messages = [
        UserMessage(id="u1", role="user", content="hi"),
        # has content, so the turn is retained even though the call is orphaned
        AssistantMessage(
            id="a1",
            role="assistant",
            content="working on it",
            tool_calls=[
                ToolCall(
                    id="call-1",
                    type="function",
                    function=FunctionCall(name="do_thing", arguments="{}"),
                )
            ],
        ),  # no tool result follows
    ]
    out = agent_server._convert_agui_messages(messages)
    asst = [m for m in out if m.role == "assistant"]
    assert asst and not asst[0].tool_calls, (
        "Unpaired assistant tool_calls must be dropped to keep pairs complete"
    )
    assert asst[0].content == "working on it", (
        "assistant content must be retained when present"
    )


def test_empty_assistant_turn_with_only_orphan_tool_call_dropped():
    """An assistant turn with content=None whose only tool_call is orphaned
    must NOT emit an empty assistant message.

    OpenAI rejects ``{role: "assistant"}`` with neither ``content`` nor
    ``tool_calls``; emitting one also pollutes HITL history.
    """
    messages = [
        UserMessage(id="u1", role="user", content="hi"),
        _assistant_with_tool_call("call-1"),  # content=None, no tool result
    ]
    out = agent_server._convert_agui_messages(messages)
    asst = [m for m in out if m.role == "assistant"]
    assert asst == [], (
        "An assistant turn with no content + all-orphaned tool_calls must be "
        f"dropped entirely (no empty assistant message), got {asst!r}"
    )


# ---------------------------------------------------------------------------
# Bug 2: _run_reasoning_agent must surface RUN_ERROR, not drop it
# ---------------------------------------------------------------------------


class _FakeAgent:
    """Agent whose arun stream yields a RUN_ERROR mid-stream."""

    def arun(self, *args, **kwargs):
        return None  # unused; we monkeypatch the AG-UI mapper


@pytest.mark.asyncio
async def test_reasoning_agent_propagates_run_error(monkeypatch):
    """A RUN_ERROR from the inner stream must reach the client."""

    async def _fake_stream(*args, **kwargs):
        # Inner agno stream errors out after starting.
        yield RunErrorEvent(type=EventType.RUN_ERROR, message="boom")

    monkeypatch.setattr(
        agent_server, "async_stream_agno_response_as_agui_events", _fake_stream
    )

    class _RunInput:
        run_id = "r1"
        thread_id = "t1"
        messages = [UserMessage(id="u1", role="user", content="hi")]
        forwarded_props = None
        state = None

    events = [
        ev async for ev in agent_server._run_reasoning_agent(_FakeAgent(), _RunInput())
    ]
    error_events = [e for e in events if e.type == EventType.RUN_ERROR]
    finished = [e for e in events if e.type == EventType.RUN_FINISHED]
    assert error_events, (
        f"RUN_ERROR must be surfaced, got types {[e.type for e in events]}"
    )
    assert error_events[0].message == "boom"
    assert not finished, "must not report RUN_FINISHED after an inner RUN_ERROR"


# ---------------------------------------------------------------------------
# Bug 3: _run_reasoning_agent must buffer + flush TOOL_CALL_RESULT, not drop
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_reasoning_agent_forwards_tool_call_result(monkeypatch):
    """The reasoning agent has tools; a TOOL_CALL_RESULT from the inner stream
    must be flushed to the client, not silently dropped."""

    async def _fake_stream(*args, **kwargs):
        # Answer text, then a tool-call lifecycle including the RESULT.
        yield TextMessageContentEvent(
            type=EventType.TEXT_MESSAGE_CONTENT,
            message_id="m1",
            delta="here is the weather",
        )
        yield ToolCallResultEvent(
            type=EventType.TOOL_CALL_RESULT,
            message_id="m2",
            tool_call_id="call-1",
            content="sunny, 72F",
        )

    monkeypatch.setattr(
        agent_server, "async_stream_agno_response_as_agui_events", _fake_stream
    )

    class _RunInput:
        run_id = "r1"
        thread_id = "t1"
        messages = [UserMessage(id="u1", role="user", content="weather?")]
        forwarded_props = None
        state = None

    events = [
        ev async for ev in agent_server._run_reasoning_agent(_FakeAgent(), _RunInput())
    ]
    result_events = [e for e in events if e.type == EventType.TOOL_CALL_RESULT]
    assert result_events, (
        "TOOL_CALL_RESULT must be forwarded to the client, got types "
        f"{[e.type for e in events]}"
    )
    assert result_events[0].content == "sunny, 72F"


# ---------------------------------------------------------------------------
# Wiring: /reasoning/agui must be served by _attach_reasoning_route (which
# delegates to _run_reasoning_agent, emitting REASONING_MESSAGE_*), NOT by
# the stock AGUI interface (which emits STEP_STARTED/STEP_FINISHED). A stock
# mount would name the route differently and, worse, collide if both were
# present — so assert exactly one /reasoning/agui route and that it is the
# reasoning-aware one.
# ---------------------------------------------------------------------------


def test_reasoning_route_mounted_by_attach_reasoning_route():
    """`/reasoning/agui` is mounted exactly once, by `_attach_reasoning_route`.

    The custom mount names its route ``agui_reasoning_<prefix>`` (see
    ``_attach_reasoning_route``); the stock ``AGUI`` interface would not. This
    guards against a duplicate/colliding mount or a regression back to the
    stock STEP_* emitting interface.
    """
    app = agent_server.app

    reasoning_routes = [
        r for r in app.routes if getattr(r, "path", None) == "/reasoning/agui"
    ]
    assert len(reasoning_routes) == 1, (
        "exactly one /reasoning/agui route expected (no stock-AGUI collision), "
        f"got {[(r.path, r.name) for r in reasoning_routes]}"
    )
    route = reasoning_routes[0]
    assert route.name == "agui_reasoning_reasoning", (
        "/reasoning/agui must be served by _attach_reasoning_route "
        f"(name=agui_reasoning_reasoning), got name={route.name!r}"
    )
    assert "POST" in route.methods


@pytest.mark.asyncio
async def test_reasoning_route_handler_emits_reasoning_message(monkeypatch):
    """The handler mounted at /reasoning/agui must emit REASONING_MESSAGE_*.

    Drive the actual mounted route handler (not the bare coroutine) so the
    wiring from route -> _run_reasoning_agent is exercised end-to-end.
    """
    app = agent_server.app

    async def _fake_stream(*args, **kwargs):
        yield TextMessageContentEvent(
            type=EventType.TEXT_MESSAGE_CONTENT,
            message_id="m1",
            delta="<reasoning>think step by step</reasoning>the answer is 42",
        )

    monkeypatch.setattr(
        agent_server, "async_stream_agno_response_as_agui_events", _fake_stream
    )

    route = next(r for r in app.routes if getattr(r, "path", None) == "/reasoning/agui")

    run_input = RunAgentInput(
        thread_id="t1",
        run_id="r1",
        state={},
        messages=[UserMessage(id="u1", role="user", content="what is the answer?")],
        tools=[],
        context=[],
        forwarded_props={},
    )

    response = await route.endpoint(run_input)
    chunks = [chunk async for chunk in response.body_iterator]
    text = "".join(
        c.decode() if isinstance(c, (bytes, bytearray)) else c for c in chunks
    )

    assert "REASONING_MESSAGE_START" in text, (
        "the /reasoning/agui handler must emit REASONING_MESSAGE_* events; "
        f"got body: {text[:500]}"
    )
    assert "REASONING_MESSAGE_CONTENT" in text
    assert "STEP_STARTED" not in text, (
        "stock AGUI STEP_* events must NOT appear (would indicate the stock "
        "mount, not _attach_reasoning_route)"
    )


def _frontend_tool(name="browser_action"):
    return Tool(
        name=name,
        description="Runs in the browser",
        parameters={
            "type": "object",
            "properties": {"value": {"type": "string"}},
        },
    )


def test_no_frontend_tools_keeps_native_agent():
    native = Agent(tools=[Function(name="native_action")])
    assert agent_server._with_frontend_tools(native, []) is native


def test_frontend_tools_are_external_and_request_scoped():
    native = Agent(tools=[Function(name="native_action")])
    first = agent_server._with_frontend_tools(native, [_frontend_tool("first")])
    second = agent_server._with_frontend_tools(native, [_frontend_tool("second")])
    assert [tool.name for tool in native.tools] == ["native_action"]
    assert [tool.name for tool in first.tools] == ["native_action", "first"]
    assert [tool.name for tool in second.tools] == ["native_action", "second"]
    external = first.tools[-1]
    assert external.entrypoint is None
    assert external.external_execution is True
    assert external.parameters == _frontend_tool().parameters


def test_native_tool_collision_uses_sdk_first_registration_policy():
    native = Agent(model=OpenAIChat(), tools=[Function(name="browser_action")])
    request_agent = agent_server._with_frontend_tools(native, [_frontend_tool()])
    parsed = _tools.parse_tools(request_agent, request_agent.tools, request_agent.model)
    assert len(parsed) == 1
    assert parsed[0].name == "browser_action"
    assert not parsed[0].external_execution


@pytest.mark.asyncio
async def test_frontend_result_continues_once_with_paired_messages():
    calls = []

    class RecordingAgent(Agent):
        def arun(self, input, **kwargs):
            calls.append((input, kwargs))

            async def complete():
                yield RunCompletedEvent()

            return complete()

    native = RecordingAgent(tools=[Function(name="native_action")])
    run_input = RunAgentInput(
        thread_id="thread",
        run_id="continuation",
        state={},
        context=[],
        tools=[_frontend_tool("do_thing")],
        forwarded_props={},
        messages=[
            UserMessage(id="u", role="user", content="run browser action"),
            _assistant_with_tool_call("browser-call"),
            ToolMessage(
                id="result",
                role="tool",
                tool_call_id="browser-call",
                content="browser-result",
            ),
        ],
    )
    events = [
        event
        async for event in agent_server._run_main_agent_hitl_aware(native, run_input)
    ]
    assert len(calls) == 1
    messages, options = calls[0]
    assert options["add_history_to_context"] is False
    assert options["session_id"] == "thread"
    assert messages[-1].tool_call_id == "browser-call"
    assert messages[-1].content == "browser-result"
    assert messages[-2].tool_calls[0]["id"] == "browser-call"
    assert [tool.name for tool in native.tools] == ["native_action"]
    assert sum(event.type == EventType.RUN_FINISHED for event in events) == 1
