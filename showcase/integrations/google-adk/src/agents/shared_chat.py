"""Shared LlmAgent factories used across multiple demos.

`build_simple_chat_agent` produces a plain Gemini chat agent with no backend
tools — appropriate for any demo whose only customisation is on the frontend
(prebuilt-sidebar, prebuilt-popup, chat-slots, chat-customization-css,
headless-simple, headless-complete, voice, frontend-tools, agentic-chat).

`build_thinking_chat_agent` uses Gemini 2.5 Flash with the thinking_config
exposed so reasoning is streamed back as `thought` parts; the v2 React core
renders these via CopilotChatReasoningMessage.

`get_model` returns a `Gemini` instance configured with the aimock proxy
endpoint when `GOOGLE_GEMINI_BASE_URL` is set, or the default model string
otherwise. All agent modules should call `get_model()` instead of
hard-coding `"gemini-2.5-flash"` so Railway deployments route through
aimock.

`stop_on_terminal_text` is the canonical after_model_callback shared by every
registered LlmAgent. Gemini 2.5-flash does not naturally end its agentic
loop after a successful tool call — it keeps re-issuing the same tool. The
callback inspects each non-partial model response and, when it contains
text with no pending function_call, sets `_invocation_context.end_invocation
= True` so ADK terminates the loop. Without this guard every backend or
frontend tool in this package fires infinitely.
"""

from __future__ import annotations

import logging
import os
from typing import Optional, Union

from google.adk.agents import LlmAgent
from google.adk.agents.callback_context import CallbackContext
from google.adk.models.google_llm import Gemini
from google.adk.models.llm_response import LlmResponse
from google.genai import types
from ag_ui_adk import AGUIToolset

logger = logging.getLogger(__name__)

DEFAULT_MODEL = "gemini-2.5-flash"


def stop_on_terminal_text(
    callback_context: CallbackContext, llm_response: LlmResponse
) -> Optional[LlmResponse]:
    """Terminate the ADK agentic loop on a final text-only model turn.

    Lifted from the (orphaned) `simple_after_model_modifier` in
    `agents/main.py`, with the SalesPipelineAgent name-gate removed so it
    applies to every registered agent. Guards:

    1. Skip partial streaming events — never end on a mid-stream chunk
       (belt-and-suspenders with `ADK_DISABLE_PROGRESSIVE_SSE_STREAMING=1`
       in `entrypoint.sh`).
    2. Only terminate when the final non-partial response contains TEXT
       and NO pending function_call — mixed text+function_call responses
       (a known Gemini 2.5-flash quirk) must NOT terminate.
    3. `_invocation_context` is an ADK private attribute; if it disappears
       in a future ADK release, log-and-degrade rather than crash the
       callback (which would stall the request).

    Without this guard, Gemini calls the same tool indefinitely after a
    successful tool result because no native termination condition fires.
    """
    content = llm_response.content
    if not content or not content.parts:
        if llm_response.error_message:
            logger.warning(
                "stop_on_terminal_text: Gemini returned error_message for agent=%s: %s",
                callback_context.agent_name,
                llm_response.error_message,
            )
        return None

    if getattr(llm_response, "partial", False):
        return None

    # Under thinking mode (`include_thoughts=True`), Gemini emits a turn
    # as TWO separate non-partial chunks:
    #   1. text-only chunk: thought + reply text, `finish_reason=None`
    #   2. function_call-only chunk: `finish_reason=FUNCTION_CALL`
    # The callback fires on both. Without the finish_reason guard below,
    # chunk 1's text-without-function-call shape causes premature
    # termination — the function call in chunk 2 still streams but the
    # agentic loop is already marked `end_invocation=True`, so the
    # post-tool-result re-invocation that would chain to the next tool
    # never happens (tool-rendering-reasoning-chain AAPL→MSFT regression).
    # Only terminate when Gemini signals the turn is genuinely done with
    # `finish_reason=STOP` (no further chunks coming). FUNCTION_CALL and
    # None mean "more chunks are inbound" — defer.
    finish_reason = getattr(llm_response, "finish_reason", None)
    finish_reason_name = (
        getattr(finish_reason, "name", None) if finish_reason is not None else None
    )
    if finish_reason_name != "STOP" and finish_reason != "STOP":
        return None

    has_text = any(getattr(part, "text", None) for part in content.parts)
    has_function_call = any(
        getattr(part, "function_call", None) for part in content.parts
    )
    if content.role != "model" or not has_text or has_function_call:
        return None

    invocation_context = getattr(callback_context, "_invocation_context", None)
    if invocation_context is None:
        logger.debug(
            "stop_on_terminal_text: callback_context has no "
            "_invocation_context attribute; skipping end_invocation."
        )
        return None

    try:
        invocation_context.end_invocation = True
    except AttributeError:
        logger.debug(
            "stop_on_terminal_text: _invocation_context lacks "
            "end_invocation; ADK private-API shape may have drifted."
        )
    return None


def get_model(model: str = DEFAULT_MODEL) -> Union[str, Gemini]:
    """Return a model suitable for LlmAgent's `model=` parameter.

    When `GOOGLE_GEMINI_BASE_URL` is set (Railway aimock proxy), returns a
    `Gemini` instance with its `base_url` pointed at the proxy. Otherwise
    returns the plain model string so the ADK resolves the default endpoint.
    """
    base_url = os.environ.get("GOOGLE_GEMINI_BASE_URL")
    if base_url:
        return Gemini(model=model, base_url=base_url)
    return model


def build_simple_chat_agent(
    *,
    name: str,
    instruction: str,
    model: str = DEFAULT_MODEL,
) -> LlmAgent:
    return LlmAgent(
        name=name,
        model=get_model(model),
        instruction=instruction,
        tools=[AGUIToolset()],
        after_model_callback=stop_on_terminal_text,
    )


def build_thinking_chat_agent(
    *,
    name: str,
    instruction: str,
    model: str = DEFAULT_MODEL,
) -> LlmAgent:
    """LlmAgent with Gemini thinking enabled.

    `include_thoughts=True` makes Gemini emit `thought=True` parts alongside
    final answer parts; ADK forwards these through ag-ui as reasoning chunks
    so v2's CopilotChatReasoningMessage / useRenderReasoning can show them.
    `thinking_budget=-1` lets the model decide how much to think.
    """
    return LlmAgent(
        name=name,
        model=get_model(model),
        instruction=instruction,
        tools=[AGUIToolset()],
        generate_content_config=types.GenerateContentConfig(
            thinking_config=types.ThinkingConfig(
                include_thoughts=True,
                thinking_budget=-1,
            ),
        ),
        after_model_callback=stop_on_terminal_text,
    )
