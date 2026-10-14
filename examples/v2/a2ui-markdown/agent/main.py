"""Server"""

import os

from dotenv import load_dotenv

load_dotenv()  # pylint: disable=wrong-import-position

import uvicorn
from ag_ui_langgraph import add_langgraph_fastapi_endpoint
from copilotkit import LangGraphAGUIAgent
from fastapi import FastAPI

from src.agent import graph

app = FastAPI()
add_langgraph_fastapi_endpoint(
    app=app,
    agent=LangGraphAGUIAgent(
        name="langgraph",
        description="A chat agent that renders A2UI surfaces in markdown fences.",
        graph=graph,
    ),
    path="/copilotkit",
)


def main():
    """Run the uvicorn server."""
    port = int(os.getenv("PORT", "8011"))
    uvicorn.run(
        "main:app",
        host="localhost",
        port=port,
        reload=True,
        reload_dirs=(
            ["."]
            + (
                ["../../../../sdk-python/copilotkit"]
                if os.path.exists("../../../../sdk-python/copilotkit")
                else []
            )
        ),
    )


if __name__ == "__main__":
    main()
