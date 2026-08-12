"""ADK scheduling agent backing the gen-ui-interrupt demo (Strategy-B).

In langgraph-python the gen-ui-interrupt demo relies on the native
`interrupt()` primitive with checkpoint/resume. ADK has no such primitive,
so we adapt with the same "Strategy B" pattern used by the agno and
ms-agent-framework ports: the agent's instruction tells Gemini to call the
`schedule_meeting` tool, but NO backend tool is registered. CopilotKit's
`AGUIToolset()` injects the frontend-registered `schedule_meeting`
(`useHumanInTheLoop` in src/app/demos/gen-ui-interrupt/page.tsx) into the
model's tool list; the model's call is routed to the frontend, which renders
the time-picker inline and resolves the call once the user picks a slot —
equivalent to `interrupt()` in the LangGraph reference.

`after_model_callback=stop_on_terminal_text` is the canonical ADK terminal
guard (see shared_chat.py): without it the configured Gemini model
(from `get_model()`) re-issues the same tool call indefinitely after the
frontend tool resolves.
"""

from __future__ import annotations

# region: setup
from google.adk.agents import LlmAgent
from ag_ui_adk import AGUIToolset

from agents.shared_chat import get_model, stop_on_terminal_text

_INSTRUCTION = (
    "You are a scheduling assistant. Whenever the user asks you to book a "
    "call or schedule a meeting, you MUST call the `schedule_meeting` tool. "
    "Pass a short `topic` describing the purpose of the meeting and, if "
    "known, an `attendee` describing who the meeting is with.\n\n"
    "The `schedule_meeting` tool is implemented on the client: it surfaces a "
    "time-picker UI and returns the user's selection. After the tool "
    "returns, briefly confirm whether the meeting was scheduled and at what "
    "time, or note that the user cancelled. Do NOT ask for approval "
    "yourself — always call the tool and let the picker handle the decision. "
    "Keep responses short and friendly, and always send a brief final "
    "assistant message summarising what happened so it persists."
)

interrupt_agent = LlmAgent(
    name="InterruptAgent",
    model=get_model(),
    instruction=_INSTRUCTION,
    # No backend tools. `schedule_meeting` is registered on the frontend via
    # useHumanInTheLoop; AGUIToolset() exposes CopilotKit's frontend-tool
    # channel to the model.
    tools=[AGUIToolset()],
    after_model_callback=stop_on_terminal_text,
)
# endregion
