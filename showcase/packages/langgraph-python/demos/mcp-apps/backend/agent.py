"""
LangGraph agent for the CopilotKit MCP Apps demo.

Defines ONE backend tool (`show_mcp_app`) that the runtime middleware
(``MCPAppsStubMiddleware`` in ``src/app/api/copilotkit/route.ts``) watches
for. When the tool call completes, the middleware synthesizes an
``ACTIVITY_SNAPSHOT`` event with ``activityType="mcp-apps"`` whose content
matches ``MCPAppsActivityContentSchema`` on the frontend. The middleware
also handles the follow-up ``__proxiedMCPRequest`` (``resources/read``)
that the ``MCPAppsActivityRenderer`` fires when mounting, returning a
minimal pre-baked HTML resource so the sandboxed iframe has something to
render.

Keeping the activity-event synthesis in the TS middleware (rather than the
Python agent) sidesteps the fact that the AG-UI LangGraph Python
integration has no direct hook for emitting ``ACTIVITY_SNAPSHOT`` events.
"""

from langchain.agents import create_agent
from langchain.tools import tool
from langchain_openai import ChatOpenAI
from copilotkit import CopilotKitMiddleware

SYSTEM_PROMPT = (
    "You are a demo assistant for MCP Apps. "
    "When the user asks to see an app or demo, call `show_mcp_app` with "
    "a short generic title like \"Demo App\" (do NOT invent product names "
    "such as A2UI, CrewAI, etc.). After the tool call, reply with a single "
    "short sentence like \"Here's the MCP app.\" — do not name frameworks "
    "or components that weren't mentioned by the user."
)


@tool
def show_mcp_app(title: str) -> str:
    """Show an MCP app UI in the chat.

    The actual activity event (with the sandboxed HTML resource pointer) is
    synthesized by the TS ``MCPAppsStubMiddleware`` wrapping this agent —
    this tool simply signals that it was invoked so the middleware can pair
    the tool call with an ``ACTIVITY_SNAPSHOT`` event.

    Args:
        title: A short human-readable title for the MCP app card.
    """
    return f"Showing MCP app: {title}"


graph = create_agent(
    model=ChatOpenAI(model="gpt-4o-mini"),
    tools=[show_mcp_app],
    middleware=[CopilotKitMiddleware()],
    system_prompt=SYSTEM_PROMPT,
)
