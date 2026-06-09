# PM Copilot — CopilotKit demo

A polished, on-brand showcase of CopilotKit running a real workflow app — a mini Linear / Notion that the copilot can drive, observe, and reason about. Built on top of the CopilotKit + LangGraph template, plus a second agent on Google ADK, deterministic demo via aimock, and PTT voice via OpenAI Whisper.

Branch: `demo/pm-copilot`.

https://github.com/user-attachments/assets/66a86d92-4565-4b9c-96b3-cdda0e780b93

## What's in it

| Feature                                                | Where                                                                    |
| ------------------------------------------------------ | ------------------------------------------------------------------------ |
| Kanban board (5 columns, drag-and-drop, click-to-edit) | `apps/app/src/components/pm-board/`                                      |
| Agent-owned state (`useAgent()` + `agent.setState`)    | `apps/agent/src/issues.py`                                               |
| Inline issue cards (generative UI) in chat             | `apps/app/src/components/generative-ui/issue-card.tsx`, `issue-list.tsx` |
| HITL approval card (accept / reject / edit)            | `apps/app/src/components/generative-ui/approval-card.tsx`                |
| Shared-state timeline (live agent "thinking" panel)    | `apps/app/src/components/pm-board/analysis-timeline.tsx`                 |
| Threads drawer w/ search, rename, archive              | `apps/app/src/components/threads-drawer/`                                |
| Glass theme (lavender, blur circles)                   | `apps/app/src/components/theme-shell/`, `globals.css`                    |
| PTT voice via OpenAI Whisper                           | `apps/bff/src/whisper-transcription.ts`                                  |
| MCP App tile (Excalidraw)                              | `apps/bff/src/server.ts` mcpApps                                         |
| aimock for deterministic demo                          | `fixtures/`, `npm run dev:mock`                                          |
| Second agent (Google ADK)                              | `apps/agent-adk/`                                                        |
| AG-UI event inspector                                  | `apps/app/src/components/event-inspector/`                               |

## Architecture

| Service                             | Port                      | Description                                  |
| ----------------------------------- | ------------------------- | -------------------------------------------- |
| Frontend (`apps/app`)               | 3000 / 3002               | Vite + React + CopilotKit v2                 |
| BFF (`apps/bff`)                    | 4000                      | Hono + CopilotRuntime, registers both agents |
| LangGraph agent (`apps/agent`)      | 8123                      | Python, openai:gpt-4.1                       |
| Google ADK agent (`apps/agent-adk`) | 8124                      | Python, LiteLLM → openai/gpt-4.1             |
| Postgres / Redis / Intelligence     | 5432 / 6379 / 4201 / 4401 | Threads + realtime                           |
| aimock (optional)                   | 4010                      | OpenAI-shaped mock for deterministic demos   |

The frontend talks only to the BFF. The BFF fronts the runtime, registers `default`, `langgraph`, and `adk` agents, and forwards Whisper transcription. The agent-selector in the chat header swaps which Python backend the runtime routes to — the AG-UI event inspector on the right panel proves both speak the same protocol.

## The demo — 7 acts

This is what to walk through in front of an audience. Each act is short (15-45 seconds).

### Act 1 — Open the app

`npm run dev` brings up everything. The page paints lavender with the six signature CopilotKit blur circles, a glass chat panel on the left, the kanban on the right. The threads drawer shows previous conversations (run `npm run seed:threads` once to populate it).

<!-- screenshot: act-1.png -->

### Act 2 — Pick a thread

Click "Sprint planning — May 12" in the drawer. The chat hydrates from postgres; the kanban hydrates from the agent's per-thread state. Hover any thread for the rename / archive / delete actions. The search box at the top filters as you type.

<!-- screenshot: act-2.png -->

### Act 3 — Talk to the copilot

