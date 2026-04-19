"""Google ADK Sales Pipeline Agent with shared tools."""

from __future__ import annotations

import functools
import json
import logging
from typing import Any, Optional, TypedDict, Union

import openai
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
# `functools.lru_cache(maxsize=1)` provides thread-safe cache bookkeeping
# (the dict-lookup / insertion path is guarded), but it does NOT hold a lock
# around execution of the wrapped function body. On a cold cache, two
# concurrent callers CAN both enter `OpenAI()` — one result wins and is
# retained; the other is garbage-collected. This is acceptable here because
# `OpenAI()` is idempotent and cheap (just reads env/config and builds a
# client object with no network I/O), so the worst case is a single wasted
# object construction on a race that only happens during cold start.
@functools.lru_cache(maxsize=1)
def _get_openai_client():
    """Return a memoized OpenAI client, constructing it on first call.

    Cache bookkeeping is thread-safe via `functools.lru_cache`; see the
    module-level comment above for the cold-cache race caveat. Call
    `.cache_clear()` in tests that need to reset the memoized instance.
    """
    from openai import OpenAI

    return OpenAI()


class _A2uiError(TypedDict):
    """Shape of the structured error dict returned by generate_a2ui branches.

    Every error branch MUST populate all three keys so callers (and the LLM
    summarizing the tool result) see a consistent surface.

    NOTE: An identical TypedDict lives in
    `showcase/packages/strands/src/agents/agent.py`. Keep the two in sync —
    any key additions / removals must land in both places so the A2UI error
    surface stays consistent across showcase adapters.
    """

    error: str
    message: str
    remediation: str


def _a2ui_error(*, error: str, message: str, remediation: str) -> _A2uiError:
    """Construct and contract-check an `_A2uiError`.

    Centralizing construction lets us enforce at runtime that every error
    return from `generate_a2ui` carries all three required keys with non-empty
    string values. Typos ("remediaton") or accidental omissions blow up here
    rather than silently produce a malformed error surface.
    """
    err: _A2uiError = {
        "error": error,
        "message": message,
        "remediation": remediation,
    }
    missing = [k for k in ("error", "message", "remediation") if not err.get(k)]
    if missing:
        raise AssertionError(
            f"_a2ui_error missing required non-empty keys: {missing}; got {err!r}"
        )
    return err


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


