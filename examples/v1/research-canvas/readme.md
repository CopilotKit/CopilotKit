# CoAgents Research Canvas Example

This example demonstrates a research canvas UI.

This example uses CopilotKit v2. See the [v1 to v2 migration guide](https://docs.copilotkit.ai/migrate/v2) when updating another CopilotKit app.

**Live demo:** https://copilotkit.ai/examples/canvas-research

Tutorial Video:

[![IMAGE ALT TEXT](http://img.youtube.com/vi/0b6BVqPwqA0/0.jpg)](http://www.youtube.com/watch?v=0b6BVqPwqA0 "Build Agent-Native Apps with LangGraph & CoAgents (tutorial)")

---

## Run with the Python agent

From this example's directory, install the UI and Python dependencies:

```sh
pnpm install
pnpm install:agent:py
```

Create `agents/python/.env`:

```sh
OPENAI_API_KEY=...
TAVILY_API_KEY=...
```

Start the UI and Python agent together:

```sh
pnpm dev
```

The Python agent requires Python 3.12 and [uv](https://docs.astral.sh/uv/).

## Run with the TypeScript agent

Install the TypeScript agent and create `agents/typescript/.env` with the same
OpenAI and Tavily keys. Add `LANGSMITH_API_KEY` only when your LangGraph setup
requires it.

```sh
pnpm install:agent:ts
cd agents/typescript
pnpm exec langgraph dev --host localhost --port 8123
```

In another terminal, start the UI from this example's directory and point the
runtime at that LangGraph server:

```sh
LGC_DEPLOYMENT_URL=http://localhost:8123 pnpm dev:ui
```

## Usage

Navigate to [http://localhost:3000](http://localhost:3000).

## LangGraph Studio

Run LangGraph Studio, then load `agents/python` or `agents/typescript`.

# Troubleshooting

A few things to try if you are running into trouble:

1. Make sure there is no other local application server running on the 8000 port.
2. If your machine cannot bind to `0.0.0.0`, change the host in `agents/python/main.py` to `127.0.0.1`.
