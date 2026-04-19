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
from agents.agui_adapter import _parse_tool_args, _TOOL_BY_NAME, handle_run
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
    monkeypatch.setattr(agui_adapter, "create_agent", lambda: agent)
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
    assert _parse_tool_args({"a": 1}) == {"a": 1}


def test_parse_tool_args_empty_string():
    assert _parse_tool_args("") == {}


def test_parse_tool_args_valid_json_string():
    assert _parse_tool_args('{"x": 2}') == {"x": 2}


def test_parse_tool_args_malformed_returns_none(caplog):
    """Malformed JSON returns ``None`` (DEGRADED) — callers must skip
    the tool call rather than fire it with empty args."""
    with caplog.at_level(logging.WARNING, logger=agui_adapter.logger.name):
        assert _parse_tool_args("not json {") is None
    assert any(
        "Failed to JSON-decode tool-call arguments" in rec.getMessage()
        for rec in caplog.records
    )


def test_parse_tool_args_non_dict_json_returns_none(caplog):
    """Valid JSON but not a dict (e.g. an array) is likewise DEGRADED."""
    with caplog.at_level(logging.WARNING, logger=agui_adapter.logger.name):
        assert _parse_tool_args("[1, 2, 3]") is None
    assert any(
        "parsed to non-dict" in rec.getMessage() for rec in caplog.records
    )


def test_parse_tool_args_returns_copy():
    """The dict returned by ``_parse_tool_args`` must be a fresh copy —
    callers must be free to mutate without affecting the original
    payload (which may be shared across tool calls)."""
    original = {"a": 1, "b": 2}
    returned = _parse_tool_args(original)
    assert returned == original
    returned["c"] = 3
    returned["a"] = 999
    assert "c" not in original, "caller's mutation leaked into original dict"
    assert original["a"] == 1, "caller's mutation leaked into original dict"


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


@pytest.mark.asyncio
async def test_backend_tool_exception_returns_sanitized_error(monkeypatch, caplog):
    """When a backend tool raises, the error payload streamed to the
    user must be SANITIZED — no stack frames, no file paths, no
    ``str(exc)`` (which commonly embeds internal details). Only the
    tool name and the exception class leak. The full traceback must
    still be logged server-side via ``logger.exception``."""
    from agents import agent as agent_module

    def _raise_handle(self):
        raise RuntimeError(
            "DB connection failed at /opt/app/secret/internal.py line 42 "
            "postgres://user:password@host:5432/db traceback frame ..."
        )

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
    assert "RuntimeError" in err

    # And MUST NOT contain any of the internal details from the exception
    # message: file paths, connection strings, stack-frame markers.
    forbidden = [
        "/opt/app",
        "internal.py",
        "line 42",
        "postgres://",
        "password",
        "traceback",
    ]
    for needle in forbidden:
        assert needle not in err, (
            f"sanitized error leaked internal detail {needle!r}: {err!r}"
        )

    # Server-side: the full exception must be logged (logger.exception
    # attaches exc_info with the traceback).
    exc_records = [r for r in caplog.records if r.exc_info]
    assert exc_records, "expected logger.exception to capture traceback server-side"


# ---------------------------------------------------------------------------
# Logging hygiene: plain-text turns must NOT emit warnings
# ---------------------------------------------------------------------------


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
