"""Demo"""

from dotenv import load_dotenv
load_dotenv() # pylint: disable=wrong-import-position

from fastapi import FastAPI
import uvicorn
from copilotkit.integrations.fastapi import add_fastapi_endpoint
from copilotkit import CopilotKitSDK, LangGraphAgent
from copilotkit.demos.starter.agent import graph
from copilotkit.langchain import copilotkit_customize_config

app = FastAPI()
sdk = CopilotKitSDK(
    agents=[
        LangGraphAgent(
            name="translate_agent",
            description="Translate agent that translates text.",
            agent=graph,
            config=copilotkit_customize_config(
                base_config={
                    "recursion_limit": 10,
                },
                emit_messages=True,
            ),
        )
    ],
)

add_fastapi_endpoint(app, sdk, "/copilotkit")

def main():
    """Run the uvicorn server."""
    uvicorn.run("copilotkit.demos.starter.demo:app", host="127.0.0.1", port=8000, reload=True)
