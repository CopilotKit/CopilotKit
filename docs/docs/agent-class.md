# Agent Class

## Introduction

`Agent` is a universal Agent class that lets you bring any AI SDK backend to CopilotKit. Instead of being locked into a specific LLM framework, you provide a factory function that makes the LLM call however you want, and CopilotKit converts the resulting stream into AG-UI events.

### Why Agent exists

`BuiltInAgent` is tightly coupled to Vercel AI SDK v6. It handles model resolution, message conversion, tool injection, MCP clients, and system prompt construction automatically -- which is great for quick setup, but leaves you with no escape hatch when you need a different LLM backend or full control over the call.

`Agent` inverts control: **you own the LLM call**. CopilotKit only handles stream conversion and lifecycle events (`RUN_STARTED`, `RUN_FINISHED`, `RUN_ERROR`).

### Key benefits

- Works with **AI SDK** (Vercel), **TanStack AI**, or **any custom framework**
- Full control over model selection, message formatting, tool wiring, and system prompts
- Same `AbstractAgent` interface -- plugs into `CopilotRuntime` identically to `BuiltInAgent`
- Lifecycle events are managed automatically so you never emit them yourself

## When to use Agent vs BuiltInAgent

| Use Case | Recommended |
|---|---|
| Quick setup with Vercel AI SDK defaults | `BuiltInAgent` |
| Full control over the LLM call | `Agent` |
| TanStack AI backend | `Agent` |
| Custom or proprietary LLM backend | `Agent` |
| Need MCP, state tools, model resolution built-in | `BuiltInAgent` |
| Want to choose model/provider per-request | `Agent` |
| Minimal configuration, maximum convenience | `BuiltInAgent` |

## Quick Start

### AI SDK

```ts
import { Agent, convertMessagesToVercelAISDKMessages } from "@copilotkit/runtime/v2";
import { streamText } from "ai";
import { openai } from "@ai-sdk/openai";

const agent = new Agent({
  type: "aisdk",
  factory: ({ input, abortSignal }) =>
    streamText({
      model: openai("gpt-4o"),
      messages: convertMessagesToVercelAISDKMessages(input.messages),
      abortSignal,
    }),
});
```

### TanStack AI

```ts
import { Agent } from "@copilotkit/runtime/v2";
import { chat } from "@tanstack/ai";
import { openaiText } from "@tanstack/ai-openai";

const agent = new Agent({
  type: "tanstack",
  factory: ({ input, abortController }) => {
    const messages = input.messages
      .filter((m) => m.role !== "developer" && m.role !== "system")
      .map((m) => ({ role: m.role, content: m.content ?? "" }));
    const systemPrompts = input.messages
      .filter((m) => m.role === "system" || m.role === "developer")
      .map((m) => m.content ?? "");
    return chat({ adapter: openaiText("gpt-4o"), messages, systemPrompts, abortController });
  },
});
```

### Custom

```ts
import { Agent } from "@copilotkit/runtime/v2";
import { EventType, type BaseEvent } from "@ag-ui/core";

const agent = new Agent({
  type: "custom",
  factory: async function* ({ input, abortSignal }) {
    const response = await fetch("https://my-llm-api.com/chat", {
      method: "POST",
      body: JSON.stringify({ messages: input.messages }),
      signal: abortSignal,
    });
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    const messageId = crypto.randomUUID();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      yield {
        type: EventType.TEXT_MESSAGE_CHUNK,
        role: "assistant",
        messageId,
        delta: decoder.decode(value),
      } as BaseEvent;
    }
  },
});
```

## API Reference

### AgentConfig

`AgentConfig` is a discriminated union based on the `type` field:

```ts
type AgentConfig =
  | AISDKAgentConfig
  | TanStackAgentConfig
  | CustomAgentConfig;
```

#### AISDKAgentConfig

```ts
interface AISDKAgentConfig {
  type: "aisdk";
  factory: (ctx: AgentFactoryContext) => StreamTextResult;
}
```

The factory returns the result of `streamText()` from the Vercel AI SDK. The converter accesses `factoryResult.fullStream` to iterate over AI SDK events and maps them to AG-UI events.

#### TanStackAgentConfig

