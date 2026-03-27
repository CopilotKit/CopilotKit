"""Todo state management tools for LangGraph agent."""

import uuid
from typing import Annotated, Literal
from langgraph.prebuilt.chat_agent_executor import AgentState as BaseAgentState
from langgraph.types import Command
from langchain_core.tools import tool
from typing import TypedDict


class Todo(TypedDict):
    id: str
    title: str
    description: str
    status: Literal["todo", "in_progress", "done"]
    priority: Literal["low", "medium", "high"]


class AgentState(BaseAgentState):
    todos: list[Todo]


@tool
def manage_todos(
    todos: Annotated[list[dict], "The complete, updated list of todos. Replaces current state."]
) -> Command:
    """
    Replace the entire todo list with the provided list.
    Each todo must have: title (str), status ('todo'|'in_progress'|'done'),
    and optionally description (str) and priority ('low'|'medium'|'high').

    Always send the full list — partial updates are not supported.
    """
    normalized = []
    for t in todos:
        normalized.append({
            "id": t.get("id") or str(uuid.uuid4()),
            "title": t["title"],
            "description": t.get("description", ""),
            "status": t.get("status", "todo"),
            "priority": t.get("priority", "medium"),
        })
    return Command(update={"todos": normalized})


@tool
def get_todos(state: AgentState) -> list[Todo]:
    """Return the current list of todos from agent state."""
    return state.get("todos", [])
