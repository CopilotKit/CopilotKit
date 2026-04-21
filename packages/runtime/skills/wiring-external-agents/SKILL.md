---
name: wiring-external-agents
description: >
  Connect Mastra, LangGraph, CrewAI Crews, CrewAI Flows, PydanticAI, Google ADK, LlamaIndex,
  Agno, AWS Strands, Microsoft Agent Framework, AG2, or A2A into CopilotRuntime. Every
  framework is registered the same way — as an AbstractAgent instance on
  CopilotRuntime({ agents }). Uses framework-specific classes (MastraAgent, LangGraphAgent,
  CrewAIAgent, LlamaIndexAgent, AgnoAgent, A2AAgent) when available, otherwise the bare
  HttpAgent from @ag-ui/client. MCP Apps is runtime-level middleware, not an agent — wire
  via CopilotRuntime({ mcpApps }) instead.
type: core
library: copilotkit
library_version: "1.56.2"
requires:
  - copilotkit/setup-endpoint
sources:
  - "CopilotKit/CopilotKit:docs/content/docs/integrations/mastra/quickstart.mdx"
  - "CopilotKit/CopilotKit:docs/content/docs/integrations/langgraph/quickstart.mdx"
  - "CopilotKit/CopilotKit:docs/content/docs/integrations/crewai-flows/quickstart.mdx"
  - "CopilotKit/CopilotKit:docs/content/docs/integrations/pydantic-ai/quickstart.mdx"
  - "CopilotKit/CopilotKit:docs/content/docs/integrations/adk/quickstart.mdx"
  - "CopilotKit/CopilotKit:docs/content/docs/integrations/llamaindex/quickstart.mdx"
  - "CopilotKit/CopilotKit:docs/content/docs/integrations/agno/quickstart.mdx"
  - "CopilotKit/CopilotKit:docs/content/docs/integrations/aws-strands/quickstart.mdx"
  - "CopilotKit/CopilotKit:docs/content/docs/integrations/microsoft-agent-framework/quickstart.mdx"
  - "CopilotKit/CopilotKit:docs/content/docs/integrations/ag2/quickstart.mdx"
  - "CopilotKit/CopilotKit:docs/content/docs/integrations/a2a/quickstart.mdx"
  - "CopilotKit/CopilotKit:packages/runtime/src/v2/runtime/core/runtime.ts"
---

# CopilotKit — Wire External Agent Frameworks

`CopilotRuntime` takes any `AbstractAgent` subclass. Every framework below ships a
ready-made subclass you construct and hand to `agents: { ... }`.

| Framework                 | Package                     | Construct                                                                                                                    |
| ------------------------- | --------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Mastra                    | `@ag-ui/mastra`             | `MastraAgent.getLocalAgents({ mastra, resourceId? })` (record; `resourceId` required only when the agent has Memory enabled) |
| LangGraph                 | `@ag-ui/langgraph`          | `new LangGraphAgent({ deploymentUrl, graphId })`                                                                             |
| CrewAI Crews              | `@ag-ui/crewai`             | `new CrewAIAgent({ url })`                                                                                                   |
| CrewAI Flows              | `@ag-ui/client` (HttpAgent) | `new HttpAgent({ url })`                                                                                                     |
| PydanticAI                | `@ag-ui/client` (HttpAgent) | `new HttpAgent({ url })`                                                                                                     |
| Google ADK                | `@ag-ui/client` (HttpAgent) | `new HttpAgent({ url })`                                                                                                     |
| LlamaIndex                | `@ag-ui/llamaindex`         | `new LlamaIndexAgent({ url: ".../run" })` (`/run` suffix)                                                                    |
| Agno                      | `@ag-ui/agno`               | `new AgnoAgent({ url: ".../agui" })` (`/agui` suffix)                                                                        |
| AWS Strands               | `@ag-ui/client` (HttpAgent) | `new HttpAgent({ url })`                                                                                                     |
| Microsoft Agent Framework | `@ag-ui/client` (HttpAgent) | `new HttpAgent({ url })`                                                                                                     |
| AG2                       | `@ag-ui/client` (HttpAgent) | `new HttpAgent({ url })`                                                                                                     |
| A2A                       | `@ag-ui/a2a`                | `new A2AAgent({ a2aClient })` (pre-built `A2AClient`, not a URL)                                                             |

MCP Apps is NOT a framework — it's a runtime middleware:
`new CopilotRuntime({ agents, mcpApps: { servers: [...] } })`. See
[references/mcp-apps-middleware.md](references/mcp-apps-middleware.md).

