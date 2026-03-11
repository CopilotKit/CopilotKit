# @copilotkitnext/vue

Vue 3 bindings for CopilotKit2: providers, composables, and chat rendering primitives for integrating AI agents into Vue applications.

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

## Chat Rendering (Slot-Based)

`@copilotkitnext/vue` uses Vue named/scoped slots for message, activity, and tool rendering:

- `CopilotChatMessageView`
- `CopilotChatToolCallsView`
- `CopilotChatInput`

```vue
<template>
  <CopilotChatMessageView :messages="messages" :is-running="isRunning">
    <template #message-before="{ message, runId, messageIndexInRun }">
      <MessageMeta :id="message.id" :run-id="runId" :index-in-run="messageIndexInRun" />
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
- **Composables**: `useCopilotKit`, `useCopilotChatConfiguration`, `useAgent`, `useAgentContext`, `useFrontendTool`, `useHumanInTheLoop`, `useSuggestions`, `useConfigureSuggestions`
- **Components**: `CopilotChat`, `CopilotKitInspector`, `CopilotChatAssistantMessage`, `CopilotChatUserMessage`, `CopilotChatMessageView`, `CopilotChatSuggestionPill`, `CopilotChatSuggestionView`, `CopilotChatInput`, `CopilotChatToggleButton`, `CopilotModalHeader`, `CopilotChatView`, `CopilotChatToolCallsView`, `CopilotSidebarView`, `CopilotPopupView`, `CopilotSidebar`, `CopilotPopup`, `MCPAppsActivityRenderer`
- **Markdown Renderer**: `CopilotChatAssistantMessage` uses `streamdown-vue` (with KaTeX support)
- **Core**: `CopilotKitCoreVue`

## Icon Foundation (Internal)

- Chat/UI components should import icons from `src/components/icons/index.ts`.
- Do not import from `lucide-vue-next` directly in Vue package components.
- This adapter is internal and intentionally not exported from the package root.

## Text Input

```vue
<script setup lang="ts">
import { ref } from "vue";
import { CopilotChatConfigurationProvider, CopilotChatInput } from "@copilotkitnext/vue";

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

| React surface | Vue surface |
| --- | --- |
| `renderToolCalls` / `useRenderToolCall` specific tool renderer | `#tool-call-<toolName>` |
| `renderToolCalls` wildcard renderer (`name: "*"` ) | `#tool-call` |
| `renderActivityMessages` specific activity renderer | `#activity-<activityType>` |
| `renderActivityMessages` fallback renderer | `#activity-message` |
| `renderCustomMessages` (`position: "before"`) | `#message-before` |
| `renderCustomMessages` (`position: "after"`) | `#message-after` |

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
