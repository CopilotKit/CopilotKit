# CopilotKit <> LangGraph Starter

This is a starter template for building AI agents using [LangGraph](https://www.langchain.com/langgraph) and [CopilotKit](https://copilotkit.ai). It provides a modern Next.js application with an integrated LangGraph agent (TypeScript) to be built on top of.

https://github.com/user-attachments/assets/47761912-d46a-4fb3-b9bd-cb41ddd02e34

## Prerequisites

- Node.js 20+
- Any of the following package managers:
  - npm (default)
  - [pnpm](https://pnpm.io/installation)
  - [yarn](https://classic.yarnpkg.com/lang/en/docs/install/)
  - [bun](https://bun.sh/)
- OpenAI API Key (for the LangGraph agent)

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

This also installs the agent dependencies via `npm install` inside `agent/`.

2. Set up your environment variables:

```bash
cp .env.example .env
```

Then edit the `.env` file and add your OpenAI API key:

```bash
OPENAI_API_KEY=your-openai-api-key-here
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
- `dev:debug` - Starts development servers with debug logging enabled
- `dev:ui` - Starts only the Next.js UI server
- `dev:agent` - Starts only the LangGraph agent server
- `build` - Builds the Next.js application for production
- `start` - Starts the production server
- `install:agent` - Installs agent (Node) dependencies
- `channel` - Holds an Intelligence Channel open (see "Running a Channel" above)
- `typecheck:channel` - Type-checks the channel host on its own `tsconfig.channel.json`

## Project Structure

```
├── src/                         # Next.js frontend source
│   ├── app/
│   │   ├── page.tsx             # Main page
│   │   └── api/copilotkit/      # CopilotKit API route
│   ├── components/
│   │   ├── example-canvas/      # Todo list UI
│   │   ├── example-layout/      # Layout: chat + canvas side-by-side
│   │   └── generative-ui/       # Example generative UI components
│   └── hooks/
├── agent/                       # LangGraph TypeScript agent
│   ├── src/
│   │   ├── agent.ts             # Agent entry point (createAgent)
│   │   ├── todos.ts             # Todo tools and state schema
│   │   ├── query.ts             # Example data query tool
│   │   └── flights.ts           # Flight data tool (rendered with render_ui)
│   └── langgraph.json
├── scripts/                     # Agent run scripts
│   └── run-agent.sh / .bat
├── public/                      # Static assets
├── next.config.ts
├── tsconfig.json
└── package.json
```

## Generative UI (A2UI)

This starter lets the agent build rich, interactive UI in the chat. Instead of plain text, the agent writes [A2UI](https://a2ui.org/specification/) 1.0 operations, and the frontend renders them with your React components.

### How it works

1. **Catalog** — the components the agent can use, each with a description and a Zod schema of its props. The demo catalog extends the standard catalog (Row, Column, Title, Text, Button, Badge, Table, ...). It is registered once in `layout.tsx` via `<CopilotKitProvider generativeUI={{ ui: demonstrationUI }}>`.
2. **`render_ui`** — when a run carries the catalog, the runtime gives the agent a `render_ui` tool and a guide to the catalog. The agent calls it with the operations, and the runtime checks each one before the browser renders it.
3. **Surface** — the rendered UI in the chat. A button the agent binds to an event sends a user message to the agent when it is clicked.

The agent must pass the run's tools and context to the model. In this starter, `copilotkitMiddleware` from `@copilotkit/sdk-js/langgraph` does that.

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

### Showcase mode

`showcase.json` controls which suggestion pills are visually highlighted. Set `"showcase": "a2ui"` to highlight the A2UI demos, or `"showcase": "default"` for no highlights. This is configured automatically when scaffolding via `npx copilotkit create --framework a2ui`.

### Further reading

- [Generative UI components](https://docs.copilotkit.ai/generative-ui/components)
- [Adopt from A2UI](https://docs.copilotkit.ai/generative-ui/components/from-a2ui)
- [A2UI Specification](https://a2ui.org/specification/)

## Documentation

- [LangGraph Documentation](https://langchain-ai.github.io/langgraph/) - Learn more about LangGraph and its features
- [CopilotKit Documentation](https://docs.copilotkit.ai) - Explore CopilotKit's capabilities

## Contributing

Feel free to submit issues and enhancement requests! This starter is designed to be easily extensible.

## License

This project is licensed under the MIT License - see the LICENSE file for details.

## Troubleshooting

### Agent Connection Issues

If you see "I'm having trouble connecting to my tools", make sure:

1. The LangGraph agent is running on port 8123
2. Your OpenAI API key is set correctly
3. Both servers started successfully

### Agent Dependencies

If you encounter agent import errors:

```bash
npm run install:agent
```
