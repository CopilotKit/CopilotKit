AG2 — wired via the bare `HttpAgent` from `@ag-ui/client`. No dedicated `@ag-ui/ag2`
package exists; AG2 is a standard HTTP AG-UI framework.

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
      url: process.env.AG2_URL ?? "http://localhost:8000/",
    }),
  },
});

const handler = createCopilotRuntimeHandler({
  runtime,
  basePath: "/api/copilotkit",
});

export default { fetch: handler };
```

## Gotcha — no dedicated package

Unlike Mastra / LangGraph / CrewAI / LlamaIndex / Agno, AG2 has no `@ag-ui/ag2` package.
Always use the generic `HttpAgent`. If an older doc references a dedicated AG2 package,
treat it as stale.

Source: `docs/content/docs/integrations/ag2/quickstart.mdx`; maintainer Phase 4 resolution.
