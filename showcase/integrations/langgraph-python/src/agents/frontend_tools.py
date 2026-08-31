"""LangGraph agent backing the Frontend Tools demo.

This cell demonstrates `useFrontendTool` with a synchronous handler.
The backend graph registers no tools of its own — CopilotKit forwards
the frontend tool schema(s) to the agent at runtime, and the handler
executes in the browser. CopilotKitMiddleware is attached so frontend
tools, shared state, and agent context flow into every turn.

Like the sibling `frontend_tools_async` cell, the agent has no custom
behavior beyond a permissive system prompt — the demo's value is in
showing the wiring contract, not the agent logic.
"""

# region: middleware
from langchain.agents import create_agent
from langchain_openai import ChatOpenAI
from copilotkit import CopilotKitMiddleware

graph = create_agent(
    model=ChatOpenAI(model="gpt-5.4"),
    tools=[],
    middleware=[CopilotKitMiddleware()],
    system_prompt="You are a helpful, concise assistant.",
)
# endregion
