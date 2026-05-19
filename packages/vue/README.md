# @copilotkit/vue

Vue 3 bindings for CopilotKit — connect your Vue app to AI agents with providers, composables, and chat UI primitives.

## Overview

| Export | Role |
|--------|------|
| `CopilotKitProvider` | Connects Vue to the CopilotKit runtime |
| `CopilotChat`, `CopilotSidebar`, `CopilotPopup` | Render chat UI |
| `CopilotChatInput` | Standalone chat input with tools menu and voice |
| `useFrontendTool` | Expose client-side tools to the agent |
| `useAgentContext` | Provide app state as agent context |
| Slots and programmatic renderers | Customize message, tool, and activity rendering |

## Installation

```bash
pnpm add @copilotkit/vue
```

Import styles once in your app entry:

```ts
import "@copilotkit/vue/styles.css";
```

## Import Paths

| Path | Purpose |
|------|---------|
| `@copilotkit/vue/v2` | **Recommended.** Full v2 API with Zod/Standard Schema tool parameters. |
| `@copilotkit/vue` | V1 compatibility wrappers. Shadows some v2 exports with adapters that accept legacy `Parameter[]` arrays. |

New projects should import from `@copilotkit/vue/v2`. Use the root import only if you need backward-compatible `Parameter[]`-style tool definitions.

## Quickstart

```vue
<script setup lang="ts">
import { CopilotKitProvider, CopilotChat } from "@copilotkit/vue/v2";
</script>

<template>
  <CopilotKitProvider runtime-url="/api/copilotkit">
    <CopilotChat />
  </CopilotKitProvider>
</template>
```

## Build A Chat UI

Use `CopilotChat` for full control, or `CopilotSidebar`/`CopilotPopup` for pre-styled layouts.

```vue
<CopilotChat agent-id="default" thread-id="thread-1" />
<CopilotSidebar agent-id="default" />
<CopilotPopup agent-id="default" />
```

### Chat Input

`CopilotChatInput` provides a standalone input with tools menu, voice transcription, and positioning:

```vue
<CopilotChatInput
  v-model="input"
  :tools-menu="[{ label: 'Insert template', action: () => {} }]"
  @submit-message="onSubmit"
/>
```

Key slots: `layout`, `text-area`, `send-button`, `add-menu-button`, `start-transcribe-button`, `cancel-transcribe-button`, `finish-transcribe-button`, `audio-recorder`, `disclaimer`.

### Threads

List and manage conversation threads with `useThreads`:

```vue
<script setup lang="ts">
import { useThreads } from "@copilotkit/vue/v2";

const { threads, isLoading, hasMoreThreads, fetchMoreThreads, deleteThread } =
  useThreads({ agentId: "default", limit: 20 });
</script>

<template>
  <ul v-if="!isLoading">
    <li v-for="thread in threads" :key="thread.id">
      {{ thread.name ?? "Untitled" }}
      <button @click="deleteThread(thread.id)">Delete</button>
    </li>
  </ul>
  <button v-if="hasMoreThreads" @click="fetchMoreThreads()">Load more</button>
</template>
```

## Add App Capabilities

### Frontend Tools

Register tools the agent can invoke on the client:

```vue
<script setup lang="ts">
import { useFrontendTool } from "@copilotkit/vue/v2";
import { z } from "zod";

useFrontendTool({
  name: "sayHello",
  parameters: z.object({ name: z.string() }),
  handler: async ({ name }) => `Hello ${name}!`,
});
</script>
```

### Agent Context

Provide live app state as context the agent can read:

```vue
<script setup lang="ts">
import { useAgentContext } from "@copilotkit/vue/v2";

useAgentContext({
  description: "The user's current page",
  value: "Dashboard",
});
</script>
```

### Suggestions

Configure AI-generated follow-up suggestions below the chat:

```vue
<script setup lang="ts">
import { useConfigureSuggestions } from "@copilotkit/vue/v2";

useConfigureSuggestions({
  instructions: "Suggest follow-up tasks based on the current page",
  available: "always",
});
</script>
```

### Human-in-the-Loop

Register a tool that pauses execution until the user responds from a rendered component:

```vue
<script setup lang="ts">
import { useHumanInTheLoop } from "@copilotkit/vue/v2";
import { z } from "zod";
import ApprovalCard from "./ApprovalCard.vue";

useHumanInTheLoop({
  name: "approveAction",
  parameters: z.object({ reason: z.string() }),
  render: ApprovalCard,
});
</script>
```

### Interrupts

Handle agent `on_interrupt` events for custom approval or input flows:

```vue
<script setup lang="ts">
import { useInterrupt, CopilotChat } from "@copilotkit/vue/v2";

useInterrupt({
  handler: async ({ event }) => ({ label: String(event.value) }),
});
</script>

<template>
  <CopilotChat>
    <template #interrupt="{ event, result, resolve }">
      <button @click="resolve({ approved: true, value: event.value })">
        {{ result?.label ?? event.value }}
      </button>
    </template>
  </CopilotChat>
</template>
```

For manual placement outside the chat:

```ts
const { interrupt, result, hasInterrupt, resolveInterrupt } = useInterrupt({
  renderInChat: false,
});
```

## Customize Rendering

### Slots

