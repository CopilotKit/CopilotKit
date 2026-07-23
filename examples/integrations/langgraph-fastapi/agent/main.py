import os
import warnings
from pathlib import Path
from dotenv import load_dotenv

# Load .env from the demo project root (one level up from agent/) BEFORE
# importing src.agent — that import constructs ChatOpenAI at module load,
# which needs OPENAI_API_KEY in the environment already.
_demo_root = Path(__file__).parent.parent
for env_path in (_demo_root / ".env", Path(".env")):
    if env_path.is_file():
        load_dotenv(env_path)
        break
else:
    load_dotenv()

from fastapi import FastAPI
import uvicorn
from src.agent import graph
from copilotkit import LangGraphAGUIAgent
from ag_ui_langgraph import add_langgraph_fastapi_endpoint

app = FastAPI()


@app.get("/health")
async def health():
    return {"status": "ok"}


add_langgraph_fastapi_endpoint(
    app=app,
    agent=LangGraphAGUIAgent(
        name="sample_agent",
        description="An example agent to use as a starting point for your own agent.",
        graph=graph,
    ),
    path="/",
)


def main():
    """Run the uvicorn server."""
    port = int(os.getenv("PORT", "8123"))
    uvicorn.run(
        "main:app",
        host="0.0.0.0",
        port=port,
        reload=True,
    )


warnings.filterwarnings("ignore", category=UserWarning, module="pydantic")
if __name__ == "__main__":
    main()
