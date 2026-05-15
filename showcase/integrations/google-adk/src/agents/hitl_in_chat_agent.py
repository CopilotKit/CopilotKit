"""ADK agent backing the In-Chat Human in the Loop demo (hitl-steps).

The ``generate_task_steps`` tool is defined on the FRONTEND via
``useHumanInTheLoop`` — the user picks/approves steps in the chat
and the selection flows back as the tool result.  This matches the
canonical HITL pattern used by every other showcase integration
(langgraph-python, pydantic-ai, ms-agent-python, etc.).

The backend agent has NO tools of its own — CopilotKit's middleware
injects the frontend-registered tool definition into the LLM call so
the model can invoke it.
"""

from __future__ import annotations

from google.adk.agents import LlmAgent
from ag_ui_adk import AGUIToolset

from agents.shared_chat import get_model, stop_on_terminal_text


_INSTRUCTION = (
    "You are a planning assistant. When the user asks you to plan something, "
    "always call generate_task_steps with the proposed list of steps (each "
    "with description + status='enabled'). The frontend will render the "
    "steps inline and the user will confirm or reject — your job is to plan "
    "and call the tool, then summarise the user's decision once they "
    "respond."
)

hitl_in_chat_agent = LlmAgent(
    name="HitlInChatAgent",
    model=get_model(),
    instruction=_INSTRUCTION,
    tools=[AGUIToolset()],
    after_model_callback=stop_on_terminal_text,
)
