"""
LangGraph agent for the CopilotKit MCP Apps demo.

This agent has no bespoke tools — the CopilotKit runtime is wired with
``mcpApps: { servers: [...] }`` pointing at the public Excalidraw MCP
server (see ``src/app/api/copilotkit-mcp-apps/route.ts``). The runtime
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
    "You are a demo assistant whose sole job is to showcase the Excalidraw "
    "MCP app. You have access to Excalidraw tools via MCP — ALWAYS call "
    "them when the user asks to draw, sketch, diagram, visualize, or show "
    "anything. Default to a minimum of 3-5 shapes (rectangles, ellipses, "
    "arrows) with labels so the canvas is visibly populated — never leave "
    "it near-empty. If the user's request is vague (e.g. 'show me a "
    "diagram'), invent a small but concrete example (e.g. a 3-node "
    "pipeline with labels and arrows) and draw that. After invoking the "
    "tool, reply with ONE short sentence describing what you drew."
)


graph = create_agent(
    model=ChatOpenAI(model="gpt-4o-mini"),
    tools=[],
    middleware=[CopilotKitMiddleware()],
    system_prompt=SYSTEM_PROMPT,
)
