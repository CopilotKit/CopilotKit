# Google ADK agent, rendered with A2UI 1.0

A plain [Google ADK](https://google.github.io/adk-docs/) `LlmAgent` on Gemini Flash, served over [AG-UI](https://docs.ag-ui.com) with [`ag-ui-adk`](https://pypi.org/project/ag-ui-adk/), answering with the playground's components.

```
browser /adk ──► /api/adk (CopilotRuntime + HttpAgent) ──► this server (ADKAgent) ──► Gemini
   ▲                   │ adds render_ui + the catalog guide
   └── A2UI v1.0 ops ──┘ validates each operation against the catalog
```

The agent has no A2UI code. `/adk` passes `generativeUI={{ ui }}` to `CopilotKitProvider`, so every run carries the catalog. The CopilotKit runtime's generative UI middleware reads it and adds to the AG-UI request it forwards:

- a `render_ui` tool. `AGUIToolset()` in `agent.py` declares the tools the client sends to the model;
- the generative UI guide (the components, their props, the A2UI v1.0 operation format), as AG-UI context. `ag-ui-adk` stores context in session state, and the instruction provider in `agent.py` appends it to the prompt.

When Gemini calls `render_ui`, the runtime validates each operation as it streams and sends it to the browser, which renders it with the React components. The middleware applies to any AG-UI agent the runtime fronts (`HttpAgent` included), not only `BuiltInAgent`.

## Run it

Requires Python 3.11+, [uv](https://docs.astral.sh/uv/) and a Gemini API key ([AI Studio](https://aistudio.google.com/apikey)).

```bash
cd examples/adk
uv sync                              # creates .venv
export GOOGLE_API_KEY=your-key
uv run server.py                     # AG-UI endpoint on http://localhost:8000/
```

In another terminal, from the repo root:

```bash
pnpm dev                             # then open http://localhost:3100/adk
```

## Configuration

| Variable | Default | What it does |
| --- | --- | --- |
| `ADK_MODEL` | `gemini-3.5-flash` | The Gemini model the agent runs on. |
| `GOOGLE_API_KEY` | | Gemini API key (or `GEMINI_API_KEY`). For Vertex AI set `GOOGLE_GENAI_USE_VERTEXAI=true`, `GOOGLE_CLOUD_PROJECT` and `GOOGLE_CLOUD_LOCATION` instead. |
| `HOST`, `PORT` | `127.0.0.1`, `8000` | Where the server listens. |
| `ADK_AGENT_URL` | `http://localhost:8000/` | Read by the Next.js route `src/app/api/adk/[[...slug]]/route.ts`, if the agent runs elsewhere. |

## Files

- `agent.py`: the ADK agent (`root_agent`).
- `server.py`: wraps it in `ADKAgent` and serves it with `add_adk_fastapi_endpoint` (FastAPI + uvicorn).
- `pyproject.toml`, `uv.lock`: `google-adk`, `ag-ui-adk`, `uvicorn`.

Without uv: `python -m venv .venv && .venv/bin/pip install google-adk ag-ui-adk uvicorn && .venv/bin/python server.py`.
