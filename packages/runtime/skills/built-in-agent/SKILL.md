---
name: built-in-agent
description: >
  Instantiate the in-tree BuiltInAgent in Factory Mode (preferred default, AG-UI-compliant)
  with TanStack AI, Vercel AI SDK, or a custom AG-UI event generator — or in Simple Mode
  (classic config) for quickstart-only. Covers AgentFactoryContext { input, abortController,
  abortSignal }, the converter helpers (convertInputToTanStackAI,
  convertMessagesToVercelAISDKMessages, convertToolsToVercelAITools,
  convertToolDefinitionsToVercelAITools, resolveModel), tool-loop semantics via maxSteps (default 1),
  the TanStack AI reasoning-event caveat (reasoning events are silently dropped — use AI SDK
  if reasoning UI is required), forwardSystemMessages / forwardDeveloperMessages defaults
  (false), and manual AGUISendStateSnapshot / AGUISendStateDelta wiring in Factory Mode.
type: core
library: copilotkit
library_version: "1.56.2"
requires:
  - copilotkit/setup-endpoint
sources:
  - "CopilotKit/CopilotKit:packages/runtime/src/agent/index.ts"
  - "CopilotKit/CopilotKit:packages/runtime/src/agent/converters/tanstack.ts"
  - "CopilotKit/CopilotKit:docs/content/docs/integrations/built-in-agent/custom-agent.mdx"
  - "CopilotKit/CopilotKit:docs/content/docs/integrations/built-in-agent/advanced-configuration.mdx"
  - "CopilotKit/CopilotKit:docs/content/docs/integrations/built-in-agent/model-selection.mdx"
  - "CopilotKit/CopilotKit:examples/v2/react-router/app/routes/api.copilotkit.$.tsx"
---

# CopilotKit BuiltInAgent

`BuiltInAgent` has two modes:

- **Factory Mode** (preferred default) — you own the LLM call, BuiltInAgent owns the AG-UI
  lifecycle. TanStack AI factory is AG-UI-native and the canonical preferred choice. AI SDK
  and custom (raw AG-UI event) factories are also supported.
- **Simple Mode** (classic config) — `{ model, apiKey, prompt, tools, mcpServers, maxSteps, ... }`.
  Convenient for quickstarts. Simple Mode auto-injects the `AGUISendStateSnapshot` /
  `AGUISendStateDelta` state tools; Factory Mode does not.

Use Factory Mode with TanStack AI for new code.

## Setup

Factory Mode with TanStack AI (preferred default):

```typescript
import {
  CopilotRuntime,
  createCopilotRuntimeHandler,
  BuiltInAgent,
  convertInputToTanStackAI,
} from "@copilotkit/runtime/v2";
import { chat } from "@tanstack/ai";
import { openaiText } from "@tanstack/ai-openai";

const agent = new BuiltInAgent({
  type: "tanstack",
  factory: ({ input, abortController }) => {
    const { messages, systemPrompts } = convertInputToTanStackAI(input);
    systemPrompts.unshift("You are a helpful assistant.");
    return chat({
      adapter: openaiText("gpt-4o"),
      messages,
      systemPrompts,
      abortController,
    });
  },
});

const runtime = new CopilotRuntime({ agents: { default: agent } });

const handler = createCopilotRuntimeHandler({
  runtime,
  basePath: "/api/copilotkit",
});

export default { fetch: handler };
```

Simple Mode (quickstart only):

```typescript
import {
  BuiltInAgent,
  CopilotRuntime,
  createCopilotRuntimeHandler,
} from "@copilotkit/runtime/v2";

const agent = new BuiltInAgent({
  model: "openai/gpt-4o",
  apiKey: process.env.OPENAI_API_KEY,
  prompt: "You are a helpful assistant.",
  maxSteps: 5, // enable the tool-call loop
});

const runtime = new CopilotRuntime({ agents: { default: agent } });
const handler = createCopilotRuntimeHandler({
  runtime,
  basePath: "/api/copilotkit",
});
export default { fetch: handler };
```

## Core Patterns

### Factory Mode with AI SDK (needed for reasoning events)

