"""Todo management tool for Strands agent."""

import json
import uuid
from strands import tool


@tool
def manage_todos(todos: list) -> str:
    """
    Update the todo list. Each item must have 'title' and optionally
    'description', 'status' ('todo'|'in_progress'|'done'), 'priority' ('low'|'medium'|'high').
    Returns a confirmation string. State sync is handled by CopilotKit's PredictStateMapping.

    Args:
        todos: Complete replacement list of todo items.
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
    return json.dumps({"updated": True, "count": len(normalized), "todos": normalized})
