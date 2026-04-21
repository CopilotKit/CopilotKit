"""LangGraph agent backing the Shared State (Agent Read-Only) demo.

Demonstrates the `useAgentContext` hook from @copilotkit/react-core/v2:
the frontend provides READ-ONLY context *to* the agent. This is the
reverse direction of writable-shared-state — the UI cannot be edited by
the agent, but the agent reads this context on every turn via
`CopilotKitMiddleware`, which routes the context entries into the
model's message history.

No custom state, no tools: this is the minimal shape of the
useAgentContext pattern. The agent just reads whatever context the
frontend registered and answers accordingly.
"""

from langchain.agents import create_agent
from langchain_openai import ChatOpenAI

from copilotkit import CopilotKitMiddleware

graph = create_agent(
    model=ChatOpenAI(model="gpt-4o-mini"),
    tools=[],
    middleware=[CopilotKitMiddleware()],
    system_prompt=(
        "You are a helpful, concise assistant. The frontend may provide "
        "read-only context about the user (e.g. name, timezone, recent "
        "activity) via the `useAgentContext` hook. Always consult that "
        "context when it is relevant — address the user by name if known, "
        "respect their timezone when mentioning times, and reference "
        "recent activity when it helps you answer. Keep responses short."
    ),
)
