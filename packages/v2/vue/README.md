# @copilotkitnext/vue

Vue 3 bindings for CopilotKit2: providers, composables, and chat rendering primitives for integrating AI agents into Vue applications.

## Documentation Location

Vue-specific documentation does not belong in the shared `docs/` V2 reference unless the repository adds a dedicated Vue docs section there.

- Keep package guidance and architectural notes in this README.
- Put public-facing Vue API and component documentation in Vue Storybook under `examples/v2/vue/storybook`.

## Parity Delivery Checklist

When porting a React feature to Vue, treat this as required delivery criteria.
All items must be complete for the feature to be considered done.

1. API parity in `packages/v2/vue/src/**` and package exports.
2. Functional parity with React behavior and edge cases.
3. Equivalent Vue tests for behavior, lifecycle, and error paths.
4. JSDoc on new public hooks/composables (with example usage).
5. Vue package docs in this README.
6. Vue Storybook coverage for user-visible behavior.
7. Vue demo/example usage in `examples/v2/vue/demo/**` for user-facing features.

## Installation

```bash
pnpm add @copilotkitnext/vue @copilotkitnext/core
```

Import package styles once in your app entry:

```ts
import "@copilotkitnext/vue/styles.css";
```

`styles.css` is generated from `src/styles/globals.css` via Tailwind (`pnpm -C packages/v2/vue build:css`).
The Vue package styles are self-contained and do not require importing `@copilotkitnext/react/styles.css`.

## Basic Usage

```vue
<script setup lang="ts">
import { CopilotKitProvider } from "@copilotkitnext/vue";
</script>

<template>
  <CopilotKitProvider runtime-url="/api/copilotkit">
    <slot />
  </CopilotKitProvider>
</template>
```

## Provider Parity: `selfManagedAgents` and `onError`

`CopilotKitProvider` supports React-parity provider controls for local agent registration and runtime error handling.

```vue
<script setup lang="ts">
import { CopilotKitProvider } from "@copilotkitnext/vue";
import type { CopilotKitCoreErrorCode } from "@copilotkitnext/core";

function onProviderError(event: {
  error: Error;
  code: CopilotKitCoreErrorCode;
  context: Record<string, any>;
}) {
  console.error("CopilotKit provider error", event.code, event.context, event.error);
}
</script>

<template>
  <CopilotKitProvider
    runtime-url="/api/copilotkit"
    :self-managed-agents="{}"
    :on-error="onProviderError"
  >
    <slot />
  </CopilotKitProvider>
</template>
```

Notes:

- `selfManagedAgents` is merged with `agents__unsafe_dev_only`, with `selfManagedAgents` taking precedence for duplicate IDs.
- `onError` receives provider-scope core errors and is independent from chat-level `CopilotChat.onError`.

## Chat Rendering (Slot-Based)

`@copilotkitnext/vue` uses Vue named/scoped slots for message, activity, and tool rendering:

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
- `activity-<activityType>` (dynamic)
- `activity-message` (fallback)
- `message-after`
- `cursor`

Supported tool-level slots:

- `tool-call-<toolName>` (dynamic)
- `tool-call` (fallback)

## Current Scope

- **Providers**: `CopilotKitProvider`, `CopilotChatConfigurationProvider`
- **Composables**: `useCopilotKit`, `useCopilotChatConfiguration`, `useAgent`, `useAgentContext`, `useFrontendTool`, `useHumanInTheLoop`, `useSuggestions`, `useConfigureSuggestions`, `useThreads`, `useInterrupt`
- **Components**: `CopilotChat`, `CopilotKitInspector`, `CopilotChatAssistantMessage`, `CopilotChatUserMessage`, `CopilotChatMessageView`, `CopilotChatSuggestionPill`, `CopilotChatSuggestionView`, `CopilotChatInput`, `CopilotChatToggleButton`, `CopilotModalHeader`, `CopilotChatView`, `CopilotChatToolCallsView`, `CopilotSidebarView`, `CopilotPopupView`, `CopilotSidebar`, `CopilotPopup`, `MCPAppsActivityRenderer`
- **Markdown Renderer**: `CopilotChatAssistantMessage` uses `streamdown-vue` (with KaTeX support)
- **Core**: `CopilotKitCoreVue`

## Threads

```vue
<script setup lang="ts">
import { useThreads } from "@copilotkitnext/vue";

const { threads, isLoading, renameThread, deleteThread } = useThreads({
  userId: "user-1",
  agentId: "agent-1",
});
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
</template>
```

`useThreads` is a headless composable for Intelligence-platform thread lists. It subscribes to realtime metadata updates when the runtime exposes a websocket URL and returns reactive refs for `threads`, `isLoading`, and `error`.

