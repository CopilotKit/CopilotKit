# Docs-only snippet -- not imported or executed. The production Claude SDK
# adapter in `src/agents/agent.py` performs this inside its streaming loop.
# Keeping the docs region here gives the shared state-streaming pages a concise
# teaching example instead of a slice from the large shared agent file.

# @region[state-streaming-middleware]
import json
from collections.abc import AsyncIterator
from typing import Any

from ag_ui.core import EventType, StateSnapshotEvent
from ag_ui.encoder import EventEncoder
from pydantic import BaseModel


class AgentState(BaseModel):
    document: str = ""


WRITE_DOCUMENT_TOOL_SCHEMA: dict[str, Any] = {
    "name": "write_document",
    "description": "Write a document into shared agent state.",
    "input_schema": {
        "type": "object",
        "properties": {
            "document": {
                "type": "string",
                "description": "The full document text to render in shared state.",
            },
        },
        "required": ["document"],
    },
}


def _partial_json_string_property(source: str, key: str) -> str | None:
    """Return the current value of a streamed JSON string property."""
    marker = json.dumps(key)
    key_pos = source.find(marker)
    if key_pos < 0:
        return None
    colon_pos = source.find(":", key_pos)
    if colon_pos < 0:
        # The colon hasn't streamed yet (e.g. source is `{"document`); bail out
        # rather than letting find(":") return -1 and matching the key's own
        # opening quote, which would report the key name as the value.
        return None
    value_start = source.find('"', colon_pos + 1)
    if value_start < 0:
        return None

    raw_chars: list[str] = []
    escaped = False
    for char in source[value_start + 1 :]:
        if escaped:
            raw_chars.append("\\" + char)
            escaped = False
        elif char == "\\":
            escaped = True
        elif char == '"':
            break
        else:
            raw_chars.append(char)

    try:
        return json.loads(f'"{"".join(raw_chars)}"')
    except json.JSONDecodeError:
        return None


async def stream_document_state(
    anthropic_stream: AsyncIterator[Any],
    state: AgentState,
) -> AsyncIterator[str]:
    encoder = EventEncoder()
    current_tool_name: str | None = None
    current_tool_args = ""
    last_streamed_document = state.document

    async for event in anthropic_stream:
        if (
            event.type == "content_block_start"
            and event.content_block.type == "tool_use"
        ):
            current_tool_name = event.content_block.name
            current_tool_args = ""
            continue

        if (
            event.type != "content_block_delta"
            or event.delta.type != "input_json_delta"
        ):
            continue

        current_tool_args += event.delta.partial_json
        if current_tool_name != "write_document":
            continue

        streamed_document = _partial_json_string_property(
            current_tool_args,
            "document",
        )
        if streamed_document is None or streamed_document == last_streamed_document:
            continue

        state.document = streamed_document
        last_streamed_document = streamed_document
        yield encoder.encode(
            StateSnapshotEvent(
                type=EventType.STATE_SNAPSHOT,
                snapshot=state.model_dump(),
            )
        )


# @endregion[state-streaming-middleware]
