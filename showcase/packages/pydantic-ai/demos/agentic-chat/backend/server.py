"""FastAPI wrapper that mounts the PydanticAI agent at /."""

import os
import uvicorn
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from dotenv import load_dotenv

from agent import agent, State, StateDeps

load_dotenv()

app = FastAPI(title="PydanticAI Agent — agentic-chat")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
async def health():
    return {"status": "ok"}


# Mount the PydanticAI AG-UI endpoint at the root.
ag_ui_app = agent.to_ag_ui(deps=StateDeps(State()))
app.mount("/", ag_ui_app)


if __name__ == "__main__":
    port = int(os.getenv("AGENT_PORT", "8000"))
    uvicorn.run("server:app", host="0.0.0.0", port=port, reload=False)
