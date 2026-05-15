"""
AG2 scheduling agent -- interrupt-adapted.

This agent powers two demos (gen-ui-interrupt, interrupt-headless) that in the
LangGraph showcase rely on the native `interrupt()` primitive with
checkpoint/resume. AG2 does NOT have that primitive, so we adapt using the
same "Strategy B" pattern as the MS Agent Framework port: the backend agent's
system prompt tells the LLM to call `schedule_meeting`, but no local
implementation is registered -- the tool is provided entirely by the frontend
via `useFrontendTool` with an async handler that returns a Promise resolving
only once the user picks a time slot (or cancels).

See `src/agents/agent.py` for the shared ConversableAgent used by most other
AG2 demos.
"""

from __future__ import annotations

from autogen import ConversableAgent, LLMConfig
from autogen.ag_ui import AGUIStream
from fastapi import FastAPI


# @region[backend-tool-call]
SYSTEM_PROMPT = (
    "You are a scheduling assistant. Whenever the user asks you to book a call "
    "or schedule a meeting, you MUST call the `schedule_meeting` tool. Pass a "
    "short `topic` describing the purpose of the meeting and, if known, an "
    "`attendee` describing who the meeting is with.\n\n"
    "The `schedule_meeting` tool is implemented on the client: it surfaces a "
    "time-picker UI to the user and returns the user's selection. After the "
    "tool returns, briefly confirm whether the meeting was scheduled and at "
    "what time, or note that the user cancelled. Do NOT ask for approval "
    "yourself -- always call the tool and let the picker handle the decision.\n\n"
    "Keep responses short and friendly. After you finish executing tools, "
    "always send a brief final assistant message summarizing what happened so "
    "the message persists."
)

interrupt_agent = ConversableAgent(
    name="scheduling_agent",
    system_message=SYSTEM_PROMPT,
    llm_config=LLMConfig({"model": "gpt-4o-mini", "stream": True}),
    human_input_mode="NEVER",
    max_consecutive_auto_reply=5,
    # No backend tools. `schedule_meeting` is registered on the frontend
    # via `useFrontendTool` and dispatched through the CopilotKit runtime.
    # When the agent calls `schedule_meeting`, the request is routed to
    # the frontend handler, which returns a Promise that only resolves
    # once the user picks a slot -- equivalent to `interrupt()` in the
    # LangGraph reference.
    functions=[],
)
# @endregion[backend-tool-call]

# AG-UI stream wrapper
interrupt_stream = AGUIStream(interrupt_agent)

# FastAPI sub-app so agent_server.py can mount at /interrupt-adapted
interrupt_app = FastAPI(title="AG2 Interrupt Agent")
interrupt_app.mount("/", interrupt_stream.build_asgi())
