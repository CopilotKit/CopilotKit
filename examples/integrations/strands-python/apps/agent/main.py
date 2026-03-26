import uvicorn
from dotenv import load_dotenv
from pathlib import Path

from src.agent import app

# Load .env from the monorepo root
env_path = Path(__file__).parent.parent.parent / ".env"
load_dotenv(env_path)


def main():
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)


if __name__ == "__main__":
    main()
