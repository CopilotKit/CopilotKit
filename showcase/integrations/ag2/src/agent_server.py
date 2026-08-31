"""
Agent Server for AG2

FastAPI server that hosts the AG2 agent backends.
The Next.js CopilotKit runtime proxies requests here via AG-UI protocol.

Most demos share a single ConversableAgent at the root path. Demos that
require dedicated state mechanics or multi-agent topologies are mounted
as their own sub-apps at distinct paths so each demo gets its own
ContextVariables-backed state slot.
"""

# ORDER-CRITICAL: load .env BEFORE any agent module imports. The agent
# modules (agents/agent.py et al.) construct module-level
# ``openai.AsyncOpenAI()`` / autogen ``LLMConfig`` clients that read
# ``OPENAI_API_KEY`` (and friends) at construction time. If we import the
# agent modules before calling ``load_dotenv()``, those module-level
# clients latch onto whatever the OS environment had at import time
# (usually nothing in a dev shell), and subsequent .env values never
# reach them. ``load_dotenv()`` is idempotent so the redundant call
# inside each agent module is harmless — but the FIRST call must happen
# here, before the agent imports below.
# CVDIAG bootstrap — MUST be the first non-stdlib import (folded in from the
# dropped L1-H slot). Importing this module configures the root logger via
# ``logging.basicConfig`` so the ``agents._header_forwarding`` (and sibling
# ``agents.*``) CVDIAG loggers actually EMIT (fixes the silent-drop bug), and
# resolves the verbosity tier + PB writer. It imports pydantic/starlette only
# and has no dependency on ``.env``, so it is safe to run before ``load_dotenv``.
import _shared.cvdiag_bootstrap  # noqa: F401,E402  (first non-stdlib import — bootstrap side effects)

from dotenv import load_dotenv

load_dotenv()

import os
import uvicorn
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import JSONResponse

# ORDER-CRITICAL: install the global httpx hook BEFORE any agent module
# imports. The autogen / openai SDK construct their httpx client lazily
# per-call, but other integrations construct at module-import time;
# keeping the patch at the top of agent_server.py is the consistent
# placement across all Python showcase integrations and is harmless here.
from agents._cvdiag_backend import CvdiagBackendMiddleware
from agents._header_forwarding import (
    HeaderForwardingHTTPMiddleware,
    install_executor_contextvar_propagation,
    install_global_httpx_hook,
)
from agents._request_context import RequestUserMessageMiddleware

install_global_httpx_hook()
# AG2-specific: autogen's ConversableAgent.a_generate_oai_reply dispatches
# the underlying sync LLM call onto the default ThreadPoolExecutor via
# loop.run_in_executor(...), which does NOT propagate ContextVars to the
# worker thread. Without this, the forwarded-header ContextVar set on the
# inbound request task is empty by the time the outbound httpx hook fires,
# and aimock can't match the right fixture for the request.
install_executor_contextvar_propagation()

from agents.agent import stream as default_stream
from agents.a2ui_dynamic import a2ui_dynamic_app
from agents.a2ui_fixed import a2ui_fixed_app
from agents.agent_config_agent import agent_config_app
from agents.beautiful_chat import beautiful_chat_app
from agents.byoc_hashbrown_agent import byoc_hashbrown_app
from agents.byoc_json_render_agent import byoc_json_render_app
from agents.gen_ui_agent import gen_ui_agent_app
from agents.headless_complete import headless_complete_app
from agents.mcp_apps_agent import mcp_apps_app
from agents.multimodal_agent import multimodal_app
from agents.open_gen_ui_advanced_agent import open_gen_ui_advanced_app
from agents.open_gen_ui_agent import open_gen_ui_app
from agents.shared_state_read_write import (
    shared_state_read_write_app,
)
from agents.subagents import subagents_app
from agents.interrupt_agent import interrupt_app
from agents.reasoning_agent import reasoning_app
from agents.tool_rendering_reasoning_chain import (
    tool_rendering_reasoning_chain_app,
)

app = FastAPI(title="AG2 Agent Server")


# Serve /health via middleware so it short-circuits BEFORE route resolution.
# A plain `@app.get("/health")` decorator is shadowed by the subsequent
# `app.mount("/", ...)` call: Starlette's Mount at "/" matches every path
# (including /health) and the decorated route never fires. Middleware runs
# above the routing layer, so the health endpoint stays reachable regardless
# of what the framework-specific AG-UI adapter mounts at root.
class HealthMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request, call_next):
        if request.url.path == "/health" and request.method == "GET":
            return JSONResponse({"status": "ok"})
        return await call_next(request)


# ORDER-CRITICAL: Starlette's ``add_middleware`` is LIFO — the LAST call
# becomes the OUTERMOST layer in the request pipeline. This ordering
# matters because ``BaseHTTPMiddleware`` (HealthMiddleware,
# HeaderForwardingHTTPMiddleware) internally uses anyio TaskGroups that
# can sever ``contextvars.ContextVar`` propagation from outer layers to
# the inner ASGI app. The raw-ASGI ``RequestUserMessageMiddleware`` sets
# a ContextVar that downstream tool handlers must observe, so it MUST
# sit OUTSIDE the BaseHTTPMiddleware layers — i.e. be added LAST so it
# wraps them. CORSMiddleware (also raw ASGI) is added last of all so it
# remains the absolute outermost layer (handles preflight + headers
# before anything else runs).
#
# Resulting outer→inner execution order:
#   CORS → RequestUserMessage → HeaderForwarding → Health → routes/mounts

