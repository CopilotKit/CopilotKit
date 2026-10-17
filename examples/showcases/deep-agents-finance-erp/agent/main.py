"""Finance ERP Agent — FastAPI + CopilotKit AG-UI entry point."""

import os
import uvicorn
from dotenv import load_dotenv

load_dotenv()

import json
import logging

from ag_ui_langgraph import add_langgraph_fastapi_endpoint
from copilotkit import LangGraphAGUIAgent
from copilotkit.langgraph import copilotkit_customize_config
from fastapi import FastAPI, Request
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request as StarletteRequest

from agent import build_agent

logger = logging.getLogger("finance_erp")
logging.basicConfig(level=logging.INFO)


# ---------------------------------------------------------------------------
# Diagnostic middleware — logs every incoming request to help debug multi-turn
# ---------------------------------------------------------------------------
class RequestLoggingMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: StarletteRequest, call_next):
        if request.method == "POST" and "copilotkit" in request.url.path:
            body = await request.body()
            try:
                data = json.loads(body)
                logger.info(
                    "[REQUEST] %s thread_id=%s run_id=%s messages=%d",
                    request.url.path,
                    data.get("threadId", "?"),
                    data.get("runId", "?"),
                    len(data.get("messages", [])),
                )
            except Exception:
                logger.info("[REQUEST] %s (could not parse body)", request.url.path)
        response = await call_next(request)
        return response


app = FastAPI(title="Finance ERP Agent")
app.add_middleware(RequestLoggingMiddleware)

agent_graph = build_agent()

# Emission is all-or-none. A name list is not a whitelist.
agui_config = copilotkit_customize_config(
    emit_tool_calls=True,
    emit_messages=True,
)
agui_config["recursion_limit"] = 100

add_langgraph_fastapi_endpoint(
    app=app,
    agent=LangGraphAGUIAgent(
        name="finance_erp_agent",
        description=(
            "A finance ERP assistant that can analyze invoices, review accounts, "
            "check inventory levels, manage HR data, generate financial reports, "
            "and provide actionable business insights."
        ),
        graph=agent_graph,
        config=agui_config,
    ),
    path="/copilotkit/agents/finance_erp_agent",
)


@app.get("/health")
async def health():
    return {"status": "ok"}


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 8123))
    uvicorn.run("main:app", host="0.0.0.0", port=port, reload=True)
