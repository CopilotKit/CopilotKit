import json
import uuid
from typing import Literal, List

from pydantic import BaseModel, Field
from strands import tool


class Todo(BaseModel):
    id: str = Field(default="", description="Unique identifier for the todo")
    title: str = Field(default="", description="Title of the todo")
    description: str = Field(default="", description="Description of the todo")
    emoji: str = Field(default="", description="Emoji icon for the todo")
    status: Literal["pending", "completed"] = Field(default="pending", description="Status of the todo")


class TodoList(BaseModel):
    """The complete list of todos."""
    todos: List[Todo] = Field(description="The complete list of todos")


@tool
def manage_todos(todo_list: TodoList) -> str:
    """Manage the current todos. Always provide the complete list of todos, not just changes.

    Args:
        todo_list: The complete updated list of todos
    """
    return "Successfully updated todos"


@tool
def get_todos() -> str:
    """Get the current todos. The current todos are available in the conversation context."""
    return "Current todos are available in the conversation context above."


def build_todos_prompt(input_data, user_message: str) -> str:
    """Inject the current todos state into the prompt."""
    state_dict = getattr(input_data, "state", None)
    if isinstance(state_dict, dict) and "todos" in state_dict:
        todos_json = json.dumps(state_dict["todos"], indent=2)
        return (
            f"Current todos list:\n{todos_json}\n\nUser request: {user_message}"
        )
    return user_message


async def todos_state_from_args(context):
    """Extract todos state from tool arguments and emit state snapshot."""
    try:
        tool_input = context.tool_input
        if isinstance(tool_input, str):
            tool_input = json.loads(tool_input)

        todo_list_data = tool_input.get("todo_list", tool_input)

        if isinstance(todo_list_data, dict):
            todos = todo_list_data.get("todos", [])
        elif isinstance(todo_list_data, list):
            todos = todo_list_data
        else:
            todos = []

        # Ensure all todos have unique IDs
        for todo in todos:
            if isinstance(todo, dict) and not todo.get("id"):
                todo["id"] = str(uuid.uuid4())

        return {"todos": todos}
    except Exception:
        return None


async def todos_state_from_result(context):
    """Update todos state from tool result payload."""
    if isinstance(context.result_data, dict):
        todos = context.result_data.get("todos", [])
        return {"todos": todos}
    return None
