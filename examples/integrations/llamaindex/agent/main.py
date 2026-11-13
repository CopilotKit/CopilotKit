from pathlib import Path

import uvicorn
from dotenv import load_dotenv
from fastapi import FastAPI

# Load .env BEFORE importing the agent: it reads COPILOTKIT_AGENT_MODEL and the
# provider keys when it builds its LLM at import time, including under a
# direct `uvicorn main:app`.
load_dotenv(Path(__file__).resolve().parent.parent / ".env")
load_dotenv()

from src.agent import agentic_chat_router  # noqa: E402

app = FastAPI()


@app.get("/health")
async def health():
    return {"status": "ok"}


app.include_router(agentic_chat_router)


def main():
    uvicorn.run("main:app", host="127.0.0.1", port=9000, reload=True)


if __name__ == "__main__":
    main()
