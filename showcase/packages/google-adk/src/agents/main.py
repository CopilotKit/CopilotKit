"""Google ADK Sales Pipeline Agent with shared tools."""

from __future__ import annotations

import functools
import json
import logging
from typing import Optional, TypedDict

from dotenv import load_dotenv
from google.adk.agents import LlmAgent
from google.adk.agents.callback_context import CallbackContext
from google.adk.models.llm_request import LlmRequest
from google.adk.models.llm_response import LlmResponse
from google.adk.tools import ToolContext
from google.genai import types

import sys
import os

sys.path.insert(
    0,
    os.path.join(os.path.dirname(__file__), "..", "..", "..", "..", "shared", "python"),
)
from tools import (
    get_weather_impl,
    query_data_impl,
    manage_sales_todos_impl,
    get_sales_todos_impl,
    schedule_meeting_impl,
    search_flights_impl,
    build_a2ui_operations_from_tool_call,
)

load_dotenv()

logger = logging.getLogger(__name__)

# Module-level OpenAI client — lazily constructed on first use. Rebuilding the
# client on every generate_a2ui call wastes a few ms per request and, more
# importantly, re-runs env/credential resolution which is unnecessary.
#
# `functools.lru_cache(maxsize=1)` gives us thread-safe memoization for free
# (CPython's lru_cache holds an internal lock, so two concurrent callers do
# NOT both construct+discard a client — only one call executes and the others
# see the cached result). This avoids the classic double-checked-locking race
# a plain `if _openai_client is None` module-global would have.
@functools.lru_cache(maxsize=1)
def _get_openai_client():
    """Return a memoized OpenAI client, constructing it on first call.

    Thread-safe via `functools.lru_cache`. Call `.cache_clear()` in tests that
    need to reset the memoized instance.
    """
    from openai import OpenAI

    return OpenAI()


class _A2uiError(TypedDict):
    """Shape of the structured error dict returned by generate_a2ui branches.

    Every error branch MUST populate all three keys so callers (and the LLM
    summarizing the tool result) see a consistent surface.
    """

    error: str
    message: str
    remediation: str


def get_weather(tool_context: ToolContext, location: str) -> dict:
    """Get the weather for a given location. Ensure location is fully spelled out."""
    return get_weather_impl(location)


def query_data(tool_context: ToolContext, query: str) -> list:
    """Query financial database for chart data. Returns data suitable for pie or bar charts."""
    return query_data_impl(query)


def manage_sales_todos(tool_context: ToolContext, todos: list[dict]) -> dict:
    """Manage the sales pipeline by persisting the complete todo list.

    Args:
        tool_context: ADK-provided tool context; `state["todos"]` is updated.
        todos: The complete list of sales todos to maintain. Must be the
            full list (not a delta) — the implementation replaces state
            wholesale.

    Returns:
        A dict with `{"status": "updated", "count": <int>}` where `count`
        is the number of todos now stored.
    """
    result = manage_sales_todos_impl(todos)
    tool_context.state["todos"] = result
    return {"status": "updated", "count": len(result)}


def get_sales_todos(tool_context: ToolContext) -> list:
    """Get the current list of sales pipeline todos."""
    return get_sales_todos_impl(tool_context.state.get("todos"))


def schedule_meeting(tool_context: ToolContext, reason: str, duration_minutes: int = 30) -> dict:
    """Schedule a meeting. The user will be asked to pick a time via the UI."""
    return schedule_meeting_impl(reason, duration_minutes)


def search_flights(tool_context: ToolContext, flights: list[dict]) -> dict:
    """Search for flights and display the results as rich cards. Return exactly 2 flights.

    Each flight must have: airline, airlineLogo, flightNumber, origin, destination,
    date (short readable format like "Tue, Mar 18" -- use near-future dates),
    departureTime, arrivalTime, duration (e.g. "4h 25m"),
    status (e.g. "On Time" or "Delayed"),
    statusColor (hex color for status dot),
    price (e.g. "$289"), and currency (e.g. "USD").

    For airlineLogo use Google favicon API:
    https://www.google.com/s2/favicons?domain={airline_domain}&sz=128
    """
    return search_flights_impl(flights)


