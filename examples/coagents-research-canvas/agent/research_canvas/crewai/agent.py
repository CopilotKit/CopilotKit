"""
This is the main entry point for the CrewAI agent.
"""
from typing_extensions import Dict, Any, cast
from crewai.flow.flow import Flow, start, router, listen
from litellm import completion
from research_canvas.crewai.download import download_resources, get_resources
from research_canvas.crewai.delete import maybe_perform_delete
from research_canvas.crewai.prompt import format_prompt
from research_canvas.crewai.tools import (
    SEARCH_TOOL,
    EXTRACT_RESOURCES_TOOL,
    WRITE_REPORT_TOOL,
    WRITE_RESEARCH_QUESTION_TOOL,
    DELETE_RESOURCES_TOOL,
    perform_tool_calls
)
class ResearchCanvasFlow(Flow[Dict[str, Any]]):
    """
    Research Canvas CrewAI Flow
    """

    @start()
    @listen("follow_up")
    async def start(self):
        """
        Download any pending assets that are needed for the research.
        """
        self.state["resources"] = self.state.get("resources", [])
        self.state["research_question"] = self.state.get("research_question", "")
        self.state["report"] = self.state.get("report", "")

        await download_resources(self.state)

        # If the user requested deletion, perform it
        maybe_perform_delete(self.state)


    @router(start)
    async def chat(self):
        """
        Listen for the download event.
        """
        resources = get_resources(self.state)
        prompt = format_prompt(
            self.state["research_question"],
            self.state["report"],
            resources
        )

        response = completion(
            model="openai/gpt-4o",
            messages=[
                {"role": "system", "content": prompt},
                *self.state["messages"]
            ],
            tools=[
                SEARCH_TOOL,
                EXTRACT_RESOURCES_TOOL,
                WRITE_REPORT_TOOL,
                WRITE_RESEARCH_QUESTION_TOOL,
                DELETE_RESOURCES_TOOL
            ],
            parallel_tool_calls=False
        )
        message = cast(Any, response).choices[0]["message"]

        self.state["messages"].append(message)

        follow_up = await perform_tool_calls(self.state)

        if follow_up:
            return "follow_up"

        return "end"

    @listen("end")
    async def end(self):
        """
        End the flow.
        """
