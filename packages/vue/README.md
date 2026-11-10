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
</script>

<template>
  <CopilotKitProvider runtime-url="/api/copilotkit">
    <main style="height: 100dvh">
      <CopilotChat />
    </main>
  </CopilotKitProvider>
</template>
```

`CopilotChat` adds its own CSS, so you don't import a stylesheet. `CopilotChat` uses the provider's default agent when `agent-id` is omitted. The chat fills its parent, so give that container a height.

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

## Generative UI

A text answer is often the wrong answer. With generative UI, the agent renders cards, tables, forms, and charts in the chat. Give the provider a catalog of components:

```vue
<!-- App.vue -->
<script setup lang="ts">
import { CopilotChat, CopilotKitProvider } from "@copilotkit/vue/v2";
import { standardUI } from "@copilotkit/vue/v2/generative-ui";
</script>

<template>
  <CopilotKitProvider
    runtime-url="/api/copilotkit"
    :generativeUI="{ ui: standardUI }"
  >
    <main style="height: 100dvh">
      <CopilotChat />
    </main>
  </CopilotKitProvider>
</template>
```

Write the binding in camelCase: `:generativeUI`. Vue reads `:generative-ui` as a different prop, so the provider does not get the catalog.

`standardUI` is the standard catalog. To let the agent render your own components, build a catalog with `createGenerativeUI`.

Charts and maps use optional libraries. Without them, a chart shows a table and a map shows a list of places. To draw charts and maps:

1. Install the libraries: `npm install chart.js maplibre-gl`.
2. Add the plugins in your app entry:

```ts
import { createApp } from "vue";
import { GenerativeUIChart } from "@copilotkit/vue/v2/generative-ui/chart";
import { GenerativeUIMap } from "@copilotkit/vue/v2/generative-ui/map";
import App from "./App.vue";

createApp(App).use(GenerativeUIChart).use(GenerativeUIMap).mount("#app");
```

Now ask the agent to compare three phone plans. It can answer with a table in the chat.

Read the [generative UI guide](https://docs.copilotkit.ai/vue/generative-ui/components) for your own components, page surfaces, and theming.

## Documentation

- [Vue getting started guide](https://docs.copilotkit.ai/vue)
- [Vue API reference](https://docs.copilotkit.ai/reference/vue)

The full Vue docs cover runtime setup, prebuilt chat components, composables, tools, threads, interrupts, attachments, voice, and customization.
