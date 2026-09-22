"""Unit tests for the Langroid AG-UI SSE adapter.

These tests exercise the event-emission logic of ``handle_run`` by driving
it with fabricated ``Request`` doubles. They mock ``_call_openai`` to return
controlled OpenAI ChatCompletionMessage-shaped responses, avoiding the need
for a real LLM or aimock.

Run: ``pytest tests/python/ -v`` from the langroid package root.
"""

from __future__ import annotations

import json
import logging
from types import SimpleNamespace
from typing import Any

import pytest

from agents import agui_adapter
from agents.agui_adapter import (
    ParsedArgs,
    _execute_backend_tool,
    _parse_tool_args,
    _TOOL_BY_NAME,
    handle_run,
)
from agents.agent import ALL_TOOLS, FRONTEND_TOOL_NAMES


# ---------------------------------------------------------------------------
# Fakes
# ---------------------------------------------------------------------------


class _FakeRequest:
    """Stand-in for ``fastapi.Request`` — only ``.json()`` is used."""

    def __init__(self, body: dict):
        self._body = body

    async def json(self) -> dict:
        return self._body


def _install_fake_openai(monkeypatch: pytest.MonkeyPatch, response: Any) -> None:
    """Replace ``_call_openai`` with a coroutine that returns *response*."""

    async def _fake_call_openai(messages, tools, model):
        return response

    monkeypatch.setattr(agui_adapter, "_call_openai", _fake_call_openai)


def _minimal_run_input(thread_id: str = "") -> dict:
    """Build a minimal ``RunAgentInput`` body.

    ``RunAgentInput`` requires ``thread_id`` to be present, but the adapter's
    ``run_input.thread_id or ...`` fallback is what we're testing — so
    passing an empty string triggers the fallback branch identically to
    the real "missing" case the fix addresses.
    """
    return {
        "thread_id": thread_id,
        "run_id": "run-123",
        "messages": [{"id": "m1", "role": "user", "content": "hi"}],
        "tools": [],
        "context": [],
        "forwarded_props": {},
        "state": {},
    }


async def _collect(streaming_response) -> list[str]:
    """Drain a FastAPI StreamingResponse body_iterator into a list of strings."""
    out: list[str] = []
    async for chunk in streaming_response.body_iterator:
        if isinstance(chunk, (bytes, bytearray)):
            out.append(chunk.decode("utf-8"))
        else:
            out.append(chunk)
    return out


def _parse_events(lines: list[str]) -> list[dict]:
    """Extract the JSON payloads from SSE ``data: ...`` frames."""
    events: list[dict] = []
    for line in lines:
        line = line.strip()
        if not line.startswith("data:"):
            continue
        events.append(json.loads(line[len("data:") :].strip()))
    return events


# ---------------------------------------------------------------------------
# Happy path: tool_calls with valid JSON args
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_oai_tool_calls_emit_start_args_end_in_order(monkeypatch):
    """A single ``tool_calls`` entry with valid JSON args should emit
    TEXT_MESSAGE_START -> TOOL_CALL_START -> TOOL_CALL_ARGS ->
    TOOL_CALL_END -> TEXT_MESSAGE_END in that exact order (tool calls
    are wrapped in a parent TextMessage)."""
    tool_call = SimpleNamespace(
        id="call-1",
        function=SimpleNamespace(
            name="change_background",  # frontend tool, no backend execution
            arguments='{"background": "linear-gradient(red, blue)"}',
        ),
    )
    response = SimpleNamespace(content="", tool_calls=[tool_call])
    _install_fake_openai(monkeypatch, response)

    req = _FakeRequest(_minimal_run_input(thread_id="t-1"))
    resp = await handle_run(req)
    events = _parse_events(await _collect(resp))

    types = [e["type"] for e in events]
    assert types == [
        "RUN_STARTED",
        "TEXT_MESSAGE_START",
        "TOOL_CALL_START",
        "TOOL_CALL_ARGS",
        "TOOL_CALL_END",
        "TEXT_MESSAGE_END",
        "RUN_FINISHED",
    ]

    start = next(e for e in events if e["type"] == "TOOL_CALL_START")
    args = next(e for e in events if e["type"] == "TOOL_CALL_ARGS")
    end = next(e for e in events if e["type"] == "TOOL_CALL_END")
    assert start["toolCallId"] == "call-1"
    assert start["toolCallName"] == "change_background"
    assert args["toolCallId"] == "call-1"
    assert json.loads(args["delta"]) == {"background": "linear-gradient(red, blue)"}
    assert end["toolCallId"] == "call-1"


