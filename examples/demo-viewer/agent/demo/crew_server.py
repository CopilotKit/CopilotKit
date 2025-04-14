"""
This serves our agents through a FastAPI server.
"""

import os
from dotenv import load_dotenv
load_dotenv() # pylint: disable=wrong-import-position

from fastapi import FastAPI
import uvicorn
from copilotkit.integrations.fastapi import add_fastapi_endpoint
from copilotkit import CopilotKitRemoteEndpoint
from copilotkit.crewai import CrewAIAgent

from demo.crewai_agentic_chat.agent import AgenticChatFlow
from demo.crewai_agentic_generative_ui.agent import AgenticGenerativeUIFlow
from demo.crewai_human_in_the_loop.agent import HumanInTheLoopFlow
from demo.crewai_multi_agent_flows.agent import (
    MultiAgentWriterFlow,
    MultiAgentResearcherFlow,
    MultiAgentCriticFlow,
)
from demo.crewai_predictive_state_updates.agent import PredictiveStateUpdatesFlow
from demo.crewai_shared_state.agent import SharedStateFlow
from demo.crewai_tool_based_generative_ui.agent import ToolBasedGenerativeUIFlow


app = FastAPI()
sdk = CopilotKitRemoteEndpoint(
    agents=[
        CrewAIAgent(
            name="agentic_chat",
            description="An example for an agentic chat flow.",
            flow=AgenticChatFlow(),
        ),
        CrewAIAgent(
            name="tool_based_generative_ui",
            description="An example for a tool-based generative UI flow.",
            flow=ToolBasedGenerativeUIFlow(),
        ),

        CrewAIAgent(
            name="agentic_generative_ui",
            description="An example for an agentic generative UI flow.",
            flow=AgenticGenerativeUIFlow(),
        ),

        CrewAIAgent(
            name="human_in_the_loop",
            description="An example for a human in the loop flow.",
            flow=HumanInTheLoopFlow(),
        ),

        CrewAIAgent(
            name="shared_state",
            description="An example for a shared state flow.",
            flow=SharedStateFlow(),
        ),
        CrewAIAgent(
            name="predictive_state_updates",
            description="An example for a predictive state updates flow.",
            flow=PredictiveStateUpdatesFlow(),
        ),
        CrewAIAgent(
            name="multi_agent_writer",
            description="An example for a multi-agent flow (Writer).",
            flow=MultiAgentWriterFlow(),
        ),
        CrewAIAgent(
            name="multi_agent_researcher",
            description="An example for a multi-agent flow (Researcher).",
            flow=MultiAgentResearcherFlow(),
        ),
        CrewAIAgent(
            name="multi_agent_critic",
            description="An example for a multi-agent flow (Critic).",
            flow=MultiAgentCriticFlow(),
        ),
    ],
)

add_fastapi_endpoint(app, sdk, "/copilotkit")

@app.get("/healthz")
def health():
    """Health check."""
    return {"status": "ok"}

@app.get("/")
def root():
    """Root endpoint."""
    return {"message": "Hello, World!"}


def main():
    """Run the uvicorn server."""
    port = int(os.getenv("PORT", "8000"))
    uvicorn.run(
        "demo.crew_server:app",
        host="0.0.0.0",
        port=port,
        reload=True,
    )

if __name__ == "__main__":
    main()

