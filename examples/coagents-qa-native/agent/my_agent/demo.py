"""Demo"""

from dotenv import load_dotenv
load_dotenv() # pylint: disable=wrong-import-position

from fastapi import FastAPI
import uvicorn
from copilotkit.integrations.fastapi import add_fastapi_endpoint
from copilotkit import CopilotKitSDK, LangGraphAgent
from my_agent.agent import graph


app = FastAPI()
sdk = CopilotKitSDK(
    agents=[
        LangGraphAgent(
            name="email_agent",
            description="This agent sends emails",
            agent=graph,
        )
    ],
)

add_fastapi_endpoint(app, sdk, "/copilotkit")

def main():
    """Run the uvicorn server."""
    uvicorn.run("my_agent.demo:app", host="127.0.0.1", port=8000, reload=True)
