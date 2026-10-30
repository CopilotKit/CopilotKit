"""A plain Google ADK agent that answers with your app's UI.

It has no A2UI code. The CopilotKit runtime in front of it (see
`src/app/api/adk/[[...slug]]/route.ts`) reads the catalog the browser sends
with every run and adds two things to the AG-UI request:

- a `render_ui` tool, which `AGUIToolset()` declares to the model;
- the generative UI guide (the catalog's components and the A2UI v1.0
  operation format), which arrives as AG-UI context and is appended to the
  instruction below.

When the model calls `render_ui`, the runtime validates each A2UI operation
against the catalog and streams it to the browser, which renders it with your
React components.
"""

import os

from ag_ui_adk import CONTEXT_STATE_KEY, AGUIToolset
from google.adk.agents import LlmAgent
from google.adk.agents.readonly_context import ReadonlyContext

MODEL = os.getenv("ADK_MODEL", "gemini-3.5-flash")

INSTRUCTION = """You are a helpful assistant that answers with UI.
For every request, call the render_ui tool with A2UI v1.0 operations built
only from the components in the generative UI guide below. Keep any text
reply to one short sentence."""


def instruction(ctx: ReadonlyContext) -> str:
    """The base instruction plus the AG-UI context the client sent with the run.

    An instruction provider (a function, not a string) also stops ADK from
    treating the guide's JSON braces as `{state}` placeholders.
    """
    parts = [INSTRUCTION]
    for item in ctx.state.get(CONTEXT_STATE_KEY, []):
        parts.append(f"## {item['description']}\n\n{item['value']}")
    return "\n\n".join(parts)


root_agent = LlmAgent(
    name="a2ui_adk_agent",
    model=MODEL,
    description="Answers with generative UI built from the app's catalog.",
    instruction=instruction,
    # The tools the client sends with the run (here: the runtime's render_ui).
    tools=[AGUIToolset()],
)
