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

import json
from typing import Any

from ag_ui_crewai.endpoint import add_crewai_crew_fastapi_endpoint
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import JSONResponse
from agents.crew import LatestAiDevelopment
from agents.a2ui_fixed import A2UIFixedSchema
from agents.byoc_hashbrown_agent import ByocHashbrown
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
# This is Starlette middleware (not FastAPI `Depends`) because we need to
# rewrite the ASGI `receive` callable before the FastAPI body parser reads
# it — `Depends` runs after the body has already been bound to the Pydantic
# `RunAgentInput` model.
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


class ForwardedPropsMiddleware(BaseHTTPMiddleware):
    """Merges AG-UI `forwardedProps` into `state.inputs` for agent-config demos.

    See block comment above for the full rationale. Keeps all other POSTs
    byte-identical by only rewriting bodies that carry agent-config props.
    """

    async def dispatch(self, request, call_next):
        if request.method != "POST" or request.url.path not in ("/", ""):
            return await call_next(request)

        content_type = request.headers.get("content-type", "")
        if "application/json" not in content_type:
            return await call_next(request)

        try:
            raw = await request.body()
        except Exception:
            return await call_next(request)

        if not raw:
            return await call_next(request)

        try:
            body = json.loads(raw)
        except (ValueError, TypeError):
            return await call_next(request)

        forwarded = body.get("forwardedProps") if isinstance(body, dict) else None
        if not _has_agent_config_props(forwarded):
            # Restore body unchanged (our .body() read consumed the receive
            # queue, so we must put it back for downstream handlers).
            return await _call_with_body(request, call_next, raw)

        existing_state = body.get("state") if isinstance(body, dict) else None
        state = existing_state if isinstance(existing_state, dict) else {}

        inputs = state.get("inputs") if isinstance(state.get("inputs"), dict) else {}
        inputs = dict(inputs)  # copy
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

        new_raw = json.dumps(body).encode("utf-8")
        return await _call_with_body(request, call_next, new_raw)


async def _call_with_body(request, call_next, body_bytes: bytes):
    """Replay ``body_bytes`` as the ASGI ``receive`` stream, then delegate.

    Starlette consumes the ASGI ``receive`` callable when ``request.body()``
    runs, so downstream handlers would otherwise see an empty body. We rebuild
    a one-shot ``receive`` that emits our (possibly rewritten) bytes.
    """
    sent = False

    async def receive():
        nonlocal sent
        if sent:
            return {"type": "http.disconnect"}
        sent = True
        return {
            "type": "http.request",
            "body": body_bytes,
            "more_body": False,
        }

    request._receive = receive  # type: ignore[attr-defined]
    return await call_next(request)


app.add_middleware(HealthMiddleware)
app.add_middleware(ForwardedPropsMiddleware)

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
