from langchain_core.messages import ToolCall


def should_route_to_tool_node(tool_calls: list[ToolCall], fe_tools: list[ToolCall]):
    """
    Returns True if none of the tool calls are frontend tools.

    Args:
        tool_calls: List of tool calls from the model response
        fe_tools: List of frontend tool names

    Returns:
        bool: True if all tool calls are backend tools, False if any are frontend tools
    """
    if not tool_calls:
        return False

    # Get the set of frontend tool names for faster lookup
    fe_tool_names = {tool.get("name") for tool in fe_tools}

    # Check if any tool call is a frontend tool
    for tool_call in tool_calls:
        tool_name = (
            tool_call.get("name")
            if isinstance(tool_call, dict)
            else getattr(tool_call, "name", None)
        )
        if tool_name in fe_tool_names:
            return False

    # None of the tool calls are frontend tools
    return True
