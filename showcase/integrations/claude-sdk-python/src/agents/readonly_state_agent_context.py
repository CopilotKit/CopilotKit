"""Claude Agent SDK backing the Readonly State (Agent Context) demo.

Demonstrates the `useAgentContext` hook from @copilotkit/react-core/v2:
the frontend provides READ-ONLY context *to* the agent. The UI cannot
be edited by the agent, but the agent reads this context on every turn
via the CopilotKit runtime, which routes the context entries into the
model's message history.

Mirrors langgraph-python's dedicated `readonly_state_agent_context`
graph, which is `tools=[]` plus the system prompt below. Here that same
prompt drives the dedicated `/readonly-state-agent-context` endpoint in
`src/agent_server.py` (with `tools_override=[]`); the copilotkit route
maps the `readonly-state-agent-context` agent name to that path via
`dedicatedAgentPaths`. The demo registers no tools of its own on either
side — reading the context the frontend published is the whole feature.
"""

SYSTEM_PROMPT_HINT = (
    "You are a helpful, concise assistant. The frontend may provide "
    "read-only context about the user (e.g. name, timezone, recent "
    "activity) via the `useAgentContext` hook. Always consult that "
    "context when it is relevant — address the user by name if known, "
    "respect their timezone when mentioning times, and reference "
    "recent activity when it helps you answer. Keep responses short."
)
