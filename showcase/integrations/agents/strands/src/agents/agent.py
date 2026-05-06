"""
Strands agent with sales pipeline state, weather tool, and HITL support.

Adapted from examples/integrations/strands-python/agent/main.py

All module-level side effects (agent construction, model init,
``_agents_by_thread`` patching) are deferred to ``build_showcase_agent()``
so import failures are localized and testable.
"""

import json
import logging
import os
import threading
import uuid
from collections.abc import AsyncIterator, Mapping
from typing import Any, Optional, TypedDict

from ag_ui.core.events import (
    EventType,
    MessagesSnapshotEvent,
    RunStartedEvent,
    StateSnapshotEvent,
    TextMessageContentEvent,
    TextMessageEndEvent,
    TextMessageStartEvent,
    ToolCallArgsEvent,
    ToolCallEndEvent,
    ToolCallResultEvent,
    ToolCallStartEvent,
)
from ag_ui.core.types import (
    AssistantMessage,
    FunctionCall,
    ToolCall,
    ToolMessage,
    UserMessage,
)
from ag_ui_strands import (
    StrandsAgent,
    StrandsAgentConfig,
    ToolBehavior,
)
from strands import Agent, tool
from strands.hooks import (
    AfterToolCallEvent,
    BeforeInvocationEvent,
    BeforeToolCallEvent,
    HookProvider,
    HookRegistry,
)
from strands.models.openai import OpenAIModel

# Import shared tool implementations (symlinked at project root → ../../shared/python/tools)
from tools import (
    get_weather_impl,
    query_data_impl,
    manage_sales_todos_impl,
    schedule_meeting_impl,
    search_flights_impl,
    build_a2ui_operations_from_tool_call,
)

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# MessagesSnapshot-injecting wrapper
# ---------------------------------------------------------------------------
#
# ag_ui_strands (through at least v0.1.7) does NOT emit
# ``MessagesSnapshotEvent`` events. The CopilotKit frontend requires
# these events to build its internal message tree — without them,
# responses that include tool calls never render as assistant messages
# in the DOM (the tool-call events are received but no visible message
# element is created).
#
# ``_MessagesSnapshotWrapper`` sits between StrandsAgent.run() and the
# SSE transport: it intercepts the event stream and injects
# ``MessagesSnapshotEvent`` at the points where LangGraph Python's
# adapter would emit them:
#
#   1. After the initial ``RunStartedEvent`` — snapshot contains the
#      user message that started this turn.
#   2. After each ``ToolCallEndEvent`` — snapshot contains the assistant
#      message with its ``tool_calls[]`` list so the frontend's message
#      tree can create the assistant bubble before the tool result
#      arrives.
#   3. After each ``ToolCallResultEvent`` — snapshot contains the
#      ``ToolMessage`` so the frontend pairs the result with the call.
#   4. After each ``TextMessageEndEvent`` — snapshot contains the
#      assistant's text response so the frontend renders the final
#      bubble.
# ---------------------------------------------------------------------------


class _MessagesSnapshotWrapper:
    """Wraps a ``StrandsAgent`` and injects ``MessagesSnapshotEvent``."""

    def __init__(self, delegate: StrandsAgent) -> None:
        self._delegate = delegate

    # Proxy attribute access to the real StrandsAgent so
    # ``create_strands_app`` and any other consumer sees the same
    # interface (name, description, config, etc.).
    def __getattr__(self, name: str) -> Any:
        return getattr(self._delegate, name)

    async def run(self, input_data: Any) -> AsyncIterator[Any]:
        """Wrap ``delegate.run()`` and inject ``MessagesSnapshotEvent``."""

        # Seed the snapshot message list from the full conversation
        # history that CopilotKit sends with every request.  This way
        # each MESSAGES_SNAPSHOT contains the *complete* thread state
        # (prior turns + whatever this turn adds), matching the
        # contract the CopilotKit frontend expects.
        messages: list[Any] = []
        if input_data.messages:
            for msg in input_data.messages:
                msg_id = getattr(msg, "id", None) or str(uuid.uuid4())
                if msg.role == "user":
                    content = (
                        msg.content
                        if isinstance(msg.content, str)
                        else str(msg.content)
                    )
                    messages.append(
                        UserMessage(id=msg_id, role="user", content=content)
                    )
                elif msg.role == "assistant":
                    tool_calls_list = None
                    if hasattr(msg, "tool_calls") and msg.tool_calls:
                        tool_calls_list = []
                        for tc in msg.tool_calls:
                            fn = tc.function if hasattr(tc, "function") else {}
                            fn_name = (
                                fn.get("name")
                                if isinstance(fn, dict)
                                else getattr(fn, "name", "unknown")
                            )
                            fn_args = (
                                fn.get("arguments")
                                if isinstance(fn, dict)
                                else getattr(fn, "arguments", "{}")
                            )
                            tool_calls_list.append(
                                ToolCall(
                                    id=tc.id,
                                    type="function",
                                    function=FunctionCall(
                                        name=fn_name or "unknown",
                                        arguments=fn_args or "{}",
                                    ),
                                )
                            )
                    content = (
                        msg.content
                        if isinstance(msg.content, str)
                        else (str(msg.content) if msg.content else "")
                    )
                    messages.append(
                        AssistantMessage(
                            id=msg_id,
                            role="assistant",
                            content=content,
                            tool_calls=tool_calls_list,
                        )
                    )
                elif msg.role == "tool":
                    content = (
                        msg.content
                        if isinstance(msg.content, str)
                        else str(msg.content)
                    )
                    messages.append(
                        ToolMessage(
                            id=msg_id,
                            role="tool",
                            content=content,
                            tool_call_id=getattr(msg, "tool_call_id", ""),
                        )
                    )

        # Track state as events flow through.
        run_started = False
        initial_snapshot_emitted = False
        current_tool_call_id: Optional[str] = None
        current_tool_call_name: Optional[str] = None
        current_tool_call_args: str = "{}"
        current_text_id: Optional[str] = None
        accumulated_text: str = ""

        async for event in self._delegate.run(input_data):
            yield event

            # Detect event types by checking the ``type`` attribute
            # (which is an ``EventType`` enum member on all AG-UI events).
            etype = getattr(event, "type", None)

            # 1. After RunStartedEvent — emit initial snapshot with user msg.
            if etype == EventType.RUN_STARTED and not run_started:
                run_started = True
                continue  # snapshot after first StateSnapshot

            # Emit the initial snapshot right after the first
            # StateSnapshotEvent (which always follows RunStartedEvent).
            if (
                etype == EventType.STATE_SNAPSHOT
                and run_started
                and not initial_snapshot_emitted
            ):
                initial_snapshot_emitted = True
                if messages:
                    yield MessagesSnapshotEvent(
                        type=EventType.MESSAGES_SNAPSHOT,
                        messages=list(messages),
                    )
                continue

            # 2. Track tool call events.
            if etype == EventType.TOOL_CALL_START:
                current_tool_call_id = getattr(event, "tool_call_id", None)
                current_tool_call_name = getattr(event, "tool_call_name", None)
                current_text_id = getattr(event, "parent_message_id", None)
                current_tool_call_args = ""
                continue

            if etype == EventType.TOOL_CALL_ARGS:
                current_tool_call_args += getattr(event, "delta", "")
                continue

            if etype == EventType.TOOL_CALL_END and current_tool_call_id:
                # Build an AssistantMessage with the tool call.
                tc = ToolCall(
                    id=current_tool_call_id,
                    type="function",
                    function=FunctionCall(
                        name=current_tool_call_name or "unknown",
                        arguments=current_tool_call_args or "{}",
                    ),
                )
                assistant_msg = AssistantMessage(
                    id=current_text_id or str(uuid.uuid4()),
                    role="assistant",
                    content="",
                    tool_calls=[tc],
                )
                messages.append(assistant_msg)
                yield MessagesSnapshotEvent(
                    type=EventType.MESSAGES_SNAPSHOT,
                    messages=list(messages),
                )
                continue

            # 3. After tool result — add ToolMessage and snapshot.
            if etype == EventType.TOOL_CALL_RESULT:
                tool_call_id = getattr(event, "tool_call_id", None)
                content = getattr(event, "content", "")
                if tool_call_id:
                    tool_msg = ToolMessage(
                        id=getattr(event, "message_id", str(uuid.uuid4())),
                        role="tool",
                        content=content or "",
                        tool_call_id=tool_call_id,
                    )
                    messages.append(tool_msg)
                    yield MessagesSnapshotEvent(
                        type=EventType.MESSAGES_SNAPSHOT,
                        messages=list(messages),
                    )
                # Reset tool tracking.
                current_tool_call_id = None
                current_tool_call_name = None
                current_tool_call_args = "{}"
                continue

            # 4. Track text message streaming.
            if etype == EventType.TEXT_MESSAGE_START:
                current_text_id = getattr(event, "message_id", None)
                accumulated_text = ""
                continue

            if etype == EventType.TEXT_MESSAGE_CONTENT:
                accumulated_text += getattr(event, "delta", "")
                continue

            if etype == EventType.TEXT_MESSAGE_END and current_text_id:
                assistant_msg = AssistantMessage(
                    id=current_text_id,
                    role="assistant",
                    content=accumulated_text,
                )
                messages.append(assistant_msg)
                yield MessagesSnapshotEvent(
                    type=EventType.MESSAGES_SNAPSHOT,
                    messages=list(messages),
                )
                current_text_id = None
                accumulated_text = ""
                continue


