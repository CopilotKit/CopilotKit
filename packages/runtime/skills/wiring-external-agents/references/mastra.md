Mastra — local-first TypeScript agent framework wired via `@ag-ui/mastra`.

## Install

```bash
pnpm add @ag-ui/mastra
# plus your Mastra SDK:
pnpm add @mastra/core
```

## Minimal wire-up

```typescript
import {
  CopilotRuntime,
  createCopilotRuntimeHandler,
} from "@copilotkit/runtime/v2";
import { MastraAgent } from "@ag-ui/mastra";
import { Mastra } from "@mastra/core";
import { weatherAgent } from "./agents/weather"; // your Mastra agent

const mastra = new Mastra({
  agents: { weather: weatherAgent },
});

const runtime = new CopilotRuntime({
  agents: MastraAgent.getLocalAgents({
    mastra,
    // Required — Mastra Memory scopes working-memory buckets by resourceId.
    // Passing an empty string throws AGENT_MEMORY_MISSING_RESOURCE_ID on every
    // turn when the runtime supplies a threadId (which it always does).
    resourceId: "default",
  }),
});

const handler = createCopilotRuntimeHandler({
  runtime,
  basePath: "/api/copilotkit",
});

export default { fetch: handler };
```

## Remote Mastra server

If Mastra is running as a separate HTTP service, the simplest wiring is the
generic `HttpAgent` from `@ag-ui/client` — it speaks the AG-UI protocol that
Mastra's HTTP server already emits:

```typescript
import { HttpAgent } from "@ag-ui/client";

const runtime = new CopilotRuntime({
  agents: {
    weather: new HttpAgent({ url: `${process.env.MASTRA_URL!}/weather` }),
  },
});
```

## Gotcha — do NOT wrap the record

`getLocalAgents` already returns `Record<string, AbstractAgent>`. Wrapping it in a key
(`{ mastra: getLocalAgents(...) }`) breaks the registry.

Source: `docs/content/docs/integrations/mastra/quickstart.mdx:213-220`.
