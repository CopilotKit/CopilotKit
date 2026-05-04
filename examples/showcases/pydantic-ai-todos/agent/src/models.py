"""
Pydantic models for the Agent's state.

These models define:
1. TodoStatus - The three states a todo can be in
2. TodoItem - The structure of a single todo
3. TodoState - The overall state managed by the agent
"""

from enum import Enum
from pydantic import BaseModel, Field

class TodoStatus(str, Enum):
  """Status of a todo - determines which column it appears in."""
  TODO = "todo"
  IN_PROGRESS = "in-progress"
  DONE = "done"

class TodoItem(BaseModel):
  """
  A single todo item.

  The 'description' parameter on each Field is used by the LLM to understand
  what data to provide when calling tools that use these models.
  """
  id: str = Field(description='Unique identifier for the todo')
  title: str = Field(description='Title of the todo')
  description: str | None = Field(default=None, description='Optional description')
  status: TodoStatus = Field(default=TodoStatus.TODO, description='Status of the todo')

class TodoState(BaseModel):
  """
  The complete state of the todo board.

  This is passed to all tools via the RunContext and can be mutated by tools.
  AG-UI automatically syncs state changes to the frontend.
  """
  todos: list[TodoItem] = Field(default_factory=list, description='The list of todos')
