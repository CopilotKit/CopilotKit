BuiltInAgent helper utilities — exported from `@copilotkit/runtime/v2`.

## convertInputToTanStackAI

```typescript
import { convertInputToTanStackAI } from "@copilotkit/runtime/v2";

// signature (simplified):
// convertInputToTanStackAI(input: RunAgentInput): {
//   messages: TanStackAIMessage[];
//   systemPrompts: string[];
// }
```

Converts the AG-UI `RunAgentInput` into TanStack AI's `chat()` inputs. System messages in
the input are collected into the `systemPrompts` array (not the `messages` array). Unshift
your own system prompt onto `systemPrompts` before calling `chat()`:

```typescript
const { messages, systemPrompts } = convertInputToTanStackAI(input);
systemPrompts.unshift("You are a helpful assistant.");
return chat({ adapter, messages, systemPrompts, abortController });
```

Source: `packages/runtime/src/agent/converters/tanstack.ts:156`.

## convertMessagesToVercelAISDKMessages

```typescript
import { convertMessagesToVercelAISDKMessages } from "@copilotkit/runtime/v2";

// signature:
// convertMessagesToVercelAISDKMessages(
//   messages: Message[],
//   options?: { forwardSystemMessages?: boolean; forwardDeveloperMessages?: boolean }
// ): ModelMessage[]
```

Converts AG-UI `Message[]` to the Vercel AI SDK's `ModelMessage[]`. Handles multimodal
content (text, image, audio/video/document, and legacy `binary`). By default drops
`role: "system"` and `role: "developer"` messages — set the options to opt in.

```typescript
const messages = convertMessagesToVercelAISDKMessages(input.messages, {
  forwardSystemMessages: true,
});
```

Source: `packages/runtime/src/agent/index.ts:435`.

## convertToolsToVercelAITools

```typescript
import { convertToolsToVercelAITools } from "@copilotkit/runtime/v2";

// signature:
// convertToolsToVercelAITools(tools: RunAgentInput["tools"]): ToolSet
```

Converts AG-UI `input.tools` (tools registered on the frontend — their parameters are plain
JSON Schema) into the AI SDK's `ToolSet`. Throws `Invalid JSON schema for tool ${name}`
when a tool's parameters aren't a JSON schema object. The resulting tools have no
`execute` — the AI SDK emits tool-call events and the frontend handles them.

```typescript
const tools = convertToolsToVercelAITools(input.tools);
return streamText({ model, messages, tools, abortSignal });
```

Source: `packages/runtime/src/agent/index.ts:599`.

## convertToolDefinitionsToVercelAITools

```typescript
import { convertToolDefinitionsToVercelAITools } from "@copilotkit/runtime/v2";

// signature:
// convertToolDefinitionsToVercelAITools(tools: ToolDefinition[]): ToolSet
```

Converts server-side `ToolDefinition[]` (Standard Schema V1 parameters + `execute`
function) into an AI SDK `ToolSet`. Zod schemas pass through directly; non-Zod Standard
Schema V1 parameters (Valibot, ArkType, ...) are converted to JSON Schema via
`schemaToJsonSchema` and wrapped with `jsonSchema()` from `ai`.

```typescript
import { defineTool } from "@copilotkit/runtime/v2";
import { z } from "zod";

const searchTool = defineTool({
  name: "search",
  description: "Search the web.",
  parameters: z.object({ query: z.string() }),
  execute: async ({ query }) => ({ results: [] }),
});

const tools = convertToolDefinitionsToVercelAITools([searchTool]);
return streamText({ model, messages, tools, abortSignal });
```

Source: `packages/runtime/src/agent/index.ts:633`.

## resolveModel

```typescript
import { resolveModel } from "@copilotkit/runtime/v2";

// signature:
// resolveModel(spec: ModelSpecifier, apiKey?: string): LanguageModel
```

Resolves a `"provider/model"` (or `"provider:model"`) string to a `LanguageModel`. If
`spec` is already a `LanguageModel`, it's returned as-is. Throws
`Invalid model string "..."` when the provider separator is missing.

Supported providers: `openai`, `anthropic`, `google`/`gemini`/`google-gemini`, `vertex`.
Unknown providers throw `Unknown provider "..." in "...". Supported: openai, anthropic, google (gemini).`

```typescript
const model = resolveModel("openai/gpt-4o", process.env.OPENAI_API_KEY);
```

Source: `packages/runtime/src/agent/index.ts:176-249`.
