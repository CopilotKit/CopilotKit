"""
Agent Server for CrewAI (Crews)

FastAPI server that hosts the CrewAI crew backend.
The Next.js CopilotKit runtime proxies requests here via AG-UI protocol.
"""

# ORDER-CRITICAL: load .env and apply aimock redirection FIRST — before any
# crewai / litellm / openai module is imported. Those modules can construct
# clients at import time that latch onto OPENAI_BASE_URL / OPENAI_API_KEY as
# they were at import, making later mutations invisible. Keep these two lines
# at the very top of imports (after stdlib), above the crewai import below.
from dotenv import load_dotenv
from aimock_toggle import configure_aimock

load_dotenv()
configure_aimock()

# NOTE: The pre-bind LLM crash hardening shim that previously lived here has
# been removed. It monkey-patched crewai.cli.crew_chat.generate_*_description_with_ai
# to static strings so that ChatWithCrewFlow.__init__ — which ag-ui-crewai
# <= 0.1.5 invoked at endpoint-registration time (i.e. BEFORE uvicorn bound
# its port) — could not crash the process before the HTTP server was
# listening. Upstream issue: https://github.com/crewAIInc/crewAI/issues/5510.
#
# ag-ui-crewai 0.2.0 (PR ag-ui-protocol/ag-ui#1550, released 2026-04-18)
# defers ChatWithCrewFlow construction to first request via a module-scoped
# `_cached_flow` + `asyncio.Lock` inside `add_crewai_crew_fastapi_endpoint`.
# Any LLM hiccup now surfaces as a 5xx on the first request instead of a
# startup crash, which is the correct failure mode for a runtime outage and
# is what the shim was reaching for. With the requirements.txt pin bumped to
# `>=0.2.0,<0.3.0`, the shim is dead code and has been removed.

import asyncio
import json
from typing import Any

from ag_ui_crewai.endpoint import add_crewai_crew_fastapi_endpoint
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import JSONResponse
from agents.crew import LatestAiDevelopment
from agents.a2ui_fixed import A2UIFixedSchema
from agents.beautiful_chat import BeautifulChat
from agents.byoc_hashbrown_agent import ByocHashbrown
from agents.byoc_json_render_agent import ByocJsonRender
from agents.declarative_gen_ui import DeclarativeGenUI

app = FastAPI(title="CrewAI (Crews) Agent Server")


# Serve /health via middleware so it short-circuits BEFORE route resolution.
# `add_crewai_crew_fastapi_endpoint(app, crew, "/")` installs a catch-all at
# the root that shadows any later `@app.get("/health")` decorator. Middleware
# runs above the routing layer, so the health endpoint stays reachable.
class HealthMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request, call_next):
        if request.url.path == "/health" and request.method == "GET":
            return JSONResponse({"status": "ok"})
        return await call_next(request)


# AG-UI's RunAgentInput exposes `forwardedProps` at the top level of the JSON
# body, BUT the upstream `ag_ui_crewai.endpoint.crewai_prepare_inputs` helper
# only threads `state` / `messages` / `tools` through to `ChatWithCrewFlow` —
# it drops `forwardedProps` on the floor. The agent-config demo relies on those
# forwarded properties (`tone`, `expertise`, `responseLength`) being visible to
# the LLM at runtime, so we splice them into `state.inputs` here. The flow's
# `chat()` method already appends `state["inputs"]` to its system prompt via
# `system_message += "\n\nCurrent inputs: " + json.dumps(state["inputs"])`
# — so merging into `inputs` is the upstream-blessed extension point.
#
# Scope: only mutate when `forwardedProps.tone` / `expertise` / `responseLength`
# is present, so non-agent-config demos keep their exact request bytes.
#
# IMPLEMENTATION NOTE — why this is a *raw* ASGI middleware, not a
# `BaseHTTPMiddleware` subclass: an earlier version of this splice was a
# `BaseHTTPMiddleware` that called `await request.body()` and reinstalled
# `request._receive` with a one-shot replay. That layered on top of
# `HealthMiddleware` (also `BaseHTTPMiddleware`) and race-conditioned with
# Starlette's inner anyio TaskGroup `wrapped_receive`
# (starlette/middleware/base.py:54), throwing
# `RuntimeError: Unexpected message received: http.request` mid-stream and
# aborting AG-UI SSE streams (`RUN_STARTED` then `RUN_ERROR:
# INCOMPLETE_STREAM`, no `RUN_FINISHED`). Raw ASGI sidesteps that machinery
# entirely — we own the receive stream from the outset, no replay surgery.
_AGENT_CONFIG_KEYS = ("tone", "expertise", "responseLength")

