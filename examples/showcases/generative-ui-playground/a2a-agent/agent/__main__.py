"""
A2A Server Entry Point for the UI Generator Agent.

This module sets up and runs the A2A server with A2UI support
for the general-purpose UI generator agent on port 10002.
"""

import logging
import os

import click
import uvicorn
from a2a.server.apps import A2AStarletteApplication
from a2a.server.request_handlers import DefaultRequestHandler
from a2a.server.tasks import InMemoryTaskStore
from a2a.types import AgentCapabilities, AgentCard, AgentSkill
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from starlette.staticfiles import StaticFiles

from .a2ui_extension import get_a2ui_agent_extension
from .agent_executor import UIGeneratorExecutor

# Load environment variables
load_dotenv()

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
)
logger = logging.getLogger(__name__)


def create_agent_card(base_url: str) -> AgentCard:
    """
    Create the A2A AgentCard that describes this agent's capabilities.

    Args:
        base_url: Base URL where the agent is hosted.

    Returns:
        Configured AgentCard with A2UI extension.
    """
    return AgentCard(
        name="UI Generator",
        description=(
            "A general-purpose AI assistant that creates dynamic user interfaces. "
            "Ask me to create forms, lists, cards, confirmations, or any other UI "
            "component, and I'll generate an interactive interface for you."
        ),
        url=base_url,
        version="1.0.0",
        capabilities=AgentCapabilities(
            streaming=True,
            push_notifications=False,
            state_transition_history=False,
            # A2UI extension MUST be inside capabilities, not on AgentCard
            extensions=[get_a2ui_agent_extension()],
        ),
        default_input_modes=["text"],
        default_output_modes=["text"],
        skills=[
            AgentSkill(
                id="create_form",
                name="Create Forms",
                description="Generate contact forms, signup forms, surveys, and settings panels",
                tags=["forms", "input", "data-collection"],
                examples=[
                    "Create a contact form with name, email, and message",
                    "Build a signup form with password confirmation",
                    "Make a feedback survey with ratings",
                ],
            ),
            AgentSkill(
                id="create_list",
                name="Create Lists",
                description="Generate todo lists, shopping lists, search results, and notifications",
                tags=["lists", "items", "collections"],
                examples=[
                    "Show me a todo list with 5 items",
                    "Create a shopping list",
                    "Generate a list of notifications",
                ],
            ),
            AgentSkill(
                id="create_card",
                name="Create Cards",
                description="Generate profile cards, product cards, info cards, and stats cards",
                tags=["cards", "profiles", "info"],
                examples=[
                    "Make a profile card for John Doe",
                    "Create a product card with price and description",
                    "Build an info card with contact details",
                ],
            ),
            AgentSkill(
                id="create_confirmation",
                name="Create Confirmations",
                description="Generate success messages, error alerts, and status updates",
                tags=["confirmations", "alerts", "status"],
                examples=[
                    "Show a success confirmation message",
                    "Create an error alert",
                    "Generate a booking confirmation",
                ],
            ),
        ],
    )


@click.command()
@click.option("--host", default="0.0.0.0", help="Host to bind to")
@click.option("--port", default=10002, envvar="PORT", help="Port to listen on")
def main(host: str, port: int):
    """Start the A2A UI Generator agent server."""

    base_url = os.getenv("A2A_BASE_URL", f"http://localhost:{port}")
    logger.info(f"Starting UI Generator agent at {base_url}")

    # Create agent card and executor
    agent_card = create_agent_card(base_url)
    executor = UIGeneratorExecutor(base_url=base_url)

    # Create request handler with task store
    request_handler = DefaultRequestHandler(
        agent_executor=executor,
        task_store=InMemoryTaskStore(),
    )

    # Create Starlette application and build it
    server = A2AStarletteApplication(
        agent_card=agent_card,
        http_handler=request_handler,
    )
    app = server.build()

    # Add CORS middleware for cross-origin requests
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    # Mount static files directory if it exists
    static_dir = os.path.join(os.path.dirname(__file__), "static")
    if os.path.exists(static_dir):
        app.mount("/static", StaticFiles(directory=static_dir), name="static")
        logger.info(f"Serving static files from {static_dir}")

    logger.info(f"Agent card available at {base_url}/.well-known/agent.json")
    logger.info(f"A2UI extension enabled: {get_a2ui_agent_extension().uri}")

    # Run the server
    uvicorn.run(app, host=host, port=port)


if __name__ == "__main__":
    main()
