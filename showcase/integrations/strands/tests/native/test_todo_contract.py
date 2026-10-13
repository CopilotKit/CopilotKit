"""Real SDK schema and FileSessionManager round trips (no model/network calls)."""

import asyncio
import sys
from pathlib import Path

import pytest
import json

from strands import Agent
from strands.models.openai import OpenAIModel
from strands.session.file_session_manager import FileSessionManager
from strands.types.tools import ToolContext

ROOT = Path(__file__).resolve().parents[2]
sys.path[:0] = [str(ROOT / "src"), str(ROOT)]
from agents.agent import (
    get_sales_todos,
    manage_sales_todos,
    sales_state_from_args,
    sales_state_from_result,
)
from types import SimpleNamespace


def context(agent, call="create"):
    return ToolContext(
        agent=agent,
        tool_use={"toolUseId": call, "name": "manage_sales_todos", "input": {}},
        invocation_state={},
    )


def test_schema_and_durable_board(tmp_path):
    schema = manage_sales_todos.tool_spec["inputSchema"]["json"]
    item = schema["$defs"]["BoardTodoInput"]
    assert {"id", "title", "description", "emoji", "status"} <= item[
        "properties"
    ].keys()
    assert item["properties"]["status"]["enum"] == ["pending", "completed"]
    assert "title" in item["required"]
    model = OpenAIModel(client_args={"api_key": "unused"}, model_id="gpt-4o")

    def restore(session):
        manager = FileSessionManager(session_id=session, storage_dir=str(tmp_path))
        return Agent(
            model=model,
            session_manager=manager,
            tools=[manage_sales_todos, get_sales_todos],
            callback_handler=None,
        ), manager

    agent, manager = restore("original")
    todos = [
        {"title": "Cedar", "description": "Follow up Cedar", "status": "pending"},
        {"title": "Maple", "description": "Prepare Maple demo", "status": "pending"},
    ]
    manage_sales_todos(todos=todos, tool_context=context(agent))
    saved = get_sales_todos(tool_context=context(agent))
    assert (
        saved
        == asyncio.run(
            sales_state_from_args(
                SimpleNamespace(tool_input={"todos": todos}, tool_use_id="create")
            )
        )["todos"]
    )
    manager.sync_agent(agent)
    restored, manager = restore("original")
    assert get_sales_todos(tool_context=context(restored)) == saved
    assert asyncio.run(
        sales_state_from_result(
            SimpleNamespace(result_data=get_sales_todos(tool_context=context(restored)))
        )
    ) == {"todos": saved}
    saved[0]["status"] = "completed"
    manage_sales_todos(todos=saved, tool_context=context(restored, "update"))
    manager.sync_agent(restored)
    restarted, _ = restore("original")
    assert get_sales_todos(tool_context=context(restarted)) == saved
    fresh, _ = restore("other")
    assert get_sales_todos(tool_context=context(fresh)) == []


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
