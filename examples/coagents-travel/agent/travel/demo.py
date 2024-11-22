"""Server"""

import os
from dotenv import load_dotenv
load_dotenv() # pylint: disable=wrong-import-position

from fastapi import FastAPI
import uvicorn
from copilotkit.integrations.fastapi import add_fastapi_endpoint
from copilotkit import CopilotKitSDK, LangGraphAgent
from travel.agent import graph


app = FastAPI()
sdk = CopilotKitSDK(
    agents=[
        LangGraphAgent(
            name="travel_agent",
            description="Manages a user's trips.",
            agent=graph,
        )
    ],
)

add_fastapi_endpoint(app, sdk, "/copilotkit_remote")

def main():
    """Run the uvicorn server."""
    port = int(os.getenv("PORT", "8000"))
    uvicorn.run("travel.demo:app", host="localhost", port=port, reload=True)
