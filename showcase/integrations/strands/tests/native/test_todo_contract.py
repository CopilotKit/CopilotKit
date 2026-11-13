"""Real SDK tool calls and automatic session round trips without a provider."""

import asyncio
import json
import sys
from pathlib import Path
from types import SimpleNamespace

import pytest
from ag_ui.core import RunAgentInput, UserMessage
from strands import Agent
from strands.models.model import Model
from strands.session.file_session_manager import FileSessionManager

ROOT = Path(__file__).resolve().parents[2]
sys.path[:0] = [str(ROOT / "src"), str(ROOT)]
from agents.agent import (
    build_showcase_agent,
    get_sales_todos,
    manage_sales_todos,
    sales_state_from_result,
)


class TodoModel(Model):
    """Read, replace the board, then finish through the real SDK tool executor."""

    def __init__(self, todos, run_id):
        self.calls = iter(
            [
                (f"{run_id}-read", "get_sales_todos", {}),
                (f"{run_id}-write", "manage_sales_todos", {"todos": todos}),
                None,
            ]
        )
        self.model_calls = 0

    def get_config(self):
        return {}

    def update_config(self, **kwargs):
        pass

    async def structured_output(self, *args, **kwargs):
        raise NotImplementedError
        yield

    async def stream(self, *args, **kwargs):
        call = next(self.calls)
        self.model_calls += 1
        yield {"messageStart": {"role": "assistant"}}
        if call is None:
            yield {"contentBlockDelta": {"delta": {"text": "Done."}}}
            yield {"contentBlockStop": {}}
            yield {"messageStop": {"stopReason": "end_turn"}}
            return
        call_id, name, arguments = call
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


def test_board_schema():
    schema = manage_sales_todos.tool_spec["inputSchema"]["json"]
    item = schema["$defs"]["BoardTodoInput"]
    assert {"id", "title", "description", "emoji", "status"} <= item[
        "properties"
    ].keys()
    assert item["properties"]["status"]["enum"] == ["pending", "completed"]
    assert "title" in item["required"]


def test_tools_automatically_persist_board_and_history(tmp_path):
    unrelated = {"customer": "Acme", "preferences": ["concise"]}
    expected_calls = []

    # Construct a new manager and Agent, without invoking either or syncing by hand.
    def restore(session):
        return Agent(
            model=TodoModel([], "unused"),
            session_manager=FileSessionManager(
                session_id=session, storage_dir=str(tmp_path)
            ),
            tools=[manage_sales_todos, get_sales_todos],
            callback_handler=None,
        )

    def run(todos, run_id, previous):
        model = TodoModel(todos, run_id)
        # Rebuild the production factory each turn so its thread cache cannot
        # stand in for restoring the last automatically saved session.
        agent = build_showcase_agent(model=model)
        agent.config.session_manager_provider = lambda inp: FileSessionManager(
            session_id=inp.thread_id, storage_dir=str(tmp_path)
        )
        if run_id == "create":
            agent.config.thread_agent_kwargs = lambda _: {
                "state": {"unrelated": unrelated}
            }
        request = RunAgentInput(
            thread_id="original",
            run_id=run_id,
            # Supplying expected todos here would mask a missing native write.
            state={},
            context=[],
            messages=[
                UserMessage(id=run_id, role="user", content="Update the board")
            ],
            tools=[],
        )

        async def collect():
            return [event async for event in agent.run(request)]

        events = asyncio.run(collect())
        assert not [event for event in events if event.type == "RUN_ERROR"]
        assert events[-1].type == "RUN_FINISHED"
        assert model.model_calls == 3
        native = agent._agents_by_thread["original"]
        saved = native.state.get("todos")
        assert isinstance(saved, list)
        snapshots = [
            event.snapshot["todos"]
            for event in events
            if event.type == "STATE_SNAPSHOT" and "todos" in event.snapshot
        ]
        assert snapshots[0] == previous
        assert snapshots[-1] == saved

        restored = restore("original")
        assert restored is not native
        assert restored.state.get("todos") == saved
        assert restored.state.get("unrelated") == unrelated
        assert restored.messages == native.messages
        calls = [
            block["toolUse"]
            for message in restored.messages
            for block in message["content"]
            if "toolUse" in block
        ]
        expected_calls.extend(
            [
                (f"{run_id}-read", "get_sales_todos"),
                (f"{run_id}-write", "manage_sales_todos"),
            ]
        )
        assert [(call["toolUseId"], call["name"]) for call in calls] == expected_calls
        results = [
            block["toolResult"]
            for message in restored.messages
            for block in message["content"]
            if "toolResult" in block
        ]
        assert [result["toolUseId"] for result in results] == [
            call[0] for call in expected_calls
        ]
        assert all(result["status"] == "success" for result in results)
        assert json.loads(results[-2]["content"][0]["text"]) == previous
        return saved

    todos = [
        {
            "id": "cedar",
            "title": "Cedar",
            "description": "Follow up",
            "emoji": "🌲",
            "status": "pending",
            "assignee": "Ada",
        },
        {
            "title": "Maple",
            "description": "Prepare demo",
            "emoji": "🍁",
            "status": "pending",
        },
    ]
    saved = run(todos, "create", [])
    assert saved[0] == todos[0]
    generated_id = saved[1]["id"]
    assert generated_id and generated_id != "cedar"
    assert saved[1] == {**todos[1], "id": generated_id}
    isolated = restore("other")
    assert isolated.state.get() == {}
    assert isolated.messages == []

    replacement = [{**saved[1], "status": "completed", "assignee": "Grace"}]
    updated = run(replacement, "replace", saved)
    assert updated == replacement
    assert run([], "clear", updated) == []


@pytest.mark.parametrize("shape", ["native", "json", "blocks", "block"])
def test_read_snapshot_handles_native_and_wrapped_lists(shape):
    todos = [
        {
            "id": "cedar",
            "title": "Cedar",
            "description": "Follow up",
            "status": "pending",
        }
    ]
    result = {
        "native": todos,
        "json": json.dumps(todos),
        "blocks": [{"text": json.dumps(todos)}],
        "block": {"text": json.dumps(todos)},
    }[shape]
    assert asyncio.run(
        sales_state_from_result(SimpleNamespace(result_data=result))
    ) == {"todos": todos}


@pytest.mark.parametrize("result", [[], "[]", [{"text": "[]"}]])
def test_empty_read_republishes_empty_board(result):
    assert asyncio.run(
        sales_state_from_result(SimpleNamespace(result_data=result))
    ) == {"todos": []}


@pytest.mark.parametrize("result", [None, "null", "{}", '["not a todo"]'])
def test_invalid_read_fails_instead_of_clearing_board(result):
    with pytest.raises(ValueError):
        asyncio.run(sales_state_from_result(SimpleNamespace(result_data=result)))
