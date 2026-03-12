"""
tkt-reconnect-lost-actions: Frontend actions lost on thread reconnect

Bug: langchain_messages_to_copilotkit() skips creating the assistant message
when an AIMessage has tool_calls. The parentMessageId in tool call objects
references a message ID that was never emitted, so the frontend can't
reconstruct the action component on reconnect.

Second bug: copilotkit_messages_to_langchain() doesn't filter by message type
when collecting tool calls by parentMessageId, causing KeyError on 'name'.

Slack: https://copilotkit.slack.com/archives/C09C4HRL8F9/p1769635454992139
"""

from fastapi import FastAPI
from copilotkit import CopilotKitMiddleware, LangGraphAGUIAgent
from langchain.agents import create_agent
from langgraph.checkpoint.memory import MemorySaver
from langchain.tools import tool
from ag_ui_langgraph import add_langgraph_fastapi_endpoint

TAG = "[tkt-reconnect-lost-actions agent]"

app = FastAPI()

print(f"{TAG} Initializing agent")


# Backend stub for get_help — the real execution happens on the frontend via
# useFrontendTool. The stub exists so the LLM sees the tool in its tool list.
# CopilotKitMiddleware intercepts the call and routes it to the frontend.
@tool
def get_help(topic: str):
    """Get help on a specific topic. This is a frontend action that renders a
    button in the chat UI. The user clicks the button to get help."""
    print(f"{TAG} get_help backend stub called (should be intercepted by middleware), topic: {topic}")
    return f"Here is help for: {topic}"


# Use create_agent (not create_deep_agent) to keep the tool list minimal.
# create_deep_agent adds dozens of built-in tools (filesystem, shell, todos,
# subagents) which drown out get_help and cause the LLM to ignore it.
agent = create_agent(
    model="openai:gpt-5-mini",
    tools=[get_help],
    middleware=[CopilotKitMiddleware()],
    checkpointer=MemorySaver(),
    system_prompt=(
        "You are a support assistant. When the user asks for help or support, "
        "you MUST call the get_help tool with a relevant topic. Always include "
        "a short text message along with the tool call.\n\n"
        "For example, if the user says 'support', call get_help with topic='general support'.\n"
        "If the user says 'help with billing', call get_help with topic='billing'."
    ),
)

print(f"{TAG} Agent created with get_help tool (minimal — no deep agent built-ins)")

add_langgraph_fastapi_endpoint(
    app,
    LangGraphAGUIAgent(
        name="default",
        description="Support agent that uses frontend get_help action",
        graph=agent,
        config={"recursion_limit": 100},
    ),
    "/",
)

print(f"{TAG} Endpoint mounted at /")
