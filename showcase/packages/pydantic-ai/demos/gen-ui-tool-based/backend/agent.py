"""PydanticAI agent for the Tool-Based Generative UI cell.

The actual generate_haiku tool is registered on the frontend via
useFrontendTool; this agent just needs to answer prompts and let the
frontend tool surface naturally (CopilotKit injects the tool schema
at runtime).
"""

from __future__ import annotations

from textwrap import dedent

from dotenv import load_dotenv
from pydantic import BaseModel
from pydantic_ai import Agent
from pydantic_ai.ag_ui import StateDeps
from pydantic_ai.models.openai import OpenAIResponsesModel

load_dotenv()


class State(BaseModel):
    """Placeholder state for gen-ui-tool-based."""


agent = Agent(
    model=OpenAIResponsesModel("gpt-4.1-mini"),
    deps_type=StateDeps[State],
    system_prompt=dedent("""
        You are a haiku generator. When the user asks for a haiku, call
        the generate_haiku frontend tool with three Japanese lines,
        three English translations, an image_name from the available
        catalog, and a CSS gradient.
    """).strip(),
)