class _A2uiError(TypedDict):
    """Shape of the structured error dict returned by generate_a2ui branches.

    Mirrors the google-adk and langroid sibling agents' error shape — keep
    all three in sync. Every error branch MUST populate all three keys so
    callers (and the LLM summarizing the tool result) see a consistent
    surface.
    """

    error: str
    message: str
    remediation: str


# ---- Tools --------------------------------------------------------------


# @region[weather-tool-backend]
@tool
def get_weather(location: str):
    """Get current weather for a location.

    Args:
        location: The location to get weather for

    Returns:
        Weather information as JSON string
    """
    return json.dumps(get_weather_impl(location))
# @endregion[weather-tool-backend]


@tool
def query_data(query: str):
    """Query financial database for chart data.

    Always call before showing a chart or graph.

    Args:
        query: Natural language query for financial data

    Returns:
        Financial data as JSON string
    """
    return json.dumps(query_data_impl(query))


@tool
def manage_sales_todos(todos: list[dict]):
    """Manage the sales pipeline by replacing the entire list of todos.

    IMPORTANT: Always provide the entire list, not just new items.

    Args:
        todos: The complete updated list of sales todos

    Returns:
        Success message
    """
    result = manage_sales_todos_impl(todos)
    return f"Sales todos updated. Tracking {len(result)} item(s)."


@tool
def get_sales_todos():
    """Get the current sales pipeline todos.

    Returns:
        Instruction to check the sales pipeline in context
    """
    return "Check the sales pipeline provided in the context."


@tool
def schedule_meeting(reason: str):
    """Schedule a meeting with user approval.

    Duration is intentionally defaulted in this showcase to keep the
    demo HITL flow minimal; callers only supply a reason.

    Args:
        reason: Reason for the meeting

    Returns:
        Meeting scheduling result as JSON string
    """
    return json.dumps(schedule_meeting_impl(reason))


@tool
def search_flights(flights: list[dict]):
    """Search for flights and display the results as rich cards. Return exactly 2 flights.

    Each flight must have: airline, airlineLogo, flightNumber, origin, destination,
    date (short readable format like "Tue, Mar 18" -- use near-future dates),
    departureTime, arrivalTime, duration (e.g. "4h 25m"),
    status (e.g. "On Time" or "Delayed"),
    statusColor (hex color for status dot),
    price (e.g. "$289"), and currency (e.g. "USD").

    For airlineLogo use Google favicon API:
    https://www.google.com/s2/favicons?domain={airline_domain}&sz=128

    Args:
        flights: List of flight objects

    Returns:
        Flight search results as JSON string
    """
    result = search_flights_impl(flights)
    return json.dumps(result)


