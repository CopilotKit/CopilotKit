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
import uvicorn
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import JSONResponse
from dotenv import load_dotenv

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

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Sub-path agents — mounted BEFORE the root catch-all ──────────────
# Each demo-specific agent lives at its own sub-path. The matching
# HttpAgent URL in the corresponding TS route points to that sub-path.
app.mount("/open_gen_ui", open_gen_ui_agent.to_ag_ui())
app.mount("/open_gen_ui_advanced", open_gen_ui_advanced_agent.to_ag_ui())
app.mount(
    "/a2ui_dynamic",
    a2ui_dynamic_agent.to_ag_ui(deps=StateDeps(A2UIDynamicState())),
)
app.mount(
    "/a2ui_fixed",
    a2ui_fixed_agent.to_ag_ui(deps=StateDeps(A2UIFixedState())),
)
app.mount(
    "/headless_complete",
    headless_complete_agent.to_ag_ui(deps=StateDeps(HeadlessCompleteState())),
)
app.mount(
    "/beautiful_chat",
    beautiful_chat_agent.to_ag_ui(deps=StateDeps(BeautifulChatState())),
)

# ── BYOC + multimodal + agent-config (PR #4271 demos) ────────────────
app.mount("/byoc_json_render", byoc_json_render_agent.to_ag_ui())
app.mount("/byoc_hashbrown", byoc_hashbrown_agent.to_ag_ui())
app.mount("/multimodal", multimodal_agent.to_ag_ui())
app.mount(
    "/agent_config",
    agent_config_agent.to_ag_ui(deps=StateDeps(AgentConfigState())),
)

# ── Shared state (read + write) and sub-agents ───────────────────────
app.mount(
    "/shared_state_read_write",
    shared_state_read_write_agent.to_ag_ui(
        deps=StateDeps(SharedStateRWState()),
    ),
)
app.mount(
    "/subagents",
    subagents_agent.to_ag_ui(deps=StateDeps(SubagentsState())),
)

# ── Tool-Based Generative UI — chart-viz system prompt ───────────────
app.mount("/gen_ui_tool_based", gen_ui_tool_based_agent.to_ag_ui())

# ── Reasoning trio (gpt-5 reasoning model) ───────────────────────────
# Same reasoning agent backs both `agentic-chat-reasoning` and
# `reasoning-default-render` (custom slot vs built-in slot).
app.mount("/reasoning", reasoning_agent.to_ag_ui())
app.mount(
    "/tool_rendering_reasoning_chain",
    tool_rendering_reasoning_chain_agent.to_ag_ui(),
)

# ── MCP Apps — no-tools agent; runtime mcpApps middleware injects tools
app.mount("/mcp_apps", mcp_apps_agent.to_ag_ui())

# ── In-Chat HITL — frontend-defined `book_call` tool via useHumanInTheLoop
# The agent has no backend tools; the AG-UI bridge surfaces the
# frontend-registered tool to the model on each run.
app.mount("/hitl_in_chat", hitl_in_chat_agent.to_ag_ui())

# ── Interrupt-adapted — scheduling demos (gen-ui-interrupt, interrupt-headless)
# The `schedule_meeting` tool is defined on the frontend via `useFrontendTool`;
# the backend agent has no tools and delegates entirely to the client.
app.mount("/interrupt", interrupt_agent.to_ag_ui())

# ── Main sales agent — mounted at root (catch-all) ───────────────────
# Mounted LAST so the sub-path mounts above win for their specific paths.
ag_ui_app = agent.to_ag_ui(deps=StateDeps(SalesTodosState()))
app.mount("/", ag_ui_app)


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
