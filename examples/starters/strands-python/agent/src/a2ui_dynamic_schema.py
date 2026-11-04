"""Dynamic A2UI tool: LLM-generated UI from conversation context.

A secondary LLM (LangChain, see src/model.py) generates v0.9 A2UI components via a
structured tool call. The generate_a2ui tool wraps the output as
a2ui_operations, which the middleware/runtime detects and renders
automatically. Identical surface to the canonical demo's tool —
implementation differs only by the secondary-LLM wiring.
"""

from __future__ import annotations

import json
from typing import Any, Dict, List

from copilotkit import a2ui
from langchain_core.messages import SystemMessage
from pydantic import BaseModel, Field
from strands import tool

from src.model import create_chat_model

CATALOG_ID = "copilotkit://app-dashboard-catalog"


class _A2UIRenderArgs(BaseModel):
    surfaceId: str = "dynamic-surface"
    catalogId: str = CATALOG_ID
    components: List[Dict[str, Any]] = Field(default_factory=list)
    data: Dict[str, Any] = Field(default_factory=dict)


@tool
def generate_a2ui(user_intent: str) -> str:
    """Generate dynamic A2UI components based on the conversation.

    A secondary LLM designs the UI schema and data. The result is returned
    as an a2ui_operations container for the runtime to detect and render.
    """
    # COPILOTKIT_AGENT_MODEL overrides this site too; unset, it uses gpt-5-mini.
    model = create_chat_model("openai:gpt-5-mini")
    # Name the forced tool as a string: LangChain translates it for every
    # provider, while the OpenAI-shaped dict only works for OpenAI.
    model_with_tool = model.bind_tools(
        [_A2UIRenderArgs.model_json_schema()],
        tool_choice="_A2UIRenderArgs",
    )
    try:
        response = model_with_tool.invoke([SystemMessage(content=user_intent)])
    except Exception as exc:  # surface LLM/network failures
        return json.dumps({"error": f"dynamic-a2ui LLM call failed: {exc}"})

    if not response.tool_calls:
        return json.dumps({"error": "LLM did not emit dynamic A2UI arguments"})

    args = response.tool_calls[0]["args"]
    parsed = _A2UIRenderArgs.model_validate(args)

    ops = [
        a2ui.create_surface(parsed.surfaceId, catalog_id=parsed.catalogId),
        a2ui.update_components(parsed.surfaceId, parsed.components),
    ]
    if parsed.data:
        ops.append(a2ui.update_data_model(parsed.surfaceId, parsed.data))

    return a2ui.render(operations=ops)