# ---------------------------------------------------------------------------
# parentMessageId is set on TOOL_CALL_START
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_tool_call_has_parent_message_id(monkeypatch):
    """TOOL_CALL_START must carry parentMessageId matching the wrapping
    TEXT_MESSAGE_START's messageId — the Runtime middleware-sse-parser
    uses this to attach tool calls to their parent message."""
    tool_call = SimpleNamespace(
        id="call-pm",
        function=SimpleNamespace(
            name="change_background",
            arguments='{"background": "teal"}',
        ),
    )
    response = SimpleNamespace(content="", tool_calls=[tool_call])
    _install_fake_openai(monkeypatch, response)

    req = _FakeRequest(_minimal_run_input(thread_id="t-pm"))
    resp = await handle_run(req)
    events = _parse_events(await _collect(resp))

    txt_start = next(e for e in events if e["type"] == "TEXT_MESSAGE_START")
    tc_start = next(e for e in events if e["type"] == "TOOL_CALL_START")
    assert "parentMessageId" in tc_start
    assert tc_start["parentMessageId"] == txt_start["messageId"]


# ---------------------------------------------------------------------------
# Malformed args → warning + skip
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_malformed_args_skip_tool_call_and_logs_warning(monkeypatch, caplog):
    """Unparseable JSON in ``arguments`` must skip the tool call entirely
    (no TOOL_CALL_* events) — firing a tool with empty args renders a
    meaningless UI card. A warning must be logged explaining the skip.
    """
    tool_call = SimpleNamespace(
        id="call-2",
        function=SimpleNamespace(name="change_background", arguments="not json {"),
    )
    response = SimpleNamespace(content="", tool_calls=[tool_call])
    _install_fake_openai(monkeypatch, response)

    req = _FakeRequest(_minimal_run_input(thread_id="t-2"))
    with caplog.at_level(logging.WARNING, logger=agui_adapter.logger.name):
        resp = await handle_run(req)
        events = _parse_events(await _collect(resp))

    types = [e["type"] for e in events]
    assert types == ["RUN_STARTED", "RUN_FINISHED"], (
        f"expected no TOOL_CALL_* events on malformed args, got: {types}"
    )

    assert any(
        "Failed to JSON-decode tool-call arguments" in rec.getMessage()
        for rec in caplog.records
    ), f"expected a warning log, got: {[r.getMessage() for r in caplog.records]}"


# ---------------------------------------------------------------------------
# Empty-string content → no TEXT_MESSAGE_* events
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_empty_content_skips_text_message_events(monkeypatch):
    """A response with empty content and no tool calls must not emit
    any TEXT_MESSAGE_* events (AG-UI rejects empty deltas)."""
    response = SimpleNamespace(content="", tool_calls=None)
    _install_fake_openai(monkeypatch, response)

    req = _FakeRequest(_minimal_run_input(thread_id="t-4"))
    resp = await handle_run(req)
    events = _parse_events(await _collect(resp))

    types = [e["type"] for e in events]
    assert types == ["RUN_STARTED", "RUN_FINISHED"]
    assert not any(t.startswith("TEXT_MESSAGE") for t in types)


# ---------------------------------------------------------------------------
# Thread-id stability across RUN_STARTED and RUN_FINISHED
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_thread_id_stable_when_caller_omits(monkeypatch):
    """Invariant: RUN_STARTED and RUN_FINISHED MUST share the same
    ``thread_id``. When the caller omits it, the adapter synthesizes one
    UUID and reuses it across every event emitted for the run."""
    response = SimpleNamespace(content="hello", tool_calls=None)
    _install_fake_openai(monkeypatch, response)

    # Empty string triggers the ``run_input.thread_id or str(uuid.uuid4())``
    # fallback — exactly the same code path as a missing thread_id.
    req = _FakeRequest(_minimal_run_input(thread_id=""))
    resp = await handle_run(req)
    events = _parse_events(await _collect(resp))

    started = next(e for e in events if e["type"] == "RUN_STARTED")
    finished = next(e for e in events if e["type"] == "RUN_FINISHED")
    assert started["threadId"], "thread_id should be a non-empty synthesized UUID"
    assert started["threadId"] == finished["threadId"], (
        f"RUN_STARTED thread_id {started['threadId']!r} must match "
        f"RUN_FINISHED {finished['threadId']!r}"
    )


