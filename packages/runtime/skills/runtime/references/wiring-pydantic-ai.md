PydanticAI — wired via the bare `HttpAgent` from `@ag-ui/client`.

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
      url: process.env.PYDANTIC_AI_URL ?? "http://localhost:8000/",
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

On the Python side, PydanticAI exposes an AG-UI-compliant endpoint via its built-in
ASGI adapter. The URL you pass to `HttpAgent` is that endpoint (e.g. an FastAPI route
that returns a streaming response of AG-UI events).

## Gotcha — no suffix required

Unlike LlamaIndex (`/run`) and Agno (`/agui`), PydanticAI does not mandate a specific
sub-path. Whatever path your Python server mounts the AG-UI app at — use that.

Source: `docs/content/docs/integrations/pydantic-ai/quickstart.mdx`.
