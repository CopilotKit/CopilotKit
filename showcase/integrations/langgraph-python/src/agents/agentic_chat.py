"""LangGraph agent backing the Agentic Chat demo.

Minimal sample agent — no backend tools. Frontend may inject tools at runtime
via CopilotKit's LangGraph middleware.
"""

from langchain.agents import create_agent
from langchain_openai import ChatOpenAI
from copilotkit import CopilotKitMiddleware

graph = create_agent(
    model=ChatOpenAI(reasoning_effort="none", model="gpt-6-luna"),
    tools=[],
    middleware=[CopilotKitMiddleware()],
    system_prompt="You are a helpful, concise assistant.",
)
