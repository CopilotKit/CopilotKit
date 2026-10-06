# agent-myelin

Myelin's journey-builder admin agent: a real **Google ADK** `LlmAgent`, served
over AG-UI with `ag-ui-adk` (`ADKAgent` + `add_adk_fastapi_endpoint`). The myelin
skin reaches it as a plain `HttpAgent` at `MYELIN_AGENT_URL`
(default `http://localhost:8125/`).

- `main.py`: server tools (they call the app's REST API at `MYELIN_API_BASE`
  as `x-myelin-actor: agent`), the instruction provider that appends the
  browser's screen context (`_ag_ui_context`) to the prompt, and the FastAPI app.
- `prompt.py`: the system prompt, as ALL-CAPS clauses, with a clause-to-beat map.
- `smoke_tools.py`: calls every server tool directly (needs the Next dev server).

`AGUIToolset()` in the tool list is what exposes the browser's frontend tools
(`openJourney`, `showJourney`, `reviewPublish`, `showLearners`, teach mode) and
the Intelligence memory tools (`recall_memory`, `save_memory`, `forget_memory`)
to the model.

## Run

```sh
uv sync
.venv/bin/python main.py        # :8125, GET /health, AG-UI at /
```

`./run-demo.sh` at the app root does this for you, and `./stop-demo.sh` stops it.

## Env

Loaded from `agent-myelin/.env` first, then the app's `../.env`.

| Var                 | Default                               |                              |
| ------------------- | ------------------------------------- | ---------------------------- |
| `OPENAI_API_KEY`    |                                       | needed for the default model |
| `MYELIN_MODEL`      | `openai/gpt-5.4`                      | any LiteLLM model id         |
| `MYELIN_API_BASE`   | `http://localhost:3000/api/myelin/v1` | the app's REST API           |
| `MYELIN_AGENT_PORT` | `8125`                                |                              |

**Switching to Gemini is one env var:** `MYELIN_MODEL=gemini-2.5-flash` (plus
`GOOGLE_API_KEY`). A `gemini*` name is passed to ADK directly and runs on native
Gemini; anything else goes through ADK's `LiteLlm` wrapper. Nothing else changes.

## Privacy

No tool returns learner names or ids. `get_workspace` drops the ledger's
learners, presence and activity; `check_audience` turns learner ids into counts.
Names are rendered client-side only.