```ts
interface TanStackAgentConfig {
  type: "tanstack";
  factory: (ctx: AgentFactoryContext) => AsyncIterable<StreamChunk>;
}
```

The factory returns an `AsyncIterable<StreamChunk>` -- this is what TanStack AI's `chat()` returns. The converter maps TanStack stream chunks to AG-UI events.

#### CustomAgentConfig

```ts
interface CustomAgentConfig {
  type: "custom";
  factory: (ctx: AgentFactoryContext) => AsyncIterable<BaseEvent>;
}
```

The factory returns an `AsyncIterable<BaseEvent>`. Events are forwarded directly with no conversion. You are responsible for emitting the correct AG-UI event types.

### AgentFactoryContext

Every factory function receives the same context object:

```ts
interface AgentFactoryContext {
  input: RunAgentInput;
  abortController: AbortController;
  abortSignal: AbortSignal; // Convenience alias for abortController.signal
}
```

`RunAgentInput` contains everything CopilotKit knows about the current request:

- `input.messages` -- the conversation messages
- `input.tools` -- frontend-registered tools
- `input.state` -- application state from `useCoAgent`
- `input.context` -- context items from `useCopilotReadable`
- `input.threadId` -- the conversation thread ID
- `input.runId` -- the current run ID
- `input.forwardedProps` -- arbitrary props forwarded from the frontend

### Factory return types

The factory function can be synchronous or async (returning a `Promise`). Each backend type expects a specific return shape:

| Backend | Return Type |
|---|---|
| `aisdk` | `StreamTextResult` (from `streamText()`) |
| `tanstack` | `AsyncIterable<StreamChunk>` (from `chat()`) |
| `custom` | `AsyncIterable<BaseEvent>` (async generator or manual iterable) |

### What Agent handles automatically

- `RUN_STARTED` event (emitted before the factory is called)
- `RUN_FINISHED` event (emitted after the stream completes)
- `RUN_ERROR` event (emitted if the factory or stream throws)
- Abort/cancellation wiring
- Stream-to-AG-UI conversion per backend type

### What Agent does NOT handle (your responsibility)

- Model resolution and provider setup
- Message format conversion
- Tool conversion and merging
- MCP client management
- System prompt construction
- State tool injection (`AGUISendStateSnapshot` / `AGUISendStateDelta`)

## AI SDK Examples

### Basic text generation

```ts
import { Agent, convertMessagesToVercelAISDKMessages } from "@copilotkit/runtime/v2";
import { streamText } from "ai";
import { openai } from "@ai-sdk/openai";

const agent = new Agent({
  type: "aisdk",
  factory: ({ input, abortSignal }) =>
    streamText({
      model: openai("gpt-4o"),
      messages: convertMessagesToVercelAISDKMessages(input.messages),
      abortSignal,
    }),
});
```

### With tools

Use `convertToolsToVercelAITools` to convert frontend-registered tools into AI SDK format:

```ts
import {
  Agent,
  convertMessagesToVercelAISDKMessages,
  convertToolsToVercelAITools,
} from "@copilotkit/runtime/v2";
import { streamText } from "ai";
import { openai } from "@ai-sdk/openai";

const agent = new Agent({
  type: "aisdk",
  factory: ({ input, abortSignal }) => {
    const tools = convertToolsToVercelAITools(input.tools);
    return streamText({
      model: openai("gpt-4o"),
      messages: convertMessagesToVercelAISDKMessages(input.messages),
      tools,
      abortSignal,
    });
  },
});
```

### With reasoning (thinking models)

Reasoning events from models like Claude with extended thinking or OpenAI o3 automatically flow through the `aisdk` converter and are mapped to AG-UI reasoning events:

```ts
import { Agent, convertMessagesToVercelAISDKMessages } from "@copilotkit/runtime/v2";
import { streamText } from "ai";
import { anthropic } from "@ai-sdk/anthropic";

const agent = new Agent({
  type: "aisdk",
  factory: ({ input, abortSignal }) =>
    streamText({
      model: anthropic("claude-sonnet-4", { thinking: { type: "enabled", budgetTokens: 10000 } }),
      messages: convertMessagesToVercelAISDKMessages(input.messages),
      abortSignal,
    }),
});
```

