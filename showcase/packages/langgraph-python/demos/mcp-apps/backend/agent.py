"""
LangGraph agent for the CopilotKit MCP Apps demo.

This agent has no bespoke tools — the CopilotKit runtime is wired with
``mcpApps: { servers: [...] }`` pointing at the public Excalidraw MCP
server (see ``frontend/src/app/api/copilotkit/route.ts``). The runtime
auto-applies the MCP Apps middleware, which exposes the remote MCP
server's tools to this agent at request time and emits the activity
events that CopilotKit's built-in ``MCPAppsActivityRenderer`` renders in
the chat as a sandboxed iframe.

Reference:
https://docs.copilotkit.ai/integrations/langgraph/generative-ui/mcp-apps
"""

from langchain.agents import create_agent
from langchain_openai import ChatOpenAI
from copilotkit import CopilotKitMiddleware

SYSTEM_PROMPT = (
    "You are a demo assistant with access to the Excalidraw MCP app. "
    "When the user asks to draw, sketch, or diagram something, use the "
    "Excalidraw tools available to you. After invoking a tool, reply with a "
    "single short sentence describing what you drew."
)


graph = create_agent(
    model=ChatOpenAI(model="gpt-4o-mini"),
    tools=[],
    middleware=[CopilotKitMiddleware()],
    system_prompt=SYSTEM_PROMPT,
)
