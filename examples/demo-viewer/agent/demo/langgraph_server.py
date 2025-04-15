"""
This serves our agents through a FastAPI server.
"""

import os
from dotenv import load_dotenv
load_dotenv() # pylint: disable=wrong-import-position

from fastapi import FastAPI
import uvicorn
from copilotkit.integrations.fastapi import add_fastapi_endpoint
from copilotkit import CopilotKitSDK, LangGraphAgent

# Import remaining CrewAI agents
from demo.langgraph_human_in_the_loop.agent import human_in_the_loop_graph
from demo.langgraph_predictive_state_updates.agent import predictive_state_updates_graph
from demo.langgraph_shared_state.agent import shared_state_graph
from demo.langgraph_tool_based_generative_ui.agent import tool_based_generative_ui_graph
from demo.langgraph_agentic_chat.agent import agentic_chat_graph
from demo.langgraph_agentic_generative_ui.agent import graph


app = FastAPI()
# Use CopilotKitSDK instead of CopilotKitRemoteEndpoint
sdk = CopilotKitSDK(
    agents=[
        # Register the LangGraph agent using the LangGraphAgent class
        LangGraphAgent(
            name="agentic_chat",
            description="An example for an agentic chat flow using LangGraph.",
            graph=agentic_chat_graph
        ),
        # Register the remaining CrewAI agents
        LangGraphAgent(
            name="tool_based_generative_ui",
            description="An example for a tool-based generative UI flow.",
            graph=tool_based_generative_ui_graph,
        ),

        LangGraphAgent(
            name="agentic_generative_ui",
            description="An example for an agentic generative UI flow.",
            graph=graph,
        ),

        LangGraphAgent(
            name="human_in_the_loop",
            description="An example for a human in the loop flow.",
            graph=human_in_the_loop_graph,
        ),

        LangGraphAgent(
            name="shared_state",
            description="An example for a shared state flow.",
            graph=shared_state_graph,
        ),
        LangGraphAgent(
            name="predictive_state_updates",
            description="An example for a predictive state updates flow.",
            graph=predictive_state_updates_graph,
        )
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
        "demo.langgraph_server:app",
        host="0.0.0.0",
        port=port,
        reload=True,
    )

if __name__ == "__main__":
    main()