_TONE_RULES = {
    "professional": (
        "Use neutral, precise language. No emoji. Short sentences."
    ),
    "casual": (
        "Use friendly, conversational language. Contractions OK. "
        "Light humor welcome."
    ),
    "enthusiastic": (
        "Use upbeat, energetic language. Exclamation points OK. Emoji OK."
    ),
}
_EXPERTISE_RULES = {
    "beginner": "Assume no prior knowledge. Define jargon. Use analogies.",
    "intermediate": (
        "Assume common terms are understood; explain specialized terms."
    ),
    "expert": (
        "Assume technical fluency. Use precise terminology. Skip basics."
    ),
}
_LENGTH_RULES = {
    "concise": "Respond in 1-3 sentences.",
    "detailed": (
        "Respond in multiple paragraphs with examples where relevant."
    ),
}


def _build_agent_config_guidance(
    tone: Any, expertise: Any, response_length: Any
) -> str:
    """Compose a plain-English style guide from the forwarded enums.

    Matches the structure used by the LangGraph-Python reference
    (`agent_config_agent.build_system_prompt`) so the CrewAI port has identical
    end-user behavior even though the plumbing is different. Unknown / missing
    values fall back to the default for each axis.
    """
    tone_rule = _TONE_RULES.get(str(tone), _TONE_RULES["professional"])
    expertise_rule = _EXPERTISE_RULES.get(
        str(expertise), _EXPERTISE_RULES["intermediate"]
    )
    length_rule = _LENGTH_RULES.get(
        str(response_length), _LENGTH_RULES["concise"]
    )
    return (
        "Follow these style rules for your response to the user. "
        f"TONE: {tone_rule} "
        f"EXPERTISE: {expertise_rule} "
        f"LENGTH: {length_rule}"
    )


def _has_agent_config_props(props: Any) -> bool:
    if not isinstance(props, dict):
        return False
    return any(k in props for k in _AGENT_CONFIG_KEYS)


def _splice_forwarded_props(body: Any) -> Any:
    """Splice agent-config `forwardedProps` into `body.state.inputs`.

    In-place mutation: the input `body` dict is modified and also returned
    for fluent use. No ASGI surgery happens here. Returns the body
    unchanged when no agent-config props are present, so non-config demos
    keep their exact request bytes.
    """
    if not isinstance(body, dict):
        return body
    forwarded = body.get("forwardedProps")
    if not _has_agent_config_props(forwarded):
        return body
    # `_has_agent_config_props` guarantees `forwarded` is a dict, but
    # narrow it explicitly for the type checker — using `assert` here
    # would be stripped under `python -O`, leaving the type checker
    # without a guarantee.
    if not isinstance(forwarded, dict):
        return body

    existing_state = body.get("state")
    state: dict[str, Any] = existing_state if isinstance(existing_state, dict) else {}

    raw_inputs = state.get("inputs")
    inputs: dict[str, Any] = dict(raw_inputs) if isinstance(raw_inputs, dict) else {}
    # Build a prose guidance string the LLM can actually follow. The upstream
    # flow appends `Current inputs: {json}` verbatim to the system prompt —
    # raw enum values ("casual", "intermediate", "concise") are ambiguous,
    # so we expand them into explicit behavior rules here and stash them
    # under a well-named key. The original enums are also retained so the
    # demo can verify the forwarded props reached the backend.
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
        tone=tone,
        expertise=expertise,
        response_length=response_length,
    )
    state["inputs"] = inputs
    body["state"] = state
    return body


