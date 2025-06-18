from fastapi import FastAPI
from .agent import agentic_chat_router

app = FastAPI()
app.include_router(agentic_chat_router)
