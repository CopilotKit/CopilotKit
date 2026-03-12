"""
This is the main entry point for the agent.
It defines the workflow graph, state, tools, nodes and edges.
"""

from typing_extensions import Literal, TypedDict, Dict, List, Any, Union, Optional
from langchain_openai import ChatOpenAI
from langchain_core.runnables import RunnableConfig
from langgraph.graph import StateGraph, END
from langgraph.checkpoint.memory import MemorySaver
from langgraph.types import Command
from copilotkit import CopilotKitState
from langchain_mcp_adapters.client import MultiServerMCPClient
from langgraph.prebuilt import create_react_agent
from langchain_core.prompts import ChatPromptTemplate, MessagesPlaceholder
import os

# Define the connection type structures
class StdioConnection(TypedDict):
    command: str
    args: List[str]
    transport: Literal["stdio"]

class SSEConnection(TypedDict):
    url: str
    transport: Literal["sse"]

# Type for MCP configuration
MCPConfig = Dict[str, Union[StdioConnection, SSEConnection]]

class AgentState(CopilotKitState):
    """
    Here we define the state of the agent

    In this instance, we're inheriting from CopilotKitState, which will bring in
    the CopilotKitState fields. We're also adding a custom field, `mcp_config`,
    which will be used to configure MCP services for the agent.
    """
    # Define mcp_config as an optional field without skipping validation
    mcp_config: Optional[MCPConfig]

# Default MCP configuration to use when no configuration is provided in the state
# Uses relative paths that will work within the project structure
DEFAULT_MCP_CONFIG: MCPConfig = {
    "math": {
        "command": "python",
        # Use a relative path that will be resolved based on the current working directory
        "args": [os.path.join(os.path.dirname(__file__), "..", "math_server.py")],
        "transport": "stdio",
    },
}

# Define a custom ReAct prompt that encourages the use of multiple tools
MULTI_TOOL_REACT_PROMPT = ChatPromptTemplate.from_messages(
    [
        (
            "system",
            """You are an assistant that can use multiple tools to solve problems. 
You should use a step-by-step approach, using as many tools as needed to find the complete answer.
Don't hesitate to call different tools sequentially if that helps reach a better solution.

You have access to the following tools:

{{tools}}

To use a tool, please use the following format:
```
Thought: I need to use a tool to help with this.
Action: tool_name
Action Input: the input to the tool
```

The observation will be returned in the following format:
```
Observation: tool result
```

When you have the final answer, respond in the following format:
```
Thought: I can now provide the final answer.
Final Answer: the final answer to the original input
```

Begin!
"""
        ),
        MessagesPlaceholder(variable_name="messages"),
    ]
)

async def chat_node(state: AgentState, config: RunnableConfig) -> Command[Literal["__end__"]]:
    """
    This is an enhanced agent that uses a modified ReAct pattern to allow multiple tool use.
    It handles both chat responses and sequential tool execution in one node.
    """
    # Get MCP configuration from state, or use the default config if not provided
    mcp_config = state.get("mcp_config", DEFAULT_MCP_CONFIG)
    
    # Set up the MCP client and tools using the configuration from state
    async with MultiServerMCPClient(mcp_config) as mcp_client:
        # Get the tools
        mcp_tools = mcp_client.get_tools()
        print(f"mcp_tools: {mcp_tools}")
        
        # Create a model instance
        model = ChatOpenAI(model="gpt-4o")
        
        # Create the enhanced multi-tool react agent with our custom prompt
        react_agent = create_react_agent(
            model, 
            mcp_tools, 
            prompt=MULTI_TOOL_REACT_PROMPT
        )
        
        # Prepare messages for the react agent
        agent_input = {
            "messages": state["messages"]
        }
        
        # Run the react agent subgraph with our input
        agent_response = await react_agent.ainvoke(agent_input)

        print(f"agent_response: {agent_response}")
        
        # Update the state with the new messages
        updated_messages = state["messages"] + agent_response.get("messages", [])
        
        # End the graph with the updated messages
        return Command(
            goto=END,
            update={"messages": updated_messages},
        )

# Define the workflow graph with only a chat node
workflow = StateGraph(AgentState)
workflow.add_node("chat_node", chat_node)
workflow.set_entry_point("chat_node")

# Compile the workflow graph
graph = workflow.compile(MemorySaver())