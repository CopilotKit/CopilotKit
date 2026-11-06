"""readonly-state-agent-context: the model reads the page's useAgentContext values.

The page publishes the user's name, timezone and recent activity with
``useAgentContext``; they reach the agent as ``RunAgentInput.context``, and
the adapter appends them to the instructions before every model call, as
langgraph-python's ``CopilotKitMiddleware`` does. The agent has no tool that
could write them back: the context stays read-only.
"""

from agents import Agent

from demo_agents._common import MODEL

# @region[agent-context-setup]
SYSTEM_PROMPT = (
    "You are a helpful, concise assistant. The frontend may provide "
    "read-only context about the user (e.g. name, timezone, recent "
    "activity) via the `useAgentContext` hook. Always consult that "
    "context when it is relevant — address the user by name if known, "
    "respect their timezone when mentioning times, and reference "
    "recent activity when it helps you answer. Keep responses short."
)


app_context_agent = Agent(
    name="context_assistant",
    instructions=SYSTEM_PROMPT,
    model=MODEL,
)


# @endregion[agent-context-setup]