# @region[backend-render-operations]
# The `generate_a2ui` tool runs a secondary LLM call with a forced
# `render_a2ui` tool, then converts that tool call's args into the
# A2UI `a2ui_operations` container via
# `build_a2ui_operations_from_tool_call`. The ag_ui_strands middleware
# detects the container in the tool result and forwards the ops to
# the frontend, which resolves component names through the registered
# catalog (`copilotkit://generative-catalog`).
@tool
def generate_a2ui(context: str) -> str:
    """Generate dynamic A2UI components based on the conversation.

    A secondary LLM designs the UI schema and data. The result is
    returned as an a2ui_operations container for the middleware to detect.

    Error branches return a JSON-serialized ``_A2uiError`` dict rather
    than raising, so OpenAI transport / quota / auth failures surface to
    the LLM as a structured tool result (not an uncaught exception in the
    strands tool machinery). See ``_A2uiError`` above.

    Args:
        context: Conversation context to generate UI from

    Returns:
        A2UI operations (or ``_A2uiError``) as JSON string
    """
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

    # Wrap the OpenAI call so raw SDK / transport failures do NOT bubble up
    # through the strands tool machinery as uncaught exceptions. Return a
    # structured error with remediation instead — the LLM can surface this
    # to the user. Mirrors the google-adk and langroid sibling agents'
    # error-handling shape — keep all three in sync.
    #
    # Exception scope is broad on the SDK side but still bounded:
    #   * ``openai.OpenAIError`` covers config-time failures (e.g. from
    #     ``OpenAI()`` constructor when ``OPENAI_API_KEY`` is unset).
    #     ``APIError`` subclasses (RateLimitError, APIConnectionError,
    #     AuthenticationError, BadRequestError, etc.) are also caught via
    #     the broader ``except`` tuple. Verified against ``openai>=1.0`` —
    #     re-check hierarchy on major version bumps.
    #   * ``httpx.HTTPError`` covers transport failures (ConnectError,
    #     ReadTimeout, RemoteProtocolError) that can escape below the SDK's
    #     wrap layer in rare cases.
    # Programmer errors (AttributeError, NameError, TypeError from bad
    # kwargs, etc.) still propagate so bugs are not silently swallowed as
    # "LLM error". Note the client construction itself is inside the try
    # block for the same reason.
    import openai as _openai_mod
    import httpx as _httpx_mod

    try:
        client = _openai_mod.OpenAI()
        response = client.chat.completions.create(
            model="gpt-4.1",
            messages=[
                {"role": "system", "content": context or "Generate a useful dashboard UI."},
                {"role": "user", "content": "Generate a dynamic A2UI dashboard based on the conversation."},
            ],
            tools=[tool_schema],
            tool_choice={"type": "function", "function": {"name": "render_a2ui"}},
        )
    except (_openai_mod.OpenAIError, _httpx_mod.HTTPError) as exc:
        logger.exception("generate_a2ui: OpenAI API call failed")
        return json.dumps(_A2uiError(
            error="a2ui_llm_error",
            message=f"Secondary A2UI LLM call failed: {exc.__class__.__name__}",
            remediation=(
                "Verify OPENAI_API_KEY is set and the OpenAI service is reachable. "
                "See server logs for the full traceback."
            ),
        ))

    if not response.choices:
        logger.warning("generate_a2ui: OpenAI response contained no choices")
        return json.dumps(_A2uiError(
            error="a2ui_empty_response",
            message="Secondary A2UI LLM returned no choices.",
            remediation="Retry; if this persists, check OpenAI status.",
        ))

    tool_calls = response.choices[0].message.tool_calls
    if not tool_calls:
        logger.warning(
            "generate_a2ui: OpenAI response had no tool_calls despite forced tool_choice"
        )
        return json.dumps(_A2uiError(
            error="a2ui_no_tool_call",
            message="Secondary A2UI LLM did not call render_a2ui.",
            remediation=(
                "Retry the request. If this persists, verify the tool_choice "
                "schema matches the OpenAI API contract."
            ),
        ))

    tool_call = tool_calls[0]
    try:
        args = json.loads(tool_call.function.arguments)
    except (ValueError, TypeError) as exc:
        logger.exception(
            "generate_a2ui: failed to parse render_a2ui tool arguments as JSON"
        )
        return json.dumps(_A2uiError(
            error="a2ui_invalid_arguments",
            message=f"Could not parse render_a2ui arguments: {exc}",
            remediation="Retry the request; the secondary LLM emitted malformed JSON.",
        ))

    result = build_a2ui_operations_from_tool_call(args)
    return json.dumps(result)
# @endregion[backend-render-operations]


@tool
def set_theme_color(theme_color: str):
    """Change the theme color of the UI.

    This is a frontend tool - it returns None as the actual
    execution happens on the frontend via useFrontendTool.

    Args:
        theme_color: The color to set as theme
    """
    return None


# ---- Shared State (Read + Write) demo ----------------------------------
#
# The frontend's `shared-state-read-write` page writes a `preferences`
# object into agent state via `agent.setState()`. ``build_state_prompt``
# reads it from ``input_data.state`` and prepends a system-style line so
# the LLM sees the user's preferred name / tone / language / interests on
# every turn. The agent in turn uses ``set_notes`` to mutate
# ``state["notes"]``; ``notes_state_from_args`` emits a ``StateSnapshotEvent``
# so the UI re-renders the notes panel as soon as the tool fires.


@tool
def set_notes(notes: list[str]):
    """Replace the notes array in shared state with the full updated list.

    Use this whenever the user asks you to remember something, or when
    you have an observation about the user worth surfacing in the UI's
    notes panel. ALWAYS pass the FULL notes list (existing notes + any
    new ones), not a diff. Keep each note short (< 120 chars).

    Args:
        notes: The complete updated list of short note strings.

    Returns:
        Confirmation string for the LLM to summarise back to the user.
    """
    return f"Notes updated. Tracking {len(notes)} note(s)."


async def notes_state_from_args(context):
    """Emit a StateSnapshotEvent for the ``notes`` slot when ``set_notes`` fires.

    Mirrors ``sales_state_from_args`` shape — accept str-or-dict tool
    input, validate, return a snapshot dict for ag_ui_strands to publish.
    """
    raw_input = getattr(context, "tool_input", None)
    if raw_input is None:
        logger.warning("notes_state_from_args: context has no tool_input")
        return None

    tool_input = raw_input
    if isinstance(tool_input, str):
        try:
            tool_input = json.loads(tool_input)
        except json.JSONDecodeError as exc:
            logger.warning(
                "notes_state_from_args: malformed JSON tool input (%s); input excerpt: %s",
                exc,
                repr(raw_input)[:200],
            )
            return None

    if isinstance(tool_input, dict):
        notes_data = tool_input.get("notes")
    elif isinstance(tool_input, list):
        notes_data = tool_input
    else:
        logger.warning(
            "notes_state_from_args: unsupported tool_input type %s",
            type(tool_input).__name__,
        )
        return None

    if not isinstance(notes_data, list):
        return None

    cleaned: list[str] = []
    for n in notes_data:
        if isinstance(n, str):
            cleaned.append(n)
        else:
            cleaned.append(str(n))
    return {"notes": cleaned}


# ---- Sub-Agents demo ----------------------------------------------------
#
# A supervisor LLM (this top-level Strands Agent) delegates to three
# specialised sub-agents — research / writing / critique — exposed as
# ordinary @tool functions. Each sub-agent is a single-shot OpenAI call
# with its own system prompt; this mirrors the ``google-adk`` reference
# implementation (``subagents_agent.py``) rather than spinning up a full
# secondary Strands ``Agent`` per delegation, which is heavier than the
# demo needs.
#
# Every delegation appends a ``Delegation`` record to the per-thread
# scratchpad below, then ``subagent_state_from_result`` emits a
# ``StateSnapshotEvent`` so the UI's <DelegationLog/> reflects the new
# entry the moment the tool returns.


