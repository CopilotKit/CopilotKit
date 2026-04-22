"""
Default LangGraph agent — neutral "helpful, concise assistant".

This is the fallthrough graph for demos that don't require anything more
specialized. Cells that need tailored behavior (chart viz, weather-only,
etc.) should have their own dedicated graph under `src/agents/` and
explicit wiring in the CopilotKit route.
"""

from langchain.agents import create_agent
from langchain_openai import ChatOpenAI
from copilotkit import CopilotKitMiddleware

graph = create_agent(
    model=ChatOpenAI(model="gpt-4o-mini"),
    tools=[],
    middleware=[CopilotKitMiddleware()],
    system_prompt="You are a helpful, concise assistant.",
)
