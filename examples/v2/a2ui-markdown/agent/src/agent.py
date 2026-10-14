"""A2UI markdown-mode chat agent.

A single model node with no tools. In markdown mode the CopilotKit provider
sends the A2UI catalog schema, the ```a2ui fence guideline and the design
guideline as context entries. ``LangGraphAGUIAgent`` places them in
``state["copilotkit"]["context"]`` and ``CopilotKitMiddleware`` appends them to
the system prompt as "App Context" on every model call, so the model knows
which components it may use and how to write the fences. Nothing in this file
is A2UI-specific beyond the one-line prompt.
"""

import os

from copilotkit import CopilotKitMiddleware
from langchain.agents import create_agent
from langchain_openai import ChatOpenAI
from langgraph.checkpoint.memory import MemorySaver

SYSTEM_PROMPT = (
    "You are a helpful assistant. When a visual, interactive answer helps, "
    "render it with the A2UI markdown fences described in your App Context."
)

graph = create_agent(
    model=ChatOpenAI(model=os.getenv("OPENAI_MODEL", "gpt-5.4"), streaming=True),
    tools=[],
    middleware=[CopilotKitMiddleware()],
    system_prompt=SYSTEM_PROMPT,
    checkpointer=MemorySaver(),
)
