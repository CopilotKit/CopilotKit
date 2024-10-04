"""
This is the main entry point for the AI.
It defines the workflow graph and the entry point for the agent.
"""
# pylint: disable=line-too-long, unused-import

import os
from typing import cast, TypedDict
from langchain_openai import ChatOpenAI
from langchain_anthropic import ChatAnthropic
from langchain_core.messages import ToolMessage, AIMessage, HumanMessage, SystemMessage
from langchain_core.runnables import RunnableConfig
from langgraph.graph import StateGraph, END
from langgraph.checkpoint.memory import MemorySaver
from langgraph.graph import MessagesState
from copilotkit.langchain import copilotkit_customize_config

def get_model():
    """
    Get a model based on the environment variable.
    """
    model = os.getenv("MODEL", "openai")

    if model == "openai":
        return ChatOpenAI(temperature=0, model="gpt-4o")
    if model == "anthropic":
        return ChatAnthropic(
            temperature=0,
            model_name="claude-3-5-sonnet-20240620",
            timeout=None,
            stop=None
        )

    raise ValueError("Invalid model specified")

class Translations(TypedDict):
    """Contains the translations in four different languages."""
    translation_es: str
    translation_fr: str
    translation_de: str

class AgentState(MessagesState):
    """Contains the state of the agent."""
    translations: Translations
    input: str

async def translate_node(state: AgentState, config: RunnableConfig):
    """Chatbot that translates text"""

    config = copilotkit_customize_config(
        config,
        emit_messages=True,
        emit_intermediate_state=[
            {
                "state_key": "translations",
                "tool": "Translations"
            }
        ]
    )

    model = get_model().bind_tools(
        [Translations],
        tool_choice=(
            None if state["messages"] and
            isinstance(state["messages"][-1], HumanMessage)
            else "Translations"
        )
    )

    new_message = HumanMessage(
        content=f"""
        You are a helpful assistant that translates text to different languages 
        (Spanish, French and German).
        Don't ask for confirmation before translating.
        {
            'The user is currently working on translating this text: "' + 
            state["input"] + '"' if state.get("input") else ""
        }
        """
    )

    # remove system message and empty AI messages
    messages = [
        message for message in state["messages"]
        if not isinstance(message, SystemMessage) and 
        not (isinstance(message, AIMessage) and message.content == "")
    ]
    messages += [new_message]

    for message in messages:
        print(message)
        print(type(message))
        print("---")

    response = await model.ainvoke(messages, config)

    if hasattr(response, "tool_calls") and len(getattr(response, "tool_calls")) > 0:
        ai_message = cast(AIMessage, response)
        return {
            "messages": [
                new_message,
                response,
                ToolMessage(
                    content="Translated!",
                    tool_call_id=ai_message.tool_calls[0]["id"]
                )
            ],
            "translations": cast(AIMessage, response).tool_calls[0]["args"],
        }

    return {
        "messages": [
            new_message,
            response,
        ],
    }

workflow = StateGraph(AgentState)
workflow.add_node("translate_node", translate_node)
workflow.set_entry_point("translate_node")
workflow.add_edge("translate_node", END)
memory = MemorySaver()
graph = workflow.compile(checkpointer=memory)