### With state tools

`Agent` does not inject state tools automatically (unlike `BuiltInAgent`). If you need `AGUISendStateSnapshot` or `AGUISendStateDelta`, add them to the tools yourself:

```ts
import {
  Agent,
  convertMessagesToVercelAISDKMessages,
  convertToolsToVercelAITools,
} from "@copilotkit/runtime/v2";
import { streamText } from "ai";
import { openai } from "@ai-sdk/openai";
import { tool } from "ai";
import { z } from "zod";

const agent = new Agent({
  type: "aisdk",
  factory: ({ input, abortSignal }) => {
    const inputTools = convertToolsToVercelAITools(input.tools);
    const stateTools = {
      AGUISendStateSnapshot: tool({
        description: "Replace the entire application state",
        parameters: z.object({ snapshot: z.any() }),
        execute: async ({ snapshot }) => ({ success: true, snapshot }),
      }),
    };
    return streamText({
      model: openai("gpt-4o"),
      messages: convertMessagesToVercelAISDKMessages(input.messages),
      tools: { ...inputTools, ...stateTools },
      abortSignal,
    });
  },
});
```

### With forwardedProps

Read `input.forwardedProps` to let the frontend override model, temperature, or other settings at request time:

```ts
import {
  Agent,
  convertMessagesToVercelAISDKMessages,
  resolveModel,
} from "@copilotkit/runtime/v2";
import { streamText } from "ai";
import { openai } from "@ai-sdk/openai";

const agent = new Agent({
  type: "aisdk",
  factory: ({ input, abortSignal }) => {
    const props = (input.forwardedProps ?? {}) as Record<string, unknown>;
    const model = typeof props.model === "string"
      ? resolveModel(props.model)
      : openai("gpt-4o");
    const temperature = typeof props.temperature === "number"
      ? props.temperature
      : 0.7;

    return streamText({
      model,
      temperature,
      messages: convertMessagesToVercelAISDKMessages(input.messages),
      abortSignal,
    });
  },
});
```

### With system prompt, context, and application state

Since `Agent` does not construct system prompts for you, build them from `input.context` and `input.state`:

```ts
import { Agent, convertMessagesToVercelAISDKMessages } from "@copilotkit/runtime/v2";
import { streamText } from "ai";
import { openai } from "@ai-sdk/openai";

const agent = new Agent({
  type: "aisdk",
  factory: ({ input, abortSignal }) => {
    const systemParts: string[] = ["You are a helpful assistant."];

    if (input.context?.length) {
      for (const ctx of input.context) {
        systemParts.push(`${ctx.description}:\n${ctx.value}`);
      }
    }
    if (input.state && Object.keys(input.state).length > 0) {
      systemParts.push(`Application State:\n${JSON.stringify(input.state, null, 2)}`);
    }

    const messages = convertMessagesToVercelAISDKMessages(input.messages);
    messages.unshift({ role: "system", content: systemParts.join("\n\n") });

    return streamText({
      model: openai("gpt-4o"),
      messages,
      abortSignal,
    });
  },
});
```

### With structured output

Use AI SDK's structured output with `toolChoice: "required"` to force the model to call a specific tool:

```ts
import { Agent, convertMessagesToVercelAISDKMessages } from "@copilotkit/runtime/v2";
import { streamText, tool } from "ai";
import { openai } from "@ai-sdk/openai";
import { z } from "zod";

const agent = new Agent({
  type: "aisdk",
  factory: ({ input, abortSignal }) =>
    streamText({
      model: openai("gpt-4o", { structuredOutputs: true }),
      messages: convertMessagesToVercelAISDKMessages(input.messages),
      tools: {
        getWeather: tool({
          description: "Get weather for a location",
          parameters: z.object({ city: z.string() }),
          execute: async ({ city }) => ({ temp: 72, city }),
        }),
      },
      toolChoice: "required",
      abortSignal,
    }),
});
```

## TanStack AI Examples

TanStack AI uses a different message format than AG-UI. You need to filter out system/developer messages (which become `systemPrompts`) and map the rest to `{ role, content }` objects.

