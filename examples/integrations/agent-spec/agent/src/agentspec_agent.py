from __future__ import annotations

import os
from typing import Dict, Any

import dotenv
dotenv.load_dotenv()

from pyagentspec.agent import Agent
from pyagentspec.llms import OpenAiCompatibleConfig
from pyagentspec.tools import ServerTool, ClientTool
from pyagentspec.property import Property
from pyagentspec.serialization import AgentSpecSerializer


def get_weather(location: str) -> Dict[str, Any]:
    """
    Get the weather for a given location.
    """
    import time
    time.sleep(1)  # simulates real tool execution
    return {
        "temperature": 20,
        "conditions": "sunny",
        "humidity": 50,
        "wind_speed": 10,
        "feelsLike": 25,
    }


weather_tool = ServerTool(
    name="get_weather",
    description="Get the weather for a given location.",
    inputs=[
        Property(
            title="location",
            json_schema={
                "title": "location",
                "type": "string",
                "description": "The location to get the weather forecast. Must be a city/town name."
            },
        )],
    outputs=[
        Property(
            title="weather_result",
            json_schema={
                "title": "weather_result",
                "type": "string"
            },
        )],
)

go_to_moon_tool = ClientTool(
    name="go_to_moon",
    description="Go to the moon on request.",
)

setThemeColor_tool = ClientTool(
    name="setThemeColor",
    description="Change the theme color of the chat. Can be anything that the CSS background attribute accepts. Regular colors, linear of radial gradients etc.",
    inputs=[
        Property(
            title="themeColor",
            json_schema={
                "title": "themeColor",
                "type": "string",
                "description": "The theme color to set. Make sure to pick nice colors.",
            },
        )
    ],
)

with_agentspec_agent = Agent(
    name="AgentSpecAgent",
    description="A starter Agent that can call tools.",
    system_prompt="You are a helpful assistant, named Specky, that has access to some tools.",
    llm_config=OpenAiCompatibleConfig(
        name="with-agentspec-agent",
        model_id=os.getenv("OPENAI_MODEL", "gpt-4o"),
        url=os.getenv("OPENAI_BASE_URL", "https://api.openai.com/v1"),
    ),
    tools=[weather_tool, go_to_moon_tool, setThemeColor_tool],
)


with_agentspec_agent_json = AgentSpecSerializer().to_json(with_agentspec_agent)