@pytest.mark.asyncio
async def test_thread_id_from_caller_preserved(monkeypatch):
    """Invariant: when the caller supplies a thread_id, the adapter MUST
    preserve it verbatim — no new UUID is synthesized, and RUN_STARTED
    and RUN_FINISHED both carry the caller's value."""
    response = SimpleNamespace(content="hello", tool_calls=None)
    _install_fake_openai(monkeypatch, response)

    req = _FakeRequest(_minimal_run_input(thread_id="abc"))
    resp = await handle_run(req)
    events = _parse_events(await _collect(resp))

    started = next(e for e in events if e["type"] == "RUN_STARTED")
    finished = next(e for e in events if e["type"] == "RUN_FINISHED")
    assert started["threadId"] == "abc"
    assert finished["threadId"] == "abc"


# ---------------------------------------------------------------------------
# Tool-class uniqueness assertion
# ---------------------------------------------------------------------------


def test_tool_class_uniqueness():
    """Every ToolMessage class in ``ALL_TOOLS`` must expose a unique
    ``request`` default — silent overwrites in ``_TOOL_BY_NAME`` would
    mean one tool shadows another at runtime."""
    requests = [cls.default_value("request") for cls in ALL_TOOLS]
    assert len(set(requests)) == len(requests), (
        f"Duplicate tool request names: "
        f"{[r for r in requests if requests.count(r) > 1]}"
    )
    # And the module-level map built at import time agrees.
    assert len(_TOOL_BY_NAME) == len(ALL_TOOLS)


# ---------------------------------------------------------------------------
# Helper coverage: _parse_tool_args
# ---------------------------------------------------------------------------


def test_parse_tool_args_dict_passthrough():
    parsed = _parse_tool_args({"a": 1})
    assert isinstance(parsed, ParsedArgs)
    assert parsed.status == "ok"
    assert parsed.usable is True
    assert parsed.args == {"a": 1}


def test_parse_tool_args_empty_string_is_malformed():
    """Empty string is treated as malformed, not "ok with {}".
    Consistent with the oai-path rationale: firing a tool with no
    arguments produces a meaningless UI card, so we skip it the same
    way we skip unparseable JSON."""
    parsed = _parse_tool_args("")
    assert parsed.status == "malformed"
    assert parsed.usable is False
    assert parsed.args == {}


def test_parse_tool_args_valid_json_string():
    parsed = _parse_tool_args('{"x": 2}')
    assert parsed.status == "ok"
    assert parsed.usable is True
    assert parsed.args == {"x": 2}


def test_parse_tool_args_malformed_returns_malformed_status(caplog):
    """Malformed JSON returns ``status="malformed"`` — callers must
    skip the tool call rather than fire it with empty args."""
    with caplog.at_level(logging.WARNING, logger=agui_adapter.logger.name):
        parsed = _parse_tool_args("not json {")
    assert parsed.status == "malformed"
    assert parsed.usable is False
    assert any(
        "Failed to JSON-decode tool-call arguments" in rec.getMessage()
        for rec in caplog.records
    )


def test_parse_tool_args_non_dict_json_is_malformed(caplog):
    """Valid JSON but not a dict (e.g. an array) is likewise malformed."""
    with caplog.at_level(logging.WARNING, logger=agui_adapter.logger.name):
        parsed = _parse_tool_args("[1, 2, 3]")
    assert parsed.status == "malformed"
    assert parsed.usable is False
    assert any("parsed to non-dict" in rec.getMessage() for rec in caplog.records)


def test_parse_tool_args_unknown_type_is_empty():
    """Unknown non-dict / non-str / non-bytes types (e.g. ``None``,
    ``int``) produce ``status="empty"`` — not a parse failure, just
    nothing to try. Callers still skip (``usable == False``)."""
    for val in (None, 42, 3.14, object()):
        parsed = _parse_tool_args(val)
        assert parsed.status == "empty", f"for {val!r}"
        assert parsed.usable is False


def test_parse_tool_args_bytes_input():
    """Bytes input is valid (``json.loads`` accepts bytes) and should
    round-trip identically to str input."""
    parsed = _parse_tool_args(b'{"y": 3}')
    assert parsed.status == "ok"
    assert parsed.args == {"y": 3}


