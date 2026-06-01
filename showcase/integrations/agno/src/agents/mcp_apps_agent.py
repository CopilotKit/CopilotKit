"""No-tools Agno agent for the MCP Apps demo.

The CopilotKit runtime's `mcpApps.servers` config auto-applies the MCP Apps
middleware which fetches an MCP server's tools at request time and injects
them into the agent's catalog. By giving this agent no native tools we keep
the demo focused: the LLM only sees the MCP-provided tools, so any tool
invocation visibly exercises the MCP Apps surface.
"""

from agno.agent.agent import Agent
from agno.models.openai import OpenAIChat
from dotenv import load_dotenv

load_dotenv()


agent = Agent(
    # Same timeout treatment as the main agent — keeps aimock-proxied requests
    # from timing out under load.
    model=OpenAIChat(id="gpt-4o", timeout=120),
    tools=[],
    tool_call_limit=15,
    description=(
        "You are a helpful assistant. The host runtime injects MCP-provided "
        "tools into your toolbox at request time; use them when appropriate "
        "to fulfil the user's request."
    ),
    instructions="""
        When the user asks you to draw, sketch, or visualize something,
        prefer to use the MCP-provided drawing tools (e.g. Excalidraw)
        rather than describing the result in prose.
    """,
)
