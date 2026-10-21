# Generative UI ADK agent

A generic Google ADK assistant using the released `ag-ui-adk` middleware.
The Next.js demo supplies its catalog, surface context, and frontend tools on
every run. The system instruction is deliberately minimal.

Follow the [example setup](../README.md). The server reads `GOOGLE_API_KEY` from
`../.env.local` regardless of the working directory; Vertex AI is disabled.
Dependencies are pinned in `pyproject.toml` and resolved in `uv.lock`.

Each configuration has its own endpoint and session namespace:
`/copilotkit/{model}/{format}/{transport}`. The frontend selects one of the eight
combinations of Gemini 3.6/3.8 Flash, Express/JSON, and tool/markdown. Existing
LangGraph and built-in OpenAI backends are removed.

- `src/agent.py`: ADK configuration, generic application-context instruction,
  frontend tool binding, and the Express event boundary.
- `src/express.py`: convert the received catalog into SDK schemas, generate
  Express instructions, and compile A2UI v1.0 operations.
- `src/transport.py`: incremental markdown conversion and compilation of genuine
  tool-call arguments. Valid partial programs can render before completion;
  final compiler errors are visible. Tool calls may be buffered with API-key
  access, as explained in the parent README.

This development server uses in-memory sessions. Restarting it loses history.
