# CopilotKit v1.57.3

A patch release on the `1.57` line. Re-publishes the monorepo after `1.57.2` shipped corrupted — most notably, `@copilotkit/vue` was on disk but pinned at `1.57.1` in its own `package.json`, so the previous release built and tagged it without actually publishing the bump. `1.57.3` corrects the pins and ships the Vue 3 bindings (providers, composables, full chat component suite, A2UI Vue-native renderer, V1 wrapper) for the first time.

## Install

```bash
npm install @copilotkit/vue@1.57.3 @copilotkit/core@1.57.3
```

```bash
npm install @copilotkit/react-core@1.57.3 @copilotkit/react-ui@1.57.3 @copilotkit/runtime@1.57.3
```

## Features

- **`@copilotkit/vue` available on npm** — The Vue 3 package was merged into the monorepo during the `1.57.2` cycle but its `package.json` was manually pinned to `1.57.1`, so the release pipeline skipped publishing it. `1.57.3` bumps the package to the monorepo version and ships it for the first time. The package provides:

  - **Providers** — `CopilotKitProvider` with React-parity `selfManagedAgents`, `onError`, `a2ui`, and `debug` (`true | false | { events; lifecycle; verbose }`) controls; `CopilotChatConfigurationProvider`; license, sandbox-functions, and capability contexts.
  - **Composables** — `useAgent`, `useAgentContext`, `useFrontendTool`, `useComponent`, `useRenderTool`, `useDefaultRenderTool`, `useHumanInTheLoop`, `useSuggestions`, `useConfigureSuggestions`, `useInterrupt`, `useThreads`, `useAttachments`, `useKeyboardHeight`, `useKatexStyles`, `useCapabilities`, `useRenderCustomMessages`, `useRenderActivityMessage`.
  - **Chat components** — `CopilotChat` (with `CopilotChat.View`), `CopilotChatView`, `CopilotChatInput`, `CopilotChatMessageView`, `CopilotChatAssistantMessage`, `CopilotChatUserMessage`, `CopilotChatReasoningMessage`, `CopilotChatSuggestionView`, `CopilotChatSuggestionPill`, `CopilotChatToolCallsView`, `CopilotChatAudioRecorder`, `CopilotChatAttachmentQueue` / `CopilotChatAttachmentRenderer`, `CopilotChatToggleButton` (with `OpenIcon`/`CloseIcon`), `CopilotModalHeader` (with `Title`/`CloseButton`), `CopilotPopupView` + `CopilotPopupWelcomeScreen`, `CopilotSidebarView` + `CopilotSidebarWelcomeScreen`.
  - **A2UI surface** — `A2UISurfaceActivityRenderer`, `A2UIMessageRenderer`, `MCPAppsActivityRenderer`, `OpenGenerativeUIRenderer`, plus a Vue-native A2UI catalog/adapter/built-in tool-call renderer and a V1 `CopilotKit.vue` wrapper for backward-compatible consumption.
  - **Inspector** — `CopilotKitInspector` and `LicenseWarningBanner`/`InlineFeatureWarning`.
  - **Build** — Vite + `vue-tsc` ESM/CJS dual build with `./v2` subpath export and a self-contained `./styles.css` generated via Tailwind (no `@copilotkit/react-ui/styles.css` import needed).

  Optional peer deps and supporting stories are in `examples/v2/vue` (Nuxt demo + Storybook). ([#4910](https://github.com/CopilotKit/CopilotKit/pull/4910))

  ```vue
  <script setup lang="ts">
  import { CopilotKitProvider, CopilotChat } from "@copilotkit/vue";
  import "@copilotkit/vue/styles.css";
  </script>

  <template>
    <CopilotKitProvider runtime-url="/api/copilotkit">
      <CopilotChat />
    </CopilotKitProvider>
  </template>
  ```

## Fixes

- **Re-publishes packages skipped by the corrupted `1.57.2` release** — `@copilotkit/vue` was the most visible casualty (it stayed at `1.57.1` on npm even though the monorepo tagged `1.57.2`), and `1.57.3` brings every package in the monorepo scope back onto a single matching version so installs and peer-dep resolution work consistently across the `1.57` line. ([#4910](https://github.com/CopilotKit/CopilotKit/pull/4910))

## Packages republished at `1.57.3`

`@copilotkit/runtime`, `@copilotkit/react-core`, `@copilotkit/react-ui`, `@copilotkit/react-native`, `@copilotkit/vue`, `@copilotkit/core`, `@copilotkit/shared`, `@copilotkit/runtime-client-gql`, `@copilotkit/sdk-js`, `@copilotkit/voice`, `@copilotkit/web-inspector`, `@copilotkit/a2ui-renderer`, `@copilotkit/react-textarea`, `@copilotkit/sqlite-runner`, and `@copilotkit/agentcore-runner`.
