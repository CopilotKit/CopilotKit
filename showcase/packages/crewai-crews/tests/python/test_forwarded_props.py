"""
Red-green tests for the forwardedProps -> state.inputs splice.

Background — the regression these tests pin down:
The previous implementation (`ForwardedPropsMiddleware`, a `BaseHTTPMiddleware`
subclass that called `await request.body()` and reinstalled `request._receive`)
race-conditioned with Starlette's inner anyio TaskGroup wrapped_receive (see
`starlette/middleware/base.py`). Stacking it under `HealthMiddleware` (also
`BaseHTTPMiddleware`) caused a `RuntimeError: Unexpected message received:
http.request` mid-stream — AG-UI clients saw RUN_STARTED and then the SSE
stream aborted (`RUN_ERROR: INCOMPLETE_STREAM`), no TEXT_MESSAGE_* /
RUN_FINISHED ever emitted.

The fix replaces the racy `BaseHTTPMiddleware` subclass with a *raw* ASGI
middleware (`ForwardedPropsASGIMiddleware`) that buffers the body once at the
ASGI boundary and replays it via a fresh `receive` callable — no
`request._receive` surgery, no inner-TaskGroup race. These tests pin the new
contract:

1. POSTs to "/" stream cleanly with HealthMiddleware in the chain — no
   `Unexpected message received: http.request` RuntimeError, full body
   delivered to the route handler.
2. `forwardedProps.tone` / `expertise` / `responseLength` still flow through
   to `state.inputs` (the agent-config demo's contract).
3. Bodies WITHOUT agent-config props are left untouched (non-config demos
   keep their exact request bytes).
4. /health short-circuits without touching the body splice path.
5. The racy `BaseHTTPMiddleware` shape never reappears in agent_server.py
   (irreversible structural pin against the regression).
"""

from __future__ import annotations

import json
import os
import sys
import types
from typing import Any

import pytest
from fastapi import FastAPI, Request
from fastapi.testclient import TestClient
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import JSONResponse, StreamingResponse


# Force-disable aimock import-time side-effects so we can import agent_server
# in a unit-test process without dotenv loading a developer-local OPENAI key.
os.environ.setdefault("AIMOCK_URL", "")


# --------------------------------------------------------------------------- #
# Helper: build a minimal app that replicates the production middleware stack #
# (HealthMiddleware on the outside, the forwardedProps splice on the inside)  #
# plus a streaming route at "/" — the surface where the bug manifested.       #
# --------------------------------------------------------------------------- #


class _HealthMiddleware(BaseHTTPMiddleware):
    """Mirror of agent_server.HealthMiddleware — same shape, same dispatch."""

    async def dispatch(self, request, call_next):
        if request.url.path == "/health" and request.method == "GET":
            return JSONResponse({"status": "ok"})
        return await call_next(request)


# --------------------------------------------------------------------------- #
# Inline copy of the splice helpers — matches what's in agent_server.py.      #
# Keeping a local copy lets the streaming-shape test run without importing    #
# crewai. The structural-pin test (`test_forwarded_props_middleware_class_..  #
# _removed_from_agent_server`) reads the source file directly, and the       #
# real-module test (`test_real_agent_server_*`) imports agent_server with     #
# heavy deps stubbed — both keep the production helpers as the source of     #
# truth. If the helpers below drift, the real-module tests will catch it.    #
# --------------------------------------------------------------------------- #
_AGENT_CONFIG_KEYS = ("tone", "expertise", "responseLength")

_TONE_RULES = {
    "professional": "Use neutral, precise language. No emoji. Short sentences.",
    "casual": "Use friendly, conversational language. Contractions OK. Light humor welcome.",
    "enthusiastic": "Use upbeat, energetic language. Exclamation points OK. Emoji OK.",
}
_EXPERTISE_RULES = {
    "beginner": "Assume no prior knowledge. Define jargon. Use analogies.",
    "intermediate": "Assume common terms are understood; explain specialized terms.",
    "expert": "Assume technical fluency. Use precise terminology. Skip basics.",
}
_LENGTH_RULES = {
    "concise": "Respond in 1-3 sentences.",
    "detailed": "Respond in multiple paragraphs with examples where relevant.",
}


