# CopilotKit <> Vest MCP Starter

This is a starter template for connecting a CopilotKit agent to the
[Vest](https://www.getvest.ai) MCP server so your agent can recommend AI/SaaS
tools and surface live cashback offers instead of guessing from training data.

Vest is a **hosted, public** streamable-HTTP MCP server, so — unlike the
[MCP Apps starter](../mcp-apps) — there is no local MCP server to run. The
[`MCPAppsMiddleware`](https://www.npmjs.com/package/@ag-ui/mcp-apps-middleware)
just points at the hosted endpoint and the Vest tools appear to the agent.

## Project Structure

```
.
├── app/                       # Next.js App Router pages and API routes
│   ├── page.tsx               # Main page (CopilotChat)
│   ├── layout.tsx
│   ├── globals.css
│   └── api/copilotkit/        # CopilotKit API route + Vest MCP middleware
│       └── route.ts
├── next.config.ts
├── tsconfig.json
└── package.json
```

## Prerequisites

- Node.js 20+
- A package manager (npm / pnpm / yarn / bun)
- An OpenAI API key (the example agent uses `openai/gpt-4o`)

## Getting Started

1. Install dependencies:

```bash
npm install
```

2. Set your OpenAI API key:

```bash
export OPENAI_API_KEY=sk-...
```

3. Run the dev server:

```bash
npm run dev
```

4. Open [http://localhost:3000](http://localhost:3000) and ask the agent
   something like _"What's the best text-to-speech tool and how much cashback
   can I get?"_ — it will call the Vest tools to answer.

## How it Works

The Vest MCP server is attached to the agent via `MCPAppsMiddleware` in
[`app/api/copilotkit/route.ts`](./app/api/copilotkit/route.ts):

```typescript
new MCPAppsMiddleware({
  mcpServers: [
    {
      type: "http",
      url: "https://mcp.getvest.ai/mcp",
      serverId: "vest",
    },
  ],
});
```

Once the middleware is applied, the agent automatically discovers the Vest
tools and can call them like any other tool. The available tools include:

| Tool | What it does |
| --- | --- |
| `vest_search_tools` | Search and browse the Vest cashback catalog of AI tools |
| `vest_build_stack` | Recommend a curated stack of tools for a user goal |
| `vest_estimate_cashback` | Estimate cashback for an AI tool subscription |
| `vest_get_signup_link` | Generate a tracked signup link for a tool |
| `vest_get_account` | Get the authenticated user's Vest account / wallet |
| `vest_submit_tool_request` | Request a tool be added to the catalog |

> Tool names above are taken from the live `tools/list` on `https://mcp.getvest.ai/mcp`.

Some Vest tools ship MCP UI resources, so CopilotKit renders the interaction
inline in the chat.

## Documentation

- [Vest MCP docs](https://docs.getvest.ai/mcp)
- [CopilotKit MCP Apps integration](https://docs.copilotkit.ai/integrations/built-in-agent/generative-ui/mcp-apps)
- [`@ag-ui/mcp-apps-middleware`](https://www.npmjs.com/package/@ag-ui/mcp-apps-middleware)
