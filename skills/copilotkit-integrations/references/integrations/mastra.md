# Mastra Integration

Mastra is a TypeScript-native agent framework. The CopilotKit integration runs entirely in Node.js -- no separate Python server needed. The agent runs within the Next.js process via Mastra's dev server.

## Prerequisites

- Node.js 18+
- OpenAI API key

## Key Dependencies

```json
{
  "@ag-ui/mastra": "beta",
  "@mastra/core": "beta",
  "@mastra/memory": "beta",
  "@mastra/libsql": "beta",
  "mastra": "beta",
  "@copilotkit/react": "latest",
  "@copilotkit/runtime": "latest"
}
```

## Agent Definition (src/mastra/agents/index.ts)

```typescript
import { openai } from "@ai-sdk/openai";
import { Agent } from "@mastra/core/agent";
import { weatherTool } from "@/mastra/tools";
import { LibSQLStore } from "@mastra/libsql";
import { z } from "zod";
import { Memory } from "@mastra/memory";

// Define shared state schema with Zod
export const AgentState = z.object({
  proverbs: z.array(z.string()).default([]),
});

export const weatherAgent = new Agent({
  id: "weather-agent",
  name: "Weather Agent",
  tools: { weatherTool },
  model: openai("gpt-4o"),
  instructions: "You are a helpful assistant.",
  memory: new Memory({
    storage: new LibSQLStore({
      id: "weather-agent-memory",
      url: "file::memory:",
    }),
    options: {
      workingMemory: {
        enabled: true,
        schema: AgentState,
      },
    },
  }),
});
```

Key patterns:
- Shared state is defined as a Zod schema and passed to Mastra's `Memory` via `workingMemory.schema`
- Tools are created with Mastra's `createTool()` helper
- The agent uses `@ai-sdk/openai` for the model provider

## Tools (src/mastra/tools/index.ts)

```typescript
import { createTool } from "@mastra/core/tools";
import { z } from "zod";

export const weatherTool = createTool({
  id: "get-weather",
  description: "Get current weather for a location",
  inputSchema: z.object({
    location: z.string().describe("City name"),
  }),
  outputSchema: z.object({
    temperature: z.number(),
    feelsLike: z.number(),
    humidity: z.number(),
    windSpeed: z.number(),
    windGust: z.number(),
    conditions: z.string(),
    location: z.string(),
  }),
  execute: async (inputData) => {
    // Call weather API...
    return await getWeather(inputData.location);
  },
});
```

## Mastra Instance (src/mastra/index.ts)

```typescript
import { Mastra } from "@mastra/core/mastra";
import { LibSQLStore } from "@mastra/libsql";
import { weatherAgent } from "./agents";

export const mastra = new Mastra({
  agents: { weatherAgent },
  storage: new LibSQLStore({ id: "mastra-storage", url: ":memory:" }),
});
```

## Next.js Route (src/app/api/copilotkit/route.ts)

```typescript
import {
  CopilotRuntime,
  ExperimentalEmptyAdapter,
  copilotRuntimeNextJSAppRouterEndpoint,
} from "@copilotkit/runtime";
import { MastraAgent } from "@ag-ui/mastra";
import { NextRequest } from "next/server";
import { mastra } from "@/mastra";

export const POST = async (req: NextRequest) => {
  const runtime = new CopilotRuntime({
    // @ts-expect-error - typing issue in current beta
    agents: MastraAgent.getLocalAgents({ mastra }),
  });

  const { handleRequest } = copilotRuntimeNextJSAppRouterEndpoint({
    runtime,
    serviceAdapter: new ExperimentalEmptyAdapter(),
    endpoint: "/api/copilotkit",
  });
  return handleRequest(req);
};
```

Key difference from other integrations: `MastraAgent.getLocalAgents({ mastra })` automatically discovers all agents registered in the Mastra instance. No need to manually specify URLs or create agent instances -- the agents run in-process.

## Running

Mastra uses its own dev server alongside Next.js:

```json
{
  "scripts": {
    "dev": "next dev --turbopack",
    "dev:agent": "mastra dev",
    "dev:ui": "next dev --turbopack"
  }
}
```

Run `pnpm dev` to start the Next.js app (Mastra agents load in-process). Use `pnpm dev:agent` for the standalone Mastra dev server with its own UI.
