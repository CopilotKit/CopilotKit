from __future__ import annotations

import asyncio
import json
from types import SimpleNamespace

from ag_ui.core import RunAgentInput

from agents import shared_state_read_write_agent as shared_state


class RawContentBlockStartEvent:
    def __init__(self) -> None:
        self.content_block = SimpleNamespace(
            type="tool_use", id="tool-1", name="set_notes"
        )


class RawContentBlockDeltaEvent:
    def __init__(self) -> None:
        self.delta = SimpleNamespace(
            type="input_json_delta",
            partial_json='{"notes":["Prefers concise answers"]}',
        )


class RawContentBlockStopEvent:
    pass


class FakeStream:
    def __init__(self, events: list[object]) -> None:
        self.events = events

    async def __aenter__(self) -> "FakeStream":
        return self

    async def __aexit__(self, *_args: object) -> None:
        return None

    def __aiter__(self):
        return self._iterate()

    async def _iterate(self):
        for event in self.events:
            yield event


class FakeMessages:
    def __init__(self) -> None:
        self.calls: list[dict[str, object]] = []

    def stream(self, **kwargs: object) -> FakeStream:
        self.calls.append(kwargs)
        if len(self.calls) == 1:
            return FakeStream(
                [
                    RawContentBlockStartEvent(),
                    RawContentBlockDeltaEvent(),
                    RawContentBlockStopEvent(),
                ]
            )
        return FakeStream([])


def _decode_events(chunks: list[str]) -> list[dict[str, object]]:
    events: list[dict[str, object]] = []
    for chunk in chunks:
        for line in chunk.splitlines():
            if line.startswith("data: "):
                events.append(json.loads(line.removeprefix("data: ")))
    return events


def test_set_notes_is_registered_and_emits_updated_state(monkeypatch) -> None:
    messages = FakeMessages()
    fake_client = SimpleNamespace(messages=messages)
    monkeypatch.setattr(
        shared_state.anthropic,
        "AsyncAnthropic",
        lambda **_kwargs: fake_client,
    )
    input_data = RunAgentInput(
        thread_id="thread-1",
        run_id="run-1",
        state={"preferences": {"name": "Mochi"}, "notes": []},
        messages=[],
        tools=[],
        context=[],
        forwarded_props={},
    )

    async def collect() -> list[str]:
        return [
            chunk
            async for chunk in shared_state.run_shared_state_read_write_agent(
                input_data
            )
        ]

    events = _decode_events(asyncio.run(collect()))

    assert messages.calls[0]["tools"] == [shared_state.SET_NOTES_TOOL]
    snapshots = [event for event in events if event["type"] == "STATE_SNAPSHOT"]
    assert snapshots[-1]["snapshot"] == {
        "preferences": {"name": "Mochi"},
        "notes": ["Prefers concise answers"],
    }
    results = [event for event in events if event["type"] == "TOOL_CALL_RESULT"]
    assert json.loads(results[-1]["content"]) == {"status": "ok", "count": 1}
