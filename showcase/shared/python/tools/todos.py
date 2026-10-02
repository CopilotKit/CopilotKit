"""Canonical Beautiful Chat board todos, including legacy sales-state input.

Sales-pipeline consumers use sales_todos.py and its completed boolean. The
Beautiful Chat board uses status instead; never persist both representations
because a frontend toggle updates only status.
"""

from __future__ import annotations

import uuid


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
            title=item.get("title", ""),
            description=item.get("description", item.get("notes", "")),
            emoji=item.get("emoji", "🎯"),
            status=status,
        )
        item.pop("completed", None)
        result.append(item)
    return result
