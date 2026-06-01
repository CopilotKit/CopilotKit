# @copilotkit/vue

Vue 3 bindings for CopilotKit2: providers, composables, and chat rendering primitives for integrating AI agents into Vue applications.

## Documentation Location

Vue-specific documentation does not belong in the shared `docs/` V2 reference unless the repository adds a dedicated Vue docs section there.

- Keep package usage and API guidance in this README.
- Keep parity policy, architectural translation decisions, strict test-port rules, and the living React-to-Vue matrix in [PARITY.md](https://github.com/CopilotKit/CopilotKit/blob/main/packages/vue/PARITY.md).
- Put public-facing Vue API and component documentation in Vue Storybook under `examples/v2/vue/storybook`.

## Parity Delivery Checklist

The parity checklist and strict translatability rules are maintained in [PARITY.md](https://github.com/CopilotKit/CopilotKit/blob/main/packages/vue/PARITY.md). Use it as the source of truth for parity completion and for deciding when tests must mirror React literally.

## Parity Workflow

Follow [PARITY.md](https://github.com/CopilotKit/CopilotKit/blob/main/packages/vue/PARITY.md) for parity workflow. If a feature is not clearly near-100% translatable, discuss the API/test divergence before introducing a Vue-specific translation. Update the matrix in the same change when behavior or tests change.

## Installation

```bash
pnpm add @copilotkit/vue @copilotkit/core
```

Import package styles once in your app entry:

```ts
import "@copilotkit/vue/styles.css";
```

`styles.css` is generated from `src/styles/globals.css` via Tailwind (`pnpm -C packages/vue build:css`).
The Vue package styles are self-contained and do not require importing `@copilotkit/react/styles.css`.

## Basic Usage

```vue
<script setup lang="ts">
import { CopilotKitProvider } from "@copilotkit/vue";
</script>

<template>
  <CopilotKitProvider runtime-url="/api/copilotkit">
    <slot />
  </CopilotKitProvider>
</template>
```

## Provider Parity: `selfManagedAgents`, `onError`, and `a2ui`

`CopilotKitProvider` supports React-parity provider controls for local agent registration and runtime error handling.

```vue
<script setup lang="ts">
import { CopilotKitProvider } from "@copilotkit/vue";
import type { CopilotKitCoreErrorCode } from "@copilotkit/core";

function onProviderError(event: {
  error: Error;
  code: CopilotKitCoreErrorCode;
  context: Record<string, any>;
}) {
  console.error(
    "CopilotKit provider error",
    event.code,
    event.context,
    event.error,
  );
}
</script>

<template>
  <CopilotKitProvider
    runtime-url="/api/copilotkit"
    :self-managed-agents="{}"
    :on-error="onProviderError"
    :a2ui="{ theme: { mode: 'light' } }"
  >
    <slot />
  </CopilotKitProvider>
</template>
```

Notes:

- `selfManagedAgents` is merged with `agents__unsafe_dev_only`, with `selfManagedAgents` taking precedence for duplicate IDs.
- `onError` receives provider-scope core errors and is independent from chat-level `CopilotChat.onError`.
- `a2ui.theme` customizes the built-in `a2ui-surface` fallback renderer when the runtime reports `a2uiEnabled: true`.

### Provider `debug` logging

`CopilotKitProvider` accepts a `debug` prop that mirrors the React `debug` surface. It toggles client-side debug logging on the underlying core and is kept in sync at runtime as the prop changes.

Supported values match React parity:

- `true` / `false` — enables or disables event + lifecycle logging (verbose payloads stay off).
- `{ events?: boolean; lifecycle?: boolean; verbose?: boolean }` — granular control; `verbose` opts into full event payloads.

```vue
<script setup lang="ts">
import { CopilotKitProvider, type DebugConfig } from "@copilotkit/vue";

const debug: DebugConfig = { events: true, lifecycle: true, verbose: false };
</script>

<template>
  <CopilotKitProvider runtime-url="/api/copilotkit" :debug="debug">
    <slot />
  </CopilotKitProvider>
</template>
```

Prop updates are forwarded to the stable `CopilotKitCoreVue` instance via `setDebug(...)`, so changing `debug` at runtime does not recreate the provider or the core instance.

## Chat Error Parity: `CopilotChat.onError`

`CopilotChat` also exposes an `onError` callback with React-parity filtering semantics.
It only forwards errors for the resolved chat agent (or global errors without an `agentId`).

```vue
<script setup lang="ts">
import { CopilotChat } from "@copilotkit/vue";

function onChatError(event: {
  error: Error;
  code: string;
  context: Record<string, any>;
}) {
  console.error("CopilotChat error", event.code, event.context, event.error);
}
</script>

<template>
  <CopilotChat agent-id="default" :on-error="onChatError" />
</template>
```

Notes:

- Provider `onError` and chat `onError` are independent subscriptions and can both fire for the same matching error.
- Chat `onError` ignores errors scoped to other `agentId` values.

## Chat Rendering (Slot-Based)

`@copilotkit/vue` uses Vue named/scoped slots for message, activity, and tool rendering:

- `CopilotChatMessageView`
- `CopilotChatToolCallsView`
- `CopilotChatInput`

```vue
<template>
  <CopilotChatMessageView :messages="messages" :is-running="isRunning">
    <template #message-before="{ message, runId, messageIndexInRun }">
      <MessageMeta
        :id="message.id"
        :run-id="runId"
        :index-in-run="messageIndexInRun"
      />
    </template>

    <template #assistant-message="{ message }">
      <AssistantBubble :content="message.content" />
    </template>

    <template #activity-mcp-apps="{ content }">
      <MyMcpActivity :content="content" />
    </template>

    <template #tool-call-search_docs="{ args, status, result }">
      <SearchDocsToolCall :args="args" :status="status" :result="result" />
    </template>

    <template #tool-call="{ name, args, status }">
      <GenericToolCall :name="name" :args="args" :status="status" />
    </template>
  </CopilotChatMessageView>
</template>
```

Supported message-level slots:

- `message-before`
- `assistant-message`
- `user-message`
- `reasoning-message`
- `activity-<activityType>` (dynamic)
- `activity-message` (fallback)
- `message-after`
- `cursor`

Supported tool-level slots:

- `tool-call-<toolName>` (dynamic)
- `tool-call` (fallback)

## Programmatic Custom Message Registration

Slots remain the primary Vue customization path for chat/message rendering. When you need reusable shared renderers with provider-managed ordering or agent scoping, `CopilotKitProvider` also accepts `render-custom-messages` as a secondary API.

```vue
<script setup lang="ts">
import { CopilotKitProvider, CopilotChat } from "@copilotkit/vue";
import { defineComponent } from "vue";

const AuditBadge = defineComponent({
  props: {
    message: { type: Object, required: true },
    position: { type: String, required: true },
  },
  template: `
    <div
      v-if="position === 'after' && message.role === 'assistant'"
      :data-testid="'audit-' + message.id"
    >
      Audited
    </div>
  `,
});

const renderCustomMessages = [
  { render: AuditBadge },
  { agentId: "sales-agent", render: AuditBadge },
];
</script>

<template>
  <CopilotKitProvider
    runtime-url="/api/copilotkit"
    :render-custom-messages="renderCustomMessages"
  >
    <CopilotChat agent-id="sales-agent" />
  </CopilotKitProvider>
</template>
```

Use:

- `#message-before` / `#message-after` for local template-level customization in a specific chat or message view
- provider `render-custom-messages` for reusable renderer registration, ordered evaluation, and agent-scoped overrides

## Reasoning Messages

`CopilotChatMessageView` supports reasoning messages via the `reasoning-message` slot, with a default `CopilotChatReasoningMessage` fallback.

Default reasoning behavior mirrors React semantics:

- Shows `Thinking…` while the reasoning message is the latest streaming message.
- Switches to `Thought for ...` when reasoning finishes.
- Auto-opens while streaming and auto-collapses on completion.
- Hides the chat-level cursor when the latest message is reasoning.

## Current Scope

- **Providers**: `CopilotKitProvider`, `CopilotChatConfigurationProvider`
- **Composables**: `useCopilotKit`, `useCopilotChatConfiguration`, `useAgent`, `useAgentContext`, `useFrontendTool`, `useRenderTool`, `useDefaultRenderTool`, `useComponent`, `useHumanInTheLoop`, `useSuggestions`, `useConfigureSuggestions`, `useThreads`, `useInterrupt`
- **Components**: `CopilotChat`, `CopilotKitInspector`, `CopilotChatAssistantMessage`, `CopilotChatUserMessage`, `CopilotChatReasoningMessage`, `CopilotChatMessageView`, `CopilotChatSuggestionPill`, `CopilotChatSuggestionView`, `CopilotChatInput`, `CopilotChatToggleButton`, `CopilotModalHeader`, `CopilotChatView`, `CopilotChatToolCallsView`, `CopilotSidebarView`, `CopilotPopupView`, `CopilotSidebar`, `CopilotPopup`, `MCPAppsActivityRenderer`, `A2UISurfaceActivityRenderer`
- **Markdown Renderer**: `CopilotChatAssistantMessage` uses `streamdown-vue` (with KaTeX support)
- **Core**: `CopilotKitCoreVue`

## Threads

```vue
<script setup lang="ts">
import { useThreads } from "@copilotkit/vue";

const {
  threads,
  isLoading,
  hasMoreThreads,
  isFetchingMoreThreads,
  fetchMoreThreads,
  renameThread,
  deleteThread,
} = useThreads({
  agentId: "agent-1",
  includeArchived: false,
  limit: 20,
});

function loadMoreThreads() {
  if (hasMoreThreads.value && !isFetchingMoreThreads.value) {
    fetchMoreThreads();
  }
}
</script>

<template>
  <div v-if="isLoading">Loading…</div>
  <ul v-else>
    <li v-for="thread in threads" :key="thread.id">
      {{ thread.name ?? "Untitled" }}
      <button @click="renameThread(thread.id, 'Renamed')">Rename</button>
      <button @click="deleteThread(thread.id)">Delete</button>
    </li>
  </ul>
  <button
    v-if="hasMoreThreads"
    :disabled="isFetchingMoreThreads"
    @click="loadMoreThreads"
  >
    {{ isFetchingMoreThreads ? "Loading..." : "Load more" }}
  </button>
</template>
```

`useThreads` is a headless composable for Intelligence-platform thread lists scoped to the runtime-authenticated user and provided `agentId`. It supports optional `includeArchived` and `limit` inputs, subscribes to realtime metadata updates when the runtime exposes a websocket URL, and returns reactive refs for `threads`, `isLoading`, `error`, `hasMoreThreads`, and `isFetchingMoreThreads`, plus `fetchMoreThreads()`.

### `useInterrupt`

`useInterrupt` handles agent `on_interrupt` events without requiring Vue users to write render functions or TSX.

For in-chat usage, combine the composable with the `#interrupt` slot on `CopilotChat`:

```vue
<script setup lang="ts">
import { useInterrupt } from "@copilotkit/vue";

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

For manual placement, use `renderInChat: false` and consume the returned refs:

```ts
const { interrupt, result, hasInterrupt, resolveInterrupt } = useInterrupt({
  renderInChat: false,
});
```

## Icon Foundation (Internal)

- Chat/UI components should import icons from `src/components/icons/index.ts`.
- Do not import from `lucide-vue-next` directly in Vue package components.
- This adapter is internal and intentionally not exported from the package root.

## Text Input

```vue
<script setup lang="ts">
import { ref } from "vue";
import {
  CopilotChatConfigurationProvider,
  CopilotChatInput,
} from "@copilotkit/vue";

const input = ref("");

function onSubmitMessage(value: string) {
  console.log("submit:", value);
}
</script>

<template>
  <CopilotChatConfigurationProvider thread-id="thread-1" agent-id="default">
    <CopilotChatInput
      v-model="input"
      :tools-menu="[
        { label: 'Insert template', action: () => console.log('template') },
      ]"
      @submit-message="onSubmitMessage"
      @add-file="() => {}"
      @start-transcribe="() => {}"
      @cancel-transcribe="() => {}"
      @finish-transcribe="() => {}"
    />
  </CopilotChatConfigurationProvider>
</template>
```

Key parity props:

- `mode`: `"input" | "transcribe" | "processing"`
- `toolsMenu`: nested menu items + separators (`"-"`)
- `positioning`: `"static" | "absolute"`
- `keyboardHeight`: number (mobile keyboard offset)
- `showDisclaimer`: explicit override, otherwise defaults by positioning

Key slots:

- `text-area`, `send-button`, `add-menu-button`
- `start-transcribe-button`, `cancel-transcribe-button`, `finish-transcribe-button`
- `audio-recorder`, `disclaimer`, `layout`
