"""Thin Agno agent for the Frontend Tools (Async) demo.

LGP shape: no backend tools. The page registers `query_notes`. Agno only
forwards a tool call when the name is on the agent, so this file declares
`query_notes` as external_execution. The handler still runs in the browser.
"""

from agno.agent.agent import Agent
from agno.models.openai import OpenAIChat
from agno.tools import tool
from dotenv import load_dotenv

load_dotenv()


@tool(external_execution=True)
def query_notes(keyword: str):
    """Search the user's local notes database.

    Args:
        keyword (str): Keyword or phrase to search notes for.
    """


agent = Agent(
    model=OpenAIChat(id="gpt-4o", timeout=120),
    tools=[query_notes],
    tool_call_limit=8,
    description=(
        "You are a helpful assistant that can search the user's personal notes."
    ),
    instructions="""
        When the user asks about their notes, call the `query_notes` tool with
        a concise keyword from their request. The tool runs in the browser.
        After it returns, summarize the matching notes. If none match, say so.
    """,
)
