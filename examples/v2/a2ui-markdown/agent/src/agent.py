"""Generative UI chat agent.

A single model node with no tools of its own. With the markdown transport the
CopilotKit provider sends the component schema and the ```a2ui fence guideline
as context entries. ``LangGraphAGUIAgent`` places them in
``state["copilotkit"]["context"]`` and ``CopilotKitMiddleware`` appends them to
the system prompt as "App Context" on every model call, so the model knows
which components it may use and how to write the fences. With the tool
transport the runtime adds the render_ui tool, and ``CopilotKitMiddleware``
binds it like any frontend tool. Nothing in this file is specific to
generative UI beyond the one-line prompt.
"""

import os

from copilotkit import CopilotKitMiddleware
from langchain.agents import create_agent
from langchain_openai import ChatOpenAI
from langgraph.checkpoint.memory import MemorySaver

SYSTEM_PROMPT = (
    "You are a helpful assistant. When a visual, interactive answer helps, "
    "render it with generative UI as described in your App Context."
)

graph = create_agent(
    model=ChatOpenAI(model=os.getenv("OPENAI_MODEL", "gpt-5.4"), streaming=True),
    tools=[],
    middleware=[CopilotKitMiddleware()],
    system_prompt=SYSTEM_PROMPT,
    checkpointer=MemorySaver(),
)
