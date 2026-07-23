"""CrewAI Flow backing the Shared State (Read + Write) demo.

Mirrors `langgraph-python/src/agents/shared_state_read_write.py` but
implemented as a `crewai.flow.Flow` so we own the LLM call, the tool
schema, and state mutations directly. The shared `LatestAiDevelopment`
crew on "/" cannot host this demo: `ChatWithCrewFlow` does not surface
per-tool state mutations to the AG-UI bridge — its only state mutation
is appending `result.raw` to `state["outputs"]` when the model invokes
the special `<crew_name>` tool.

This module bypasses the crew flow entirely and uses
`add_crewai_flow_fastapi_endpoint` to mount a dedicated agent at
`/shared-state-read-write`.

Bidirectional shared state:

- **UI -> agent (write)**: The UI owns a `preferences` object and writes
  it via `agent.setState({preferences})`. The flow reads the latest
  `preferences` out of `self.state` every turn and injects them into
  the system prompt so the LLM adapts.
- **agent -> UI (read)**: The agent calls `set_notes(notes)` to update
  the `notes` slot in shared state. After the tool call we emit a
  STATE_SNAPSHOT via `copilotkit_emit_state` so the UI re-renders.
"""

from __future__ import annotations

import json
import uuid
from typing import List, Optional

from crewai.flow.flow import Flow, start
from litellm import acompletion
from pydantic import BaseModel, Field

from ag_ui_crewai import CopilotKitState, copilotkit_emit_state, copilotkit_stream


# ---------------------------------------------------------------------------
# Shared state
# ---------------------------------------------------------------------------


class Preferences(BaseModel):
    """Shape of the user-owned preferences the UI writes via setState."""

    name: str = ""
    tone: str = "casual"  # "formal" | "casual" | "playful"
    language: str = "English"
    interests: List[str] = Field(default_factory=list)


class AgentState(CopilotKitState):
    """Bidirectional shared state.

    - `preferences` is written by the UI via `agent.setState`.
    - `notes` is written by the agent via the `set_notes` tool and read
      by the UI through `useAgent`.
    """

    preferences: Optional[Preferences] = None
    notes: List[str] = Field(default_factory=list)


# ---------------------------------------------------------------------------
# Tool schema (LiteLLM/OpenAI tool format)
# ---------------------------------------------------------------------------

# Plain OpenAI-compatible tool schema rather than a CrewAI `BaseTool`.
# The supervising LLM call goes through `litellm.acompletion` directly,
# so a JSON-schema tool definition is the right primitive.
SET_NOTES_TOOL = {
    "type": "function",
    "function": {
        "name": "set_notes",
        "description": (
            "Replace the notes array in shared state with the FULL "
            "updated list of short note strings. Use whenever the user "
            "asks you to remember something, or when you observe "
            "something worth surfacing in the UI's notes panel. Always "
            "pass the FULL list (existing notes + any new ones), not a "
            "diff. Keep each note short (< 120 chars)."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "notes": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": (
                        "Full list of short notes that should be visible "
                        "in the UI's notes panel."
                    ),
                }
            },
            "required": ["notes"],
        },
    },
}


# ---------------------------------------------------------------------------
# Flow
# ---------------------------------------------------------------------------


def _build_prefs_block(prefs: Optional[Preferences]) -> Optional[str]:
    """Compose a system block describing the user's current preferences."""
    if prefs is None:
        return None
    has_any = bool(prefs.name or prefs.tone or prefs.language or prefs.interests)
    if not has_any:
        return None
    lines = ["The user has shared these preferences with you:"]
    if prefs.name:
        lines.append(f"- Name: {prefs.name}")
    if prefs.tone:
        lines.append(f"- Preferred tone: {prefs.tone}")
    if prefs.language:
        lines.append(f"- Preferred language: {prefs.language}")
    if prefs.interests:
        lines.append(f"- Interests: {', '.join(prefs.interests)}")
    lines.append(
        "Tailor every response to these preferences. Address the user "
        "by name when appropriate."
    )
    return "\n".join(lines)


_BASE_SYSTEM_PROMPT = (
    "You are a helpful, concise assistant. The user's preferences are "
    "supplied via shared state and added as a system message at the "
    "start of every turn — always respect them. When the user asks you "
    "to remember something, or when you observe something worth "
    "surfacing in the UI's notes panel, call `set_notes` with the FULL "
    "updated list of short notes (existing + new)."
)