# @region[subagent-setup]
# Each sub-agent is a single-shot OpenAI completion driven by its own
# system prompt. They don't share memory or tools with the supervisor —
# the supervisor only sees the returned text. We keep the prompts in a
# dict (rather than spinning up a full secondary Strands ``Agent`` per
# delegation) because the demo only needs one round-trip per call.
_SUBAGENT_SYSTEM_PROMPTS: dict[str, str] = {
    "research_agent": (
        "You are a research sub-agent. Given a topic, produce a concise "
        "bulleted list of 3-5 key facts. No preamble, no closing."
    ),
    "writing_agent": (
        "You are a writing sub-agent. Given a brief and optional source "
        "facts, produce a polished 1-paragraph draft. Be clear and "
        "concrete. No preamble."
    ),
    "critique_agent": (
        "You are an editorial critique sub-agent. Given a draft, give "
        "2-3 crisp, actionable critiques. No preamble."
    ),
}
# @endregion[subagent-setup]


# Per-thread scratchpad of delegations. Keyed by ``thread_id``; the entry
# is the FULL ordered list of Delegation dicts the supervisor has produced
# so far in this run. ``state_from_result`` reads/writes this so it can
# return the full updated list to the UI on every delegation.
#
# Concurrency: ag_ui_strands runs one request per thread_id at a time, so
# no within-thread races. We still hold a lock so cross-thread access
# (which Python's GIL makes safe but PyPy / future GIL-removed CPython
# would not) is explicit.
_delegations_by_thread: dict[str, list[dict]] = {}
_delegations_lock = threading.Lock()


def _seed_delegations_from_state(thread_id: str, state) -> list[dict]:
    """Initialise the per-thread scratchpad from the inbound state.

    Called lazily from each delegation tool. The frontend persists
    ``state["delegations"]`` across runs via ``useAgent``, so a multi-turn
    conversation should APPEND to the prior list rather than overwriting
    it.
    """
    with _delegations_lock:
        if thread_id in _delegations_by_thread:
            return _delegations_by_thread[thread_id]
        seeded: list[dict] = []
        if isinstance(state, dict):
            existing = state.get("delegations")
            if isinstance(existing, list):
                seeded = [dict(d) for d in existing if isinstance(d, dict)]
        _delegations_by_thread[thread_id] = seeded
        return seeded


# Internal marker prepended to a sub-agent tool result when the underlying
# call failed. ``_make_subagent_state_from_result`` detects this prefix and
# records the Delegation entry with ``status: "failed"`` instead of
# "completed".
#
# Why a sentinel rather than `result_text.startswith("Error:")`?
#  - Strands wraps tool exceptions into a result whose first content item
#    text *does* start with "Error: " (see strands/tools/decorator.py and
#    strands/tools/executors/_executor.py), but ag_ui_strands' result
#    extraction (agent.py around line 654) only forwards the inner text /
#    parsed-JSON to ``state_from_result`` — the canonical
#    ``tool_result["status"] == "error"`` signal is dropped before our hook
#    sees it. That makes a string-prefix check fragile (e.g. cancellation
#    text "Tool cancelled by user", "Unknown tool: ..." don't start with
#    "Error:") and couples our success/failure classification to Strands'
#    error-text formatting, which is internal API.
#  - Catching the failure inside ``_run_subagent`` lets us classify before
#    Strands' wrapper ever runs, so the surface is fully under our control.
#  - Class-name-only message avoids leaking ``repr(exc)`` (which can
#    contain provider-specific error bodies, request IDs, etc.) into the UI.
_SUBAGENT_FAILURE_MARKER = "__SUBAGENT_FAILED__:"
# Sentinel for the legitimately-empty completion case. The sub-agent
# returned successfully but produced no content; we still want a
# "completed" Delegation entry rather than a confusing failure row, so we
# substitute a human-readable placeholder instead of raising.
_SUBAGENT_EMPTY_RESULT_TEXT = "(sub-agent returned no content)"


def _invoke_subagent_llm(system_prompt: str, task: str) -> str:
    """Run a single-shot OpenAI completion as a sub-agent.

    Raises ``RuntimeError`` only on transport / API failures. A successful
    call that legitimately returns empty content is logged at INFO and
    surfaced as a placeholder string rather than an exception, so the
    Delegation entry shows as "completed" with a clear message instead of
    the misleading "failed" status the previous "empty text" raise produced.
    """
    import openai as _openai_mod
    import httpx as _httpx_mod

    try:
        client = _openai_mod.OpenAI()
        response = client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": task},
            ],
        )
    except (_openai_mod.OpenAIError, _httpx_mod.HTTPError) as exc:
        logger.exception("sub-agent: OpenAI call failed")
        raise RuntimeError(
            f"sub-agent call failed: {exc.__class__.__name__}"
        ) from exc

    if not response.choices:
        raise RuntimeError("sub-agent returned no choices")
    content = response.choices[0].message.content or ""
    text = content.strip()
    if not text:
        logger.info(
            "sub-agent: OpenAI completion returned empty content; "
            "surfacing placeholder rather than failure"
        )
        return _SUBAGENT_EMPTY_RESULT_TEXT
    return text


def _run_subagent(name: str, task: str) -> str:
    """Tool body shared by all three subagent tools.

    Catches ``RuntimeError`` from ``_invoke_subagent_llm`` and converts the
    failure into a sentinel-prefixed string carrying only the exception
    class name. ``_make_subagent_state_from_result`` recognizes the
    sentinel and records ``status: "failed"`` on the Delegation entry.

    This intercepts the exception *before* Strands' tool-decorator wraps
    it into a generic ``status: "error"`` ToolResult — that wrapper format
    is internal API and is flattened by ag_ui_strands before reaching our
    state hook, so we cannot reliably read it from ``result_data`` alone.
    Doing the classification here keeps the failure signal end-to-end
    explicit.
    """
    system_prompt = _SUBAGENT_SYSTEM_PROMPTS[name]
    try:
        return _invoke_subagent_llm(system_prompt, task)
    except RuntimeError as exc:
        # Class-name only — never the message — to avoid leaking provider
        # error bodies, request IDs, or stack traces into the UI.
        return f"{_SUBAGENT_FAILURE_MARKER}{exc.__class__.__name__}"


# @region[supervisor-delegation-tools]
# Each @tool wraps a sub-agent invocation. The supervisor LLM "calls"
# these tools to delegate work; ``_run_subagent`` synchronously runs the
# matching sub-agent (a single-shot OpenAI completion), and the result
# string is returned to the supervisor as the tool result. The matching
# ``ToolBehavior(state_from_result=...)`` hook on each tool (registered
# in ``build_showcase_agent``) appends a Delegation entry to shared
# state so the UI's <DelegationLog/> reflects the call in real time.
@tool
def research_agent(task: str) -> str:
    """Delegate a research task to the research sub-agent.

    Use for: gathering facts, background, definitions, statistics.
    Returns a bulleted list of key facts as plain text.

    Args:
        task: The research brief to hand off.
    """
    return _run_subagent("research_agent", task)


