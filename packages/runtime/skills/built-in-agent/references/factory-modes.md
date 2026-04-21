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
import { streamText } from "ai";
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
      stopWhen: ({ steps }) => steps.length >= 5,
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
    const messageId = crypto.randomUUID();
    yield {
      type: EventType.TEXT_MESSAGE_START,
      messageId,
      role: "assistant",
    } as any;
    yield {
      type: EventType.TEXT_MESSAGE_CONTENT,
      messageId,
      delta: "Hello.",
    } as any;
    yield { type: EventType.TEXT_MESSAGE_END, messageId } as any;
  },
});
```

## Manual state-tool wiring (Factory Mode only)

Simple Mode auto-injects `AGUISendStateSnapshot` / `AGUISendStateDelta`. In Factory Mode
you must register them by hand for shared-state updates to reach the LLM:

```typescript
import {
  defineTool,
  BuiltInAgent,
  convertInputToTanStackAI,
} from "@copilotkit/runtime/v2";
import { chat } from "@tanstack/ai";
import { openaiText } from "@tanstack/ai-openai";
import { z } from "zod";

const sendStateSnapshot = defineTool({
  name: "AGUISendStateSnapshot",
  description: "Send a full state snapshot to the frontend.",
  parameters: z.object({ snapshot: z.any() }),
  execute: async ({ snapshot }) => ({ success: true, snapshot }),
});
const sendStateDelta = defineTool({
  name: "AGUISendStateDelta",
  description: "Send a state delta to the frontend.",
  parameters: z.object({ delta: z.any() }),
  execute: async ({ delta }) => ({ success: true, delta }),
});

new BuiltInAgent({
  type: "tanstack",
  factory: ({ input, abortController }) => {
    const { messages, systemPrompts } = convertInputToTanStackAI(input);
    return chat({
      adapter: openaiText("gpt-4o"),
      messages,
      systemPrompts,
      tools: [sendStateSnapshot, sendStateDelta],
      abortController,
    });
  },
});
```

Source: `packages/runtime/src/agent/index.ts`,
`docs/content/docs/integrations/built-in-agent/custom-agent.mdx`.
