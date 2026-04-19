"""Sales todos tool implementation."""

from __future__ import annotations

import uuid
from typing import Optional

from src.agents.types import SalesTodo

INITIAL_TODOS: list[SalesTodo] = [
    SalesTodo(
        id="st-001",
        title="Follow up with Acme Corp on enterprise proposal",
        stage="proposal",
        value=85000,
        dueDate="2026-04-15",
        assignee="Sarah Chen",
        completed=False,
    ),
    SalesTodo(
        id="st-002",
        title="Qualify lead from TechFlow demo request",
        stage="prospect",
        value=42000,
        dueDate="2026-04-18",
        assignee="Mike Johnson",
        completed=False,
    ),
    SalesTodo(
        id="st-003",
        title="Send contract to DataViz Inc for final review",
        stage="negotiation",
        value=120000,
        dueDate="2026-04-20",
        assignee="Sarah Chen",
        completed=False,
    ),
]

def manage_sales_todos_impl(todos: list[dict]) -> list[SalesTodo]:
    """Assign UUIDs to any todos missing an ID, then return the updated list."""
    result: list[SalesTodo] = []
    for todo in todos:
        result.append(SalesTodo(
            id=todo.get("id") or str(uuid.uuid4()),
            title=todo.get("title", ""),
            stage=todo.get("stage", "prospect"),
            value=todo.get("value", 0),
            dueDate=todo.get("dueDate", ""),
            assignee=todo.get("assignee", ""),
            completed=todo.get("completed", False),
        ))
    return result

def get_sales_todos_impl(current_todos: Optional[list[dict]] = None) -> list[SalesTodo]:
    """Return current todos or initial defaults if none provided."""
    if current_todos is not None:
        return manage_sales_todos_impl(current_todos)
    return list(INITIAL_TODOS)
