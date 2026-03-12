#!/usr/bin/env python
"""
An example demonstrating agentic generative UI.
"""

from dotenv import load_dotenv
load_dotenv(override=True)
import logging
from typing import Optional
from crewai import LLM
from crewai.flow import start, persist
import sys
from pydantic import BaseModel, Field
from typing import List, Dict, Any

from copilotkit.crewai import (
    CopilotKitFlow,
    FlowInputState,
)

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

llm = LLM(model="gpt-4o", stream=False)

GENERATE_TASK_STEPS_TOOL = {
    "type": "function",
    "function": {
        "name": "generate_task_steps",
        "description": "Generate a list of steps required to complete a task",
        "parameters": {
            "type": "object",
            "properties": {
                "task": {
                    "type": "string",
                    "description": "The task to generate steps for"
                },
                "steps": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {
                            "step_number": {"type": "integer"},
                            "description": {"type": "string"},
                            "enabled": {"type": "boolean", "default": True}
                        },
                        "required": ["step_number", "description"]
                    },
                    "description": "Array of steps needed to complete the task"
                }
            },
            "required": ["task", "steps"]
        }
    }
}

class TaskSteps(BaseModel):
    """
    Task steps with user-controllable enable/disable functionality.
    """
    task: str = Field(..., description="The task description")
    steps: List[Dict[str, Any]] = Field(..., description="List of task steps")

class AgentState(FlowInputState):
    """
    The state of the task execution.
    """
    task_steps: Optional[dict] = None

@persist()
class HumanInTheLoopFlow(CopilotKitFlow[AgentState]):

    @start()
    def chat(self):
        """
        Standard chat node that processes messages and handles tool calls.
        """

        system_prompt = """
        You are a helpful assistant that can perform any task.

        • If the **latest user message** is a fresh task request, CALL `generate_task_steps` to break it down, then stop.
        • If the message shows the user already enabled/disabled steps, DO NOT call anything—reply in ≤3 funny sentences about how you're doing the task (invent clever work-arounds for any disabled bits).
        • Otherwise, ask a clarifying question.

        You only see the most recent user message—derive everything from that.
        """
        # Get message history using the base class method
        messages = self.get_message_history(system_prompt=system_prompt)

        print(f"Messages: {messages}")

        return llm.call(
            messages=messages,
            tools=[GENERATE_TASK_STEPS_TOOL],
            available_functions={"generate_task_steps": self.generate_task_steps_handler}
        )

    def generate_task_steps_handler(self, task, steps):
        """Handler for the generate_task_steps tool"""
        # Ensure all steps have the 'enabled' field set to True by default
        for step in steps:
            if 'enabled' not in step:
                step['enabled'] = True
                logger.info(f"Added enabled=True to step {step.get('step_number', '?')}: {step.get('description', 'Unknown')[:50]}...")

        task_steps_obj = TaskSteps(
            task=task,
            steps=steps
        )

        return task_steps_obj.model_dump_json(indent=2)


def kickoff():
    """
    Start the flow with comprehensive logging and event bus diagnostics
    """
    result = HumanInTheLoopFlow().kickoff({
        "messages": [
            {
                "role": "user",
                "content": "go to mars!"
            }
        ]
    })
    print(f"result: {result}")

if __name__ == "__main__":
    sys.exit(kickoff())
