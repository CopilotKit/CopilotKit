"""Agent backing the Tool-Based Generative UI demo.

The agent has no backend tools; the frontend registers `generate_haiku` (or
similar) via `useFrontendTool({ render })` so the agent calls it and the
React-side renderer paints the result.
"""

from __future__ import annotations

from google.adk.agents import LlmAgent

_INSTRUCTION = (
    "You are a helpful assistant that generates richly-formatted UI via "
    "frontend tools. When the user asks for a haiku, call the generate_haiku "
    "tool with three lines in Japanese, three lines translated to English, "
    "a fitting image_name, and a CSS gradient string for the background. "
    "Always invoke the tool — never answer with plain text when a tool is "
    "available."
)

gen_ui_tool_based_agent = LlmAgent(
    name="GenUiToolBasedAgent",
    model="gemini-2.5-flash",
    instruction=_INSTRUCTION,
    tools=[],
)
