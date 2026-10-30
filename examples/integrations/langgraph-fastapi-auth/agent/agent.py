"""
This is the main entry point for the agent.
It defines the workflow graph, state, tools, nodes and edges.
"""

import os
from typing import Any, List, Dict, Optional
from typing_extensions import Literal
from langchain_openai import ChatOpenAI
from langchain_core.messages import SystemMessage, BaseMessage
from langchain_core.runnables import RunnableConfig
from langchain.tools import tool
from langgraph.graph import StateGraph, END
from langgraph.types import Command
from langgraph.graph import MessagesState
from langgraph.prebuilt import ToolNode
from langgraph.checkpoint.memory import MemorySaver

from copilotkit import LangGraphAGUIAgent

from auth import get_user_info_from_authorization
from file_routes import get_file, list_files

# This custom agent is used to forward the authorization token from the client to the agent's config.
# It is a necessary component for the authentication to work in a self-hosted environment.
class CustomLangGraphAGUIAgent(LangGraphAGUIAgent):
    async def prepare_stream(
        self, input, agent_state, config: RunnableConfig
    ):
        forwarded_props = input.forwarded_props or {}
        
        # Start with the existing configurable values
        new_configurable = config.get("configurable", {}).copy()
        
        # Merge configurable from forwarded_props.config
        runtime_configurable = forwarded_props.get("config", {}).get("configurable", {})
        new_configurable.update(runtime_configurable)
        
        # Merge top-level authorization from forwarded_props
        if "authorization" in forwarded_props:
            new_configurable["authorization"] = forwarded_props["authorization"]
            
        config["configurable"] = new_configurable
        
        return await super().prepare_stream(input, agent_state, config)


class AgentState(MessagesState):
    """
    Here we define the state of the agent

    In this instance, we're inheriting from CopilotKitState, which will bring in
    the CopilotKitState fields. We're also adding a custom field, `language`,
    which will be used to set the language of the agent.
    """
    proverbs: List[str] = []
    tools: List[Any]
    authorization: Optional[Dict[str, Any]] = None
    # your_custom_agent_state: str = ""

@tool
def get_weather(location: str):
    """
    Get the weather for a given location.
    """
    return f"The weather for {location} is 70 degrees."

def _thread_and_user_id(config: RunnableConfig):
    """Returns the run's thread_id and the signed-in user's id from the run config, never from the model."""
    thread_id = config.get("configurable", {}).get("thread_id")
    user = get_user_info_from_config(config)
    return thread_id, (user or {}).get("user_id")


@tool
def get_file_content(file_id: str, config: RunnableConfig):
    """
    Retrieve and return the extracted content from a previously uploaded file (PDF, Excel, or CSV).
    Use this tool when a user references an uploaded file.
    """
    thread_id, user_id = _thread_and_user_id(config)
    if not thread_id or not user_id:
        return "Error: no signed-in user or conversation thread. Cannot retrieve files."

    data = get_file(thread_id, user_id, file_id)
    if not data:
        return f"File with ID {file_id} was not found. The file might have been deleted or the session expired. Please ask the user to upload the file again."

    filename = data.get("filename", "Unknown")
    text = data.get("text", "")
    file_type = data.get("file_type", "unknown")

    if file_type == "pdf":
        page_count = data.get("page_count", 0)
        return f"PDF Content Retrieved:\n- Filename: {filename}\n- Total Pages: {page_count}\n- Text Length: {len(text)} characters\n\nExtracted Text:\n{text}"
    elif file_type == "excel":
        sheet_count = data.get("sheet_count", 0)
        total_rows = data.get("total_rows", 0)
        return f"Excel Content Retrieved:\n- Filename: {filename}\n- Total Sheets: {sheet_count}\n- Total Rows: {total_rows}\n- Text Length: {len(text)} characters\n\nExtracted Content:\n{text}"
    elif file_type == "csv":
        total_rows = data.get("total_rows", 0)
        return f"CSV Content Retrieved:\n- Filename: {filename}\n- Total Rows: {total_rows}\n- Text Length: {len(text)} characters\n\nExtracted Content:\n{text}"
    else:
        return f"File Content Retrieved:\n- Filename: {filename}\n- Text Length: {len(text)} characters\n\nExtracted Content:\n{text}"

@tool
def list_uploaded_files(config: RunnableConfig):
    """
    Get information about all files (PDF, Excel, and CSV) the user uploaded to this conversation.
    This includes the file_ids needed to retrieve their content.
    """
    thread_id, user_id = _thread_and_user_id(config)
    if not thread_id or not user_id:
        return "Error: no signed-in user or conversation thread. Cannot list files."

    files = list_files(thread_id, user_id)
    if not files:
        return "No files are currently uploaded."

    return {
        "count": len(files),
        "files": files,
        "message": f"{len(files)} file(s) found. Use the 'get_file_content' tool with a file_id to retrieve content."
    }

# @tool
# def your_tool_here(your_arg: str):
#     """Your tool description here."""
#     print(f"Your tool logic here")
#     return "Your tool response here."

backend_tools = [
    get_weather,
    get_file_content,
    list_uploaded_files
    # your_tool_here
]

# Extract tool names from backend_tools for comparison
backend_tool_names = [tool.name for tool in backend_tools]


