"""Demo"""

import os
from dotenv import load_dotenv 
load_dotenv()

# pylint: disable=wrong-import-position
from fastapi import FastAPI
import uvicorn
from copilotkit.integrations.fastapi import add_fastapi_endpoint
from copilotkit import CopilotKitSDK, LangGraphAgent
from tutorial_customer_support.agent import part_1_graph

app = FastAPI()
sdk = CopilotKitSDK(
    agents=[
        LangGraphAgent(
            name="customer_support_agent",
            description="Customer support agent.",
            graph=part_1_graph,
            config={
                "configurable": {
                    # The passenger_id is used in our flight tools to
                    # fetch the user's flight information
                    "passenger_id": "3442 587242",                
                }
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
    uvicorn.run("tutorial_customer_support.demo:app", host="0.0.0.0", port=port)