def _build_agent_config_guidance(tone, expertise, response_length):
    tone_rule = _TONE_RULES.get(str(tone), _TONE_RULES["professional"])
    expertise_rule = _EXPERTISE_RULES.get(str(expertise), _EXPERTISE_RULES["intermediate"])
    length_rule = _LENGTH_RULES.get(str(response_length), _LENGTH_RULES["concise"])
    return (
        "Follow these style rules for your response to the user. "
        f"TONE: {tone_rule} "
        f"EXPERTISE: {expertise_rule} "
        f"LENGTH: {length_rule}"
    )


def _has_agent_config_props(props):
    if not isinstance(props, dict):
        return False
    return any(k in props for k in _AGENT_CONFIG_KEYS)


def _splice_forwarded_props(body):
    """Reference splice — what the route handler should call post-fix."""
    if not isinstance(body, dict):
        return body
    forwarded = body.get("forwardedProps")
    if not _has_agent_config_props(forwarded):
        return body
    # _has_agent_config_props guarantees forwarded is a dict — narrow for type checker.
    assert isinstance(forwarded, dict)
    existing_state = body.get("state")
    state: dict[str, Any] = existing_state if isinstance(existing_state, dict) else {}
    raw_inputs = state.get("inputs")
    inputs: dict[str, Any] = dict(raw_inputs) if isinstance(raw_inputs, dict) else {}
    tone = forwarded.get("tone")
    expertise = forwarded.get("expertise")
    response_length = forwarded.get("responseLength")
    if tone is not None:
        inputs["tone"] = tone
    if expertise is not None:
        inputs["expertise"] = expertise
    if response_length is not None:
        inputs["response_length"] = response_length
    inputs["agent_config_guidance"] = _build_agent_config_guidance(
        tone=tone, expertise=expertise, response_length=response_length
    )
    state["inputs"] = inputs
    body["state"] = state
    return body


# --------------------------------------------------------------------------- #
# Fixture: stub heavy modules + (re)import agent_server for every test that  #
# needs the real module. Module-scoped + autouse so any of the real-module   #
# tests can run standalone or in any order (e.g. -k filters, pytest-xdist,   #
# pytest-randomly). The stub install is idempotent and the stale            #
# `agent_server` entry is purged so re-imports pick up our stubs.            #
# --------------------------------------------------------------------------- #


@pytest.fixture(autouse=True)
def _stub_agent_server_deps():
    """Install stubs for ag_ui_crewai + agents.* so `import agent_server`
    succeeds without crewai installed, and reset the cached module so each
    test gets a fresh import bound to OUR stubs (not whatever sibling test
    happened to import first).
    """
    # ag_ui_crewai.endpoint — provide a no-op `add_crewai_crew_fastapi_endpoint`
    # that mounts a streaming stub at the requested path.
    ag_ui_crewai = types.ModuleType("ag_ui_crewai")
    ag_ui_crewai_endpoint = types.ModuleType("ag_ui_crewai.endpoint")

    def _add_crewai_crew_fastapi_endpoint(app, crew, path):
        # Each call defines a fresh local function so closures don't collide
        # across the multiple `add_crewai_crew_fastapi_endpoint` calls in
        # agent_server.py.
        def _make_stub():
            async def _stub(request: Request):
                body = await request.json() if request.method == "POST" else {}

                async def gen():
                    yield b"event: RUN_STARTED\ndata: {}\n\n"
                    yield (
                        b"event: STATE\ndata: "
                        + json.dumps(body.get("state", {})).encode()
                        + b"\n\n"
                    )
                    yield b"event: RUN_FINISHED\ndata: {}\n\n"

                return StreamingResponse(gen(), media_type="text/event-stream")

            return _stub

        app.post(path)(_make_stub())

    setattr(
        ag_ui_crewai_endpoint,
        "add_crewai_crew_fastapi_endpoint",
        _add_crewai_crew_fastapi_endpoint,
    )
    sys.modules["ag_ui_crewai"] = ag_ui_crewai
    sys.modules["ag_ui_crewai.endpoint"] = ag_ui_crewai_endpoint

    # Stub agents.* — agent_server imports several crew classes; replace them
    # with no-arg sentinels so import succeeds without crewai being installed.
    agents_pkg = types.ModuleType("agents")
    agents_pkg.__path__ = []  # mark as package
    sys.modules["agents"] = agents_pkg
    for name in (
        "crew",
        "a2ui_fixed",
        "beautiful_chat",
        "byoc_hashbrown_agent",
        "byoc_json_render_agent",
        "declarative_gen_ui",
    ):
        sys.modules[f"agents.{name}"] = types.ModuleType(f"agents.{name}")
    setattr(sys.modules["agents.crew"], "LatestAiDevelopment", lambda: object())
    setattr(sys.modules["agents.a2ui_fixed"], "A2UIFixedSchema", lambda: object())
    setattr(sys.modules["agents.beautiful_chat"], "BeautifulChat", lambda: object())
    setattr(sys.modules["agents.byoc_hashbrown_agent"], "ByocHashbrown", lambda: object())
    setattr(sys.modules["agents.byoc_json_render_agent"], "ByocJsonRender", lambda: object())
    setattr(sys.modules["agents.declarative_gen_ui"], "DeclarativeGenUI", lambda: object())

    # Drop any stale agent_server import — we want the next `import agent_server`
    # to re-run module-init against OUR stubs.
    sys.modules.pop("agent_server", None)

    yield

    # Teardown: leave the stubs in place across tests (cheap), but drop
    # agent_server so a follow-up test re-binds against fresh stubs.
    sys.modules.pop("agent_server", None)


