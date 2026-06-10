"""Red-green tests pinning the reasoning agent's mid-stream error path.

Background — the behavioral change these tests pin down
-------------------------------------------------------
`_run_reasoning_agent` (in `src/agents/reasoning_agent.py`) streams a single
OpenAI chat-completions call and synthesizes AG-UI REASONING_MESSAGE_* /
TEXT_MESSAGE_* frames. A recent fix hardened the *failure* path: when the
streaming call raises mid-stream, the generator now must

  (i)   close any open REASONING_MESSAGE / TEXT_MESSAGE frame with the
        matching *_END event BEFORE the terminal error,
  (ii)  emit a GENERIC `RunErrorEvent`
        (`agent run failed: <ExcType> (see server logs)`) — never the raw
        `str(exc)` (which can leak provider URLs / request details), and
  (iii) NOT emit a `RunFinishedEvent` after `RUN_ERROR` (RUN_ERROR is
        terminal; @ag-ui/client's verifyEvents rejects ANY event after it),
  (iv)  log the traceback to stderr.

`except asyncio.CancelledError: raise` is preserved so task cancellation
propagates cleanly (it must NOT be converted into a RUN_ERROR).

This module drives `_run_reasoning_agent` directly with a stubbed streaming
client that yields a couple of reasoning/content deltas then raises
`RuntimeError` mid-stream, and asserts the emitted event sequence. The OpenAI
client is the only heavy dependency in the LLM call path; we monkeypatch
`reasoning_agent.openai.AsyncOpenAI` so no network / real key is touched.
"""

from __future__ import annotations

import asyncio
import importlib
import sys
from types import SimpleNamespace
from typing import Any

import pytest
from ag_ui.core import EventType, RunAgentInput


@pytest.fixture(autouse=True)
def _real_reasoning_agent():
    """Guarantee the REAL `agents.reasoning_agent` is loaded.

    `test_forwarded_props.py` installs (and intentionally leaves) stub
    modules in `sys.modules` for `agents.*` — including a bare
    `agents.reasoning_agent` with no `_run_reasoning_agent` — so any prior run
    of that file in the same pytest process poisons our import. Purge the
    `agents` package + reasoning stub and re-import from source (`pythonpath =
    src` makes the real package importable). Restore nothing on teardown: the
    sibling file re-installs its own stubs in its own autouse fixture.
    """
    for name in list(sys.modules):
        if name == "agents" or name.startswith("agents."):
            sys.modules.pop(name, None)
    importlib.import_module("agents.reasoning_agent")
    yield


# --------------------------------------------------------------------------- #
# Stub plumbing: a fake OpenAI AsyncOpenAI whose streaming `create` yields a   #
# caller-supplied sequence of chunks/exceptions.                              #
# --------------------------------------------------------------------------- #


def _chunk(content: str | None = None, reasoning: str | None = None):
    """Build an object shaped like an OpenAI streaming chunk.

    The source reads `chunk.choices[0].delta`, `delta.reasoning_content`, and
    `delta.content`. Mirror exactly that surface.
    """
    delta = SimpleNamespace(content=content, reasoning_content=reasoning)
    return SimpleNamespace(choices=[SimpleNamespace(delta=delta)])


class _RaisingStream:
    """Async-iterable stream that yields a script of chunks, then raises.

    Each element of `script` is either a chunk object (yielded) or an
    exception instance (raised at that point in iteration). This lets a test
    interleave a few content/reasoning deltas before a mid-stream failure.
    """

    def __init__(self, script: list[Any]):
        self._script = list(script)

    def __aiter__(self):
        return self

    async def __anext__(self):
        if not self._script:
            raise StopAsyncIteration
        item = self._script.pop(0)
        if isinstance(item, BaseException):
            raise item
        return item


class _FakeAsyncOpenAI:
    """Drop-in for `openai.AsyncOpenAI()` returning a scripted stream."""

    def __init__(self, script: list[Any]):
        script_ref = script

        class _Completions:
            async def create(self, *args, **kwargs):
                return _RaisingStream(list(script_ref))

        self.chat = SimpleNamespace(completions=_Completions())


@pytest.fixture
def patch_openai(monkeypatch):
    """Return a setter that installs a `_FakeAsyncOpenAI` with a given script
    onto the reasoning module's `openai.AsyncOpenAI` factory."""
    from agents import reasoning_agent

    def _install(script: list[Any]):
        monkeypatch.setattr(
            reasoning_agent.openai,
            "AsyncOpenAI",
            lambda *a, **k: _FakeAsyncOpenAI(script),
        )

    return _install


def _run_input() -> RunAgentInput:
    """Minimal valid RunAgentInput with a single user message."""
    return RunAgentInput(
        thread_id="t1",
        run_id="r1",
        state={},
        messages=[{"id": "m1", "role": "user", "content": "hello"}],
        tools=[],
        context=[],
        forwarded_props={},
    )


async def _collect(gen) -> list:
    """Drain an async generator of events into a list."""
    out = []
    async for ev in gen:
        out.append(ev)
    return out


# --------------------------------------------------------------------------- #
# Tests                                                                        #
# --------------------------------------------------------------------------- #


