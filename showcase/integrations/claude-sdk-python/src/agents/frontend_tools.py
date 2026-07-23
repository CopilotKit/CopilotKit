"""Claude Agent SDK backing the Frontend Tools demo.

The demo illustrates `useFrontendTool` with a sync handler. The frontend
registers a `change_background` tool; CopilotKit forwards its schema to
the agent at runtime and the handler executes in the browser.

The shared Claude backend in `src/agents/agent.py` already accepts
frontend-registered tool schemas via AG-UI message forwarding, so this
module is documentation-only — there is no separate Python graph to
mount for this cell. The agent instance served by `agent_server.py`
handles the `frontend-tools` agent name via the route.ts registration.
"""

# The demo shares the default Claude agent (see src/agents/agent.py).
# This module exists so the manifest's `highlight` paths can point to a
# per-demo Python reference, mirroring the langgraph-python layout.

SYSTEM_PROMPT_HINT = (
    "You are a helpful assistant. The frontend has registered a "
    "`change_background` tool via `useFrontendTool`. When the user asks "
    "to change the background, call that tool with a CSS-valid background "
    "value (prefer gradients)."
)
