AWS Strands — wired via the bare `HttpAgent` from `@ag-ui/client`.

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
      url: process.env.STRANDS_URL ?? "http://localhost:8000",
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

Strands agents run on AWS and typically expose an AG-UI-speaking endpoint (API Gateway or
Lambda Function URL). Point `HttpAgent({ url })` at that endpoint.

## Gotcha — AWS auth

Strands deployments often require IAM SigV4 or a custom header. If your Strands endpoint
needs an `Authorization` header, attach it via runtime `hooks.onBeforeHandler` by
modifying the `Request` before the proxy call, OR fronting Strands with a lightweight
Lambda that strips client credentials and adds the IAM signing.

Source: `docs/content/docs/integrations/aws-strands/quickstart.mdx`.
