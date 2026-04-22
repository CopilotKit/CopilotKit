LangGraph — wired via `@ag-ui/langgraph`. Supports LangGraph Platform deployments and
self-hosted LangGraph servers.

## Install

```bash
pnpm add @ag-ui/langgraph
```

## Minimal wire-up

```typescript
import {
  CopilotRuntime,
  createCopilotRuntimeHandler,
} from "@copilotkit/runtime/v2";
import { LangGraphAgent } from "@ag-ui/langgraph";

const runtime = new CopilotRuntime({
  agents: {
    default: new LangGraphAgent({
      deploymentUrl: process.env.LANGGRAPH_URL!,
      graphId: "agent",
      langsmithApiKey: process.env.LANGSMITH_API_KEY, // optional
    }),
  },
});

const handler = createCopilotRuntimeHandler({
  runtime,
  basePath: "/api/copilotkit",
});

export default { fetch: handler };
```

## Config fields

| Field             | Notes                                                                 |
| ----------------- | --------------------------------------------------------------------- |
| `deploymentUrl`   | Base URL of the LangGraph Platform deployment (or self-hosted server) |
| `graphId`         | The graph name registered with the deployment (e.g. `"agent"`)        |
| `langsmithApiKey` | Optional — enables LangSmith tracing                                  |

## Gotcha — `deploymentUrl` is NOT the CopilotKit runtime URL

The most common mistake is setting `deploymentUrl` to `/api/copilotkit`. That is the
frontend↔runtime URL, not the LangGraph server. Use the actual LangGraph deployment URL.

Source: `docs/content/docs/integrations/langgraph/quickstart.mdx:355`.
