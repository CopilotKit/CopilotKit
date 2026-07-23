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

Strands deployments often require IAM SigV4 or a custom header. `HttpAgent` accepts a
`headers: Record<string, string>` option that is attached to every outbound runtime →
Strands call:

```typescript
new HttpAgent({
  url: process.env.STRANDS_URL!,
  headers: { Authorization: `Bearer ${process.env.STRANDS_TOKEN!}` },
});
```

`hooks.onBeforeHandler` will NOT work for this — those hooks run on the inbound frontend
→ runtime request, not on the outbound runtime → Strands call that `HttpAgent` issues.
For SigV4 (which needs a per-request signature over the body), front Strands with a
lightweight Lambda / API Gateway authorizer that strips client credentials and adds the
IAM signing, then point `HttpAgent({ url })` at that shim.

Source: `node_modules/@ag-ui/client/dist/index.d.ts` (`HttpAgentConfig.headers`);
`docs/content/docs/integrations/aws-strands/quickstart.mdx`.