@pytest.mark.anyio
async def test_midstream_failure_closes_open_frame_then_generic_run_error(
    patch_openai,
):
    """RuntimeError mid-stream AFTER deltas accumulated.

    The deltas carry reasoning + answer text, so by the time we'd emit frames
    the generator must surface RUN_STARTED, then on the raised RuntimeError
    emit the terminal RUN_ERROR. Asserts:
      - any opened frame is closed with its *_END BEFORE RUN_ERROR,
      - RUN_ERROR message is the generic form (no raw exception text),
      - NO RUN_FINISHED follows RUN_ERROR.

    NB: the failure here is raised *during stream consumption* (before any
    frame is opened, since frames are emitted only after the stream fully
    drains). The dedicated "frame already open" close-ordering invariant is
    pinned structurally below; this case pins the START→ERROR happy/terminal
    shape and the generic-message contract.
    """
    from agents.reasoning_agent import _run_reasoning_agent

    boom = RuntimeError("super-secret-provider-url.example.com/v1 boom")
    patch_openai(
        [
            _chunk(reasoning="thinking a bit "),
            _chunk(content="partial answer "),
            boom,
        ]
    )

    events = await _collect(_run_reasoning_agent(_run_input()))
    types = [e.type for e in events]

    assert types[0] == EventType.RUN_STARTED
    assert EventType.RUN_ERROR in types, types
    # Terminal: RUN_ERROR is last, no RUN_FINISHED after it.
    assert types[-1] == EventType.RUN_ERROR, types
    assert EventType.RUN_FINISHED not in types, types

    err = events[-1]
    # Generic message — exact contracted form, and crucially NO raw exc text.
    assert err.message == "agent run failed: RuntimeError (see server logs)"
    assert "super-secret-provider-url" not in err.message
    assert "boom" not in err.message


@pytest.mark.anyio
async def test_failure_before_any_frame_emits_only_started_then_error(
    patch_openai,
):
    """Exception BEFORE any frame opens (raised on the very first stream
    poll) → exactly RUN_STARTED then RUN_ERROR, nothing in between, no
    RUN_FINISHED."""
    from agents.reasoning_agent import _run_reasoning_agent

    patch_openai([RuntimeError("early failure")])

    events = await _collect(_run_reasoning_agent(_run_input()))
    types = [e.type for e in events]

    assert types == [EventType.RUN_STARTED, EventType.RUN_ERROR], types
    assert events[-1].message == "agent run failed: RuntimeError (see server logs)"


@pytest.mark.anyio
async def test_cancellederror_propagates_without_run_error(patch_openai):
    """`asyncio.CancelledError` raised mid-stream MUST propagate (the
    `except asyncio.CancelledError: raise` arm), NOT be converted into a
    RUN_ERROR. We collect events until cancellation surfaces and assert no
    RUN_ERROR was emitted before the CancelledError escaped."""
    from agents.reasoning_agent import _run_reasoning_agent

    patch_openai([_chunk(content="x"), asyncio.CancelledError()])

    collected: list = []
    with pytest.raises(asyncio.CancelledError):
        async for ev in _run_reasoning_agent(_run_input()):
            collected.append(ev)

    types = [e.type for e in collected]
    assert EventType.RUN_ERROR not in types, types
    assert EventType.RUN_FINISHED not in types, types


@pytest.mark.anyio
async def test_open_text_frame_closed_with_end_before_run_error(
    patch_openai, monkeypatch
):
    """Close-ordering invariant (the except-block frame-close branch): when a
    TEXT_MESSAGE frame is OPEN at the moment of failure, the generator must
    emit TEXT_MESSAGE_END to close it BEFORE the terminal RUN_ERROR.

    Frames are only opened after the stream fully drains, so to fail with a
    frame genuinely open we let the stream drain cleanly with answer-only
    content (no reasoning, so only the text frame is in play), then force the
    failure DURING text-frame emission: TEXT_MESSAGE_START is yielded
    (`text_msg_id` set), then constructing the TEXT_MESSAGE_CONTENT event
    raises. The except handler must see `text_msg_id is not None` and emit
    TEXT_MESSAGE_END before RUN_ERROR — the exact behavior the fix added.
    """
    from agents import reasoning_agent
    from agents.reasoning_agent import _run_reasoning_agent

    # Answer-only stream: drains cleanly, opens only the text frame.
    patch_openai([_chunk(content="the answer")])

    # Make the CONTENT event constructor blow up so the failure lands AFTER
    # TEXT_MESSAGE_START (frame open) but BEFORE TEXT_MESSAGE_END.
    def _boom(*args, **kwargs):
        raise RuntimeError("content event boom")

    monkeypatch.setattr(reasoning_agent, "TextMessageContentEvent", _boom)

    events = await _collect(_run_reasoning_agent(_run_input()))
    types = [e.type for e in events]

    # Text frame opened (START emitted before the failure)...
    assert EventType.TEXT_MESSAGE_START in types, types
    # ...and its END must close it BEFORE the terminal RUN_ERROR.
    end_idx = types.index(EventType.TEXT_MESSAGE_END)
    err_idx = types.index(EventType.RUN_ERROR)
    assert end_idx < err_idx, (
        f"TEXT_MESSAGE_END must close the open frame BEFORE RUN_ERROR; got {types}"
    )
    # Terminal RUN_ERROR, generic message, no RUN_FINISHED.
    assert types[-1] == EventType.RUN_ERROR, types
    assert EventType.RUN_FINISHED not in types, types
    assert events[-1].message == "agent run failed: RuntimeError (see server logs)"


@pytest.fixture
def anyio_backend():
    return "asyncio"
