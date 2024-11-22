"""Demo for Recipe Canvas"""

import os
from dotenv import load_dotenv 
load_dotenv()

# pylint: disable=wrong-import-position
from fastapi import FastAPI
import uvicorn
from copilotkit.integrations.fastapi import add_fastapi_endpoint
from copilotkit import CopilotKitSDK, LangGraphAgent
from copilotkit.langchain import copilotkit_messages_to_langchain
from recipe_canvas.agent import graph

app = FastAPI()
sdk = CopilotKitSDK(
    agents=[
        LangGraphAgent(
            name="recipe_agent",
            description="Recipe agent using OpenAI.",
            graph=graph,
        ),
    ],
)

add_fastapi_endpoint(app, sdk, "/copilotkit_remote")

# add new route for health check
@app.get("/health")
def health():
    """Health check."""
    return {"status": "ok"}

def main():
    """Run the uvicorn server."""
    port = int(os.getenv("PORT", "8000"))
    uvicorn.run("recipe_canvas.demo:app", host="0.0.0.0", port=port)
