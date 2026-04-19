"""
LangGraph agent for the Tool Rendering (frontend tools) variant.

Unlike the primary `tool-rendering` demo (which ships the `get_weather`
tool on the backend), this variant expects the tool to be defined on the
FRONTEND via `useFrontendTool`. At runtime, CopilotKit forwards frontend
tool schemas to the agent, so the model can call `get_weather` even
though this `create_agent` graph registers no tools of its own — the
frontend handler runs in the browser and the result is rendered by the
same `useFrontendTool` registration.
"""

from langchain.agents import create_agent
from langchain_openai import ChatOpenAI
from copilotkit import CopilotKitMiddleware

SYSTEM_PROMPT = (
    "You are a weather assistant. When asked about weather, call the "
    "`get_weather` tool with the requested location. The tool is provided "
    "by the frontend at runtime — you do not need to implement it yourself."
)


model = ChatOpenAI(model="gpt-4o-mini")

# Note: no `tools=[...]` — the only tool (`get_weather`) is injected at
# runtime by the frontend's `useFrontendTool` registration.
graph = create_agent(
    model=model,
    tools=[],
    middleware=[CopilotKitMiddleware()],
    system_prompt=SYSTEM_PROMPT,
)
