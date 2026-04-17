import os
import uvicorn
from ag_ui_crewai.endpoint import add_crewai_crew_fastapi_endpoint
from fastapi import FastAPI
from dotenv import load_dotenv
from src.latest_ai_development.crew import LatestAiDevelopment

load_dotenv()

app = FastAPI()


@app.get("/health")
async def health():
    return {"status": "ok"}


add_crewai_crew_fastapi_endpoint(app, LatestAiDevelopment(), "/")

def main():
  """Run the uvicorn server."""
  port = int(os.getenv("PORT", "8000"))
  uvicorn.run(
    "server:app",
    host="0.0.0.0",
    port=port,
    reload=True,
  )

if __name__ == "__main__":
  main()