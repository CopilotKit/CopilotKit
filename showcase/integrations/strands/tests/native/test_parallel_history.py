"""Parallel frontend/backend calls survive the showcase and file-session boundary."""

import asyncio
import json
import sys
from pathlib import Path

import pytest
from ag_ui.core import RunAgentInput, Tool, UserMessage
from strands.models.model import Model
from strands.session.file_session_manager import FileSessionManager

ROOT = Path(__file__).resolve().parents[2]
sys.path[:0] = [str(ROOT / "src"), str(ROOT)]
from agents.agent import build_showcase_agent


class ParallelModel(Model):
    """Drive the real SDK tool lifecycle with deterministic provider events."""

    def __init__(self, reverse=False):
        self.reverse = reverse

    def get_config(self):
        return {}

    def update_config(self, **kwargs):
        pass

    async def structured_output(self, *args, **kwargs):
        if False:
            yield {}

    async def stream(self, *args, **kwargs):
        yield {"messageStart": {"role": "assistant"}}
        calls = [
            ("front", "enableAppMode", {}),
            ("back", "get_sales_todos", {}),
        ]
        for call_id, name, arguments in reversed(calls) if self.reverse else calls:
            yield {
                "contentBlockStart": {
                    "start": {"toolUse": {"toolUseId": call_id, "name": name}}
                }
            }
            yield {
                "contentBlockDelta": {
                    "delta": {"toolUse": {"input": json.dumps(arguments)}}
                }
            }
            yield {"contentBlockStop": {}}
        yield {"messageStop": {"stopReason": "tool_use"}}


@pytest.mark.parametrize("reverse", [False, True])
def test_parallel_calls_keep_identity_and_order_in_every_snapshot(tmp_path, reverse):
    expected = [("front", "enableAppMode", {}), ("back", "get_sales_todos", {})]
    if reverse:
        expected.reverse()
    agent = build_showcase_agent(model=ParallelModel(reverse))
    agent.config.session_manager_provider = lambda inp: FileSessionManager(
        session_id=inp.thread_id, storage_dir=str(tmp_path)
    )
    request = RunAgentInput(
        thread_id="parallel",
        run_id="run",
        state={},
        context=[],
        messages=[
            UserMessage(
                id="user", role="user", content="Enable app mode and read todos"
            )
        ],
        tools=[
            Tool(name="enableAppMode", description="Enable app mode", parameters={})
        ],
    )

    async def run():
        return [event async for event in agent.run(request)]

    events = asyncio.run(run())
    snapshots = [event for event in events if event.type == "MESSAGES_SNAPSHOT"]
    backend_seen = False
    for snapshot in snapshots:
        calls = [
            call
            for message in snapshot.messages
            for call in getattr(message, "tool_calls", None) or []
        ]
        if len(calls) == 2:
            backend_seen = True
        if backend_seen:
            assert [
                (call.id, call.function.name, json.loads(call.function.arguments))
                for call in calls
            ] == expected
    assert backend_seen
    records = [
        json.loads(path.read_text()) for path in tmp_path.rglob("message_*.json")
    ]
    native_calls = [
        block["toolUse"]
        for record in records
        for block in record.get("message", {}).get("content", [])
        if "toolUse" in block
    ]
    assert [call["toolUseId"] for call in native_calls] == [
        call[0] for call in expected
    ]