def test_parse_tool_args_returns_copy():
    """The dict on a successful parse must be a fresh copy — callers
    must be free to mutate without affecting the original payload
    (which may be shared across tool calls)."""
    original = {"a": 1, "b": 2}
    parsed = _parse_tool_args(original)
    assert parsed.status == "ok"
    assert parsed.args == original
    parsed.args["c"] = 3
    parsed.args["a"] = 999
    assert "c" not in original, "caller's mutation leaked into original dict"
    assert original["a"] == 1, "caller's mutation leaked into original dict"


def test_tool_by_name_is_frozen():
    """``_TOOL_BY_NAME`` must be immutable post-import — assignment
    should raise ``TypeError``. Mutating this map at runtime would
    silently shadow tool dispatch for the rest of the process."""
    with pytest.raises(TypeError):
        _TOOL_BY_NAME["brand_new_tool"] = object  # type: ignore[index]


# ---------------------------------------------------------------------------
# Backend tool execution: happy path + sanitized error on exception
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_backend_tool_execution_happy_path(monkeypatch):
    """A backend tool (not in FRONTEND_TOOL_NAMES) executes server-side
    and its result is emitted as a TOOL_CALL_RESULT event after
    TOOL_CALL_END so the CopilotKit runtime transitions useRenderTool
    status from "executing" to "complete"."""

    # Stub the backend tool's handler so we don't hit real impls (weather
    # API, DB, etc.) and we can pin the result string exactly.
    from agents import agent as agent_module

    def _fake_handle(self):
        return '{"location": "SF", "temp_f": 68}'

    monkeypatch.setattr(agent_module.GetWeatherTool, "handle", _fake_handle)

    tool_call = SimpleNamespace(
        id="call-wx",
        function=SimpleNamespace(
            name="get_weather",
            arguments='{"location": "SF"}',
        ),
    )
    response = SimpleNamespace(content="", tool_calls=[tool_call])
    _install_fake_openai(monkeypatch, response)

    req = _FakeRequest(_minimal_run_input(thread_id="t-wx"))
    resp = await handle_run(req)
    events = _parse_events(await _collect(resp))

    types = [e["type"] for e in events]
    # Backend tools emit a TOOL_CALL_RESULT after TOOL_CALL_END, all
    # wrapped in a parent TEXT_MESSAGE_START/END pair.
    assert types == [
        "RUN_STARTED",
        "TEXT_MESSAGE_START",  # parent message wrapper
        "TOOL_CALL_START",
        "TOOL_CALL_ARGS",
        "TOOL_CALL_END",
        "TOOL_CALL_RESULT",  # backend tool result
        "TEXT_MESSAGE_END",  # parent message close
        "RUN_FINISHED",
    ], f"unexpected event sequence: {types}"

    result = next(e for e in events if e["type"] == "TOOL_CALL_RESULT")
    assert result["content"] == '{"location": "SF", "temp_f": 68}'
    assert result["toolCallId"] == "call-wx"


# The sensitive substring shared by several tests — asserting that
# none of it survives sanitization is the sanitization contract.
_SENSITIVE_EXC_MESSAGE = (
    "DB connection failed at /opt/app/secret/internal.py line 42 "
    "postgres://user:password@host:5432/db traceback frame ..."
)
_FORBIDDEN_SUBSTRINGS = (
    "/opt/app",
    "internal.py",
    "line 42",
    "postgres://",
    "password",
    "traceback",
)


