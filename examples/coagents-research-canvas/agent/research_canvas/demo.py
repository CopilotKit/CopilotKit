"""Demo"""

import os
from dotenv import load_dotenv
load_dotenv()

# pylint: disable=wrong-import-position
from fastapi import FastAPI
import uvicorn
from copilotkit.integrations.fastapi import add_fastapi_endpoint
from copilotkit import CopilotKitRemoteEndpoint, LangGraphAgent
from copilotkit.crewai import CrewAIAgent
from research_canvas.crewai.agent import ResearchCanvasFlow
from research_canvas.langgraph.agent import graph

# from contextlib import asynccontextmanager
# from langgraph.checkpoint.sqlite.aio import AsyncSqliteSaver
# @asynccontextmanager
# async def lifespan(fastapi_app: FastAPI):
#     """Lifespan for the FastAPI app."""
#     async with AsyncSqliteSaver.from_conn_string(
#         ":memory:"
#     ) as checkpointer:
#         # Create an async graph
#         graph = workflow.compile(checkpointer=checkpointer)

#         # Create SDK with the graph
#         sdk = CopilotKitRemoteEndpoint(
#             agents=[
#                 LangGraphAgent(
#                     name="research_agent",
#                     description="Research agent.",
#                     graph=graph,
#                 ),
#                 LangGraphAgent(
#                     name="research_agent_google_genai",
#                     description="Research agent.",
#                     graph=graph
#                 ),
#             ],
#         )

#         # Add the CopilotKit FastAPI endpoint
#         add_fastapi_endpoint(fastapi_app, sdk, "/copilotkit")
#         yield

# app = FastAPI(lifespan=lifespan)


app = FastAPI()
sdk = CopilotKitRemoteEndpoint(
    agents=[
        CrewAIAgent(
            name="research_agent_crewai",
            description="Research agent.",
            flow=ResearchCanvasFlow(),
        ),
        LangGraphAgent(
            name="research_agent",
            description="Research agent.",
            graph=graph,
        ),
         LangGraphAgent(
            name="research_agent_google_genai",
            description="Research agent.",
            graph=graph
        ),
    ],
)

add_fastapi_endpoint(app, sdk, "/copilotkit")


@app.get("/health")
def health():
    """Health check."""
    return {"status": "ok"}


def main():
    """Run the uvicorn server."""
    port = int(os.getenv("PORT", "8000"))
    uvicorn.run(
        "research_canvas.demo:app",
        host="0.0.0.0",
        port=port,
        reload=True,
        reload_dirs=(
            ["."] +
            (["../../../sdk-python/copilotkit"]
             if os.path.exists("../../../sdk-python/copilotkit")
             else []
             )
        )
    )
