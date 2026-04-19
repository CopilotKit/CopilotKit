"""LlamaIndex agent backing the Sub-Agents demo.

Minimal chat agent; a full multi-agent delegation demo is not yet
implemented for LlamaIndex. Included so the cell builds and smoke-tests
cleanly.
"""

from llama_index.llms.openai import OpenAI
from llama_index.protocols.ag_ui.router import get_ag_ui_workflow_router

agent_router = get_ag_ui_workflow_router(
    llm=OpenAI(model="gpt-4.1"),
    frontend_tools=[],
    backend_tools=[],
    system_prompt="You are a helpful, concise assistant.",
)