@tool
def writing_agent(task: str) -> str:
    """Delegate a drafting task to the writing sub-agent.

    Use for: producing a polished paragraph, draft, or summary. Pass
    relevant facts from prior research inside ``task``.

    Args:
        task: The writing brief to hand off.
    """
    return _run_subagent("writing_agent", task)


@tool
def critique_agent(task: str) -> str:
    """Delegate a critique task to the critique sub-agent.

    Use for: reviewing a draft and suggesting concrete improvements.

    Args:
        task: The draft to critique.
    """
    return _run_subagent("critique_agent", task)
# @endregion[supervisor-delegation-tools]


def _make_subagent_state_from_result(sub_agent_name: str):
    """Factory for a ``state_from_result`` hook bound to a sub-agent name.

    Returns a coroutine function suitable for ``ToolBehavior.state_from_result``.
    On every successful delegation it appends a completed ``Delegation``
    entry to the per-thread scratchpad and returns the full updated list
    so ag_ui_strands emits a ``StateSnapshotEvent`` to the UI.
    """

    async def _hook(context):
        thread_id = getattr(getattr(context, "input_data", None), "thread_id", None) or "default"
        existing = _seed_delegations_from_state(thread_id, getattr(context.input_data, "state", None))

        # Pull the task argument out of tool_input.
        raw_input = getattr(context, "tool_input", None)
        tool_input = raw_input
        if isinstance(tool_input, str):
            try:
                tool_input = json.loads(tool_input)
            except json.JSONDecodeError:
                tool_input = {}
        task = ""
        if isinstance(tool_input, dict):
            task = str(tool_input.get("task") or "")

        # Result body — strands wraps the @tool return value as the result.
        # ``result_data`` is whatever Strands gave us; flatten common shapes.
        result_data = getattr(context, "result_data", None)
        result_text = _flatten_tool_result(result_data)

        # Failure detection: ``_run_subagent`` catches ``RuntimeError`` and
        # returns ``_SUBAGENT_FAILURE_MARKER`` + class name as the tool
        # result string. Any other path (success, empty-content placeholder)
        # is "completed". We deliberately do NOT fall back to a string-
        # prefix check on Strands' own error wrapping ("Error: ...") because
        # ag_ui_strands strips the canonical ``status`` field before our
        # hook sees the result, making any prefix check brittle. See the
        # ``_SUBAGENT_FAILURE_MARKER`` block above for the full rationale.
        if result_text.startswith(_SUBAGENT_FAILURE_MARKER):
            status = "failed"
            failure_class = result_text[len(_SUBAGENT_FAILURE_MARKER):].strip() or "RuntimeError"
            display_result = f"Sub-agent call failed ({failure_class})."
        else:
            status = "completed"
            display_result = result_text

        entry = {
            "id": str(uuid.uuid4()),
            "sub_agent": sub_agent_name,
            "task": task,
            "status": status,
            "result": display_result,
        }

        with _delegations_lock:
            updated = list(existing) + [entry]
            _delegations_by_thread[thread_id] = updated
            # Return a defensive copy so downstream merges can't mutate scratch.
            return {"delegations": [dict(d) for d in updated]}

    return _hook


def _flatten_tool_result(result_data) -> str:
    """Best-effort coercion of a Strands tool result to plain text."""
    if result_data is None:
        return ""
    if isinstance(result_data, str):
        return result_data
    if isinstance(result_data, list):
        # Strands often wraps results as ``[{"text": "..."}]``.
        parts: list[str] = []
        for item in result_data:
            if isinstance(item, dict):
                if "text" in item and isinstance(item["text"], str):
                    parts.append(item["text"])
            elif isinstance(item, str):
                parts.append(item)
        if parts:
            return "\n".join(parts)
    if isinstance(result_data, dict):
        if "text" in result_data and isinstance(result_data["text"], str):
            return result_data["text"]
        return json.dumps(result_data)
    return str(result_data)


# ---- State management ---------------------------------------------------


def _format_preferences_block(prefs: dict) -> Optional[str]:
    """Render the UI-supplied preferences as a system-style block.

    Returns ``None`` when the dict is empty so the caller can skip
    injection entirely. Mirrors ``langgraph-python``'s
    ``PreferencesInjectorMiddleware._build_prefs_message`` shape.
    """
    if not isinstance(prefs, dict) or not prefs:
        return None
    lines: list[str] = []
    if prefs.get("name"):
        lines.append(f"- Name: {prefs['name']}")
    if prefs.get("tone"):
        lines.append(f"- Preferred tone: {prefs['tone']}")
    if prefs.get("language"):
        lines.append(f"- Preferred language: {prefs['language']}")
    interests = prefs.get("interests") or []
    if isinstance(interests, list) and interests:
        lines.append(f"- Interests: {', '.join(str(i) for i in interests)}")
    if not lines:
        return None
    return (
        "The user has shared these preferences with you:\n"
        + "\n".join(lines)
        + "\nTailor every response to these preferences. Address the user "
        "by name when appropriate."
    )


def _recover_original_user_message(input_data) -> Optional[str]:
    """Extract the original user message for HITL continuation runs.

    When a frontend tool (HITL) completes, ag_ui_strands synthesizes a
    generic user message like ``"tool_name executed successfully with no
    return value."`` and passes it to the state_context_builder.  This
    synthetic message breaks aimock fixture matching which keys on the
    *original* user message (e.g. ``"trip to mars"``).

    We detect the continuation case — messages end with
    ``[assistant(tool_calls), tool]`` — and walk backwards to find the
    last *real* user message preceding the tool-call assistant turn.
    Returns ``None`` when the conversation is not a HITL continuation.
    """
    messages = getattr(input_data, "messages", None)
    if not messages or len(messages) < 3:
        return None

    # Check if messages end with [..., assistant(tool_calls), tool].
    # That pattern signals a HITL continuation run.
    last = messages[-1]
    second_last = messages[-2]
    if not (
        getattr(last, "role", None) == "tool"
        and getattr(second_last, "role", None) == "assistant"
        and getattr(second_last, "tool_calls", None)
    ):
        return None

    # Walk backwards from the assistant turn to find the real user message.
    for i in range(len(messages) - 3, -1, -1):
        msg = messages[i]
        if getattr(msg, "role", None) == "user":
            content = getattr(msg, "content", None)
            if isinstance(content, str) and content.strip():
                return content
            if isinstance(content, list):
                texts = [
                    p.get("text", "") if isinstance(p, dict) else str(p)
                    for p in content
                ]
                joined = " ".join(t for t in texts if t).strip()
                if joined:
                    return joined
    return None


