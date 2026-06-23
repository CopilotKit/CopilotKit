"""Red→green tests for the agno backend CVDIAG boundary instrumentation.

Exercises the REAL emit surface — every assertion reads the actual
``CVDIAG {<json>}`` lines that ``_shared.cvdiag_bootstrap.emit_cvdiag`` writes
to stdout (captured via ``capsys``), driven through the real
``CvdiagBackendMiddleware`` and the real ``LlmCallScope`` / agent helpers. No
mocks of the emit path.

What's covered (spec §3 / §5 / §6):
  * All 11 backend boundaries emit to stdout across the three request shapes
    that collectively exercise them (happy streaming, aborted stream, raised
    exception) for synthetic requests with ``CVDIAG_BACKEND_EMITTER=1`` (run at
    DEBUG tier so the verbose+debug boundaries are permitted).
  * PII scrub: a synthetic ``sk-test-12345`` in an exception message never
    appears in the emitted ``backend.error.caught`` JSON.
  * Heartbeat fires within ~12s of a slow-LLM simulation.
  * Default-OFF: with the flag unset, NO CVDIAG backend line is emitted.

RED before instrumentation: ``agents._cvdiag_backend`` does not exist →
ImportError; the 11-boundary / heartbeat / scrub assertions cannot pass.
GREEN after: every boundary, the scrub, and the heartbeat assert true.
"""

from __future__ import annotations

import asyncio
import json
from typing import Dict, List

import pytest
from starlette.applications import Starlette
from starlette.responses import StreamingResponse
from starlette.routing import Route
from starlette.testclient import TestClient

from agents._cvdiag_backend import (
    CvdiagBackendMiddleware,
    LlmCallScope,
    _RequestCtx,
    emit_agent_enter,
    emit_agent_exit,
    scrub,
)

# The 11 backend boundaries (spec §5).
ALL_BACKEND_BOUNDARIES = {
    "backend.request.ingress",
    "backend.agent.enter",
    "backend.llm.call.start",
    "backend.llm.call.heartbeat",
    "backend.llm.call.response",
    "backend.sse.first_byte",
    "backend.sse.event",
    "backend.sse.aborted",
    "backend.agent.exit",
    "backend.response.complete",
    "backend.error.caught",
}

VALID_TEST_ID = "0190a9c0-1a2b-7c3d-8e4f-5a6b7c8d9e0f"


def _parse_cvdiag_lines(captured: str) -> List[Dict]:
    """Extract every ``CVDIAG {<json>}`` envelope line from captured stdout."""
    out: List[Dict] = []
    for line in captured.splitlines():
        if line.startswith("CVDIAG {"):
            out.append(json.loads(line[len("CVDIAG ") :]))
    return out


def _boundaries(envelopes: List[Dict]) -> set:
    return {e["boundary"] for e in envelopes}


@pytest.fixture(autouse=True)
def _debug_tier(monkeypatch):
    """Run each test at DEBUG tier so verbose+debug boundaries are permitted.

    ``current_tier()`` is resolved once at bootstrap import; re-resolve it under
    a non-production env with ``CVDIAG_DEBUG=1`` so the §6 matrix lets
    ``backend.sse.event`` (debug) and the verbose LLM boundaries through.
    """
    import _shared.cvdiag_bootstrap as bootstrap

    monkeypatch.setenv("SHOWCASE_ENV", "test")
    monkeypatch.setenv("CVDIAG_DEBUG", "1")
    bootstrap.setup({"SHOWCASE_ENV": "test", "CVDIAG_DEBUG": "1"})
    yield
    bootstrap.setup({"SHOWCASE_ENV": "test"})


def _make_client(*, raise_server_exceptions: bool = True) -> TestClient:
    """An app exposing three routes — happy stream, aborted stream, raise — each
    wrapped by the CVDIAG middleware. The endpoints emit the agent/LLM
    boundaries the middleware cannot observe, all keyed on the per-request ctx.
    """

    async def happy_stream(request):
        ctx = getattr(request.state, "cvdiag", None)
        if ctx is not None:
            emit_agent_enter(ctx, agent_name="showcase", model_id="gpt-4o-mini")

        async def gen():
            if ctx is not None:
                async with LlmCallScope(
                    ctx, provider="openai", model="gpt-4o-mini", interval_s=0.02
                ):
                    await asyncio.sleep(0.05)  # let the heartbeat tick once
                    yield b"data: hello\n\n"
                    yield b"data: world\n\n"
                emit_agent_exit(ctx, terminal_outcome="ok", total_duration_ms=1)
            else:
                yield b"data: hello\n\n"

        return StreamingResponse(gen(), media_type="text/event-stream")

    async def raises(request):
        raise RuntimeError("upstream rejected key sk-test-12345 Bearer abc.def.ghi")

    app = Starlette(
        routes=[
            Route("/", happy_stream, methods=["POST"]),
            Route("/boom", raises, methods=["POST"]),
        ]
    )
    app.add_middleware(CvdiagBackendMiddleware)
    return TestClient(app, raise_server_exceptions=raise_server_exceptions)


