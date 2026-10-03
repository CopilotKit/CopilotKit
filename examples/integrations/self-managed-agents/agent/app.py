"""A minimal AG-UI agent served directly by FastAPI, without a Node runtime."""

from pathlib import Path
from uuid import uuid4

from ag_ui.core import (
    RunAgentInput,
    RunFinishedEvent,
    RunStartedEvent,
    TextMessageContentEvent,
    TextMessageEndEvent,
    TextMessageStartEvent,
)
from ag_ui.encoder import EventEncoder
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from fastapi.staticfiles import StaticFiles

app = FastAPI(title="Self-managed AG-UI example")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_methods=["POST"],
    allow_headers=["Content-Type", "Accept"],
)


@app.post("/ag-ui")
async def run_agent(input_data: RunAgentInput, request: Request) -> StreamingResponse:
    """Echo the latest user message using the standard AG-UI event stream."""
    encoder = EventEncoder(accept=request.headers.get("accept"))
    user_message = next(
        (
            message.content
            for message in reversed(input_data.messages)
            if message.role == "user" and isinstance(message.content, str)
        ),
        "",
    )
    reply = f"You said: {user_message}" if user_message else "Say something to get started."
    message_id = str(uuid4())

    async def events():
        yield encoder.encode(
            RunStartedEvent(thread_id=input_data.thread_id, run_id=input_data.run_id)
        )
        yield encoder.encode(TextMessageStartEvent(message_id=message_id, role="assistant"))
        yield encoder.encode(TextMessageContentEvent(message_id=message_id, delta=reply))
        yield encoder.encode(TextMessageEndEvent(message_id=message_id))
        yield encoder.encode(
            RunFinishedEvent(thread_id=input_data.thread_id, run_id=input_data.run_id)
        )

    return StreamingResponse(events(), media_type=encoder.get_content_type())


# Once the React app is built, this one Python process serves both the static UI
# and the AG-UI endpoint. The API still works alone before the frontend is built.
frontend_dist = Path(__file__).resolve().parent.parent / "frontend" / "dist"
if frontend_dist.is_dir():
    app.mount("/", StaticFiles(directory=frontend_dist, html=True), name="frontend")
