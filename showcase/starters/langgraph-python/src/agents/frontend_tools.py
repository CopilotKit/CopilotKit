"""LangGraph agent backing the Chat Customization (CSS) demo.

The demo is about CSS — the agent has no custom tools or behavior.
CopilotKitMiddleware is attached so CopilotKit-specific context is
picked up if the frontend ever registers suggestions/components.
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