```typescript
import {
  BuiltInAgent,
  convertMessagesToVercelAISDKMessages,
  convertToolsToVercelAITools,
} from "@copilotkit/runtime/v2";
import { streamText, stepCountIs } from "ai";
import { anthropic } from "@ai-sdk/anthropic";

const agent = new BuiltInAgent({
  type: "aisdk",
  factory: ({ input, abortSignal }) => {
    const messages = convertMessagesToVercelAISDKMessages(input.messages);
    const tools = convertToolsToVercelAITools(input.tools);
    return streamText({
      model: anthropic("claude-sonnet-4"),
      messages,
      tools,
      abortSignal,
      stopWhen: stepCountIs(5),
    });
  },
});
```

### Per-request agent via a factory function on CopilotRuntime

```typescript
import {
  CopilotRuntime,
  BuiltInAgent,
  convertInputToTanStackAI,
} from "@copilotkit/runtime/v2";
import { chat } from "@tanstack/ai";
import { openaiText } from "@tanstack/ai-openai";

const runtime = new CopilotRuntime({
  agents: ({ request }) => {
    const tenantId = request.headers.get("x-tenant-id") ?? "default";
    return {
      default: new BuiltInAgent({
        type: "tanstack",
        factory: ({ input, abortController }) => {
          const { messages, systemPrompts } = convertInputToTanStackAI(input);
          systemPrompts.unshift(`You are the ${tenantId} assistant.`);
          return chat({
            adapter: openaiText("gpt-4o"),
            messages,
            systemPrompts,
            abortController,
          });
        },
      }),
    };
  },
});
```

### Simple Mode — MCP servers

```typescript
new BuiltInAgent({
  model: "openai/gpt-4o",
  maxSteps: 5,
  mcpServers: [
    { type: "http", url: "https://mcp.example.com/mcp" },
    {
      type: "sse",
      url: "https://mcp.example.com/sse",
      headers: { Authorization: `Bearer ${process.env.MCP_TOKEN}` },
    },
  ],
});
```

### Model specifier format

`"provider/model"` or `"provider:model"`. Supported providers: `openai`, `anthropic`,
`google` (aliases `gemini`, `google-gemini`), `vertex`. The bare model id (`"gpt-4o"`) is
rejected.

```typescript
new BuiltInAgent({ model: "openai/gpt-4o" });
new BuiltInAgent({ model: "anthropic/claude-sonnet-4.5" });
new BuiltInAgent({ model: "google/gemini-2.5-pro" });
```

## Common Mistakes

### HIGH Defaulting to Simple Mode when Factory Mode (TanStack AI) is preferred

Wrong:

```typescript
const agent = new BuiltInAgent({
  model: "openai/gpt-4o",
  prompt: "You are a helpful assistant.",
});
```

Correct:

```typescript
import { BuiltInAgent, convertInputToTanStackAI } from "@copilotkit/runtime/v2";
import { chat } from "@tanstack/ai";
import { openaiText } from "@tanstack/ai-openai";

const agent = new BuiltInAgent({
  type: "tanstack",
  factory: ({ input, abortController }) => {
    const { messages, systemPrompts } = convertInputToTanStackAI(input);
    systemPrompts.unshift("You are a helpful assistant.");
    return chat({
      adapter: openaiText("gpt-4o"),
      messages,
      systemPrompts,
      abortController,
    });
  },
});
```

Factory Mode with TanStack AI is the canonical in-tree default (see
`examples/v2/react-router/app/routes/api.copilotkit.$.tsx`) and is AG-UI-native. Simple
Mode is fine for quickstarts but reaches its ceiling on anything non-standard.

Source: `examples/v2/react-router/app/routes/api.copilotkit.$.tsx`; maintainer Phase 4c.

### HIGH Expecting tool-call loop without raising maxSteps

Wrong:

```typescript
new BuiltInAgent({
  model: "openai/gpt-4o",
  tools: [searchTool],
  // maxSteps defaults to undefined → AI SDK stops after one generation; tool results
  // are never fed back. Set maxSteps: N to enable the tool-call loop.
});
```

Correct:

```typescript
new BuiltInAgent({
  model: "openai/gpt-4o",
  tools: [searchTool],
  maxSteps: 5,
});
```

`maxSteps` defaults to `undefined`, so `stopWhen` is `undefined` and the AI SDK's own
default applies — `streamText` stops after a single generation, the tool call happens,
but results are never fed back for a second turn. Set `maxSteps: N` to install
`stepCountIs(N)` and enable the tool-call loop up to N steps.

Source: `packages/runtime/src/agent/index.ts:988-990`.

### HIGH Wrong model specifier format

Wrong:

