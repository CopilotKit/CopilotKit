"""The state-context wrapper must preserve adapter-owned attachment snapshots."""

import asyncio

import pytest
from ag_ui.core import (
    MessagesSnapshotEvent,
    RunAgentInput,
    RunStartedEvent,
    StateSnapshotEvent,
    UserMessage,
)

from agents.agent import _StateContextWrapper


class _SnapshotDelegate:
    async def run(self, input_data):
        yield RunStartedEvent(thread_id=input_data.thread_id, run_id=input_data.run_id)
        yield StateSnapshotEvent(snapshot={})
        yield MessagesSnapshotEvent(messages=input_data.messages)


@pytest.mark.parametrize(
    "kind,mime",
    [
        ("image", "image/png"),
        ("document", "application/pdf"),
        ("video", "video/mp4"),
        ("document", "text/plain"),
        ("audio", "audio/wav"),
    ],
)
@pytest.mark.parametrize("source_type", ["data", "url"])
def test_snapshot_preserves_attachment_structure(kind, mime, source_type):
    content = [
        {"type": "text", "text": "Describe this attachment"},
        {
            "type": kind,
            "source": {
                "type": source_type,
                "value": "aGVsbG8="
                if source_type == "data"
                else "https://example.com/media",
                "mimeType": mime,
            },
            "metadata": {"filename": "Original attachment." + mime.split("/")[1]},
        },
    ]
    message = UserMessage(id="user-media", content=content)
    request = RunAgentInput(
        thread_id="media-thread",
        run_id="media-run",
        messages=[message],
        state={},
        tools=[],
        context=[],
        forwarded_props={},
    )

    async def collect():
        return [
            event
            async for event in _StateContextWrapper(_SnapshotDelegate()).run(request)
        ]

    events = asyncio.run(collect())
    assert [event.type for event in events] == [
        "RUN_STARTED",
        "STATE_SNAPSHOT",
        "MESSAGES_SNAPSHOT",
    ]
    snapshot = events[-1].model_dump(mode="json", by_alias=True)
    assert snapshot["type"] == "MESSAGES_SNAPSHOT"
    assert snapshot["messages"] == [message.model_dump(mode="json", by_alias=True)]
