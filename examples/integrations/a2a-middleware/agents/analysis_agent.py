"""
Analysis Agent - Analyzes research findings using ADK + Gemini.
Exposes A2A Protocol endpoint, returns structured JSON.
"""

import uvicorn
import os
import json
from typing import List
from dotenv import load_dotenv
from pydantic import BaseModel, Field

load_dotenv()

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
from google.adk.agents.llm_agent import LlmAgent
from google.adk.runners import Runner
from google.adk.sessions import InMemorySessionService
from google.adk.memory.in_memory_memory_service import InMemoryMemoryService
from google.adk.artifacts import InMemoryArtifactService
from google.genai import types

class InsightItem(BaseModel):
    title: str = Field(description="Title of the insight")
    description: str = Field(description="Detailed description of the insight")
    importance: str = Field(description="Why this insight matters")

class StructuredAnalysis(BaseModel):
    topic: str = Field(description="The topic being analyzed")
    overview: str = Field(description="Brief overview of the analysis")
    insights: List[InsightItem] = Field(description="List of key insights")
    conclusion: str = Field(description="Concluding thoughts")

class AnalysisAgent:
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
            name='analysis_agent',
            description='An agent that analyzes research findings and provides insights',
            instruction="""
You are an analysis agent. Your role is to analyze research findings and provide meaningful insights.

When you receive research data, analyze it thoroughly and create an insightful analysis.

Return ONLY a valid JSON object with this exact structure:
{
  "topic": "The topic being analyzed",
  "overview": "A brief 2-3 sentence overview of the analysis",
  "insights": [
    {
      "title": "Key Insight 1",
      "description": "Detailed explanation of this insight",
      "importance": "Why this matters"
    },
    {
      "title": "Key Insight 2",
      "description": "Detailed explanation of this insight",
      "importance": "Why this matters"
    },
    {
      "title": "Key Insight 3",
      "description": "Detailed explanation of this insight",
      "importance": "Why this matters"
    }
  ],
  "conclusion": "Concluding thoughts and recommendations"
}

Provide 3-5 meaningful insights based on the research.
Make the analysis thoughtful and actionable.
Return ONLY valid JSON, no markdown code blocks, no other text.
            """,
            tools=[],
        )

    async def invoke(self, query: str, session_id: str) -> str:
        """Generate analysis and return JSON string."""
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
            validated_analysis = StructuredAnalysis(**structured_data)
            final_response = json.dumps(validated_analysis.model_dump(), indent=2)
            print("✅ Successfully created structured analysis")
            return final_response
        except json.JSONDecodeError as e:
            print(f"❌ JSON parsing error: {e}")
            print(f"Content: {content_str}")
            return json.dumps({
                "error": "Failed to generate structured analysis",
                "raw_content": content_str[:200]
            })
        except Exception as e:
            print(f"❌ Validation error: {e}")
            return json.dumps({
                "error": f"Validation failed: {str(e)}"
            })

# A2A Protocol executor wraps the ADK agent
class AnalysisAgentExecutor(AgentExecutor):

    def __init__(self):
        self.agent = AnalysisAgent()

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

port = int(os.getenv("ANALYSIS_PORT", 9002))

skill = AgentSkill(
    id='analysis_agent',
    name='Analysis Agent',
    description='Analyzes research findings and provides meaningful insights using ADK',
    tags=['research', 'analysis', 'insights', 'adk'],
    examples=[
        'Analyze this research about quantum computing',
        'What are the key insights from this data?',
        'Provide analysis of these research findings'
    ],
)

public_agent_card = AgentCard(
    name='Analysis Agent',
    description='ADK-powered agent that analyzes research findings and provides meaningful insights',
    url=f'http://localhost:{port}/',
    version='1.0.0',
    defaultInputModes=['text'],
    defaultOutputModes=['text'],
    capabilities=AgentCapabilities(streaming=True),
    skills=[skill],
    supportsAuthenticatedExtendedCard=False,
)

def main():
    if not os.getenv("GOOGLE_API_KEY") and not os.getenv("GEMINI_API_KEY"):
        print("⚠️  Warning: No API key found!")
        print("   Set GOOGLE_API_KEY or GEMINI_API_KEY")
        print("   Get a key from: https://aistudio.google.com/app/apikey")
        print()

    request_handler = DefaultRequestHandler(
        agent_executor=AnalysisAgentExecutor(),
        task_store=InMemoryTaskStore(),
    )

    server = A2AStarletteApplication(
        agent_card=public_agent_card,
        http_handler=request_handler,
        extended_agent_card=public_agent_card,
    )

    print(f"💡 Starting Analysis Agent (ADK + A2A) on http://localhost:{port}")
    print(f"   Agent: {public_agent_card.name}")
    print(f"   Description: {public_agent_card.description}")
    uvicorn.run(server.build(), host='0.0.0.0', port=port)


if __name__ == '__main__':
    main()
