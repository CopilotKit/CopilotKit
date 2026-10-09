# CopilotKit × Manufact: MCP Apps

The finished example from the [Manufact cookbook recipe](https://docs.copilotkit.ai/cookbook/manufact).
A CopilotKit chat that can map your orders. The map is its own MCP App, built with Manufact's
[mcp-use](https://github.com/mcp-use/mcp-use) SDK, and CopilotKit renders it right in the conversation.

```
fizzy-maps/   The MCP App (mcp-use): a show-map tool and the React map view it renders
web/          The Next.js app: CopilotKit chat and runtime, plus the sample order data
```

## Run it

You need Node.js 22.22.2 or newer and an OpenAI API key.

```bash
npm install
cp web/.env.example web/.env   # then paste your OPENAI_API_KEY into it
npm run dev
```

- Web app: http://localhost:3000. Ask it to **Map my orders**, then **Only show the delayed ones**.
- MCP App: http://localhost:3001/mcp, with the mcp-use Inspector at http://localhost:3001/mcp/inspector.

## What's inside

- `fizzy-maps/index.ts`: the MCP server and its `show-map` tool. The tool's `view` block binds it to
  `views/map-view/view.tsx`.
- `fizzy-maps/views/map-view/view.tsx`: the React view. It reads the tool result with `useToolContext()` and
  draws it with react-leaflet.
- `web/app/api/copilotkit/[[...slug]]/route.ts`: the CopilotKit runtime. The `mcpApps.servers` entry is the whole
  integration.
- `web/app/page.tsx`: the chat, plus `useAgentContext` to hand the agent the order data.

## Deploy the MCP App to Manufact Cloud

```bash
cd fizzy-maps
npx mcp-use login
npx mcp-use deploy
```

Then set `MAP_MCP_URL` in `web/.env` to the URL the CLI prints.
