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

import sys
from pathlib import Path

import pytest
from ag_ui.core import (
    EventType,
    RunErrorEvent,
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

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "src"))


def _import_agent_server():
    """Import ``agent_server`` lazily inside a test.

    Importing the module runs ``install_executor_contextvar_propagation()``
    which PERMANENTLY monkeypatches the event loop's ``run_in_executor``.
    The autouse ``conftest`` fixture snapshots/restores that patch around
    every test, so deferring the import to call time (rather than module
    collection time) keeps the executor-ctxvar RED tests order-independent.
    """
    import agent_server

    return agent_server


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
    agent_server = _import_agent_server()
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
    agent_server = _import_agent_server()
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
    agent_server = _import_agent_server()
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
    agent_server = _import_agent_server()
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
    agent_server = _import_agent_server()
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
    agent_server = _import_agent_server()

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
    agent_server = _import_agent_server()

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
    agent_server = _import_agent_server()
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
    agent_server = _import_agent_server()
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

    from ag_ui.core import RunAgentInput

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
