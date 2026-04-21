BuiltInAgent Factory Modes — cookbook for TanStack AI, AI SDK, and custom AG-UI factories.

## The AgentFactoryContext

```typescript
// packages/runtime/src/agent/index.ts
export interface AgentFactoryContext {
  input: RunAgentInput; // messages, tools, forwardedProps, context
  abortController: AbortController; // prefer abortSignal
  abortSignal: AbortSignal; // pass to AI SDK / fetch / custom
}
```

Rule of thumb:

- Prefer `abortSignal` for AI SDK, fetch, custom backends.
- Use `abortController` for TanStack AI (its `chat()` takes the controller, not the signal).
- NEVER call `ctx.abortController.abort()` inside the factory — use
  `agent.abortRun()` from outside.

## TanStack AI factory (preferred)

```typescript
import { BuiltInAgent, convertInputToTanStackAI } from "@copilotkit/runtime/v2";
import { chat } from "@tanstack/ai";
import { openaiText } from "@tanstack/ai-openai";

new BuiltInAgent({
  type: "tanstack",
  factory: ({ input, abortController }) => {
    const { messages, systemPrompts } = convertInputToTanStackAI(input);
    systemPrompts.unshift("You are a helpful assistant.");
    return chat({
      adapter: openaiText("gpt-4o"),
      messages,
      systemPrompts,
      tools: [
        /* TanStack AI toolDefinition()s */
      ],
      abortController,
    });
  },
});
```

### TanStack AI + forwardedProps

```typescript
new BuiltInAgent({
  type: "tanstack",
  factory: ({ input, abortController }) => {
    const { messages, systemPrompts } = convertInputToTanStackAI(input);
    const fwd = input.forwardedProps as
      | { model?: string; temperature?: number }
      | undefined;
    return chat({
      adapter: openaiText(fwd?.model ?? "gpt-4o"),
      messages,
      systemPrompts,
      modelOptions: { temperature: fwd?.temperature ?? 0.2 },
      abortController,
    });
  },
});
```

## AI SDK factory (use when reasoning events are required)

```typescript
import {
  BuiltInAgent,
  convertMessagesToVercelAISDKMessages,
  convertToolsToVercelAITools,
} from "@copilotkit/runtime/v2";
import { streamText, stepCountIs } from "ai";
import { openai } from "@ai-sdk/openai";

new BuiltInAgent({
  type: "aisdk",
  factory: ({ input, abortSignal }) => {
    const messages = convertMessagesToVercelAISDKMessages(input.messages, {
      forwardSystemMessages: true,
    });
    const tools = convertToolsToVercelAITools(input.tools);
    return streamText({
      model: openai("gpt-4o"),
      messages,
      tools,
      abortSignal,
      stopWhen: stepCountIs(5),
    });
  },
});
```

The `BuiltInAgentAISDKFactoryConfig` contract requires an object with a `fullStream`
async iterable — this is exactly what `streamText()` returns.

## AI SDK + reasoning (Anthropic thinking)

```typescript
import { anthropic } from "@ai-sdk/anthropic";
import { streamText } from "ai";
import {
  BuiltInAgent,
  convertMessagesToVercelAISDKMessages,
} from "@copilotkit/runtime/v2";

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

TanStack AI silently drops reasoning events — only AI SDK surfaces them.

## Custom factory (raw AG-UI events)

```typescript
import { BuiltInAgent } from "@copilotkit/runtime/v2";
import type { BaseEvent } from "@ag-ui/client";
import { EventType } from "@ag-ui/client";

new BuiltInAgent({
  type: "custom",
  factory: async function* ({ input, abortSignal }): AsyncIterable<BaseEvent> {
    // Check abortSignal.aborted on every iteration — agent.abortRun() signals
    // cancellation via this flag, but the generator must consult it to stop yielding.
    if (abortSignal.aborted) return;

    const messageId = crypto.randomUUID();
    yield {
      type: EventType.TEXT_MESSAGE_START,
      messageId,
      role: "assistant",
    } as any;

    for (const delta of ["Hello", ", ", "world."]) {
      if (abortSignal.aborted) return; // honor cancellation between yields
      yield {
        type: EventType.TEXT_MESSAGE_CONTENT,
        messageId,
        delta,
      } as any;
    }

    yield { type: EventType.TEXT_MESSAGE_END, messageId } as any;
  },
});
```

A custom factory that never checks `abortSignal.aborted` (or registers an
`addEventListener("abort", …)` handler to break its loop) is non-cancellable —
`agent.abortRun()` will flip the flag but the generator will keep yielding until it
exhausts its own source. Pass `abortSignal` through to any underlying `fetch` /
streaming API as well so the upstream request is torn down.

## Manual state-tool wiring (Factory Mode only)

Simple Mode auto-injects `AGUISendStateSnapshot` / `AGUISendStateDelta`. In Factory Mode
you must register them by hand for shared-state updates to reach the LLM. The AI SDK
factory works out of the box because `defineTool` output adapts through
`convertToolDefinitionsToVercelAITools`:

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
          path: z.string(),
          value: z.any().optional(),
        }),
      )
      .describe("Array of JSON Patch operations"),
  }),
  execute: async ({ delta }) => ({ success: true, delta }),
});

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

For TanStack AI factories, `defineTool` output is NOT a TanStack tool — passing it to
`chat({ tools })` does not work. Either switch to the AI SDK factory above, or redefine
the tools with `toolDefinition()` from `@tanstack/ai`.

Source: `packages/runtime/src/agent/index.ts`,
`docs/content/docs/integrations/built-in-agent/custom-agent.mdx`.
