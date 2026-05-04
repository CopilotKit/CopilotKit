"""Agent factory for the agentic-chat demo."""

from ag_ui_strands import StrandsAgent, StrandsAgentConfig
from strands import Agent
from strands.models.openai import OpenAIModel
from strands_tools import calculator

from .shared.tools import get_weather_impl

AGENTIC_CHAT_SYSTEM_PROMPT = (
    "You are a helpful assistant that can answer questions and "
    "execute tools. When the user asks about the weather, use the "
    "get_weather tool. When the user asks you to change the background, "
    "use the change_background frontend tool. Keep responses concise."
)


def build_agentic_chat_agent() -> StrandsAgent:
    """Construct the StrandsAgent for the agentic-chat demo.

    Idempotent -- every call produces a fresh Agent + StrandsAgent pair.
    """
    inner = Agent(
        name="agentic-chat",
        system_prompt=AGENTIC_CHAT_SYSTEM_PROMPT,
        model=OpenAIModel(model_id="gpt-4o-mini"),
        tools=[calculator, get_weather_impl],
    )
    return StrandsAgent(
        agent=inner,
        name="agentic-chat",
        config=StrandsAgentConfig(),
    )
