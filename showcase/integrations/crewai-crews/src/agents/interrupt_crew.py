"""CrewAI scheduling crew for the interrupt-adapted demos.

Powers both gen-ui-interrupt and interrupt-headless. The LangGraph reference
uses `interrupt()` with checkpoint/resume; CrewAI has no equivalent primitive,
so we adapt via Strategy B: the backend crew defines a system prompt that
instructs the chat LLM to call `schedule_meeting`, and the frontend registers
that tool via `useFrontendTool` with an async handler that renders a
time-picker and returns a Promise that only resolves when the user picks a
slot (or cancels).

No backend tools — `schedule_meeting` is satisfied entirely by the frontend.
"""

from __future__ import annotations

from crewai import Agent, Crew, Process, Task

from agents._chat_flow_helpers import preseed_system_prompt

CREW_NAME = "InterruptSchedulingCrew"

_SYSTEM_PROMPT = (
    "You are a scheduling assistant. Whenever the user asks you to book a call "
    "or schedule a meeting, you MUST call the `schedule_meeting` tool. Pass a "
    "short `topic` describing the purpose of the meeting and, if known, an "
    "`attendee` describing who the meeting is with.\n\n"
    "The `schedule_meeting` tool is implemented on the client: it surfaces a "
    "time-picker UI to the user and returns the user's selection. After the "
    "tool returns, briefly confirm whether the meeting was scheduled and at "
    "what time, or note that the user cancelled. Do NOT ask for approval "
    "yourself — always call the tool and let the picker handle the decision.\n\n"
    "Keep responses short and friendly. After you finish executing tools, "
    "always send a brief final assistant message summarizing what happened so "
    "the message persists."
)

preseed_system_prompt(CREW_NAME, _SYSTEM_PROMPT)


def _build_crew() -> Crew:
    agent = Agent(
        role="Scheduling Assistant",
        goal="Help users schedule meetings by calling the schedule_meeting tool",
        backstory=(
            "You are a concise scheduling assistant. You always call "
            "schedule_meeting when asked to book or schedule anything."
        ),
        verbose=False,
        tools=[],
    )

    task = Task(
        description=(
            "Help the user schedule a meeting by calling the schedule_meeting "
            "frontend tool."
        ),
        expected_output="A confirmation of the scheduled meeting or cancellation.",
        agent=agent,
    )

    return Crew(
        name=CREW_NAME,
        agents=[agent],
        tasks=[task],
        process=Process.sequential,
        verbose=False,
        chat_llm="gpt-4o",
    )


_cached_crew: Crew | None = None


class InterruptScheduling:
    """Adapter matching the shape `add_crewai_crew_fastapi_endpoint` expects."""

    name: str = CREW_NAME

    def crew(self) -> Crew:
        global _cached_crew
        if _cached_crew is None:
            _cached_crew = _build_crew()
        return _cached_crew
