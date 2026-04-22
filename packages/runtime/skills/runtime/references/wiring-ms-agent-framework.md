Microsoft Agent Framework — wired via the bare `HttpAgent` from `@ag-ui/client`.
Both Python and .NET variants use the same HTTP bridge.

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
      url: process.env.MS_AGENT_URL!, // Python or .NET AG-UI endpoint
    }),
  },
});

const handler = createCopilotRuntimeHandler({
  runtime,
  basePath: "/api/copilotkit",
});

export default { fetch: handler };
```

## Gotcha — pick the right endpoint path

Microsoft Agent Framework ships both Python and .NET adapters. The AG-UI mount path
depends on which adapter you chose and how you configured it — follow the framework's
quickstart to find the exact URL. `HttpAgent` simply forwards.

Source: `docs/content/docs/integrations/microsoft-agent-framework/quickstart.mdx`.
