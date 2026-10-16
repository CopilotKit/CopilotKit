# Generative UI example

A Next.js app where the agent renders interactive surfaces inline in the chat.
The surfaces use the standard components (`standardUI`). The provider turns
generative UI on with one prop:

```tsx
<CopilotKitProvider
  runtimeUrl="/api/copilotkit"
  useSingleEndpoint={false}
  generativeUI={{ ui: standardUI, transport: "markdown" }}
>
```

## Setup

1. Install the dependencies. Run this command from the repo root:

   ```bash
   pnpm install
   ```

2. Build the CopilotKit packages. Run this command from the repo root:

   ```bash
   pnpm nx run-many -t build --projects=@copilotkit/react-core,@copilotkit/runtime
   ```

3. Copy the env file, then set `OPENAI_API_KEY` in `.env.local`:

   ```bash
   cp examples/v2/a2ui-markdown/.env.example examples/v2/a2ui-markdown/.env.local
   ```

## Run

Start the app with the built-in agent:

```bash
pnpm --filter @copilotkit/example-a2ui-markdown example-dev
```

Open `http://localhost:3011` and click a suggestion below the chat.

To use the LangGraph Python agent in [`agent/`](./agent), you need `uv`. In a
second terminal, run these commands from `examples/v2/a2ui-markdown`:

```bash
pnpm install:agent
pnpm dev:agent                     # serves http://localhost:8011/copilotkit
```

Then open `http://localhost:3011/?agent=langgraph`.

## URL parameters

The links in the page header set these parameters:

| Parameter             | What it does                                                                     |
| --------------------- | -------------------------------------------------------------------------------- |
| `?transport=markdown` | The default. The agent writes the operations in ` ```a2ui ` fences in its reply. |
| `?transport=tool`     | The agent calls the `render_ui` tool. The runtime streams the surfaces.          |
| `?agent=langgraph`    | The chat talks to the LangGraph Python agent instead of the built-in agent.      |

Neither agent has code for generative UI. With the markdown transport, the
provider sends the component schema and the fence guideline as context. With
the tool transport, the runtime (`generativeUI: true` in
`app/api/copilotkit/[[...slug]]/route.ts`) gives the agent the `render_ui`
tool.

## The `/catalog` page

Open `http://localhost:3011/catalog` to see every standard component. Each
sample shows:

- The live surface.
- The description and props that the model sees.
- The operations that render the sample.

The page needs no model and no API key. A scripted agent streams the
surfaces in the browser (`app/catalog/catalog-agent.ts`). If a component has
no sample, the page names it at the top.
