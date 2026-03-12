import os

import uvicorn
from ag_ui_crewai.endpoint import add_crewai_flow_fastapi_endpoint
from dotenv import load_dotenv
from fastapi import FastAPI
from src.agent import SampleAgentFlow

load_dotenv()

app = FastAPI()
add_crewai_flow_fastapi_endpoint(app, SampleAgentFlow(), "/")


def main():
    """Run the uvicorn server."""
    port = int(os.getenv("PORT", "8000"))
    uvicorn.run(
        "main:app",
        host="0.0.0.0",
        port=port,
        reload=True,
    )


if __name__ == "__main__":
    main()
