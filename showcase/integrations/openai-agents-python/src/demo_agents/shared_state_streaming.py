"""shared-state-streaming: ``state.document`` grows while the model writes it.

The model calls ``write_document`` with the whole text as its ``document``
argument. The adapter streams that argument as TOOL_CALL_ARGS deltas, and
``DocumentStreamingAgent`` follows them: after each delta it sends the
argument's text so far as ``state.document``. The page renders
``agent.state.document``, so the document appears token by token, as
langgraph-python's ``StateStreamingMiddleware`` does. The tool body then
commits the final text.
"""

from collections.abc import AsyncIterator
from contextlib import aclosing

from ag_ui.core import BaseEvent, EventType, RunAgentInput, StateDeltaEvent
from ag_ui_openai_agents import OpenAIAgentsAgent, shared_state
from agents import Agent, function_tool
from pydantic_core import from_json

from demo_agents._common import MODEL

SYSTEM_PROMPT = (
    "You are a collaborative writing assistant. Whenever the user asks you "
    "to write, draft, or revise any piece of text, ALWAYS call the "
    "`write_document` tool with the full content as a single string in the "
    "`document` argument. Never paste the document into a chat message "
    "directly — the document belongs in shared state and the UI renders it "
    "live as you type. After the tool returns, reply with one short sentence."
)


# @region[state-streaming-tool]
@function_tool
def write_document(document: str) -> str:
    """Write a document for the user. Always call this tool when the user asks
    you to write, draft, or revise any text. The `document` argument is
    streamed into shared state under the `document` key so the UI renders
    the body live.
    """
    shared_state().update(document=document)
    return "Document written to shared state."


# @endregion[state-streaming-tool]


shared_state_streaming_agent = Agent(
    name="writer", instructions=SYSTEM_PROMPT, model=MODEL, tools=[write_document]
)


# @region[state-streaming-middleware]
def _document_so_far(arguments: str) -> str | None:
    """The ``document`` argument as far as the model has written it."""
    try:
        # Unfinished JSON: a string cut off mid-way is kept as it stands.
        value = from_json(arguments, allow_partial="trailing-strings")
    except ValueError:
        return None
    document = value.get("document") if isinstance(value, dict) else None
    return document if isinstance(document, str) else None


class DocumentStreamingAgent(OpenAIAgentsAgent):
    """Streams ``write_document``'s ``document`` argument into the state."""

    async def run_streamed(self, input: RunAgentInput) -> AsyncIterator[BaseEvent]:
        arguments: dict[str, str] = {}  # tool call id -> arguments so far
        async with aclosing(super().run_streamed(input)) as events:
            async for event in events:
                yield event
                if (
                    event.type == EventType.TOOL_CALL_START
                    and event.tool_call_name == write_document.name
                ):
                    arguments[event.tool_call_id] = ""
                elif (
                    event.type == EventType.TOOL_CALL_ARGS
                    and event.tool_call_id in arguments
                ):
                    arguments[event.tool_call_id] += event.delta
                    document = _document_so_far(arguments[event.tool_call_id])
                    if document is not None:
                        yield StateDeltaEvent(
                            type=EventType.STATE_DELTA,
                            delta=[
                                {"op": "add", "path": "/document", "value": document}
                            ],
                        )


# @endregion[state-streaming-middleware]
