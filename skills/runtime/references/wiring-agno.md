Agno — wired via `@ag-ui/agno`. Requires an `/agui` URL suffix.

## Install

```bash
pnpm add @ag-ui/agno
```

## Minimal wire-up

```typescript
import {
  CopilotRuntime,
  createCopilotRuntimeHandler,
} from "@copilotkit/runtime/v2";
import { AgnoAgent } from "@ag-ui/agno";

const runtime = new CopilotRuntime({
  agents: {
    default: new AgnoAgent({
      url: process.env.AGNO_URL ?? "http://localhost:8000/agui",
    }),
  },
});

const handler = createCopilotRuntimeHandler({
  runtime,
  basePath: "/api/copilotkit",
});

export default { fetch: handler };
```

## Gotcha — the `/agui` suffix is mandatory

Agno's AG-UI FastAPI app mounts at `/agui`. Pointing `url` at the server root
(`http://localhost:8000`) returns 404. Always include `/agui`.

Source: `docs/content/docs/integrations/agno/quickstart.mdx:215`.
