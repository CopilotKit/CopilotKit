"""LangGraph agent backing the In-Chat HITL (useHumanInTheLoop) demo.

The `book_call` tool is defined on the frontend via `useHumanInTheLoop`,
so there is no backend tool here. CopilotKitMiddleware is attached so the
frontend suggestions and the time-picker render hook are picked up.
"""

from langchain.agents import create_agent
from langchain_openai import ChatOpenAI
from copilotkit import CopilotKitMiddleware

graph = create_agent(
    model=ChatOpenAI(model="gpt-4o-mini"),
    tools=[],
    middleware=[CopilotKitMiddleware()],
    system_prompt=(
        "You help users book an onboarding call with the sales team. "
        "When they ask to book a call, call the frontend-provided "
        "`book_call` tool with a short topic and the user's name. "
        "Keep any chat reply to one short sentence."
    ),
)
