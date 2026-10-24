"""Serve the research desk agent over AG-UI at http://localhost:8014/."""

import logging
import os
from pathlib import Path

import uvicorn
from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parent.parent / ".env")
load_dotenv()
# google-genai reads GOOGLE_API_KEY; accept GEMINI_API_KEY too.
if not os.getenv("GOOGLE_API_KEY") and os.getenv("GEMINI_API_KEY"):
    os.environ["GOOGLE_API_KEY"] = os.environ["GEMINI_API_KEY"]
os.environ.setdefault("GOOGLE_GENAI_USE_VERTEXAI", "FALSE")

from ag_ui_adk import add_adk_fastapi_endpoint  # noqa: E402
from fastapi import FastAPI  # noqa: E402

from research_desk.agent import create_agent  # noqa: E402

logging.basicConfig(level=os.getenv("LOG_LEVEL", "INFO"))

app = FastAPI(title="Research desk agent")


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


add_adk_fastapi_endpoint(app, create_agent(), path="/")

if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=int(os.getenv("AGENT_PORT", "8014")))