async def _drive_abort() -> None:
    """Drive the CVDIAG middleware over an unbounded stream and disconnect.

    Builds the middleware around an unbounded inner stream, calls ``dispatch``
    to get the wrapped ``body_iterator``, reads one chunk, then ``aclose()``s it
    — the deterministic equivalent of a client disconnecting mid-stream. This
    raises ``GeneratorExit`` into the wrapper → ``backend.sse.aborted``.
    """
    from starlette.requests import Request

    async def unbounded():
        i = 0
        while True:
            yield f"data: chunk-{i}\n\n".encode()
            i += 1

    inner_response = StreamingResponse(unbounded(), media_type="text/event-stream")

    async def call_next(_request):
        return inner_response

    scope = {
        "type": "http",
        "method": "POST",
        "path": "/",
        "headers": [(b"x-aimock-context", b"agno")],
        "query_string": b"",
    }

    async def receive():
        return {"type": "http.request", "body": b""}

    mw = CvdiagBackendMiddleware(app=lambda *a: None)
    request = Request(scope, receive)
    wrapped = await mw.dispatch(request, call_next)

    body = wrapped.body_iterator
    await body.__anext__()  # first chunk
    await body.aclose()  # client disconnect mid-stream


def test_all_eleven_backend_boundaries_emit(monkeypatch, capsys):
    """All 11 backend boundaries emit across the three request shapes.

    The happy stream yields ingress / agent.enter / llm.* / sse.first_byte /
    sse.event / agent.exit / response.complete; a disconnected stream yields
    sse.aborted; the raising route yields error.caught. Their union is the full
    eleven.
    """
    monkeypatch.setenv("CVDIAG_BACKEND_EMITTER", "1")
    client = _make_client(raise_server_exceptions=False)

    headers = {"x-test-id": VALID_TEST_ID, "x-aimock-context": "agno"}
    resp = client.post("/", headers=headers)
    assert resp.status_code == 200

    # Client-disconnect abort surface (→ backend.sse.aborted), driven directly
    # because Starlette's sync TestClient cannot reliably tear a stream down
    # mid-flight.
    asyncio.run(_drive_abort())

    client.post("/boom", headers=headers)

    envelopes = _parse_cvdiag_lines(capsys.readouterr().out)
    seen = _boundaries(envelopes)

    missing = ALL_BACKEND_BOUNDARIES - seen
    assert not missing, (
        f"missing backend boundaries: {sorted(missing)}; saw {sorted(seen)}"
    )

    # Correlation: every backend envelope carries the slug. The header-bearing
    # HTTP requests forward x-test-id verbatim; the directly driven abort
    # request mints its own UUIDv7 (no inbound header). Assert the forwarded
    # test_id appears on the header-bearing envelopes, and every minted id is a
    # well-formed UUIDv7.
    backend = [e for e in envelopes if e["layer"] == "backend"]
    assert backend, "no backend-layer envelopes emitted"
    assert all(e["slug"] == "agno" for e in backend)
    forwarded = [e for e in backend if e["test_id"] == VALID_TEST_ID]
    assert forwarded, "forwarded x-test-id never appeared on any backend envelope"
    uuid7_re = __import__("re").compile(
        r"^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$"
    )
    assert all(uuid7_re.match(e["test_id"]) for e in backend)
    # Closed 9-key edge-header bag always present on a header-bearing ingress.
    ingress = next(
        e
        for e in backend
        if e["boundary"] == "backend.request.ingress" and e["test_id"] == VALID_TEST_ID
    )
    assert set(ingress["edge_headers"].keys()) == {
        "cf-ray",
        "cf-mitigated",
        "cf-cache-status",
        "x-railway-edge",
        "x-railway-request-id",
        "x-hikari-trace",
        "retry-after",
        "via",
        "server",
    }


def test_error_caught_scrubs_secret(monkeypatch, capsys):
    """A synthetic ``sk-test-12345`` in an exception never reaches the emitted
    ``backend.error.caught`` envelope."""
    monkeypatch.setenv("CVDIAG_BACKEND_EMITTER", "1")
    client = _make_client(raise_server_exceptions=False)

    client.post("/boom", headers={"x-aimock-context": "agno"})

    out = capsys.readouterr().out
    envelopes = _parse_cvdiag_lines(out)
    errs = [e for e in envelopes if e["boundary"] == "backend.error.caught"]
    assert errs, "backend.error.caught not emitted"
    err = errs[0]
    assert err["metadata"]["exception_type"] == "RuntimeError"
    blob = json.dumps(err)
    assert "sk-test-12345" not in blob, "raw secret leaked into error envelope"
    assert "Bearer abc" not in blob, "raw bearer token leaked into error envelope"
    assert "[REDACTED]" in err["metadata"]["message_scrubbed"]


