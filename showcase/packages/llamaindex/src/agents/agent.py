"""
LlamaIndex AG-UI Agent

Uses llama-index-protocols-ag-ui to expose a LlamaIndex workflow as an
AG-UI compatible FastAPI router. The router handles all four demo
scenarios (agentic-chat, tool-rendering, hitl, gen-ui-tool-based) through
a single endpoint since LlamaIndex's get_ag_ui_workflow_router builds
the full AG-UI protocol surface automatically.
"""

from typing import Annotated

from llama_index.llms.openai import OpenAI
from llama_index.protocols.ag_ui.router import get_ag_ui_workflow_router


# --- Frontend tools (executed client-side, agent just returns a confirmation) ---

def change_background(
    background: Annotated[str, "CSS background value. Prefer gradients."],
) -> str:
    """Change the background color/gradient of the chat area."""
    return f"Background changed to {background}"


async def add_proverb(
    proverb: Annotated[str, "The proverb to add. Make it witty, short and concise."],
) -> str:
    """Add a proverb to the list of proverbs."""
    return f"Added proverb: {proverb}"


def generate_haiku(
    japanese: Annotated[list[str], "3 lines of haiku in Japanese"],
    english: Annotated[list[str], "3 lines of haiku translated to English"],
    image_name: Annotated[str, "One relevant image name from the valid set"],
    gradient: Annotated[str, "CSS Gradient color for the background"],
) -> str:
    """Generate a haiku with Japanese text, English translation, and a background image."""
    return "Haiku generated!"


def generate_task_steps(
    steps: Annotated[
        list[dict],
        "Array of step objects with 'description' (string) and 'status' ('enabled' or 'disabled')"
    ],
) -> str:
    """Generate a list of task steps for the user to review and approve."""
    return f"Generated {len(steps)} steps for review"


# --- Backend tools (executed server-side) ---

async def get_weather(
    location: Annotated[str, "The location to get the weather for."],
) -> str:
    """Get the weather for a given location. Returns temperature, conditions, humidity, wind speed, and feels-like temperature."""
    return (
        f'{{"city": "{location}", "temperature": 22, "conditions": "Clear skies", '
        f'"humidity": 55, "wind_speed": 12, "feels_like": 24}}'
    )


agent_router = get_ag_ui_workflow_router(
    llm=OpenAI(model="gpt-4.1"),
    frontend_tools=[change_background, add_proverb, generate_haiku, generate_task_steps],
    backend_tools=[get_weather],
    system_prompt=(
        "You are a helpful assistant that can: "
        "add proverbs to a list, get the weather for a given location, "
        "change the background color/gradient of the chat area, "
        "generate haikus with Japanese and English text, "
        "and generate task step plans for user review. "
        "When asked about weather, always use the get_weather tool and return the JSON result. "
        "When asked to plan or create steps, use the generate_task_steps tool."
    ),
    initial_state={
        "proverbs": [
            "CopilotKit may be new, but its the best thing since sliced bread.",
        ],
    },
)
