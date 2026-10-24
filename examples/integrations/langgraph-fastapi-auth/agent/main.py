import os
import sys
from pathlib import Path

from dotenv import load_dotenv

# Load .env from the example root (one level up from agent/), falling back to
# the current directory. The ChatOpenAI model in agent.py reads OPENAI_API_KEY
# from the environment.
_example_root = Path(__file__).parent.parent
for env_path in (_example_root / ".env", Path(".env")):
    if env_path.is_file():
        load_dotenv(env_path)
        break

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
import uvicorn
from ag_ui_langgraph import add_langgraph_fastapi_endpoint
from agent import graph, CustomLangGraphAGUIAgent
from file_routes import router as file_router

app = FastAPI()

# Add CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://localhost:3001"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# add new route for health check (must be defined before langgraph endpoint)
@app.get("/health")
def health():
    """Health check."""
    return {"status": "ok"}

app.include_router(file_router)

add_langgraph_fastapi_endpoint(
  app=app,
  agent=CustomLangGraphAGUIAgent(
    name="agent_with_auth", # must match the agent id in the CopilotKit runtime route
    description="Describe your agent here, will be used for multi-agent orchestration",
    graph=graph, # the graph object from your langgraph import
  )
)

def main():
    """Run the uvicorn server. Pass --no-reload to run without the dev auto-reloader."""
    if not os.getenv("OPENAI_API_KEY"):
        raise SystemExit("OPENAI_API_KEY is required. Copy .env.example to .env and set it.")

    port = int(os.getenv("AGENT_PORT", "8000"))
    uvicorn.run(
        "main:app", # the path to your FastAPI file
        host="0.0.0.0",
        port=port,
        reload="--no-reload" not in sys.argv[1:],
    )

if __name__ == "__main__":
    main()
