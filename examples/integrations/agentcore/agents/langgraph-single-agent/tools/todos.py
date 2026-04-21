# patterns/langgraph-single-agent/tools/todos.py
# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: Apache-2.0

import uuid
from typing import Literal, TypedDict

from langchain.agents import AgentState as BaseAgentState
from langchain.tools import ToolRuntime, tool
from langchain_core.messages import ToolMessage
from langgraph.types import Command

# ToolRuntime is confirmed available at langchain.tools (langchain >= 1.2).
# If you see an ImportError, verify your langchain version is >= 0.3.

APP_MODE_MARKER = "APP_MODE_READY"


class Todo(TypedDict):
    id: str
    title: str
    description: str
    emoji: str
    status: Literal["pending", "completed"]


class AgentState(BaseAgentState):
    todos: list[Todo]


def _assign_ids(todos: list[dict]) -> list[dict]:
    """Assign a uuid4 to any todo that has a missing or empty 'id'."""
    for todo in todos:
        if not todo.get("id"):
            todo["id"] = str(uuid.uuid4())
    return todos


@tool
def manage_todos(
    todos: list[Todo], app_mode_marker: str, runtime: ToolRuntime
) -> Command:
    """
    Manage the current todos. Replaces the entire todo list.
    Assigns a unique UUID to any todo that is missing one.

    REQUIRED: app_mode_marker must be the exact string returned by a prior
    enableAppMode tool call in this conversation. Do NOT guess or fabricate
    this value. If you have not yet called enableAppMode and received its
    result, call enableAppMode first in a separate turn, wait for the
    returned token, then call manage_todos with that token.
    """
    if app_mode_marker != APP_MODE_MARKER:
        return Command(
            update={
                "messages": [
                    ToolMessage(
                        content=(
                            "Error: invalid app_mode_marker. Call enableAppMode "
                            "first (alone, in its own turn), then pass its "
                            "returned value as app_mode_marker."
                        ),
                        tool_call_id=runtime.tool_call_id,
                    )
                ]
            }
        )
    _assign_ids(todos)  # type: ignore[arg-type]

    return Command(
        update={
            "todos": todos,
            "messages": [
                ToolMessage(
                    content="Successfully updated todos",
                    tool_call_id=runtime.tool_call_id,
                )
            ],
        }
    )


@tool
def get_todos(runtime: ToolRuntime) -> list[Todo]:
    """
    Get the current todo list from agent state.
    """
    return runtime.state.get("todos", [])


todo_tools = [manage_todos, get_todos]
