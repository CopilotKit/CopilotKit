"""
This serves our agents through a FastAPI server.
"""

import os
from dotenv import load_dotenv

load_dotenv()  

from fastapi import FastAPI
import uvicorn
from copilotkit.integrations.fastapi import add_fastapi_endpoint
from copilotkit import CopilotKitSDK, LangGraphAgent
from posts_generator_agent import post_generation_graph
from stack_agent import stack_analysis_graph

app = FastAPI()


sdk = CopilotKitSDK(
    agents=[
        LangGraphAgent(
            name="post_generation_agent",
            description="An agent that can help with the generation of LinkedIn posts and X posts.",
            graph=post_generation_graph,
        ),
        LangGraphAgent(
            name="stack_analysis_agent",
            description="Analyze a GitHub repository URL to infer purpose and tech stack (frontend, backend, DB, infra).",
            graph=stack_analysis_graph,
        ),
    ]
)

add_fastapi_endpoint(app, sdk, "/copilotkit")


@app.get("/healthz")
def health():
    """Health check."""
    return {"status": "ok"}


@app.get("/")
def root():
    """Root endpoint."""
    return {"message": "Hello, World!"}


def main():
    """Run the uvicorn server."""
    port = int(os.getenv("PORT", "8000"))
    uvicorn.run(
        "main:app",
        host="0.0.0.0",
        port=port,
        reload=True,
    )


if __name__ == "__main__":
    main()