# --------------------------------------------------------------------------- #
# Tests                                                                        #
# --------------------------------------------------------------------------- #


def test_streaming_post_with_forwarded_props_completes_without_runtimeerror():
    """Stand-in regression shape: HealthMiddleware (BaseHTTPMiddleware) wraps
    a streaming route that consumes a JSON body and emits SSE frames. The
    pre-fix `ForwardedPropsMiddleware` (also BaseHTTPMiddleware) would have
    raced with Starlette's inner TaskGroup here and aborted the stream with
    `RuntimeError: Unexpected message received: http.request`.

    Post-fix the splice is a *raw* ASGI middleware
    (`ForwardedPropsASGIMiddleware` in agent_server.py) that buffers the body
    at the ASGI boundary and replays it via a fresh `receive` callable — no
    `BaseHTTPMiddleware` machinery in the body path, no race. The structural
    pin in `test_forwarded_props_middleware_class_removed_from_agent_server`
    enforces that the racy shape can never re-enter the source.

    This test exercises the *post-fix* contract: splice happens via the
    `_splice_forwarded_props` helper inside the route handler, the streaming
    response runs to completion under HealthMiddleware, and the spliced
    state.inputs reaches the handler intact.
    """
    app = FastAPI()

    @app.post("/")
    async def root(request: Request):
        body = await request.json()
        spliced = _splice_forwarded_props(body)

        async def gen():
            yield b"event: RUN_STARTED\ndata: {}\n\n"
            yield (
                b"event: STATE\ndata: "
                + json.dumps(spliced.get("state", {})).encode()
                + b"\n\n"
            )
            yield b"event: RUN_FINISHED\ndata: {}\n\n"

        return StreamingResponse(gen(), media_type="text/event-stream")

    app.add_middleware(_HealthMiddleware)

    payload = {
        "threadId": "t1",
        "runId": "r1",
        "messages": [{"role": "user", "content": "hi"}],
        "state": {"inputs": {}},
        "forwardedProps": {"tone": "casual", "expertise": "beginner"},
    }

    with TestClient(app) as client:
        response = client.post(
            "/",
            json=payload,
            headers={"content-type": "application/json"},
        )
        assert response.status_code == 200
        text = response.text
        assert "RUN_STARTED" in text
        assert "RUN_FINISHED" in text
        # Splice landed:
        assert "casual" in text
        assert "agent_config_guidance" in text


def test_forwarded_props_middleware_class_removed_from_agent_server():
    """Structural regression pin: the racy `ForwardedPropsMiddleware`
    (BaseHTTPMiddleware subclass) MUST NOT exist in agent_server.py. The
    raw-ASGI replacement (`ForwardedPropsASGIMiddleware`) is fine.

    Pre-fix this fails. Post-fix the BaseHTTPMiddleware-subclass shape is
    gone. This test is the irreversible RED→GREEN pin — re-introducing the
    bad pattern (a BaseHTTPMiddleware that does body-replay surgery) trips
    it immediately.
    """
    here = os.path.dirname(os.path.abspath(__file__))
    src = os.path.normpath(os.path.join(here, "..", "..", "src", "agent_server.py"))
    with open(src) as f:
        source = f.read()
    assert "class ForwardedPropsMiddleware(BaseHTTPMiddleware" not in source, (
        "ForwardedPropsMiddleware (BaseHTTPMiddleware subclass) must be "
        "removed — it caused a body-replay race against Starlette's inner "
        "TaskGroup, aborting AG-UI streams with "
        "`RuntimeError: Unexpected message received: http.request`. "
        "Use a raw ASGI middleware instead."
    )
    # Also assert the helpers stay (so the route handler can call them):
    assert "_build_agent_config_guidance" in source
    assert "_has_agent_config_props" in source


