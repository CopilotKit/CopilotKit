"""
Serves `main.graph` over AG-UI so `route-b.ts`'s `HttpAgent` can dial it directly.

There is no TypeScript runtime in this path. AG-UI is the wire protocol, so the
channel talks straight to this FastAPI endpoint — `runtime.ts` (TanStack +
Linear/Notion MCP) is not involved and needs no credentials.

  route-b.ts  ──AG-UI/SSE──▶  http://127.0.0.1:8210/agent/thing/run  ──▶  graph

Run:  uv run serve.py     (needs OPENAI_API_KEY)
"""

import os

import uvicorn
from ag_ui_langgraph import LangGraphAgent, add_langgraph_fastapi_endpoint
from dotenv import load_dotenv
from fastapi import FastAPI

from main import graph

load_dotenv()

if not os.environ.get("OPENAI_API_KEY"):
    raise SystemExit(
        "[agent-py] OPENAI_API_KEY is not set. Put it in examples/slack/.env "
        "or export it before running."
    )

app = FastAPI()

# The path here is the whole of AGENT_URL's path — keep it in sync with the
# AGENT_URL that route-b.ts reads.
add_langgraph_fastapi_endpoint(
    app=app,
    agent=LangGraphAgent(
        name="thing",
        description="Minimal interrupt/resume probe agent.",
        graph=graph,
    ),
    path="/agent/thing/run",
)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


if __name__ == "__main__":
    port = int(os.environ.get("AGENT_PORT", "8210"))
    print(f"[agent-py] AG-UI endpoint: http://127.0.0.1:{port}/agent/thing/run")
    uvicorn.run(app, host="127.0.0.1", port=port)
