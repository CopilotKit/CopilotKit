"""
Strands agent with sales pipeline state, weather tool, and HITL support.

Adapted from examples/integrations/strands-python/agent/main.py
"""

import json
import os
import sys

from ag_ui_strands import (
    StrandsAgent,
    StrandsAgentConfig,
    ToolBehavior,
    create_strands_app,
)
from dotenv import load_dotenv
from pydantic import BaseModel, Field
from strands import Agent, tool
from strands.hooks import (
    AfterToolCallEvent,
    BeforeInvocationEvent,
    BeforeToolCallEvent,
    HookProvider,
    HookRegistry,
)
from strands.models.openai import OpenAIModel

load_dotenv()

# Import shared tool implementations
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "..", "..", "shared", "python"))
from tools import (
    get_weather_impl,
    query_data_impl,
    manage_sales_todos_impl,
    schedule_meeting_impl,
    search_flights_impl,
    build_a2ui_operations_from_tool_call,
)


# =====
# Tools
# =====
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

    client = OpenAI()
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

    response = client.chat.completions.create(
        model="gpt-4.1",
        messages=[
            {"role": "system", "content": context or "Generate a useful dashboard UI."},
            {"role": "user", "content": "Generate a dynamic A2UI dashboard based on the conversation."},
        ],
        tools=[tool_schema],
        tool_choice={"type": "function", "function": {"name": "render_a2ui"}},
    )

    if not response.choices[0].message.tool_calls:
        return json.dumps({"error": "LLM did not call render_a2ui"})

    tool_call = response.choices[0].message.tool_calls[0]
    args = json.loads(tool_call.function.arguments)
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


# =====
# State management
# =====
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
    except Exception:
        return None


# =====
# Loop guard
# =====
# Upstream strands Agent has no max-iterations knob, so we enforce one via a
# BeforeToolCallEvent hook. This protects against two real failure modes:
#   1. LLM fixation loops (e.g. aimock's fuzzy `userMessage: "weather"` fixture
#      returns the same get_weather tool call on every cycle because the last
#      user message in history never changes, causing unbounded recursion).
#   2. Genuine model confusion / looping behavior at provider level.
# When the cap is reached, we cancel the tool call which surfaces as a benign
# error tool result and lets the model resolve with a text turn.
_MAX_TOOL_CALLS_PER_INVOCATION = 8


class _ToolCallCapHook(HookProvider):
    """Cap total tool calls per Agent invocation to prevent runaway loops."""

    def __init__(self, max_calls: int = _MAX_TOOL_CALLS_PER_INVOCATION):
        self._max_calls = max_calls
        self._count = 0

    def register_hooks(self, registry: HookRegistry, **_: object) -> None:
        registry.add_callback(BeforeInvocationEvent, self._on_invocation_start)
        registry.add_callback(BeforeToolCallEvent, self._on_before_tool)
        registry.add_callback(AfterToolCallEvent, self._on_after_tool)

    def _on_invocation_start(self, _event: BeforeInvocationEvent) -> None:
        self._count = 0

    def _on_before_tool(self, event: BeforeToolCallEvent) -> None:
        self._count += 1
        if self._count > self._max_calls:
            event.cancel_tool = (
                f"Tool call cap reached ({self._max_calls}). "
                "Respond to the user with the information you already have."
            )

    def _on_after_tool(self, event: AfterToolCallEvent) -> None:
        # Once we've hit the cap, force the event loop to stop after this
        # tool's cancellation result is appended. Strands checks
        # `request_state["stop_event_loop"]` at the end of each cycle.
        if self._count >= self._max_calls:
            request_state = event.invocation_state.setdefault("request_state", {})
            request_state["stop_event_loop"] = True


# =====
# Agent configuration
# =====
shared_state_config = StrandsAgentConfig(
    state_context_builder=build_sales_prompt,
    tool_behaviors={
        "manage_sales_todos": ToolBehavior(
            skip_messages_snapshot=True,
            state_from_args=sales_state_from_args,
        ),
        # get_weather is used by the tool-rendering demo. The frontend renders
        # a weather card from the tool result via useRenderTool. There is no
        # need for the agent to continue streaming a text summary afterwards —
        # the card IS the response. Halting after the first tool result also
        # protects against upstream LLM/mock loops (e.g. aimock's fuzzy
        # fixture matching on "weather" returns the same get_weather tool
        # call every turn, which would otherwise recurse indefinitely).
        "get_weather": ToolBehavior(
            stop_streaming_after_result=True,
        ),
    },
)

# Initialize OpenAI model
api_key = os.getenv("OPENAI_API_KEY", "")
model = OpenAIModel(
    client_args={"api_key": api_key},
    model_id="gpt-4o",
)

system_prompt = (
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

# Create Strands agent with tools.
# The _ToolCallCapHook is attached to each per-thread Agent via
# _HookInjectingAgentDict below (ag_ui_strands doesn't copy hooks from the
# template when it spawns per-thread instances).
strands_agent = Agent(
    model=model,
    system_prompt=system_prompt,
    tools=[get_sales_todos, manage_sales_todos, get_weather, query_data, schedule_meeting, search_flights, generate_a2ui, set_theme_color],
)

# Wrap with AG-UI integration
agui_agent = StrandsAgent(
    agent=strands_agent,
    name="strands_agent",
    description="A sales assistant that collaborates with you to manage a sales pipeline",
    config=shared_state_config,
)


# ag_ui_strands constructs a fresh Agent per thread_id from the template and
# does NOT copy hooks (see site-packages/ag_ui_strands/agent.py). Patch the
# per-thread dict so every Agent instance it constructs gets its own
# _ToolCallCapHook attached before the first invocation. The hook keeps
# per-instance state (call count), so we give each thread its own instance.
class _HookInjectingAgentDict(dict):
    def __setitem__(self, key: str, value: Agent) -> None:
        value.hooks.add_hook(_ToolCallCapHook())
        super().__setitem__(key, value)


agui_agent._agents_by_thread = _HookInjectingAgentDict()
