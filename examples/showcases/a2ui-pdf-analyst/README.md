# A2UI PDF Analyst

Chat with your PDF and watch the agent build the UI for each answer. Powered by **A2UI v0.9 (Agent-to-UI)** — the open protocol that lets an agent describe a surface as structured component operations your frontend renders against its own design system. Same chat input, two rendering strategies, one shared 21-component catalog.

https://github.com/user-attachments/assets/c053d2e8-1d40-43cb-8c5a-8e5c121b851f

**Three routes:**

- **`/fixed`** — hand-authored JSON dashboard. The agent only extracts the data (KPIs, trend, segment splits, table rows) and fills the slots. Predictable layout, brand-locked, single LLM call per turn. Best when the shape of the answer is known up front.
- **`/dynamic`** — no pre-written layout. The agent reads the question, picks components from the catalog, and composes the surface on the fly. A net-income query lands as a single StatCard; a segment breakdown becomes a DonutChart; a research-paper summary composes Overline + Heading + Text + Callout + BulletList. Best when the right answer's _form_ varies with the question.
- **`/catalog`** — every component rendered live, filterable by group (Layout, Content, Data viz, Interactive). Doubles as a sanity check on the renderers and a reference for what the agent is allowed to draw from.

All three routes share the same brand tokens (`src/a2ui/theme.css`), the same React renderers (`src/a2ui/catalog/renderers.tsx`), and the same client-side PDF text extraction pipeline (`src/lib/pdf.ts`). Re-skin one stylesheet, every surface updates.

## Prerequisites