def build_state_prompt(input_data, user_message: str) -> str:
    """Inject UI-owned shared state slots into the outgoing prompt.

    Handles every demo whose backend reads from ``state``:

    * ``shared-state-read-write`` — preferences (name, tone, language,
      interests) written by the UI via ``agent.setState``.
    * sales pipeline (legacy ``manage_sales_todos`` flow) — todos seeded
      by the agent and re-rendered in cards.

    For HITL continuation runs, the synthetic ``"tool_name executed
    successfully..."`` message is replaced with the original user message
    from the conversation history, so aimock fixture matching (which keys
    on ``userMessage``) continues to work across turns.

    All branches degrade to the original ``user_message`` when the
    relevant slot is missing.
    """
    # On HITL continuation runs, recover the real user message so aimock
    # can match the correct fixture (keyed on the original userMessage).
    recovered = _recover_original_user_message(input_data)
    if recovered is not None:
        user_message = recovered

    state_dict = getattr(input_data, "state", None)
    if not isinstance(state_dict, dict):
        return user_message

    blocks: list[str] = []

    prefs_block = _format_preferences_block(state_dict.get("preferences") or {})
    if prefs_block:
        blocks.append(prefs_block)

    if "todos" in state_dict:
        todos_json = json.dumps(state_dict["todos"], indent=2)
        blocks.append(f"Current sales pipeline:\n{todos_json}")

    if not blocks:
        return user_message

    return "\n\n".join(blocks) + f"\n\nUser request: {user_message}"


# Back-compat alias: tests / scripts may import the old name.
build_sales_prompt = build_state_prompt


async def sales_state_from_args(context):
    """Extract sales pipeline state from tool arguments.

    This function is called when manage_sales_todos tool is executed
    to emit a state snapshot to the UI.

    Args:
        context: ToolResultContext containing tool execution details

    Returns:
        dict: State snapshot with todos array, or None on error
    """
    # Pre-validate the shape with ``isinstance`` checks rather than relying
    # on try/except AttributeError. Exception-driven dispatch conflated
    # three very different failure modes (missing attribute, bad JSON, wrong
    # type) under a single log line and made reasoning about edge cases
    # (bare lists, ints, missing ``tool_input``) harder than it needed to
    # be. Explicit isinstance gates make each rejection branch visible and
    # narrowly logged.
    raw_input = getattr(context, "tool_input", None)
    if raw_input is None:
        logger.warning(
            "sales_state_from_args: context has no tool_input attribute"
        )
        return None

    tool_input = raw_input
    if isinstance(tool_input, str):
        try:
            tool_input = json.loads(tool_input)
        except json.JSONDecodeError as exc:
            excerpt = repr(raw_input)[:200]
            logger.warning(
                "sales_state_from_args: malformed JSON tool input (%s); input excerpt: %s",
                exc,
                excerpt,
            )
            return None

    # Normalize to a todos list via shape-directed dispatch.
    if isinstance(tool_input, dict):
        todos_data = tool_input.get("todos", tool_input)
    elif isinstance(tool_input, list):
        todos_data = tool_input
    else:
        excerpt = repr(raw_input)[:200]
        logger.warning(
            "sales_state_from_args: unsupported tool_input type %s; input excerpt: %s",
            type(tool_input).__name__,
            excerpt,
        )
        return None

    if not isinstance(todos_data, list):
        return None

    processed = manage_sales_todos_impl(todos_data)
    return {"todos": [dict(t) for t in processed]}


# ---- Loop guard ---------------------------------------------------------

# Upstream strands Agent has no max-iterations knob, so we enforce one via a
# BeforeToolCallEvent hook. This protects against two real failure modes:
#   1. LLM fixation loops (e.g. aimock's fuzzy ``userMessage: "weather"``
#      fixture returns the same get_weather tool call on every cycle because
#      the last user message in history never changes, causing unbounded
#      recursion).
#   2. Genuine model confusion / looping behavior at provider level.
# When the cap is reached, we cancel the tool call which surfaces as a benign
# error tool result and lets the model resolve with a text turn.
#
# 8 = generous headroom for multi-step workflows (lookup -> calc -> save)
# while preventing runaway tool loops on prompt-injection edge cases.
# Observed p95 of legitimate sessions is 4-5 calls. Can be overridden via
# the ``STRANDS_TOOL_CALL_CAP`` env var (parity with spring-ai's
# ``copilotkit.tool.max-iterations``); invalid values fall back to the
# default with a warning.
_DEFAULT_MAX_TOOL_CALLS_PER_INVOCATION = 8


def _resolve_tool_call_cap() -> int:
    """Read ``STRANDS_TOOL_CALL_CAP`` with a sane default + fallback.

    Invalid (non-int or <1) values log a warning and fall back to the
    default rather than raising — this is read at module import time, and
    a misconfigured env var shouldn't brick the whole showcase.
    """
    raw = os.getenv("STRANDS_TOOL_CALL_CAP")
    if raw is None or raw == "":
        return _DEFAULT_MAX_TOOL_CALLS_PER_INVOCATION
    try:
        value = int(raw)
    except (TypeError, ValueError):
        logger.warning(
            "STRANDS_TOOL_CALL_CAP=%r is not an integer; falling back to default %d",
            raw,
            _DEFAULT_MAX_TOOL_CALLS_PER_INVOCATION,
        )
        return _DEFAULT_MAX_TOOL_CALLS_PER_INVOCATION
    if value < 1:
        logger.warning(
            "STRANDS_TOOL_CALL_CAP=%d is < 1; falling back to default %d",
            value,
            _DEFAULT_MAX_TOOL_CALLS_PER_INVOCATION,
        )
        return _DEFAULT_MAX_TOOL_CALLS_PER_INVOCATION
    return value


_MAX_TOOL_CALLS_PER_INVOCATION = _resolve_tool_call_cap()


