CrewAI Flows — wired via the bare `HttpAgent` from `@ag-ui/client`. No dedicated wrapper.

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
      url: process.env.CREWAI_FLOWS_URL ?? "http://localhost:8000/",
    }),
  },
});

const handler = createCopilotRuntimeHandler({
  runtime,
  basePath: "/api/copilotkit",
});

export default { fetch: handler };
```

## Flows vs Crews

Flows is the event-driven pipeline product. For multi-agent Crews orchestration, use
`CrewAIAgent` from `@ag-ui/crewai` instead — see [crewai-crews.md](crewai-crews.md).

## Gotcha — AG-UI compatibility

Your CrewAI Flows server must speak AG-UI over HTTP. If you control the server, use the
official CrewAI Python AG-UI adapter. `HttpAgent` is a thin bridge — any server that
emits AG-UI events at the URL works.

Source: `docs/content/docs/integrations/crewai-flows/quickstart.mdx`.
