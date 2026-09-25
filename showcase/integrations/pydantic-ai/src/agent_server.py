"""
Agent Server for PydanticAI

FastAPI server that hosts the PydanticAI agent backend. The Next.js
CopilotKit runtime proxies requests here via the AG-UI protocol.

Layout:
- `/`                          main sales agent (all B1-ported demos)
- `/open_gen_ui`               Open Generative UI — minimal
- `/open_gen_ui_advanced`      Open Generative UI — with sandbox functions
- `/a2ui_dynamic`              Declarative Generative UI (A2UI dynamic)
- `/a2ui_fixed`                A2UI fixed-schema (flight card)
- `/headless_complete`         Headless-complete custom chat agent
- `/beautiful_chat`            Beautiful-chat flagship aliasing the main agent
- `/byoc_json_render`          BYOC json-render demo
- `/byoc_hashbrown`            BYOC hashbrown demo
- `/multimodal`                Multimodal attachments (image/PDF)
- `/agent_config`              Agent-config forwarded-props demo
- `/shared_state_read_write`   Shared State (Read + Write) — bidirectional state
- `/subagents`                 Sub-Agents — supervisor + 3 specialists

Sub-paths are mounted BEFORE the root catch-all so Starlette resolves
them first. The existing single-agent behaviour at `/` is preserved for
all demos that already target the main sales agent.
"""

import os

# CVDIAG bootstrap — MUST be the first non-stdlib import (folded in from the
# dropped L1-H slot). Importing this module configures the root logger via
# ``logging.basicConfig`` so the ``agents._header_forwarding`` (and sibling
# ``agents.*``) CVDIAG loggers actually EMIT (fixes the silent-drop bug), and
# resolves the verbosity tier + PB writer. It imports pydantic/starlette only
# (NOT pydantic-ai), so it is safe to run before the agent imports below.
import _shared.cvdiag_bootstrap  # noqa: F401,E402  (first non-stdlib import — bootstrap side effects)

import uvicorn
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from starlette.applications import Starlette
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import JSONResponse, Response
from dotenv import load_dotenv

# ORDER-CRITICAL: install the global httpx hook BEFORE any agent module
# imports. PydanticAI's ``OpenAIResponsesModel`` constructs its httpx
# client at agent-module import time.
from agents._cvdiag_backend import CvdiagBackendMiddleware
from agents._header_forwarding import (
    HeaderForwardingHTTPMiddleware,
    install_executor_contextvar_propagation,
    install_global_httpx_hook,
)

install_global_httpx_hook()
# PydanticAI dispatches SYNC tools (e.g. the declarative gen-ui
# `generate_a2ui` tool, which makes a secondary OpenAI call) onto the
# default ThreadPoolExecutor via loop.run_in_executor(...), which does NOT
# propagate ContextVars to the worker thread. Without this, the
# forwarded-header ContextVar set on the inbound request task is empty by
# the time the secondary call's outbound httpx hook fires, and aimock
# can't match the right fixture for the request.
install_executor_contextvar_propagation()

# Imported below the hook install for the same reason as the agent modules:
# nothing that pulls in PydanticAI may precede install_global_httpx_hook().
from pydantic_ai.ui.ag_ui import AGUIAdapter

from agents.agent import SalesTodosState, StateDeps, agent
from agents.open_gen_ui_agent import agent as open_gen_ui_agent
from agents.open_gen_ui_advanced_agent import agent as open_gen_ui_advanced_agent
from agents.a2ui_dynamic import EmptyState as A2UIDynamicState
from agents.a2ui_dynamic import agent as a2ui_dynamic_agent
from agents.a2ui_fixed import EmptyState as A2UIFixedState
from agents.a2ui_fixed import agent as a2ui_fixed_agent
from agents.headless_complete import EmptyState as HeadlessCompleteState
from agents.headless_complete import agent as headless_complete_agent
from agents.beautiful_chat import BeautifulChatState
from agents.beautiful_chat import agent as beautiful_chat_agent
from agents.byoc_json_render_agent import agent as byoc_json_render_agent
from agents.byoc_hashbrown_agent import agent as byoc_hashbrown_agent
from agents.multimodal_agent import agent as multimodal_agent
from agents.agent_config_agent import AgentConfigState
from agents.agent_config_agent import agent as agent_config_agent
from agents.shared_state_read_write import SharedStateRWState
from agents.shared_state_read_write import agent as shared_state_read_write_agent
from agents.subagents import SubagentsState
from agents.subagents import agent as subagents_agent
from agents.gen_ui_tool_based import agent as gen_ui_tool_based_agent
from agents.reasoning_agent import agent as reasoning_agent
from agents.tool_rendering_reasoning_chain_agent import (
    agent as tool_rendering_reasoning_chain_agent,
)
from agents.mcp_apps_agent import agent as mcp_apps_agent
from agents.hitl_in_chat_agent import agent as hitl_in_chat_agent
from agents.interrupt_agent import agent as interrupt_agent

load_dotenv()

app = FastAPI(title="PydanticAI Agent Server")


# Serve /health via middleware so it short-circuits BEFORE route resolution.
# `app.mount("/", ag_ui_app)` installs a Starlette Mount at the root that
# matches every path (including /health). A plain `@app.get("/health")`
# decorator registered before the mount was still shadowed in practice because
# Mount at "/" is a prefix match rather than an exact one. Middleware runs
# above the routing layer, which guarantees /health stays reachable.
class HealthMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request, call_next):
        if request.url.path == "/health" and request.method == "GET":
            return JSONResponse({"status": "ok"})
        return await call_next(request)


app.add_middleware(HealthMiddleware)

