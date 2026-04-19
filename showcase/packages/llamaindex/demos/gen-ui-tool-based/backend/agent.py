"""LlamaIndex agent backing the Tool-Based Generative UI demo.

The agent calls generate_haiku (a frontend tool) to trigger UI rendering
on the client. There are no backend tools.
"""

from typing import Annotated

from llama_index.llms.openai import OpenAI
from llama_index.protocols.ag_ui.router import get_ag_ui_workflow_router


def generate_haiku(
    japanese: Annotated[list[str], "3 lines of haiku in Japanese"],
    english: Annotated[list[str], "3 lines of haiku translated to English"],
    image_name: Annotated[str, "One relevant image name from the valid set"],
    gradient: Annotated[str, "CSS Gradient color for the background"],
) -> str:
    """Generate a haiku with Japanese text, English translation, and a background image."""
    return "Haiku generated!"


agent_router = get_ag_ui_workflow_router(
    llm=OpenAI(model="gpt-4.1"),
    frontend_tools=[generate_haiku],
    backend_tools=[],
    system_prompt=(
        "You are a haiku generator. When the user asks for a haiku, call the "
        "generate_haiku tool with Japanese lines, English translations, a "
        "valid image name, and a CSS gradient."
    ),
)
