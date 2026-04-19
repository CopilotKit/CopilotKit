"""LangGraph agent backing the Agentic Generative UI demo.

The frontend subscribes to agent state + run-status updates via `useAgent`
and renders an inline progress card inside the chat transcript. The agent
itself is a generic helpful assistant -- the demo is about rendering
intermediate state, not about a specialized tool set.
"""

from langchain.agents import create_agent
from langchain_openai import ChatOpenAI
from copilotkit import CopilotKitMiddleware

graph = create_agent(
    model=ChatOpenAI(model="gpt-4o-mini"),
    tools=[],
    middleware=[CopilotKitMiddleware()],
    system_prompt=(
        "You are a helpful assistant. When asked to perform a multi-step "
        "task, describe each step as you complete it so the user can follow "
        "along."
    ),
)
