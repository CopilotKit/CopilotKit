MCP Apps — runtime-level middleware that auto-applies to all agents. NOT an agent.

MCP Apps lets any agent in the runtime access tools from external MCP servers. It is
configured on `CopilotRuntime` directly, not as an entry in `agents`.

## Install

MCP support is provided by the runtime directly — no extra package install for the
middleware itself. Your MCP servers are separate services you point at.

## Minimal wire-up

```typescript
import {
  CopilotRuntime,
  createCopilotRuntimeHandler,
  BuiltInAgent,
} from "@copilotkit/runtime/v2";

const runtime = new CopilotRuntime({
  agents: {
    default: new BuiltInAgent({ model: "openai/gpt-4o", maxSteps: 5 }),
  },
  mcpApps: {
    servers: [
      {
        type: "http",
        url: "https://mcp.example.com/mcp",
      },
      {
        type: "http",
        url: "https://another-mcp.example.com/mcp",
        agentId: "default", // scope this server to one agent only
      },
    ],
  },
});

const handler = createCopilotRuntimeHandler({
  runtime,
  basePath: "/api/copilotkit",
});

export default { fetch: handler };
```

## Per-agent scoping

Each server entry accepts an optional `agentId`. When set, the server's tools are only
exposed to that agent. Omit it to expose to all agents.

## Gotcha — do NOT put MCP under agents

```typescript
// WRONG
new CopilotRuntime({
  agents: {
    mcpApps: new MCPAppsAgent({
      /* ... */
    }),
  } as any,
});
```

There is no `MCPAppsAgent`. MCP Apps is runtime middleware and belongs on the top-level
`CopilotRuntime` options.

Source: `packages/runtime/src/v2/runtime/core/runtime.ts:39-63`.
