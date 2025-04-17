"""Test Q&A Agent"""

from typing import Any, cast

from langgraph.graph import StateGraph, END # pylint: disable=no-name-in-module, import-error
from langgraph.types import interrupt # pylint: disable=no-name-in-module, import-error
from langchain_core.runnables import RunnableConfig 
from langchain_core.messages import HumanMessage, ToolMessage, AIMessage
from copilotkit.langgraph import (
  copilotkit_customize_config, copilotkit_exit, copilotkit_emit_message, copilotkit_interrupt
)
from email_agent.langgraph.model import get_model
from email_agent.langgraph.state import EmailAgentState


async def email_node(state: EmailAgentState, config: RunnableConfig):
    """
    Write an email.
    """
    auth_token = config['configurable'].get('authToken', None)
    if auth_token != 'exampleToken':
        raise '[AUTH ERROR]: This demo uses a dummy auth token. Make sure it is set to "exampleToken" in Mailer.tsx useCoAgent call in the configurable'

    sender = state.get("sender", None)
    if sender is None:
        sender = interrupt('Please provide a sender name which will appear in the email')

    sender_company = state.get("sender_company", None)
    if sender_company is None:
        sender_company, new_messages = copilotkit_interrupt(message='Ah, forgot to ask, which company are you working for?')
        state["messages"] = state["messages"] + new_messages

    config = copilotkit_customize_config(
        config,
        emit_tool_calls=True,
    )

    instructions = f"You write emails. The email is by the following sender: {sender}, working for: {sender_company}"

    cpk_actions = state.get("copilotkit", {}).get("actions", [])
    email_model = get_model(state).bind_tools(
        cpk_actions,
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
        "messages": response,
        "email": email,
        "sender": sender,
        "sender_company": sender_company
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
        text_message = "❌ Cancelled sending email."
    else:
        text_message = "✅ Sent email."
    
    await copilotkit_emit_message(config, text_message)


    return {
        "messages": AIMessage(content=text_message),
    }


workflow = StateGraph(EmailAgentState)
workflow.add_node("email_node", email_node)
workflow.add_node("send_email_node", send_email_node)
workflow.set_entry_point("email_node")
workflow.add_edge("email_node", "send_email_node")
workflow.add_edge("send_email_node", END)
graph = workflow.compile(interrupt_after=["email_node"])
