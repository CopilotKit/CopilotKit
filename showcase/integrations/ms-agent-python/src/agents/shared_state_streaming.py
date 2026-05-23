"""shared-state-streaming — MAF agent that streams `document` per token.

Mirrors LangGraph's `langgraph-python/src/agents/shared_state_streaming.py`.
The frontend (`src/app/demos/shared-state-streaming/page.tsx`) subscribes
to `agent.state.document` via `useAgent` and re-renders the document
view as content arrives. This agent's job is to call `write_document`
with a full document string; the `predict_state_config` here mirrors
LGP's `StateStreamingMiddleware(StateItem(state_key="document",
tool="write_document", tool_argument="document"))` — it tells the
runtime to forward every token of the tool's `document` argument
directly into `state.document` while the tool call is still streaming.
"""

from __future__ import annotations

from textwrap import dedent
from typing import Annotated

from agent_framework import Agent, BaseChatClient, tool
from agent_framework_ag_ui import AgentFrameworkAgent, state_update
from pydantic import Field


STATE_SCHEMA: dict[str, object] = {
    "document": {
        "type": "string",
        "description": "The full document body, streamed token-by-token.",
    }
}

# Tells the runtime to stream tool-argument deltas straight into
# `state.document` while `write_document` is still streaming — matches
# LGP's StateStreamingMiddleware setup.
PREDICT_STATE_CONFIG: dict[str, dict[str, str]] = {
    "document": {
        "tool": "write_document",
        "tool_argument": "document",
    }
}


@tool(
    name="write_document",
    description=(
        "Write a document for the user. Always call this tool when the "
        "user asks you to write, draft, or revise any text. The "
        "`document` argument is streamed per-token into shared state "
        "under the `document` key so the UI renders the body live."
    ),
)
def write_document(
    document: Annotated[
        str,
        Field(description="The full document content as a single string."),
    ],
):
    """Commit the final document body to shared state.

    Per-token streaming of the `document` arg is handled by the runtime
    via `predict_state_config`; this final `state_update` is the
    authoritative commit after the tool finishes streaming.
    """
    return state_update(
        text="Document written to shared state.",
        state={"document": document},
    )


SYSTEM_PROMPT = dedent(
    """
    You are a collaborative writing assistant. Whenever the user asks
    you to write, draft, or revise any piece of text, ALWAYS call the
    `write_document` tool with the full content as a single string in
    the `document` argument. Never paste the document into a chat
    message directly — the document belongs in shared state and the UI
    renders it live as you type.
    """
).strip()


def create_shared_state_streaming_agent(
    chat_client: BaseChatClient,
) -> AgentFrameworkAgent:
    """Instantiate the shared-state-streaming MAF agent."""
    base_agent = Agent(
        client=chat_client,
        name="shared_state_streaming_agent",
        instructions=SYSTEM_PROMPT,
        tools=[write_document],
    )

    return AgentFrameworkAgent(
        agent=base_agent,
        name="SharedStateStreamingAgent",
        description=(
            "Per-token state streaming: `write_document` arg deltas land "
            "in `state.document` as the tool call is generated."
        ),
        predict_state_config=PREDICT_STATE_CONFIG,
        require_confirmation=False,
    )