def test_scrub_helper_redacts_known_secret_shapes():
    """Unit-level: the scrub helper redacts bearer/sk-/pk-/userinfo shapes."""
    assert "sk-test-12345" not in scrub("key sk-test-12345 here")
    assert "sk-abcdefghijklmnopqrstuvwx" not in scrub("sk-abcdefghijklmnopqrstuvwx")
    assert "Bearer secrettoken" not in scrub("auth Bearer secrettoken")
    assert "pw" not in scrub("https://user:pw@host/path")
    assert scrub(None) == ""


def test_heartbeat_fires_within_window(monkeypatch, capsys):
    """``backend.llm.call.heartbeat`` fires while a slow LLM call is outstanding.

    Uses a short interval so the test is fast; the production interval is ~10s
    and the spec requires a heartbeat within ~12s of a slow-LLM simulation —
    proven here by the same code path firing within its interval.
    """
    monkeypatch.setenv("CVDIAG_BACKEND_EMITTER", "1")

    async def run():
        ctx = _RequestCtx(test_id=VALID_TEST_ID, slug="agno", demo="default")
        async with LlmCallScope(ctx, provider="openai", model="m", interval_s=0.05):
            await asyncio.sleep(0.18)  # ~3 heartbeat intervals

    asyncio.run(run())

    envelopes = _parse_cvdiag_lines(capsys.readouterr().out)
    hb = [e for e in envelopes if e["boundary"] == "backend.llm.call.heartbeat"]
    assert hb, "no heartbeat emitted during a slow LLM call"
    assert all("elapsed_ms_since_start" in e["metadata"] for e in hb)


def test_sse_aborted_on_client_disconnect(monkeypatch, capsys):
    """Tearing the response stream down mid-flight emits ``backend.sse.aborted``
    with a ``termination_kind`` and the bytes streamed before the abort."""
    monkeypatch.setenv("CVDIAG_BACKEND_EMITTER", "1")

    asyncio.run(_drive_abort())

    envelopes = _parse_cvdiag_lines(capsys.readouterr().out)
    aborts = [e for e in envelopes if e["boundary"] == "backend.sse.aborted"]
    assert aborts, "backend.sse.aborted not emitted on client disconnect"
    meta = aborts[0]["metadata"]
    assert meta["termination_kind"] in {"rst", "timeout", "chunk_error"}
    assert meta["bytes_before_abort"] > 0
    # A disconnected stream must NOT also report a clean response.complete.
    completes = [e for e in envelopes if e["boundary"] == "backend.response.complete"]
    assert not completes, "clean response.complete emitted for an aborted stream"


def test_disabled_by_default_emits_nothing(monkeypatch, capsys):
    """With ``CVDIAG_BACKEND_EMITTER`` unset, NO backend CVDIAG line is emitted."""
    monkeypatch.delenv("CVDIAG_BACKEND_EMITTER", raising=False)
    client = _make_client()
    client.post("/", headers={"x-aimock-context": "agno"})

    envelopes = _parse_cvdiag_lines(capsys.readouterr().out)
    backend = [e for e in envelopes if e["layer"] == "backend"]
    assert backend == [], f"emitter fired while disabled: {backend}"


# ── FIX-1: scrub parity with harness/src/cvdiag/scrub.ts ─────────────────────


def test_scrub_redacts_colonless_url_userinfo():
    """RED: ``scheme://token@host`` (no colon) currently LEAKS the bare token.

    The TS reference (URL_USERINFO_REGEX = ``([scheme]://)[^/\\s?#]*@``) redacts
    colon-less userinfo; the python regex required a mandatory ``:`` so a
    bare-token authority such as ``https://ghp_secrettoken@host`` slipped past.
    """
    out = scrub("clone https://ghp_secrettoken@example.com/x.git")
    assert "ghp_secrettoken" not in out, f"colon-less userinfo token leaked: {out!r}"
    assert "[REDACTED]@" in out
    # The host/path after the userinfo must survive (no over-match past ``?``/``#``).
    assert "example.com" in out


def test_scrub_redacts_full_bearer_tail():
    """RED: ``Bearer <jwt>`` whose token contains ``/`` ``+`` ``=`` leaks the tail.

    The TS reference grabs the whole token (``Bearer \\S+``); the python class
    ``[A-Za-z0-9._\\-]+`` stopped at ``/``/``+``/``=`` leaving an un-redacted JWT
    tail in the output.
    """
    token = "eyJhbGciOi.J9.sig/tail+more=end"
    out = scrub(f"Authorization: Bearer {token}")
    assert "tail+more=end" not in out, f"bearer token tail leaked: {out!r}"
    assert "/tail" not in out


