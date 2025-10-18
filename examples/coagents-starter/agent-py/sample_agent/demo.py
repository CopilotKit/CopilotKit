"""
This serves the "sample_agent" agent using CopilotKit SDK with AsyncSqliteSaver for thread persistence.
"""

import os
from contextlib import asynccontextmanager
from dotenv import load_dotenv
load_dotenv()

from fastapi import FastAPI
import uvicorn
from copilotkit.integrations.fastapi import add_fastapi_endpoint
from copilotkit import CopilotKitSDK, LangGraphAgent
from sample_agent.agent import workflow
from langgraph.checkpoint.memory import MemorySaver

@asynccontextmanager
async def lifespan(fastapi_app: FastAPI):
    """Lifespan for the FastAPI app with MemorySaver for thread persistence."""
    # Use MemorySaver for in-memory checkpointing (can switch to AsyncSqliteSaver for persistence)
    checkpointer = MemorySaver()
    graph = workflow.compile(checkpointer=checkpointer)

    # Create SDK with the compiled graph
    sdk = CopilotKitSDK(
        agents=[
            LangGraphAgent(
                name="sample_agent",
                description="An example agent to use as a starting point for your own agent.",
                graph=graph,
            ),
        ],
    )

    # Add the CopilotKit FastAPI endpoint
    add_fastapi_endpoint(fastapi_app, sdk, "/copilotkit")
    yield

app = FastAPI(lifespan=lifespan)

@app.get("/health")
def health():
    """Health check."""
    return {"status": "ok"}

def main():
    """Run the uvicorn server."""
    port = int(os.getenv("PORT", "8000"))
    uvicorn.run(
        "sample_agent.demo:app",
        host="0.0.0.0",
        port=port,
        reload=True,
    )

if __name__ == "__main__":
    main()
