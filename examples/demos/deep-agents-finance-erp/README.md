# Deep Agents Finance ERP

A finance ERP showcase powered by CopilotKit deep agents. An AI assistant can analyze invoices, review accounts, check inventory, manage HR data, generate financial reports, compose themed dashboards, and provide actionable business insights.

**Stack:** Next.js 16 (frontend) + FastAPI / LangGraph (agent) + Postgres (persistence) + CopilotKit (AI layer)

**Highlights:**

- 7 frontend tools (6 UI + 1 HITL) registered via `useRenderTool` / `useHumanInTheLoop`
- 12 dashboard widget types with 4 pre-built templates (Executive Summary, Cash Flow Risk, Cost Control, Revenue Overview)
- Dashboard gallery (`/dashboards`) for browsing, loading, saving, and deleting layouts
- Multi-agent orchestration: orchestrator + research subagent (13 tools) + projections subagent (6 tools)
- Human-in-the-loop approval for invoice payments and inventory reorders

## Prerequisites

- [Docker](https://docs.docker.com/get-docker/) (for Postgres)
- Python 3.11+
- Node.js 18+
- An OpenAI API key

## Quick start

```bash
npm run dev:all
```

This single command starts Postgres, seeds the database, launches the agent, and runs the frontend. Open [http://localhost:3000](http://localhost:3000).

## Step-by-step setup

### 1. Postgres

```bash
npm run db        # start the container
npm run db:seed   # start container + seed tables
```

### 2. Agent (Python)

Copy the example env and add your OpenAI key:

```bash
cp agent/.env.example agent/.env
# edit agent/.env — set OPENAI_API_KEY
```

Then start the agent:

```bash
npm run agent     # installs deps in a venv, starts FastAPI on port 8123
```

### 3. Frontend (Next.js)

```bash
npm run env:init  # creates .env.local from example (if missing)
npm run dev       # starts Next.js on port 3000
```

## Environment variables

### `agent/.env`

| Variable            | Description                                                                                           |
| ------------------- | ----------------------------------------------------------------------------------------------------- |
| `OPENAI_API_KEY`    | OpenAI API key (required)                                                                             |
| `OPENAI_MODEL`      | Model to use (default: `gpt-5.4-2026-03-05`)                                                          |
| `DATABASE_URL`      | Postgres connection string (default: `postgresql://erp_user:erp_password@localhost:5432/finance_erp`) |
| `LANGCHAIN_API_KEY` | LangSmith key for tracing (optional)                                                                  |

### `.env.local`

| Variable            | Description                                                                      |
| ------------------- | -------------------------------------------------------------------------------- |
| `REMOTE_ACTION_URL` | Agent URL (default: `http://localhost:8123/copilotkit/agents/finance_erp_agent`) |

## Scripts

| Script             | Description                                           |
| ------------------ | ----------------------------------------------------- |
| `npm run dev:all`  | Start everything (Postgres + seed + agent + frontend) |
| `npm run db`       | Start Postgres container                              |
| `npm run db:seed`  | Start Postgres and seed tables                        |
| `npm run agent`    | Install Python deps and start the agent (port 8123)   |
| `npm run dev`      | Start Next.js dev server (port 3000)                  |
| `npm run env:init` | Create `.env.local` from example (if missing)         |
| `npm run stop`     | Stop all running services                             |
| `npm run clean`    | Stop services, remove container and Python venv       |

## Architecture

```
Browser (:3000)
  |
  |  Next.js API route (/api/copilotkit)
  |       |
  |       v
  |  CopilotKit Runtime (LangGraphHttpAgent)
  |       |  AG-UI / SSE
  |       v
  |  FastAPI (:8123)
  |       |
  |       v
  |  LangGraph Orchestrator (7 frontend tools + task)
  |      /         \
  |     v           v
  |  Research    Projections
  |  Sub-agent   Sub-agent
  |  (13 tools)  (6 tools)
  |     |
  |     v
  |  Postgres (:5432) — dashboards, seed data
  |
```

## Pages

| Route         | Description                                                              |
| ------------- | ------------------------------------------------------------------------ |
| `/`           | Dashboard — KPI cards, charts, transactions, invoices (agent-composable) |
| `/dashboards` | Gallery — browse templates, save/load/delete custom layouts              |
| `/invoices`   | Invoice list with filtering and summary cards                            |
| `/accounts`   | Chart of accounts and transaction ledger                                 |
| `/inventory`  | Stock management and reorder alerts                                      |
| `/hr`         | Employee directory and department breakdown                              |