- Node.js 20+ and [pnpm](https://pnpm.io/) (npm works too)
- Python 3.12
- [uv](https://docs.astral.sh/uv/) for the Python agent
- An OpenAI API key

## Run locally

```bash
git clone https://github.com/CopilotKit/CopilotKit.git
cd CopilotKit/examples/showcases/a2ui-pdf-analyst
cp agent/.env.example agent/.env    # then put your OPENAI_API_KEY in agent/.env
pnpm install                         # installs Next.js + runs `uv sync` for the agent
pnpm dev                             # boots web on :3000, agent on :8123
```

Open <http://localhost:3000>. `npm install && npm run dev` works identically.

## Environment variables

`agent/.env`:

| Variable         | Required | Notes                                                                                 |
| ---------------- | -------- | ------------------------------------------------------------------------------------- |
| `OPENAI_API_KEY` | yes      | used by the main agent and by the secondary LLMs inside `query_pdf` / `generate_a2ui` |

## Architecture

```
a2ui-pdf-analyst/
├── package.json              → Next.js manifest + concurrently runs the agent alongside
├── next.config.ts
├── postcss.config.mjs
├── tsconfig.json
├── public/                   → static assets (CopilotKit brand SVGs)
├── src/                      → Next.js 16 · React 19 · Tailwind v4
│   ├── app/
│   │   ├── api/copilotkit/   → CopilotKit V2 runtime endpoint (HttpAgent → Python)
│   │   ├── fixed/            → fixed-schema route: pre-authored dashboard
│   │   ├── dynamic/          → dynamic-schema route: agent invents the layout
│   │   ├── catalog/          → live showcase of all 21 components
│   │   ├── globals.css       → app-wide tokens, fonts
│   │   ├── layout.tsx        → root layout + Providers
│   │   └── page.tsx          → overview
│   ├── a2ui/
│   │   ├── catalog/
│   │   │   ├── definitions.ts → Zod prop schemas + agent-facing descriptions
│   │   │   ├── renderers.tsx  → React renderers (Recharts charts, tables, cards)
│   │   │   └── index.ts       → createCatalog() (definitions + renderers, catalogId)
│   │   ├── theme.css          → brand tokens, scoped to .a2ui-surface
│   │   ├── surface-bus.ts     → per-agent A2UI op stream the canvas subscribes to
│   │   └── MirrorRenderer.tsx → activity renderer that forwards ops to the canvas
│   ├── components/
│   │   ├── SurfaceCanvas.tsx        → mounts A2UIProvider + renders surfaces
│   │   ├── FilteredUserMessage.tsx  → strips inlined PDF text from chat
│   │   ├── FilteredAssistantMessage.tsx → suppresses JSON-shaped agent replies
│   │   ├── Split.tsx                → VS-Code-style resizable chat/canvas split
│   │   ├── Providers.tsx            → <CopilotKit> + activity renderers
│   │   └── Brand.tsx                → SiteNav + PageHeader
│   └── lib/pdf.ts            → client-side PDF text extraction (pdfjs-dist)
└── agent/                    → Python · LangChain · LangGraph · FastAPI · AG-UI
    ├── main.py               → /fixed and /dynamic FastAPI endpoints
    ├── pyproject.toml
    ├── uv.lock
    └── src/
        ├── catalog.py        → CATALOG_ID + system-prompt fragment listing components
        ├── fixed_agent.py    → render_dashboard backend tool
        ├── dynamic_agent.py  → query_pdf + generate_a2ui tools
        ├── pdf_tools.py      → query_pdf: PDF text → structured JSON answer
        ├── multimodal_middleware.py → ag-ui-langgraph patch so PDF text survives the trip to OpenAI
        └── a2ui/schemas/dashboard.json → the fixed dashboard layout (Stack / Grid / charts / table)
```

## How it works

**PDF attachment** — CopilotKit's multimodal attachment support lets the user attach a PDF directly in the chat input. The frontend extracts the full text client-side via `pdfjs-dist` and inlines it into the user message under a `[Document: <filename>]` header. `multimodal_middleware.py` patches `ag-ui-langgraph` so this text block survives serialization and arrives intact at OpenAI. The agent scans every message in the conversation history for the most recent `[Document: ...]` header — attach once, ask many questions.

**Fixed schema (`/fixed`)** — `agent/src/a2ui/schemas/dashboard.json` is a static A2UI component tree the agent never touches. The `render_dashboard` tool takes typed arguments (KPIs, trend, share, rows, scope chips), packages them as A2UI `update_data_model` ops, and the existing tree picks them up via `{path}` bindings. One LLM pass, one tool call, surface streams in.

**Dynamic schema (`/dynamic`)** — five steps per turn:

1. User attaches a PDF and asks a question. Frontend inlines the PDF text into the message.
2. Agent calls `query_pdf` → a sub-LLM reads the document and returns structured JSON: `shape_hint`, `title`, `summary`, `data`.
3. Agent calls `generate_a2ui` (no arguments) → spawns a second sub-LLM bound to a no-op `render_a2ui` shim with `tool_choice` forced to that shim.
4. The second LLM's tool-call arguments (surfaceId, catalogId, components, data) become A2UI `create_surface` + `update_components` + `update_data_model` operations.
5. The JS-side A2UI middleware detects `a2ui_operations` in the tool result and emits the snapshot events the canvas listens for. Surface renders. Agent emits an empty chat message.

## Sample PDFs

These work well for the dynamic-schema demo:

- Apple Q4 FY24 Consolidated Financial Statements ([download](https://www.apple.com/newsroom/pdfs/fy2024-q4/FY24_Q4_Consolidated_Financial_Statements.pdf)) — structured tables, multiple categorical breakdowns
- Tesla Q3 2024 Update ([download](https://www.tesla.com/sites/default/files/downloads/TSLA-Q3-2024-Update.pdf)) — multi-quarter time-series + production / delivery pairs
- Anthropic's _Constitutional AI: Harmlessness from AI Feedback_ ([download](https://arxiv.org/pdf/2212.08073)) — research paper, mostly prose, for text-heavy explainer surfaces

## Prompts to try

On `/dynamic` after attaching a PDF:

| Ask the agent                                                                                 | Expected surface                      |
| --------------------------------------------------------------------------------------------- | ------------------------------------- |
| `What was net income last quarter?`                                                           | one StatCard                          |
| `Break iPhone vs Mac vs iPad vs Wearables vs Services as a donut.`                            | DonutChart                            |
| `Show Q4 net sales by category as horizontal bars.`                                           | HorizontalBarChart                    |
| `Plot quarterly production against deliveries across the last 5 quarters as a scatter chart.` | ScatterChart                          |
| `Explain the main idea of this paper in plain English.`                                       | Heading + Text + Callout + BulletList |
| `Show me the revenue trend over the last 6 quarters.`                                         | LineChart                             |

On `/fixed` after attaching a PDF:

| Ask the agent                               | What happens                                                           |
| ------------------------------------------- | ---------------------------------------------------------------------- |
| `Render the dashboard.`                     | full dashboard with KPIs, trend chart, share donut, table, scope chips |
| `Switch scope to FY24.` (or click the chip) | re-renders the same dashboard with FY24 data                           |

## Tech stack

| Layer          | Stack                                                                                                                                  |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Frontend       | Next.js 16 · React 19 · Tailwind v4 · TypeScript · `@copilotkit/react-core/v2` · `@copilotkit/a2ui-renderer` · `pdfjs-dist` · Recharts |
| Runtime bridge | `@copilotkit/runtime/v2` · `@ag-ui/client` (HttpAgent)                                                                                 |
| Backend        | Python 3.12 · FastAPI · `ag-ui-langgraph` · `copilotkit` (Python SDK) · `langchain` agents + LangGraph · `langchain-openai`            |
| Model          | `gpt-5.5` for both the main agent and the secondary LLMs                                                                               |