class _ToolCallCapHook(HookProvider):
    """Cap total tool calls per Agent invocation to prevent runaway loops.

    Two-mechanism halt, with an intentional off-by-one split:

    * ``_on_before_tool`` uses ``>`` (strict greater-than). It cancels the
      *(N+1)-th* call — i.e. the first call that would exceed the cap is
      refused. Calls 1..N all run normally.
    * ``_on_after_tool`` uses ``>=`` (greater-than-or-equal). It sets the
      ``stop_event_loop`` sentinel as soon as ``_count`` reaches the cap,
      which is *one call earlier* than the cancellation fires.

    Why the asymmetry? We want the final *permitted* call (the N-th) to
    run to completion and produce a real result, THEN halt the event loop
    before the model can issue an (N+1)-th call that would only be
    cancelled. The sentinel halts cleanly; the cancellation is a backstop
    for the case where strands doesn't honor the sentinel (e.g. because
    the tool dispatch was already in flight when the sentinel was set).

    Concurrency note: ``_HookInjectingAgentDict`` enforces one
    ``_ToolCallCapHook`` per ``Agent`` instance (via the
    ``_CAP_HOOK_SENTINEL_ATTR`` guard in ``_inject_cap_hook``); ag_ui_strands
    happens to construct one Agent per ``thread_id``, so in practice that
    is also the per-thread granularity — but the invariant this hook
    depends on is per-Agent, not per-thread. A single AG-UI thread is
    invoked sequentially (one request at a time), so under normal use there
    is no concurrent access to ``_count``. We still hold a lock around
    mutations defensively because (a) strands may dispatch tool execution
    onto its own ThreadPoolExecutor and (b) misuse (e.g. two concurrent
    requests on the same thread_id) should degrade gracefully rather than
    race silently.
    """

    def __init__(self, max_calls: int = _MAX_TOOL_CALLS_PER_INVOCATION):
        # Validate up front: ``max_calls=0`` would silently cancel every
        # tool call (since ``_count`` starts at 0 and ``_on_before_tool``
        # increments-then-compares with ``>``; the first call goes to 1 > 0
        # and is cancelled). Negative values are even more broken.
        if max_calls < 1:
            raise ValueError("max_calls must be >= 1")
        self._max_calls = max_calls
        self._count = 0
        self._lock = threading.Lock()

    def register_hooks(self, registry: HookRegistry, **_: object) -> None:
        registry.add_callback(BeforeInvocationEvent, self._on_invocation_start)
        registry.add_callback(BeforeToolCallEvent, self._on_before_tool)
        registry.add_callback(AfterToolCallEvent, self._on_after_tool)

    def _on_invocation_start(self, _event: BeforeInvocationEvent) -> None:
        with self._lock:
            self._count = 0

    def _on_before_tool(self, event: BeforeToolCallEvent) -> None:
        with self._lock:
            self._count += 1
            current = self._count
        if current > self._max_calls:
            logger.warning(
                "tool call cap reached after %d calls (max=%d); cancelling tool call to break loop",
                current,
                self._max_calls,
            )
            event.cancel_tool = (
                f"Tool call cap reached ({self._max_calls}). "
                "Respond to the user with the information you already have."
            )

    def _on_after_tool(self, event: AfterToolCallEvent) -> None:
        # Once we've hit the cap, force the event loop to stop after this
        # tool's cancellation result is appended. Strands checks
        # ``request_state["stop_event_loop"]`` at the end of each cycle.
        with self._lock:
            current = self._count
        if current >= self._max_calls:
            request_state = event.invocation_state.setdefault("request_state", {})
            request_state["stop_event_loop"] = True


# ---- Per-thread hook injection -----------------------------------------

# ag_ui_strands constructs a fresh Agent per thread_id from the template and
# does NOT copy hooks (see site-packages/ag_ui_strands/agent.py). We patch the
# per-thread dict so every Agent instance it constructs gets its own
# ``_ToolCallCapHook`` attached before the first invocation. The hook keeps
# per-instance state (call count), so we give each thread its own instance.
#
# We subclass ``dict`` and override every mutation entry-point (``__setitem__``,
# ``update``, ``setdefault``, ``__ior__``) to ensure hook injection happens
# unconditionally, regardless of how ag_ui_strands populates the mapping.
# ``dict.update`` with a non-Mapping iterable-of-pairs DOES call ``__setitem__``
# in CPython, but ``setdefault``, ``|=``, ``|``, and ``|=``-on-ChainMap-like
# inputs do NOT. Override all four to keep the hook-injection invariant
# uniform across mutation vectors.


_CAP_HOOK_SENTINEL_ATTR = "_cap_hook_attached"


def _agent_has_cap_hook(agent: Agent) -> bool:
    """Return True if ``agent`` already has a ``_ToolCallCapHook`` registered.

    Used to guard against double-injection when the same ``thread_id`` is
    re-inserted (otherwise a second hook would effectively halve the cap).

    We attach a sentinel attribute directly to the Agent rather than
    inspecting HookRegistry privates (``_hook_providers``/``hook_providers``).
    Spelunking private attrs means any upstream rename silently reintroduces
    double-injection; the sentinel we control is robust to HookRegistry
    refactoring.
    """
    return bool(getattr(agent, _CAP_HOOK_SENTINEL_ATTR, False))


def _inject_cap_hook(agent: Agent) -> None:
    """Attach a fresh ``_ToolCallCapHook`` unless one is already present."""
    if _agent_has_cap_hook(agent):
        return
    agent.hooks.add_hook(_ToolCallCapHook())
    # Mark the agent after successful registration so re-inserts into the
    # per-thread dict skip this branch.
    setattr(agent, _CAP_HOOK_SENTINEL_ATTR, True)


class _HookInjectingAgentDict(dict):
    """``dict`` subclass that attaches a ``_ToolCallCapHook`` to every inserted Agent.

    All mutation paths (``__setitem__``, ``update``, ``setdefault``, ``__ior__``)
    are overridden so hook injection cannot be bypassed by CPython's bulk
    update C paths.
    """

    def __setitem__(self, key, value):
        if isinstance(value, Agent):
            _inject_cap_hook(value)
        super().__setitem__(key, value)

    def update(self, *args, **kwargs):  # type: ignore[override]
        # Normalize all inputs to (key, value) pairs and route through
        # ``self[key] = value`` so our injection logic runs uniformly.
        #
        # For ``Mapping`` subtypes we iterate ``.items()`` rather than
        # ``.keys()`` + subscript. The latter calls ``__getitem__`` a second
        # time per key — which for arbitrary ``collections.abc.Mapping``
        # implementations (e.g. ``ChainMap``, proxy objects, lazy views)
        # may be expensive or semantically different from the key-view
        # iteration. ``.items()`` guarantees a single fetch of each pair.
        if args:
            if len(args) > 1:
                raise TypeError(
                    f"update expected at most 1 positional argument, got {len(args)}"
                )
            other = args[0]
            if isinstance(other, Mapping):
                for k, v in other.items():
                    self[k] = v
            elif hasattr(other, "keys"):
                # Duck-typed mapping-like without registering as Mapping
                # (e.g. some dict-views). Keep the legacy path for
                # compatibility.
                for k in other.keys():
                    self[k] = other[k]
            else:
                for k, v in other:
                    self[k] = v
        for k, v in kwargs.items():
            self[k] = v

    def setdefault(self, key, default=None):  # type: ignore[override]
        if key not in self:
            self[key] = default
        return self[key]

    def __ior__(self, other):  # type: ignore[override]
        self.update(other)
        return self

    def __or__(self, other):  # type: ignore[override]
        # ``dict | other`` returns a new dict; preserve injection semantics.
        new = _HookInjectingAgentDict(self)
        new.update(other)
        return new

    def __ror__(self, other):  # type: ignore[override]
        # ``plain_dict | hook_dict`` invokes ``plain_dict.__or__(hook_dict)``
        # first, which returns a plain ``dict`` — losing our hook injection
        # semantics. Python falls back to ``hook_dict.__ror__(plain_dict)``
        # only when ``__or__`` returns ``NotImplemented``, which plain dicts
        # don't do for dict-subclass RHS. Defining ``__ror__`` still matters
        # for the case where ``other`` is a type whose ``__or__`` returns
        # ``NotImplemented`` (custom mappings, etc.), and documents the
        # intended semantics: the RESULT of merging into a
        # ``_HookInjectingAgentDict`` must itself be one, with every Agent
        # value getting its hook.
        new = _HookInjectingAgentDict()
        new.update(other)
        new.update(self)
        return new


