"""
CopilotKit + Google ADK integration demo agent.
"""

from __future__ import annotations

import json
import os
from typing import Optional

import httpx
from ag_ui_adk import ADKAgent, AGUIToolset, add_adk_fastapi_endpoint
from dotenv import load_dotenv
from fastapi import FastAPI
from google.adk.agents import LlmAgent
from google.adk.agents.callback_context import CallbackContext
from google.adk.models.llm_request import LlmRequest
from google.adk.models.llm_response import LlmResponse
from google.genai import types

from src.form import generate_form
from src.query import query_data
from src.todos import get_todos, manage_todos

load_dotenv(dotenv_path="../../.env")

# Workaround for ag_ui_adk bug: types.Schema.model_validate rejects
# the $schema field that CopilotKit sends in frontend tool schemas.
# Patch _get_declaration to strip $schema before validation.
import ag_ui_adk.client_proxy_tool as _cpt

_orig_get_declaration = _cpt.ClientProxyTool._get_declaration

def _patched_get_declaration(self):
    parameters = self.ag_ui_tool.parameters
    if isinstance(parameters, dict):
        parameters = {k: v for k, v in parameters.items() if k != "$schema"}
        self.ag_ui_tool.parameters = parameters
    return _orig_get_declaration(self)

_cpt.ClientProxyTool._get_declaration = _patched_get_declaration


def get_weather_condition(code: int) -> str:
    conditions = {
        0: "Clear sky", 1: "Mainly clear", 2: "Partly cloudy", 3: "Overcast",
        45: "Foggy", 48: "Depositing rime fog",
        51: "Light drizzle", 53: "Moderate drizzle", 55: "Dense drizzle",
        56: "Light freezing drizzle", 57: "Dense freezing drizzle",
        61: "Slight rain", 63: "Moderate rain", 65: "Heavy rain",
        66: "Light freezing rain", 67: "Heavy freezing rain",
        71: "Slight snow fall", 73: "Moderate snow fall", 75: "Heavy snow fall",
        77: "Snow grains",
        80: "Slight rain showers", 81: "Moderate rain showers", 82: "Violent rain showers",
        85: "Slight snow showers", 86: "Heavy snow showers",
        95: "Thunderstorm", 96: "Thunderstorm with slight hail", 99: "Thunderstorm with heavy hail",
    }
    return conditions.get(code, "Unknown")


async def get_weather(location: str) -> dict:
    """Get current weather for a location.

    Args:
        location: City name.

    Returns:
        Dictionary with weather information.
    """
    async with httpx.AsyncClient() as client:
        geocoding_url = f"https://geocoding-api.open-meteo.com/v1/search?name={location}&count=1"
        geocoding_response = await client.get(geocoding_url)
        geocoding_data = geocoding_response.json()

        if not geocoding_data.get("results"):
            raise ValueError(f"Location '{location}' not found")

        result = geocoding_data["results"][0]
        latitude, longitude, name = result["latitude"], result["longitude"], result["name"]

        weather_url = (
            f"https://api.open-meteo.com/v1/forecast?"
            f"latitude={latitude}&longitude={longitude}"
            f"&current=temperature_2m,apparent_temperature,relative_humidity_2m,"
            f"wind_speed_10m,wind_gusts_10m,weather_code"
        )
        weather_response = await client.get(weather_url)
        current = weather_response.json()["current"]

        return {
            "temperature": current["temperature_2m"],
            "feelsLike": current["apparent_temperature"],
            "humidity": current["relative_humidity_2m"],
            "windSpeed": current["wind_speed_10m"],
            "windGust": current["wind_gusts_10m"],
            "conditions": get_weather_condition(current["weather_code"]),
            "location": name,
        }


def on_before_agent(callback_context: CallbackContext):
    """Initialize todos state if it doesn't exist."""
    if "todos" not in callback_context.state:
        callback_context.state["todos"] = []
    return None


def before_model_modifier(
    callback_context: CallbackContext, llm_request: LlmRequest
) -> Optional[LlmResponse]:
    """Inject current todos state into the system prompt."""
    todos_json = json.dumps(callback_context.state.get("todos", []), indent=2)

    original_instruction = llm_request.config.system_instruction or types.Content(
        role="system", parts=[]
    )
    if not isinstance(original_instruction, types.Content):
        original_instruction = types.Content(
            role="system", parts=[types.Part(text=str(original_instruction))]
        )
    if not original_instruction.parts:
        original_instruction.parts = [types.Part(text="")]

    prefix = f"Current todos state: {todos_json}\n\n"
    original_instruction.parts[0].text = prefix + (original_instruction.parts[0].text or "")
    llm_request.config.system_instruction = original_instruction
    return None


def after_model_modifier(
    callback_context: CallbackContext, llm_response: LlmResponse
) -> Optional[LlmResponse]:
    """Stop consecutive tool calling when the agent produces a text response."""
    if llm_response.content and llm_response.content.parts:
        if (
            llm_response.content.role == "model"
            and llm_response.content.parts[0].text
        ):
            callback_context._invocation_context.end_invocation = True
    return None


agent = LlmAgent(
    name="assistant",
    model="gemini-2.5-flash",
    instruction="""You are a polished, professional demo assistant using CopilotKit and Google ADK.

Keep responses brief and polished — 1 to 2 sentences max. No verbose explanations.

You have access to several tools:
- get_weather: Fetch current weather data for any location.
- query_data: Query financial data from a database. Always call this before showing charts or graphs.
- generate_form: Generate an event registration form using declarative UI.
- manage_todos: Update the todo list. Always pass the COMPLETE list of todos.
- get_todos: Get the current list of todos.

When demonstrating charts, always call the query_data tool to fetch data first.
When asked to manage todos, enable app mode first, then manage todos.""",
    tools=[
        AGUIToolset(),
        get_weather,
        query_data,
        generate_form,
        manage_todos,
        get_todos,
    ],
    before_agent_callback=on_before_agent,
    before_model_callback=before_model_modifier,
    after_model_callback=after_model_modifier,
)

adk_agent = ADKAgent(
    adk_agent=agent,
    app_name="demo_app",
    user_id="demo_user",
    session_timeout_seconds=3600,
    use_in_memory_services=True,
)

app = FastAPI(title="CopilotKit ADK Agent")
add_adk_fastapi_endpoint(app, adk_agent, path="/")

if __name__ == "__main__":
    import uvicorn

    port = int(os.getenv("PORT", "8000"))
    uvicorn.run(app, host="0.0.0.0", port=port)