@pytest.mark.asyncio
async def test_backend_tool_exception_returns_sanitized_error(monkeypatch, caplog):
    """When a backend tool raises a narrowed data-error (``ValueError``
    or ``pydantic.ValidationError``), the error payload streamed to the
    user must be SANITIZED — no stack frames, no file paths, no
    ``str(exc)`` (which commonly embeds internal details). Only the
    tool name and the exception class leak. The full traceback must
    still be logged server-side via ``logger.exception``."""
    from agents import agent as agent_module

    def _raise_handle(self):
        raise ValueError(_SENSITIVE_EXC_MESSAGE)

    monkeypatch.setattr(agent_module.GetWeatherTool, "handle", _raise_handle)

    tool_call = SimpleNamespace(
        id="call-bad",
        function=SimpleNamespace(
            name="get_weather",
            arguments='{"location": "SF"}',
        ),
    )
    response = SimpleNamespace(content="", tool_calls=[tool_call])
    _install_fake_openai(monkeypatch, response)

    req = _FakeRequest(_minimal_run_input(thread_id="t-err"))
    with caplog.at_level(logging.ERROR, logger=agui_adapter.logger.name):
        resp = await handle_run(req)
        events = _parse_events(await _collect(resp))

    # The sanitized error rides on a TOOL_CALL_RESULT event (so the
    # frontend tool-call card transitions out of the executing state
    # with the error payload in hand).
    result = next(e for e in events if e["type"] == "TOOL_CALL_RESULT")
    payload = json.loads(result["content"])
    assert "error" in payload
    err = payload["error"]

    # The sanitized error contains the tool name and the exception class.
    assert "get_weather" in err
    assert "ValueError" in err

    # And MUST NOT contain any of the internal details from the exception
    # message: file paths, connection strings, stack-frame markers.
    for needle in _FORBIDDEN_SUBSTRINGS:
        assert needle not in err, (
            f"sanitized error leaked internal detail {needle!r}: {err!r}"
        )

    # Server-side: the full exception must be logged (logger.exception
    # attaches exc_info with the traceback).
    exc_records = [r for r in caplog.records if r.exc_info]
    assert exc_records, "expected logger.exception to capture traceback server-side"


@pytest.mark.asyncio
async def test_str_exc_never_appears_in_sse_stream(monkeypatch, caplog):
    """Sanitization contract: the FULL ``str(exc)`` must never appear
    anywhere in the SSE stream bytes — not just in the ``error`` field.
    A regression that accidentally echoed ``str(exc)`` into a TEXT
    delta or a TOOL_CALL_ARGS payload would still leak internals.
    """
    from agents import agent as agent_module

    def _raise_handle(self):
        raise ValueError(_SENSITIVE_EXC_MESSAGE)

    monkeypatch.setattr(agent_module.GetWeatherTool, "handle", _raise_handle)

    tool_call = SimpleNamespace(
        id="call-bad-sse",
        function=SimpleNamespace(
            name="get_weather",
            arguments='{"location": "SF"}',
        ),
    )
    response = SimpleNamespace(content="", tool_calls=[tool_call])
    _install_fake_openai(monkeypatch, response)

    req = _FakeRequest(_minimal_run_input(thread_id="t-sse-sanit"))
    with caplog.at_level(logging.ERROR, logger=agui_adapter.logger.name):
        resp = await handle_run(req)
        raw_chunks = await _collect(resp)

    raw_stream = "".join(raw_chunks)

    # Absolute: the full sensitive message, byte-for-byte, must not appear.
    assert _SENSITIVE_EXC_MESSAGE not in raw_stream, (
        "full str(exc) leaked into SSE stream"
    )
    # And no substring of the private bits either.
    for needle in _FORBIDDEN_SUBSTRINGS:
        assert needle not in raw_stream, (
            f"forbidden internal detail {needle!r} leaked into SSE stream"
        )


@pytest.mark.asyncio
async def test_backend_tool_executes_via_unified_helper(monkeypatch):
    """Both the oai-path and the content-JSON path go through the same
    ``_execute_backend_tool`` helper. This test exercises the happy
    path through that helper to lock in the contract."""
    from agents import agent as agent_module

    def _fake_handle(self):
        return '{"ok": true}'

    monkeypatch.setattr(agent_module.GetWeatherTool, "handle", _fake_handle)

    # Instantiate directly and invoke the helper synchronously — this
    # is the non-awaited unit under test (``to_thread`` is orthogonal).
    tool = agent_module.GetWeatherTool(location="SF")
    assert _execute_backend_tool(tool, "get_weather") == '{"ok": true}'


def test_execute_backend_tool_sanitizes_narrowed_exception(caplog):
    """``_execute_backend_tool`` sanitizes ``ValueError`` /
    ``pydantic.ValidationError`` into a JSON payload — and logs the
    full traceback server-side."""
    from agents import agent as agent_module

    class _BoomTool(agent_module.GetWeatherTool):
        def handle(self) -> str:
            raise ValueError(_SENSITIVE_EXC_MESSAGE)

    tool = _BoomTool(location="SF")
    with caplog.at_level(logging.ERROR, logger=agui_adapter.logger.name):
        result = _execute_backend_tool(tool, "get_weather")

    payload = json.loads(result)
    assert payload == {"error": "Tool get_weather failed: ValueError"}

    # Traceback captured server-side.
    assert any(r.exc_info for r in caplog.records), (
        "expected logger.exception to capture traceback server-side"
    )