def generate_a2ui(tool_context: ToolContext) -> dict:
    """Generate dynamic A2UI components based on the conversation.

    A secondary LLM designs the UI schema and data. The result is
    returned as an a2ui_operations container for the middleware to detect.
    """
    # Extract copilotkit context entries from session state
    copilotkit_state = tool_context.state.get("copilotkit", {})
    if copilotkit_state and not isinstance(copilotkit_state, dict):
        # Schema drift signal: something set `state["copilotkit"]` to a
        # non-dict value. We silently treat it as empty (below) to keep the
        # request alive, but log a warning so operators can catch the drift.
        logger.warning(
            "generate_a2ui: tool_context.state['copilotkit'] is %s, expected dict; "
            "treating as empty (context entries will be dropped)",
            type(copilotkit_state).__name__,
        )
    context_entries = copilotkit_state.get("context", []) if isinstance(copilotkit_state, dict) else []
    context_text = "\n\n".join(
        entry.get("value", "")
        for entry in context_entries
        if isinstance(entry, dict) and entry.get("value")
    )

    # Extract conversation messages from session history.
    # NOTE: `_invocation_context` is an ADK private attribute — narrow the
    # except to AttributeError so unrelated bugs are not silently swallowed,
    # and debug-log drift so operators can spot when the ADK shape changes.
    conversation_messages: list[dict] = []
    try:
        session = tool_context._invocation_context.session
        if session and hasattr(session, "events"):
            for event in session.events:
                if hasattr(event, "content") and event.content and hasattr(event.content, "parts"):
                    role_str = getattr(event.content, "role", "")
                    if role_str in ("user", "model"):
                        text_parts = []
                        for part in event.content.parts:
                            if hasattr(part, "text") and part.text:
                                text_parts.append(part.text)
                        if text_parts:
                            oai_role = "assistant" if role_str == "model" else "user"
                            conversation_messages.append({"role": oai_role, "content": "".join(text_parts)})
    except AttributeError as exc:
        logger.debug(
            "generate_a2ui: could not read session history from _invocation_context (%s). "
            "ADK private-API shape may have drifted.",
            exc,
        )

    tool_schema = {
        "type": "function",
        "function": {
            "name": "render_a2ui",
            "description": "Render a dynamic A2UI v0.9 surface.",
            "parameters": {
                "type": "object",
                "properties": {
                    "surfaceId": {"type": "string"},
                    "catalogId": {"type": "string"},
                    "components": {"type": "array", "items": {"type": "object"}},
                    "data": {"type": "object"},
                },
                "required": ["surfaceId", "catalogId", "components"],
            },
        },
    }

    llm_messages: list[dict] = [
        {"role": "system", "content": context_text or "Generate a useful dashboard UI."},
    ]
    llm_messages.extend(conversation_messages)

    # Wrap the OpenAI call so raw APIError / RateLimitError / AuthenticationError
    # / timeouts do not bubble up through the ADK tool machinery as uncaught
    # exceptions. Return a structured error with remediation instead — the LLM
    # can surface this to the user.
    try:
        client = _get_openai_client()
        response = client.chat.completions.create(
            model="gpt-4.1",
            messages=llm_messages,
            tools=[tool_schema],
            tool_choice={"type": "function", "function": {"name": "render_a2ui"}},
        )
    except Exception as exc:  # noqa: BLE001 — openai raises a variety of subclasses
        logger.exception("generate_a2ui: OpenAI API call failed")
        return {
            "error": "a2ui_llm_error",
            "message": f"Secondary A2UI LLM call failed: {exc.__class__.__name__}",
            "remediation": (
                "Verify OPENAI_API_KEY is set and the OpenAI service is reachable. "
                "See server logs for the full traceback."
            ),
        }

    if not response.choices:
        logger.warning("generate_a2ui: OpenAI response contained no choices")
        return {
            "error": "a2ui_empty_response",
            "message": "Secondary A2UI LLM returned no choices.",
            "remediation": "Retry; if this persists, check OpenAI status.",
        }

    tool_calls = response.choices[0].message.tool_calls
    if not tool_calls:
        logger.warning(
            "generate_a2ui: OpenAI response had no tool_calls despite forced tool_choice"
        )
        return {
            "error": "a2ui_no_tool_call",
            "message": "Secondary A2UI LLM did not call render_a2ui.",
            "remediation": (
                "Retry the request. If this persists, verify the tool_choice "
                "schema matches the OpenAI API contract."
            ),
        }

    tool_call = tool_calls[0]
    try:
        args = json.loads(tool_call.function.arguments)
    except (ValueError, TypeError) as exc:
        logger.exception(
            "generate_a2ui: failed to parse render_a2ui tool arguments as JSON"
        )
        return {
            "error": "a2ui_invalid_arguments",
            "message": f"Could not parse render_a2ui arguments: {exc}",
            "remediation": "Retry the request; the secondary LLM emitted malformed JSON.",
        }
    return build_a2ui_operations_from_tool_call(args)


