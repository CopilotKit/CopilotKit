# @copilotkit/vue

Vue 3 components and composables for connecting an app to CopilotKit Runtime and rendering agent chat UI. The package includes `CopilotKitProvider`, `CopilotChat`, `CopilotSidebar`, `CopilotPopup`, and composables for agents, tools, context, suggestions, threads, interrupts, and custom rendering.

## Installation

```bash
npm install @copilotkit/vue
```

The package requires Vue 3.3 or newer. Your app also needs a Copilot Runtime endpoint, such as `/api/copilotkit`. If you host the runtime yourself, install `@copilotkit/runtime` in the server project.

## Quick start

```vue
<!-- App.vue -->
<script setup lang="ts">
import { CopilotChat, CopilotKitProvider } from "@copilotkit/vue/v2";
import "@copilotkit/vue/styles.css";
</script>

<template>
  <CopilotKitProvider runtime-url="/api/copilotkit">
    <main style="height: 100dvh">
      <CopilotChat />
    </main>
  </CopilotKitProvider>
</template>
```

Import `@copilotkit/vue/styles.css` once in your app. `CopilotChat` uses the provider's default agent when `agent-id` is omitted. The chat fills its parent, so give that container a height.

## Imports and compatibility

Use the `/v2` subpath for new code:

```ts
import {
  CopilotChat,
  CopilotKitProvider,
  useFrontendTool,
} from "@copilotkit/vue/v2";
```

The root import, `@copilotkit/vue`, re-exports the v2 API and keeps compatibility wrappers for `CopilotKit`, `useCopilotAction`, `useFrontendTool`, and `useCopilotReadable`. The legacy tool wrappers accept `Parameter[]` definitions. Use `/v2` for the current Standard Schema tool APIs, including Zod, Valibot, and ArkType schemas.

In Vue templates, camelCase props become kebab-case attributes. For example, `runtimeUrl` is written as `runtime-url`, and boolean or object props use `:` bindings such as `:enable-inspector="false"`. Vue rendering customization uses named and scoped slots where React uses render props.

## Documentation

- [Vue getting started guide](https://docs.copilotkit.ai/vue)
- [Vue API reference](https://docs.copilotkit.ai/reference/vue)

The full Vue docs cover runtime setup, prebuilt chat components, composables, tools, threads, interrupts, attachments, voice, and customization.
