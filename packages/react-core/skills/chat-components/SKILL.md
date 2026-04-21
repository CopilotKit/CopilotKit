---
name: chat-components
description: >
  Drop in CopilotChat / CopilotPopup / CopilotSidebar, or compose the
  headless CopilotChatView with CopilotChatInput / CopilotChatMessageView
  slot primitives. All v2 chat components ship from
  @copilotkit/react-core/v2 — NOT from @copilotkit/react-ui (v2 react-ui is
  CSS-only). CopilotPanel does not exist. Load when building a chat surface,
  swapping the default UI, or debugging "component not exported" errors.
type: framework
framework: react
library: copilotkit
library_version: "1.56.2"
requires:
  - copilotkit/provider-setup
sources:
  - "CopilotKit/CopilotKit:packages/react-core/src/v2/components/chat/index.ts"
  - "CopilotKit/CopilotKit:packages/react-core/src/v2/components/chat/CopilotChat.tsx"
  - "CopilotKit/CopilotKit:packages/react-core/src/v2/components/chat/CopilotChatView.tsx"
---

# CopilotKit Chat Components (React)

This skill builds on `copilotkit/provider-setup`. Read it first — every
chat component must be inside `CopilotKitProvider`.

All chat components live on `@copilotkit/react-core/v2`. The legacy
`@copilotkit/react-ui` package is v1-only; its `/v2` subpath is a CSS-only
import.

## Setup

```tsx
"use client";
import { CopilotChat } from "@copilotkit/react-core/v2";
import "@copilotkit/react-core/v2/styles.css";

export function ChatPanel() {
  return <CopilotChat agentId="default" />;
}
```

`<CopilotChat>` manages messages, input, streaming, attachments, and
suggestions internally via `useAgent`. You do not pass `messages` or
`isRunning` — they are managed for you.

## Core Patterns

### Floating popup

```tsx
import { CopilotPopup } from "@copilotkit/react-core/v2";

<CopilotPopup agentId="default" isModalDefaultOpen={false} />;
```

### Persistent sidebar

```tsx
import { CopilotSidebar } from "@copilotkit/react-core/v2";

<CopilotSidebar agentId="default">
  <MainAppContent />
</CopilotSidebar>;
```

### Headless composition with slot primitives

Use `CopilotChatView` plus the individual slot components when you need
full control over messages, input, or layout. This is the path when you
want to manage `messages`/`isRunning` yourself.

```tsx
import {
  CopilotChatView,
  CopilotChatInput,
  CopilotChatMessageView,
  useAgent,
} from "@copilotkit/react-core/v2";

export function HeadlessChat() {
  const { agent, isRunning } = useAgent({ agentId: "default" });

  return (
    <CopilotChatView
      messages={agent.messages}
      isRunning={isRunning}
      onSubmitInput={(text) => {
        agent.addMessage({
          id: crypto.randomUUID(),
          role: "user",
          content: text,
        });
      }}
    >
      <CopilotChatMessageView />
      <CopilotChatInput />
    </CopilotChatView>
  );
}
```

### Custom labels

```tsx
<CopilotChat
  agentId="default"
  labels={{
    chatInputPlaceholder: "Ask about the data…",
    thinking: "Analyzing…",
  }}
/>
```

## Common Mistakes

### CRITICAL — Importing `CopilotPanel`

Wrong:

```tsx
import { CopilotPanel } from "@copilotkit/react-core/v2";
```

Correct:

```tsx
import {
  CopilotChat,
  CopilotPopup,
  CopilotSidebar,
  CopilotChatView,
} from "@copilotkit/react-core/v2";
```

`CopilotPanel` does not exist in v2 (or v1). This is a common hallucination.
The four chat surfaces are `CopilotChat`, `CopilotPopup`, `CopilotSidebar`,
and the headless `CopilotChatView`.

Source: `packages/react-core/src/v2/components/chat/index.ts` (no `CopilotPanel` export)

### CRITICAL — Importing chat components from `@copilotkit/react-ui` in v2

Wrong:

```tsx
import { CopilotPopup } from "@copilotkit/react-ui";
import "@copilotkit/react-ui/styles.css";
```

Correct:

```tsx
import { CopilotPopup } from "@copilotkit/react-core/v2";
import "@copilotkit/react-core/v2/styles.css";
```

`@copilotkit/react-ui` is v1 only. The v2 subpath of `react-ui` is a
CSS-only import — the components are not there. All v2 chat components ship
from `@copilotkit/react-core/v2`.

Source: `packages/react-ui/src/v2/index.ts` (CSS-only); v2 migration guide

### HIGH — Passing `messages` or `isRunning` to `<CopilotChat>`

Wrong:

```tsx
<CopilotChat agentId="default" messages={myMessages} isRunning={busy} />
```

Correct:

```tsx
// CopilotChat manages messages and isRunning internally.
<CopilotChat agentId="default" />

// For manual control, drop down to headless CopilotChatView:
<CopilotChatView
  messages={myMessages}
  isRunning={busy}
  onSubmitInput={handleSubmit}
>
  <CopilotChatMessageView />
  <CopilotChatInput />
</CopilotChatView>
```

`CopilotChatProps` explicitly `Omit`s `messages` and `isRunning` — passing
them is a TypeScript error, and `<CopilotChat>` always reads from its
internal `useAgent` call.

Source: `packages/react-core/src/v2/components/chat/CopilotChat.tsx:37-52`

### MEDIUM — Two `<CopilotChat>` with the same `agentId` + `threadId`

Wrong:

```tsx
<CopilotChat agentId="research" threadId="t1" />
<CopilotChat agentId="research" threadId="t1" />
```

Correct:

```tsx
// Either use distinct threadIds...
<CopilotChat agentId="research" threadId="panel-a" />
<CopilotChat agentId="research" threadId="panel-b" />

// ...or mount only one <CopilotChat> instance per agent/thread.
```

Both components resolve to the same per-thread clone (cached in a
module-level WeakMap) and submit duplicate messages. See `agent-access` for
the clone semantics.

Source: `packages/react-core/src/v2/hooks/use-agent.tsx:78-119`

### MEDIUM — Missing the v2 CSS import

Wrong:

```tsx
import { CopilotChat } from "@copilotkit/react-core/v2";
// …no styles imported
```

Correct:

```tsx
import { CopilotChat } from "@copilotkit/react-core/v2";
import "@copilotkit/react-core/v2/styles.css";
```

The chat components ship unstyled without the v2 stylesheet. Import it once
at the root of the app or in the same file that sets up the provider.

Source: `packages/react-core/src/v2/index.ts:3` (imports `./index.css`)
