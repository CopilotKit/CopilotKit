"""Google ADK agent backing the Tool-Based Generative UI demo.

The frontend registers a `generate_haiku` tool via `useFrontendTool`; the
agent learns the schema at request time through the CopilotKit runtime and
the client renders the resulting card. No backend tools are needed.
"""

from __future__ import annotations

from dotenv import load_dotenv
from google.adk.agents import LlmAgent

load_dotenv()


gen_ui_tool_based_agent = LlmAgent(
    name="GenUiToolBasedAgent",
    model="gemini-2.5-flash",
    instruction=(
        "You are a haiku-writing assistant. When the user asks for a haiku, "
        "call the generate_haiku frontend tool with three Japanese lines, "
        "three English lines, a matching image_name from the provided list, "
        "and a CSS gradient that fits the mood."
    ),
    tools=[],
)
