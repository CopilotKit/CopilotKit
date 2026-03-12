from fastapi import FastAPI
from pathlib import Path
import os

# Load environment variables from .env/.env.local (repo root or agent dir) if present
try:
    from dotenv import load_dotenv  # type: ignore
except Exception:
    load_dotenv = None  # python-dotenv may not be installed yet

def _load_env_files() -> None:
    if load_dotenv is None:
        return
    here = Path(__file__).resolve()
    candidates = [
        here.parents[2] / ".env.local",  # repo root/.env.local
        here.parents[2] / ".env",        # repo root/.env
        here.parents[1] / ".env.local",  # agent/.env.local
        here.parents[1] / ".env",        # agent/.env
    ]
    for p in candidates:
        if p.exists():
            load_dotenv(p, override=False)

_load_env_files()

from .agent import agentic_chat_router

app = FastAPI()
app.include_router(agentic_chat_router)
