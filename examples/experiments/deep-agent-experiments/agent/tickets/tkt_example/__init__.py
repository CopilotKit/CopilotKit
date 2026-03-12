from fastapi import FastAPI
from copilotkit import CopilotKitMiddleware, LangGraphAGUIAgent
from deepagents import create_deep_agent
from langgraph.checkpoint.memory import MemorySaver
from langchain.tools import tool
from ag_ui_langgraph import add_langgraph_fastapi_endpoint

app = FastAPI()

@tool
def example_tool(query: str):
    """An example tool for this ticket's reproduction."""
    return f"Result for: {query}"

agent = create_deep_agent(
    model="openai:gpt-5-mini",
    tools=[example_tool],
    middleware=[CopilotKitMiddleware()],
    checkpointer=MemorySaver(),
    system_prompt="You are a test agent for ticket TKT-869 reproduction.",
)

add_langgraph_fastapi_endpoint(
    app,
    LangGraphAGUIAgent(
        name="my_agent",
        description="TKT-869 reproduction agent",
        graph=agent,
        config={"recursion_limit": 100},
    ),
    "/",
)