### Basic text generation

```ts
import { Agent } from "@copilotkit/runtime/v2";
import { chat } from "@tanstack/ai";
import { openaiText } from "@tanstack/ai-openai";

const agent = new Agent({
  type: "tanstack",
  factory: ({ input, abortController }) => {
    const messages = input.messages
      .filter((m) => m.role !== "developer" && m.role !== "system")
      .map((m) => ({ role: m.role, content: m.content ?? "" }));

    const systemPrompts = input.messages
      .filter((m) => m.role === "system" || m.role === "developer")
      .map((m) => m.content ?? "");

    return chat({
      adapter: openaiText("gpt-4o"),
      messages,
      systemPrompts,
      abortController,
    });
  },
});
```

### With tools

Use TanStack AI's `toolDefinition` to define server-side tools:

```ts
import { Agent } from "@copilotkit/runtime/v2";
import { chat, toolDefinition } from "@tanstack/ai";
import { openaiText } from "@tanstack/ai-openai";
import { z } from "zod";

const getWeather = toolDefinition({
  name: "getWeather",
  description: "Get the weather for a city",
  inputSchema: z.object({ city: z.string() }),
}).server(async ({ city }) => ({ temp: 72, city }));

const agent = new Agent({
  type: "tanstack",
  factory: ({ input, abortController }) => {
    const messages = input.messages
      .filter((m) => m.role !== "developer" && m.role !== "system")
      .map((m) => ({ role: m.role, content: m.content ?? "" }));

    const systemPrompts = input.messages
      .filter((m) => m.role === "system" || m.role === "developer")
      .map((m) => m.content ?? "");

    return chat({
      adapter: openaiText("gpt-4o"),
      messages,
      systemPrompts,
      tools: [getWeather],
      abortController,
    });
  },
});
```

### With reasoning (thinking models)

TanStack AI emits thinking chunks which the converter maps to AG-UI reasoning events:

```ts
import { Agent } from "@copilotkit/runtime/v2";
import { chat } from "@tanstack/ai";
import { anthropicText } from "@tanstack/ai-anthropic";

const agent = new Agent({
  type: "tanstack",
  factory: ({ input, abortController }) => {
    const messages = input.messages
      .filter((m) => m.role !== "developer" && m.role !== "system")
      .map((m) => ({ role: m.role, content: m.content ?? "" }));

    const systemPrompts = input.messages
      .filter((m) => m.role === "system" || m.role === "developer")
      .map((m) => m.content ?? "");

    return chat({
      adapter: anthropicText("claude-sonnet-4"),
      messages,
      systemPrompts,
      modelOptions: { thinking: { type: "enabled", budgetTokens: 10000 } },
      abortController,
    });
  },
});
```

### With state tools

Since `Agent` does not inject state tools, wire them as TanStack AI tool definitions:

```ts
import { Agent } from "@copilotkit/runtime/v2";
import { chat, toolDefinition } from "@tanstack/ai";
import { openaiText } from "@tanstack/ai-openai";
import { z } from "zod";

const sendStateSnapshot = toolDefinition({
  name: "AGUISendStateSnapshot",
  description: "Replace the entire application state with a new snapshot",
  inputSchema: z.object({ snapshot: z.any() }),
}).server(async ({ snapshot }) => ({ success: true, snapshot }));

const sendStateDelta = toolDefinition({
  name: "AGUISendStateDelta",
  description: "Apply incremental updates to application state using JSON Patch operations",
  inputSchema: z.object({
    delta: z.array(z.object({
      op: z.enum(["add", "replace", "remove"]),
      path: z.string(),
      value: z.any().optional(),
    })),
  }),
}).server(async ({ delta }) => ({ success: true, delta }));

const agent = new Agent({
  type: "tanstack",
  factory: ({ input, abortController }) => {
    const messages = input.messages
      .filter((m) => m.role !== "developer" && m.role !== "system")
      .map((m) => ({ role: m.role, content: m.content ?? "" }));

    const systemPrompts = input.messages
      .filter((m) => m.role === "system" || m.role === "developer")
      .map((m) => m.content ?? "");

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

### With forwardedProps

Read `input.forwardedProps` to let the frontend select the adapter, model, or other options:

```ts
import { Agent } from "@copilotkit/runtime/v2";
import { chat } from "@tanstack/ai";
import { openaiText } from "@tanstack/ai-openai";
import { anthropicText } from "@tanstack/ai-anthropic";

