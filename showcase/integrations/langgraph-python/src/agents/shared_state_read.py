"""LangGraph agent backing the Shared State (Read-only) demo.

The recipe editor owns `recipe` and publishes every edit with
`agent.setState`. This agent reads that value on every model call and has
no tool that writes it, so the UI stays the only writer.
"""

from typing import Any

from langchain.agents import AgentState as BaseAgentState, create_agent
from langchain_openai import ChatOpenAI

from copilotkit import CopilotKitMiddleware


# @region[shared-state-read-agent]
class AgentState(BaseAgentState):
    # Written only by the UI. Declaring the key is what lets a run carry it:
    # the LangGraph adapter sends only the keys in the graph's input schema.
    recipe: dict[str, Any]


graph = create_agent(
    model=ChatOpenAI(model="gpt-5.4"),
    tools=[],
    # expose_state appends the current `recipe` to the system prompt on
    # every model call. It is off by default.
    middleware=[CopilotKitMiddleware(expose_state=["recipe"])],
    state_schema=AgentState,
    system_prompt=(
        "You are a helpful, concise recipe assistant. The user edits the "
        "recipe in the app, and its current value is included below as "
        "agent state. Base every answer on that recipe. You cannot change "
        "it; suggest edits for the user to make instead."
    ),
)
# @endregion[shared-state-read-agent]
