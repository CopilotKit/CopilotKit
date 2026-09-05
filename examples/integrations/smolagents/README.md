# CopilotKit <> SmolAgents Starter

Minimal starter template for building AI agents using [SmolAgents](https://github.com/huggingface/smolagents) (`smolagents` on PyPI) and [CopilotKit](https://copilotkit.ai). It pairs a Next.js chat UI with a small Python `CodeAgent` served over AG-UI.

## Prerequisites

- Node.js 20+
- Python 3.10+
- [uv](https://docs.astral.sh/uv/) (Python package manager)
- An inference API key (SmolAgents' default `InferenceClientModel` reads the HuggingFace/OpenAI-compatible credentials from the environment)

## Getting Started

1. Install dependencies:

```bash
npm install
```

> **Note:** Installing dependencies also installs the agent's Python dependencies via the `install:agent` script.

2. Set up your API key:

```bash
export OPENAI_API_KEY="your-api-key-here"
```

or create a `.env` file:

```bash
echo "OPENAI_API_KEY=your-api-key-here" > .env
```

3. Start the development servers:

```bash
npm run dev
```

This starts the Next.js UI (`http://localhost:3000`) and the Python agent (`http://localhost:8000`, `/agui` endpoint with a `/health` check).

## Layout

- `src/app/page.tsx` — minimal `CopilotSidebar` chat UI.
- `src/app/api/copilotkit/[[...slug]]/route.ts` — CopilotKit runtime proxying to the Python agent.
- `src/agent.ts` — shared `HttpAgent` pointing at `AGENT_URL` (defaults to `http://localhost:8000/agui`).
- `agent/src/agent.py` — the SmolAgents `CodeAgent` definition (`tools=[]` by default; add tools as needed).
- `agent/main.py` — FastAPI server exposing the agent over AG-UI SSE (`POST /agui`).

## Notes

- This is a minimal starter, not a full demo: the agent runs the flattened chat as one `CodeAgent` task and streams the final text as AG-UI events.
- Add SmolAgents tools to `agent/src/agent.py` (for example `WebSearchTool`) and set `AGENT_URL` in `.env` if the agent runs elsewhere.