### `useInterrupt`

`useInterrupt` handles agent `on_interrupt` events without requiring Vue users to write render functions or TSX.

For in-chat usage, combine the composable with the `#interrupt` slot on `CopilotChat`:

```vue
<script setup lang="ts">
import { useInterrupt } from "@copilotkitnext/vue";

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
} from "@copilotkitnext/vue";

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

## React Parity Notes

The package follows the same single-package strategy as `@copilotkitnext/react`, with semantic parity for tool/activity/custom message rendering.

- In React, UI customization is driven by provider render arrays and `useRender*` hooks.
- In Vue, the same behavior is exposed through named/scoped slots on chat view components.
- Runtime semantics remain equivalent (tool matching precedence, tool status progression, activity fallback behavior).

## Architectural Decision: Render APIs -> Slots

Vue intentionally does not expose React-style provider render arrays (`renderToolCalls`, `renderActivityMessages`, `renderCustomMessages`) or `useRender*` hooks.  
Instead, the mirror strategy is deterministic slot translation at chat view boundaries.

Translation map:

| React surface                                                  | Vue surface                |
| -------------------------------------------------------------- | -------------------------- |
| `renderToolCalls` / `useRenderToolCall` specific tool renderer | `#tool-call-<toolName>`    |
| `renderToolCalls` wildcard renderer (`name: "*"` )             | `#tool-call`               |
| `renderActivityMessages` specific activity renderer            | `#activity-<activityType>` |
| `renderActivityMessages` fallback renderer                     | `#activity-message`        |
| `renderCustomMessages` (`position: "before"`)                  | `#message-before`          |
| `renderCustomMessages` (`position: "after"`)                   | `#message-after`           |

Deterministic rules:

1. Keep precedence equivalent to React:
   Specific match first, fallback second.
2. Keep status semantics equivalent for tools:
   `inProgress` -> `executing` -> `complete`.
3. Keep built-in MCP apps fallback behavior:
   If no matching slot handles `mcp-apps`, render `MCPAppsActivityRenderer`.
4. Keep slot payloads stable and parity-tested against React behavior (not component internals).
5. Keep public Vue interaction APIs idiomatic:
   Use emits for component-level UI interactions such as `@submit-message`, `@input-change`, `@select-suggestion`, `@edit-message`, `@switch-to-branch`, `@thumbs-up`, `@thumbs-down`, `@read-aloud`, and `@regenerate`.
6. Keep slot payload actions imperative:
   Use slot payload callbacks such as `onCopy`, `onEdit`, `goPrev`, `goNext`, and `onSubmitMessage` for slotted control surfaces.
7. Only keep public callback props for true command-style flows that must be awaited by the child:
   Current exception: `CopilotChatView.onFinishTranscribeWithAudio`.
8. If a programmatic renderer registration path is used:
   Prefer Vue SFC/components over handwritten `h(...)` render functions when either can express the same behavior.
9. Keep slots as the primary public customization mechanism:
   Component-based registered renderers are acceptable for programmatic registration, but they do not replace the slot-first model.

This is an architectural constraint for future parity work: new React render-hook behavior should be mirrored by extending slot contracts, not by re-introducing provider render props in Vue.

## Architectural Decision: Render Hooks -> Composable State + Slots

Vue also diverges intentionally from React for render-oriented hooks that mix behavior with a render callback.

Rule:

- If a React hook is headless/data-oriented, mirror it as a normal Vue composable with near-identical semantics.
- If a React hook exists primarily to bridge stateful behavior into rendering, translate it into:
  - a Vue composable that owns the behavior/state machine; and
  - slot/template rendering at the chat/component boundary.

This keeps semantic parity with React while avoiding a Vue API that requires userland render functions or TSX for common usage.

Examples:

- Keep as composables: `useAgent`, `useAgentContext`, `useFrontendTool`, `useHumanInTheLoop`, `useSuggestions`, `useConfigureSuggestions`, `useThreads`.
- Translate with this recipe: `useInterrupt`.
- Apply the same recipe to future render-bridge parity surfaces such as `useRenderTool`, `useDefaultRenderTool`, and `useComponent` if they are ever ported.

Design constraints:

1. The composable owns subscription, filtering, preprocessing, pending state, and imperative actions such as resume/resolve.
2. In-chat presentation should be expressed through named/scoped slots on Vue chat components.
3. External/manual placement may expose reactive state or renderable refs from the composable when needed.
4. Do not require Vue consumers to write `h(...)` render functions or TSX for the primary usage path.
5. Keep divergence minimal and explicit: runtime semantics should still match React.
