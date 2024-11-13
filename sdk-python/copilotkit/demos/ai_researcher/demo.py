"""Demo"""

from fastapi import FastAPI
import uvicorn
from copilotkit.integrations.fastapi import add_fastapi_endpoint
from copilotkit import CopilotKitSDK, LangGraphAgent
from copilotkit.demos.ai_researcher.agent import graph

app = FastAPI()
sdk = CopilotKitSDK(
    agents=[
        LangGraphAgent(
            name="search_agent",
            description="Search agent.",
            agent=graph,
        )
    ],
)

add_fastapi_endpoint(app, sdk, "/copilotkit")

def main():
    """Run the uvicorn server."""
    uvicorn.run("copilotkit.demos.ai_researcher.demo:app", host="127.0.0.1", port=8000, reload=True)