def on_before_agent(callback_context: CallbackContext):
    if "todos" not in callback_context.state:
        callback_context.state["todos"] = []

    return None


def before_model_modifier(
    callback_context: CallbackContext, llm_request: LlmRequest
) -> Optional[LlmResponse]:
    """Inspects/modifies the LLM request to include current sales pipeline state."""
    agent_name = callback_context.agent_name
    if agent_name == "SalesPipelineAgent":
        todos_json = "No sales todos yet"
        if (
            "todos" in callback_context.state
            and callback_context.state["todos"] is not None
        ):
            try:
                todos_json = json.dumps(callback_context.state["todos"], indent=2)
            except (TypeError, ValueError):
                # Do not leak the raw error into the LLM prompt — it confuses
                # the model and can bleed internal details to the user. Log
                # server-side and fall back to the neutral placeholder.
                logger.exception(
                    "before_model_modifier: failed to serialize todos state; "
                    "falling back to neutral placeholder"
                )
                todos_json = "No sales todos yet"
        original_instruction = llm_request.config.system_instruction or types.Content(
            role="system", parts=[]
        )
        prefix = f"""You are a helpful sales assistant for managing a sales pipeline.
        This is the current state of the sales todos: {todos_json}
        When you modify the sales todos (whether to add, remove, or modify one or more todos), use the manage_sales_todos tool to update the list."""
        if not isinstance(original_instruction, types.Content):
            original_instruction = types.Content(
                role="system", parts=[types.Part(text=str(original_instruction))]
            )
        if not original_instruction.parts:
            original_instruction.parts = [types.Part(text="")]

        if original_instruction.parts and len(original_instruction.parts) > 0:
            modified_text = prefix + (original_instruction.parts[0].text or "")
            # ADK callback contract: mutate llm_request in place (side-effectful by design).
            original_instruction.parts[0].text = modified_text
        llm_request.config.system_instruction = original_instruction

    return None