Slots are the primary way to customize chat rendering in Vue. Use scoped slots on `CopilotChatMessageView`:

```vue
<template>
  <CopilotChatMessageView :messages="messages" :is-running="isRunning">
    <template #assistant-message="{ message }">
      <div class="bubble">{{ message.content }}</div>
    </template>

    <template #tool-call-search_docs="{ args, status, result }">
      <SearchResult :args="args" :status="status" :result="result" />
    </template>

    <template #tool-call="{ name, args, status }">
      <GenericToolCard :name="name" :args="args" :status="status" />
    </template>

    <template #activity-mcp-apps="{ content }">
      <McpAppsView :content="content" />
    </template>
  </CopilotChatMessageView>
</template>
```

Available message slots: `message-before`, `assistant-message`, `user-message`, `reasoning-message`, `activity-<type>`, `activity-message`, `message-after`, `cursor`.

Available tool slots: `tool-call-<name>`, `tool-call` (fallback).

### Programmatic Renderers

When slots aren't sufficient (e.g. reusable renderers with provider-managed ordering or agent scoping), use `renderToolCalls` or `renderCustomMessages` on the provider:

```vue
<script setup lang="ts">
import { defineComponent } from "vue";
import {
  CopilotKitProvider,
  CopilotChat,
  defineToolCallRenderer,
} from "@copilotkit/vue/v2";
import { z } from "zod";

const WeatherCard = defineComponent({
  props: {
    args: { type: Object, required: true },
    status: { type: String, required: true },
  },
  template: `
    <div style="padding: 12px; border-radius: 8px; background: #f0f9ff;">
      <strong>Weather for {{ args.city }}</strong>
      <span v-if="status === 'complete'"> — sunny!</span>
      <span v-else> — loading…</span>
    </div>
  `,
});

const weatherRenderer = defineToolCallRenderer({
  name: "get_weather",
  args: z.object({ city: z.string() }),
  render: WeatherCard,
});
</script>

<template>
  <CopilotKitProvider
    runtime-url="/api/copilotkit"
    :render-tool-calls="[weatherRenderer]"
  >
    <CopilotChat />
  </CopilotKitProvider>
</template>
```

Other render/component composables:

| Composable | Purpose |
|------------|---------|
| `useRenderTool` | Register a render function for a specific tool call |
| `useDefaultRenderTool` | Fallback renderer for any unmatched tool calls |
| `useComponent` | Register a named component the agent can render |

### Reasoning Messages

The default reasoning message behavior:

- Shows "Thinking…" while streaming, switches to "Thought for …" on completion.
- Auto-opens while streaming, auto-collapses when done.
- Hides the chat-level cursor during reasoning.

Customize via the `#reasoning-message` slot on `CopilotChatMessageView`.

## Configure The Provider

`CopilotKitProvider` connects your app to the CopilotKit runtime and accepts configuration for agents, errors, A2UI, and debugging.

### Runtime and Agents

```vue
<CopilotKitProvider
  runtime-url="/api/copilotkit"
  :self-managed-agents="{ default: myAgent }"
/>
```

`selfManagedAgents` registers local `AbstractAgent` instances (keyed by agent ID); merged with `agents__unsafe_dev_only`, with `selfManagedAgents` taking precedence for duplicate IDs.

### Error Handling

```vue
<CopilotKitProvider
  runtime-url="/api/copilotkit"
  :on-error="({ error, code, context }) => console.error(code, error)"
/>
```

`CopilotChat` also exposes an `onError` callback that only fires for errors matching the resolved chat agent. Provider and chat error handlers are independent.

### A2UI

```vue
<CopilotKitProvider
  runtime-url="/api/copilotkit"
  :a2ui="{ theme: { mode: 'light' } }"
/>
```

Configures the built-in A2UI surface renderer when the runtime reports `a2uiEnabled: true`.

### Debug Logging

```vue
<CopilotKitProvider
  runtime-url="/api/copilotkit"
  :debug="{ events: true, lifecycle: true, verbose: false }"
/>
```

Accepts `true`/`false` or a granular config object. Updates are forwarded at runtime without recreating the provider.

## V1 Compatibility

The root import `@copilotkit/vue` re-exports everything from `/v2` but shadows certain composables with v1 compatibility wrappers:

```vue
<script setup lang="ts">
// V1 style — accepts Parameter[] arrays
import { useCopilotAction } from "@copilotkit/vue";

useCopilotAction({
  name: "greet",
  parameters: [{ name: "user", type: "string" }],
  handler: async ({ user }) => alert(`Hi ${user}`),
});
</script>
```

Do not pass Zod/Standard Schema parameters to root v1 wrappers — they expect legacy `Parameter[]` arrays and will throw. Use `@copilotkit/vue/v2` for Zod-based tool APIs.

## Examples

See [`examples/v2/vue/demo`](https://github.com/CopilotKit/CopilotKit/tree/main/examples/v2/vue/demo) for a working Nuxt demo with multiple chat layouts, A2UI surfaces, frontend tools, and interrupt handling.

## Contributing

- [CONTRIBUTOR_GUIDE.md](./CONTRIBUTOR_GUIDE.md) — package development workflow
- [PARITY.md](./PARITY.md) — React-to-Vue parity rules and implementation matrix
