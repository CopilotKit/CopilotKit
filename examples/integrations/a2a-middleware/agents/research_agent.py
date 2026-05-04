"""
Research Agent - Gathers information using LangGraph + OpenAI.
Exposes A2A Protocol endpoint, returns structured JSON.
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
from typing import TypedDict, Optional, List
from pydantic import BaseModel, Field

class ResearchFinding(BaseModel):
    title: str = Field(description="Title or key point of the finding")
    description: str = Field(description="Detailed description of the finding")

class StructuredResearch(BaseModel):
    topic: str = Field(description="The research topic")
    summary: str = Field(description="Brief summary of the research")
    findings: List[ResearchFinding] = Field(description="List of key findings")
    sources: str = Field(description="Note about information sources")

class ResearchState(TypedDict):
    message: str
    research: str
    structured_research: Optional[dict]

class ResearchAgent:
    def __init__(self):
        self.llm = ChatOpenAI(model="gpt-4o-mini", temperature=0.7)
        self.graph = self._build_graph()

    def _build_graph(self):
        workflow = StateGraph(ResearchState)
        workflow.add_node("conduct_research", self._conduct_research)
        workflow.set_entry_point("conduct_research")
        workflow.add_edge("conduct_research", END)
        return workflow.compile()

    def _conduct_research(self, state: ResearchState) -> ResearchState:
        """Generate research findings using LLM and return structured JSON."""
        message = state["message"]
        prompt = f"""
        Research the following topic and provide comprehensive information.

        Topic: {message}

        Return ONLY a valid JSON object with this exact structure:
        {{
          "topic": "The research topic",
          "summary": "A brief 2-3 sentence summary of the topic",
          "findings": [
            {{
              "title": "Key Point 1",
              "description": "Detailed explanation of this point"
            }},
            {{
              "title": "Key Point 2",
              "description": "Detailed explanation of this point"
            }},
            {{
              "title": "Key Point 3",
              "description": "Detailed explanation of this point"
            }}
          ],
          "sources": "Note about where this information typically comes from"
        }}

        Include 3-5 key findings about the topic.
        Make the research informative and well-structured.
        Return ONLY valid JSON, no markdown code blocks, no other text.
        """

        response = self.llm.invoke(prompt)

        try:
            structured_data = json.loads(response.content)
            state["structured_research"] = structured_data
            state["research"] = json.dumps(structured_data)
        except json.JSONDecodeError as e:
            state["research"] = f"Error: Failed to parse research results - {str(e)}"
            state["structured_research"] = None

        return state

    async def invoke(self, message: Message) -> str:
        """Process A2A message and return research JSON."""
        message_text = message.parts[0].root.text
        result = self.graph.invoke({
            "message": message_text,
            "research": "",
            "structured_research": None
        })
        return result["research"]

# A2A Protocol executor wraps the LangGraph agent
class ResearchAgentExecutor(AgentExecutor):

    def __init__(self):
        self.agent = ResearchAgent()

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

port = int(os.getenv("RESEARCH_PORT", 9001))

skill = AgentSkill(
    id='research_agent',
    name='Research Agent',
    description='Gathers and summarizes information about a given topic using LangGraph',
    tags=['research', 'information', 'summary', 'langgraph'],
    examples=[
        'Research quantum computing',
        'Tell me about artificial intelligence',
        'Gather information on renewable energy'
    ],
)

public_agent_card = AgentCard(
    name='Research Agent',
    description='LangGraph-powered agent that gathers and summarizes information about any topic',
    url=f'http://localhost:{port}/',
    version='1.0.0',
    defaultInputModes=['text'],
    defaultOutputModes=['text'],
    capabilities=AgentCapabilities(streaming=True),
    skills=[skill],
    supportsAuthenticatedExtendedCard=False,
)

def main():
    if not os.getenv("OPENAI_API_KEY"):
        print("⚠️  Warning: OPENAI_API_KEY not set!")
        print("   Set it with: export OPENAI_API_KEY='your-key-here'")
        print("   Get a key from: https://platform.openai.com/api-keys")
        print()

    request_handler = DefaultRequestHandler(
        agent_executor=ResearchAgentExecutor(),
        task_store=InMemoryTaskStore(),
    )

    server = A2AStarletteApplication(
        agent_card=public_agent_card,
        http_handler=request_handler,
        extended_agent_card=public_agent_card,
    )

    print(f"🔍 Starting Research Agent (LangGraph + A2A) on http://localhost:{port}")
    print(f"   Agent: {public_agent_card.name}")
    print(f"   Description: {public_agent_card.description}")
    uvicorn.run(server.build(), host='0.0.0.0', port=port)


if __name__ == '__main__':
    main()
