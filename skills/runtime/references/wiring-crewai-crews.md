CrewAI Crews — multi-agent crews wired via `@ag-ui/crewai`.

## Install

```bash
pnpm add @ag-ui/crewai
```

## Minimal wire-up

```typescript
import {
  CopilotRuntime,
  createCopilotRuntimeHandler,
} from "@copilotkit/runtime/v2";
import { CrewAIAgent } from "@ag-ui/crewai";

const runtime = new CopilotRuntime({
  agents: {
    default: new CrewAIAgent({
      url: process.env.CREWAI_URL ?? "http://localhost:8000/",
    }),
  },
});

const handler = createCopilotRuntimeHandler({
  runtime,
  basePath: "/api/copilotkit",
});

export default { fetch: handler };
```

## Crews vs Flows

CrewAI ships two products:

- **Crews** — multi-agent orchestration. Use `CrewAIAgent` from `@ag-ui/crewai`.
- **Flows** — event-driven pipelines. Use the generic `HttpAgent` from `@ag-ui/client`
  (there's no framework-specific wrapper). See [crewai-flows.md](crewai-flows.md).

## Gotcha — trailing slash

The `url` for `CrewAIAgent` traditionally ends with a trailing slash
(`http://localhost:8000/`). Follow whatever your CrewAI server exposes — don't strip it.

Source: `@ag-ui/crewai` package types (`CrewAIAgent` constructor);
`docs/content/docs/reference/v1/sdk/python/CrewAIAgent.mdx` for v1 Python-side
reference. The v2 integrations docs currently ship only a Flows quickstart at
`docs/content/docs/integrations/crewai-flows/quickstart.mdx` — there is no dedicated
Crews quickstart yet.