class ForwardedPropsASGIMiddleware:
    """Raw ASGI middleware that splices `forwardedProps` into `state.inputs`.

    Why raw ASGI (and not `BaseHTTPMiddleware`):
    `BaseHTTPMiddleware` wraps the request in an inner anyio TaskGroup that
    owns the `receive` callable. Reading `await request.body()` and then
    reinstalling `request._receive` with a one-shot replay (the previous
    approach) races with that TaskGroup's `wrapped_receive` — Starlette
    fires `RuntimeError: Unexpected message received: http.request` mid
    streaming response. AG-UI clients saw `RUN_STARTED` and then the SSE
    stream aborted (`RUN_ERROR: INCOMPLETE_STREAM`), no `RUN_FINISHED` ever
    emitted. See the agent_config block-comment above.

    A raw ASGI middleware (this class) buffers the request body BEFORE
    handing the inner ASGI app a fresh `receive` that re-emits the
    (possibly rewritten) bytes — it does this once, at the boundary, with
    no `BaseHTTPMiddleware` machinery in the way.

    Scope guard: only POST `/` with `application/json` and an
    `forwardedProps` carrying `tone` / `expertise` / `responseLength` is
    rewritten; everything else is a straight pass-through.
    """

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        method = scope.get("method", "")
        path = scope.get("path", "")
        # Per ASGI spec, `path` is always at least "/" — no need to also
        # check for the empty string.
        if method != "POST" or path != "/":
            await self.app(scope, receive, send)
            return

        # `headers` is a list of (bytes, bytes) — find content-type.
        # ASGI normalizes header names to lowercase, but match
        # case-insensitively for parity with the content-length filter
        # below and to be defensive against non-spec ASGI servers.
        headers = scope.get("headers") or []
        content_type = b""
        for k, v in headers:
            if k.lower() == b"content-type":
                content_type = v
                break
        if b"application/json" not in content_type:
            await self.app(scope, receive, send)
            return

        # Buffer the body. ASGI delivers it as N `http.request` messages
        # with `more_body=True` until the last one (`more_body=False`).
        chunks: list[bytes] = []
        more_body = True
        while more_body:
            message = await receive()
            if message["type"] != "http.request":
                # Unexpected (e.g. http.disconnect before body fully sent).
                # Replay the buffered chunks we already received as a single
                # http.request BEFORE forwarding the disconnect — otherwise
                # the inner ASGI app sees disconnect with no body even when
                # partial chunks arrived. The inner app can then choose
                # whether to surface a 4xx from the partial body or honor
                # the disconnect.
                pending: list[dict] = [
                    {
                        "type": "http.request",
                        "body": b"".join(chunks),
                        "more_body": False,
                    },
                    message,
                ]
                idx = 0

                async def _replay_partial():
                    nonlocal idx
                    if idx < len(pending):
                        m = pending[idx]
                        idx += 1
                        return m
                    return {"type": "http.disconnect"}

                await self.app(scope, _replay_partial, send)
                return
            chunks.append(message.get("body") or b"")
            more_body = message.get("more_body", False)

        raw = b"".join(chunks)

        # Try to splice. On any parse failure, replay original bytes verbatim.
        # `_splice_forwarded_props` returns the same dict if no agent-config
        # props are present, OR a mutated dict if it spliced — we detect
        # "no-op" by checking `_has_agent_config_props` on `forwardedProps`
        # directly (the splice only fires when that returns True).
        new_raw = raw
        if raw:
            try:
                body = json.loads(raw)
            except (ValueError, TypeError) as exc:
                # Don't change behavior — still pass through the original
                # bytes verbatim — but make the failure observable so a
                # malformed frontend body doesn't disappear silently. This
                # package has no structured logger, so we use stderr
                # directly with method/path context (same convention as
                # the rest of the showcase Python entrypoints).
                print(
                    f"[ForwardedPropsASGIMiddleware] JSON parse failed for "
                    f"{method} {path}: {exc!r}",
                    flush=True,
                )
                body = None
            if isinstance(body, dict) and _has_agent_config_props(
                body.get("forwardedProps")
            ):
                spliced = _splice_forwarded_props(body)
                new_raw = json.dumps(spliced).encode("utf-8")

        # If we rewrote the body, content-length in headers is stale.
        # Strip it from the scope copy — the inner ASGI app reads bytes
        # from `receive`, not from content-length, so this is safe and
        # avoids tripping any downstream length-validating layer.
        if new_raw is not raw:
            new_headers = [
                (k, v) for k, v in headers if k.lower() != b"content-length"
            ]
            new_headers.append((b"content-length", str(len(new_raw)).encode()))
            scope = dict(scope)
            scope["headers"] = new_headers

        # Replay the (possibly rewritten) body as a single message.
        sent_body = False
        sent_disconnect = False

        async def replay_receive():
            nonlocal sent_body, sent_disconnect
            if not sent_body:
                sent_body = True
                return {
                    "type": "http.request",
                    "body": new_raw,
                    "more_body": False,
                }
            # After the body is consumed, forward any further events from
            # the original receive (e.g. http.disconnect). This is what
            # streaming responses need to detect client disconnects.
            if sent_disconnect:
                return {"type": "http.disconnect"}
            try:
                msg = await receive()
            except asyncio.CancelledError:
                # Cancellation MUST propagate — the outer ASGI server is
                # cancelling this task, and swallowing it leaks the task
                # and corrupts task-cancellation semantics. Do NOT mark
                # disconnect; let the cancellation unwind cleanly.
                raise
            except Exception as exc:  # noqa: BLE001  pragma: no cover
                # Narrow this further once we know which transport errors
                # actually surface here. For now, log the failure so it's
                # observable rather than silently converted into a clean
                # disconnect (which masked real bugs).
                print(
                    f"[ForwardedPropsASGIMiddleware] receive() raised "
                    f"{type(exc).__name__}: {exc!r} — treating as disconnect",
                    flush=True,
                )
                sent_disconnect = True
                return {"type": "http.disconnect"}
            if msg.get("type") == "http.disconnect":
                sent_disconnect = True
            return msg

        await self.app(scope, replay_receive, send)


