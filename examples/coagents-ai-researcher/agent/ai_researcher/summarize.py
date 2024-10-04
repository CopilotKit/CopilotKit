"""
The summarize node is responsible for summarizing the information.
"""

import json
from langchain_core.messages import HumanMessage
from langchain_core.runnables import RunnableConfig
from copilotkit.langchain import copilotkit_customize_config
from pydantic import BaseModel, Field
from ai_researcher.state import AgentState
from ai_researcher.model import get_model

class Reference(BaseModel):
    """Model for a reference"""

    title: str = Field(description="The title of the reference.")
    url: str = Field(description="The url of the reference.")

class SummarizeTool(BaseModel):
    """
    Summarize the final result. Make sure that the summary is complete and 
    includes all relevant information and reference links.
    """

    markdown: str = Field(
        description="""
        The markdown formatted summary of the final result. 
        If you add any headings, make sure to start at the top level (#).
        """
    )
    references: list[Reference] = Field(description="A list of references.")

async def summarize_node(state: AgentState, config: RunnableConfig):
    """
    The summarize node is responsible for summarizing the information.
    """

    config = copilotkit_customize_config(
        config,
        emit_intermediate_state=[
            {
                "state_key": "answer",
                "tool": "SummarizeTool",
            }
        ]
    )

    system_message = f"""
The system has performed a series of steps to answer the user's query.
These are all of the steps: {json.dumps(state["steps"])}

Please summarize the final result and include all relevant information and reference links.
"""

    response = await get_model().bind_tools(
        [SummarizeTool],
        tool_choice="SummarizeTool"
    ).ainvoke([
        HumanMessage(
            content=system_message
        ),
    ], config)

    return {
        "answer": response.tool_calls[0]["args"],
    }
