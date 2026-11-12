# CopilotKit with AWS Strands — TypeScript Starter

This starter connects a TypeScript [AWS Strands](https://strandsagents.com/)
agent to a Next.js CopilotKit application through the
[AG-UI protocol](https://docs.ag-ui.com).

It includes:

- shared todo state that the user and agent can edit;
- charts that use backend data;
- flight cards and dashboards that the agent renders with generative UI (A2UI);
- a human-in-the-loop meeting picker;
- light and dark themes; and
- optional CopilotKit Intelligence threads and Channels.

## Requirements

- Node.js 20.9 or later
- An [OpenAI API key](https://platform.openai.com/api-keys)

## Start the application

1. Copy the environment file:

   ```bash
   cp .env.example .env
   ```

2. Add your OpenAI API key to `.env`:

   ```plaintext
   OPENAI_API_KEY=your_openai_api_key
   ```

3. Install all dependencies:

   ```bash
   npm install
   ```

   The root `postinstall` script also installs the agent dependencies.

4. Start the frontend and agent:

   ```bash
   npm run dev
   ```

5. Open <http://localhost:3000>.

The frontend runs on port 3000. The Strands agent runs on port 8000. To check
the agent, open <http://localhost:8000/health>.

## Useful commands

- `npm run dev` starts the frontend and agent.
- `npm run dev:ui` starts only the Next.js frontend.
- `npm run dev:agent` starts only the Strands agent.
- `npm run build` builds the Next.js application.
- `npm run channel` starts the optional Intelligence Channel host.
- `npm run typecheck:channel` checks the Channel host types.

## Project structure

```text
├── agent/
│   └── src/
│       ├── agent.ts        # Strands agent, tools, and shared state
│       ├── flights.ts      # search_flights tool (flight data for render_ui)
│       └── server.ts       # Express AG-UI server
├── src/
│   ├── app/                # Next.js pages and CopilotKit API route
│   ├── components/         # Todo canvas, chat, and generative UI
│   └── agent.ts            # HttpAgent connection to the Strands server
├── channel-host.mts        # Optional Intelligence Channel process
└── docker-compose.test.yml # Offline starter smoke stack
```

## Generative UI (A2UI)

This starter lets the agent build rich, interactive UI in the chat. Instead of plain text, the agent writes [A2UI](https://a2ui.org/specification/) 1.0 operations, and the frontend renders them with your React components.

### How it works

1. **Catalog** — the components the agent can use, each with a description and a Zod schema of its props. The demo catalog extends the standard catalog (Row, Column, Title, Text, Button, Badge, Table, ...). It is registered once in `layout.tsx` via `<CopilotKitProvider generativeUI={{ ui: demonstrationUI }}>`.
2. **`render_ui`** — when a run carries the catalog, the runtime gives the agent a `render_ui` tool and a guide to the catalog. The agent calls it with the operations, and the runtime checks each one before the browser renders it.
3. **Surface** — the rendered UI in the chat. A button the agent binds to an event sends a user message to the agent when it is clicked.

The agent must pass the run's tools and context to the model. The Strands adapter (`@ag-ui/aws-strands`) does both: it registers the run's tools, and it adds the run's context (including the `render_ui` guide) to each model call. `buildStatePrompt` in `agent/src/agent.ts` adds only the current todos to the latest user message.

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
| Flight data tool                  | `agent/src/flights.ts`                             |
| Showcase config                   | `showcase.json`                                    |

To add a component, define it in `definitions.ts`, render it in `renderers.tsx`, and add it to `createGenerativeUI`. The runtime lists every component of the catalog in the `render_ui` guide.

### Showcase mode

`showcase.json` controls which suggestion pills are visually highlighted. Set `"showcase": "a2ui"` to highlight the A2UI demos, or `"showcase": "default"` for no highlights.

### Further reading

- [Generative UI components](https://docs.copilotkit.ai/generative-ui/components)
- [Adopt from A2UI](https://docs.copilotkit.ai/generative-ui/components/from-a2ui)
- [A2UI Specification](https://a2ui.org/specification/)

## Optional Intelligence features

Set `CPK_INTELLIGENCE_API_KEY` to activate live thread history. To run a Slack
or Teams Channel, use `copilotkit init` or `copilotkit channels add`, then run:

```bash
npm run channel
```

## Customize the starter

Set `COPILOTKIT_AGENT_MODEL` in `.env` to choose the model, for example
`anthropic:claude-sonnet-4-5`. Edit `agent/src/agent.ts` to change the prompt,
tools, or shared state.
Edit files under `src/` to change the application UI.

## License

MIT. See [LICENSE](./LICENSE).
