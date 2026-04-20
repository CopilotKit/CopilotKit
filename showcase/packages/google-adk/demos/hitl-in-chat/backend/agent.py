"""Google ADK agent backing the In-Chat Human in the Loop demo.

The demo asks the agent to plan something step-by-step. The frontend renders a
checklist via `useHumanInTheLoop` on the `generate_task_steps` tool and the
user approves/rejects before the agent continues. The `generate_task_steps`
tool lives entirely on the frontend — the backend only needs to know about it
so it can emit the call.
"""

from __future__ import annotations

from dotenv import load_dotenv
from google.adk.agents import LlmAgent

load_dotenv()


# NOTE: `generate_task_steps` is a frontend tool registered via
# useHumanInTheLoop. The ADK agent learns about it from the tool definitions
# forwarded through the CopilotKit runtime at request time.
hitl_agent = LlmAgent(
    name="HumanInTheLoopAgent",
    model="gemini-2.5-flash",
    instruction=(
        "You are a helpful planning assistant. When the user asks you to plan "
        "or break down a task, call the generate_task_steps frontend tool with "
        "a list of concrete, ordered steps. After the user approves or rejects "
        "steps, summarize what will happen next."
    ),
    tools=[],
)
