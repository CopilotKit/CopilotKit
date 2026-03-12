from typing import Annotated
from llama_index.protocols.ag_ui.router import get_ag_ui_workflow_router
from llama_index.llms.openai import OpenAI

def write_essay(
    draft: Annotated[str, "The essay draft content to expand."],
) -> str:
    """Writes an essay and takes the draft as an argument."""
    return "Essay draft written!"

agentic_chat_router = get_ag_ui_workflow_router(
    llm=OpenAI(model="gpt-4.1"),
    frontend_tools=[write_essay],
)