# Innermost: serve /health via middleware so it short-circuits BEFORE
# route resolution. (Already declared above as HealthMiddleware.)
app.add_middleware(HealthMiddleware)

# Capture inbound CopilotKit `x-*` headers (e.g. `x-aimock-context`) into a
# per-request ContextVar so any outbound LLM/provider httpx call made inside
# the request scope copies them onto its outbound request. The matching
# ``install_httpx_hook(...)`` call lives next to each LLM client
# construction site (see ``agents/agent.py``).
app.add_middleware(HeaderForwardingHTTPMiddleware)

# CVDIAG backend emitter (spec §3 Layer 2) — emits the HTTP-observable backend
# boundaries (request.ingress, sse.first_byte, sse.event, sse.aborted,
# response.complete, error.caught) as structured CVDIAG envelopes. Added here so
# it wraps the Health + HeaderForwarding BaseHTTPMiddleware layers but stays
# INSIDE the outer raw-ASGI RequestUserMessage + CORS layers (CORS remains the
# absolute outermost so preflight is handled first). Gated behind
# ``CVDIAG_BACKEND_EMITTER`` (default OFF, canary-safe) — the middleware
# fast-paths to a bare pass-through when the flag is unset.
app.add_middleware(CvdiagBackendMiddleware)

# R2-A3: Capture the latest user message from each inbound RunAgentInput POST
# into a per-request ContextVar so tool handlers (e.g. generate_a2ui) can read
# the per-request prompt without consulting autogen's shared, race-prone
# ``ConversableAgent.chat_messages`` state. See agents/_request_context.py.
# Added AFTER the BaseHTTPMiddlewares above so it wraps them (raw ASGI on
# the outside preserves ContextVar propagation across the anyio
# TaskGroups they spawn internally).
app.add_middleware(RequestUserMessageMiddleware)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


# Mount per-demo sub-apps FIRST. Starlette's router resolves mounts in
# registration order; the catch-all `/` mount below shadows everything
# under it, so the named mounts must come first.
app.mount("/shared-state-read-write", shared_state_read_write_app)
app.mount("/subagents", subagents_app)
app.mount("/headless-complete", headless_complete_app)
app.mount("/gen-ui-agent", gen_ui_agent_app)
app.mount("/declarative-gen-ui", a2ui_dynamic_app)
app.mount("/a2ui-fixed-schema", a2ui_fixed_app)
app.mount("/beautiful-chat", beautiful_chat_app)
app.mount("/mcp-apps", mcp_apps_app)
# IMPORTANT: mount /open-gen-ui-advanced BEFORE /open-gen-ui — Starlette
# resolves mounts via prefix matching in registration order, so the shorter
# prefix "/open-gen-ui" would shadow "/open-gen-ui-advanced" if it came first.
app.mount("/open-gen-ui-advanced", open_gen_ui_advanced_app)
app.mount("/open-gen-ui", open_gen_ui_app)
app.mount(
    "/tool-rendering-reasoning-chain",
    tool_rendering_reasoning_chain_app,
)
# Reasoning-aware route. AG2's stock AGUIStream emits no REASONING_MESSAGE_*
# events (and autogen drops the model's reasoning_content channel), so the
# reasoning-custom / reasoning-default cells use this custom sub-app instead.
# Mirrors agno's /reasoning/agui mount.
app.mount("/reasoning", reasoning_app)
app.mount("/agent-config", agent_config_app)
app.mount("/multimodal", multimodal_app)
app.mount("/byoc-hashbrown", byoc_hashbrown_app)
app.mount("/byoc-json-render", byoc_json_render_app)

# Interrupt-adapted scheduling agent. Shared by gen-ui-interrupt and
# interrupt-headless demos — backend has tools=[], the frontend provides
# `schedule_meeting` via `useFrontendTool` with an async Promise handler.
app.mount("/interrupt-adapted", interrupt_app)


# Mount the default AG2 AG-UI endpoint at the root.
# `app.mount("/", ...)` is a catch-all Mount that shadows any later route
# decorators, which is why /health is served by HealthMiddleware above
# rather than a `@app.get("/health")` handler registered here.
app.mount("/", default_stream.build_asgi())


def main():
    """Run the uvicorn server.

    ``reload=True`` is gated behind ``DEV_RELOAD=1`` so production
    containers (which set neither var) get a single non-reloading
    process. The reloader spawns a watcher process and re-imports the
    app on every file change, which is appropriate for local dev but
    burns memory + risks half-imported state in prod.
    """
    port = int(os.getenv("PORT", "8000"))
    dev_reload = os.getenv("DEV_RELOAD", "0") == "1"
    uvicorn.run(
        "agent_server:app",
        host="0.0.0.0",
        port=port,
        reload=dev_reload,
    )


if __name__ == "__main__":
    main()
