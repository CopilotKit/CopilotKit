"""LangGraph agent backing the Beautiful Chat demo.

Mirrors the canonical starter at /examples/integrations/langgraph-python.
Minimal sample agent — no backend tools. Frontend may inject tools at runtime
via CopilotKit's LangGraph middleware.
"""

from langchain.agents import create_agent
from langchain_openai import ChatOpenAI
from copilotkit import CopilotKitMiddleware

graph = create_agent(
    model=ChatOpenAI(model="gpt-4o-mini"),
    tools=[],
    middleware=[CopilotKitMiddleware()],
    system_prompt=(
        "You are a helpful, concise assistant showcasing CopilotKit. "
        "Greet warmly, keep answers tight, and suggest the user try one of "
        "the example prompts if they seem unsure."
    ),
)
