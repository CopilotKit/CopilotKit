"""
This is the main entry point for the agent.
It defines the workflow graph, state, tools, nodes and edges.
"""

import uuid
from typing import List, Literal

from copilotkit import CopilotKitState
from langchain_core.messages import SystemMessage, ToolMessage
from langchain_core.runnables import RunnableConfig
from langchain_core.tools import tool, InjectedToolCallId
from langchain_openai import ChatOpenAI
from langgraph.checkpoint.memory import MemorySaver
from langgraph.graph import StateGraph
from langgraph.prebuilt import InjectedState, ToolNode
from langgraph.types import Command
from typing_extensions import Annotated, TypedDict

from src.query import query_data
from src.form import generate_form
from src.util import should_route_to_tool_node


class Todo(TypedDict):
    id: str
    title: str
    description: str
    emoji: str
    status: Literal["pending", "completed"]


class AgentState(CopilotKitState):
    """
    The state of the agent. Inherits from CopilotKitState which provides
    the messages and copilotkit fields. We add todos for the shared todo list.
    """
    todos: List[Todo]


@tool
def manage_todos(todos: List[Todo], tool_call_id: Annotated[str, InjectedToolCallId]) -> Command:
    """
    Manage the current todos. Call this to add, update, or remove todos.
    """
    # Ensure all todos have unique IDs
    for todo in todos:
        if "id" not in todo or not todo["id"]:
            todo["id"] = str(uuid.uuid4())

    return Command(update={
        "todos": todos,
        "messages": [ToolMessage("Successfully updated todos", tool_call_id=tool_call_id)],
    })


@tool
def get_todos(state: Annotated[dict, InjectedState]) -> List[Todo]:
    """
    Get the current list of todos.
    """
    return state.get("todos", [])


tools = [manage_todos, get_todos, query_data, generate_form]


async def chat_node(
    state: AgentState, config: RunnableConfig
) -> Command[Literal["tool_node", "__end__"]]:
    """
    Standard chat node based on the ReAct design pattern.
    """

    # 1. Define the model
    model = ChatOpenAI(model="gpt-4.1")

    # 2. Bind both frontend actions and backend tools to the model
    fe_tools = state.get("copilotkit", {}).get("actions", [])
    model_with_tools = model.bind_tools([*fe_tools, *tools])

    # 3. Build the system message
    system_message = SystemMessage(
        content="""You are a polished, professional demo assistant using CopilotKit and LangGraph. Only mention either when necessary.

Keep responses brief and polished — 1 to 2 sentences max. No verbose explanations.

When demonstrating charts, always call the query_data tool to fetch data first.
When asked to manage todos, enable app mode first, then manage todos."""
    )

    # 4. Run the model
    response = await model_with_tools.ainvoke(
        [system_message, *state["messages"]],
        config,
    )

    tool_calls = response.tool_calls

    # 5. If all tool calls are backend tools, route to tool_node.
    #    If any are frontend actions, return them directly (frontend handles them).
    if tool_calls and should_route_to_tool_node(tool_calls, fe_tools):
        return Command(goto="tool_node", update={"messages": response})

    return Command(goto="__end__", update={"messages": response})


# Define the workflow graph
workflow = StateGraph(AgentState)
workflow.add_node("chat_node", chat_node)
workflow.add_node("tool_node", ToolNode(tools=tools))
workflow.add_edge("tool_node", "chat_node")
workflow.set_entry_point("chat_node")

checkpointer = MemorySaver()
graph = workflow.compile(checkpointer=checkpointer)
