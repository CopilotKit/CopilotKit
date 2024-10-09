"""Demo"""
import os
from dotenv import load_dotenv
load_dotenv()

from fastapi import FastAPI
import uvicorn
from copilotkit.integrations.fastapi import add_fastapi_endpoint
from copilotkit import CopilotKitSDK, LangGraphAgent
from ai_researcher.agent import graph

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

# add new route for health check
@app.get("/health")
def health():
    """Health check."""
    return {"status": "ok"}

port = int(os.getenv("PORT", "8000"))
host = "0.0.0.0" if os.getenv("RENDER") else "127.0.0.1"

def main():
    """Run the uvicorn server."""
    uvicorn.run("backend.demo:app", host=host, port=port, reload=True)