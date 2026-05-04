"""
Weather Agent (ADK + A2A Protocol)

This agent provides weather forecasts and travel weather advice.
It exposes an A2A Protocol endpoint and can be called by the orchestrator.

Features:
- Provides weather forecasts for travel destinations
- Returns structured JSON with weather predictions
- Helps travelers plan activities based on weather conditions
"""

import uvicorn
import os
import json
from typing import List
from dotenv import load_dotenv
from pydantic import BaseModel, Field

load_dotenv()

# A2A Protocol imports
from a2a.server.apps import A2AStarletteApplication
from a2a.server.request_handlers import DefaultRequestHandler
from a2a.server.tasks import InMemoryTaskStore
from a2a.types import (
    AgentCapabilities,
    AgentCard,
    AgentSkill,
)
from a2a.server.agent_execution import AgentExecutor, RequestContext
from a2a.server.events import EventQueue
from a2a.utils import new_agent_text_message

# Google ADK imports
from google.adk.agents.llm_agent import LlmAgent
from google.adk.runners import Runner
from google.adk.sessions import InMemorySessionService
from google.adk.memory.in_memory_memory_service import InMemoryMemoryService
from google.adk.artifacts import InMemoryArtifactService
from google.genai import types


class DailyWeather(BaseModel):
    day: int = Field(description="Day number")
    date: str = Field(description="Date (e.g., 'Dec 15')")
    condition: str = Field(description="Weather condition (e.g., 'Sunny', 'Rainy', 'Cloudy')")
    highTemp: int = Field(description="High temperature in Fahrenheit")
    lowTemp: int = Field(description="Low temperature in Fahrenheit")
    precipitation: int = Field(description="Chance of precipitation as percentage")
    humidity: int = Field(description="Humidity percentage")
    windSpeed: int = Field(description="Wind speed in mph")
    description: str = Field(description="Detailed weather description")


class StructuredWeather(BaseModel):
    destination: str = Field(description="Destination city/location")
    forecast: List[DailyWeather] = Field(description="Daily weather forecasts")
    travelAdvice: str = Field(description="Weather-based travel advice and what to pack")
    bestDays: List[int] = Field(description="Best days for outdoor activities based on weather")


class WeatherAgent:
    def __init__(self):
        self._agent = self._build_agent()
        self._user_id = 'remote_agent'
        self._runner = Runner(
            app_name=self._agent.name,
            agent=self._agent,
            artifact_service=InMemoryArtifactService(),
            session_service=InMemorySessionService(),
            memory_service=InMemoryMemoryService(),
        )

    def _build_agent(self) -> LlmAgent:
        model_name = os.getenv('GEMINI_MODEL', 'gemini-2.5-flash')

        return LlmAgent(
            model=model_name,
            name='weather_agent',
            description='An agent that provides weather forecasts and travel weather advice',
            instruction="""
You are a weather forecast agent for travelers. Your role is to provide realistic weather
predictions and help travelers prepare for weather conditions.

When you receive a request, analyze:
- The destination city/location
- Travel dates or trip duration
- Any specific weather concerns mentioned

Return ONLY a valid JSON object with this exact structure:
{
  "destination": "City Name",
  "forecast": [
    {
      "day": 1,
      "date": "Dec 15",
      "condition": "Sunny",
      "highTemp": 75,
      "lowTemp": 60,
      "precipitation": 10,
      "humidity": 45,
      "windSpeed": 8,
      "description": "Clear skies with pleasant temperatures, perfect for sightseeing"
    }
  ],
  "travelAdvice": "Pack light layers, sunscreen, and comfortable walking shoes. Evenings may be cool, so bring a light jacket.",
  "bestDays": [1, 3, 5]
}

Provide weather forecasts based on:
- Typical weather patterns for that destination and season
- Realistic temperature ranges
- Appropriate precipitation chances
- Helpful packing advice
- Identification of best days for outdoor activities

Make forecasts realistic for the destination's climate and current season.
Include helpful travel advice based on the weather conditions.

Return ONLY valid JSON, no markdown code blocks, no other text.
            """,
            tools=[],
        )

    async def invoke(self, query: str, session_id: str) -> str:
        session = await self._runner.session_service.get_session(
            app_name=self._agent.name,
            user_id=self._user_id,
            session_id=session_id,
        )

        content = types.Content(
            role='user', parts=[types.Part.from_text(text=query)]
        )

        if session is None:
            session = await self._runner.session_service.create_session(
                app_name=self._agent.name,
                user_id=self._user_id,
                state={},
                session_id=session_id,
            )

        response_text = ''
        async for event in self._runner.run_async(
            user_id=self._user_id,
            session_id=session.id,
            new_message=content
        ):
            if event.is_final_response():
                if (
                    event.content
                    and event.content.parts
                    and event.content.parts[0].text
                ):
                    response_text = '\n'.join(
                        [p.text for p in event.content.parts if p.text]
                    )
                break

        content_str = response_text.strip()

        if "```json" in content_str:
            content_str = content_str.split("```json")[1].split("```")[0].strip()
        elif "```" in content_str:
            content_str = content_str.split("```")[1].split("```")[0].strip()

        try:
            structured_data = json.loads(content_str)
            validated_weather = StructuredWeather(**structured_data)
            final_response = json.dumps(validated_weather.model_dump(), indent=2)
            print("✅ Successfully created structured weather forecast")
            return final_response
        except json.JSONDecodeError as e:
            print(f"❌ JSON parsing error: {e}")
            print(f"Content: {content_str}")
            return json.dumps({
                "error": "Failed to generate structured weather forecast",
                "raw_content": content_str[:200]
            })
        except Exception as e:
            print(f"❌ Validation error: {e}")
            return json.dumps({
                "error": f"Validation failed: {str(e)}"
            })


