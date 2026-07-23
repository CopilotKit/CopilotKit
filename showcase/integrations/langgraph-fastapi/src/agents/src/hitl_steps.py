"""LangGraph agent backing the HITL step-selection demo (/demos/hitl).

Minimal neutral assistant with no backend tools — frontend-registered
tools (useHumanInTheLoop's `generate_task_steps`) are injected via
CopilotKitMiddleware at runtime. Mirrors the langgraph-python reference's
`main.py` (sample_agent) pattern: tools=[], middleware only.

The heavy `sample_agent` (agent.py) defines 7+ backend tools and a custom
AgentState with `todos: list[SalesTodo]`. Routing the HITL step-selection
demo through that graph risks state-schema mismatches and tool-dispatch
contention when the only tool the demo needs is the frontend-injected
`generate_task_steps`. This dedicated graph eliminates that surface area.
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