```typescript
new BuiltInAgent({ model: "gpt-4o" });
```

Correct:

```typescript
new BuiltInAgent({ model: "openai/gpt-4o" });
// Also valid: "openai:gpt-4o"
```

`resolveModel` throws `Invalid model string "gpt-4o". Use "openai/gpt-5",
"anthropic/claude-sonnet-4.5", or "google/gemini-2.5-pro".` when the provider separator
is missing.

Source: `packages/runtime/src/agent/index.ts:186-204`.

### HIGH Concurrent run() on the same BuiltInAgent instance

Wrong:

```typescript
// One shared instance across tenants
const agent = new BuiltInAgent({ model: "openai/gpt-4o" });
new CopilotRuntime({ agents: { default: agent } });
```

Correct:

```typescript
// Use the agents-as-factory form for per-request instances
new CopilotRuntime({
  agents: ({ request }) => ({
    default: new BuiltInAgent({ model: "openai/gpt-4o" }),
  }),
});
```

A single `BuiltInAgent` instance guards against concurrent `run()` with
`"Agent is already running. Call abortRun() first or create a new instance."` Multi-tenant
servers that share one instance see errors on the second concurrent user.

Source: `packages/runtime/src/agent/index.ts:895-898`.

### HIGH Expecting state tools to auto-inject in Factory Mode

Wrong:

```typescript
new BuiltInAgent({
  type: "tanstack",
  factory: ({ input, abortController }) => {
    const { messages, systemPrompts } = convertInputToTanStackAI(input);
    return chat({
      adapter: openaiText("gpt-4o"),
      messages,
      systemPrompts,
      abortController,
    });
  },
});
// Frontend uses useAgent + shared state — but no state-tool calls come back
```

Correct (AI SDK factory — `defineTool` output converts via
`convertToolDefinitionsToVercelAITools`):

```typescript
import {
  BuiltInAgent,
  convertMessagesToVercelAISDKMessages,
  convertToolDefinitionsToVercelAITools,
  defineTool,
} from "@copilotkit/runtime/v2";
import { streamText } from "ai";
import { openai } from "@ai-sdk/openai";
import { z } from "zod";

const sendStateSnapshot = defineTool({
  name: "AGUISendStateSnapshot",
  description: "Replace the entire application state with a new snapshot",
  parameters: z.object({
    snapshot: z.any().describe("The complete new state object"),
  }),
  execute: async ({ snapshot }) => ({ success: true, snapshot }),
});
const sendStateDelta = defineTool({
  name: "AGUISendStateDelta",
  description:
    "Apply incremental updates to application state using JSON Patch operations",
  // MUST mirror the Simple-Mode auto-injected schema (src/agent/index.ts:1140-1176)
  // or the frontend's state handler won't recognize the payload.
  parameters: z.object({
    delta: z
      .array(
        z.object({
          op: z.enum(["add", "replace", "remove"]),
          path: z.string(), // JSON Pointer, e.g. "/foo/bar"
          value: z.any().optional(), // required for add/replace, ignored for remove
        }),
      )
      .describe("Array of JSON Patch operations"),
  }),
  execute: async ({ delta }) => ({ success: true, delta }),
});
// If you don't want to hand-wire this, use Simple Mode — it auto-injects both
// AGUISendStateSnapshot and AGUISendStateDelta with the correct JSON Patch schema.
// Source: packages/runtime/src/agent/index.ts:1140-1176

new BuiltInAgent({
  type: "aisdk",
  factory: ({ input, abortSignal }) =>
    streamText({
      model: openai("gpt-4o"),
      messages: convertMessagesToVercelAISDKMessages(input.messages),
      tools: convertToolDefinitionsToVercelAITools([
        sendStateSnapshot,
        sendStateDelta,
      ]),
      abortSignal,
    }),
});
```

Only Simple Mode auto-injects the AG-UI state tools. In Factory Mode you must register
them by hand or shared-state updates never reach the LLM. `defineTool` produces a Standard
Schema V1 + `execute` shape — use `convertToolDefinitionsToVercelAITools([...])` to adapt
it to the AI SDK's `streamText({ tools })`. TanStack AI factories cannot consume
`defineTool` output directly; either redefine the tools with `toolDefinition()` from
`@tanstack/ai`, or switch to the AI SDK factory above.

Source: `docs/snippets/shared/backend/custom-agent.mdx:495-588`.

