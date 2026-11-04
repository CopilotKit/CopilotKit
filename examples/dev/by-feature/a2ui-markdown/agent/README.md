# Generative UI LangGraph agent

A LangGraph (Python) chat agent served over AG-UI at
`http://localhost:8011/copilotkit`. The Next.js app in the parent directory
talks to it when you open `http://localhost:3011/?agent=langgraph`.

The graph is a single model node (`create_agent` with no tools) plus
`CopilotKitMiddleware`. The middleware adds the context that CopilotKit sends
(the component schema and the ` ```a2ui ` fence guideline) to the system
prompt. With `?transport=tool`, the middleware binds the `render_ui` tool that
the runtime adds. The agent has no code for generative UI.

## Run

```bash
cp ../.env.example .env   # set OPENAI_API_KEY
uv sync
uv run main.py
```

Environment variables:

- `OPENAI_API_KEY` (required)
- `OPENAI_MODEL` (default `gpt-5.4`)
- `PORT` (default `8011`)
