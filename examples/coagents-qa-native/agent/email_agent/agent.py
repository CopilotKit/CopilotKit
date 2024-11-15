"""Test Q&A Agent"""

from typing import Any, cast
from langgraph.graph import StateGraph, END
from langgraph.checkpoint.memory import MemorySaver
from langchain_core.runnables import RunnableConfig
from langchain_core.messages import HumanMessage, ToolMessage
from copilotkit.langchain import (
  copilotkit_customize_config, copilotkit_exit, copilotkit_emit_message
)
from pydantic import BaseModel, Field
from email_agent.model import get_model
from email_agent.state import EmailAgentState

class EmailTool(BaseModel):
    """
    Write an email.
    """
    the_email: str = Field(description="The email to be written.")

async def email_node(state: EmailAgentState, config: RunnableConfig):
    """
    Write an email.
    """

    config = copilotkit_customize_config(
        config,
        emit_tool_calls=True,
    )

    instructions = "You write emails."

    email_model = get_model(state).bind_tools(
        [EmailTool],
        tool_choice="EmailTool"
    )

    response = await email_model.ainvoke([
        *state["messages"],
        HumanMessage(
            content=instructions
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


workflow = StateGraph(EmailAgentState)
workflow.add_node("email_node", email_node)
workflow.add_node("send_email_node", send_email_node)
workflow.set_entry_point("email_node")

workflow.add_edge("email_node", "send_email_node")
workflow.add_edge("send_email_node", END)
memory = MemorySaver()
graph = workflow.compile(checkpointer=memory, interrupt_after=["email_node"])
