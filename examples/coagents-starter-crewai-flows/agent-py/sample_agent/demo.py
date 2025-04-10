"""
This serves the "sample_agent" agent. This is an example of self-hosting an agent
through our FastAPI integration. However, you can also host in LangGraph platform.
"""

import os
from dotenv import load_dotenv
load_dotenv() # pylint: disable=wrong-import-position

from fastapi import FastAPI
import uvicorn
from copilotkit.integrations.fastapi import add_fastapi_endpoint, CopilotKitRemoteEndpoint
from copilotkit.crewai import CrewAIAgent
from sample_agent.agent import SampleAgentFlow

app = FastAPI()

sdk = CopilotKitRemoteEndpoint(
    agents=[
        CrewAIAgent(
            name="sample_agent",
            description="An example agent to use as a starting point for your own agent.",
            flow=SampleAgentFlow(),
        )
    ],
)

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
    )
    
if __name__ == "__main__":
    print("Running main() function...")
    main()
