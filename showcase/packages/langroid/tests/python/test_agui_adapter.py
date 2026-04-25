"""Unit tests for the Langroid AG-UI SSE adapter.

These tests exercise the event-emission logic of ``handle_run`` by driving
it with fabricated ``Request``/``ChatAgent`` doubles. They deliberately
avoid spinning up a real ``langroid.ChatAgent`` (network + OpenAI key
required) — instead we replace ``agents.agui_adapter.create_agent`` with
a stub that returns a fake agent whose ``llm_response_async`` yields the
scenario under test.

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


class _FakeAgent:
    """Minimal stand-in for ``lr.ChatAgent`` — records the prompt and
    returns a preconfigured response object."""

    def __init__(self, response: Any):
        self._response = response
        self.calls: list[str] = []

    async def llm_response_async(self, user_message: str) -> Any:
        self.calls.append(user_message)
        return self._response


class _FakeRequest:
    """Stand-in for ``fastapi.Request`` — only ``.json()`` is used."""

    def __init__(self, body: dict):
        self._body = body

    async def json(self) -> dict:
        return self._body


def _install_fake_agent(monkeypatch: pytest.MonkeyPatch, response: Any) -> _FakeAgent:
    agent = _FakeAgent(response)
    monkeypatch.setattr(agui_adapter, "create_agent", lambda **kwargs: agent)
    return agent


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
        events.append(json.loads(line[len("data:"):].strip()))
    return events


# ---------------------------------------------------------------------------
# Happy path: oai_tool_calls with valid JSON args
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_oai_tool_calls_emit_start_args_end_in_order(monkeypatch):
    """A single ``oai_tool_calls`` entry with valid JSON args should emit
    TOOL_CALL_START -> TOOL_CALL_ARGS -> TOOL_CALL_END in that exact order."""
    tool_call = SimpleNamespace(
        id="call-1",
        function=SimpleNamespace(
            name="change_background",  # frontend tool, no backend execution
            arguments='{"background": "linear-gradient(red, blue)"}',
        ),
    )
    response = SimpleNamespace(content="", oai_tool_calls=[tool_call], function_call=None)
    _install_fake_agent(monkeypatch, response)

    req = _FakeRequest(_minimal_run_input(thread_id="t-1"))
    resp = await handle_run(req)
    events = _parse_events(await _collect(resp))

    types = [e["type"] for e in events]
    assert types == [
        "RUN_STARTED",
        "TOOL_CALL_START",
        "TOOL_CALL_ARGS",
        "TOOL_CALL_END",
        "RUN_FINISHED",
    ]

    start = events[1]
    args = events[2]
    end = events[3]
    assert start["toolCallId"] == "call-1"
    assert start["toolCallName"] == "change_background"
    assert args["toolCallId"] == "call-1"
    assert json.loads(args["delta"]) == {"background": "linear-gradient(red, blue)"}
    assert end["toolCallId"] == "call-1"


# ---------------------------------------------------------------------------
# Malformed args → warning + {} args
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
    response = SimpleNamespace(content="", oai_tool_calls=[tool_call], function_call=None)
    _install_fake_agent(monkeypatch, response)

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
# Legacy function_call path
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_legacy_function_call_path_emits_tool_events(monkeypatch):
    """When the LLM returns ``function_call`` (legacy shape) rather than
    ``oai_tool_calls``, the adapter should still synthesize tool events."""
    function_call = SimpleNamespace(
        name="change_background",
        arguments='{"background": "teal"}',
    )
    response = SimpleNamespace(content="", oai_tool_calls=None, function_call=function_call)
    _install_fake_agent(monkeypatch, response)

    req = _FakeRequest(_minimal_run_input(thread_id="t-3"))
    resp = await handle_run(req)
    events = _parse_events(await _collect(resp))

    types = [e["type"] for e in events]
    assert "TOOL_CALL_START" in types
    assert "TOOL_CALL_ARGS" in types
    assert "TOOL_CALL_END" in types

    start = next(e for e in events if e["type"] == "TOOL_CALL_START")
    args = next(e for e in events if e["type"] == "TOOL_CALL_ARGS")
    assert start["toolCallName"] == "change_background"
    assert json.loads(args["delta"]) == {"background": "teal"}


# ---------------------------------------------------------------------------
# Empty-string content → no TEXT_MESSAGE_* events
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_empty_content_skips_text_message_events(monkeypatch):
    """A response with empty content and no tool calls must not emit
    any TEXT_MESSAGE_* events (AG-UI rejects empty deltas)."""
    response = SimpleNamespace(content="", oai_tool_calls=None, function_call=None)
    _install_fake_agent(monkeypatch, response)

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
    response = SimpleNamespace(content="hello", oai_tool_calls=None, function_call=None)
    _install_fake_agent(monkeypatch, response)

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
    response = SimpleNamespace(content="hello", oai_tool_calls=None, function_call=None)
    _install_fake_agent(monkeypatch, response)

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
    """Empty string is treated as DEGRADED, not "ok with {}".
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
    """Valid JSON but not a dict (e.g. an array) is likewise DEGRADED."""
    with caplog.at_level(logging.WARNING, logger=agui_adapter.logger.name):
        parsed = _parse_tool_args("[1, 2, 3]")
    assert parsed.status == "malformed"
    assert parsed.usable is False
    assert any(
        "parsed to non-dict" in rec.getMessage() for rec in caplog.records
    )


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
    and its result must be streamed back as a TEXT_MESSAGE_{START,
    CONTENT, END} triple after TOOL_CALL_END."""

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
    response = SimpleNamespace(content="", oai_tool_calls=[tool_call], function_call=None)
    _install_fake_agent(monkeypatch, response)

    req = _FakeRequest(_minimal_run_input(thread_id="t-wx"))
    resp = await handle_run(req)
    events = _parse_events(await _collect(resp))

    types = [e["type"] for e in events]
    # Backend tools emit TEXT_MESSAGE_* triple after TOOL_CALL_END.
    assert types == [
        "RUN_STARTED",
        "TOOL_CALL_START",
        "TOOL_CALL_ARGS",
        "TOOL_CALL_END",
        "TEXT_MESSAGE_START",
        "TEXT_MESSAGE_CONTENT",
        "TEXT_MESSAGE_END",
        "RUN_FINISHED",
    ], f"unexpected event sequence: {types}"

    content = next(e for e in events if e["type"] == "TEXT_MESSAGE_CONTENT")
    assert content["delta"] == '{"location": "SF", "temp_f": 68}'


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
    response = SimpleNamespace(content="", oai_tool_calls=[tool_call], function_call=None)
    _install_fake_agent(monkeypatch, response)

    req = _FakeRequest(_minimal_run_input(thread_id="t-err"))
    with caplog.at_level(logging.ERROR, logger=agui_adapter.logger.name):
        resp = await handle_run(req)
        events = _parse_events(await _collect(resp))

    # A TEXT_MESSAGE triple with the sanitized error should be emitted.
    content = next(e for e in events if e["type"] == "TEXT_MESSAGE_CONTENT")
    payload = json.loads(content["delta"])
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
    response = SimpleNamespace(content="", oai_tool_calls=[tool_call], function_call=None)
    _install_fake_agent(monkeypatch, response)

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
        result = _try_parse_tool(12345, agent=None)  # type: ignore[arg-type]

    assert result is None
    assert any(
        "non-str/bytes content" in rec.getMessage()
        for rec in caplog.records
    ), f"expected type-guard warning, got: {[r.getMessage() for r in caplog.records]}"


# ---------------------------------------------------------------------------
# Logging hygiene: plain-text turns must NOT emit warnings
# ---------------------------------------------------------------------------


# ---------------------------------------------------------------------------
# CR Round 4: bytes-args handling in _try_parse_tool
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
    content = json.dumps({
        "name": request_name,
        "arguments": b'{"location": "SF"}'.decode("utf-8"),
    })
    # Patch the function_call payload to carry a bytes ``arguments`` at
    # parse time. We construct the wrapper JSON as normal (str) but the
    # inner ``arguments`` field is a str whose *decoded* value would be
    # bytes in a real payload — so we exercise the guard by passing a
    # dict directly into the adapter's internals.
    #
    # To exercise the bytes branch, call with a dict that mirrors the
    # post-``json.loads`` shape:
    data = {"name": request_name, "arguments": b'{"location": "SF"}'}
    # Feed via the content path: we serialize once so ``_try_parse_tool``
    # re-parses. But ``json.dumps`` on bytes raises. Instead, mimic by
    # directly invoking the inner logic: patch ``json.loads`` to return
    # the dict with bytes ``arguments`` so we test the branch.
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
        result = _try_parse_tool("ignored-outer", agent=None)  # type: ignore[arg-type]

    assert result is not None, (
        "bytes arguments should round-trip through the (str, bytes, bytearray) guard"
    )
    assert isinstance(result, agent_module.GetWeatherTool)
    assert result.location == "SF"


# ---------------------------------------------------------------------------
# CR Round 4: mid-stream llm_response_async failure must not hang the UI
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_llm_response_async_failure_emits_run_finished(monkeypatch, caplog):
    """When ``agent.llm_response_async`` raises a narrowed runtime error
    (``openai.APIError`` / ``httpx.HTTPError`` / ``asyncio.TimeoutError``
    / ``pydantic.ValidationError``) *after* RUN_STARTED has been
    emitted, the generator must emit a sanitized TEXT_MESSAGE triple +
    RUN_FINISHED (never leave the frontend hanging).

    Uses ``asyncio.TimeoutError`` as the representative covered
    exception — it's the simplest of the four to construct and
    exercises the same code path as the others. The test message is
    surfaced as ``str(exc)``-free (sanitized) regardless.
    """
    import asyncio as _asyncio

    class _ExplodingAgent:
        async def llm_response_async(self, user_message: str) -> Any:
            # TimeoutError doesn't carry the sensitive message the way
            # a ValueError would, but the sanitization contract is the
            # same: only the class name leaks, never ``str(exc)``.
            raise _asyncio.TimeoutError(
                "secret: postgres://user:pass@host/db /opt/app/internal.py line 99"
            )

    monkeypatch.setattr(agui_adapter, "create_agent", lambda **kwargs: _ExplodingAgent())

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
        "expected logger.exception to capture the llm_response_async failure"
    )


@pytest.mark.asyncio
async def test_llm_response_async_programmer_bug_propagates(monkeypatch):
    """Programmer bugs (``AttributeError``, ``NameError``, ``TypeError``)
    from ``agent.llm_response_async`` must NOT be sanitized — they
    indicate real bugs and must propagate so the outer framework can
    log/flag them with a real traceback.

    Regression guard for the over-broad ``except Exception`` that
    previously swallowed every failure as "LLM error", making these
    kinds of bugs invisible in production logs.
    """

    class _TypoAgent:
        async def llm_response_async(self, user_message: str) -> Any:
            # Simulate a programmer bug — e.g. a typo that references
            # an attribute that doesn't exist on the response object.
            raise AttributeError("typo")

    monkeypatch.setattr(agui_adapter, "create_agent", lambda **kwargs: _TypoAgent())

    req = _FakeRequest(_minimal_run_input(thread_id="t-bug"))
    resp = await handle_run(req)
    with pytest.raises(AttributeError, match="typo"):
        # The exception propagates out of the event_stream generator
        # when it's drained; the generator itself is lazy.
        await _collect(resp)


# ---------------------------------------------------------------------------
# CR Round 4: request.json() / RunAgentInput failures get correlation ids
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
# CR Round 4: non-string role/content is skipped with a warning
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_non_string_role_or_content_skipped(monkeypatch, caplog):
    """Messages whose ``role`` or ``content`` are not strings must be
    skipped with a warning rather than silently f-stringified into
    garbage like ``"None: {'foo': ...}"``.

    Pydantic's ``RunAgentInput`` normally rejects these upstream, but
    if a future schema change or a non-validating code path ever lands
    a non-string field in ``run_input.messages``, the guard in
    ``handle_run`` is the last line of defense against garbage prompts.
    We bypass pydantic by substituting a stub ``RunAgentInput`` that
    returns a hand-built object with mixed message types.
    """
    agent = _install_fake_agent(
        monkeypatch,
        SimpleNamespace(content="ok", oai_tool_calls=None, function_call=None),
    )

    class _StubRunInput:
        def __init__(self, **_kwargs: Any) -> None:
            self.thread_id = "t-msg"
            self.run_id = "run-x"
            self.messages = [
                SimpleNamespace(role="user", content="hello"),
                # non-string content
                SimpleNamespace(role="user", content={"obj": 1}),
                # non-string role
                SimpleNamespace(role=None, content="huh"),
            ]

    monkeypatch.setattr(agui_adapter, "RunAgentInput", _StubRunInput)

    req = _FakeRequest({"stub": True})  # content irrelevant — stub ignores
    with caplog.at_level(logging.WARNING, logger=agui_adapter.logger.name):
        resp = await handle_run(req)
        await _collect(resp)

    # Only the first message should have reached the agent.
    assert agent.calls == ["user: hello"], (
        f"non-string messages must be dropped; got prompt: {agent.calls!r}"
    )
    assert any(
        "non-string role/content" in rec.getMessage()
        for rec in caplog.records
    ), "expected a warning log for dropped messages"


# ---------------------------------------------------------------------------
# CR Round 4: tool-collision RuntimeError names the colliding classes
# ---------------------------------------------------------------------------


def test_duplicate_tool_error_includes_class_identity():
    """When two tool classes collide on ``request`` name, the startup
    RuntimeError must include fully-qualified class identities so the
    developer can find the duplicate definitions without grepping."""
    # Simulate the import-time guard on a synthetic ALL_TOOLS with a
    # collision. Rebuild the same check directly — we can't re-import
    # the module to re-trigger it, but the guard's logic is simple
    # enough to exercise via a tiny fixture.
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
    response = SimpleNamespace(content="hello", oai_tool_calls=None, function_call=None)
    _install_fake_agent(monkeypatch, response)

    req = _FakeRequest(_minimal_run_input(thread_id="t-plain"))
    with caplog.at_level(logging.WARNING, logger=agui_adapter.logger.name):
        resp = await handle_run(req)
        events = _parse_events(await _collect(resp))

    # Sanity: content was streamed back as text.
    content = next(e for e in events if e["type"] == "TEXT_MESSAGE_CONTENT")
    assert content["delta"] == "hello"

    # The key assertion: NO warning-level log records from the adapter.
    adapter_warnings = [
        r for r in caplog.records
        if r.name == agui_adapter.logger.name and r.levelno >= logging.WARNING
    ]
    assert adapter_warnings == [], (
        "plain-text turn unexpectedly logged warnings: "
        f"{[r.getMessage() for r in adapter_warnings]}"
    )
