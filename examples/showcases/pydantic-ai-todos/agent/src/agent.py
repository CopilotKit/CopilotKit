"""
PydanticAI todo agent.

This demonstrates a simple AI agent that manages a todo list using PydanticAI.
The agent uses tools to create, read, update, and delete todos.
"""

from pydantic_ai import Agent
from pydantic_ai.ag_ui import StateDeps
from pydantic_ai.models.openai import OpenAIResponsesModel
from dotenv import load_dotenv
from models import TodoState
from tools import tools

# Load environment variables (OPENAI_API_KEY, LOGFIRE_TOKEN, etc.)
load_dotenv()

# Create the agent
# - model: The LLM to use (GPT-4.1-mini via OpenAI)
# - deps_type: The type of dependencies/state passed to tools (StateDeps wraps TodoState for AG-UI)
# - tools: Functions the agent can call to interact with the todo list
agent = Agent(
  model=OpenAIResponsesModel('gpt-4.1-mini'),
  deps_type=StateDeps[TodoState],
  tools=tools,
)
