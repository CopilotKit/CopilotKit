BuiltInAgent model identifiers — the full set of `"provider/model"` strings that
`resolveModel` accepts out of the box.

## Shape

`"provider/model"` or `"provider:model"` — both separators are normalized. Case-insensitive on the provider segment.

```typescript
new BuiltInAgent({ model: "openai/gpt-4o" });
new BuiltInAgent({ model: "anthropic:claude-sonnet-4.5" });
```

## Supported providers

| Provider                              | Env var             | Notes                              |
| ------------------------------------- | ------------------- | ---------------------------------- |
| `openai`                              | `OPENAI_API_KEY`    | Lazily creates `@ai-sdk/openai`    |
| `anthropic`                           | `ANTHROPIC_API_KEY` | Lazily creates `@ai-sdk/anthropic` |
| `google` / `gemini` / `google-gemini` | `GOOGLE_API_KEY`    | `@ai-sdk/google` under the hood    |
| `vertex`                              | (GCP auth)          | `@ai-sdk/google-vertex`            |

Pass `apiKey` on the constructor to override env vars.

## Pinned identifiers in the union type

These are the concrete strings typed in `BuiltInAgentModel`:

```
openai/gpt-5            openai/gpt-5-mini
openai/gpt-4.1          openai/gpt-4.1-mini        openai/gpt-4.1-nano
openai/gpt-4o           openai/gpt-4o-mini
openai/o3               openai/o3-mini             openai/o4-mini

anthropic/claude-sonnet-4.5   anthropic/claude-sonnet-4
anthropic/claude-3.7-sonnet   anthropic/claude-opus-4.1
anthropic/claude-opus-4       anthropic/claude-3.5-haiku

google/gemini-2.5-pro   google/gemini-2.5-flash    google/gemini-2.5-flash-lite
```

Any other valid model id is still accepted — the type is
`BuiltInAgentModel = "openai/gpt-5" | ... | (string & {})`, and the AI SDK provider will
accept any id it knows about. The pinned union is for autocomplete, not an exhaustive allowlist.

## Passing a LanguageModel instance directly

Instead of a string, pass a pre-configured `LanguageModel`:

```typescript
import { BuiltInAgent } from "@copilotkit/runtime/v2";
import { createOpenAI } from "@ai-sdk/openai";

const openai = createOpenAI({ apiKey: process.env.OPENAI_API_KEY });
new BuiltInAgent({ model: openai("gpt-4o") });
```

This bypasses `resolveModel` entirely.

Source: `packages/runtime/src/agent/index.ts:82-109, 176-249`.