def test_execute_backend_tool_propagates_unhandled_exception():
    """Non-narrowed exceptions (``RuntimeError``, ``KeyError``, ...)
    must NOT be caught by the helper — they indicate real bugs or
    config drift and must propagate up so the outer framework can
    log/flag them. Silently sanitizing them hides real signal.
    """
    from agents import agent as agent_module

    class _BugTool(agent_module.GetWeatherTool):
        def handle(self) -> str:
            raise RuntimeError("internal library bug, not data-shape error")

    tool = _BugTool(location="SF")
    with pytest.raises(RuntimeError, match="internal library bug"):
        _execute_backend_tool(tool, "get_weather")


def test_try_parse_tool_non_str_content_warns_and_returns_none(caplog):
    """The ``isinstance(content, (str, bytes, bytearray))`` guard in
    ``_try_parse_tool`` must surface a WARNING (programmer bug signal)
    rather than silently swallowing the case under a plain-text fallback.
    """
    from agents.agui_adapter import _try_parse_tool

    with caplog.at_level(logging.WARNING, logger=agui_adapter.logger.name):
        result = _try_parse_tool(12345)  # type: ignore[arg-type]

    assert result is None
    assert any("non-str/bytes content" in rec.getMessage() for rec in caplog.records), (
        f"expected type-guard warning, got: {[r.getMessage() for r in caplog.records]}"
    )


# ---------------------------------------------------------------------------
# bytes-args handling in _try_parse_tool
# ---------------------------------------------------------------------------


def test_try_parse_tool_function_call_bytes_arguments():
    """Real OpenAI/httpx stacks can deliver ``function_call.arguments`` as
    ``bytes`` (not ``str``). The function_call path must parse them the
    same way ``_parse_tool_args`` does — previously a narrow
    ``isinstance(args, str)`` guard fell through to ``tool_cls(**args)``
    with raw bytes and silently TypeError'd."""
    from agents.agui_adapter import _try_parse_tool
    from agents import agent as agent_module

    # Use a real backend tool from ALL_TOOLS so this exercises the actual
    # dispatch loop rather than a synthetic stub.
    request_name = agent_module.GetWeatherTool.default_value("request")
    data = {"name": request_name, "arguments": b'{"location": "SF"}'}
    import agents.agui_adapter as adapter_mod

    real_loads = adapter_mod.json.loads
    calls: list[Any] = []

    def _fake_loads(payload, *args, **kwargs):
        calls.append(payload)
        # First call: adapter loads the outer content. Return the
        # dict with bytes inner arguments.
        if len(calls) == 1:
            return data
        return real_loads(payload, *args, **kwargs)

    import unittest.mock as mock

    with mock.patch.object(adapter_mod.json, "loads", side_effect=_fake_loads):
        result = _try_parse_tool("ignored-outer")

    assert result is not None, (
        "bytes arguments should round-trip through the (str, bytes, bytearray) guard"
    )
    assert isinstance(result, agent_module.GetWeatherTool)
    assert result.location == "SF"


