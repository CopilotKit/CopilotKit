from uuid import uuid4

from pydantic import BaseModel
from strands import tool


class Todo(BaseModel):
    id: str = ""
    title: str
    description: str
    emoji: str
    status: str = "pending"  # "pending" | "completed"


@tool
def manage_todos(todos: list[Todo]) -> str:
    """Manage the current todos.

    IMPORTANT: Always pass the full list, not just new items. Each todo
    should have a title, description, emoji, and status (pending/completed).
    """
    # Strands @tool passes ``model_dump()`` output, so list elements arrive
    # as plain dicts. Rehydrate before accessing fields.
    todos = [Todo.model_validate(t) for t in todos]
    for todo in todos:
        if not todo.id:
            todo.id = str(uuid4())
    return "Successfully updated todos"


@tool
def get_todos() -> str:
    """Get the current todos.

    The current list is injected into the prompt by the state context
    builder, so this tool just acknowledges that and tells the model to
    read it from there.
    """
    return "See the current todos list already provided in the conversation context."


todo_tools = [manage_todos, get_todos]
