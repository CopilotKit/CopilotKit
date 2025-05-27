"""
This serves the "sample_agent" agent. This is an example of self-hosting an agent
through our FastAPI integration. However, you can also host in LangGraph platform.
"""

import os
from dotenv import load_dotenv
load_dotenv() # pylint: disable=wrong-import-position

from fastapi import FastAPI, Request
import uvicorn
from copilotkit.integrations.fastapi import add_fastapi_endpoint, CopilotKitRemoteEndpoint
from copilotkit.crewai import CrewAIAgent
from sample_agent.agent import SampleAgentFlow
import logging
import json
from typing import Dict, Any, List
import copy

app = FastAPI()

logger = logging.getLogger(__name__)
logger.setLevel(logging.DEBUG)

# Simple logging middleware
@app.middleware("http")
async def log_requests(request: Request, call_next):
    # Log the request path only
    logger.debug(f"[DEBUG] Incoming request: {request.method} {request.url.path}")

    # Pass the request to the next middleware or endpoint
    # without attempting to read the body
    response = await call_next(request)
    return response

class PersistenceAgent(CrewAIAgent):
    """
    A CrewAIAgent subclass that ensures ThreadID persistence across requests.

    This class solves two specific problems with the Flow framework:

    1. Thread ID Consistency: Ensures the threadId from the frontend is used
       consistently in the Flow's state and persistence layer.

    2. Flow Instance Isolation: Creates a fresh Flow instance for each request
       to prevent state sharing between different conversations.

    Without this class, Flow would generate random UUIDs for its state, causing
    a mismatch with the frontend's threadId and breaking conversation persistence.
    """

    def __init__(self, *, name, description, flow, **kwargs):
        # Store original flow template for later deep copying
        self.flow_template = flow
        super().__init__(name=name, description=description, flow=flow, **kwargs)

    def execute(self, *, thread_id, **kwargs):
        logger.info(f"[DEBUG] PersistenceAgent.execute called with thread_id: {thread_id}")

        # Create a fresh flow instance with the thread_id
        # This is simpler than trying to modify an existing flow
        new_flow = SampleAgentFlow(thread_id=thread_id)
        logger.info(f"[DEBUG] Created new flow with ID: {getattr(new_flow.state, 'id', 'unknown')}")

        # Replace self.flow with our new flow instead of passing it as a parameter
        self.flow = new_flow

        # No need to pass flow parameter - it will use self.flow
        return super().execute(thread_id=thread_id, **kwargs)

    async def get_state(self, *, thread_id: str):
        """Handle get_state requests by creating a flow instance with the correct threadId."""
        logger.info(f"[DEBUG] PersistenceAgent.get_state called with thread_id: {thread_id}")

        # Create a flow with the requested threadId
        flow = SampleAgentFlow(thread_id=thread_id)
        logger.info(f"[DEBUG] Created new flow for get_state with ID: {getattr(flow.state, 'id', 'unknown')}")

        # Replace self.flow with our new flow
        self.flow = flow

        # Use the parent's implementation
        result = await super().get_state(thread_id=thread_id)
        logger.info(f"[DEBUG] get_state result: threadExists={result.get('threadExists', False)}, " +
                    f"messages={len(result.get('messages', []))}")

        # If no existing state, create a default one
        if not result.get("threadExists", False):
            logger.info(f"[DEBUG] No state found for {thread_id}, creating empty state")
            # Return minimally viable empty state
            return {
                "threadId": thread_id,
                "threadExists": True,
                "state": {
                    "id": thread_id,
                    "messages": [],
                    "copilotkit": {"actions": []},
                    "language": "english",
                    "proverbs": []
                },
                "messages": []
            }

        return result

# Create a CopilotKit endpoint with our custom PersistenceAgent
sdk = CopilotKitRemoteEndpoint(
    agents=[
        PersistenceAgent(
            name="sample_agent",
            description="An example agent to use as a starting point for your own agent.",
            flow=SampleAgentFlow(),  # This is just a template, we'll create new instances in execute
        )
    ],
)

# Register the standard CopilotKit endpoint
add_fastapi_endpoint(app, sdk, "/copilotkit")

def main():
    """Run the uvicorn server."""
    port = int(os.getenv("PORT", "8000"))
    print(f"Starting uvicorn server on port {port}...")
    uvicorn.run(
        "sample_agent.demo:app",
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

if __name__ == "__main__":
    print("Running main() function...")
    main()
