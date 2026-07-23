"""Red→green tests for the langroid backend CVDIAG boundary instrumentation.

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
        "headers": [(b"x-aimock-context", b"langroid")],
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

    headers = {"x-test-id": VALID_TEST_ID, "x-aimock-context": "langroid"}
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
    assert all(e["slug"] == "langroid" for e in backend)
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

    client.post("/boom", headers={"x-aimock-context": "langroid"})

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
        ctx = _RequestCtx(test_id=VALID_TEST_ID, slug="langroid", demo="default")
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
    client.post("/", headers={"x-aimock-context": "langroid"})

    envelopes = _parse_cvdiag_lines(capsys.readouterr().out)
    backend = [e for e in envelopes if e["layer"] == "backend"]
    assert backend == [], f"emitter fired while disabled: {backend}"
