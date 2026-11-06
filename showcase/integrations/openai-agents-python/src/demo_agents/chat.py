"""Neutral assistant shared by every chat-UI and frontend-tool demo.

The page's tools (``useFrontendTool``, ``useHumanInTheLoop``, ...) arrive with
each run; the adapter turns them into ``FunctionTool`` proxies that end the
run and hand the call to the browser, so this agent declares none itself.
"""

from agents import Agent

from demo_agents._common import MODEL, chat_settings

SYSTEM_PROMPT = "You are a helpful, concise assistant."


neutral_agent = Agent(
    name="assistant",
    instructions=SYSTEM_PROMPT,
    model=MODEL,
    model_settings=chat_settings(),
)
