from fastapi import FastAPI
from copilotkit import CopilotKitMiddleware, LangGraphAGUIAgent
from deepagents import create_deep_agent
from langgraph.checkpoint.memory import MemorySaver
from langchain.tools import tool
from ag_ui_langgraph import add_langgraph_fastapi_endpoint
import logging

logger = logging.getLogger("tkt-v2-after-mw")
logging.basicConfig(level=logging.DEBUG)

app = FastAPI()

@tool
def get_weather(city: str) -> str:
    """Get the current weather for a city."""
    logger.debug(f"[tkt-v2-after-mw agent] get_weather called with city={city}")
    result = f"It's 72°F and sunny in {city}."
    logger.debug(f"[tkt-v2-after-mw agent] get_weather returning: {result}")
    return result

agent = create_deep_agent(
    model="openai:gpt-5-mini",
    tools=[get_weather],
    middleware=[CopilotKitMiddleware()],
    checkpointer=MemorySaver(),
    system_prompt=(
        "You are a helpful weather assistant. When asked about the weather, "
        "use the get_weather tool. Keep responses brief."
    ),
)

print("[tkt-v2-after-mw agent] Agent created, mounting at /")

add_langgraph_fastapi_endpoint(
    app,
    LangGraphAGUIAgent(
        name="default",
        description="Simple weather agent for afterRequestMiddleware reproduction",
        graph=agent,
        config={"recursion_limit": 50},
    ),
    "/",
)
