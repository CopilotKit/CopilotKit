"""
Itinerary Agent (LangGraph + A2A Protocol)

This agent creates day-by-day travel itineraries using LangGraph.
It exposes an A2A Protocol endpoint so it can be called by the orchestrator.
"""

import uvicorn
import json
import os
from dotenv import load_dotenv

load_dotenv()

from a2a.server.apps import A2AStarletteApplication
from a2a.server.request_handlers import DefaultRequestHandler
from a2a.server.tasks import InMemoryTaskStore
from a2a.types import (
    AgentCapabilities,
    AgentCard,
    AgentSkill,
    Message
)
from a2a.server.agent_execution import AgentExecutor, RequestContext
from a2a.server.events import EventQueue
from a2a.utils import new_agent_text_message
from langgraph.graph import StateGraph, END
from langchain_openai import ChatOpenAI
from typing import TypedDict, List, Optional
from pydantic import BaseModel, Field


class TimeSlot(BaseModel):
    activities: List[str] = Field(description="List of activities for this time slot")
    location: str = Field(description="Main location for these activities")


class Meals(BaseModel):
    breakfast: str = Field(description="Breakfast recommendation with place name")
    lunch: str = Field(description="Lunch recommendation with place name")
    dinner: str = Field(description="Dinner recommendation with place name")


class DayItinerary(BaseModel):
    day: int = Field(description="Day number")
    title: str = Field(description="Title or theme for this day")
    morning: TimeSlot = Field(description="Morning activities")
    afternoon: TimeSlot = Field(description="Afternoon activities")
    evening: TimeSlot = Field(description="Evening activities")
    meals: Meals = Field(description="Meal recommendations for the day")


class StructuredItinerary(BaseModel):
    destination: str = Field(description="Travel destination")
    days: int = Field(description="Number of days")
    itinerary: List[DayItinerary] = Field(description="Day-by-day itinerary")


class ItineraryState(TypedDict):
    destination: str
    days: int
    message: str
    itinerary: str
    structured_itinerary: Optional[dict]


class ItineraryAgent:
    def __init__(self):
        self.llm = ChatOpenAI(model="gpt-4o-mini", temperature=0.7)
        self.graph = self._build_graph()

    def _build_graph(self):
        workflow = StateGraph(ItineraryState)
        workflow.add_node("parse_request", self._parse_request)
        workflow.add_node("create_itinerary", self._create_itinerary)
        workflow.set_entry_point("parse_request")
        workflow.add_edge("parse_request", "create_itinerary")
        workflow.add_edge("create_itinerary", END)
        return workflow.compile()

    def _parse_request(self, state: ItineraryState) -> ItineraryState:
        message = state["message"]
        prompt = f"""
        Extract the destination and number of days from this travel request.
        Return ONLY a JSON string with 'destination' and 'days' fields.

        Request: {message}

        Example output: {{"destination": "Tokyo", "days": 3}}
        """

        response = self.llm.invoke(prompt)

        print(response.content)

        try:
            parsed = json.loads(response.content)
            state["destination"] = parsed.get("destination", "Unknown")
            state["days"] = int(parsed.get("days", 3))
        except:
            state["destination"] = "Unknown"
            state["days"] = 3

        return state

    def _create_itinerary(self, state: ItineraryState) -> ItineraryState:
        destination = state["destination"]
        days = state["days"]
        prompt = f"""
        Create a detailed {days}-day travel itinerary for {destination}.

        Return ONLY a valid JSON object with this exact structure:
        {{
          "destination": "{destination}",
          "days": {days},
          "itinerary": [
            {{
              "day": 1,
              "title": "Day theme/title",
              "morning": {{
                "activities": ["Activity 1", "Activity 2"],
                "location": "Main area/neighborhood"
              }},
              "afternoon": {{
                "activities": ["Activity 1", "Activity 2"],
                "location": "Main area/neighborhood"
              }},
              "evening": {{
                "activities": ["Activity 1", "Activity 2"],
                "location": "Main area/neighborhood"
              }},
              "meals": {{
                "breakfast": "Restaurant name and dish",
                "lunch": "Restaurant name and dish",
                "dinner": "Restaurant name and dish"
              }}
            }}
          ]
        }}

        Make it realistic, interesting, and include specific place names.
        Return ONLY valid JSON, no markdown, no other text.
        """

        response = self.llm.invoke(prompt)
        content = response.content.strip()

        if "```json" in content:
            content = content.split("```json")[1].split("```")[0].strip()
        elif "```" in content:
            content = content.split("```")[1].split("```")[0].strip()

        try:
            structured_data = json.loads(content)
            validated_itinerary = StructuredItinerary(**structured_data)
            state["structured_itinerary"] = validated_itinerary.model_dump()
            state["itinerary"] = json.dumps(validated_itinerary.model_dump(), indent=2)
            print("✅ Successfully created structured itinerary")
        except json.JSONDecodeError as e:
            print(f"❌ JSON parsing error: {e}")
            print(f"Content: {content}")
            state["itinerary"] = json.dumps({
                "error": "Failed to generate structured itinerary",
                "raw_content": content[:200]
            })
            state["structured_itinerary"] = None
        except Exception as e:
            print(f"❌ Validation error: {e}")
            state["itinerary"] = json.dumps({
                "error": f"Validation failed: {str(e)}"
            })
            state["structured_itinerary"] = None

        return state

    async def invoke(self, message: Message) -> str:
        message_text = message.parts[0].root.text
        print("Invoking itinerary agent with message: ", message_text)
        result = self.graph.invoke({
            "message": message_text,
            "destination": "",
            "days": 3,
            "itinerary": ""
        })

        return result["itinerary"]


