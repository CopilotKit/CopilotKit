# Agentic Incident Response

https://github.com/user-attachments/assets/e53d0245-f5f5-41a4-a46a-5a80a625ec22

An incident response platform built with React, TypeScript, and [CopilotKit](https://github.com/CopilotKit/CopilotKit). Track, triage, and resolve security and operational incidents with an AI assistant that can read your data, update statuses, generate analysis, and render charts — all from the chat sidebar.

## What It Does

- **Incident tracking** — Report, filter, search, and manage incidents across their lifecycle (Open → Investigating → Mitigated → Resolved) with P0–P4 severity levels.
- **Dashboard** — Live metrics for active incidents, MTTR, and recent resolutions. Cross-incident activity timeline.
- **Detail views** — Three-tab incident modal (Overview, Timeline, Analysis) with status updates, comments, and service impact tracking.
- **Security analysis** — On-demand risk scoring, security event logs, affected asset mapping, related incident correlation, and step-by-step runbooks.
- **Charts** — Severity distribution, status breakdown, incident timeline, and service impact visualizations (Recharts).
- **AI assistant** — CopilotKit sidebar that can resolve incidents, change statuses, add comments, create new incidents, run analysis, and generate charts through natural language.
- **Human-in-the-loop** — AI-assisted incident reporting with a review-before-submit workflow directly inside the chat sidebar.

## Human-in-the-Loop Interaction

The app uses a **human-in-the-loop** pattern for incident reporting, where the AI fills out a form but the user retains full control over what gets submitted.

### How It Works

1. **User initiates** — Click "Report Incident" on the dashboard, or describe an incident in the chat (e.g., "Our API gateway is returning 500 errors").
2. **AI fills the form** — The AI calls the `reportIncident` tool, populating all six fields (title, description, severity, type, affected systems, assignee) based on the conversation context. Fields the user didn't mention are inferred.
3. **Form appears in-chat** — A form renders directly inside the CopilotKit sidebar via React portal, pre-filled with the AI's suggestions and marked with an "AI completed" badge.
4. **User reviews** — The form enters **review mode** with a banner: "Is this information correct?" All AI-filled fields are visually highlighted.
5. **User edits or confirms** — The user can click **Edit** to modify any field, or click **Confirm & Report** to submit the incident as-is.
6. **Incident created** — On confirmation, the incident is added to the dashboard with status "Open" and appears in the incident list immediately.

### Why Human-in-the-Loop?

- **Accuracy** — The AI infers severity, type, and assignee, but the user verifies before anything is committed.
- **Trust** — Users see exactly what will be submitted and can correct any AI assumptions.
- **Speed** — The AI does the tedious work of filling six fields from a natural language description, while the human provides the final approval.

### Form Modes

| Mode | Description |
|------|-------------|
| **Editing** | Blank or partially filled form. User fills fields manually and clicks "Report Incident". |
| **Review** | AI has pre-filled all fields. User sees "AI completed" badge, reviews, edits if needed, then clicks "Confirm & Report". |
| **Submitted** | Success state shown briefly after submission, then auto-dismissed. |

### AI Tools for Incident Management

The assistant has seven tools registered via `useFrontendTool`:

| Tool | Purpose |
|------|---------|
| `reportIncident` | Fill the in-chat form with incident details for human review |
| `resolveIncident` | Mark a specific or most-recent incident as Resolved |
| `clearAllIncidents` | Resolve all active incidents at once |
| `updateIncidentStatus` | Change status (Open → Investigating → Mitigated → Resolved) |
| `addIncidentComment` | Add a comment to an incident's timeline |
| `analyzeIncident` | Generate security analysis (risk score, logs, assets, runbooks) |
| `generateChart` | Render an interactive chart inline in the chat |

## Tech Stack

**Frontend:** React 18, TypeScript, Vite, CopilotKit, Recharts
**Backend:** Express, CopilotKit Runtime, OpenAI API
**Testing:** Vitest, React Testing Library

## Prerequisites

- Node.js 20.19+ or 22.12+
- pnpm
- [OpenAI API key](https://platform.openai.com/api-keys)

## Setup

```bash
pnpm install
```

Create a `.env` file:

```
OPENAI_API_KEY=your_key_here
```

## Running

```bash
pnpm dev:all
```

Frontend runs on `http://localhost:5173`, backend on `http://localhost:4000`.

To run them separately:

```bash
pnpm dev:server   # backend
pnpm dev          # frontend
```

## Testing

```bash
pnpm test           # run all tests once
pnpm test:watch     # watch mode
```

The test suite covers all UI components, the incident database, seed data generation, and mock analysis logic.

## How CopilotKit Fits In

The app wraps its UI in a `CopilotKit` provider connected to a self-hosted Express runtime (`server.js`). From there:

- **`useCopilotReadable`** exposes the incident list, form state, metrics, and selected incident to the AI so it has full context.
- **`useFrontendTool`** registers seven actions the AI can call: resolve incidents, update statuses, add comments, report new incidents (with human review), run security analysis, and generate charts.
- **`CopilotSidebar`** provides the chat interface with suggested prompts for common tasks.
- **React portals** render the incident report form directly inside the sidebar's message area for a seamless in-chat experience.

The backend is a thin Express server that proxies requests to OpenAI through `CopilotRuntime`.

## Project Structure

```
src/
├── App.tsx                        # Layout, state, filtering, CopilotKit setup
├── components/
│   ├── CounterController.tsx      # AI tool definitions (7 tools)
│   ├── ChatIncidentForm.tsx       # In-chat incident form (human-in-the-loop)
│   ├── IncidentForm.tsx           # Standalone incident form
│   ├── IncidentsList.tsx          # Filterable incident list
│   ├── IncidentDetail.tsx         # Detail modal (overview/timeline/analysis)
│   ├── AnalysisPanel.tsx          # Security analysis display
│   ├── CrossIncidentTimeline.tsx  # Cross-incident activity feed
│   ├── charts/IncidentCharts.tsx  # Recharts visualizations
│   └── __tests__/                 # Component tests
├── types/                         # Incident and analysis types
├── data/                          # Seed data and mock analysis generators
├── services/                      # In-memory DB and mock API layer
└── style.css

server.js                          # Express + CopilotKit runtime
```

## License

MIT
