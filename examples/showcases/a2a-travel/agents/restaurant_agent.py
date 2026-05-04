"""
Restaurant Agent (ADK + A2A Protocol)

This agent provides restaurant recommendations based on travel itinerary.
It exposes an A2A Protocol endpoint and can be called by other agents.

Features:
- Can be called by the orchestrator via A2A middleware
- Can be called directly by other A2A agents (peer-to-peer)
- Returns structured JSON with restaurant recommendations
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


class DayMeals(BaseModel):
    day: int = Field(description="Day number")
    breakfast: str = Field(description="Breakfast recommendation with restaurant name and dish")
    lunch: str = Field(description="Lunch recommendation with restaurant name and dish")
    dinner: str = Field(description="Dinner recommendation with restaurant name and dish")


class StructuredRestaurants(BaseModel):
    destination: str = Field(description="Destination city/location")
    days: int = Field(description="Number of days")
    meals: List[DayMeals] = Field(description="Day-by-day meal recommendations")


class RestaurantAgent:
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
            name='restaurant_agent',
            description='An agent that provides restaurant and dining recommendations for travelers',
            instruction="""
You are a restaurant recommendation agent for travelers. Your role is to provide day-by-day
meal recommendations (breakfast, lunch, dinner) that match the traveler's itinerary.

When you receive a request, analyze:
- The destination city/location
- The number of days for the trip
- Any cuisine preferences or dietary needs mentioned

Return ONLY a valid JSON object with this exact structure:
{
  "destination": "City Name",
  "days": 3,
  "meals": [
    {
      "day": 1,
      "breakfast": "Café Sunrise - French pastries and coffee",
      "lunch": "Noodle House - Traditional ramen and gyoza",
      "dinner": "Skyline Restaurant - Sushi and city views"
    },
    {
      "day": 2,
      "breakfast": "Morning Market - Fresh fruit and local breakfast",
      "lunch": "Street Food Alley - Various local vendors",
      "dinner": "Family Kitchen - Home-style cooking"
    }
  ]
}

IMPORTANT RULES:
- The number of meal entries in the "meals" array MUST match the "days" field
- Each day should have breakfast, lunch, and dinner recommendations
- Include the restaurant/venue name and a brief description of the food
- Make recommendations specific to the destination's food culture
- Vary the cuisine types and price points across the days
- Consider the local dining schedule and customs

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
            validated_restaurants = StructuredRestaurants(**structured_data)
            final_response = json.dumps(validated_restaurants.model_dump(), indent=2)
            print("✅ Successfully created structured restaurant recommendations")
            return final_response
        except json.JSONDecodeError as e:
            print(f"❌ JSON parsing error: {e}")
            print(f"Content: {content_str}")
            return json.dumps({
                "error": "Failed to generate structured restaurant recommendations",
                "raw_content": content_str[:200]
            })
        except Exception as e:
            print(f"❌ Validation error: {e}")
            return json.dumps({
                "error": f"Validation failed: {str(e)}"
            })


port = int(os.getenv("RESTAURANT_PORT", 9003))

skill = AgentSkill(
    id='restaurant_agent',
    name='Restaurant Recommendation Agent',
    description='Provides restaurant and dining recommendations for travelers using ADK',
    tags=['travel', 'restaurants', 'dining', 'food', 'adk'],
    examples=[
        'Recommend restaurants for my trip to Tokyo',
        'Where should I eat in Paris?',
        'Find good restaurants near my itinerary locations'
    ],
)

cardUrl = os.getenv("RENDER_EXTERNAL_URL", f"http://localhost:{port}")
public_agent_card = AgentCard(
    name='Restaurant Agent',
    description='ADK-powered agent that provides personalized restaurant and dining recommendations for travelers',
    url=cardUrl,
    version='1.0.0',
    defaultInputModes=['text'],
    defaultOutputModes=['text'],
    capabilities=AgentCapabilities(streaming=True),
    skills=[skill],
    supportsAuthenticatedExtendedCard=False,
)


class RestaurantAgentExecutor(AgentExecutor):
    def __init__(self):
        self.agent = RestaurantAgent()

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
        agent_executor=RestaurantAgentExecutor(),
        task_store=InMemoryTaskStore(),
    )

    server = A2AStarletteApplication(
        agent_card=public_agent_card,
        http_handler=request_handler,
        extended_agent_card=public_agent_card,
    )

    print(f"🍽️  Starting Restaurant Agent (ADK + A2A) on http://0.0.0.0:{port}")
    print(f"   Agent: {public_agent_card.name}")
    print(f"   Description: {public_agent_card.description}")
    uvicorn.run(server.build(), host='0.0.0.0', port=port)


if __name__ == '__main__':
    main()
