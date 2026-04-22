"""LangGraph agent backing the Frontend Tools (Async) demo.

This cell demonstrates `useFrontendTool` with an ASYNC handler. The
frontend registers a `query_notes` tool whose handler awaits a simulated
client-side DB query (500ms latency) and returns matching notes. The
agent uses the returned result to summarize what it found.

Like the sibling `frontend_tools` cell, the backend graph registers no
tools of its own — CopilotKit forwards the frontend tool schema(s) to
the agent at runtime, and the handler executes in the browser.
"""

from langchain.agents import create_agent
from langchain_openai import ChatOpenAI
from copilotkit import CopilotKitMiddleware

SYSTEM_PROMPT = (
    "You are a helpful assistant that can search the user's personal notes. "
    "When the user asks about their notes, call the `query_notes` tool with "
    "a concise keyword extracted from their request. The tool is provided "
    "by the frontend at runtime and runs entirely in the user's browser — "
    "you do not need to implement it yourself. After the tool returns, "
    "summarize the matching notes clearly and concisely. If no notes match, "
    "say so plainly and offer to try a different keyword."
)

graph = create_agent(
    model=ChatOpenAI(model="gpt-4o-mini"),
    tools=[],
    middleware=[CopilotKitMiddleware()],
    system_prompt=SYSTEM_PROMPT,
)
