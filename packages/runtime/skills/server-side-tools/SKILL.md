---
name: server-side-tools
description: >
  Define server-side tools for BuiltInAgent via defineTool({ name, description, parameters,
  execute }) and register them on BuiltInAgent config.tools (Simple Mode) or inside a
  Factory Mode factory. parameters must be a Standard Schema V1 validator (Zod, Valibot,
  ArkType, ...) — plain JSON Schema objects throw. Covers the server-vs-client tradeoff
  (server tools for I/O and secrets, client tools for UI and browser APIs), the reserved
  AG-UI tool names (AGUISendStateSnapshot, AGUISendStateDelta), graceful error handling in
  execute, and merge order when a frontend tool and a server tool share a name (server wins).
type: core
library: copilotkit
library_version: "1.56.2"
requires:
  - copilotkit/built-in-agent
sources:
  - "CopilotKit/CopilotKit:packages/runtime/src/agent/index.ts"
  - "CopilotKit/CopilotKit:docs/content/docs/integrations/built-in-agent/server-tools.mdx"
---

# CopilotKit Server-Side Tools

Server-side tools run in the runtime process. They are the right choice when the tool needs
to touch server-only state: DB connections, API keys, filesystem, signed URLs.

`defineTool` returns a `ToolDefinition`. Pass an array of them to the Simple-Mode
`BuiltInAgent.config.tools`, or into the `tools:` option of `chat()` / `streamText()` inside
a Factory Mode factory.

## Setup

```typescript
import {
  CopilotRuntime,
  createCopilotRuntimeHandler,
  BuiltInAgent,
  defineTool,
} from "@copilotkit/runtime/v2";
import { z } from "zod";

const getInventory = defineTool({
  name: "getInventory",
  description: "Look up stock for a product SKU.",
  parameters: z.object({ sku: z.string() }),
  execute: async ({ sku }) => {
    const row = await db.product.findUnique({ where: { sku } });
    return { sku, inStock: row?.inStock ?? 0 };
  },
});

const runtime = new CopilotRuntime({
  agents: {
    default: new BuiltInAgent({
      model: "openai/gpt-4o",
      maxSteps: 5,
      tools: [getInventory],
    }),
  },
});

const handler = createCopilotRuntimeHandler({
  runtime,
  basePath: "/api/copilotkit",
});

export default { fetch: handler };

declare const db: {
  product: { findUnique: (q: any) => Promise<{ inStock: number } | null> };
};
```

## Core Patterns

### Zod parameters (most common)

```typescript
import { defineTool } from "@copilotkit/runtime/v2";
import { z } from "zod";

const searchDocs = defineTool({
  name: "searchDocs",
  description: "Search the internal docs index.",
  parameters: z.object({
    query: z.string().min(1),
    limit: z.number().int().min(1).max(20).default(5),
  }),
  execute: async ({ query, limit }) => {
    const results = await searchIndex(query, limit);
    return { results };
  },
});

declare const searchIndex: (q: string, n: number) => Promise<unknown[]>;
```

### Valibot parameters (Standard Schema V1)

```typescript
import { defineTool } from "@copilotkit/runtime/v2";
import * as v from "valibot";

const translate = defineTool({
  name: "translate",
  description: "Translate text between languages.",
  parameters: v.object({
    text: v.pipe(v.string(), v.minLength(1)),
    target: v.picklist(["en", "es", "fr", "de"]),
  }),
  execute: async ({ text, target }) => ({ translated: `[${target}] ${text}` }),
});
```

### Graceful error handling inside execute

```typescript
import { defineTool } from "@copilotkit/runtime/v2";
import { z } from "zod";

const runQuery = defineTool({
  name: "runQuery",
  description: "Run an analytics query.",
  parameters: z.object({ sql: z.string() }),
  execute: async ({ sql }) => {
    try {
      return { rows: await warehouse.query(sql) };
    } catch (e) {
      return { error: String(e), retryable: true };
    }
  },
});

declare const warehouse: { query: (sql: string) => Promise<unknown[]> };
```