# ---- Factory ------------------------------------------------------------


def _build_model() -> OpenAIModel:
    """Construct the OpenAI model, failing fast on missing credentials."""
    api_key = os.getenv("OPENAI_API_KEY", "")
    if not api_key:
        raise RuntimeError(
            "OPENAI_API_KEY must be set for the strands showcase agent"
        )
    return OpenAIModel(
        client_args={"api_key": api_key},
        model_id="gpt-4o",
    )


SYSTEM_PROMPT = (
    "You are a polished, professional demo assistant for CopilotKit. "
    "Keep responses brief and clear -- 1 to 2 sentences max.\n\n"
    "You can:\n"
    "- Chat naturally with the user\n"
    "- Change the UI background when asked (via frontend tool)\n"
    "- Query data and render charts (via query_data tool)\n"
    "- Get weather information (via get_weather tool)\n"
    "- Schedule meetings with the user (via schedule_meeting tool -- the user picks a time in the UI)\n"
    "- Manage sales pipeline todos (via manage_sales_todos / get_sales_todos tools)\n"
    "- Search flights and display rich A2UI cards (via search_flights tool)\n"
    "- Generate dynamic A2UI dashboards from conversation context (via generate_a2ui tool)\n"
    "- Generate step-by-step plans for user review (human-in-the-loop)\n"
    "- Remember things the user tells you by calling `set_notes` with the FULL "
    "updated list of short note strings (existing notes + new). The UI "
    "renders these in a notes panel.\n"
    "- Delegate work to specialised sub-agents when the user asks for "
    "research, drafting, or critique. Tools: `research_agent`, "
    "`writing_agent`, `critique_agent`. For non-trivial deliverables "
    "delegate in sequence research -> write -> critique. Pass relevant "
    "facts/draft through the `task` argument. The UI renders a live log "
    "of every delegation.\n"
    "When discussing the sales pipeline, ALWAYS use the get_sales_todos tool to see the current list before "
    "mentioning, updating, or discussing todos with the user.\n"
    "When the user shares preferences (name, tone, language, interests), they will be "
    "supplied in a system-style block at the top of every turn — respect them."
)


def build_showcase_agent(
    model: Optional[OpenAIModel] = None,
) -> _MessagesSnapshotWrapper:
    """Construct the ``StrandsAgent`` used by the showcase server.

    Wrapping construction in a factory keeps all module-level side effects
    (env-var reads, model initialization, per-thread hook patching) out of
    import time, so failures surface at a single well-defined call site
    (``agent_server.py``) rather than at arbitrary import order.
    """
    resolved_model = model if model is not None else _build_model()

    shared_state_config = StrandsAgentConfig(
        state_context_builder=build_state_prompt,
        tool_behaviors={
            "manage_sales_todos": ToolBehavior(
                skip_messages_snapshot=True,
                state_from_args=sales_state_from_args,
            ),
            # get_weather is used by the tool-rendering demo. The frontend
            # renders a weather card from the tool result via useRenderTool.
            # There is no need for the agent to continue streaming a text
            # summary afterwards -- the card IS the response. Halting after
            # the first tool result also protects against upstream LLM/mock
            # loops (e.g. aimock's fuzzy fixture matching on "weather"
            # returns the same get_weather tool call every turn, which would
            # otherwise recurse indefinitely).
            "get_weather": ToolBehavior(
                stop_streaming_after_result=True,
            ),
            # Shared State (Read + Write) — the agent writes notes to
            # `state["notes"]` via the `set_notes` tool. Emit a snapshot
            # the moment the tool fires so the UI's NotesCard re-renders
            # without waiting for the full text-response to stream.
            "set_notes": ToolBehavior(
                state_from_args=notes_state_from_args,
            ),
            # Sub-Agents — every delegation appends to
            # `state["delegations"]`. Use `state_from_result` rather than
            # `state_from_args` so the entry carries the sub-agent's
            # actual output (final, "completed") rather than a stub
            # "running" row that needs a follow-up update.
            "research_agent": ToolBehavior(
                state_from_result=_make_subagent_state_from_result("research_agent"),
            ),
            "writing_agent": ToolBehavior(
                state_from_result=_make_subagent_state_from_result("writing_agent"),
            ),
            "critique_agent": ToolBehavior(
                state_from_result=_make_subagent_state_from_result("critique_agent"),
            ),
        },
    )

    strands_agent = Agent(
        model=resolved_model,
        system_prompt=SYSTEM_PROMPT,
        tools=[
            get_sales_todos,
            manage_sales_todos,
            get_weather,
            query_data,
            schedule_meeting,
            search_flights,
            generate_a2ui,
            set_theme_color,
            set_notes,
            research_agent,
            writing_agent,
            critique_agent,
        ],
    )

    agui_agent = StrandsAgent(
        agent=strands_agent,
        name="strands_agent",
        description="A sales assistant that collaborates with you to manage a sales pipeline",
        config=shared_state_config,
    )

    # Replace the per-thread agent dict with our hook-injecting variant.
    # Preserve any entries ag_ui_strands created in ``__init__`` by copying
    # them into the new dict first (which re-runs injection to guarantee
    # every existing Agent also has the cap hook attached).
    existing = getattr(agui_agent, "_agents_by_thread", None) or {}
    hook_dict = _HookInjectingAgentDict()
    if existing:
        hook_dict.update(existing)
    agui_agent._agents_by_thread = hook_dict

    # Wrap with MessagesSnapshot injection so the CopilotKit frontend
    # can build its message tree from tool-call responses. See the
    # class docstring for why this is needed.
    return _MessagesSnapshotWrapper(agui_agent)
