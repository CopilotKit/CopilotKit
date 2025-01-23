"""Demo"""

import os
from dotenv import load_dotenv
load_dotenv() # pylint: disable=wrong-import-position

from fastapi import FastAPI
import uvicorn
from copilotkit.integrations.fastapi import add_fastapi_endpoint
from copilotkit import CopilotKitRemoteEndpoint, LangGraphAgent, Action
from greeter.agent import graph


app = FastAPI()
sdk = CopilotKitRemoteEndpoint(
    agents=[
        LangGraphAgent(
            name="greeter",
            description="ReAct agent.",
            graph=graph,
        )
    ],
    actions=[
        Action(
            name="greet_user",
            description="Say hello to the user.",
            parameters=[
                {
                    "name": "name",
                    "description": "The name of the user to greet.",
                    "type": "string",
                },
            ],
            handler=lambda name: "Hello, world!",
        ),
    ],
)

add_fastapi_endpoint(app, sdk, "/copilotkit")

def main():
    """Run the uvicorn server."""
    port = int(os.getenv("PORT", "8000"))
    uvicorn.run(
        "greeter.demo:app",
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
