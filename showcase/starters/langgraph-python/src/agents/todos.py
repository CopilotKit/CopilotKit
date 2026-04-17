"""
Sales todo tools for the showcase LangGraph agent.

Uses Command + ToolMessage for state updates, wrapping shared implementations.
"""

from src.agents.tool_wrappers import manage_sales_todos_impl, get_sales_todos_impl
from src.agents.tools.types import SalesTodo

from langchain.agents import AgentState as BaseAgentState
from langchain.tools import ToolRuntime, tool
from langchain.messages import ToolMessage
from langgraph.types import Command

class AgentState(BaseAgentState):
    todos: list[SalesTodo]

@tool
def manage_sales_todos(todos: list[SalesTodo], runtime: ToolRuntime) -> Command:
    """
    Manage the current sales todos. Pass the full updated list.
    """
    updated = manage_sales_todos_impl(todos)

    return Command(
        update={
            "todos": updated,
            "messages": [
                ToolMessage(
                    content="Successfully updated sales todos",
                    tool_call_id=runtime.tool_call_id,
                )
            ],
        }
    )

@tool
def get_sales_todos(runtime: ToolRuntime):
    """
    Get the current sales todos.
    """
    current = runtime.state.get("todos", [])
    return get_sales_todos_impl(current if current else None)

todo_tools = [manage_sales_todos, get_sales_todos]
