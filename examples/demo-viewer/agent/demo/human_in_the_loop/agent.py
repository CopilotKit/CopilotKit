"""
An example demonstrating agentic generative UI.
"""

from crewai.flow.flow import Flow, start, router, listen
from copilotkit.crewai import (
  copilotkit_stream, 
  CopilotKitState, 
)
from litellm import completion
from pydantic import BaseModel
from typing import Literal, List

# This tool simulates performing a task on the server.
# The tool call will be streamed to the frontend as it is being generated.
DEFINE_TASK_TOOL = {
    "type": "function",
    "function": {
        "name": "generate_task_steps",
        "description": "Make up 10 steps (only a couple of words per step) that are required for a task. The step should be in imperative form (i.e. Dig hole, Open door, ...)",
        "parameters": {
            "type": "object",
            "properties": {
                "steps": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {
                            "description": {
                                "type": "string",
                                "description": "The text of the step in imperative form"
                            },
                            "status": {
                                "type": "string",
                                "enum": ["enabled"],
                                "description": "The status of the step, always 'enabled'"
                            }
                        },
                        "required": ["description", "status"]
                    },
                    "description": "An array of 10 step objects, each containing text and status"
                }
            },
            "required": ["steps"]
        }
    }
}

class TaskStep(BaseModel):
    description: str
    status: Literal["enabled", "disabled"]

class AgentState(CopilotKitState):
    """
    Here we define the state of the agent

    In this instance, we're inheriting from CopilotKitState, which will bring in
    the CopilotKitState fields. We're also adding a custom field, `steps`,
    which will be used to store the steps of the task.
    """
    steps: List[TaskStep] = []


class HumanInTheLoopFlow(Flow[AgentState]):
    """
    This is a sample flow that uses the CopilotKit framework to create a chat agent.
    """

    @start()
    @listen("route_follow_up")
    async def start_flow(self):
        """
        This is the entry point for the flow.
        """

    @router(start_flow)
    async def chat(self):
        """
        Standard chat node.
        """
        system_prompt = """
        You are a helpful assistant that can perform any task.
        You MUST call the `generate_task_steps` function when the user asks you to perform a task.
        When the function `generate_task_steps` is called, the user will decide to enable or disable a step.
        After the user has decided which steps to perform, provide a textual description of how you are performing the task.
        If the user has disabled a step, you are not allowed to perform that step.
        However, you should find a creative workaround to perform the task, and if an essential step is disabled, you can even use
        some humor in the description of how you are performing the task.
        Don't just repeat a list of steps, come up with a creative but short description (3 sentences max) of how you are performing the task.
        """

        # 1. Run the model and stream the response
        #    Note: In order to stream the response, wrap the completion call in
        #    copilotkit_stream and set stream=True.
        response = await copilotkit_stream(
            completion(

                # 1.1 Specify the model to use
                model="openai/gpt-4o",
                messages=[
                    {
                        "role": "system", 
                        "content": system_prompt
                    },
                    *self.state.messages
                ],

                # 1.2 Bind the tools to the model
                tools=[
                    *self.state.copilotkit.actions,
                    DEFINE_TASK_TOOL
                ],

                # 1.3 Disable parallel tool calls to avoid race conditions,
                #     enable this for faster performance if you want to manage
                #     the complexity of running tool calls in parallel.
                parallel_tool_calls=False,
                stream=True
            )
        )

        message = response.choices[0].message

        # 2. Append the message to the messages in state
        self.state.messages.append(message)

        return "route_end"

    @listen("route_end")
    async def end(self):
        """
        End the flow.
        """
