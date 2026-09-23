"""Agent backing the Shared State (Read-only) recipe demo.

The recipe editor owns `recipe` and publishes every edit with
`agent.setState`. The ADK adapter copies that state into the session, but
session state never reaches the model on its own, so a before-model
callback adds the current recipe to the system instruction. The agent has
no tool that writes `recipe`, so the UI stays its only writer.
"""

from __future__ import annotations

import json
from typing import Optional

from ag_ui_adk import AGUIToolset
from google.adk.agents import LlmAgent
from google.adk.agents.callback_context import CallbackContext
from google.adk.models.llm_request import LlmRequest
from google.adk.models.llm_response import LlmResponse

from agents.shared_chat import get_model, stop_on_terminal_text


# @region[shared-state-read-agent]
def _inject_recipe(
    callback_context: CallbackContext, llm_request: LlmRequest
) -> Optional[LlmResponse]:
    """Add the UI-owned recipe to this model call's system instruction."""
    recipe = callback_context.state.get("recipe")
    if isinstance(recipe, dict) and recipe:
        llm_request.append_instructions(
            ["Current recipe from the editor:\n" + json.dumps(recipe, indent=2)]
        )
    return None


shared_state_read_agent = LlmAgent(
    name="SharedStateReadAgent",
    model=get_model(),
    instruction=(
        "You are a helpful, concise recipe assistant. The user edits the "
        "recipe in the app, and its current value is included below. Base "
        "every answer on that recipe. You cannot change it; suggest edits "
        "for the user to make instead."
    ),
    tools=[AGUIToolset()],
    before_model_callback=_inject_recipe,
    after_model_callback=stop_on_terminal_text,
)
# @endregion[shared-state-read-agent]
