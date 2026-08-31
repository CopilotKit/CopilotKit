Google ADK (Agent Development Kit) — wired via the bare `HttpAgent` from `@ag-ui/client`.

## Install

```bash
pnpm add @ag-ui/client
```

## Minimal wire-up

```typescript
import {
  CopilotRuntime,
  createCopilotRuntimeHandler,
} from "@copilotkit/runtime/v2";
import { HttpAgent } from "@ag-ui/client";

const runtime = new CopilotRuntime({
  agents: {
    default: new HttpAgent({
      url: process.env.ADK_URL ?? "http://localhost:8000/",
    }),
  },
});

const handler = createCopilotRuntimeHandler({
  runtime,
  basePath: "/api/copilotkit",
});

export default { fetch: handler };
```

## Server side

Your ADK Python agent must speak AG-UI. ADK ships an AG-UI FastAPI adapter — use it
and point `HttpAgent({ url })` at the FastAPI route.

## Gotcha — env-sourced credentials

ADK typically authenticates to Google Cloud via service-account credentials
(`GOOGLE_APPLICATION_CREDENTIALS`). Those live on the ADK Python server, not in the
CopilotKit runtime. The runtime just forwards AG-UI events.

Source: `docs/content/docs/integrations/adk/quickstart.mdx`.