Type "plan next sprint" (or click the suggestion pill). The agent reads the backlog and proposes pulling three urgent issues into Todo. Each proposal renders as an approval card with accept / reject / **edit** — clicking edit lets you change the assignee or priority inline before approving.

<!-- screenshot: act-3.png -->

### Act 4 — Upload a PDF

Drag a PRD PDF onto the chat. The agent (which is vision-capable) reads it directly and calls `manage_issues` with the extracted findings. Three new issues appear on the Backlog column in real time — same `agent.state.issues` the frontend reads, no extra wiring.

<!-- screenshot: act-4.png -->

### Act 5 — Inline issue cards

Ask "show me all urgent issues." The agent calls `render_issue_list` which surfaces glass cards inline in chat — each with a **View on board** button that scrolls and flashes the matching kanban card. This is the `useComponent` generative UI pattern.

<!-- screenshot: act-5.png -->

### Act 6 — Watch the agent think

Click "Analyze backlog." The agent calls `analyze_backlog`, which streams progress via `copilotkit_emit_state`. A glass timeline panel slides up in the bottom-right of the kanban: **Reading issues → Categorizing → Identifying blockers → Drafting recommendation → Done**. Step pills fill with mint check marks; live stat chips update as the data flows.

<!-- screenshot: act-6.png -->

### Act 7 — Swap agents

Open the agent selector in the chat header (top right of the chat panel). Switch from **LangGraph** to **Google ADK**. The chat reloads, the same tool surface is available, the same issues appear. Open the AG-UI event inspector (chevron tab on the far right of the viewport) — both agents emit the same `TEXT_MESSAGE_CONTENT` / `TOOL_CALL_START` / `STATE_DELTA` events. That's the AG-UI protocol working.

<!-- screenshot: act-7.png -->

### Bonus — PTT voice

The mic button on the chat input transcribes via OpenAI Whisper (`WhisperTranscriptionService` on the BFF). Hold to record; release to send. In `dev:mock` mode the Whisper API is also mocked from fixtures so this is repeatable.

## Getting started

```bash
# 1. Install
npm install

# 2. Set OPENAI_API_KEY in .env
cp .env.example .env

# 3. License (one-time)
copilotkit license -n my-project

# 4. Start everything (docker infra + app + bff + both agents)
npm run dev

# 5. (Optional) Seed prior threads for the demo
npm run seed:threads
```

The app is at http://localhost:3002 by default (Vite picks 3000+).

## Deterministic demo mode (aimock)

Real-LLM demos are flaky. `npm run dev:mock` boots aimock on port 4010 and runs every service with `USE_MOCK=1`, which flips `OPENAI_BASE_URL` to the local mock. All chat completions and Whisper transcripts come from `fixtures/*.json`.

```bash
# Record once
npm run aimock:record

# Replay forever
npm run dev:mock
```

Six pre-built scenario fixtures cover the demo flows:

| File                       | What it covers                                   |
| -------------------------- | ------------------------------------------------ |
| `sprint-planning.json`     | "Plan next sprint" → propose_issue_change loop   |
| `pdf-prd-summary.json`     | PDF in → 3 created issues out                    |
| `backlog-analysis.json`    | analyze_backlog with shared-state progress       |
| `hitl-move-issue.json`     | propose_issue_change → proposeIssueMutation HITL |
| `voice-status-update.json` | Whisper transcript + render_issue_list           |
| `mcp-sketch.json`          | Open Excalidraw via MCP                          |
| `default.json`             | Catch-all greetings + fallback                   |

## Removing pieces

To slim back to a generic CopilotKit + LangGraph starter, see the prior `Removing Threads` section preserved in the git history at `8614a75`.

## Documentation

- [CopilotKit Docs](https://docs.copilotkit.ai)
- [LangGraph Docs](https://langchain-ai.github.io/langgraph/)
- [Google ADK Docs](https://google.github.io/adk-docs/)
- [AG-UI Protocol](https://github.com/ag-ui-protocol/ag-ui)

## License

MIT
