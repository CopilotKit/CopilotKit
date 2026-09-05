"""Serve the OpenAI Agents SDK agent as an AG-UI endpoint.

Run with: uv sync && uv run python main.py
Requires OPENAI_API_KEY in the environment (see ../.env).
"""

import json
import uuid
from pathlib import Path

import dotenv
from agents import Runner
from fastapi import FastAPI, Request
from fastapi.responses import StreamingResponse

from src.agent import agent

dotenv.load_dotenv(Path(__file__).resolve().parent.parent / ".env")
dotenv.load_dotenv()

app = FastAPI()


@app.get("/health")
async def health():
    return {"status": "ok"}


@app.post("/agui")
async def agui(request: Request):
    body = await request.json()
    messages = body.get("messages", [])
    thread_id = body.get("threadId", str(uuid.uuid4()))
    run_id = body.get("runId", str(uuid.uuid4()))

    # Flatten AG-UI messages to a single input string for the SDK.
    turns = []
    for m in messages:
        role = m.get("role", "user")
        content = m.get("content", "")
        if isinstance(content, list):
            content = " ".join(
                part.get("text", "") for part in content if isinstance(part, dict)
            )
        turns.append(f"{role}: {content}")
    user_input = "\n".join(turns) or "Hello"

    async def event_stream():
        yield f"data: {json.dumps({'type': 'RUN_STARTED', 'threadId': thread_id, 'runId': run_id})}\n\n"
        message_id = str(uuid.uuid4())
        yield f"data: {json.dumps({'type': 'TEXT_MESSAGE_START', 'messageId': message_id})}\n\n"
        result = await Runner.run(agent, user_input)
        text = str(result.final_output or "")
        yield f"data: {json.dumps({'type': 'TEXT_MESSAGE_CONTENT', 'messageId': message_id, 'delta': text})}\n\n"
        yield f"data: {json.dumps({'type': 'TEXT_MESSAGE_END', 'messageId': message_id})}\n\n"
        yield f"data: {json.dumps({'type': 'RUN_FINISHED', 'threadId': thread_id, 'runId': run_id})}\n\n"

    return StreamingResponse(event_stream(), media_type="text/event-stream")


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("main:app", port=8000, reload=True)
