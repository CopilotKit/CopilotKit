"""
This is a demo of the CopilotKit SDK.
"""

import os
from dotenv import load_dotenv
load_dotenv()

# pylint: disable=wrong-import-position
from fastapi import FastAPI
import uvicorn
from copilotkit.integrations.fastapi import add_fastapi_endpoint
from copilotkit import CopilotKitRemoteEndpoint, Action, LangGraphAgent
from copilotkit.crewai import CrewAIAgent
from my_agent.langgraph.joke_agent import joke_graph
from my_agent.langgraph.email_agent import email_graph
from my_agent.langgraph.pirate_agent import pirate_graph
from my_agent.crewai.joke_agent import JokeAgentFlow
from my_agent.crewai.email_agent import EmailAgentFlow
from my_agent.crewai.pirate_agent import PirateAgentFlow


def get_agents(context):
    """Get the agents."""
    if context.get("properties", {}).get("model") == "crewai":
        return [
            CrewAIAgent(
                name="joke_agent",
                description="Make a joke.",
                flow=JokeAgentFlow(),
            ),
            CrewAIAgent(
                name="email_agent",
                description="Write an email.",
                flow=EmailAgentFlow(),
            ),
            CrewAIAgent(
                name="pirate_agent",
                description="Speak like a pirate.",
                flow=PirateAgentFlow(),
            )
        ]
    return [
        LangGraphAgent(
            name="joke_agent",
            description="Make a joke.",
            graph=joke_graph,
        ),
        LangGraphAgent(
            name="email_agent",
            description="Write an email.",
            graph=email_graph,
        ),
        LangGraphAgent(
            name="pirate_agent",
            description="Speak like a pirate.",
            graph=pirate_graph,
        )
    ]

def greet_user(name):
    """Greet the user."""
    print(f"Hello, {name}!")
    return "The user has been greeted. YOU MUST tell them to check the console."

app = FastAPI()
sdk = CopilotKitRemoteEndpoint(
    actions=[
        Action(
            name="greet_user",
            description="Greet the user.",
            handler=greet_user,
            parameters=[
                {
                    "name": "name",
                    "description": "The name of the user to greet.",
                    "type": "string",
                }
            ]
        ),
    ],
    agents=get_agents,
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
    uvicorn.run(
        "my_agent.demo:app",
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