def get_user_info_from_config(config: RunnableConfig) -> Optional[Dict[str, Any]]:
    """
    Extracts user information from the RunnableConfig by looking for an authorization token.
    """
    configurable = config.get("configurable", {})
    auth_token = configurable.get("authorization")

    if not auth_token:
        return None

    user_info = get_user_info_from_authorization(auth_token)
    
    if user_info:
        print(f"✅ Authenticated user: {user_info.get('name')} (ID: {user_info.get('user_id')})")
    else:
        print("⚠️  Failed to authenticate user from token.")
        
    return user_info


def auth_node(state: AgentState, config: RunnableConfig) -> AgentState:
    """
    Authenticates the user and updates the state with user information.
    If no authentication is found, it defaults to an anonymous user.
    """
    user_data = get_user_info_from_config(config)
    
    if user_data:
        state["authorization"] = user_data
    else:
        print("⚠️  No authentication found - using anonymous user")
        state["authorization"] = {
            "user_id": "anonymous",
            "name": None,
            "email": None,
            "role": None,
        }
    return state


async def chat_node(state: AgentState, config: RunnableConfig) -> Command[Literal["tool_node", "__end__"]]:
    """
    Standard chat node based on the ReAct design pattern. It handles:
    - The model to use (and binds in CopilotKit actions and the tools defined above)
    - The system prompt
    - Getting a response from the model
    - Handling tool calls

    For more about the ReAct design pattern, see:
    https://www.perplexity.ai/search/react-agents-NcXLQhreS0WDzpVaS4m9Cg
    """

    # 1. Define the model
    #    OPENAI_MODEL picks the model; OPENAI_BASE_URL (read by the OpenAI client)
    #    points it at any OpenAI-compatible API instead of api.openai.com.
    model = ChatOpenAI(model=os.getenv("OPENAI_MODEL", "gpt-4o"))

    # Get user information from the state, which was set in the auth_node
    user_data = state.get("authorization")
    is_authenticated = user_data and user_data.get("user_id") != "anonymous"

    # 2. Bind the tools to the model
    # Conditionally include backend_tools if the user is authenticated
    tools_to_bind = list(state.get("tools", []))
    if is_authenticated:
        tools_to_bind.extend(backend_tools)

    model_with_tools = model.bind_tools(
        tools_to_bind,
        # 2.1 Disable parallel tool calls to avoid race conditions,
        #     enable this for faster performance if you want to manage
        #     the complexity of running tool calls in parallel.
        parallel_tool_calls=False,
    )

    # 3. Define the system message
    user_info = ""
    if is_authenticated:
        user_id = user_data.get("user_id")
        user_name = user_data.get("name") or "Unknown"
        user_email = user_data.get("email") or "not provided"
        user_role = user_data.get("role") or "user"
        user_info = f"The current user is {user_name} (ID: {user_id}, Email: {user_email}, Role: {user_role})."
    else:
        user_info = "The user is not authenticated. Certain tools like file handling are unavailable. If asked about files or to perform actions requiring login, inform the user they need to sign in."
    
    system_message = SystemMessage(
        content=f"""You are a helpful assistant.
{user_info}
When asked about the current user's identity (e.g., 'who am I?'), provide the user's details from the information above.
The current proverbs are {state.get('proverbs', [])}.

IMPORTANT FILE HANDLING:
- You have access to tools for file handling: `list_uploaded_files` and `get_file_content`.
- `list_uploaded_files` gets a list of the files the user uploaded to this conversation (PDF, Excel, and CSV).
- `get_file_content` retrieves the content of one file by its `file_id`.
- Supported file types: PDF documents, Excel spreadsheets (.xlsx), and CSV files (.csv).
- If the user asks about files, documents, PDFs, Excel, spreadsheets, you MUST:
  1. First, call the `list_uploaded_files` tool to get the list of file metadata (file_id, name, type).
  2. Then, call `get_file_content` with the appropriate `file_id` to retrieve the content.
  3. If multiple files are uploaded and the user is vague, ask for clarification on which file to analyze.
  4. Finally, answer the user's question based on the retrieved content.
- Never ask the user for a file_id - you can list the files yourself.
- When multiple files are present, reference them by filename and type for clarity.
- For Excel files, the content includes sheet names, column names, row counts, and data preview."""
    )

    # 4. Run the model to generate a response
    response = await model_with_tools.ainvoke([
        system_message,
        *state["messages"],
    ], config)

    # only route to tool node if tool is not in the tools list
    if route_to_tool_node(response):
        print("routing to tool node")
        return Command(
            goto="tool_node",
            update={
                "messages": [response],
            }
        )

    # 5. We've handled all tool calls, so we can end the graph.
    return Command(
        goto=END,
        update={
            "messages": [response],
        }
    )

def route_to_tool_node(response: BaseMessage):
    """
    Route to tool node if any tool call in the response matches a backend tool name.
    """
    tool_calls = getattr(response, "tool_calls", None)
    if not tool_calls:
        return False

    for tool_call in tool_calls:
        if tool_call.get("name") in backend_tool_names:
            return True
    return False

# Define the workflow graph
workflow = StateGraph(AgentState)
workflow.add_node("auth_node", auth_node)
workflow.add_node("chat_node", chat_node)
workflow.add_node("tool_node", ToolNode(tools=backend_tools))
workflow.add_edge("auth_node", "chat_node")
workflow.add_edge("tool_node", "chat_node")
workflow.set_entry_point("auth_node")

graph = workflow.compile(checkpointer=MemorySaver())
