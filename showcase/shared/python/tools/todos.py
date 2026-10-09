"""Canonical Beautiful Chat board todos, including legacy sales-state input.

Sales-pipeline consumers use sales_todos.py and its completed boolean. The
Beautiful Chat board uses status instead; never persist both representations
because a frontend toggle updates only status.
"""

from __future__ import annotations

import uuid
from typing import Literal
from typing_extensions import NotRequired, Required, TypedDict


class BoardTodoInput(TypedDict, total=False):
    """Complete board item. Copy existing ids exactly; omit id only for new items."""

    id: NotRequired[str]
    title: Required[str]
    description: str
    emoji: str
    status: Literal["pending", "completed"]
    # Preserve optional sales metadata and accept older saved todo records.
    stage: str
    value: float
    dueDate: str
    assignee: str
    completed: bool
    notes: str


def manage_todos_impl(todos: list[dict]) -> list[dict]:
    """Normalize a complete board list without dropping notes or metadata."""
    result = []
    for todo in todos:
        item = dict(todo)
        status = item.get("status")
        if status is None:
            status = "completed" if item.get("completed", False) else "pending"
        if status not in ("pending", "completed"):
            raise ValueError(f"Unsupported todo status: {status!r}")
        item.update(
            id=item.get("id") or str(uuid.uuid4()),
            title=item.get("title", item.get("name", "")),
            description=item.get("description", item.get("notes", "")),
            emoji=item.get("emoji", "🎯"),
            status=status,
        )
        item.pop("completed", None)
        result.append(item)
    return result