port = int(os.getenv("ITINERARY_PORT", 9001))

skill = AgentSkill(
    id='itinerary_agent',
    name='Itinerary Planning Agent',
    description='Creates detailed day-by-day travel itineraries using LangGraph',
    tags=['travel', 'itinerary', 'langgraph'],
    examples=[
        'Create a 3-day itinerary for Tokyo',
        'Plan a week-long trip to Paris',
        'What should I do in New York for 5 days?'
    ],
)

cardUrl = os.getenv("RENDER_EXTERNAL_URL", f"http://localhost:{port}")
public_agent_card = AgentCard(
    name='Itinerary Agent',
    description='LangGraph-powered agent that creates detailed day-by-day travel itineraries in plain text format with activities and meal recommendations.',
    url=cardUrl,
    version='1.0.0',
    defaultInputModes=['text'],
    defaultOutputModes=['text'],
    capabilities=AgentCapabilities(streaming=True),
    skills=[skill],
    supportsAuthenticatedExtendedCard=False,
)


class ItineraryAgentExecutor(AgentExecutor):
    def __init__(self):
        self.agent = ItineraryAgent()

    async def execute(
        self,
        context: RequestContext,
        event_queue: EventQueue,
    ) -> None:
        result = await self.agent.invoke(context.message)
        await event_queue.enqueue_event(new_agent_text_message(result))

    async def cancel(
        self, context: RequestContext, event_queue: EventQueue
    ) -> None:
        raise Exception('cancel not supported')


def main():
    if not os.getenv("OPENAI_API_KEY"):
        print("⚠️  Warning: OPENAI_API_KEY environment variable not set!")
        print("   Set it with: export OPENAI_API_KEY='your-key-here'")
        print()

    request_handler = DefaultRequestHandler(
        agent_executor=ItineraryAgentExecutor(),
        task_store=InMemoryTaskStore(),
    )

    server = A2AStarletteApplication(
        agent_card=public_agent_card,
        http_handler=request_handler,
        extended_agent_card=public_agent_card,
    )

    print(f"🗺️  Starting Itinerary Agent (LangGraph + A2A) on http://0.0.0.0:{port}")
    uvicorn.run(server.build(), host='0.0.0.0', port=port)


if __name__ == '__main__':
    main()