### Server tool + client tool side by side

Server tools for I/O, client tools for UI. Both can coexist.

```typescript
// server
import { defineTool } from "@copilotkit/runtime/v2";
import { z } from "zod";

export const fetchOrder = defineTool({
  name: "fetchOrder",
  description: "Fetch order details from the orders service.",
  parameters: z.object({ orderId: z.string() }),
  execute: async ({ orderId }) => fetchOrderFromService(orderId),
});
declare const fetchOrderFromService: (id: string) => Promise<unknown>;
```

```tsx
// client — a render-only tool lets the LLM display a modal
import { useComponent } from "@copilotkit/react-core/v2";
import { z } from "zod";

useComponent({
  name: "showOrderDetails",
  parameters: z.object({ orderId: z.string(), status: z.string() }),
  render: ({ args }) => (
    <div className="modal">
      Order {args.orderId} — {args.status}
    </div>
  ),
});
```

### Factory Mode — pass tools into the factory

Simple-Mode `config.tools` is ignored in Factory Mode.

```typescript
import {
  BuiltInAgent,
  convertToolDefinitionsToVercelAITools,
  convertMessagesToVercelAISDKMessages,
  defineTool,
} from "@copilotkit/runtime/v2";
import { streamText } from "ai";
import { openai } from "@ai-sdk/openai";
import { z } from "zod";

const searchDocs = defineTool({
  name: "searchDocs",
  description: "Search the internal docs index.",
  parameters: z.object({ query: z.string() }),
  execute: async ({ query }) => ({ results: [] }),
});

new BuiltInAgent({
  type: "aisdk",
  factory: ({ input, abortSignal }) => {
    const serverTools = convertToolDefinitionsToVercelAITools([searchDocs]);
    return streamText({
      model: openai("gpt-4o"),
      messages: convertMessagesToVercelAISDKMessages(input.messages),
      tools: serverTools,
      abortSignal,
    });
  },
});
```

## Common Mistakes

### HIGH Using defineTool for tools that should render UI

Wrong:

```typescript
defineTool({
  name: "showModal",
  description: "Show a confirmation modal to the user.",
  parameters: z.object({ title: z.string() }),
  execute: async () => "rendered",
});
```

Correct:

```tsx
// Keep UI on the client — frontend tool with a renderer
import { useFrontendTool } from "@copilotkit/react-core/v2";
import { z } from "zod";

useFrontendTool({
  name: "showModal",
  parameters: z.object({ title: z.string() }),
  handler: async (args) => ({ confirmed: true }),
});
```

Server tools execute on the server and stream only results back. The browser never sees a
`TOOL_CALL_START` for a server tool, so there is nothing to mount a renderer against.

Source: `dev-docs/architecture/plugin-points.md:36-77`;
`docs/content/docs/integrations/built-in-agent/server-tools.mdx:9-14`.

### MEDIUM Redefining AG-UI reserved names

Wrong:

```typescript
defineTool({
  name: "AGUISendStateSnapshot",
  description: "My own snapshot tool.",
  parameters: z.object({ snapshot: z.any() }),
  execute: async () => ({ success: true }),
});
```

Correct:

```typescript
defineTool({
  name: "mySnapshotExport",
  description: "Export a user-facing state snapshot.",
  parameters: z.object({ snapshot: z.any() }),
  execute: async () => ({ success: true }),
});
```

`AGUISendStateSnapshot` and `AGUISendStateDelta` are auto-injected by BuiltInAgent in
Simple Mode — redefining them silently overwrites the built-ins.

Source: `packages/runtime/src/agent/index.ts:1139-1177`.

### MEDIUM Throwing from execute without a result

Wrong:

```typescript
defineTool({
  name: "runQuery",
  description: "Run a database query.",
  parameters: z.object({ sql: z.string() }),
  execute: async () => {
    throw new Error("db down");
  },
});
```

Correct:

