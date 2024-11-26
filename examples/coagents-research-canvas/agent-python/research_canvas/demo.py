"""Demo"""

import os
from dotenv import load_dotenv 
load_dotenv()

# pylint: disable=wrong-import-position
from fastapi import FastAPI
import uvicorn
from copilotkit.integrations.fastapi import add_fastapi_endpoint
from copilotkit import CopilotKitSDK, LangGraphAgent
from copilotkit.langchain import copilotkit_messages_to_langchain
from research_canvas.agent import graph

app = FastAPI()
sdk = CopilotKitSDK(
    agents=[
        LangGraphAgent(
            name="research_agent",
            description="Research agent.",
            graph=graph,
        ),
        LangGraphAgent(
            name="research_agent_google_genai",
            description="Research agent.",
            graph=graph,
            copilotkit_config={
                "convert_messages": copilotkit_messages_to_langchain(use_function_call=True)
            }
        ),
    ],
)

add_fastapi_endpoint(app, sdk, "/copilotkit")

# add new route for health check
@app.get("/health")
def health():
    """Health check."""
    return {"status": "ok"}


def main():
    """Run the uvicorn server."""
    port = int(os.getenv("PORT", "8000"))
    uvicorn.run("research_canvas.demo:app", host="0.0.0.0", port=port)
