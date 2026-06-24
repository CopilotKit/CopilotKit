"""Shared ADK tool wrappers + model callbacks (legacy SalesPipeline helpers).

The original single-file `SalesPipelineAgent` and its hand-rolled
`generate_a2ui` planner were removed once A2UI moved to the published
`ag_ui_adk` middleware (see declarative_gen_ui_agent.py / beautiful_chat_agent.py).
What remains are the standalone tool wrappers and the `before_model` /
`before_agent` callbacks still covered by the unit tests.
"""

from __future__ import annotations

import json
import logging
from typing import Optional

from dotenv import load_dotenv
from google.adk.agents.callback_context import CallbackContext
from google.adk.models.llm_request import LlmRequest
from google.adk.models.llm_response import LlmResponse
from google.adk.tools import ToolContext
from google.genai import types

from agents.shared_chat import stop_on_terminal_text

# Shared tool implementations (via tools symlink -> ../../shared/python/tools)
from tools import (
    get_weather_impl,
    query_data_impl,
    manage_sales_todos_impl,
    get_sales_todos_impl,
    schedule_meeting_impl,
    search_flights_impl,
)

load_dotenv()

logger = logging.getLogger(__name__)


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


def schedule_meeting(
    tool_context: ToolContext, reason: str, duration_minutes: int = 30
) -> dict:
    """Schedule a meeting. The user will be asked to pick a time via the UI."""
    return schedule_meeting_impl(reason, duration_minutes)


def search_flights(tool_context: ToolContext, flights: list[dict]) -> dict:
    """Search for flights and display the results as rich cards. Return 2-3 flights.

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
        PREFIX_SIGNATURE = (
            "You are a helpful sales assistant for managing a sales pipeline."
        )
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


# Backwards-compatible alias. `simple_after_model_modifier` used to be a
# SalesPipelineAgent-gated copy of the loop terminator; the generic
# implementation now lives in `shared_chat.stop_on_terminal_text` and is
# wired into every registered agent. The alias survives only so the
# unit-test file `tests/python/test_after_model_modifier.py` keeps
# resolving the symbol. Both functions MUST behave identically; if you
# need to evolve termination logic, edit `stop_on_terminal_text` only.
simple_after_model_modifier = stop_on_terminal_text