## Setup

Generic shape for every framework:

```typescript
import {
  CopilotRuntime,
  createCopilotRuntimeHandler,
} from "@copilotkit/runtime/v2";
import { HttpAgent } from "@ag-ui/client";

const runtime = new CopilotRuntime({
  agents: {
    default: new HttpAgent({ url: process.env.AGENT_URL! }),
  },
});

const handler = createCopilotRuntimeHandler({
  runtime,
  basePath: "/api/copilotkit",
});

export default { fetch: handler };
```

## Core Patterns

### Mastra (local agents)

```typescript
import {
  CopilotRuntime,
  createCopilotRuntimeHandler,
} from "@copilotkit/runtime/v2";
import { MastraAgent } from "@ag-ui/mastra";
import { mastra } from "./mastra";

const runtime = new CopilotRuntime({
  // resourceId scopes Mastra Memory's working-memory buckets. Required when
  // the Mastra agent has Memory enabled (the runtime always supplies a
  // threadId, so Memory-enabled agents effectively always need it). Agents
  // without Memory can omit it — `examples/integrations/mastra` calls
  // `getLocalAgents({ mastra })` with no resourceId. See references/mastra.md.
  agents: MastraAgent.getLocalAgents({ mastra, resourceId: "default" }),
});

const handler = createCopilotRuntimeHandler({
  runtime,
  basePath: "/api/copilotkit",
});

export default { fetch: handler };
```

See [references/mastra.md](references/mastra.md).

### LangGraph

```typescript
import {
  CopilotRuntime,
  createCopilotRuntimeHandler,
} from "@copilotkit/runtime/v2";
import { LangGraphAgent } from "@ag-ui/langgraph";

const runtime = new CopilotRuntime({
  agents: {
    supportAgent: new LangGraphAgent({
      deploymentUrl: process.env.LANGGRAPH_URL!,
      graphId: "support",
      langsmithApiKey: process.env.LANGSMITH_API_KEY,
    }),
  },
});

const handler = createCopilotRuntimeHandler({
  runtime,
  basePath: "/api/copilotkit",
});

export default { fetch: handler };
```

See [references/langgraph.md](references/langgraph.md).

### Multi-framework single runtime

```typescript
import {
  CopilotRuntime,
  createCopilotRuntimeHandler,
} from "@copilotkit/runtime/v2";
import { LangGraphAgent } from "@ag-ui/langgraph";
import { CrewAIAgent } from "@ag-ui/crewai";
import { HttpAgent } from "@ag-ui/client";

const runtime = new CopilotRuntime({
  agents: {
    research: new LangGraphAgent({
      deploymentUrl: process.env.LANGGRAPH_URL!,
      graphId: "research",
    }),
    writer: new CrewAIAgent({ url: process.env.CREWAI_URL! }),
    translator: new HttpAgent({ url: process.env.PYDANTIC_AI_URL! }),
  },
});

const handler = createCopilotRuntimeHandler({
  runtime,
  basePath: "/api/copilotkit",
});

export default { fetch: handler };
```

### MCP Apps (runtime middleware, not an agent)

```typescript
import {
  CopilotRuntime,
  createCopilotRuntimeHandler,
  BuiltInAgent,
} from "@copilotkit/runtime/v2";

const runtime = new CopilotRuntime({
  agents: {
    default: new BuiltInAgent({ model: "openai/gpt-4o" }),
  },
  mcpApps: {
    servers: [{ type: "http", url: "https://mcp.example.com/mcp" }],
  },
});

const handler = createCopilotRuntimeHandler({
  runtime,
  basePath: "/api/copilotkit",
});

export default { fetch: handler };
```

## Common Mistakes

### HIGH Using runtimeUrl as the agent URL

Wrong:

```typescript
import { LangGraphAgent } from "@ag-ui/langgraph";

new LangGraphAgent({ deploymentUrl: "/api/copilotkit", graphId: "agent" });
```

Correct:

```typescript
new LangGraphAgent({
  deploymentUrl: process.env.LANGGRAPH_URL!,
  graphId: "agent",
});
```

External agents take their own upstream URL — the framework's server or deployment. The
CopilotKit runtime URL (`/api/copilotkit`) is the frontend↔runtime hop, not the
runtime↔agent hop.

Source: `docs/integrations/langgraph/quickstart.mdx:355`.

