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
import sys
import threading
from collections.abc import Mapping
from typing import Optional, TypedDict

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

# Import shared tool implementations
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "..", "..", "shared", "python"))
from tools import (  # noqa: E402
    get_weather_impl,
    query_data_impl,
    manage_sales_todos_impl,
    schedule_meeting_impl,
    search_flights_impl,
    build_a2ui_operations_from_tool_call,
)

logger = logging.getLogger(__name__)


class _A2uiError(TypedDict):
    """Shape of the structured error dict returned by generate_a2ui branches.

    Mirrors the google-adk sibling agent's error shape. Every error branch
    MUST populate all three keys so callers (and the LLM summarizing the
    tool result) see a consistent surface.
    """

    error: str
    message: str
    remediation: str


# ---- Tools --------------------------------------------------------------


@tool
def get_weather(location: str):
    """Get current weather for a location.

    Args:
        location: The location to get weather for

    Returns:
        Weather information as JSON string
    """
    return json.dumps(get_weather_impl(location))


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


@tool
def generate_a2ui(context: str):
    """Generate dynamic A2UI components based on the conversation.

    A secondary LLM designs the UI schema and data. The result is
    returned as an a2ui_operations container for the middleware to detect.

    Args:
        context: Conversation context to generate UI from

    Returns:
        A2UI operations as JSON string
    """
    from openai import OpenAI

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

    # Wrap the OpenAI call so raw APIError / RateLimitError /
    # APIConnectionError / AuthenticationError do NOT bubble up through the
    # strands tool machinery as uncaught exceptions. Return a structured
    # error with remediation instead — the LLM can surface this to the user.
    # Mirrors the google-adk sibling agent's error-handling shape.
    try:
        client = OpenAI()
        response = client.chat.completions.create(
            model="gpt-4.1",
            messages=[
                {"role": "system", "content": context or "Generate a useful dashboard UI."},
                {"role": "user", "content": "Generate a dynamic A2UI dashboard based on the conversation."},
            ],
            tools=[tool_schema],
            tool_choice={"type": "function", "function": {"name": "render_a2ui"}},
        )
    except Exception as exc:  # noqa: BLE001 — openai raises a variety of subclasses
        logger.exception("generate_a2ui: OpenAI API call failed")
        return json.dumps({
            "error": "a2ui_llm_error",
            "message": f"Secondary A2UI LLM call failed: {exc.__class__.__name__}",
            "remediation": (
                "Verify OPENAI_API_KEY is set and the OpenAI service is reachable. "
                "See server logs for the full traceback."
            ),
        })

    if not response.choices:
        logger.warning("generate_a2ui: OpenAI response contained no choices")
        return json.dumps({
            "error": "a2ui_empty_response",
            "message": "Secondary A2UI LLM returned no choices.",
            "remediation": "Retry; if this persists, check OpenAI status.",
        })

    tool_calls = response.choices[0].message.tool_calls
    if not tool_calls:
        logger.warning(
            "generate_a2ui: OpenAI response had no tool_calls despite forced tool_choice"
        )
        return json.dumps({
            "error": "a2ui_no_tool_call",
            "message": "Secondary A2UI LLM did not call render_a2ui.",
            "remediation": (
                "Retry the request. If this persists, verify the tool_choice "
                "schema matches the OpenAI API contract."
            ),
        })

    tool_call = tool_calls[0]
    try:
        args = json.loads(tool_call.function.arguments)
    except (ValueError, TypeError) as exc:
        logger.exception(
            "generate_a2ui: failed to parse render_a2ui tool arguments as JSON"
        )
        return json.dumps({
            "error": "a2ui_invalid_arguments",
            "message": f"Could not parse render_a2ui arguments: {exc}",
            "remediation": "Retry the request; the secondary LLM emitted malformed JSON.",
        })

    result = build_a2ui_operations_from_tool_call(args)
    return json.dumps(result)


@tool
def set_theme_color(theme_color: str):
    """Change the theme color of the UI.

    This is a frontend tool - it returns None as the actual
    execution happens on the frontend via useFrontendTool.

    Args:
        theme_color: The color to set as theme
    """
    return None


# ---- State management ---------------------------------------------------


def build_sales_prompt(input_data, user_message: str) -> str:
    """Inject the current sales pipeline state into the prompt."""
    state_dict = getattr(input_data, "state", None)
    if isinstance(state_dict, dict) and "todos" in state_dict:
        todos_json = json.dumps(state_dict["todos"], indent=2)
        return (
            f"Current sales pipeline:\n{todos_json}\n\nUser request: {user_message}"
        )
    return user_message


async def sales_state_from_args(context):
    """Extract sales pipeline state from tool arguments.

    This function is called when manage_sales_todos tool is executed
    to emit a state snapshot to the UI.

    Args:
        context: ToolResultContext containing tool execution details

    Returns:
        dict: State snapshot with todos array, or None on error
    """
    try:
        tool_input = context.tool_input
        if isinstance(tool_input, str):
            tool_input = json.loads(tool_input)

        todos_data = tool_input.get("todos", tool_input)

        # Process through shared implementation
        if isinstance(todos_data, list):
            processed = manage_sales_todos_impl(todos_data)
            return {"todos": [dict(t) for t in processed]}

        return None
    except (json.JSONDecodeError, AttributeError, TypeError) as exc:
        # Narrow to expected parse/access errors. Log at warning with a
        # truncated excerpt of the offending tool input for debuggability.
        raw_input = getattr(context, "tool_input", None)
        excerpt = repr(raw_input)[:200] if raw_input is not None else "<missing>"
        logger.warning(
            "sales_state_from_args: failed to parse tool input (%s: %s); input excerpt: %s",
            type(exc).__name__,
            exc,
            excerpt,
        )
        return None


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
_MAX_TOOL_CALLS_PER_INVOCATION = 8


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

    Concurrency note: ag_ui_strands creates one Agent (and therefore one
    ``_ToolCallCapHook``) per ``thread_id``. A single AG-UI thread is
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
# ``dict.update`` and friends bypass ``__setitem__`` in CPython's C paths, so
# a single ``__setitem__`` override is not sufficient.


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
    "When discussing the sales pipeline, ALWAYS use the get_sales_todos tool to see the current list before "
    "mentioning, updating, or discussing todos with the user."
)


def build_showcase_agent(
    model: Optional[OpenAIModel] = None,
) -> StrandsAgent:
    """Construct the ``StrandsAgent`` used by the showcase server.

    Wrapping construction in a factory keeps all module-level side effects
    (env-var reads, model initialization, per-thread hook patching) out of
    import time, so failures surface at a single well-defined call site
    (``agent_server.py``) rather than at arbitrary import order.
    """
    resolved_model = model if model is not None else _build_model()

    shared_state_config = StrandsAgentConfig(
        state_context_builder=build_sales_prompt,
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

    return agui_agent
