"""Server"""

import os

from dotenv import load_dotenv

load_dotenv()  # pylint: disable=wrong-import-position

import uvicorn
from ag_ui_langgraph import LangGraphAgent, add_langgraph_fastapi_endpoint
from fastapi import FastAPI

from src.agent import graph

app = FastAPI()
add_langgraph_fastapi_endpoint(
    app=app,
    agent=LangGraphAgent(
        name="travel",
        description="An agent for travel planning.",
        graph=graph,
    ),
    path="/copilotkit",
)


def main():
    """Run the uvicorn server."""
    port = int(os.getenv("PORT", "8000"))
    uvicorn.run(
        "main:app",
        host="localhost",
        port=port,
        reload=True,
        reload_dirs=["."],
    )


if __name__ == "__main__":
    main()
