# CopilotKit <> LangGraph Starter

This is a starter template for building AI agents using [LangGraph](https://www.langchain.com/langgraph) and [CopilotKit](https://copilotkit.ai). It provides a modern Next.js application with an integrated LangGraph agent to be built on top of.

https://github.com/user-attachments/assets/47761912-d46a-4fb3-b9bd-cb41ddd02e34

## Prerequisites

- Node.js 18+
- Python 3.8+
- Any of the following package managers:
  - [pnpm](https://pnpm.io/installation) (recommended)
  - npm
  - [yarn](https://classic.yarnpkg.com/lang/en/docs/install/#mac-stable)
  - [bun](https://bun.sh/)
- OpenAI API Key (for the LangGraph agent)

> **Note:** This repository ignores lock files (package-lock.json, yarn.lock, pnpm-lock.yaml, bun.lockb) to avoid conflicts between different package managers. Each developer should generate their own lock file using their preferred package manager. After that, make sure to delete it from the .gitignore.

## Getting Started

1. Install dependencies using your preferred package manager:

```bash
# Using pnpm (recommended)
pnpm install

# Using npm
npm install

# Using yarn
yarn install

# Using bun
bun install
```

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
# Using pnpm
pnpm dev

# Using npm
npm run dev

# Using yarn
yarn dev

# Using bun
bun run dev
```

This will start both the UI and agent servers concurrently.

## Available Scripts

The following scripts can also be run using your preferred package manager:

- `dev` - Starts both UI and agent servers in development mode
- `dev:debug` - Starts development servers with debug logging enabled
- `dev:ui` - Starts only the Next.js UI server
- `dev:agent` - Starts only the LangGraph agent server
- `build` - Builds the Next.js application for production
- `start` - Starts the production server
- `lint` - Runs ESLint for code linting
- `install:agent` - Installs Python dependencies for the agent

## A2UI — Agent-to-User Interface

This starter includes [A2UI](https://a2ui.org/specification/) support, allowing the agent to generate rich, interactive UI surfaces declaratively. Instead of returning plain text, the agent sends a JSON description of the UI it wants to render, and the frontend turns it into real components.

### How it works

A2UI uses three concepts:

1. **Catalog** — a set of component definitions (schema) paired with React renderers. Registered once in `layout.tsx` via `<CopilotKitProvider a2ui={{ catalog: demonstrationCatalog }}>`.
2. **Surface** — a rendered UI instance. The agent creates a surface, sets its components, and binds data to it.
3. **Operations** — the agent returns `a2ui.render(operations=[...])` from a tool, which the middleware streams to the frontend.

### Two patterns

| Pattern            | Description                                                                   | Agent tool       | Frontend                                    |
| ------------------ | ----------------------------------------------------------------------------- | ---------------- | ------------------------------------------- |
| **Fixed schema**   | Pre-defined component layout. Only the data changes per invocation.           | `search_flights` | Schema in `a2ui/schemas/flight_schema.json` |
| **Dynamic schema** | A secondary LLM generates both components and data based on the conversation. | `generate_a2ui`  | Components decided at runtime               |

Both patterns use the same catalog on the frontend — the difference is where the component tree comes from.

### Key files

| Purpose                              | Path                                                        |
| ------------------------------------ | ----------------------------------------------------------- |
| Catalog definitions (Zod schemas)    | `apps/app/src/app/declarative-generative-ui/definitions.ts` |
| Catalog renderers (React components) | `apps/app/src/app/declarative-generative-ui/renderers.tsx`  |
| Catalog registration                 | `apps/app/src/app/layout.tsx`                               |
| Fixed-schema agent tool              | `apps/agent/src/a2ui_fixed_schema.py`                       |
| Dynamic-schema agent tool            | `apps/agent/src/a2ui_dynamic_schema.py`                     |
| Flight schema JSON                   | `apps/agent/src/a2ui/schemas/flight_schema.json`            |
| Showcase config                      | `showcase.json`                                             |

### Adding a custom component

1. **Define** the component schema in `definitions.ts`:

   ```typescript
   MyWidget: {
     description: "A brief description for the agent.",
     props: z.object({ title: z.string(), value: z.number() }),
   },
   ```

2. **Render** it in `renderers.tsx`:

   ```typescript
   MyWidget: ({ props }) => (
     <div>{props.title}: {props.value}</div>
   ),
   ```

   Renderers are type-checked against the definitions — TypeScript will error if props don't match.

3. **Use it** from the agent. The component is automatically available to both fixed-schema templates and the dynamic-schema LLM.

### Adding a new fixed-schema tool

1. Create a JSON schema file in `apps/agent/src/a2ui/schemas/` describing the component tree.
2. Create a Python tool that loads the schema with `a2ui.load_schema()` and returns `a2ui.render(operations=[...])` with your data. See `a2ui_fixed_schema.py` for the pattern.

### Showcase mode

`showcase.json` controls which suggestion pills are visually highlighted. Set `"showcase": "a2ui"` to highlight the A2UI demos, or `"showcase": "default"` for no highlights. This is configured automatically when scaffolding via `npx copilotkit create --framework a2ui`.

### Further reading

- [A2UI Specification](https://a2ui.org/specification/)
- [CopilotKit A2UI Documentation](https://docs.copilotkit.ai)

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

1. The LangGraph agent is running on port 8000
2. Your OpenAI API key is set correctly
3. Both servers started successfully

### Python Dependencies

If you encounter Python import errors:

```bash
npm install:agent
```