def test_real_agent_server_streams_post_root_without_runtimeerror():
    """End-to-end: import the REAL `agent_server` module and POST to '/' to
    confirm the middleware stack no longer raises the body-replay
    RuntimeError. Stubs out the heavy crewai-backed route with a streaming
    one (via the autouse fixture) so the test stays unit-scoped (no LLM,
    no crewai install needed).
    """
    import agent_server  # noqa: F401

    payload = {
        "threadId": "t1",
        "runId": "r1",
        "messages": [{"role": "user", "content": "hi"}],
        "state": {"inputs": {}},
        "forwardedProps": {"tone": "casual", "expertise": "beginner"},
    }

    with TestClient(agent_server.app) as client:
        response = client.post(
            "/",
            json=payload,
            headers={"content-type": "application/json"},
        )
        assert response.status_code == 200, response.text
        text = response.text
        assert "RUN_STARTED" in text
        assert "RUN_FINISHED" in text
        # Splice landed in state.inputs (this is the agent-config contract):
        assert "casual" in text
        assert "agent_config_guidance" in text


def test_health_endpoint_short_circuits():
    """/health must continue to short-circuit at the middleware layer."""
    import agent_server  # noqa: F401

    with TestClient(agent_server.app) as client:
        r = client.get("/health")
        assert r.status_code == 200
        assert r.json() == {"status": "ok"}


def test_post_without_forwarded_props_passes_through_unchanged():
    """Bodies without agent-config props must reach the handler with state
    unmodified — non-config demos keep their exact request bytes."""
    import agent_server  # noqa: F401

    payload = {
        "threadId": "t1",
        "runId": "r1",
        "messages": [{"role": "user", "content": "hi"}],
        "state": {"inputs": {"some_demo_key": "preserved"}},
    }

    with TestClient(agent_server.app) as client:
        response = client.post(
            "/",
            json=payload,
            headers={"content-type": "application/json"},
        )
        assert response.status_code == 200, response.text
        # Original state.inputs preserved, no agent_config_guidance injected:
        assert "preserved" in response.text
        assert "agent_config_guidance" not in response.text


# --------------------------------------------------------------------------- #
# Bucket (a) regression tests: ASGI middleware error-handling semantics.       #
# --------------------------------------------------------------------------- #
#
# These tests drive `ForwardedPropsASGIMiddleware` directly (bypassing
# TestClient) because they need to inject specific receive() event sequences
# and exception types that the test client's transport does not emit.


def _get_middleware_class():
    """Import the real `ForwardedPropsASGIMiddleware` from agent_server.

    Stubs for `ag_ui_crewai` and `agents.*` are installed by the module-scoped
    `_stub_agent_server_deps` autouse fixture before each test runs, so a
    fresh `import agent_server` here binds against those stubs.
    """
    if "agent_server" not in sys.modules:
        import agent_server  # noqa: F401
    return sys.modules["agent_server"].ForwardedPropsASGIMiddleware


def _build_http_scope(body_bytes: bytes) -> dict:
    return {
        "type": "http",
        "method": "POST",
        "path": "/",
        "headers": [
            (b"content-type", b"application/json"),
            (b"content-length", str(len(body_bytes)).encode()),
        ],
    }


@pytest.mark.anyio
async def test_replay_receive_propagates_cancellederror():
    """`replay_receive` MUST propagate `asyncio.CancelledError` so the outer
    task can be cancelled cleanly. The bare `except Exception` was a
    correctness hazard: even if Python 3.8+ correctly inherits CancelledError
    from BaseException, the broad except still swallows programming errors
    (KeyError, AttributeError) that should surface, not silently convert
    into a clean http.disconnect.

    Post-fix: CancelledError is caught explicitly and re-raised; any other
    unexpected exception is logged (observable) rather than silently
    swallowed.
    """
    import asyncio

    MW = _get_middleware_class()

    body = json.dumps({"threadId": "t1"}).encode()

    async def inner_app(scope, receive, send):
        msg1 = await receive()
        assert msg1["type"] == "http.request"
        # Poll again — this is where CancelledError should propagate up.
        await receive()

    mw = MW(inner_app)

    state = {"calls": 0}

    async def receive():
        state["calls"] += 1
        if state["calls"] == 1:
            return {"type": "http.request", "body": body, "more_body": False}
        raise asyncio.CancelledError()

    async def send(_msg):
        pass

    scope = _build_http_scope(body)

    with pytest.raises(asyncio.CancelledError):
        await mw(scope, receive, send)


