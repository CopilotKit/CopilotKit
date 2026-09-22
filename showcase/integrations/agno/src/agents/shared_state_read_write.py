"""Agno agent backing the Shared State (Read + Write) demo.

Mirrors `langgraph-python/src/agents/shared_state_read_write.py` and
`google-adk/src/agents/shared_state_read_write_agent.py`.

Demonstrates the canonical bidirectional shared-state pattern between UI
and agent:

- **UI -> agent (write)**: The UI owns a `preferences` object that it
  writes into agent state via `agent.setState(...)`. The Agno agent's
  dynamic instructions function reads `session_state["preferences"]`
  every turn and prepends a preferences block so the LLM adapts.

- **agent -> UI (read)**: The agent calls the `set_notes` tool to
  replace `session_state["notes"]`. Our custom AGUI router (see
  `agent_server.py`) emits a `StateSnapshotEvent` after every run so the
  UI's `useAgent({ updates: [OnStateChanged] })` reflects the change.

Together this matches the canonical bidirectional shared-state contract
the langgraph-python and google-adk references implement.
"""

from __future__ import annotations

from textwrap import dedent
from typing import Any

import dotenv
from agno.agent.agent import Agent
from agno.models.openai import OpenAIChat
from agno.run import RunContext

dotenv.load_dotenv()


PREFS_BLOCK_HEADER = "[shared-state-read-write] preferences:"


def _format_preferences(prefs: Any) -> str:
    """Build the preferences block injected into the system prompt."""
    if not isinstance(prefs, dict) or not prefs:
        return ""
    lines = [PREFS_BLOCK_HEADER]
    if prefs.get("name"):
        lines.append(f"- Name: {prefs['name']}")
    if prefs.get("tone"):
        lines.append(f"- Preferred tone: {prefs['tone']}")
    if prefs.get("language"):
        lines.append(f"- Preferred language: {prefs['language']}")
    interests = prefs.get("interests") or []
    if interests:
        lines.append(f"- Interests: {', '.join(interests)}")
    if len(lines) == 1:
        # Truthy dict but no recognized keys — emit nothing rather than a
        # bare header. Mirrors the same guard used in google-adk's
        # shared_state_read_write_agent._build_prefs_block.
        return ""
    lines.append(
        "Tailor every response to these preferences. "
        "Address the user by name when appropriate."
    )
    return "\n".join(lines)


def build_instructions(run_context: RunContext) -> str:
    """Dynamic instructions: read latest preferences from session_state.

    Agno re-evaluates this function on every run when `cache_callables`
    is False, so writes the UI makes via `agent.setState({preferences})`
    take effect on the very next turn.
    """
    base = dedent(
        """
        You are a helpful, concise assistant. The user's preferences are
        supplied via shared state and added as a system message at the start
        of every turn — always respect them.

        When the user asks you to remember something, or you observe
        something worth surfacing in the UI's notes panel, call `set_notes`
        with the FULL updated list of short note strings (existing notes +
        any new ones). Keep each note under 120 characters. Always pass the
        complete list — `set_notes` REPLACES the notes array, it does not
        append.
        """
    ).strip()

    prefs_block = _format_preferences(getattr(run_context, "session_state", None) or {})
    if prefs_block:
        return f"{prefs_block}\n\n{base}"
    return base


def set_notes(run_context: RunContext, notes: list[str]) -> str:
    """Replace the notes array in shared state with the full updated list.

    Always pass the FULL list of short note strings (existing notes + new),
    not a diff. Keep each note short (< 120 chars).
    """
    if run_context.session_state is None:
        run_context.session_state = {}
    # Coerce all entries to plain strings — tolerate models that pass
    # through stray dict/None entries from earlier turns rather than
    # crash the AGUI router with a serialization failure mid-stream.
    cleaned = [str(n) for n in (notes or []) if n is not None]
    run_context.session_state["notes"] = cleaned
    return f"Notes updated. ({len(cleaned)} total)"


agent = Agent(
    model=OpenAIChat(id="gpt-4o-mini", timeout=120),
    tools=[set_notes],
    # Re-evaluate instructions on every run so UI writes to
    # session_state["preferences"] are visible to the LLM on the very
    # next turn (rather than being cached at agent construction time).
    cache_callables=False,
    instructions=build_instructions,
    description=(
        "You adapt your responses to the user's stored preferences and use "
        "the set_notes tool to surface things worth remembering."
    ),
    tool_call_limit=5,
)
