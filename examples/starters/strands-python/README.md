# CopilotKit <> strands Starter

This is a starter template for building AI agents using [strands](https://strands.com) and [CopilotKit](https://copilotkit.ai). It provides a modern Next.js application with an integrated investment analyst agent that can research stocks, analyze market data, and provide investment insights.

## Prerequisites

- Node.js 20+
- Python 3.12+
- [uv](https://docs.astral.sh/uv/) (Python package manager)
- OpenAI API Key (for the strands agent)
- Any of the following package managers:
  - npm (default)
  - [pnpm](https://pnpm.io/installation)
  - [yarn](https://classic.yarnpkg.com/lang/en/docs/install/)
  - [bun](https://bun.sh/)

## Getting Started

1. Install dependencies using your preferred package manager:

```bash
# Using npm (default)
npm install

# Using pnpm
pnpm install

# Using yarn
yarn install

# Using bun
bun install
```

> **Note:** Installing the package dependencies will also install the agent's python dependencies via the `install:agent` script.

2. Set up your OpenAI API key:

```bash
export OPENAI_API_KEY="your-openai-api-key-here"
```

or create a `.env` file.

```bash
cp .env.example .env
# Add the key of the model provider in .env. COPILOTKIT_AGENT_MODEL chooses
# the provider and model, for example anthropic:claude-sonnet-4-5.
```

3. Start the development server:

```bash
# Using npm (default)
npm run dev

# Using pnpm
pnpm dev

# Using yarn
yarn dev

# Using bun
bun run dev
```

This will start both the UI and agent servers concurrently.

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

## Available Scripts

The following scripts can also be run using your preferred package manager:

- `dev` - Starts both UI and agent servers in development mode
- `dev:ui` - Starts only the Next.js UI server
- `dev:agent` - Starts only the strands agent server
- `build` - Builds the Next.js application for production
- `start` - Starts the production server
- `install:agent` - Installs Python dependencies for the agent
- `channel` - Holds an Intelligence Channel open (see "Running a Channel" above)
- `typecheck:channel` - Type-checks the channel host on its own `tsconfig.channel.json`

## Generative UI (A2UI)

This starter lets the agent build rich, interactive UI in the chat. Instead of plain text, the agent writes [A2UI](https://a2ui.org/specification/) 1.0 operations, and the frontend renders them with your React components.

### How it works

1. **Catalog** — the components the agent can use, each with a description and a Zod schema of its props. The demo catalog extends the standard catalog (Row, Column, Title, Text, Button, Badge, Table, ...). It is registered once in `layout.tsx` via `<CopilotKitProvider generativeUI={{ ui: demonstrationUI }}>`.
2. **`render_ui`** — when a run carries the catalog, the runtime gives the agent a `render_ui` tool and a guide to the catalog. The agent calls it with the operations, and the runtime checks each one before the browser renders it.
3. **Surface** — the rendered UI in the chat. A button the agent binds to an event sends a user message to the agent when it is clicked.

The agent must pass the run's tools and context to the model. The Strands adapter (`ag_ui_strands`) registers the run's tools, but it does not add the run's context to the prompt. So `build_todos_prompt` in `agent/main.py` adds the context (including the `render_ui` guide) to the latest user message.

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

To add a component, define it in `definitions.ts`, render it in `renderers.tsx`, and add it to `createGenerativeUI`. The runtime lists every component of the catalog in the `render_ui` guide.

### Showcase mode

`showcase.json` controls which suggestion pills are visually highlighted. Set `"showcase": "a2ui"` to highlight the A2UI demos, or `"showcase": "default"` for no highlights.

### Further reading

- [Generative UI components](https://docs.copilotkit.ai/generative-ui/components)
- [Adopt from A2UI](https://docs.copilotkit.ai/generative-ui/components/from-a2ui)
- [A2UI Specification](https://a2ui.org/specification/)

## 📚 Documentation

The main UI component is in `src/app/page.tsx`. You can:

- Modify the theme colors and styling
- Add new frontend actions
- Customize the CopilotKit sidebar appearance

Otherwise, check out the documentation relevant to your task:

- [Strands Documentation](https://strandsagents.com/latest/documentation/docs/) - Learn more about Strands and its features
- [CopilotKit Documentation](https://docs.copilotkit.ai) - Explore CopilotKit's capabilities
- [Next.js Documentation](https://nextjs.org/docs) - Learn about Next.js features and API

## Contributing

Feel free to submit issues and enhancement requests! This starter is designed to be easily extensible.

## License

This project is licensed under the MIT License - see the LICENSE file for details.

## Troubleshooting

### Agent Connection Issues

If you see "I'm having trouble connecting to my tools", make sure:

1. The strands agent is running on port 8000
2. Your OpenAI API key is set correctly
3. Both servers started successfully

### Python Dependencies

If you encounter Python import errors:

```bash
cd agent
uv sync
```

## CopilotKit Intelligence & Threads (Optional)

CopilotKit Intelligence adds durable thread history and cross-session memory to
your agent. It requires a `COPILOTKIT_LICENSE_TOKEN`, a
`CPK_INTELLIGENCE_API_KEY`, and a running local
Intelligence stack (Docker Desktop + a local Intelligence repo checkout).

### Prerequisites

- [Docker Desktop](https://www.docker.com/products/docker-desktop/) running
- A `COPILOTKIT_LICENSE_TOKEN` (obtain from [CopilotKit Cloud](https://cloud.copilotkit.ai))
- A `CPK_INTELLIGENCE_API_KEY` for the Intelligence project
- The [Intelligence repo](https://github.com/CopilotKit/Intelligence) cloned
  locally. The `docker-compose.intelligence.yml` defaults to a sibling
  directory at `../../../Intelligence` relative to this starter; override with
  the `INTELLIGENCE_REPO` env var if your checkout is elsewhere.

### Start the intelligence stack

```bash
# From inside this starter directory:
docker compose -f docker-compose.intelligence.yml up -d --wait
```

First run builds the intelligence image from source (may take several minutes).

### Verify the stack is healthy

```bash
docker compose -f docker-compose.intelligence.yml ps
```

All three services (`postgres`, `redis`, `intelligence`) should show `healthy`.

### Set environment variables

Add the following to your `.env` file:

```env
COPILOTKIT_LICENSE_TOKEN=your-license-token-here
CPK_INTELLIGENCE_API_KEY=your-project-api-key-here
INTELLIGENCE_API_URL=http://localhost:4207
INTELLIGENCE_GATEWAY_WS_URL=ws://localhost:4407
```

Then start the dev server as usual (`npm run dev`). Thread history and memory
features are activated automatically when `CPK_INTELLIGENCE_API_KEY` is set.

### Stop / reset

```bash
# Stop without removing data:
docker compose -f docker-compose.intelligence.yml down

# Full reset (removes postgres + redis volumes):
docker compose -f docker-compose.intelligence.yml down -v
```
