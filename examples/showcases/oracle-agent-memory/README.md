# Oracle Agent Spec × Memory × CopilotKit

A personal **travel concierge** that shows how to use three things together — it searches flights, renders generative UI (flight cards, boarding-pass ticket), and remembers you across sessions:

- **Oracle Agent Spec** — define the agent once as portable JSON, run it on LangGraph.
- **Oracle AI Database / Agent Memory** — durable, cross-session memory via semantic search.
- **CopilotKit** — the frontend chat layer, over the open [AG-UI](https://docs.ag-ui.com/) protocol.

Tell the concierge your travel preferences, come back in a brand-new session, and
it still knows them — recalled from Oracle AI Database, not the current chat.

> 🌐 Try it live: [hosted demo on Railway](https://showcase-oracle-agent-memory-production.up.railway.app)
> 📖 Full write-up: [the cookbook recipe](../../../showcase/shell-docs/src/content/docs/cookbook/oracle-agent-spec-memory.mdx)

## How it works

```text
Next.js + CopilotKit (V2) ──/api/copilotkit──▶ CopilotRuntime (HttpAgent)
                                                    │  AG-UI (SSE)
                                                    ▼
                                  Agent Spec JSON → ag_ui_agentspec (LangGraph)
                                     recall_memory · search_flights · book_flight (HITL ClientTool)
                                                    │  recall + persist
                                                    ▼
                                        oracleagentmemory → Oracle AI Database
```

The agent is **defined once** in Agent Spec (`agent/concierge/agent.py`) and run on
LangGraph via the `ag_ui_agentspec` adapter. `recall_memory` pulls durable
preferences from Oracle Agent Memory before planning; each turn is persisted so new
preferences are extracted for next time, and a reconcile pass supersedes outdated facts so an updated preference wins on the next recall. CopilotKit consumes the AG-UI endpoint
with an `HttpAgent`, so the agent owns the LLM call.

## Prerequisites

- **Python 3.12** (required — `oracleagentmemory` ships a cp312-only wheel),
  [`uv`](https://docs.astral.sh/uv/), Node.js 18+
- Docker (for the local Oracle AI Database) or your own Oracle AI Database
- `OPENAI_API_KEY` (defaults use OpenAI via litellm)

> **Heads-up:** the frontend uses CopilotKit **V2 prerelease** builds so Agent
> Spec's human-in-the-loop renders, and the `ag_ui_agentspec` adapter is installed
> from the `ag-ui` repo (not PyPI). Both are pinned in the manifests.

## Quickstart

### 1. Start Oracle AI Database (run from this directory)

```bash
docker compose up -d
docker compose logs -f oracle-db   # wait for "DATABASE IS READY TO USE"
./db/setup-db.sh                   # create the cookbook DB user (idempotent)
```

First boot takes a few minutes. The `container-registry.oracle.com/database/free`
image includes AI Vector Search, which `oracleagentmemory` uses for semantic recall.

### 2. Run the agent

```bash
cd agent
cp .env.example .env          # add your OPENAI_API_KEY
uv sync
uv run uvicorn concierge.server:app --reload --port 8000
```

Health check: `curl localhost:8000/health` → `{"status":"ok"}`.

### 3. Run the frontend

```bash
cd frontend
cp .env.local.example .env.local   # optional; defaults to localhost:8000/run
npm install
npm run dev
```

Open http://localhost:3000.

## Try it

1. Tell it: _"I'm vegetarian, I fly from SFO, and I prefer an aisle seat."_
2. Click **"+ New thread"** in the left sidebar, then ask: _"Find me a flight to Amsterdam."_
3. It recalls your preferences from Oracle (home airport SFO, aisle seat, vegetarian meal)
   and surfaces flights like **AMS-001 — KLM KL606, nonstop, $740** as clickable flight
   cards — driven by what it remembered, not what you said in this thread.

**Book it:** select a flight from the cards (or ask _"Book me flight AMS-001 to Amsterdam"_),
then click **Confirm &amp; book** on the confirmation card to get the boarding pass.
`book_flight` is a CopilotKit **ClientTool** so the confirm→book step resolves in one agent run.
Multi-turn follow-ups in the same thread work too, via a server-side workaround — see Notes below.

## Tests

End-to-end Playwright tests drive the real chat UI against the live agent + Oracle
AI Database and record video. See [`frontend/e2e/README.md`](frontend/e2e/README.md):

```bash
cd frontend && npm run test:e2e
```

## Notes

- **User identity** — defaults to a single `demo-user`. The Agent Spec × AG-UI
  adapter doesn't forward `forwarded_props`, so to scope memory per real user, set
  `user_id` from a ContextVar populated by a FastAPI dependency. See
  `agent/concierge/tools.py`.
- **Multi-turn & booking** — `book_flight` is a CopilotKit **ClientTool**
  (`useHumanInTheLoop`), so the confirm→book step resolves inside a single agent run.
  Follow-up messages after a server-tool call would otherwise trip an upstream Agent
  Spec × AG-UI adapter bug (`tool_call_id` correlation); the cookbook works around it in
  `agent/concierge/server.py` by replacing the adapter's incremental message merge with a
  full-history replace each turn, so multi-turn conversations work end-to-end. The
  **"+ New thread"** flow above just proves recall is user-scoped — a fresh thread still
  remembers you. See
  [`docs/known-issues/agentspec-multiturn-toolcall-correlation.md`](docs/known-issues/agentspec-multiturn-toolcall-correlation.md).
- **Models** — set `CHAT_MODEL`, `MEMORY_LLM_MODEL`, `EMBEDDING_MODEL` in `agent/.env`.
