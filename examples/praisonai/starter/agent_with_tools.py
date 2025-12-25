"""PraisonAI Agent with Tools - Web Search Example

Shows how easy it is to add tools to your agent.
"""

from praisonaiagents import Agent, AGUI
from fastapi import FastAPI

# Define a simple tool (any Python function works!)
def search_web(query: str) -> str:
    """Search the web for information."""
    try:
        from duckduckgo_search import DDGS
        results = list(DDGS().text(query, max_results=3))
        return "\n".join([f"• {r['title']}: {r['body']}" for r in results])
    except Exception:
        return f"Searched for: {query}"

def calculate(expression: str) -> str:
    """Calculate a math expression like '2 + 2 * 3'"""
    try:
        return f"Result: {eval(expression)}"
    except Exception:
        return "Invalid expression"

# Create agent with tools - just pass them as a list!
agent = Agent(
    instructions="You are a helpful assistant with web search and calculator.",
    tools=[search_web, calculate]
)

# Expose via AG-UI
app = FastAPI()
app.include_router(AGUI(agent=agent).get_router())

# Run: uvicorn agent_with_tools:app --reload
