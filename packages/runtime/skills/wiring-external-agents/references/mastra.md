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
  agents: MastraAgent.getLocalAgents({ mastra }),
});

const handler = createCopilotRuntimeHandler({
  runtime,
  basePath: "/api/copilotkit",
});

export default { fetch: handler };
```

## Remote Mastra server

If Mastra is running as a separate HTTP service, use `MastraAgent.getRemoteAgents`
(API parallels `getLocalAgents`) or wire individual agents:

```typescript
import { MastraAgent } from "@ag-ui/mastra";

const runtime = new CopilotRuntime({
  agents: MastraAgent.getRemoteAgents({
    baseUrl: process.env.MASTRA_URL!,
  }),
});
```

## Gotcha — do NOT wrap the record

`getLocalAgents` already returns `Record<string, AbstractAgent>`. Wrapping it in a key
(`{ mastra: getLocalAgents(...) }`) breaks the registry.

Source: `docs/content/docs/integrations/mastra/quickstart.mdx:213-220`.
