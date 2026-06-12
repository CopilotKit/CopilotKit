"""LlamaIndex agent backing the Shared State (Read + Write) demo.

Mirrors `langgraph-python/src/agents/shared_state_read_write.py` but uses
LlamaIndex's `AGUIChatWorkflow` / `get_ag_ui_workflow_router` primitives.

Demonstrates the full bidirectional shared-state pattern between UI and
agent:

- **UI -> agent (write)**: The UI owns a `preferences` object (the user's
  profile) that it writes into agent state via `agent.setState({preferences})`.
  `AGUIChatWorkflow` already injects the entire state blob into the latest
  user message via its `<state>...</state>` prelude, but for parity with
  the LangGraph-Python "PreferencesInjectorMiddleware" pattern, we also
  expose a backend tool that lets the LLM read preferences directly when
  it wants more structure than the prelude.
- **agent -> UI (read)**: The agent calls `set_notes` to update a `notes`
  slot in shared state. The router emits a `StateSnapshotWorkflowEvent`
  after every tool call, so the UI sees notes appear live via
  `useAgent({ updates: [OnStateChanged] })`.

State write strategy:
The router stores the run's full state at `ctx.store["state"]` and snapshots
it after every tool call. So mutating that dict in-place from a tool is
sufficient — no custom event emission needed.
"""

import os
from typing import Annotated, Any

from llama_index.core.workflow import Context
from llama_index.llms.openai import OpenAI
from llama_index.protocols.ag_ui.router import get_ag_ui_workflow_router


SYSTEM_PROMPT = (
    "You are a helpful, concise assistant.\n\n"
    "The user's preferences are supplied via shared state and exposed to "
    "you in the `<state>...</state>` block of the most recent user "
    "message. The state has shape:\n"
    "  preferences: { name, tone, language, interests }\n"
    "  notes: list[str]\n\n"
    "Always respect the preferences:\n"
    "  - Address the user by name when set.\n"
    "  - Match the requested tone (formal / casual / playful).\n"
    "  - Reply in the requested language.\n"
    "  - Tailor suggestions to listed interests.\n\n"
    "When the user asks you to remember something, or when you observe "
    "something worth surfacing in the UI, call `set_notes` with the FULL "
    "updated list of short note strings (existing notes + any new notes). "
    "Each note must be < 120 chars. Always pass the full list, never a "
    "diff."
)


# @region[set-notes-tool]
async def set_notes(
    ctx: Context,
    notes: Annotated[
        list[str],
        "The COMPLETE updated list of notes (existing notes + new notes). "
        "Always pass the full list, never a diff. Each note < 120 chars.",
    ],
) -> str:
    """Replace the agent-authored notes array in shared state.

    Use this whenever the user asks you to "remember" something, or when
    you have an observation worth surfacing in the UI's notes panel.
    """
    state: dict[str, Any] = await ctx.store.get("state", default={})
    # Mutate in place so the router's post-tool StateSnapshotWorkflowEvent
    # carries the new value to the UI.
    state["notes"] = list(notes)
    await ctx.store.set("state", state)
    return f"Notes updated. {len(notes)} note(s) saved."


# @endregion[set-notes-tool]


_openai_kwargs = {}
if os.environ.get("OPENAI_BASE_URL"):
    _openai_kwargs["api_base"] = os.environ["OPENAI_BASE_URL"]

shared_state_read_write_router = get_ag_ui_workflow_router(
    llm=OpenAI(model="gpt-4.1", **_openai_kwargs),
    frontend_tools=[],
    backend_tools=[set_notes],
    system_prompt=SYSTEM_PROMPT,
    initial_state={
        "preferences": {
            "name": "",
            "tone": "casual",
            "language": "English",
            "interests": [],
        },
        "notes": [],
    },
)
