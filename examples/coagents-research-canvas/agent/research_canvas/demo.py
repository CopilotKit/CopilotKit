"""Demo"""

import os
from dotenv import load_dotenv
load_dotenv()
os.environ["LANGGRAPH_FASTAPI"] = "true"

# pylint: disable=wrong-import-position
from fastapi import FastAPI
import uvicorn
from copilotkit.integrations.fastapi import add_fastapi_endpoint
from copilotkit import CopilotKitRemoteEndpoint, add_langgraph_fastapi_endpoint, LangGraphAGUIAgent
from copilotkit.crewai import CrewAIAgent
from research_canvas.crewai.agent import ResearchCanvasFlow
from research_canvas.langgraph.agent import graph
# from ag_ui_crewai.endpoint import add_crewai_flow_fastapi_endpoint

app = FastAPI()

sdk = CopilotKitRemoteEndpoint(
    agents=[
        CrewAIAgent(
            name="research_agent_crewai",
            description="Research agent.",
            flow=ResearchCanvasFlow(),
        ),
    ],
)
# add_crewai_flow_fastapi_endpoint(
#     app=app,
#     flow=ResearchCanvasFlow(),
#     path="/agents/crewai/research_agent_crewai",
# )

add_langgraph_fastapi_endpoint(
    app=app,
    agent=LangGraphAGUIAgent(
        name="research_agent",
        description="Research agent.",
        graph=graph
    ),
    path="/agents/research_agent"
)
add_langgraph_fastapi_endpoint(
    app=app,
    agent=LangGraphAGUIAgent(
        name="research_agent_google_genai",
        description="Research agent.",
        graph=graph
    ),
    path="/agents/research_agent_google_genai"
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
