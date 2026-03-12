from fastapi import FastAPI
from copilotkit import CopilotKitMiddleware, LangGraphAGUIAgent
from deepagents import create_deep_agent
from langgraph.checkpoint.memory import MemorySaver
from ag_ui_langgraph import add_langgraph_fastapi_endpoint

app = FastAPI()

agent = create_deep_agent(
    model="openai:gpt-5-mini",
    tools=[],
    middleware=[CopilotKitMiddleware()],
    checkpointer=MemorySaver(),
    system_prompt=(
        "You are a task management assistant. When the user asks to change a "
        "task status, use the setTaskStatus tool provided by the frontend."
    ),
)

add_langgraph_fastapi_endpoint(
    app,
    LangGraphAGUIAgent(
        name="default",
        description="Enum-drop reproduction agent",
        graph=agent,
        config={"recursion_limit": 50},
    ),
    "/",
)