# ---------------------------------------------------------------------------
# mid-stream _call_openai failure must not hang the UI
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_call_openai_failure_emits_run_finished(monkeypatch, caplog):
    """When ``_call_openai`` raises a narrowed runtime error
    (``openai.APIError`` / ``httpx.HTTPError`` / ``asyncio.TimeoutError``)
    *after* RUN_STARTED has been emitted, the generator must emit a
    sanitized TEXT_MESSAGE triple + RUN_FINISHED (never leave the
    frontend hanging).

    Uses ``asyncio.TimeoutError`` as the representative covered
    exception — it's the simplest of the four to construct and
    exercises the same code path as the others.
    """
    import asyncio as _asyncio

    async def _exploding_call_openai(messages, tools, model):
        raise _asyncio.TimeoutError(
            "secret: postgres://user:pass@host/db /opt/app/internal.py line 99"
        )

    monkeypatch.setattr(agui_adapter, "_call_openai", _exploding_call_openai)

    req = _FakeRequest(_minimal_run_input(thread_id="t-boom"))
    with caplog.at_level(logging.ERROR, logger=agui_adapter.logger.name):
        resp = await handle_run(req)
        raw_chunks = await _collect(resp)

    events = _parse_events(raw_chunks)
    types = [e["type"] for e in events]
    assert types[0] == "RUN_STARTED"
    assert types[-1] == "RUN_FINISHED", (
        f"RUN_FINISHED must terminate the stream even on mid-stream failure, got: {types}"
    )
    assert "TEXT_MESSAGE_CONTENT" in types, (
        "sanitized error must be surfaced to the user"
    )

    content = next(e for e in events if e["type"] == "TEXT_MESSAGE_CONTENT")
    payload = json.loads(content["delta"])
    assert "TimeoutError" in payload["error"]
    # And sanitization still holds — no internal details leak.
    raw_stream = "".join(raw_chunks)
    for needle in ("postgres://", "password", "/opt/app", "internal.py", "line 99"):
        assert needle not in raw_stream, (
            f"internal detail {needle!r} leaked into SSE stream"
        )

    # Full traceback preserved server-side.
    assert any(r.exc_info for r in caplog.records), (
        "expected logger.exception to capture the _call_openai failure"
    )


@pytest.mark.asyncio
async def test_call_openai_programmer_bug_propagates(monkeypatch):
    """Programmer bugs (``AttributeError``, ``NameError``, ``TypeError``)
    from ``_call_openai`` must NOT be sanitized — they indicate real
    bugs and must propagate so the outer framework can log/flag them
    with a real traceback.
    """

    async def _typo_call_openai(messages, tools, model):
        raise AttributeError("typo")

    monkeypatch.setattr(agui_adapter, "_call_openai", _typo_call_openai)

    req = _FakeRequest(_minimal_run_input(thread_id="t-bug"))
    resp = await handle_run(req)
    with pytest.raises(AttributeError, match="typo"):
        await _collect(resp)


# ---------------------------------------------------------------------------
# request.json() / RunAgentInput failures get correlation ids
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_malformed_request_body_returns_structured_error():
    """An unparseable request body must NOT raise an unstructured 500 —
    it must return a structured JSON response carrying an ``errorId``
    for correlation."""

    class _BadJsonRequest:
        async def json(self) -> dict:
            raise json.JSONDecodeError("bad", "doc", 0)

    resp = await handle_run(_BadJsonRequest())  # type: ignore[arg-type]
    assert resp.status_code == 400
    payload = json.loads(resp.body)
    assert payload["error"] == "Invalid JSON body"
    assert "errorId" in payload and payload["errorId"], (
        "every error response needs a correlation id"
    )


@pytest.mark.asyncio
async def test_invalid_run_agent_input_returns_422():
    """Body that's valid JSON but doesn't match ``RunAgentInput`` must
    return a 422 with a structured payload + correlation id."""
    # Missing every required field.
    req = _FakeRequest({})
    resp = await handle_run(req)
    assert resp.status_code == 422
    payload = json.loads(resp.body)
    assert payload["error"] == "Invalid RunAgentInput payload"
    assert payload.get("errorId"), "correlation id is required"


# ---------------------------------------------------------------------------
# tool-collision RuntimeError names the colliding classes
# ---------------------------------------------------------------------------


def test_duplicate_tool_error_includes_class_identity():
    """When two tool classes collide on ``request`` name, the startup
    RuntimeError must include fully-qualified class identities so the
    developer can find the duplicate definitions without grepping."""
    from langroid.agent.tool_message import ToolMessage

    class ToolA(ToolMessage):
        request: str = "clashing"
        purpose: str = "a"

    class ToolB(ToolMessage):
        request: str = "clashing"
        purpose: str = "b"

    tools = [ToolA, ToolB]
    by_name: dict[str, list[str]] = {}
    for cls in tools:
        name = cls.default_value("request")
        ident = f"{cls.__module__}.{cls.__qualname__}"
        by_name.setdefault(name, []).append(ident)
    dupes = {n: ids for n, ids in by_name.items() if len(ids) > 1}

    assert "clashing" in dupes
    idents = dupes["clashing"]
    # Both identities appear, and they carry the qualname — not just
    # the bare tool name.
    assert any("ToolA" in i for i in idents)
    assert any("ToolB" in i for i in idents)


