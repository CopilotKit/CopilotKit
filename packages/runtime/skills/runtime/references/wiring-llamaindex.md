LlamaIndex — wired via `@ag-ui/llamaindex`. Requires a `/run` URL suffix.

## Install

```bash
pnpm add @ag-ui/llamaindex
```

## Minimal wire-up

```typescript
import {
  CopilotRuntime,
  createCopilotRuntimeHandler,
} from "@copilotkit/runtime/v2";
import { LlamaIndexAgent } from "@ag-ui/llamaindex";

const runtime = new CopilotRuntime({
  agents: {
    default: new LlamaIndexAgent({
      url: process.env.LLAMAINDEX_URL ?? "http://localhost:8000/run",
    }),
  },
});

const handler = createCopilotRuntimeHandler({
  runtime,
  basePath: "/api/copilotkit",
});

export default { fetch: handler };
```

## Gotcha — the `/run` suffix is mandatory

LlamaIndex's AG-UI adapter mounts its workflow endpoint at `/run`. Pointing `url` at the
server root (`http://localhost:8000`) returns 404. Always include `/run`.

Source: `docs/content/docs/integrations/llamaindex/quickstart.mdx:258`.
