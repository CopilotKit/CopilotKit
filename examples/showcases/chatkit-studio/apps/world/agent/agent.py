"""
World Travel Agent - CopilotKit + LangGraph Demo

ReAct pattern agent that provides country information and calls
frontend UI actions via the AG-UI protocol.
"""

from typing import Any, List
from typing_extensions import Literal
from langchain_openai import ChatOpenAI
from langchain_core.messages import SystemMessage, BaseMessage
from langchain_core.runnables import RunnableConfig
from langgraph.graph import StateGraph, END
from langgraph.types import Command
from langgraph.graph import MessagesState
from langgraph.prebuilt import ToolNode

class AgentState(MessagesState):
    """Extends MessagesState to include tools from CopilotKit frontend."""
    tools: List[Any]  # Frontend tools like renderCountry

# Backend tools run on server (currently empty - frontend tools come from CopilotKit)
backend_tools = []
backend_tool_names = [tool.name for tool in backend_tools]

async def chat_node(state: AgentState, config: RunnableConfig) -> Command[Literal["tool_node", "__end__"]]:
    """Main ReAct node: binds tools, generates response, routes to tool_node if needed."""
    # Extract user-provided API key from config, fallback to environment variable
    configurable = config.get("configurable", {})
    user_api_key = configurable.get("openai_api_key")

    # Initialize model with user's API key if provided
    model_kwargs = {"model": "gpt-4o"}
    if user_api_key:
        model_kwargs["api_key"] = user_api_key

    model = ChatOpenAI(**model_kwargs)

    # Bind frontend + backend tools to the model
    model_with_tools = model.bind_tools(
        [*state.get("tools", []), *backend_tools],
        parallel_tool_calls=True,
    )

    system_message = SystemMessage(
        content="""You are a world travel guide assistant. When a user mentions wanting to visit or learn about a country, you have two tools available:

**visitCountry** - Animates the globe to focus on a country
**renderCountry** - Displays a beautiful country card in the chat

**IMPORTANT: When ANY user message mentions a country, you MUST call BOTH tools:**

1. Call visitCountry with the country name (animates the globe to that location)
2. Call renderCountry with country details (shows the visual card with flag and capital)
3. Provide fascinating information about the country

**Examples of user messages that trigger both tools:**
- "I want to visit France"
- "Show me Japan"
- "Take me to Brazil"
- "Tell me about Italy"
- "Let's explore Germany"

All of these should trigger BOTH visitCountry and renderCountry.

**Response Guidelines:**
- Provide fascinating information (5-8 sentences)
- Include interesting statistics like population, area, GDP, or cultural facts
- Be engaging and educational
- Keep responses concise but informative"""
    )

    response = await model_with_tools.ainvoke([
        system_message,
        *state["messages"],
    ], config)

    # Route to tool_node if backend tools called, otherwise end
    if route_to_tool_node(response):
        return Command(goto="tool_node", update={"messages": [response]})

    return Command(goto=END, update={"messages": [response]})

def route_to_tool_node(response: BaseMessage):
    """Check if response contains backend tool calls (frontend tools handled by CopilotKit)."""
    tool_calls = getattr(response, "tool_calls", None)
    if not tool_calls:
        return False
    return any(tool_call.get("name") in backend_tool_names for tool_call in tool_calls)

# Build LangGraph workflow
workflow = StateGraph(AgentState)
workflow.add_node("chat_node", chat_node)
workflow.add_node("tool_node", ToolNode(tools=backend_tools))
workflow.add_edge("tool_node", "chat_node")
workflow.set_entry_point("chat_node")

graph = workflow.compile()