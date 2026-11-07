"""Luna reasoning summaries through the OpenAI Responses API.

The local model wrapper supplies metadata for the pinned LlamaIndex SDK.
The reasoning router maps summary deltas to AG-UI reasoning events.
"""

from __future__ import annotations

import os

from agents._openai_models import OpenAIResponses

from agents._reasoning_router import get_reasoning_ag_ui_workflow_router


SYSTEM_PROMPT = (
    "You are a helpful assistant. For each user question, first think "
    "step-by-step about the approach, then give a concise answer. Keep "
    "responses brief -- 1 to 3 sentences max."
)

# Responses keeps reasoning enabled; ordinary chat models use effort none.
REASONING_MODEL = os.environ.get("OPENAI_REASONING_MODEL", "gpt-6-luna")

# Ask for summaries explicitly and forward them outside the SDK model table.
_REASONING_PARAMS = {"effort": "medium", "summary": "detailed"}

_openai_kwargs = {}
if os.environ.get("OPENAI_BASE_URL"):
    _openai_kwargs["api_base"] = os.environ["OPENAI_BASE_URL"]


reasoning_router = get_reasoning_ag_ui_workflow_router(
    llm=OpenAIResponses(
        model=REASONING_MODEL,
        reasoning_options=_REASONING_PARAMS,
        additional_kwargs={"reasoning": _REASONING_PARAMS},
        **_openai_kwargs,
    ),
    frontend_tools=[],
    backend_tools=[],
    system_prompt=SYSTEM_PROMPT,
    initial_state={},
)
