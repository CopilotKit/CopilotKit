from typing import cast, List
from langchain_core.messages import ToolMessage, AIMessage
from langchain_core.runnables import RunnableConfig
from langchain_core.tools import tool
from todo_manager.state import AgentState, Todo

async def todo_node(state: AgentState, config: RunnableConfig):
    """Execute todo operations"""
    ai_message = cast(AIMessage, state["messages"][-1])
    if not ai_message.tool_calls:
        return state

    action_handlers = {
        "add_todos": lambda args: handle_add_todos(state, args),
        "delete_todos": lambda args: handle_delete_todos(state, args),
        "update_todos": lambda args: handle_update_todos(state, args)
    }

    # Initialize the todos list if it doesn't exist
    if not state.get("todos"):
        state["todos"] = []

    for tool_call in ai_message.tool_calls:
        action = tool_call["name"]
        args = tool_call.get("args", {})
        
        if action in action_handlers:
            message = action_handlers[action](args)
            
            state["messages"].append(ToolMessage(
                tool_call_id=tool_call["id"],
                content=message,
                name=action
            ))

    return state


# Tools cannot manipulate state so we define tools here and provide them to the LLM so that when we route
# in agent.route we can determine that tool call should route to the todo_node. From there we can execute
# the actual logic for CRUD operations. These are laid out below such that each tool defintion and its
# eventual implementation are grouped together.
@tool
def add_todos(todos: List[Todo]):
    """Add one or many todos to the list"""

def handle_add_todos(state: AgentState, args: dict) -> str:
    todos = args.get("todos", [])

    state["todos"].extend(todos)
    return f"Added {len(todos)} todos!"

@tool
def update_todos(todos: List[Todo]):
    """Update one or many todos"""

def handle_delete_todos(state: AgentState, args: dict) -> str:
    todo_ids = args.get("todo_ids", [])

    state["todos"] = [todo for todo in state["todos"] if todo["id"] not in todo_ids]
    return f"Deleted {len(todo_ids)} todos!"


@tool
def delete_todos(todo_ids: List[str]):
    """Delete one or many todos"""

def handle_update_todos(state: AgentState, args: dict) -> str:
    todos = args.get("todos", [])
    for todo in todos:
        state["todos"] = [
            {**existing_todo, **todo} if existing_todo["id"] == todo["id"] else existing_todo
            for existing_todo in state["todos"]
        ]
    return f"Updated {len(todos)} todos!"
