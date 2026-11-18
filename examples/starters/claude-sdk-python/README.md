# CopilotKit × Claude Agent SDK — Python Starter

A starter template for building AI agents with the [Claude Agent SDK](https://docs.claude.com/en/api/agent-sdk/overview)
and [CopilotKit](https://copilotkit.ai). It pairs a modern Next.js frontend with a Python
agent that speaks the [AG-UI protocol](https://docs.ag-ui.com), and shows CopilotKit driving
**interactive UI beyond chat**:

- a shared-state **todos canvas** the agent and the user both edit,
- **charts** rendered from queried data,
- **flight cards** and **dynamic dashboards** via A2UI generative UI (the runtime's `render_ui` tool),
- a **human-in-the-loop** meeting picker,
- a light/dark **theme toggle**, and
- the SDK **threads drawer** (activated with a CopilotKit Intelligence license).

The agent is powered by Claude (`claude-sonnet-5` by default) and exposes two backend tools —
`query_data` and `search_flights` — while the todo board is shared state the
agent updates through the adapter's built-in `ag_ui_update_state` tool.

## Prerequisites

- **Node.js 20.9+**
- **Python 3.12 or 3.13**
- **[uv](https://docs.astral.sh/uv/)** (Python package manager)
- An **Anthropic API key** — create one at <https://console.anthropic.com/>

## Getting Started

1. **Copy the environment file:**

   ```bash
   cp .env.example .env
   ```

2. **Add your Anthropic API key** to `.env`:

   ```bash
   ANTHROPIC_API_KEY=sk-ant-...
   ```

   The other values are optional and already set to sensible defaults:
   `COPILOTKIT_AGENT_MODEL=anthropic:claude-sonnet-5` and `AGENT_URL=http://localhost:8000`.
   This agent runs Anthropic models only.

3. **Install dependencies:**

   ```bash
   npm install
   ```

   > This installs the Next.js frontend and, via the `postinstall` script, the
   > Python agent's dependencies with `uv sync`.

4. **Start the app:**

   ```bash
   npm run dev
   ```

   This runs the Next.js UI on **http://localhost:3000** and the Claude agent on
   **http://localhost:8000** concurrently.

5. **Open [http://localhost:3000](http://localhost:3000)** and try the suggested prompts
   (add todos, draw a chart, search flights, build a dashboard, schedule a meeting).

6. **(Optional) Enable the Threads drawer.** Set `CPK_INTELLIGENCE_API_KEY` in
   `.env` to activate live thread history; without it the drawer shows a locked
   state. The license token and `INTELLIGENCE_*` URLs are only for self-hosted
   or offline Intelligence deployments.

## Running a Channel

`channel-host.mts` mounts the same agent as an Intelligence Channel
(Slack, Teams). It requires `CPK_INTELLIGENCE_API_KEY` and a declared Channel in
`.copilotkit/channels.json` — set both up with `copilotkit init` or
`copilotkit channels add`, which write that file and the credentials your
`.env` needs, then:

```bash
npm run channel
```

The host reads which Channel to hold from `.copilotkit/channels.json`. If a
project declares more than one, set `INTELLIGENCE_CHANNEL_NAME` to pick one.

The host holds no provider credentials and exposes no provider endpoint —
Intelligence owns the provider edge — so the same file works for every provider.

The Channel itself is declared in `channels.mts` — that is where to add commands,
reactions, or an `onMention` handler. `channel-host.mts` only owns the process
lifetime, and is byte-identical in every starter.

Once startup finishes, the log reports the truth per Channel:

- `Channel "<name>" is online.` — the session is up and can send.
- `Channel "<name>" is declared but no provider is attached yet.` —
  a normal waiting state, not a failure. Run `copilotkit channels status` to
  see what setup remains.

Neither message proves the provider app is installed, reachable, or that
anyone can message it — verify that separately (invite the bot, then message
it) before treating the Channel as working.

## Available scripts

- `npm run dev` — start the UI and agent together (dev mode)
- `npm run dev:ui` — start only the Next.js UI (port 3000)
- `npm run dev:agent` — start only the Claude agent (port 8000)
- `npm run build` — build the Next.js app for production
- `npm start` — start the production server
- `npm run install:agent` — (re)install the Python agent's dependencies
- `npm run channel` — hold an Intelligence Channel open (see "Running a Channel" above)
- `npm run typecheck:channel` — type-check the channel host on its own `tsconfig.channel.json`

## Project structure

```
├── src/
│   ├── app/
│   │   ├── page.tsx                       # Main page (chat + todos canvas + threads drawer)
│   │   ├── layout.tsx                     # CopilotKit provider + generative UI catalog
│   │   └── api/copilotkit/[[...slug]]/     # CopilotKit runtime route (HttpAgent → :8000)
│   ├── components/                        # Canvas, generative UI, chat, UI primitives
│   └── hooks/                             # Example suggestions + generative-UI examples
└── agent/                                 # Python Claude agent (AG-UI on port 8000)
    ├── main.py                            # Server: mounts the adapter's FastAPI endpoint
    ├── pyproject.toml                     # Agent dependencies (managed by uv)
    └── src/
        ├── agent.py                       # The agent: backend tools → ClaudeAgentAdapter
        ├── model.py                       # Model resolution (COPILOTKIT_AGENT_MODEL)
        ├── query.py                       # query_data tool
        ├── flights.py                     # search_flights tool (flight data for render_ui)
        └── db.csv                         # Sample data for query_data
```

## How it works

- The **frontend** uses CopilotKit's React hooks. Shared state (like the todo list) lives in
  the agent and syncs bidirectionally with the UI.
- The **runtime route** (`src/app/api/copilotkit/[[...slug]]/route.ts`) connects to the agent
  over HTTP with `HttpAgent` from `@ag-ui/client`.
- The **agent** is a thin layer on the official
  [`ag-ui-claude-sdk`](https://pypi.org/project/ag-ui-claude-sdk/) adapter. `src/agent.py`
  defines the two backend tools and hands them to `ClaudeAgentAdapter`; `main.py` serves it
  with the adapter's `add_claude_fastapi_endpoint`. The adapter drives Claude through the Claude
  Agent SDK, bridges CopilotKit frontend tools (including `render_ui`) + human-in-the-loop, passes
  the run's context to the model in the system prompt, and manages the shared
  `todos` state via its built-in `ag_ui_update_state` tool.

To customize: add or edit tools in `agent/src/` and the system prompt in `agent/src/agent.py`,
and the UI in `src/app/page.tsx` and `src/components/`.

## Generative UI (A2UI)

This starter lets the agent build rich, interactive UI in the chat. Instead of plain text, the agent writes [A2UI](https://a2ui.org/specification/) 1.0 operations, and the frontend renders them with your React components.

### How it works

1. **Catalog** — the components the agent can use, each with a description and a Zod schema of its props. The demo catalog extends the standard catalog (Row, Column, Title, Text, Button, Badge, Table, ...). It is registered once in `layout.tsx` via `<CopilotKitProvider generativeUI={{ ui: demonstrationUI }}>`.
2. **`render_ui`** — when a run carries the catalog, the runtime gives the agent a `render_ui` tool and a guide to the catalog. The agent calls it with the operations, and the runtime checks each one before the browser renders it.
3. **Surface** — the rendered UI in the chat. A button the agent binds to an event sends a user message to the agent when it is clicked.

The agent must pass the run's tools and context to the model. In this starter, `ClaudeAgentAdapter` does that: it adds the frontend tools (including `render_ui`) as tools of an `ag_ui` MCP server, and appends the run's context (including the guide) to the system prompt.

### Examples

| Suggestion          | What the agent does                                                                    |
| ------------------- | -------------------------------------------------------------------------------------- |
| **Search Flights**  | Calls `search_flights` for the data, then renders a `Row` of `FlightCard` components.  |
| **Sales Dashboard** | Calls `query_data`, then renders `DashboardCard`, `Metric`, `PieChart` and `BarChart`. |

### Key files

| Purpose                           | Path                                               |
| --------------------------------- | -------------------------------------------------- |
| Catalog definitions (Zod schemas) | `src/app/declarative-generative-ui/definitions.ts` |
| Catalog components (React)        | `src/app/declarative-generative-ui/renderers.tsx`  |
| Catalog registration              | `src/app/layout.tsx`                               |
| Flight data tool                  | `agent/src/flights.py`                             |
| Showcase config                   | `showcase.json`                                    |

### Adding a custom component

1. **Define** the component in `definitions.ts`:

   ```typescript
   MyWidget: {
     description: "A brief description for the agent.",
     props: z.object({ title: z.string(), value: z.number() }),
   },
   ```

2. **Render** it in `renderers.tsx`, and add it to `createGenerativeUI`:

   ```tsx
   function MyWidget({ title, value }: Props<"MyWidget">) {
     return <div>{title}: {value}</div>;
   }

   // in createGenerativeUI({ components: { ... } }):
   MyWidget: { ...definitions.MyWidget, component: MyWidget },
   ```

   The props are typed from the schema, so TypeScript errors if the component and the definition do not match.

3. **Use it** from the agent. The runtime lists every component of the catalog in the `render_ui` guide.

### Further reading

- [Generative UI components](https://docs.copilotkit.ai/generative-ui/components)
- [Adopt from A2UI](https://docs.copilotkit.ai/generative-ui/components/from-a2ui)
- [A2UI Specification](https://a2ui.org/specification/)

## Troubleshooting

**"I'm having trouble connecting to my tools" / agent unreachable**

- Make sure the agent is running on port 8000 (`npm run dev:agent`) and that
  `ANTHROPIC_API_KEY` is set in `.env`.
- Confirm the agent's health check: `curl http://localhost:8000/health` → `{"status":"ok"}`.

**Python import errors**

- Reinstall the agent's dependencies: `cd agent && uv sync`.

## Learn more

- [Claude Agent SDK](https://docs.claude.com/en/api/agent-sdk/overview)
- [CopilotKit documentation](https://docs.copilotkit.ai)
- [AG-UI protocol](https://docs.ag-ui.com)
- [Next.js documentation](https://nextjs.org/docs)

## License

MIT — see [LICENSE](./LICENSE).
