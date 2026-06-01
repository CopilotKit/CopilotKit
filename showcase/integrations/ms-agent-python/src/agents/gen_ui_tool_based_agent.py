"""MS Agent Framework agent backing the Tool-Based Generative UI demo.

The frontend registers `render_bar_chart` and `render_pie_chart` tools via
`useComponent`. CopilotKit's runtime forwards those frontend tool definitions
to the agent at request time, so the agent can call them by name.

There are no backend tools here -- the agent's job is to recognize chart
intent in the user's message and emit a tool call with structured chart data.
The frontend then renders the result inline.
"""

from __future__ import annotations

from textwrap import dedent

from agent_framework import Agent, BaseChatClient
from agent_framework_ag_ui import AgentFrameworkAgent


SYSTEM_PROMPT = dedent(
    """
    You are a data visualization assistant.

    When the user asks for a chart, call `render_bar_chart` or
    `render_pie_chart` with a concise title, short description, and a `data`
    array of `{label, value}` items. Pick bar for comparisons over a small set
    of categories; pick pie for composition / share-of-whole.

    Keep chat responses brief -- let the chart do the talking. After you
    finish executing tools, send a brief final assistant message so it
    persists in the conversation.
    """
).strip()


def create_gen_ui_tool_based_agent(chat_client: BaseChatClient) -> AgentFrameworkAgent:
    """Instantiate the Tool-Based Generative UI demo agent."""
    base_agent = Agent(
        client=chat_client,
        name="gen_ui_tool_based_agent",
        instructions=SYSTEM_PROMPT,
        # Both rendering tools (`render_bar_chart`, `render_pie_chart`) are
        # registered on the frontend via `useComponent`. The runtime forwards
        # them as tool definitions at request time.
        tools=[],
    )

    return AgentFrameworkAgent(
        agent=base_agent,
        name="CopilotKitMSAgentGenUiToolBasedAgent",
        description=(
            "Data-visualization assistant that turns chart requests into "
            "frontend-rendered bar and pie charts via tool calls."
        ),
        require_confirmation=False,
    )