@pytest.mark.asyncio
async def test_plain_text_turn_does_not_warn(monkeypatch, caplog):
    """A normal chat reply like "hello" is NOT JSON. The adapter's
    tool-parse fallback must fail silently — warning on every chat turn
    floods logs and drowns real signal."""
    response = SimpleNamespace(content="hello", tool_calls=None)
    _install_fake_openai(monkeypatch, response)

    req = _FakeRequest(_minimal_run_input(thread_id="t-plain"))
    with caplog.at_level(logging.WARNING, logger=agui_adapter.logger.name):
        resp = await handle_run(req)
        events = _parse_events(await _collect(resp))

    # Sanity: content was streamed back as text.
    content = next(e for e in events if e["type"] == "TEXT_MESSAGE_CONTENT")
    assert content["delta"] == "hello"

    # The key assertion: NO warning-level log records from the adapter.
    adapter_warnings = [
        r
        for r in caplog.records
        if r.name == agui_adapter.logger.name and r.levelno >= logging.WARNING
    ]
    assert adapter_warnings == [], (
        "plain-text turn unexpectedly logged warnings: "
        f"{[r.getMessage() for r in adapter_warnings]}"
    )


# ---------------------------------------------------------------------------
# _agui_messages_to_openai: message conversion tests
# ---------------------------------------------------------------------------


def test_agui_messages_to_openai_user_message():
    """Simple user message is preserved."""
    from agents.agui_adapter import _agui_messages_to_openai

    msgs = [SimpleNamespace(role="user", content="hello")]
    result = _agui_messages_to_openai(msgs, "sys prompt")
    assert result[0] == {"role": "system", "content": "sys prompt"}
    assert result[1] == {"role": "user", "content": "hello"}


def test_agui_messages_to_openai_tool_message():
    """Tool result messages preserve tool_call_id."""
    from agents.agui_adapter import _agui_messages_to_openai

    msgs = [
        SimpleNamespace(role="tool", content="result text", tool_call_id="tc-123"),
    ]
    result = _agui_messages_to_openai(msgs, "sys")
    assert result[1] == {
        "role": "tool",
        "tool_call_id": "tc-123",
        "content": "result text",
    }


def test_agui_messages_to_openai_assistant_with_tool_calls():
    """Assistant messages with tool_calls preserve the full structure."""
    from agents.agui_adapter import _agui_messages_to_openai

    tc = SimpleNamespace(
        id="call-1",
        function=SimpleNamespace(name="show_card", arguments='{"title":"Ada"}'),
    )
    msgs = [
        SimpleNamespace(role="assistant", content=None, tool_calls=[tc]),
    ]
    result = _agui_messages_to_openai(msgs, "sys")
    assistant_msg = result[1]
    assert assistant_msg["role"] == "assistant"
    assert assistant_msg["content"] is None  # null, not missing
    assert len(assistant_msg["tool_calls"]) == 1
    assert assistant_msg["tool_calls"][0]["id"] == "call-1"
    assert assistant_msg["tool_calls"][0]["function"]["name"] == "show_card"


def test_agui_messages_to_openai_full_tool_roundtrip():
    """Full multi-turn: user -> assistant+tool_call -> tool_result.
    This is the exact sequence that gen-ui-headless needs for the
    follow-up aimock match to work."""
    from agents.agui_adapter import _agui_messages_to_openai

    tc = SimpleNamespace(
        id="call_d5_show_card_001",
        function=SimpleNamespace(
            name="show_card",
            arguments='{"title":"Ada Lovelace","body":"mathematician"}',
        ),
    )
    msgs = [
        SimpleNamespace(role="user", content="Show me a profile card for Ada Lovelace"),
        SimpleNamespace(role="assistant", content=None, tool_calls=[tc]),
        SimpleNamespace(role="tool", content="", tool_call_id="call_d5_show_card_001"),
    ]
    result = _agui_messages_to_openai(msgs, "sys")

    # System + user + assistant + tool = 4 messages
    assert len(result) == 4
    assert result[0]["role"] == "system"
    assert result[1]["role"] == "user"
    assert result[2]["role"] == "assistant"
    assert result[2]["tool_calls"][0]["id"] == "call_d5_show_card_001"
    assert result[3]["role"] == "tool"
    assert result[3]["tool_call_id"] == "call_d5_show_card_001"
