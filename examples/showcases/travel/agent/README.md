# Travel Planner Agent

This Python LangGraph agent manages trips in shared state and searches Google
Maps for places. `main.py` serves it as an AG-UI endpoint for the CopilotKit v2
frontend in `examples/showcases/travel`.

## Run the agent

From `examples/showcases/travel`, create `agent/.env`:

```text
OPENAI_API_KEY=...
GOOGLE_MAPS_API_KEY=...
```

Install the locked Python dependencies and start the server:

```sh
pnpm install:agent
pnpm dev:agent
```

The server listens on `http://localhost:8000/copilotkit` by default.

## Agent diagram

![Agent diagram](./static/agent-diagram.png)
