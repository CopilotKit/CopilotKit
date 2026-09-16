import os
from typing import Annotated

from llama_index.core.workflow import Context
from llama_index.llms.openai import OpenAI
from llama_index.protocols.ag_ui.events import StateSnapshotWorkflowEvent
from llama_index.protocols.ag_ui.router import get_ag_ui_workflow_router


# This tool has a client-side version that is actually called to change the background
# These tools just need a response string to make it look like they are executing
def change_theme_color(
    theme_color: Annotated[str, "The hex color value. i.e. '#123456''"],
) -> str:
    """Change the background color of the chat. Can be any hex color value."""
    return f"Changing background to {theme_color}"


# This is another client-side tool that is actually called to add a proverb to the list
# These tools just need a response string to make it look like they are executing
async def add_proverb(
    proverb: Annotated[str, "The proverb to add. Make it witty, short and concise."],
) -> str:
    """Add a proverb to the list of proverbs."""
    return f"Added proverb: {proverb}"


# This is a backend tool that executes code on the backend server
# For now this is a dummy implementation, but it could very well call a weather API
async def get_weather(
    location: Annotated[str, "The location to get the weather for."],
) -> str:
    """Get the weather for a given location."""
    return f"The weather in {location} is sunny and 70 degrees."


# LlamaIndex's OpenAI LLM resolves its base URL from OPENAI_API_BASE only, so the
# conventional OPENAI_BASE_URL (used by the OpenAI SDKs and by our aimock-backed
# docker-compose.test.yml) is ignored and requests go to api.openai.com. Forward it
# explicitly as api_base.
_openai_kwargs = {}
if os.environ.get("OPENAI_BASE_URL"):
    _openai_kwargs["api_base"] = os.environ["OPENAI_BASE_URL"]

agentic_chat_router = get_ag_ui_workflow_router(
    llm=OpenAI(model="gpt-4.1", **_openai_kwargs),
    # Tools that are executed in the frontend client
    frontend_tools=[change_theme_color, add_proverb],
    # Tools that are executed in the backend server
    backend_tools=[get_weather],
    system_prompt="You are a helpful assistant that can add proverbs to a list, get the weather for a given location, and change the background color of the chat/app background.",
    initial_state={
        "proverbs": [
            "CopilotKit may be new, but its the best thing since sliced bread.",
        ],
    },
)