class SharedStateReadWriteFlow(Flow[AgentState]):
    """Chat flow with tool-execution loop that reads `preferences` and writes `notes`.

    Mirrors the LangGraph reference implementation's automatic tool loop:
    after the LLM returns a tool call, this flow executes the tool,
    appends the tool result to the message history, and calls the LLM
    again so it can produce the follow-up text response.  Without the
    loop the frontend never sees the assistant's confirmation text
    ("Got it — I noted …") after a `set_notes` call.
    """

    # Maximum number of LLM round-trips per user turn.  Prevents
    # infinite loops if the model keeps calling tools.
    _MAX_ITERATIONS = 5

    @start()
    async def chat(self) -> None:
        prefs = self.state.preferences
        # Pydantic deserialisation: `preferences` may arrive as a dict
        # rather than a Preferences instance when the UI sends a fresh
        # `agent.setState(...)` payload — the request JSON crosses the
        # ag-ui boundary as plain dicts.
        if isinstance(prefs, dict):
            prefs = Preferences(**prefs)
            self.state.preferences = prefs

        prefs_block = _build_prefs_block(prefs)

        system_content = _BASE_SYSTEM_PROMPT
        if prefs_block:
            system_content = prefs_block + "\n\n" + system_content

        system_message = {
            "role": "system",
            "content": system_content,
            "id": str(uuid.uuid4()) + "-system",
        }

        # Frontend-registered actions + our backend `set_notes` tool.
        tools = [
            *self.state.copilotkit.actions,
            SET_NOTES_TOOL,
        ]

        for _iteration in range(self._MAX_ITERATIONS):
            messages = [system_message, *self.state.messages]

            response = await copilotkit_stream(
                await acompletion(
                    model="openai/gpt-4o-mini",
                    messages=messages,
                    tools=tools,
                    parallel_tool_calls=False,
                    stream=True,
                )
            )

            message = response.choices[0].message
            self.state.messages.append(message)

            tool_calls = message.get("tool_calls") or []
            if not tool_calls:
                # No tool calls — the LLM produced a text response.
                # We're done.
                return

            # Iterate ALL tool calls — `parallel_tool_calls=False` is
            # set on the LLM call but providers can still emit multiple
            # under certain conditions.  Indexing `[0]` would silently
            # drop the rest, leaving an assistant `tool_calls` message
            # with no matching `role: "tool"` reply, which most chat
            # APIs reject on the next turn.
            notes_changed = False
            for tool_call in tool_calls:
                tool_call_id = tool_call["id"]
                tool_name = tool_call["function"]["name"]

                if tool_name != "set_notes":
                    # Frontend-registered action: the AG-UI client owns
                    # the round-trip.  We still need a placeholder tool
                    # result so the message thread stays valid.
                    self.state.messages.append(
                        {
                            "role": "tool",
                            "content": "frontend tool — handled client-side",
                            "tool_call_id": tool_call_id,
                        }
                    )
                    continue

                try:
                    args = json.loads(tool_call["function"]["arguments"] or "{}")
                except json.JSONDecodeError:
                    args = {}
                notes = args.get("notes")
                if not isinstance(notes, list):
                    notes = []
                # Coerce every entry to a non-empty string — defensive
                # against the model occasionally yielding non-string
                # list entries.
                cleaned = [str(n) for n in notes if n is not None and str(n)]
                self.state.notes = cleaned
                notes_changed = True

                self.state.messages.append(
                    {
                        "role": "tool",
                        "content": "Notes updated.",
                        "tool_call_id": tool_call_id,
                    }
                )

            # Emit a state snapshot so the UI's
            # `useAgent({updates: [OnStateChanged]})` subscription fires
            # and the notes-card re-renders immediately without waiting
            # for the next turn.  Only emit if notes actually changed;
            # pure frontend-tool turns don't mutate shared state.
            if notes_changed:
                await copilotkit_emit_state(self.state)

            # Loop back to call the LLM again with the tool results
            # appended — the LLM will now produce the follow-up text
            # response confirming the tool action.


# Module-level singleton — `add_crewai_flow_fastapi_endpoint` deepcopies
# this per request, so initialisation cost is paid once at import time.
shared_state_read_write_flow = SharedStateReadWriteFlow()