def test_scrub_size_guard_bounds_scan_with_marker():
    """RED: a string longer than the scan cap must be TRUNCATED before scanning
    (mirrors TS ``SCRUB_MAX_SCAN_LEN`` + ``…[unscanned:<N>]`` marker) so the
    regex can never run on an unbounded adversarial input. The pre-fix scrub
    scanned the whole string (no guard), so no ``unscanned`` marker appears."""
    huge = "a" * 50_000
    out = scrub(huge)
    assert "[unscanned:" in out, f"no scan-size guard applied: {out[:60]!r}…"


# ── FIX-2: live tier (env read after import must arm tier-gated paths) ────────


def test_tier_read_live_after_import(monkeypatch, capsys):
    """RED: setting ``CVDIAG_VERBOSE`` AFTER import must let a verbose boundary
    fire. The tier was frozen at bootstrap ``setup()`` so a post-import env flip
    armed the emitter (read live) but left tier-gated paths no-op'ing."""
    import _shared.cvdiag_bootstrap as bootstrap

    # Resolve tier at DEFAULT (no verbose/debug) — the frozen-tier trap.
    monkeypatch.setenv("SHOWCASE_ENV", "test")
    bootstrap.setup({"SHOWCASE_ENV": "test"})
    # NOW flip verbose on, post-setup — emitter_enabled reads this live.
    monkeypatch.setenv("CVDIAG_BACKEND_EMITTER", "1")
    monkeypatch.setenv("CVDIAG_VERBOSE", "1")

    async def run():
        ctx = _RequestCtx(test_id=VALID_TEST_ID, slug="agno", demo="default")
        # backend.llm.call.start is a VERBOSE boundary.
        async with LlmCallScope(ctx, provider="openai", model="m", interval_s=10.0):
            pass

    asyncio.run(run())

    envelopes = _parse_cvdiag_lines(capsys.readouterr().out)
    starts = [e for e in envelopes if e["boundary"] == "backend.llm.call.start"]
    assert starts, "verbose boundary suppressed: tier was frozen at import"


# ── FIX-3: stop_heartbeat / __aexit__ cooperative cancellation ───────────────


@pytest.mark.skipif(
    not hasattr(asyncio.Task, "cancelling"),
    reason="cooperative-cancel detection uses Task.cancelling() (Python 3.11+); "
    "production runs 3.12",
)
def test_aexit_propagates_caller_cancellation(monkeypatch):
    """RED: ``__aexit__``'s heartbeat-await ``except (CancelledError, Exception)``
    swallows the CALLER's CancelledError, breaking cooperative cancellation.

    Deterministic repro (no scheduling race): a heartbeat whose cancellation is
    SLOW (shielded cleanup) keeps ``await hb_task`` suspended; the surrounding
    task is cancelled a SECOND time while suspended exactly there, so the
    caller's CancelledError lands inside ``__aexit__``. With the swallow it runs
    to completion (``AFTER_AEXIT`` reached); with cooperative cancellation the
    CancelledError propagates and ``AFTER_AEXIT`` is NEVER reached.
    """
    monkeypatch.setenv("CVDIAG_BACKEND_EMITTER", "1")
    reached: List = []

    async def run():
        ctx = _RequestCtx(test_id=VALID_TEST_ID, slug="agno", demo="default")
        scope = LlmCallScope(ctx, provider="openai", model="m", interval_s=10.0)
        await scope.__aenter__()
        # Replace the heartbeat with one that is SLOW to cancel so the
        # __aexit__ ``await hb_task`` reliably suspends.
        scope._hb_task.cancel()  # cancel the real one

        async def slow_hb():
            try:
                await asyncio.sleep(3600)
            except asyncio.CancelledError:
                await asyncio.shield(asyncio.sleep(0.2))
                return

        scope._hb_task = asyncio.ensure_future(slow_hb())
        await asyncio.sleep(0.02)

        at_await = asyncio.Event()

        async def body():
            try:
                await asyncio.sleep(3600)
            finally:
                at_await.set()
                await scope.__aexit__(None, None, None)
                reached.append("AFTER_AEXIT")

        task = asyncio.ensure_future(body())
        await asyncio.sleep(0.02)
        task.cancel()  # enter finally → reach the __aexit__ await
        await at_await.wait()
        await asyncio.sleep(0)  # yield so we're inside ``await hb_task``
        task.cancel()  # caller cancel lands inside __aexit__'s await
        try:
            await task
        except asyncio.CancelledError:
            pass

    asyncio.run(run())
    assert not reached, (
        "caller CancelledError was swallowed by __aexit__: it ran to completion "
        "instead of propagating cooperative cancellation"
    )
