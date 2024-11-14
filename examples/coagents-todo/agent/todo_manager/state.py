from typing import Literal, TypedDict, List
from langgraph.graph import MessagesState

class Todo(TypedDict):
    """A todo item."""
    id: str
    title: str
    status: Literal["todo", "done"]

class AgentState(MessagesState):
    """The state of the agent."""
    todos: List[Todo]
