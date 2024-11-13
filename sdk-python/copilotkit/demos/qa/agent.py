"""Test Human in the Loop Agent"""

from typing import Any, cast
from langgraph.graph import StateGraph, END
from langgraph.graph import MessagesState
from langgraph.checkpoint.memory import MemorySaver
from langchain_core.runnables import RunnableConfig
from langchain_core.messages import HumanMessage, ToolMessage, AIMessage
# from langchain_google_genai import ChatGoogleGenerativeAI
from langchain_openai import ChatOpenAI

from pydantic import BaseModel, Field

from copilotkit.langchain import (
  copilotkit_customize_config, copilotkit_exit, copilotkit_emit_message
)


def get_model():
    """
    Get a model based on the environment variable.
    """
    # model = os.getenv("MODEL", "openai")
    return ChatOpenAI(temperature=0, model="gpt-4o")
    # return ChatGoogleGenerativeAI(temperature=0, model="gemini-1.5-pro")


    # if model == "openai":
    #     return ChatOpenAI(temperature=0, model="gpt-4o")
    # if model == "anthropic":
    #     return ChatAnthropic(
    #         temperature=0,
    #         model_name="claude-3-5-sonnet-20240620",
    #         timeout=None,
    #         stop=None
    #     )

    # raise ValueError("Invalid model specified")


class EmailAgentState(MessagesState):
    """Email Agent State"""
    email: str

class EmailTool(BaseModel):
    """
    Write an email.
    """
    email_draft: str = Field(description="The draft of the email to be written.")


async def draft_email_node(state: EmailAgentState, config: RunnableConfig):
    """
    Write an email.
    """

    config = copilotkit_customize_config(
        config,
        emit_tool_calls=True,
    )

    instructions = "You write emails."

    email_model = get_model().bind_tools(
        [cast(Any, EmailTool)],
        tool_choice="EmailTool"
    )

    messages = state["messages"]
    # if len(messages) > 2:
    #     messages = messages[:-4]

    # print("MESSAGES:")
    # for message in messages:
    #     print(type(message))
    #     print(message)
    # print("----")


    response = await email_model.ainvoke([
        *messages,
        HumanMessage(
            content=instructions
        )
    ], config)

    # content='' additional_kwargs={'function_call': {'name': 'EmailTool', 'arguments': '{"email_draft": "Dear Sam Altman,\\\\n\\\\nI hope this email finds you well.\\\\n\\\\nI am writing to request a meeting with you to discuss [topic of discussion]. I am [your title/position] at [your company/organization] and I am particularly interested in [area of interest related to OpenAI].\\\\n\\\\nI am available on [list of dates/times]. Please let me know if any of these times work for you or suggest an alternative.\\\\n\\\\nThank you for your time and consideration.\\\\n\\\\nSincerely,\\\\n[Your Name]"}'}} response_metadata={'safety_ratings': [], 'finish_reason': 'STOP'} id='run-69254734-7c90-4743-adab-5e1d8cfe3099' tool_calls=[{'name': 'EmailTool', 'args': {'email_draft': 'Dear Sam Altman,\\n\\nI hope this email finds you well.\\n\\nI am writing to request a meeting with you to discuss [topic of discussion]. I am [your title/position] at [your company/organization] and I am particularly interested in [area of interest related to OpenAI].\\n\\nI am available on [list of dates/times]. Please let me know if any of these times work for you or suggest an alternative.\\n\\nThank you for your time and consideration.\\n\\nSincerely,\\n[Your Name]'}, 'id': '87607866-4201-4d52-bf8e-0cfd182e55bb', 'type': 'tool_call'}] usage_metadata={'input_tokens': 66, 'output_tokens': 122, 'total_tokens': 188, 'input_token_details': {'cache_read': 0}}
    # content='' additional_kwargs={} response_metadata={} id='run-1152f360-5a0b-4cb8-8065-0bb14c40f01f' tool_calls=[{'name': 'EmailTool', 'args': {'email_draft': 'Dear Sam Altman,\\n\\nI hope this email finds you well.\\n\\nI am writing to request a meeting with you to discuss [topic of discussion]. I am [your title/position] at [your company/organization] and I believe that a meeting between us would be mutually beneficial.\\n\\nI am available to meet at your earliest convenience. Please let me know what time works best for you.\\n\\nThank you for your time and consideration.\\n\\nSincerely,\\n[Your Name]'}, 'id': 'run-1152f360-5a0b-4cb8-8065-0bb14c40f01f', 'type': 'tool_call'}]

    print(response)

    tool_calls = cast(Any, response).tool_calls

    # the email content is the argument passed to the email tool
    email = tool_calls[0]["args"]["email_draft"]

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
    message_to_add = ""
    if last_message.content == "CANCEL":
        message_to_add = "❌ Cancelled sending email."
    else:
        message_to_add = "✅ Sent email."

    await copilotkit_emit_message(config, message_to_add)
    return {
        "messages": state["messages"] + [AIMessage(content=message_to_add)],
    }


workflow = StateGraph(EmailAgentState)
workflow.add_node("draft_email_node", draft_email_node)
workflow.add_node("send_email_node", send_email_node)
workflow.set_entry_point("draft_email_node")

workflow.add_edge("draft_email_node", "send_email_node")
workflow.add_edge("send_email_node", END)
memory = MemorySaver()
graph = workflow.compile(checkpointer=memory, interrupt_after=["draft_email_node"])
