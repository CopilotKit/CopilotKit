---
name: capabilities
description: >
  Read AgentCapabilities declared by an agent via useCapabilities(agentId?).
  Populated from the runtime /info handshake — returns undefined until the
  connection resolves. Use to feature-gate voice input, tool UI, or any
  capability-conditional UI. Load when conditionally hiding a feature based
  on what the connected agent supports.
type: framework
framework: react
library: copilotkit
library_version: "1.56.2"
requires:
  - copilotkit/agent-access
sources:
  - "CopilotKit/CopilotKit:packages/react-core/src/v2/hooks/use-capabilities.tsx"
  - "CopilotKit/CopilotKit:packages/runtime/src/agent/index.ts"
---

# CopilotKit Capabilities (React)

This skill builds on `copilotkit/agent-access`. `useCapabilities` internally
calls `useAgent` and reads the `capabilities` field populated from the
runtime `/info` response.

`AgentCapabilities` is from `@ag-ui/core`. The hook is synchronous — there
is no loading state, but the value is `undefined` until the handshake
completes.

## Setup

```tsx
"use client";
import { useCapabilities } from "@copilotkit/react-core/v2";

export function VoiceButton() {
  const caps = useCapabilities(); // defaults to DEFAULT_AGENT_ID

  // Handshake pending — show a placeholder
  if (caps === undefined) return <div className="skeleton h-8 w-8" />;

  // Handshake complete — feature-gate
  if (!caps.transcription) return null;

  return <button>Record</button>;
}
```

## Core Patterns

### Scope to a specific agent

```tsx
const caps = useCapabilities("research");
```

### Feature-gate tools UI

```tsx
const caps = useCapabilities("default");

if (caps === undefined) return <ToolsSkeleton />;
if (caps.tools?.supported === false) return null;
return <ToolsPanel />;
```

### Narrow optional fields defensively

`AgentCapabilities` is a partial declaration — fields may be absent when
the agent opts not to declare them.

```tsx
const caps = useCapabilities();
const maxTokens = caps?.maxOutputTokens ?? "unknown";
```

## Common Mistakes

### HIGH — Treating `undefined` as "no capabilities"

Wrong:

```tsx
function VoiceButton() {
  const caps = useCapabilities();
  if (!caps?.transcription) return null; // hides button forever while handshake pending
  return <button>Record</button>;
}
```

Correct:

```tsx
function VoiceButton() {
  const caps = useCapabilities();
  if (caps === undefined) return <div className="skeleton h-8 w-8" />;
  if (!caps.transcription) return null;
  return <button>Record</button>;
}
```

`useCapabilities` returns `undefined` until the runtime `/info` handshake
completes. Treating `undefined` the same as `{ transcription: false }`
hides features that should be visible post-handshake.

Source: `packages/react-core/src/v2/hooks/use-capabilities.tsx:7-9`

### MEDIUM — Non-null assertion on optional fields

Wrong:

```tsx
const caps = useCapabilities();
return <div>Max tokens: {caps!.maxOutputTokens}</div>;
// Crashes if agent didn't declare capabilities, or didn't declare maxOutputTokens.
```

Correct:

```tsx
const caps = useCapabilities();
return <div>Max tokens: {caps?.maxOutputTokens ?? "unknown"}</div>;
```

`AgentCapabilities` is a partial declaration. Agents opt in to each
capability, so every field is optional. Narrow before deref.

Source: `packages/react-core/src/v2/hooks/use-capabilities.tsx:20-22`

### MEDIUM — Expecting deep merge from server-side `capabilities`

Wrong:

```ts
// Server:
new BuiltInAgent({
  // ...
  capabilities: { tools: { supported: true } },
});
// Client expects caps.tools.clientProvided to still be set by the default
```

Correct:

```ts
// Server — provide full category:
new BuiltInAgent({
  // ...
  capabilities: { tools: { supported: true, clientProvided: true } },
});
```

BuiltInAgent shallow-merges capabilities at the category level — providing
`tools: {...}` replaces the whole category, not just the specified fields.
The client then sees exactly what was declared.

Source: `packages/runtime/src/agent/index.ts:821-829,883-887`