def generate_a2ui(tool_context: ToolContext) -> Union[_A2uiError, dict[str, Any]]:
    """Generate dynamic A2UI components based on the conversation.

    A secondary LLM designs the UI schema and data. The result is
    returned as an a2ui_operations container for the middleware to detect.

    Returns either a successful `dict[str, Any]` (the a2ui_operations
    container from `build_a2ui_operations_from_tool_call`) or an `_A2uiError`
    describing what failed, with remediation guidance for the caller / LLM.
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
    if isinstance(copilotkit_state, dict):
        context_entries_raw = copilotkit_state.get("context", [])
        if not isinstance(context_entries_raw, list):
            # Schema drift: `copilotkit.context` is supposed to be a list of
            # {value: ...} dicts. Warn and coerce to empty rather than crash
            # or silently iterate over a string / dict.
            logger.warning(
                "generate_a2ui: tool_context.state['copilotkit']['context'] is %s, "
                "expected list; treating as empty (context entries will be dropped)",
                type(context_entries_raw).__name__,
            )
            context_entries = []
        else:
            context_entries = context_entries_raw
    else:
        context_entries = []
    context_text = "\n\n".join(
        entry.get("value", "")
        for entry in context_entries
        if isinstance(entry, dict) and entry.get("value")
    )

    # Extract conversation messages from session history.
    # NOTE: `_invocation_context` is an ADK private attribute. Rather than
    # wrap the whole extraction in `try/except AttributeError` (which would
    # also swallow typos and programmer errors inside the body), we look the
    # attribute up via `getattr` and only run the body when present. If ADK
    # renames / drops the attribute, we log-and-skip instead of crashing.
    conversation_messages: list[dict] = []
    invocation_context = getattr(tool_context, "_invocation_context", None)
    if invocation_context is None:
        logger.debug(
            "generate_a2ui: tool_context has no _invocation_context attribute; "
            "ADK private-API shape may have drifted. Skipping session history."
        )
    else:
        session = getattr(invocation_context, "session", None)
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

    # Wrap the OpenAI call so expected transport / auth / rate-limit failures
    # do not bubble up through the ADK tool machinery as uncaught exceptions.
    # Return a structured error with remediation instead — the LLM can surface
    # this to the user. We deliberately narrow the except to the openai
    # exception hierarchy: programmer errors (AttributeError, TypeError from
    # bad call shape, etc.) should propagate so they are caught in test and
    # not silently masked as an LLM error.
    try:
        client = _get_openai_client()
        response = client.chat.completions.create(
            model="gpt-4.1",
            messages=llm_messages,
            tools=[tool_schema],
            tool_choice={"type": "function", "function": {"name": "render_a2ui"}},
        )
    except (
        openai.APIError,
        openai.APIConnectionError,
        openai.AuthenticationError,
        openai.RateLimitError,
    ) as exc:
        logger.exception("generate_a2ui: OpenAI API call failed")
        return _a2ui_error(
            error="a2ui_llm_error",
            message=f"Secondary A2UI LLM call failed: {exc.__class__.__name__}",
            remediation=(
                "Verify OPENAI_API_KEY is set and the OpenAI service is reachable. "
                "See server logs for the full traceback."
            ),
        )

    if not response.choices:
        logger.warning("generate_a2ui: OpenAI response contained no choices")
        return _a2ui_error(
            error="a2ui_empty_response",
            message="Secondary A2UI LLM returned no choices.",
            remediation="Retry; if this persists, check OpenAI status.",
        )

    tool_calls = response.choices[0].message.tool_calls
    if not tool_calls:
        logger.warning(
            "generate_a2ui: OpenAI response had no tool_calls despite forced tool_choice"
        )
        return _a2ui_error(
            error="a2ui_no_tool_call",
            message="Secondary A2UI LLM did not call render_a2ui.",
            remediation=(
                "Retry the request. If this persists, verify the tool_choice "
                "schema matches the OpenAI API contract."
            ),
        )

    tool_call = tool_calls[0]
    try:
        args = json.loads(tool_call.function.arguments)
    except (ValueError, TypeError) as exc:
        logger.exception(
            "generate_a2ui: failed to parse render_a2ui tool arguments as JSON"
        )
        return _a2ui_error(
            error="a2ui_invalid_arguments",
            message=f"Could not parse render_a2ui arguments: {exc}",
            remediation="Retry the request; the secondary LLM emitted malformed JSON.",
        )
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
        original_instruction = llm_request.config.system_instruction
        # Stable prefix signature — used both to detect idempotent re-entry
        # and to strip a previously-inserted prefix so we don't stack it
        # when ADK calls the before_model_callback on the same request more
        # than once (observed in retry / reprompt paths).
        PREFIX_SIGNATURE = "You are a helpful sales assistant for managing a sales pipeline."
        prefix = f"""{PREFIX_SIGNATURE}
        This is the current state of the sales todos: {todos_json}
        When you modify the sales todos (whether to add, remove, or modify one or more todos), use the manage_sales_todos tool to update the list."""
        # Read the original instruction text without mutating the source
        # object. If `system_instruction` is a shared module-level
        # `types.Content` (or any object reused across requests), mutating
        # `parts[0].text` in place would re-prepend the prefix on every
        # call, stacking N times. Instead we build a fresh Content + Part
        # on every invocation and assign it to the request.
        if original_instruction is None:
            original_text = ""
        elif isinstance(original_instruction, types.Content):
            parts = original_instruction.parts or []
            original_text = (parts[0].text or "") if parts else ""
        else:
            original_text = str(original_instruction)

        # Strip any previously-prepended block (same signature → same block)
        # so repeated invocations on the same request do not stack. We look
        # for the signature and discard from the start of the string up to
        # and including the end of the most recent full prefix block.
        sig_idx = original_text.find(PREFIX_SIGNATURE)
        if sig_idx != -1:
            # Find the end of the already-inserted prefix — it terminates
            # with the known trailing sentence. If that sentence is missing
            # (mangled / drifted prefix), leave `original_text` as-is rather
            # than chopping at the signature: chopping would discard every
            # character after the signature, including legitimate user
            # content that followed a corrupted prefix. Worst case of the
            # no-op path is one duplicated signature on this single call
            # (non-stacking, because the next invocation will find an
            # end_marker since the freshly-prepended prefix has one).
            end_marker = "use the manage_sales_todos tool to update the list."
            end_idx = original_text.find(end_marker, sig_idx)
            if end_idx != -1:
                original_text = original_text[end_idx + len(end_marker) :]
            # else: leave original_text untouched — preserve user suffix.

        modified_text = prefix + original_text
        # ADK callback contract: assign a freshly constructed Content so we
        # never mutate a potentially shared instance across requests.
        llm_request.config.system_instruction = types.Content(
            role="system", parts=[types.Part(text=modified_text)]
        )

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
            # Gemini surfaced an error (quota exhausted, safety-filter block,
            # context-overflow, etc.). Previously this branch returned None
            # silently, making these failures invisible in the server log.
            # Log at WARNING with agent name so operators can correlate the
            # failure to the request.
            logger.warning(
                "simple_after_model_modifier: Gemini returned error_message "
                "for agent=%s: %s",
                agent_name,
                llm_response.error_message,
            )
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
