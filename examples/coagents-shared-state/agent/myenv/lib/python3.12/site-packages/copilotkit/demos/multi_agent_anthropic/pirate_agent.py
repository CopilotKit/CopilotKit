"""Test Pirate Agent"""

from typing import Any, cast
from langgraph.graph import StateGraph, END
from langgraph.graph import MessagesState
from langgraph.checkpoint.memory import MemorySaver
from langchain_core.runnables import RunnableConfig
from copilotkit.langchain import copilotkit_emit_message

class PirateAgentState(MessagesState):
    """Pirate Agent State"""

async def pirate_node(state: PirateAgentState, config: RunnableConfig): # pylint: disable=unused-argument
    """
    Speaks like a pirate
    """

    await copilotkit_emit_message(config, "Arr!!!")

    # system_message = "You speak like a pirate. Your name is Captain Copilot"

    # pirate_model = ChatOpenAI(model="gpt-4o")

    # response = await pirate_model.ainvoke([
    #     *state["messages"],
    #     SystemMessage(
    #         content=system_message
    #     )
    # ], config)


    return {
        "messages": state["messages"],
    }

workflow = StateGraph(PirateAgentState)
workflow.add_node("pirate_node", cast(Any, pirate_node))
workflow.set_entry_point("pirate_node")

workflow.add_edge("pirate_node", END)
memory = MemorySaver()
pirate_graph = workflow.compile(checkpointer=memory)
