"""LangGraph agent backing the State Streaming demo.

Demonstrates per-token state-delta streaming. The agent writes a long
`document` string into shared agent state via a `write_document` tool;
`StateStreamingMiddleware(StateItem(...))` tells CopilotKit to forward
*every token* of the tool's `content` argument directly into the
`document` state key as it is generated. The UI (useAgent) sees
`state.document` grow token-by-token, without waiting for the tool call
to finish.

This is the canonical per-token state-streaming pattern:
docs.copilotkit.ai/integrations/langgraph/shared-state/predictive-state-updates
"""

from langchain.agents import AgentState as BaseAgentState, create_agent
from langchain.tools import ToolRuntime, tool
from langchain_core.messages import ToolMessage
from langchain_openai import ChatOpenAI
from langgraph.types import Command

from copilotkit import (
    CopilotKitMiddleware,
    StateItem,
    StateStreamingMiddleware,
)


class AgentState(BaseAgentState):
    """Shared state. `document` is streamed token-by-token."""

    document: str


@tool
def write_document(content: str, runtime: ToolRuntime) -> Command:
    """Write a document for the user.

    Always call this tool when the user asks you to write or draft
    something of any length (an essay, poem, email, summary, etc.).
    The `content` argument is streamed *per token* into shared agent
    state under the `document` key, so the UI can render it as it is
    generated.
    """
    return Command(
        update={
            "document": content,
            "messages": [
                ToolMessage(
                    content="Document written to shared state.",
                    tool_call_id=runtime.tool_call_id,
                )
            ],
        }
    )


graph = create_agent(
    model=ChatOpenAI(model="gpt-4o-mini"),
    tools=[write_document],
    middleware=[
        CopilotKitMiddleware(),
        # Forward every token of write_document's `content` argument
        # straight into state["document"] while the tool call is still
        # streaming. Without this, `document` would only update once
        # the tool call completes.
        StateStreamingMiddleware(
            StateItem(
                state_key="document",
                tool="write_document",
                tool_argument="content",
            )
        ),
    ],
    state_schema=AgentState,
    system_prompt=(
        "You are a collaborative writing assistant. Whenever the user asks "
        "you to write, draft, or revise any piece of text, ALWAYS call the "
        "`write_document` tool with the full content as a single string. "
        "Never paste the document into a chat message directly — the "
        "document belongs in shared state and the UI renders it live as "
        "you type."
    ),
)
