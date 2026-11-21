# CopilotKit PM Copilot — `project-management-copilot`

## Purpose

A polished, on-brand **showcase** (and fork-and-extend template) for building
agent-driven applications with CopilotKit v2. The app is a mini **Linear /
Notion**: a kanban project-management board that a copilot can drive, observe,
and reason about — well beyond a chat box.

**Target audience:** developers evaluating CopilotKit, or starting a new project
with AI agents that manipulate real application state and render generative UI.

## Core concept

A **kanban PM board** demonstrates agent-driven UI where state lives in the
agent and syncs bidirectionally with the frontend (the CopilotKit v2 agent-state
pattern):

- **5 statuses:** Backlog / Todo / In Progress / In Review / Done
- **4 priorities:** Urgent / High / Med / Low
- The agent mutates the board (create / move / reassign issues) via tools; the
  user edits the same board directly; both write the same `agent.state.issues`.
- The UI reactively re-renders whenever agent state changes.

Two agents drive the same board, swappable from an **in-chat agent selector**:

- **LangGraph kanban copilot** (`apps/agent`, port 8123) — the primary agent.
  Owns the board, HITL approvals, backlog analysis, and generative-UI cards.
- **Google ADK "Dashboard Designer"** (`apps/agent-adk`, port 8124) — a second
  agent that filters / focuses a stats dashboard over the same issues. It proves
  the AG-UI protocol is agent-framework-agnostic: both agents emit identical
  AG-UI events, visible side-by-side in the event inspector.

## Architecture

Standalone **npm-workspaces monorepo** — it keeps its own `package-lock.json`
and is intentionally *not* wired into the CopilotKit root workspace or CI. It
consumes published `@copilotkit/*` packages (the v2 surface:
`@copilotkit/react-core/v2` on the frontend, `@copilotkit/runtime` on the BFF),
pinned.

| Service | Port | Description |
| --- | --- | --- |
| Frontend (`apps/app`) | 3000 (Vite picks 3000+) | Vite 7 + React 19 + Tailwind 4, CopilotKit v2 |
| BFF (`apps/bff`) | 4000 | Hono + CopilotRuntime; registers `default` / `langgraph` / `adk` agents; forwards Whisper transcription; hosts the MCP App tile |
| LangGraph agent (`apps/agent`) | 8123 | Python, openai:gpt-4.1 |
| Google ADK agent (`apps/agent-adk`) | 8124 | Python, LiteLLM → openai/gpt-4.1 |
| Docker infra (Postgres / Redis / Intelligence) | 5432 / 6379 / 4201 / 4401 | Threads persistence + realtime |
| aimock (optional) | 4010 | OpenAI-shaped mock for deterministic demos |

The frontend talks **only** to the BFF. The BFF fronts the CopilotRuntime and
routes to whichever Python backend the agent selector picks.

### Repository structure

```
apps/
├── app/                      # Vite + React frontend
│   ├── server.mjs            # prod static server (Hono); proxies /api/copilotkit → BFF
│   ├── public/               # brand SVGs, sprint-52.png (git-LFS)
│   └── src/
│       ├── App.tsx           # app shell — wires chat, board, agents, tools menu, voice
│       ├── components/
│       │   ├── pm-board/     # kanban board, issue types, analysis-timeline
│       │   ├── dashboard/    # ADK Dashboard Designer surface
│       │   ├── generative-ui/# chat cards: issue-card/list/table, charts, approval-card, attach-meeting-notes
│       │   ├── agent-selector/  threads-drawer/  event-inspector/  theme-shell/  paint/  ui/
│       │   └── tool-rendering.tsx
│       └── hooks/
│           ├── use-generative-ui-examples.tsx  # useComponent / useFrontendTool / useHumanInTheLoop registrations
│           └── use-example-suggestions.tsx     # suggestion chips (LangGraph + ADK)
├── bff/                      # Hono + CopilotRuntime
│   └── src/server.ts         # runtime, agent registration, WhisperTranscriptionService, mcpApps
├── agent/                    # LangGraph Python agent
│   ├── main.py               # create_agent + tool/state wiring + system prompt
│   └── src/                  # issues.py (board state + tools), analysis.py, query.py, a2ui_* (A2UI demo)
└── agent-adk/                # Google ADK Python agent
    ├── main.py               # ADK app + ag_ui_adk bridge
    └── src/                  # tools.py, issues_data.py
```

