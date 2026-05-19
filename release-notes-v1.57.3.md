# CopilotKit v1.57.3

A patch release on the `1.57` line. Publishes `@copilotkit/vue` to npm for the first time — the package landed during the `1.57.2` cycle but was pinned at `1.57.1` in its own `package.json`, so the previous monorepo release built and tagged it without actually publishing the bump. `1.57.3` corrects the version pin and ships the Vue 3 bindings (providers, composables, full chat component suite, A2UI Vue-native renderer, V1 wrapper) alongside a release-tooling fix that unblocked the pre-commit hook.

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

- **Release tooling: swallow `@tanstack/virtual-core` rAF teardown error in the CopilotChat perf test** — `@tanstack/virtual-core` `3.13.18`'s `scrollToIndex` schedules a nested `requestAnimationFrame` that calls `this.targetWindow.requestAnimationFrame(verify)` with no null-check. The virtualizer's cleanup nulls `targetWindow` on React unmount, so the queued rAF fires post-unmount and throws `Cannot read properties of null (reading 'requestAnimationFrame')`. All 1170 tests in `CopilotChat perf — re-render regression` passed, but `vitest` reported the unhandled error and exited non-zero, which broke the release-PR workflow's pre-commit hook and blocked the `1.57.3` PR from going green. The test now wraps rAF on both `globalThis` and `window` (separate bindings in `vitest`+`jsdom`; tanstack uses `targetWindow.rAF` which resolves to `window.rAF`) so callbacks hitting this specific error are swallowed while other errors still propagate. Also fixes the lefthook lint-fix command — `[ -n "{staged_files}" ]` broke on multi-file expansion (`"[: <path>: unexpected operator"`) because lefthook interpolates files as space-separated words, not a quoted string; the hook now uses `set --` to put them in positional args. Test-infrastructure only — no runtime/consumer change. ([#4921](https://github.com/CopilotKit/CopilotKit/pull/4921))

## Packages republished at `1.57.3`

`@copilotkit/runtime`, `@copilotkit/react-core`, `@copilotkit/react-ui`, `@copilotkit/react-native`, `@copilotkit/vue`, `@copilotkit/core`, `@copilotkit/shared`, `@copilotkit/runtime-client-gql`, `@copilotkit/sdk-js`, `@copilotkit/voice`, `@copilotkit/web-inspector`, `@copilotkit/a2ui-renderer`, `@copilotkit/react-textarea`, `@copilotkit/sqlite-runner`, and `@copilotkit/agentcore-runner`.
