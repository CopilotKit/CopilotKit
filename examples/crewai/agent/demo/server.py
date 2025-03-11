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
from demo.agentic_chat import AgenticChatFlow

app = FastAPI()
sdk = CopilotKitRemoteEndpoint(
    agents=[
        CrewAIAgent(
            name="agentic_chat",
            description="An example for an agentic chat flow.",
            flow=AgenticChatFlow(),
        )
    ],
)

add_fastapi_endpoint(app, sdk, "/copilotkit")

def main():
    """Run the uvicorn server."""
    port = int(os.getenv("PORT", "8000"))
    uvicorn.run(
        "demo.server:app",
        host="0.0.0.0",
        port=port,
        reload=True,
    )

if __name__ == "__main__":
    main()