## Key pattern: agent state with CopilotKit v2

State lives in the agent backend and syncs bidirectionally with the frontend.

- Frontend **reads** via `useAgent().state.issues`. Bind to the per-thread agent
  clone with `agentId` from `useCopilotChatConfiguration()` — otherwise
  `useAgent()` resolves a different default clone the board never sees.
- Frontend **writes** via `agent.setState({ ...agent.state, issues })`. Always
  spread the current state first: `setState` replaces the whole object, so a
  bare `setState({ issues })` would clobber sibling keys (`analysis`,
  `dashboard`).
- Agent **mutates** state via tools (`manage_issues`, `propose_issue_change`,
  `analyze_backlog`, …), returning `Command(update={...})`.

## Features

- **Kanban board** — 5 columns, drag-and-drop, click-to-edit (`components/pm-board/`).
- **Generative-UI chat cards** — inline issue cards / lists / tables and pie/bar
  charts registered via `useComponent` (`components/generative-ui/`).
- **HITL approval card** — accept / reject / inline-edit a proposed single-issue
  change, via `useHumanInTheLoop` paired with the agent's `propose_issue_change`
  (`generative-ui/approval-card.tsx`).
- **Shared-state analysis timeline** — a live "thinking" panel that fills from
  `copilotkit_emit_state` during `analyze_backlog` (`pm-board/analysis-timeline.tsx`).
- **Threads drawer** — search / rename / archive prior threads persisted to
  Postgres (`components/threads-drawer/`; seed with `npm run seed:threads`).
- **PTT voice** — push-to-talk mic transcribed by OpenAI Whisper
  (`WhisperTranscriptionService` on the BFF).
- **MCP App tile** — Excalidraw surfaced as an MCP app (`apps/bff/src/server.ts` mcpApps).
- **AG-UI event inspector** — right-panel stream of raw AG-UI events for whichever
  agent is active (`components/event-inspector/`).
- **Second agent (Google ADK)** — the Dashboard Designer, selectable from the chat header.

## Development

```bash
npm install            # install all workspaces (uv + Docker required — the preinstall/predev gate enforces this)

npm run dev            # docker infra + app + bff + both agents
npm run dev:mock       # deterministic demo: aimock (4010) replays fixtures/*.json, no API key needed

# individual services
npm run dev:app        # Vite frontend
npm run dev:bff        # CopilotKit runtime BFF
npm run dev:agent      # LangGraph agent
npm run dev:agent-adk  # Google ADK agent

npm run build          # build bff (tsc) + app (vite)
npm run seed:threads   # populate the threads drawer for the demo
npm run aimock:record  # record new fixtures against the real OpenAI API
```

### Environment

```bash
cp .env.example .env               # set OPENAI_API_KEY
copilotkit license -n my-project   # one-time
```

## Deterministic demo mode (aimock)

Real-LLM demos are flaky. `npm run dev:mock` boots aimock on port 4010 and runs
every service with `USE_MOCK=1`, flipping `OPENAI_BASE_URL` to the local mock.
All chat completions **and** Whisper transcripts replay from `fixtures/*.json`,
so the walkthrough is repeatable without an API key.

## Tech stack

- **Frontend:** Vite 7, React 19, TailwindCSS 4, CopilotKit v2, Recharts (charts)
- **BFF:** Hono, `@copilotkit/runtime`, `@ag-ui/client`
- **Agents:** LangGraph (Python) + Google ADK + `ag_ui_adk` + LiteLLM (Python), openai gpt-4.1
- **Infra:** Postgres + Redis (threads persistence), Docker Compose
- **Monorepo:** npm workspaces + concurrently; aimock for deterministic replay

## Design principles

1. **Agent-owned state** — the board is a projection of `agent.state.issues`, not
   a separate frontend store. Read via `useAgent()`, write via `agent.setState`.
2. **Generative UI over chat** — the copilot renders real components (cards,
   charts, approval flows), not just text.
3. **Protocol, not framework** — LangGraph and Google ADK are interchangeable
   behind AG-UI; the selector swaps the backend with no UI changes.
4. **Deterministic by default for demos** — aimock replays fixtures so a live
   walkthrough never depends on a flaky model call.
5. **Fork-and-extend** — a standalone monorepo meant to be copied and adapted.