def test_replay_receive_explicitly_handles_cancellederror():
    """Source-level RED-GREEN: assert `replay_receive` catches
    `asyncio.CancelledError` explicitly (and re-raises) BEFORE the broader
    except. The bare `except Exception` left CancelledError propagation
    contingent on Python version and the BaseException hierarchy, which is
    fragile; the fix makes it explicit and version-independent."""
    here = os.path.dirname(os.path.abspath(__file__))
    src_path = os.path.normpath(
        os.path.join(here, "..", "..", "src", "agent_server.py")
    )
    with open(src_path) as f:
        source = f.read()

    # Locate the replay_receive function body.
    marker = "async def replay_receive"
    idx = source.find(marker)
    assert idx != -1, "replay_receive function not found in agent_server.py"
    # Take a window large enough to include its body.
    window = source[idx : idx + 1500]

    assert "except asyncio.CancelledError" in window, (
        "replay_receive must catch asyncio.CancelledError explicitly and "
        "re-raise it. A bare `except Exception` is too broad — it can "
        "swallow programming errors that should surface, and is fragile "
        "across Python versions where CancelledError's class hierarchy "
        "changes."
    )


@pytest.mark.anyio
async def test_replay_disconnect_delivers_buffered_chunks_before_disconnect():
    """RED pre-fix: when http.disconnect arrives mid-buffer, the middleware
    only forwards the disconnect — buffered body chunks are silently dropped.

    GREEN post-fix: the inner ASGI app must observe the buffered chunks (as
    a single http.request message) BEFORE the http.disconnect, so it sees
    the partial body that actually arrived.
    """
    MW = _get_middleware_class()

    chunk1 = b'{"threadId":"t1",'
    chunk2 = b'"runId":"r1",'
    # No final chunk — disconnect arrives mid-stream.

    received: list[dict] = []

    async def inner_app(scope, receive, send):
        # Drain receive until we see a disconnect.
        while True:
            msg = await receive()
            received.append(msg)
            if msg["type"] == "http.disconnect":
                return

    mw = MW(inner_app)

    state = {"step": 0}

    async def receive():
        state["step"] += 1
        if state["step"] == 1:
            return {"type": "http.request", "body": chunk1, "more_body": True}
        if state["step"] == 2:
            return {"type": "http.request", "body": chunk2, "more_body": True}
        if state["step"] == 3:
            return {"type": "http.disconnect"}
        # No further events.
        return {"type": "http.disconnect"}

    async def send(_msg):
        pass

    # Body bytes hint for content-length is approximate; middleware doesn't
    # validate it against actual chunks, so any value works.
    scope = _build_http_scope(chunk1 + chunk2)
    await mw(scope, receive, send)

    # The inner app must have seen at least one http.request with the
    # buffered chunks BEFORE the http.disconnect.
    request_msgs = [m for m in received if m["type"] == "http.request"]
    disconnect_msgs = [m for m in received if m["type"] == "http.disconnect"]
    assert request_msgs, (
        "Inner ASGI app did not receive buffered body chunks before disconnect — "
        "they were silently dropped."
    )
    assert disconnect_msgs, "Inner ASGI app never observed http.disconnect."

    # Buffered chunks must combine to chunk1+chunk2.
    combined = b"".join(m.get("body", b"") for m in request_msgs)
    assert combined == chunk1 + chunk2, (
        f"Buffered body mismatch: expected {chunk1 + chunk2!r}, got {combined!r}"
    )

    # Order: at least one request message must precede the first disconnect.
    first_disconnect_idx = next(
        i for i, m in enumerate(received) if m["type"] == "http.disconnect"
    )
    first_request_idx = next(
        (i for i, m in enumerate(received) if m["type"] == "http.request"), None
    )
    assert first_request_idx is not None
    assert first_request_idx < first_disconnect_idx


@pytest.fixture
def anyio_backend():
    return "asyncio"