### HIGH Wrapping MastraAgent.getLocalAgents in a key

Wrong:

```typescript
new CopilotRuntime({
  agents: {
    mastra: MastraAgent.getLocalAgents({ mastra, resourceId: "default" }),
  },
});
```

Correct:

```typescript
new CopilotRuntime({
  agents: MastraAgent.getLocalAgents({ mastra, resourceId: "default" }),
});
```

`MastraAgent.getLocalAgents` already returns a `Record<string, AbstractAgent>`. Wrapping
it turns the record into a nested value on one key, which fails the registry's shape check.

Source: `docs/integrations/mastra/quickstart.mdx:213-220`.

### MEDIUM Missing /run or /agui suffix on LlamaIndex / Agno

Wrong:

```typescript
import { LlamaIndexAgent } from "@ag-ui/llamaindex";
import { AgnoAgent } from "@ag-ui/agno";

new LlamaIndexAgent({ url: "http://localhost:8000" });
new AgnoAgent({ url: "http://localhost:8000" });
```

Correct:

```typescript
new LlamaIndexAgent({ url: "http://localhost:8000/run" });
new AgnoAgent({ url: "http://localhost:8000/agui" });
```

LlamaIndex requires a `/run` suffix, Agno requires `/agui`. The generic HttpAgent fallback
would 404 without these.

Source: `docs/integrations/llamaindex/quickstart.mdx:258`;
`docs/integrations/agno/quickstart.mdx:215`.

### MEDIUM Passing a URL to A2AAgent instead of an A2AClient

Wrong:

```typescript
import { A2AAgent } from "@ag-ui/a2a";

new A2AAgent({ url: "https://a2a.example" } as any);
```

Correct:

```typescript
import { A2AAgent } from "@ag-ui/a2a";
import { A2AClient } from "@a2a-js/sdk/client";

const a2aClient = new A2AClient("https://a2a.example");
new A2AAgent({ a2aClient });
```

`A2AAgent` expects a pre-built `A2AClient` instance — A2A has its own handshake that
the client handles.

Source: `examples/integrations/a2a-a2ui/app/api/copilotkit/[[...slug]]/route.tsx:12`.

### HIGH Treating MCP Apps as an agent

Wrong:

```typescript
new CopilotRuntime({
  agents: {
    mcpApps: new MCPAppsAgent({
      /* ... */
    } as any),
  } as any,
});
```

Correct:

```typescript
new CopilotRuntime({
  agents: {
    /* your real agents */
  },
  mcpApps: {
    servers: [{ type: "http", url: "https://mcp.example.com/mcp" }],
  },
});
```

MCP Apps is runtime-level middleware auto-applied to all agents. Configure via
`runtime.mcpApps`, not `agents`.

Source: `packages/runtime/src/v2/runtime/core/runtime.ts:39-63`.

### MEDIUM Passing a framework `client` instead of its Agent wrapper

Wrong:

```typescript
import { mastraClient } from "./mastra"; // a Mastra client object

new CopilotRuntime({
  agents: { default: mastraClient as any },
});
```

Correct:

```typescript
import { MastraAgent } from "@ag-ui/mastra";
import { mastra } from "./mastra";

new CopilotRuntime({
  agents: MastraAgent.getLocalAgents({ mastra, resourceId: "default" }),
});
```

`CopilotRuntime` expects `AbstractAgent` subclasses. Framework SDK clients are not
AbstractAgent instances — always pass the `@ag-ui/<framework>` wrapper or `HttpAgent`.

Source: `packages/runtime/src/v2/runtime/core/runtime.ts:111-128`.

## References

- [Mastra](references/mastra.md)
- [LangGraph](references/langgraph.md)
- [CrewAI Crews](references/crewai-crews.md)
- [CrewAI Flows](references/crewai-flows.md)
- [PydanticAI](references/pydantic-ai.md)
- [Google ADK](references/adk.md)
- [LlamaIndex](references/llamaindex.md)
- [Agno](references/agno.md)
- [AWS Strands](references/aws-strands.md)
- [Microsoft Agent Framework](references/ms-agent-framework.md)
- [AG2](references/ag2.md)
- [A2A](references/a2a.md)
- [MCP Apps middleware](references/mcp-apps-middleware.md)

## See also

- `copilotkit/setup-endpoint` — mount the runtime that fronts these agents
- `copilotkit/built-in-agent` — alternative when you want an in-tree agent
- `copilotkit/agent-runners` — runner choice is independent of framework