```typescript
defineTool({
  name: "runQuery",
  description: "Run a database query.",
  parameters: z.object({ sql: z.string() }),
  execute: async ({ sql }) => {
    try {
      return await db.query(sql);
    } catch (e) {
      return { error: String(e), retryable: true };
    }
  },
});
```

Thrown errors kill the run; unserializable results (class instances, circular refs) become
the string `"[Unserializable tool result from X]"`. Return a plain-object error shape
instead and let the LLM retry.

Source: `packages/runtime/src/agent/index.ts:1469-1474`.

### MEDIUM Passing a JSON-schema object as parameters

Wrong:

```typescript
defineTool({
  name: "x",
  description: "...",
  parameters: {
    type: "object",
    properties: { q: { type: "string" } },
    required: ["q"],
  } as any,
  execute: async ({ q }) => q,
});
```

Correct:

```typescript
import { z } from "zod";

defineTool({
  name: "x",
  description: "...",
  parameters: z.object({ q: z.string() }),
  execute: async ({ q }) => q,
});
```

`parameters` must be a Standard Schema V1 validator (Zod, Valibot, ArkType, ...). Plain
JSON Schema throws in `schemaToJsonSchema()`. Also, Standard Schema V1 preserves static
types — `execute`'s arg type is inferred.

Source: `packages/runtime/src/agent/index.ts:633-659`.

### HIGH Unavailable in Factory Mode via config.tools

Wrong:

```typescript
new BuiltInAgent({
  type: "tanstack",
  factory: myFactory,
  tools: [searchDocs], // ignored in Factory Mode
} as any);
```

Correct:

```typescript
// Factory Mode — AI SDK factory: convert defineTool → Vercel AI SDK tools
import {
  BuiltInAgent,
  convertToolDefinitionsToVercelAITools,
  convertMessagesToVercelAISDKMessages,
} from "@copilotkit/runtime/v2";
import { streamText } from "ai";
import { openai } from "@ai-sdk/openai";

new BuiltInAgent({
  type: "aisdk",
  factory: ({ input, abortSignal }) => {
    const tools = convertToolDefinitionsToVercelAITools([searchDocs]);
    return streamText({
      model: openai("gpt-4o"),
      messages: convertMessagesToVercelAISDKMessages(input.messages),
      tools,
      abortSignal,
    });
  },
});

// Factory Mode — TanStack AI factory: defineTool output is NOT a TanStack tool.
// There is no built-in converter in @copilotkit/runtime for TanStack. Either
// redefine the tool with TanStack's `toolDefinition()` API from `@tanstack/ai`,
// or write a small adapter that translates your `defineTool` output into
// TanStack's tool shape before passing it into `chat({ tools })`.
```

Factory Mode ignores `config.tools`. Wire server tools through the factory's LLM call —
AI SDK has `convertToolDefinitionsToVercelAITools([...])` out of the box; TanStack AI has
its own `toolDefinition()` API you need to build the tools with directly.

Source: `packages/runtime/src/agent/index.ts:1581-1671`.

### MEDIUM Shared name between client and server tool

Wrong:

```tsx
// frontend
useFrontendTool({
  name: "getWeather",
  parameters: z.object({ city: z.string() }),
  handler,
});

// server
defineTool({
  name: "getWeather",
  parameters: z.object({ city: z.string() }),
  execute,
});
// Server silently wins on the merge — handler never fires
```

Correct:

```tsx
// Pick one side and give tools distinct names if both sides need their own
useFrontendTool({ name: "getWeatherClientSide" /* ... */ });
defineTool({ name: "getWeatherServer" /* ... */ });
```

On collisions, `config.tools` (server) overwrites frontend-registered tools. The LLM sees
only one `getWeather` — the server version.

Source: `packages/runtime/src/agent/index.ts` (tool merge).

## See also

- `copilotkit/built-in-agent` — `config.tools` only applies in Simple Mode
- `copilotkit/client-side-tools` (react-core) — browser-side tools, paired decision
- `copilotkit/rendering-tool-calls` (react-core) — rendering tool invocations in chat
