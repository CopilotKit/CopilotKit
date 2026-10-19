"""readonly-state-agent-context: the model reads the page's useAgentContext values.

The page publishes the user's name, timezone and recent activity with
``useAgentContext``, which reaches the agent as ``RunAgentInput.context``.
langgraph-python's ``CopilotKitMiddleware`` folds those entries into the
prompt on every turn. Antigravity fixes the instructions per session and the
adapter forwards only user messages, so here the model pulls them instead
through the adapter's silent built-in ``get_app_context()`` tool, which
returns the current run's entries as ``[{"description", "value"}]``. It
emits no TOOL_CALL events, so no card appears in the chat, and the model has
no tool that could write the values back: the context stays read-only.
"""

from agents._common import build

# @region[agent-context-setup]
SYSTEM_PROMPT = (
    "You are a helpful, concise assistant. The app shares read-only context "
    "about the user (e.g. name, timezone, recent activity). Call "
    "`get_app_context` before every answer to read the latest values, then "
    "consult them when they are relevant: address the user by name if "
    "known, respect their timezone when mentioning times, and reference "
    "recent activity when it helps you answer. Keep responses short."
)


def app_context_agent():
    return build(system_instructions=SYSTEM_PROMPT, experimental_app_context=True)


# @endregion[agent-context-setup]
