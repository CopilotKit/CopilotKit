"""CrewAI Flow backing the Tool Rendering demo.

The default ``ChatWithCrewFlow`` (used for the catch-all
``LatestAiDevelopment`` crew on "/") executes backend tools internally
without emitting AG-UI ``TOOL_CALL_START`` / ``TOOL_CALL_END`` events.
The frontend's ``useRenderTool`` hook never sees the tool call and
therefore never renders the WeatherCard.

This module bypasses the crew flow and uses a raw CrewAI ``Flow`` with
``copilotkit_stream`` -- which DOES emit AG-UI tool-call events for
every tool call in the LLM response -- so the frontend receives the
tool call and the registered ``useRenderTool`` renderer fires.

The flow mirrors the LangGraph-Python reference: it makes LLM calls in
a loop, executing backend tools (``get_weather``) locally and streaming
every response (text or tool call) through ``copilotkit_stream``.
"""

from __future__ import annotations

import json
import uuid
from typing import List, Optional

from crewai.flow.flow import Flow, start
from litellm import acompletion
from pydantic import Field

from ag_ui_crewai import CopilotKitState, copilotkit_stream

from tools import get_weather_impl


# ---------------------------------------------------------------------------
# State
# ---------------------------------------------------------------------------


class ToolRenderingState(CopilotKitState):
    """Minimal state -- just the conversation messages."""

    pass


# ---------------------------------------------------------------------------
# Tool schema (LiteLLM/OpenAI tool format)
# ---------------------------------------------------------------------------

GET_WEATHER_TOOL = {
    "type": "function",
    "function": {
        "name": "get_weather",
        "description": (
            "Get current weather for a location.  Always call this tool "
            "when the user asks about weather.  Ensure the location is "
            "fully spelled out (e.g. 'San Francisco', not 'SF')."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "location": {
                    "type": "string",
                    "description": "The city or location to get weather for.",
                }
            },
            "required": ["location"],
        },
    },
}


# ---------------------------------------------------------------------------
# Flow
# ---------------------------------------------------------------------------

_SYSTEM_PROMPT = (
    "You are a helpful, concise weather assistant.  When the user asks "
    "about weather for a location, call the `get_weather` tool with the "
    "location.  After receiving the tool result, summarise the weather "
    "in a short sentence."
)

# Maximum LLM round-trips per user turn (prevents infinite loops).
_MAX_ITERATIONS = 5


class ToolRenderingFlow(Flow[ToolRenderingState]):
    """Chat flow that streams tool calls to the frontend for rendering."""

    @start()
    async def chat(self) -> None:
        system_message = {
            "role": "system",
            "content": _SYSTEM_PROMPT,
            "id": str(uuid.uuid4()) + "-system",
        }

        # Frontend-registered actions + our backend get_weather tool.
        tools = [
            *self.state.copilotkit.actions,
            GET_WEATHER_TOOL,
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
                # No tool calls -- the LLM produced a text response.
                return

            for tool_call in tool_calls:
                tool_call_id = tool_call["id"]
                tool_name = tool_call["function"]["name"]

                if tool_name == "get_weather":
                    try:
                        args = json.loads(tool_call["function"]["arguments"] or "{}")
                    except json.JSONDecodeError:
                        args = {}
                    location = args.get("location", "Unknown")
                    result = get_weather_impl(location)
                    result_str = json.dumps(result)

                    self.state.messages.append(
                        {
                            "role": "tool",
                            "content": result_str,
                            "tool_call_id": tool_call_id,
                        }
                    )
                else:
                    # Frontend-registered action -- placeholder result.
                    self.state.messages.append(
                        {
                            "role": "tool",
                            "content": "frontend tool -- handled client-side",
                            "tool_call_id": tool_call_id,
                        }
                    )

            # Loop back to call the LLM again with the tool results.


# Module-level singleton -- deepcopied per request by the endpoint.
tool_rendering_flow = ToolRenderingFlow()
