"""
Agent Server for MS Agent Framework (Python)

FastAPI server that hosts the Microsoft Agent Framework agent backend.
The Next.js CopilotKit runtime proxies requests here via AG-UI protocol.
"""

from __future__ import annotations

import os

# CVDIAG bootstrap — MUST be the first non-stdlib import (folded in from the
# dropped L1-H slot). Importing this module configures the root logger via
# ``logging.basicConfig`` so the ``agents._header_forwarding`` (and sibling
# ``agents.*``) CVDIAG loggers actually EMIT (fixes the silent-drop bug), and
# resolves the verbosity tier + PB writer. It imports pydantic/starlette only
# (NOT agent_framework), so it is safe to run before the agent imports below.
import _shared.cvdiag_bootstrap  # noqa: F401,E402  (first non-stdlib import — bootstrap side effects)

# ORDER-CRITICAL: install the global httpx hook BEFORE any agent module /
# agent_framework / agent_framework_openai imports. The
# ``OpenAIChatCompletionClient`` constructs its httpx client at
# ``_build_chat_client()`` time below — which runs at module-import scope
# (line ~79) — so the patch must be in place before that import resolves.
from agents._cvdiag_backend import CvdiagBackendMiddleware
from agents._header_forwarding import (
    HeaderForwardingHTTPMiddleware,
    install_executor_contextvar_propagation,
    install_global_httpx_hook,
)

install_global_httpx_hook()
# agent_framework dispatches SYNC tools (e.g. the declarative gen-ui
# `generate_a2ui` tool, which makes a secondary OpenAI call) onto the
# default ThreadPoolExecutor via loop.run_in_executor(...), which does NOT
# propagate ContextVars to the worker thread. Without this, the
# forwarded-header ContextVar set on the inbound request task is empty by
# the time the secondary call's outbound httpx hook fires, and aimock
# can't match the right fixture for the request.
install_executor_contextvar_propagation()

import uvicorn
from agent_framework import BaseChatClient
from agent_framework_openai import OpenAIChatCompletionClient
from agent_framework_ag_ui import add_agent_framework_fastapi_endpoint
from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import JSONResponse

from agents.agent import create_agent
from agents.voice_agent import create_voice_agent
from agents.a2ui_dynamic import create_agent as create_a2ui_dynamic_agent
from agents.a2ui_fixed import create_agent as create_a2ui_fixed_agent
from agents.agent_config_agent import create_agent_config_agent
from agents.beautiful_chat import create_beautiful_chat_agent
from agents.byoc_hashbrown_agent import create_byoc_hashbrown_agent
from agents.byoc_json_render_agent import create_byoc_json_render_agent
from agents.gen_ui_agent import create_gen_ui_agent
from agents.gen_ui_tool_based_agent import create_gen_ui_tool_based_agent
from agents.headless_complete_agent import create_headless_complete_agent
from agents.hitl_in_app_agent import create_hitl_in_app_agent
from agents.hitl_in_chat_agent import create_hitl_in_chat_agent
from agents.interrupt_agent import create_interrupt_agent
from agents.mcp_apps_agent import create_mcp_apps_agent
from agents.multimodal_agent import create_multimodal_agent
from agents.open_gen_ui_advanced_agent import create_open_gen_ui_advanced_agent
from agents.open_gen_ui_agent import create_open_gen_ui_agent
from agents.readonly_state_agent_context import create_readonly_state_agent_context
from agents.reasoning_agent import create_reasoning_agent
from agents.shared_state_read_write_agent import (
    create_shared_state_read_write_agent,
)
from agents.shared_state_streaming import create_shared_state_streaming_agent
from agents.subagents_agent import create_subagents_agent
from agents.tool_rendering_agent import create_tool_rendering_agent
from agents.tool_rendering_reasoning_chain_agent import (
    create_tool_rendering_reasoning_chain_agent,
)

load_dotenv()


