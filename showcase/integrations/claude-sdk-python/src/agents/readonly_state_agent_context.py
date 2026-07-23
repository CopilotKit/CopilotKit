"""Claude Agent SDK backing the Readonly State (Agent Context) demo.

Demonstrates the `useAgentContext` hook from @copilotkit/react-core/v2:
the frontend provides READ-ONLY context *to* the agent. The UI cannot
be edited by the agent, but the agent reads this context on every turn
via the CopilotKit runtime, which routes the context entries into the
model's message history.

The shared Claude backend in `src/agents/agent.py` handles this demo via
the `readonly-state-agent-context` agent name registered in the
copilotkit route. This module exists so the manifest's `highlight` path
references a per-demo Python reference, mirroring the langgraph-python
layout.
"""

SYSTEM_PROMPT_HINT = (
    "You are a helpful, concise assistant. The frontend may provide "
    "read-only context about the user (e.g. name, timezone, recent "
    "activity) via the `useAgentContext` hook. Always consult that "
    "context when it is relevant — address the user by name if known, "
    "respect their timezone when mentioning times, and reference "
    "recent activity when it helps you answer. Keep responses short."
)
