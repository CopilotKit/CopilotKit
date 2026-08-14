"""CrewAI Flow backing the A2UI Fixed-Schema demo.

Mirrors `langgraph-python/src/agents/a2ui_fixed.py` observable contract:

- Bind `display_flight` with `{origin, destination, airline, price}`.
- Execute it locally and return an `a2ui_operations` container
  (createSurface + updateComponents + updateDataModel).
- Stream the LLM turn through `copilotkit_stream` (TOOL_CALL_CHUNK)
  and then emit TOOL_CALL_RESULT with that container.

`ag_ui_crewai` 0.2.0 only bridges TEXT_MESSAGE_CHUNK and TOOL_CALL_CHUNK.
It never emits TOOL_CALL_RESULT after a local tool run. The runtime A2UI
middleware only paints `a2ui_operations` from TOOL_CALL_RESULT, so this
flow puts that event on the AG-UI queue itself.
"""

# @region[backend-render-operations]
# @region[backend-schema-json-load]
from __future__ import annotations

import json
import uuid
from pathlib import Path

from ag_ui.core import EventType, ToolCallResultEvent
from crewai.flow.flow import Flow, start
from litellm import acompletion

from ag_ui_crewai import CopilotKitState, copilotkit_stream
from ag_ui_crewai.endpoint import get_queue
from ag_ui_crewai.utils import yield_control


CATALOG_ID = "copilotkit://flight-fixed-catalog"
SURFACE_ID = "flight-fixed-schema"

_SCHEMAS_DIR = Path(__file__).parent / "a2ui_schemas"

# The schema is JSON so it can be authored and reviewed independently of the
# Python code. Loaded at import so the first request does not pay I/O.
with (_SCHEMAS_DIR / "flight_schema.json").open() as _fp:
    FLIGHT_SCHEMA = json.load(_fp)
# @endregion[backend-schema-json-load]


DISPLAY_FLIGHT_TOOL = {
    "type": "function",
    "function": {
        "name": "display_flight",
        "description": (
            "Show a flight card for the given trip. Use short airport codes "
            '(e.g. "SFO", "JFK") for origin/destination and a price string '
            'like "$289". After this tool returns, the flight card is already '
            "rendered to the user via the A2UI surface — do NOT call this "
            "tool again for the same flight. Reply with one short "
            "confirmation sentence and stop."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "origin": {
                    "type": "string",
                    "description": '3-letter airport code, e.g. "SFO".',
                },
                "destination": {
                    "type": "string",
                    "description": '3-letter airport code, e.g. "JFK".',
                },
                "airline": {
                    "type": "string",
                    "description": 'Airline name, e.g. "United".',
                },
                "price": {
                    "type": "string",
                    "description": 'Price string, e.g. "$289".',
                },
            },
            "required": ["origin", "destination", "airline", "price"],
        },
    },
}


def display_flight_operations(
    origin: str, destination: str, airline: str, price: str
) -> str:
    """LGP `a2ui.render(...)` shape: a2ui_operations v0.9 ops.

    Note: schema-swap-on-action (e.g. swapping to a "booked" schema when
    the card's button is clicked) will be added once the Python SDK
    exposes `action_handlers=` on `a2ui.render`.
    """
    ops = [
        {
            "version": "v0.9",
            "createSurface": {"surfaceId": SURFACE_ID, "catalogId": CATALOG_ID},
        },
        {
            "version": "v0.9",
            "updateComponents": {
                "surfaceId": SURFACE_ID,
                "components": FLIGHT_SCHEMA,
            },
        },
        {
            "version": "v0.9",
            "updateDataModel": {
                "surfaceId": SURFACE_ID,
                "path": "/",
                "value": {
                    "origin": origin,
                    "destination": destination,
                    "airline": airline,
                    "price": price,
                },
            },
        },
    ]
    return json.dumps({"a2ui_operations": ops})
    # @endregion[backend-render-operations]


async def _emit_tool_call_result(flow: object, tool_call_id: str, content: str) -> None:
    """Put TOOL_CALL_RESULT on the AG-UI queue for this flow.

    `copilotkit_stream` never emits this event. Without it the A2UI
    middleware never sees `a2ui_operations` and `a2ui-fixed-card` never
    mounts.
    """
    queue = get_queue(flow)
    if queue is None:
        return
    queue.put_nowait(
        ToolCallResultEvent(
            type=EventType.TOOL_CALL_RESULT,
            tool_call_id=tool_call_id,
            message_id=str(uuid.uuid4()),
            content=content,
            role="tool",
        )
    )
    await yield_control()


_SYSTEM_PROMPT = (
    "You help users find flights. When asked about a flight, call "
    "`display_flight` exactly ONCE with origin, destination, airline, "
    "and price. The tool's JSON return value is an A2UI surface "
    "descriptor — the flight card is already rendered to the user; do "
    "NOT call `display_flight` again for the same trip. After the tool "
    "returns, reply with one short confirmation sentence and stop."
)

_MAX_ITERATIONS = 5


class A2UIFixedState(CopilotKitState):
    """Conversation-only state for the fixed-schema flight card."""

    pass


class A2UIFixedFlow(Flow[A2UIFixedState]):
    """Chat flow that emits `display_flight` TOOL_CALL_* + a2ui ops."""

    @start()
    async def chat(self) -> None:
        system_message = {
            "role": "system",
            "content": _SYSTEM_PROMPT,
            "id": str(uuid.uuid4()) + "-system",
        }

        tools = [
            *self.state.copilotkit.actions,
            DISPLAY_FLIGHT_TOOL,
        ]

        for _iteration in range(_MAX_ITERATIONS):
            messages = [system_message, *self.state.messages]

            response = await copilotkit_stream(
                await acompletion(
                    model="openai/gpt-4o-mini",
                    messages=messages,
                    tools=tools,
                    parallel_tool_calls=False,
                    stream=True,
                )
            )

            message = response.choices[0].message
            self.state.messages.append(message)

            tool_calls = message.get("tool_calls") or []
            if not tool_calls:
                return

            for tool_call in tool_calls:
                tool_call_id = tool_call["id"]
                tool_name = tool_call["function"]["name"]

                if tool_name == "display_flight":
                    try:
                        args = json.loads(tool_call["function"]["arguments"] or "{}")
                    except json.JSONDecodeError:
                        args = {}
                    result_str = display_flight_operations(
                        origin=args.get("origin", ""),
                        destination=args.get("destination", ""),
                        airline=args.get("airline", ""),
                        price=args.get("price", ""),
                    )
                    self.state.messages.append(
                        {
                            "role": "tool",
                            "content": result_str,
                            "tool_call_id": tool_call_id,
                        }
                    )
                    await _emit_tool_call_result(self, tool_call_id, result_str)
                else:
                    # Frontend-registered action — placeholder so the
                    # next LLM turn has a matching tool result.
                    self.state.messages.append(
                        {
                            "role": "tool",
                            "content": "frontend tool -- handled client-side",
                            "tool_call_id": tool_call_id,
                        }
                    )


# Module-level singleton -- deepcopied per request by the endpoint.
a2ui_fixed_flow = A2UIFixedFlow()