app.add_middleware(HealthMiddleware)
app.add_middleware(ForwardedPropsASGIMiddleware)

# CORS: `allow_origins=["*"]` is intentional for this LOCAL DEMO / SHOWCASE
# STARTER package. The agent server binds to localhost:8000 during `pnpm dev`
# (or :8123 inside a generated starter container) and is reached ONLY by the
# Next.js frontend on :3000 during development — there is no production
# deployment surface where a wide-open CORS policy would matter.
#
# If this file is copied into a real deployment, replace `["*"]` with a
# CORS_ORIGIN env-driven allowlist. A `CORS_ORIGIN` env var is NOT wired here
# today (see .env.example); adding it is a future-work item tracked outside
# this PR.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# Per-demo dedicated crews mount at their own paths BEFORE the shared catch-all.
# The shared crew owns "/" and therefore must be registered last; otherwise
# its route shadows subsequent per-demo endpoints.
add_crewai_crew_fastapi_endpoint(app, DeclarativeGenUI(), "/declarative-gen-ui")
add_crewai_crew_fastapi_endpoint(app, A2UIFixedSchema(), "/a2ui-fixed-schema")
add_crewai_crew_fastapi_endpoint(app, ByocHashbrown(), "/byoc-hashbrown")
add_crewai_crew_fastapi_endpoint(app, ByocJsonRender(), "/byoc-json-render")
add_crewai_crew_fastapi_endpoint(app, BeautifulChat(), "/beautiful-chat")

add_crewai_crew_fastapi_endpoint(app, LatestAiDevelopment(), "/")


# NOTE: intentionally NO `if __name__ == "__main__": main()` block.
# Every execution path for this module — the package `pnpm dev` script, the
# generated starter `pnpm dev` script, the Docker entrypoint, and the CI
# workflow — invokes `python -m uvicorn agent_server:app ...` directly from
# the command line (with `--host`, `--port`, and optional `--reload` passed
# as flags). A module-level `main()` wrapper reading PORT / RELOAD from env
# was dead code that CI never exercised AND whose defaults (PORT=8000) drifted
# out of sync with the starter's actual binding (8123). Remove it rather than
# maintain an orphan knob.