def simple_after_model_modifier(
    callback_context: CallbackContext, llm_response: LlmResponse
) -> Optional[LlmResponse]:
    """Stop consecutive tool-calling loops after the model produces a
    terminal text-only response, skipping partial streaming events and
    degrading gracefully when ADK's private `_invocation_context` drifts.

    This callback has three defensive guards beyond the plain "terminate on
    text" check:

    1. **Partial-event skip**: returns early when `llm_response.partial` is
       truthy so we never end invocation on a mid-stream chunk.
    2. **Mixed text + function_call detection**: only terminates when the
       response has text AND no pending function_call.
    3. **`_invocation_context` fallback**: ADK's `_invocation_context` is a
       private attribute; if it disappears or loses `end_invocation`, the
       callback logs and returns instead of raising (which would stall the
       whole request).

    IMPORTANT: we must only terminate on a FINAL, non-partial response that
    contains TEXT and NO pending function_call. Two Gemini 2.5-flash quirks
    made the original implementation (check `parts[0].text` only) unsafe:

    1. Partial streaming events: with `PROGRESSIVE_SSE_STREAMING` enabled, the
       model emits partial events before the final turn_complete event. Ending
       invocation on a partial event cuts the stream off mid-tool-call and
       leaves the backend emitting only a "partial" event with no TOOL_CALL_*
       or TEXT_MESSAGE_* events — so the tool-rendering UI never receives a
       weather card.
    2. Mixed text + function_call responses: Gemini sometimes returns a
       response whose parts contain BOTH text ("I'll check the weather...") AND
       a function_call. Terminating on text alone would skip the tool call and
       strand the UI.

    The partial-event guard below is belt-and-suspenders with
    `ADK_DISABLE_PROGRESSIVE_SSE_STREAMING=1` in `entrypoint.sh`: the env var
    is the primary workaround (operator-level, ADK-wide), and this guard is
    the in-callback fallback. Both layers are intentional — do NOT remove one
    thinking the other makes it redundant. The env var is operator-level and
    can be disabled; this guard runs regardless.
    """
    agent_name = callback_context.agent_name
    if agent_name == "SalesPipelineAgent":
        if llm_response.content and llm_response.content.parts:
            # Skip partial events — only consider final (turn_complete) LLM
            # responses. Terminating on a partial interrupts the stream before
            # tool calls or full text can be emitted.
            if getattr(llm_response, "partial", False):
                return None

            has_text = any(
                getattr(part, "text", None) for part in llm_response.content.parts
            )
            has_function_call = any(
                getattr(part, "function_call", None)
                for part in llm_response.content.parts
            )
            if (
                llm_response.content.role == "model"
                and has_text
                and not has_function_call
            ):
                # `_invocation_context` is an ADK private attribute — guard
                # against shape drift. If the attr disappears in a future ADK
                # release, log and degrade gracefully rather than crash the
                # callback (which would stall the whole request).
                invocation_context = getattr(
                    callback_context, "_invocation_context", None
                )
                if invocation_context is not None:
                    try:
                        invocation_context.end_invocation = True
                    except AttributeError:
                        logger.debug(
                            "simple_after_model_modifier: _invocation_context "
                            "lacks end_invocation; ADK private-API shape may "
                            "have drifted."
                        )
                else:
                    logger.debug(
                        "simple_after_model_modifier: callback_context has no "
                        "_invocation_context attribute; skipping end_invocation."
                    )

        elif llm_response.error_message:
            return None
        else:
            return None
    return None


sales_pipeline_agent = LlmAgent(
    name="SalesPipelineAgent",
    model="gemini-2.5-flash",
    instruction="""
        You are a helpful assistant.

        WEATHER:
        When the user asks about the weather, call the get_weather tool.
        If the user does not specify a location, use "Everywhere ever in the whole wide world".
        After the weather tool returns, briefly summarize the result in one sentence.

        SALES TODOS:
        When a user asks you to do anything regarding sales todos or the pipeline, use the manage_sales_todos tool.
        Always pass the COMPLETE LIST of todos to the manage_sales_todos tool.
        After using the tool, provide a brief summary of what you created, removed, or changed.

        QUERY DATA:
        Use the query_data tool when the user asks for financial data, charts, or analytics.
        This returns data suitable for pie charts and bar charts.

        GET SALES TODOS:
        Use the get_sales_todos tool to retrieve the current list of sales todos before discussing them.

        SEARCH FLIGHTS:
        Use the search_flights tool to search for flights and display rich A2UI cards.

        GENERATE A2UI:
        Use the generate_a2ui tool to generate dynamic A2UI dashboards from conversation context.

        ALWAYS provide a textual response after any tool call.
        """,
    tools=[get_weather, query_data, manage_sales_todos, get_sales_todos, schedule_meeting, search_flights, generate_a2ui],
    before_agent_callback=on_before_agent,
    before_model_callback=before_model_modifier,
    after_model_callback=simple_after_model_modifier,
)