### MEDIUM Mixing Simple Mode tools with Factory Mode

Wrong:

```typescript
new BuiltInAgent({
  type: "tanstack",
  factory: myFactory,
  tools: [t1, t2], // ignored in Factory Mode
});
```

Correct:

```typescript
new BuiltInAgent({
  type: "tanstack",
  factory: ({ input, abortController }) => {
    const { messages, systemPrompts } = convertInputToTanStackAI(input);
    return chat({
      adapter: openaiText("gpt-4o"),
      messages,
      systemPrompts,
      tools: [t1, t2],
      abortController,
    });
  },
});
```

Factory Mode ignores `config.tools`, `config.mcpServers`, `config.prompt` entirely — the
factory owns the call. Wire tools inside `chat({ tools })` for TanStack AI, or via
`convertToolsToVercelAITools(input.tools)` / `convertToolDefinitionsToVercelAITools([...])`
for AI SDK.

Source: `packages/runtime/src/agent/index.ts:1581-1671`.

### HIGH Expecting reasoning events from TanStack AI

Wrong:

```typescript
new BuiltInAgent({
  type: "tanstack",
  factory: ({ input, abortController }) => {
    const { messages, systemPrompts } = convertInputToTanStackAI(input);
    return chat({
      adapter: anthropicText("claude-sonnet-4"),
      messages,
      systemPrompts,
      modelOptions: { thinking: { type: "enabled", budgetTokens: 10000 } },
      abortController,
    });
  },
});
// expecting REASONING_START / REASONING_MESSAGE_CONTENT / REASONING_END — nothing arrives
```

Correct:

```typescript
import {
  BuiltInAgent,
  convertMessagesToVercelAISDKMessages,
} from "@copilotkit/runtime/v2";
import { streamText } from "ai";
import { anthropic } from "@ai-sdk/anthropic";

new BuiltInAgent({
  type: "aisdk",
  factory: ({ input, abortSignal }) =>
    streamText({
      model: anthropic("claude-sonnet-4"),
      messages: convertMessagesToVercelAISDKMessages(input.messages),
      providerOptions: {
        anthropic: { thinking: { type: "enabled", budgetTokens: 10000 } },
      },
      abortSignal,
    }),
});
```

The TanStack AI converter does NOT surface `REASONING_START` /
`REASONING_MESSAGE_CONTENT` / `REASONING_END` events — even with a thinking-capable model.
Use AI SDK when the frontend needs a reasoning UI.

Source: `docs/snippets/shared/backend/custom-agent.mdx:315-317` (warn callout).

### MEDIUM Expecting forwarded system messages

Wrong:

```typescript
// Client sends { role: "system", content: "You are..." } and expects it prefixed
new BuiltInAgent({ model: "openai/gpt-4o" });
```

Correct:

```typescript
// Either set the server-side prompt
new BuiltInAgent({ model: "openai/gpt-4o", prompt: "You are..." });
// or opt in explicitly
new BuiltInAgent({ model: "openai/gpt-4o", forwardSystemMessages: true });
```

`forwardSystemMessages` and `forwardDeveloperMessages` default to `false`. System/developer
messages from the AG-UI input are dropped unless opted in.

Source: `packages/runtime/src/agent/index.ts:440-456,809-815`.

### MEDIUM Aborting factory's abortController directly

Wrong:

```typescript
factory: (ctx) => {
  ctx.abortController.abort(); // JSDoc says don't
  return streamText({
    /* ... */
  });
};
```

Correct:

```typescript
factory: (ctx) => streamText({ /* ... */, abortSignal: ctx.abortSignal });
// Externally, from outside the factory:
agent.abortRun();
```

The JSDoc on `AgentFactoryContext.abortController` explicitly warns against calling
`.abort()` on it inside the factory — use `agent.abortRun()` or pass `abortSignal` to the
downstream fetch/LLM call.

Source: `packages/runtime/src/agent/index.ts:670-672`.

## References

- [Model identifiers — supported strings](references/model-identifiers.md)
- [Factory modes — TanStack AI / AI SDK / custom cookbook](references/factory-modes.md)
- [Helper utilities — converter function signatures](references/helper-utilities.md)

## See also

- `copilotkit/server-side-tools` — `defineTool` powers `config.tools` in Simple Mode
- `copilotkit/setup-endpoint` — mount the runtime that hosts this agent
- `copilotkit/wiring-external-agents` — alternative when you want an external framework
