"""Chat Node"""

from typing import TypedDict, List, cast
from langchain_core.runnables import RunnableConfig
from langchain_core.messages import SystemMessage, AIMessage, ToolMessage
from copilotkit.langchain import copilotkit_customize_config
from research_canvas.state import AgentState
from research_canvas.model import get_model
from research_canvas.download import get_resource

class Search(TypedDict):
    """A list of one or more search queries to find good resources to support the research."""
    queries: List[str]

class WriteReport(TypedDict):
    """Write the research report."""
    report: str

class WriteResearchQuestion(TypedDict):
    """Write the research question."""
    research_question: str

async def chat_node(state: AgentState, config: RunnableConfig):
    """
    Chat Node
    """

    config = copilotkit_customize_config(
        config,
        emit_intermediate_state=[{
            "state_key": "report",
            "tool": "WriteReport",
            "tool_argument": "report",
        }, {
            "state_key": "research_question",
            "tool": "WriteResearchQuestion",
            "tool_argument": "research_question",
        }]
    )

    state["resources"] = state.get("resources", [])
    research_question = state.get("research_question", "")
    report = state.get("report", "")

    resources = []

    for resource in state["resources"]:
        content = get_resource(resource["url"])
        if content == "ERROR":
            continue
        resources.append({
            **resource,
            "content": content
        })

    response = await get_model().bind_tools(
        [
            Search,
            WriteReport,
            WriteResearchQuestion,
        ],
        parallel_tool_calls=False,
    ).ainvoke([
        SystemMessage(
            content=f"""
            You are a research assistant. You help the user with writing a research report.
            Do not recite the resources, instead use them to answer the user's question.
            You should use the search tool to get resources before answering the user's question.
            If you finished writing the report, ask the user proactively for next steps, changes etc, make it engaging.
            To write the report, you should use the WriteReport tool. Never EVER respond with the report, only use the tool.

            This is the research question:
            {research_question}

            This is the research report:
            {report}

            Here are the resources that you have available:
            {resources}
            """
        ),
        *state["messages"],
    ], config)

    ai_message = cast(AIMessage, response)

    if ai_message.tool_calls:
        if ai_message.tool_calls[0]["name"] == "WriteReport":
            return {
                "report": ai_message.tool_calls[0]["args"]["report"],
                "messages": [ai_message, ToolMessage(
                    tool_call_id=ai_message.tool_calls[0]["id"],
                    content="Report written."
                )]
            }
        if ai_message.tool_calls[0]["name"] == "WriteResearchQuestion":
            return {
                "research_question": ai_message.tool_calls[0]["args"]["research_question"],
                "messages": [ai_message, ToolMessage(
                    tool_call_id=ai_message.tool_calls[0]["id"],
                    content="Research question written."
                )]
            }

    return {
        "messages": response
    }
