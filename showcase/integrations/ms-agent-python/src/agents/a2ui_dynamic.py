"""
MS Agent Framework agent for the Declarative Generative UI (A2UI — Dynamic Schema) demo.

Native A2UI auto-injection (mirrors the LangGraph reference
`showcase/integrations/langgraph-python/src/agents/a2ui_dynamic.py`): the agent
binds NO A2UI tool of its own. The dedicated route
(`src/app/api/copilotkit-declarative-gen-ui/route.ts`) enables the A2UI catalog
on the provider, so the CopilotKit runtime forwards `injectA2UITool: true`. The
Microsoft Agent Framework adapter's `plan_a2ui_injection` then auto-injects the
native `generate_a2ui` tool, whose body runs the `render_a2ui` sub-agent + the
shared toolkit (progressive streaming + validate/retry recovery) in-process.

Unlike the pre-1.2.0 showcase demo, there is no hand-rolled `generate_a2ui`
here: the adapter (agent-framework-ag-ui[a2ui] >= 1.2.0) owns the whole thing.
The MAF auto-inject path is opt-in via the agent NOT already owning
`generate_a2ui` — `plan_a2ui_injection` prevails to the developer's wiring, so
binding a `generate_a2ui` tool here would suppress auto-injection.
"""

from __future__ import annotations

from agent_framework import Agent, BaseChatClient
from agent_framework_ag_ui import AgentFrameworkAgent

from _shared.a2ui_sales import SALES_ANALYST_PROMPT


SYSTEM_PROMPT = (
    SALES_ANALYST_PROMPT + " For a new surface, call `generate_a2ui` without arguments."
)


def create_agent(chat_client: BaseChatClient) -> AgentFrameworkAgent:
    """Instantiate the MS-Agent-backed declarative-gen-ui agent.

    The agent has no tools: the runtime forwards `injectA2UITool: true`
    (catalog-on-provider default) and the adapter auto-injects the native
    `generate_a2ui` sub-agent. `chat_client` is a Chat-Completions client
    (`OpenAIChatCompletionClient`), which the adapter reuses for the render
    sub-agent so its `render_a2ui` arguments stream progressively.
    """
    base_agent = Agent(
        client=chat_client,
        name="declarative_gen_ui_agent",
        instructions=SYSTEM_PROMPT,
    )

    return AgentFrameworkAgent(
        agent=base_agent,
        name="CopilotKitMicrosoftAgentFrameworkAgent",
        description="Dynamic A2UI generator that designs rich UI surfaces on demand.",
        require_confirmation=False,
    )
