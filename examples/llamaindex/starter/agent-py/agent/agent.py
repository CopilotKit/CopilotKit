from typing import Annotated

from llama_index.core.workflow import Context
from llama_index.llms.openai import OpenAI
from llama_index.protocols.ag_ui.events import StateSnapshotWorkflowEvent
from llama_index.protocols.ag_ui.router import get_ag_ui_workflow_router


# This tool has a client-side version that is actually called to change the background
def change_theme_color(
    theme_color: Annotated[str, "The hex color value. i.e. '#123456''"],
) -> str:
    """Change the background color of the chat. Can be any hex color value."""
    return f"Changing background to {theme_color}"

async def add_proverb(
    ctx: Context,
    proverb: Annotated[str, "The proverb to add. Make it witty, short and concise."],
) -> str:
    """Add a proverb to the list of proverbs."""
    state = await ctx.get("state", default={})

    if "proverbs" not in state:
        state["proverbs"] = []
        
    state["proverbs"].append(proverb)
    ctx.write_event_to_stream(StateSnapshotWorkflowEvent(snapshot=state))

    await ctx.set(state)

    return f"Added proverb: {proverb}"

async def get_weather(
    location: Annotated[str, "The location to get the weather for."],
) -> str:
    """Get the weather for a given location."""
    return f"The weather in {location} is sunny and 70 degrees."

agentic_chat_router = get_ag_ui_workflow_router(
    llm=OpenAI(model="gpt-4.1"),
    frontend_tools=[change_theme_color, add_proverb],
    backend_tools=[get_weather],
    system_prompt="You are a helpful assistant that can add proverbs to a list, get the weather for a given location, and change the background color of the chat/app background.",
    initial_state={
        "proverbs": [
            "CopilotKit may be new, but its the best thing since sliced bread.",
        ],
    },
)
