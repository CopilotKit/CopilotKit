import json
import uuid
from typing import Dict, List

from google.adk.tools import ToolContext


def manage_todos(tool_context: ToolContext, todos: List[dict]) -> Dict[str, str]:
    """
    Manage the current todos. Call this to add, update, or remove todos.

    Args:
        "todos": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "id": {"type": "string"},
                    "title": {"type": "string"},
                    "description": {"type": "string"},
                    "emoji": {"type": "string"},
                    "status": {"type": "string", "enum": ["pending", "completed"]}
                }
            },
            "description": "The complete list of todos"
        }

    Returns:
        Dict indicating success status
    """
    for todo in todos:
        if "id" not in todo or not todo["id"]:
            todo["id"] = str(uuid.uuid4())

    tool_context.state["todos"] = todos
    return {"status": "success", "message": "Successfully updated todos"}


def get_todos(tool_context: ToolContext) -> List[dict]:
    """
    Get the current list of todos.
    """
    return tool_context.state.get("todos", [])