def _build_chat_client(model_override: str | None = None) -> BaseChatClient:
    # Use ChatCompletions, not Responses. The Responses API is stateful and
    # only sends NEW items per leg (relying on `previous_response_id` for
    # history); aimock has no view of that server-side state, so second-leg
    # requests arrive without the user message — fixture matchers keyed on
    # `userMessage` can't fire and the run falls through to real OpenAI.
    # ChatCompletions sends full message history on every call, matching the
    # LangGraph Python reference and letting the shared aimock fixtures match.
    try:
        if bool(os.getenv("OPENAI_API_KEY")):
            return OpenAIChatCompletionClient(
                model=model_override
                or os.getenv("OPENAI_CHAT_MODEL_ID", "gpt-4o-mini"),
                api_key=os.getenv("OPENAI_API_KEY"),
            )

        raise ValueError("OPENAI_API_KEY environment variable is required")

    except Exception as exc:
        raise RuntimeError(
            "Unable to initialize the chat client. Double-check your API credentials."
        ) from exc


chat_client = _build_chat_client()
my_agent = create_agent(chat_client)
voice_agent = create_voice_agent(chat_client)
agent_config_agent = create_agent_config_agent(chat_client)
reasoning_agent = create_reasoning_agent()
readonly_state_agent_context = create_readonly_state_agent_context(chat_client)
shared_state_streaming_agent = create_shared_state_streaming_agent(chat_client)
tool_rendering_agent = create_tool_rendering_agent(chat_client)
tool_rendering_reasoning_chain_agent = create_tool_rendering_reasoning_chain_agent(
    chat_client
)
a2ui_dynamic_agent = create_a2ui_dynamic_agent(chat_client)
a2ui_fixed_agent = create_a2ui_fixed_agent(chat_client)
open_gen_ui_agent = create_open_gen_ui_agent(chat_client)
open_gen_ui_advanced_agent = create_open_gen_ui_advanced_agent(chat_client)
byoc_hashbrown_agent = create_byoc_hashbrown_agent(chat_client)
byoc_json_render_agent = create_byoc_json_render_agent(chat_client)
mcp_apps_agent = create_mcp_apps_agent(chat_client)
gen_ui_agent = create_gen_ui_agent(chat_client)
gen_ui_tool_based_agent = create_gen_ui_tool_based_agent(chat_client)
headless_complete_agent = create_headless_complete_agent(chat_client)
hitl_in_app_agent = create_hitl_in_app_agent(chat_client)
hitl_in_chat_agent = create_hitl_in_chat_agent(chat_client)
interrupt_agent = create_interrupt_agent(chat_client)
shared_state_read_write_agent = create_shared_state_read_write_agent(chat_client)
subagents_agent = create_subagents_agent(chat_client)

# Multimodal: vision-capable; gpt-4o-mini natively handles `image` parts.
# Scoped to its own endpoint so other demos don't silently upgrade to vision.
multimodal_chat_client = _build_chat_client("gpt-4o-mini")
multimodal_agent = create_multimodal_agent(multimodal_chat_client)

# Beautiful Chat: flagship polished sales dashboard demo. Combines A2UI
# (fixed + dynamic), Open Generative UI, shared-state todos, and HITL.
beautiful_chat_agent = create_beautiful_chat_agent(chat_client)

app = FastAPI(title="CopilotKit + Microsoft Agent Framework (Python)")


# Serve /health via middleware so it short-circuits BEFORE route resolution.
# `add_agent_framework_fastapi_endpoint(..., path="/")` installs a catch-all
# at the root that shadows any later `@app.get("/health")` decorator.
# Middleware runs above the routing layer, so /health stays reachable.
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

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# CVDIAG backend emitter (spec §3 Layer 2) — emits the HTTP-observable backend
# boundaries (request.ingress, sse.first_byte, sse.event, sse.aborted,
# response.complete, error.caught) as structured CVDIAG envelopes. Added LAST so
# it is the OUTERMOST layer: it observes ingress before any inner layer mutates
# the request and wraps the response stream so SSE boundaries fire as chunks
# flow. Gated behind ``CVDIAG_BACKEND_EMITTER`` (default OFF, canary-safe) — the
# middleware fast-paths to a bare pass-through when the flag is unset.
app.add_middleware(CvdiagBackendMiddleware)

