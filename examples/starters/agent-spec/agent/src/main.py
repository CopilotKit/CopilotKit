import os
import uvicorn
from fastapi import FastAPI

from agent import build_a2ui_chat_agent
from logging_utils import configure_logging

from ag_ui_agentspec.endpoint import add_agentspec_fastapi_endpoint


def build_server() -> FastAPI:
    configure_logging()
    app = FastAPI(title="Agent Spec Agent")
    agent = build_a2ui_chat_agent(runtime="wayflow")
    add_agentspec_fastapi_endpoint(app, agent, path="/")
    return app


app = build_server()


@app.get("/health")
async def health():
    return {"status": "ok"}


if __name__ == "__main__":
    uvicorn.run(
        "main:app",
        host="0.0.0.0",
        port=int(os.getenv("PORT", "8000")),
        reload=True,
        log_level="info",
        log_config=None,  # use our logging config below
    )
