"""
Tools for the todo agent.

Tools are functions that the AI agent can call to interact with the todo list.
Each tool receives a RunContext which contains:
- deps: Dependencies (in our case, StateDeps wrapping TodoState)
- usage: Token usage information
- messages: Conversation history

Tools that modify state return a StateSnapshotEvent, which tells AG-UI to
update the frontend with the new state.
"""

from __future__ import annotations

from uuid import uuid4

from ag_ui.core import EventType, StateSnapshotEvent
from pydantic_ai import RunContext
from pydantic_ai.ag_ui import StateDeps

from models import TodoItem, TodoState, TodoStatus

def _as_state_snapshot(ctx: RunContext[StateDeps[TodoState]]) -> StateSnapshotEvent:
  """
  Helper to create a state snapshot event for AG-UI.

  When tools return this, AG-UI knows to update the frontend with the new state.
  """
  return StateSnapshotEvent(type=EventType.STATE_SNAPSHOT, snapshot=ctx.deps.state)


def get_todos(ctx: RunContext[StateDeps[TodoState]]) -> list[TodoItem]:
  """
  Get the current list of todos. Always use this before making changes or answering questions.
  """
  return ctx.deps.state.todos


async def add_todos(
  ctx: RunContext[StateDeps[TodoState]],
  titles: list[str],
  descriptions: list[str | None] | None = None,
  statuses: list[TodoStatus] | None = None,
) -> StateSnapshotEvent:
  """
  Create new todos and append them to the board.

  The LLM can add multiple todos at once by providing lists of titles,
  descriptions, and statuses. UUIDs are auto-generated.
  """

  descriptions = descriptions or [None] * len(titles)
  statuses = statuses or [TodoStatus.TODO] * len(titles)

  for title, description, status in zip(titles, descriptions, statuses):
    ctx.deps.state.todos.append(
      TodoItem(
        id=str(uuid4()),
        title=title,
        description=description,
        status=status,
      )
    )

  return _as_state_snapshot(ctx)

async def update_todo(
  ctx: RunContext[StateDeps[TodoState]],
  id: str,
  title: str | None = None,
  description: str | None = None,
  status: TodoStatus | None = None,
) -> StateSnapshotEvent:
  """
  Update a todo in place if it exists.

  Only the provided fields are updated - others remain unchanged.
  This is commonly used to move todos between columns (changing status).
  """

  for todo in ctx.deps.state.todos:
    if todo.id == id:
      if title is not None:
        todo.title = title
      if description is not None:
        todo.description = description
      if status is not None:
        todo.status = status
      break

  return _as_state_snapshot(ctx)


async def delete_todos(ctx: RunContext[StateDeps[TodoState]], id: list[str]) -> StateSnapshotEvent:
  """Remove todos matching the provided IDs."""
  ctx.deps.state.todos = [todo for todo in ctx.deps.state.todos if todo.id not in id]
  return _as_state_snapshot(ctx)


async def set_todos(ctx: RunContext[StateDeps[TodoState]], todos: list[TodoItem]) -> StateSnapshotEvent:
  """Replace the entire todo list with the provided items."""
  ctx.deps.state.todos = todos
  return _as_state_snapshot(ctx)


async def demonstrate_error() -> str:
  """Intentionally raise an error to demonstrate UI handling."""
  raise ValueError("This is a deliberate error to show error handling! The agent will gracefully recover.")


# All tools available to the agent
tools = [
  get_todos,
  add_todos,
  update_todo,
  delete_todos,
  set_todos,
  demonstrate_error,
]