# Capture inbound CopilotKit ``x-*`` headers (e.g. ``x-aimock-context``)
# into a per-request ContextVar so any outbound LLM/provider httpx call
# made inside the request scope copies them onto its outbound request.
# Paired with ``install_global_httpx_hook`` at the top of this file.
app.add_middleware(HeaderForwardingHTTPMiddleware)

# CVDIAG backend emitter (spec §3 Layer 2) — emits the HTTP-observable backend
# boundaries (request.ingress, sse.first_byte, sse.event, sse.aborted,
# response.complete, error.caught) as structured CVDIAG envelopes. Added here so
# it wraps the Health + HeaderForwarding layers but stays INSIDE the outermost
# CORS layer (CORS handles preflight first). Gated behind
# ``CVDIAG_BACKEND_EMITTER`` (default OFF, canary-safe) — the middleware
# fast-paths to a bare pass-through when the flag is unset.
app.add_middleware(CvdiagBackendMiddleware)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


def mount_agent(path, agent_obj, state_type=None):
    """Mount ``agent_obj`` at ``path`` as an AG-UI endpoint.

    Replaces PydanticAI v1's ``agent.to_ag_ui()``, removed in v2.

    ROUTING is deliberately identical to what ``AGUIApp`` produced — a Starlette
    app whose only route is ``POST /`` — so every mount path, including its
    trailing slash, resolves exactly as before and the TS routes that call these
    as ``${AGENT_URL}/<path>/`` need no change.

    Model INPUT is not identical, and deliberately so. v2's ``dispatch_request``
    defaults to ``manage_system_prompt='server'``, so each agent's
    ``system_prompt=`` and ``@agent.system_prompt`` now actually reach the model.
    On v1 they never did: ``_agent_graph`` only emitted system parts ``if not
    messages``, and the AG-UI bridge always supplied a non-empty history, so the
    declared prompts were silently dead. Passing
    ``manage_system_prompt='client'`` would restore literal v1 behaviour — i.e.
    reinstate that bug — so we do not.

    ``deps`` is built per request on purpose. v2's adapter assigns the client's
    state onto ``deps.state`` (``pydantic_ai/ui/_adapter.py``) rather than
    replacing the deps object as v1 did, so a single shared instance would let
    concurrent runs overwrite each other's state mid-run.
    """

    async def endpoint(request: Request) -> Response:
        deps = StateDeps(state_type()) if state_type is not None else None
        return await AGUIAdapter.dispatch_request(request, agent=agent_obj, deps=deps)

    sub = Starlette()
    sub.router.add_route("/", endpoint, methods=["POST"], name="run_agent")
    app.mount(path, sub)


# ── Sub-path agents — mounted BEFORE the root catch-all ──────────────
# Each demo-specific agent lives at its own sub-path. The matching
# HttpAgent URL in the corresponding TS route points to that sub-path.
mount_agent("/open_gen_ui", open_gen_ui_agent)
mount_agent("/open_gen_ui_advanced", open_gen_ui_advanced_agent)
mount_agent("/a2ui_dynamic", a2ui_dynamic_agent, A2UIDynamicState)
mount_agent("/a2ui_fixed", a2ui_fixed_agent, A2UIFixedState)
mount_agent("/headless_complete", headless_complete_agent, HeadlessCompleteState)
mount_agent("/beautiful_chat", beautiful_chat_agent, BeautifulChatState)

# ── BYOC + multimodal + agent-config (PR #4271 demos) ────────────────
mount_agent("/byoc_json_render", byoc_json_render_agent)
mount_agent("/byoc_hashbrown", byoc_hashbrown_agent)
mount_agent("/multimodal", multimodal_agent)
mount_agent("/agent_config", agent_config_agent, AgentConfigState)

# ── Shared state (read + write) and sub-agents ───────────────────────
mount_agent(
    "/shared_state_read_write", shared_state_read_write_agent, SharedStateRWState
)
mount_agent("/subagents", subagents_agent, SubagentsState)

# ── Tool-Based Generative UI — chart-viz system prompt ───────────────
mount_agent("/gen_ui_tool_based", gen_ui_tool_based_agent)

# ── Reasoning trio (gpt-5 reasoning model) ───────────────────────────
# Same reasoning agent backs both `agentic-chat-reasoning` and
# `reasoning-default-render` (custom slot vs built-in slot).
mount_agent("/reasoning", reasoning_agent)
mount_agent("/tool_rendering_reasoning_chain", tool_rendering_reasoning_chain_agent)

# ── MCP Apps — no-tools agent; runtime mcpApps middleware injects tools
mount_agent("/mcp_apps", mcp_apps_agent)

# ── In-Chat HITL — frontend-defined `book_call` tool via useHumanInTheLoop
# The agent has no backend tools; the AG-UI bridge surfaces the
# frontend-registered tool to the model on each run.
mount_agent("/hitl_in_chat", hitl_in_chat_agent)

# ── Interrupt-adapted — scheduling demos (gen-ui-interrupt, interrupt-headless)
# The `schedule_meeting` tool is defined on the frontend via `useFrontendTool`;
# the backend agent has no tools and delegates entirely to the client.
mount_agent("/interrupt", interrupt_agent)

# ── Main sales agent — mounted at root (catch-all) ───────────────────
# Mounted LAST so the sub-path mounts above win for their specific paths.
mount_agent("/", agent, SalesTodosState)


def main():
    """Run the uvicorn server."""
    port = int(os.getenv("PORT", "8000"))
    uvicorn.run(
        "agent_server:app",
        host="0.0.0.0",
        port=port,
        reload=True,
    )


if __name__ == "__main__":
    main()
