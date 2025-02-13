"""Demo"""

import os
from dotenv import load_dotenv
load_dotenv() # pylint: disable=wrong-import-position

from fastapi import FastAPI
import uvicorn
from copilotkit.integrations.fastapi import add_fastapi_endpoint
from copilotkit import CopilotKitRemoteEndpoint, LangGraphAgent
from copilotkit.crewai import CrewAIAgent
from greeting_agent.langgraph.agent import graph
from greeting_agent.crewai.agent import GreetAgentFlow

app = FastAPI()
sdk = CopilotKitRemoteEndpoint(
    agents=[
        LangGraphAgent(
            name="greeting_agent",
            description="This agent greets the user",
            graph=graph,
        ),
        CrewAIAgent(
            name="greeting_agent_crewai",
            description="This agent greets the user",
            flow=GreetAgentFlow(),
        )
    ],
)

add_fastapi_endpoint(app, sdk, "/copilotkit", use_thread_pool=False)

# add new route for health check
@app.get("/health")
def health():
    """Health check."""
    return {"status": "ok"}

def main():
    """Run the uvicorn server."""
    port = int(os.getenv("PORT", "8000"))
    uvicorn.run(
        "greeting_agent.demo:app",
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
