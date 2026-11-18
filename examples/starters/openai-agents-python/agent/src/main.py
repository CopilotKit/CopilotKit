"""The agent server: POST / runs the agent over AG-UI, GET /health answers ok."""

from ag_ui_openai_agents import add_openai_agents_fastapi_endpoint
from fastapi import FastAPI

from agent import agent

app = FastAPI(title="CopilotKit OpenAI Agents SDK starter")
add_openai_agents_fastapi_endpoint(app, agent, "/", include_health=False)


@app.get("/health")
def health() -> dict:
    return {"status": "ok"}


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