port = int(os.getenv("WEATHER_PORT", 9005))

skill = AgentSkill(
    id='weather_agent',
    name='Weather Forecast Agent',
    description='Provides weather forecasts and travel weather advice using ADK',
    tags=['travel', 'weather', 'forecast', 'climate', 'adk'],
    examples=[
        'What will the weather be like in Tokyo next week?',
        'Should I pack an umbrella for my Paris trip?',
        'Give me the weather forecast for my 5-day New York visit'
    ],
)

cardUrl = os.getenv("RENDER_EXTERNAL_URL", f"http://localhost:{port}")
public_agent_card = AgentCard(
    name='Weather Agent',
    description='ADK-powered agent that provides weather forecasts and packing advice for travelers',
    url=cardUrl,
    version='1.0.0',
    defaultInputModes=['text'],
    defaultOutputModes=['text'],
    capabilities=AgentCapabilities(streaming=True),
    skills=[skill],
    supportsAuthenticatedExtendedCard=False,
)


class WeatherAgentExecutor(AgentExecutor):
    def __init__(self):
        self.agent = WeatherAgent()

    async def execute(
        self,
        context: RequestContext,
        event_queue: EventQueue,
    ) -> None:
        query = context.get_user_input()
        session_id = getattr(context, 'context_id', 'default_session')
        final_content = await self.agent.invoke(query, session_id)
        await event_queue.enqueue_event(new_agent_text_message(final_content))

    async def cancel(
        self, context: RequestContext, event_queue: EventQueue
    ) -> None:
        raise Exception('cancel not supported')


def main():
    if not os.getenv("GOOGLE_API_KEY") and not os.getenv("GEMINI_API_KEY"):
        print("⚠️  Warning: No API key found!")
        print("   Set either GOOGLE_API_KEY or GEMINI_API_KEY environment variable")
        print("   Example: export GOOGLE_API_KEY='your-key-here'")
        print("   Get a key from: https://aistudio.google.com/app/apikey")
        print()

    request_handler = DefaultRequestHandler(
        agent_executor=WeatherAgentExecutor(),
        task_store=InMemoryTaskStore(),
    )

    server = A2AStarletteApplication(
        agent_card=public_agent_card,
        http_handler=request_handler,
        extended_agent_card=public_agent_card,
    )

    print(f"🌤️  Starting Weather Agent (ADK + A2A) on http://0.0.0.0:{port}")
    print(f"   Agent: {public_agent_card.name}")
    print(f"   Description: {public_agent_card.description}")
    uvicorn.run(server.build(), host='0.0.0.0', port=port)


if __name__ == '__main__':
    main()
