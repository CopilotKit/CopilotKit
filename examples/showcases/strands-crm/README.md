# Northstar — AI Sales CRM (Strands + CopilotKit)

A full-featured **agentic CRM** showcase for an enterprise hardware seller, built with
[CopilotKit](https://copilotkit.ai), the [AG-UI protocol](https://docs.copilotkit.ai/ag-ui),
and a **TypeScript [Strands](https://strandsagents.com) agent**. The copilot doesn't just chat —
it drives the workspace: researching prospects, building hardware quotes, analyzing the team,
and generating reports that render as full pages.

> The first **TypeScript** Strands example in this repo (the others are Python). It uses
> `@strands-agents/sdk` + `@ag-ui/aws-strands` to bridge a Strands agent to CopilotKit over the
> AG-UI protocol.

## What this shows

- **Agentic canvas** — tool calls route and render on the workspace, not just in chat:
  approving a quote opens a full quote page; _"analyze the team"_ and _"generate this week's
  report"_ open dedicated report pages.
- **Generative UI** — inline cards for enrichment, deal briefs, pipeline priorities, and a
  human-in-the-loop follow-up approval (`useRenderTool` / `useHumanInTheLoop`).
- **Shared state** — a live `STATE_SNAPSHOT` keeps the Kanban board, dashboard, and pages in
  sync with the agent's SQLite store.
- **Frontend tools** — the copilot can focus a deal or navigate the workspace from chat
  (_"show me the pipeline"_).
- **Dependency-free SVG charts**, a product catalog, a team leaderboard, and a reports browser.

## Stack

| Layer    | Tech                                                                                                              |
| -------- | ----------------------------------------------------------------------------------------------------------------- |
| Agent    | TypeScript Strands (`@strands-agents/sdk`), `@ag-ui/aws-strands`, Express, OpenAI, Tavily, SQLite (`node:sqlite`) |
| Frontend | Next.js (App Router) + React 19, CopilotKit (`@copilotkit/*`), `@ag-ui/client`, Tailwind v4                       |

## Prerequisites

- Node.js 20+
- An **OpenAI API key**
- A **Tavily API key** (lead enrichment / web search) — free at https://tavily.com

## Quick start

```bash
# from examples/showcases/strands-crm
npm run install:all          # installs root, agent, and frontend deps

# configure the agent's keys
cp agent/.env.example agent/.env
# edit agent/.env → set OPENAI_API_KEY and TAVILY_API_KEY

npm run dev                  # runs the agent (:8000) and the UI (:3000) together
```

Open http://localhost:3000.

> Prefer two terminals? Run `npm --prefix agent run dev` and `npm --prefix frontend run dev`.

## How it works

```
Next.js + CopilotKit (UI, :3000)
        │  /api/copilotkit  →  HttpAgent
        ▼
TypeScript Strands agent (Express, :8000)
        │  tools: recommend_products / enrich_lead / analyze_team /
        │         generate_weekly_report / move_stage / confirm_followup / …
        ▼
SQLite CRM store  ──STATE_SNAPSHOT──▶  live board + dashboard + report pages
```

The frontend's API routes proxy to the agent at `http://localhost:8000` (override with the
`AGENT_URL` env var). The agent registers CRM tools; mutating tools push a fresh state snapshot
so the board, dashboard, and report pages update live.

## Tests

```bash
npm --prefix agent test       # agent: store, routes, tools, analytics
npm --prefix frontend test    # frontend: CRM lib + analytics
```

## Try it

In the chat, try: **"Research CopilotKit"**, **"Quote a 30-seat laptop fleet for CopilotKit"**
(then approve the quote), **"How is the team doing this quarter?"**, **"Generate this week's
report"**, or **"Show me the pipeline."**
