"""LlamaIndex agent backing the Shared State (Writing) demo.

Minimal chat agent; a full "writing" demo where the UI drives state into
the agent is not yet implemented for LlamaIndex. Included so the cell
builds and smoke-tests cleanly.
"""

from llama_index.llms.openai import OpenAI
from llama_index.protocols.ag_ui.router import get_ag_ui_workflow_router

agent_router = get_ag_ui_workflow_router(
    llm=OpenAI(model="gpt-4.1"),
    frontend_tools=[],
    backend_tools=[],
    system_prompt="You are a helpful, concise assistant.",
)
