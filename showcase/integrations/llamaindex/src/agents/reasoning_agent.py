"""
Reasoning agent for LlamaIndex.

Shared by `reasoning-custom` (custom amber ReasoningBlock slot) and
`reasoning-default` (CopilotKit's built-in reasoning slot). The system
prompt asks the model to think step-by-step before answering, so the LLM
produces a reasoning channel that the chat UI can render.

Why a reasoning model + the OpenAI Responses API
------------------------------------------------
Mirrors the langgraph-python parity gold standard
(`init_chat_model("openai:<reasoning-model>", use_responses_api=True,
reasoning={"effort": "medium", "summary": "detailed"})`). The OpenAI
Responses API streams `response.reasoning_summary_text.delta` items only for
native reasoning models (gpt-5, o3, o4-mini, …); a non-reasoning model like
gpt-4.1 on the chat-completions wire emits NO reasoning channel against real
OpenAI, so the reasoning slot would only ever light up under aimock. Routing
through `OpenAIResponses` with a reasoning model makes the chain of thought
stream against a REAL provider; aimock renders the fixture's abstract
`reasoning` field into the same Responses-API shape for deterministic tests.
(LlamaIndex pins the default to `gpt-5` rather than langgraph's `gpt-5.4`
because LlamaIndex 0.5.6 rejects model names absent from its context-size
table at workflow construction — see REASONING_MODEL below.)

Uses `get_reasoning_ag_ui_workflow_router` (a thin in-package extension of the
stock `get_ag_ui_workflow_router`) so the model's reasoning summary deltas
surface as AG-UI `REASONING_MESSAGE_*` events. The stock router reads only
assistant text and silently drops the reasoning channel; see
`_reasoning_router.py` for the three framework gaps it closes (and for how
`_extract_reasoning_delta` reads the Responses-API summary delta off
`resp.raw`, which LlamaIndex's own stream processing does not surface). The
frontend `CopilotChatReasoningMessage` slot then composes with the flow.
"""

from __future__ import annotations

import os

from llama_index.llms.openai import OpenAIResponses

from agents._reasoning_router import get_reasoning_ag_ui_workflow_router


SYSTEM_PROMPT = (
    "You are a helpful assistant. For each user question, first think "
    "step-by-step about the approach, then give a concise answer. Keep "
    "responses brief -- 1 to 3 sentences max."
)

# Reasoning-capable model routed through the OpenAI Responses API.
#
# Default is `gpt-5` (a native reasoning model), NOT the langgraph gold
# standard's `gpt-5.4`. LlamaIndex 0.5.6's `OpenAIResponses.metadata` resolves
# the context window through `openai_modelname_to_contextsize()`, which raises
# `ValueError: Unknown model` for names outside its hard-coded table —
# `AGUIChatWorkflow.__init__` reads `llm.metadata.is_function_calling_model`,
# so an unrecognized name (like `gpt-5.4`) crashes workflow construction at
# startup. `gpt-5` is in both that table AND the O1_MODELS reasoning list, so
# it streams reasoning natively against real OpenAI. Deployments can override
# via OPENAI_REASONING_MODEL (with any name LlamaIndex 0.5.6 recognizes).
REASONING_MODEL = os.environ.get("OPENAI_REASONING_MODEL", "gpt-5")

# `summary: detailed` requests the streamed reasoning summary; `effort:
# medium` mirrors the gold config. We pass these through BOTH
# `reasoning_options` (idiomatic; honored for O1_MODELS like gpt-5) AND
# `additional_kwargs` (unconditionally merged into the /v1/responses body by
# `OpenAIResponses._get_model_kwargs`), so the `reasoning` param still reaches
# the wire if a deployment overrides to a reasoning model outside the
# O1_MODELS allowlist.
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
