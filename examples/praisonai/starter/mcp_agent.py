"""PraisonAI with MCP Tools - Use Any MCP Server

Shows how to use Model Context Protocol (MCP) tools.
MCP lets you use 100+ pre-built tool servers!

Note: Requires BRAVE_API_KEY environment variable.
"""

from praisonaiagents import Agent, MCP, AGUI
from fastapi import FastAPI
import os

# Get API key from environment
brave_api_key = os.getenv("BRAVE_API_KEY", "")

if brave_api_key:
    # Use Brave Search MCP server
    agent = Agent(
        instructions="You are a helpful assistant that can search the web.",
        tools=MCP(
            "npx -y @modelcontextprotocol/server-brave-search",
            env={"BRAVE_API_KEY": brave_api_key}
        )
    )
else:
    # Fallback without MCP if no API key
    agent = Agent(
        instructions="You are a helpful assistant. (Set BRAVE_API_KEY for web search)"
    )

# Expose via AG-UI
app = FastAPI()
app.include_router(AGUI(agent=agent).get_router())

# Run: BRAVE_API_KEY=your-key uvicorn mcp_agent:app --reload
