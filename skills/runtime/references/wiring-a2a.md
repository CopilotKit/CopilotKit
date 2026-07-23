A2A (Agent2Agent) — wired via `@ag-ui/a2a`. Requires a pre-built `A2AClient` (not a URL).

## Install

```bash
pnpm add @ag-ui/a2a @a2a-js/sdk
```

## Minimal wire-up

```typescript
import {
  CopilotRuntime,
  createCopilotRuntimeHandler,
} from "@copilotkit/runtime/v2";
import { A2AAgent } from "@ag-ui/a2a";
import { A2AClient } from "@a2a-js/sdk/client";

const a2aClient = new A2AClient(process.env.A2A_URL!);

const runtime = new CopilotRuntime({
  agents: {
    default: new A2AAgent({ a2aClient }),
  },
});

const handler = createCopilotRuntimeHandler({
  runtime,
  basePath: "/api/copilotkit",
});

export default { fetch: handler };
```

## Gotcha — do NOT pass `{ url }`

`A2AAgent` takes `{ a2aClient }`. The A2A protocol has its own handshake; the client
object handles it. Passing `{ url: "..." }` is a type error and will fail at runtime.

Source: `examples/integrations/a2a-a2ui/app/api/copilotkit/[[...slug]]/route.tsx:12`.