const agent = new Agent({
  type: "tanstack",
  factory: ({ input, abortController }) => {
    const props = (input.forwardedProps ?? {}) as Record<string, unknown>;

    // Allow frontend to select the adapter/model
    const adapter = props.model === "anthropic/claude-sonnet-4"
      ? anthropicText("claude-sonnet-4")
      : openaiText((props.model as string) ?? "gpt-4o");

    const modelOptions: Record<string, unknown> = {};
    if (typeof props.temperature === "number") modelOptions.temperature = props.temperature;
    if (typeof props.max_tokens === "number") modelOptions.max_tokens = props.max_tokens;

    const messages = input.messages
      .filter((m) => m.role !== "developer" && m.role !== "system")
      .map((m) => ({ role: m.role, content: m.content ?? "" }));

    const systemPrompts = input.messages
      .filter((m) => m.role === "system" || m.role === "developer")
      .map((m) => m.content ?? "");

    return chat({
      adapter,
      messages,
      systemPrompts,
      modelOptions,
      abortController,
    });
  },
});
```

### With system prompt, context, and application state

TanStack AI accepts `systemPrompts` as an array of strings. Append context and state as additional entries:

```ts
import { Agent } from "@copilotkit/runtime/v2";
import { chat } from "@tanstack/ai";
import { openaiText } from "@tanstack/ai-openai";

const agent = new Agent({
  type: "tanstack",
  factory: ({ input, abortController }) => {
    const messages = input.messages
      .filter((m) => m.role !== "developer" && m.role !== "system")
      .map((m) => ({ role: m.role, content: m.content ?? "" }));

    const systemPrompts: string[] = [];

    // Collect system/developer messages
    for (const m of input.messages) {
      if ((m.role === "system" || m.role === "developer") && m.content) {
        systemPrompts.push(typeof m.content === "string" ? m.content : JSON.stringify(m.content));
      }
    }

    // Add context
    if (input.context?.length) {
      for (const ctx of input.context) {
        systemPrompts.push(`${ctx.description}:\n${ctx.value}`);
      }
    }

    // Add application state
    if (input.state && Object.keys(input.state).length > 0) {
      systemPrompts.push(`Application State:\n${JSON.stringify(input.state, null, 2)}`);
    }

    return chat({
      adapter: openaiText("gpt-4o"),
      messages,
      systemPrompts,
      abortController,
    });
  },
});
```

### With structured output

Use TanStack AI's `outputSchema` for structured responses:

```ts
import { Agent } from "@copilotkit/runtime/v2";
import { chat } from "@tanstack/ai";
import { openaiText } from "@tanstack/ai-openai";
import { z } from "zod";

const agent = new Agent({
  type: "tanstack",
  factory: ({ input, abortController }) => {
    const messages = input.messages
      .filter((m) => m.role !== "developer" && m.role !== "system")
      .map((m) => ({ role: m.role, content: m.content ?? "" }));

    const systemPrompts = input.messages
      .filter((m) => m.role === "system" || m.role === "developer")
      .map((m) => m.content ?? "");

    return chat({
      adapter: openaiText("gpt-4o"),
      messages,
      systemPrompts,
      outputSchema: z.object({
        summary: z.string(),
        keyPoints: z.array(z.string()),
        sentiment: z.enum(["positive", "neutral", "negative"]),
      }),
      abortController,
    });
  },
});
```

## Custom Examples

The `custom` type gives you full control. Your factory is an async generator (or returns an `AsyncIterable`) that yields AG-UI `BaseEvent` objects directly. No conversion is applied.

### Bring your own framework

```ts
import { Agent } from "@copilotkit/runtime/v2";
import { EventType, type BaseEvent } from "@ag-ui/core";

