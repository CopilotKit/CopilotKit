import uvicorn
from dotenv import load_dotenv
from fastapi import FastAPI

from src.agent import agentic_chat_router

app = FastAPI()
app.include_router(agentic_chat_router)


def main():
    load_dotenv()
    uvicorn.run("main:app", host="127.0.0.1", port=9000, reload=True)


if __name__ == "__main__":
    main()
