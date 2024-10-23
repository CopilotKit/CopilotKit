"""Test Q&A Agent"""

from typing import Any, cast
from langchain_openai import ChatOpenAI
from langgraph.graph import StateGraph, END
from langgraph.graph import MessagesState
from langgraph.checkpoint.memory import MemorySaver
from langchain_core.runnables import RunnableConfig
from langchain_core.messages import SystemMessage, ToolMessage
from copilotkit.langchain import (
  copilotkit_customize_config, copilotkit_exit, copilotkit_emit_message
)

class EmailAgentState(MessagesState):
    """Email Agent State"""
    email: str

async def email_node(state: EmailAgentState, config: RunnableConfig):
    """
    Write an email.
    """

    config = copilotkit_customize_config(
        config,
        emit_tool_calls=True,
    )

    system_message = "You write emails."

    email_tool = {
        'name': 'write_email',
        'description': """Write an email.""",
        'parameters': {
            'type': 'object',
            'properties': {
                'the_email': {
                    'description': """The email""",
                    'type': 'string',                    
                }
            },
            'required': ['the_email']
        }
    }

    email_model = ChatOpenAI(model="gpt-4o").bind_tools(
        [email_tool],
        parallel_tool_calls=False,
        tool_choice="write_email"
    )

    print("GENERATING EMAIL")
    response = await email_model.ainvoke([
        *state["messages"],
        SystemMessage(
            content=system_message
        )
    ], config)

    tool_calls = cast(Any, response).tool_calls

    email = tool_calls[0]["args"]["the_email"]

    
    return {
        "email": email,
    }

async def send_email_node(state: EmailAgentState, config: RunnableConfig):
    """
    Send an email.
    """

    config = copilotkit_customize_config(
        config,
        emit_messages=True,
    )


    await copilotkit_exit(config)

    # get the last message and cast to ToolMessage
    last_message = cast(ToolMessage, state["messages"][-1])
    if last_message.content == "CANCEL":
        await copilotkit_emit_message(config, "❌ Cancelled sending email.")
    else:
        await copilotkit_emit_message(config, "✅ Sent email.")


    return {
        "messages": state["messages"],
    }

def route(state: EmailAgentState):
    """Route to the appropriate node."""

    print("ROUTING")
    print(state.get("email", None) is not None)
    print("---")

    if state.get("email", None) is not None:
        return "send_email_node"
    return "email_node"

workflow = StateGraph(EmailAgentState)
workflow.add_node("email_node", email_node)
workflow.add_node("send_email_node", send_email_node)
workflow.set_entry_point("email_node")
workflow.set_conditional_entry_point(route)

workflow.add_edge("email_node", "send_email_node")
workflow.add_edge("send_email_node", END)
memory = MemorySaver()
graph = workflow.compile(checkpointer=memory, interrupt_after=["email_node"])