const agent = new Agent({
  type: "custom",
  factory: async function* ({ input, abortSignal }) {
    const response = await fetch("https://my-llm-api.com/chat", {
      method: "POST",
      body: JSON.stringify({ messages: input.messages }),
      signal: abortSignal,
    });

    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    const messageId = crypto.randomUUID();

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      yield {
        type: EventType.TEXT_MESSAGE_CHUNK,
        role: "assistant",
        messageId,
        delta: decoder.decode(value),
      } as BaseEvent;
    }
  },
});
```

### With tool calls

Yield `TOOL_CALL_START`, `TOOL_CALL_ARGS`, `TOOL_CALL_END`, and `TOOL_CALL_RESULT` events to represent a tool call lifecycle:

```ts
import { Agent } from "@copilotkit/runtime/v2";
import { EventType, type BaseEvent } from "@ag-ui/core";

const agent = new Agent({
  type: "custom",
  factory: async function* ({ input }) {
    const messageId = crypto.randomUUID();
    const toolCallId = crypto.randomUUID();

    // Simulate an LLM deciding to call a tool
    yield {
      type: EventType.TOOL_CALL_START,
      parentMessageId: messageId,
      toolCallId,
      toolCallName: "getWeather",
    } as BaseEvent;

    yield {
      type: EventType.TOOL_CALL_ARGS,
      toolCallId,
      delta: JSON.stringify({ city: "San Francisco" }),
    } as BaseEvent;

    yield {
      type: EventType.TOOL_CALL_END,
      toolCallId,
    } as BaseEvent;

    // Execute the tool and return the result
    const result = await getWeather("San Francisco");

    yield {
      type: EventType.TOOL_CALL_RESULT,
      role: "tool",
      messageId: crypto.randomUUID(),
      toolCallId,
      content: JSON.stringify(result),
    } as BaseEvent;

    // LLM responds with text after tool result
    yield {
      type: EventType.TEXT_MESSAGE_CHUNK,
      role: "assistant",
      messageId,
      delta: "The weather in San Francisco is 72F and sunny.",
    } as BaseEvent;
  },
});
```

## Helper Utilities

These utilities are re-exported from `@copilotkit/runtime/v2` so you can use them in your factory functions without importing internal modules.

### convertMessagesToVercelAISDKMessages

Converts AG-UI messages to Vercel AI SDK message format. Use this when your factory calls `streamText()`:

```ts
import { convertMessagesToVercelAISDKMessages } from "@copilotkit/runtime/v2";

const messages = convertMessagesToVercelAISDKMessages(input.messages);
```

### convertToolsToVercelAITools

Converts AG-UI tools (from `input.tools`) to Vercel AI SDK ToolSet format:

```ts
import { convertToolsToVercelAITools } from "@copilotkit/runtime/v2";

const tools = convertToolsToVercelAITools(input.tools);
```

### convertToolDefinitionsToVercelAITools

Converts `ToolDefinition[]` to Vercel AI SDK ToolSet format. Useful when you have tool definitions in the AG-UI `ToolDefinition` format rather than the raw `input.tools`:

```ts
import { convertToolDefinitionsToVercelAITools } from "@copilotkit/runtime/v2";

const tools = convertToolDefinitionsToVercelAITools(toolDefinitions);
```

### resolveModel

Resolves a string like `"openai/gpt-4o"` or `"anthropic/claude-sonnet-4"` to a `LanguageModel` instance. Useful with `forwardedProps` when the frontend sends a model identifier:

```ts
import { resolveModel } from "@copilotkit/runtime/v2";

const model = resolveModel("openai/gpt-4o"); // Returns LanguageModel instance
```

## Wiring into CopilotRuntime

Once you have an `Agent` instance, plug it into `CopilotRuntime` the same way you would with `BuiltInAgent`:

```ts
import { CopilotRuntime, InMemoryAgentRunner } from "@copilotkit/runtime/v2";

const runtime = new CopilotRuntime({
  agents: { default: agent },
  runner: new InMemoryAgentRunner(),
});
```

You can register multiple agents by name:

```ts
const runtime = new CopilotRuntime({
  agents: {
    default: aiSdkAgent,
    research: tanstackAgent,
    custom: customAgent,
  },
  runner: new InMemoryAgentRunner(),
});
```

The `default` agent is used when no specific agent is requested by the frontend.
