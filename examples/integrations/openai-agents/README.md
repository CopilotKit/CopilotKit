# CopilotKit <> OpenAI Agents SDK Starter

Minimal starter template for building AI agents using the [OpenAI Agents SDK](https://github.com/openai/openai-agents-python) (`openai-agents` on PyPI) and [CopilotKit](https://copilotkit.ai). It pairs a Next.js chat UI with a small Python agent served over AG-UI.

## Prerequisites

- Node.js 20+
- Python 3.10+
- [uv](https://docs.astral.sh/uv/) (Python package manager)
- OpenAI API Key (for the agent)

## Getting Started

1. Install dependencies:

```bash
npm install
```

> **Note:** Installing dependencies also installs the agent's Python dependencies via the `install:agent` script.

2. Set up your OpenAI API key:

```bash
export OPENAI_API_KEY="your-openai-api-key-here"
```

or create a `.env` file:

```bash
echo "OPENAI_API_KEY=your-openai-api-key-here" > .env
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
- `agent/src/agent.py` — the OpenAI Agents SDK `Agent` definition.
- `agent/main.py` — FastAPI server exposing the agent over AG-UI SSE (`POST /agui`).

## Notes

- This is a minimal starter, not a full investment-analyst demo: the agent answers with `Runner.run` and streams the final text as AG-UI events.
- Set `AGENT_URL` in `.env` if the agent runs on a different host or port.
