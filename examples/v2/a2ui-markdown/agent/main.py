"""Serve each ADK model/format/transport combination through the AG-UI adapter."""

import itertools
import os
from pathlib import Path

from dotenv import load_dotenv

# Share the Next.js example's GOOGLE_API_KEY without relying on the launch cwd.
load_dotenv(Path(__file__).resolve().parent.parent / ".env.local")

import uvicorn
from ag_ui_adk import add_adk_fastapi_endpoint
from fastapi import APIRouter, FastAPI

from src.agent import FORMATS, MODELS, TRANSPORTS, create_agent

app = FastAPI()
for model, format, transport in itertools.product(MODELS, FORMATS, TRANSPORTS):
    router = APIRouter(prefix=f"/copilotkit/{model}/{format}/{transport}")
    # The released wrapper handles streaming disconnects and cancellation. Each
    # router also namespaces the adapter's capabilities and thread-state routes.
    add_adk_fastapi_endpoint(
        app=router,
        agent=create_agent(model, format, transport),
        path="",
    )
    app.include_router(router)


def main():
    """Run the local development server."""
    uvicorn.run(
        "main:app",
        host="localhost",
        port=int(os.getenv("PORT", "8011")),
        reload=True,
        reload_dirs=[str(Path(__file__).resolve().parent)],
    )


if __name__ == "__main__":
    main()