# IMPORTANT: mount specific-path agents BEFORE the catch-all `/` agent.
# `add_agent_framework_fastapi_endpoint(..., path="/")` installs a catch-all
# at the root that shadows any route registered AFTER it. FastAPI resolves
# routes in registration order, so specific paths must come first.

add_agent_framework_fastapi_endpoint(
    app=app, agent=multimodal_agent, path="/multimodal"
)
add_agent_framework_fastapi_endpoint(
    app=app, agent=beautiful_chat_agent, path="/beautiful-chat"
)
add_agent_framework_fastapi_endpoint(
    app=app, agent=agent_config_agent, path="/agent-config"
)
add_agent_framework_fastapi_endpoint(app=app, agent=reasoning_agent, path="/reasoning")
add_agent_framework_fastapi_endpoint(
    app=app, agent=tool_rendering_agent, path="/tool-rendering"
)
add_agent_framework_fastapi_endpoint(
    app=app,
    agent=tool_rendering_reasoning_chain_agent,
    path="/tool-rendering-reasoning-chain",
)
add_agent_framework_fastapi_endpoint(
    app=app, agent=a2ui_dynamic_agent, path="/a2ui_dynamic"
)
add_agent_framework_fastapi_endpoint(
    app=app, agent=a2ui_fixed_agent, path="/a2ui_fixed"
)
add_agent_framework_fastapi_endpoint(
    app=app, agent=open_gen_ui_agent, path="/open-gen-ui"
)
add_agent_framework_fastapi_endpoint(
    app=app, agent=open_gen_ui_advanced_agent, path="/open-gen-ui-advanced"
)
add_agent_framework_fastapi_endpoint(
    app=app, agent=byoc_hashbrown_agent, path="/byoc-hashbrown"
)
add_agent_framework_fastapi_endpoint(
    app=app, agent=byoc_json_render_agent, path="/byoc-json-render"
)
add_agent_framework_fastapi_endpoint(app=app, agent=mcp_apps_agent, path="/mcp-apps")
add_agent_framework_fastapi_endpoint(
    app=app, agent=hitl_in_app_agent, path="/hitl-in-app"
)
add_agent_framework_fastapi_endpoint(
    app=app, agent=hitl_in_chat_agent, path="/hitl-in-chat"
)
add_agent_framework_fastapi_endpoint(app=app, agent=gen_ui_agent, path="/gen-ui-agent")
add_agent_framework_fastapi_endpoint(
    app=app, agent=gen_ui_tool_based_agent, path="/gen-ui-tool-based"
)
add_agent_framework_fastapi_endpoint(
    app=app, agent=headless_complete_agent, path="/headless-complete"
)
add_agent_framework_fastapi_endpoint(
    app=app, agent=interrupt_agent, path="/interrupt-adapted"
)
add_agent_framework_fastapi_endpoint(
    app=app, agent=shared_state_read_write_agent, path="/shared-state-read-write"
)
add_agent_framework_fastapi_endpoint(
    app=app,
    agent=shared_state_streaming_agent,
    path="/shared-state-streaming",
)
add_agent_framework_fastapi_endpoint(
    app=app,
    agent=readonly_state_agent_context,
    path="/readonly-state-agent-context",
)
add_agent_framework_fastapi_endpoint(app=app, agent=subagents_agent, path="/subagents")
add_agent_framework_fastapi_endpoint(app=app, agent=voice_agent, path="/voice")

# Shared agent for the rest of the demos (must be last: `/` is a catch-all).
add_agent_framework_fastapi_endpoint(app=app, agent=my_agent, path="/")


def main():
    """Run the uvicorn server."""
    host = os.getenv("AGENT_HOST", "0.0.0.0")
    port = int(os.getenv("AGENT_PORT", "8000"))
    uvicorn.run("agent_server:app", host=host, port=port, reload=True)


if __name__ == "__main__":
    main()
