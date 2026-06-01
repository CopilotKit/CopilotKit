# React-to-Vue Parity Guide (`@copilotkit/vue`)

This document is the living parity map for the Vue port.
Keep it updated whenever React parity work lands in `packages/vue`.

## Scope and source of truth

- Scope: `packages/vue/**` only.
- Canonical source: `packages/react-core/`, `packages/react-ui/`, `packages/react-textarea/`.
- Goal: semantic parity plus high discoverability.
- Current priority: package-only parity. Avoid upstream/shared changes outside the Vue package until the Vue port is ready to merge.

## Package boundary and documentation placement

- `@copilotkit/vue` follows the same single-package direction as `@copilotkit/react`.
- Core hooks/providers/types and UI-facing rendering primitives should live in this package.
- Keep scope aligned with React's package surface; avoid introducing a parallel `vue-ui` package split.
- Do not add Vue-only hook/component pages to the shared `docs/` V2 reference unless the repository adopts an explicit Vue section there.
- Keep user-facing package usage and API docs in `README.md`.
- Keep user-facing visual docs/examples in `examples/v2/vue/storybook/**`.
- Keep parity policy, translation rules, checklist, and the living React-to-Vue matrix in this file.
- Treat Storybook/demo parity as follow-up work outside this package unless the task explicitly enters a repo-wide parity phase.

## API compatibility policy

- Keep public API names and shapes as close to React as possible unless this document defines an intentional Vue divergence.
- If Vue requires a difference, choose the smallest possible divergence and document it here.
- Prefer explicit type exports from `.ts` files and re-export from package barrels.
- Keep provider/hook/type barrels aligned with React export intent.

## Translation decision tree

Use this decision rule for every React feature:

1. If the React surface is headless/data-oriented:
   Port as a Vue composable/provider/type with near-identical runtime semantics.
2. If the React surface is render-bridge oriented (`render*` arrays or `useRender*` hooks):
   Translate to Vue composable state plus slot-based rendering at chat/view boundaries.
3. Keep behavior parity even when API shape differs:
   Preserve matching precedence, fallback behavior, lifecycle semantics, and edge-case handling.

## Near-100% translation rule

Agents must classify each React feature and its tests before porting.

### When a feature is near-100% translatable

A React feature/test is near-100% translatable when all of the following are true:

1. The Vue public API can keep the same conceptual surface with no meaningful API redesign.
2. The runtime behavior, precedence rules, lifecycle semantics, and error handling can be preserved directly.
3. The implementation boundary is still recognizable in the same package area and file structure.
4. The tests can exercise the same behavior without replacing the core assertion model with Vue-specific customization mechanics such as slots, emits, or different component boundaries.

Examples usually include:

- headless composables
- provider behavior
- core state/lifecycle integration tests
- behavior where Vue is only a framework translation, not an API redesign

### Required rules for near-100% translatable work

If a feature is near-100% translatable, follow these rules strictly:

1. Mirror the React implementation shape as closely as Vue allows without degrading Vue correctness.
2. Mirror file names and suite boundaries one-to-one where practical.
3. Keep `describe` blocks and test case names word-for-word identical to React for the matching cases.
4. Do not add Vue-only wording, regroup cases, or broaden/narrow scope in the mirrored subset.
5. Port the same behavioral assertions first; only then add minimal Vue harness glue needed to execute them.
6. If React has a dedicated feature test file, do not hide the Vue port inside a broader generic test file.
7. Mirror test approach and depth, not only test names:
   - same system boundary (`CopilotChat` flow vs renderer-only unit boundary)
   - same trigger path (user interaction + streamed events vs direct prop injection)
   - same assertion depth (appearance/disappearance, error paths, precedence/fallback checks)
8. If the Vue suite keeps React test names but validates a different boundary or shallower behavior, it must be marked `partial` in the matrix and treated as incomplete parity work.

This rule exists to maximize discoverability. Someone reading the React package should be able to find the Vue counterpart immediately in both implementation and tests.

### When a feature is not near-100% translatable

A feature is not near-100% translatable when one or more of these are true:

1. React relies on a render-prop, render-hook, JSX callback, or component composition pattern that Vue should expose through slots or a different public boundary.
2. Matching React literally would create a non-idiomatic or unstable Vue API.
3. The same behavior must be preserved, but the test needs a different assertion boundary because Vue exposes the feature through slots, emits, or a different component split.

In those cases:

1. Preserve behavioral parity, not literal API parity.
2. Keep the React counterpart obvious through naming, file placement, and explicit matrix mapping.
3. Document the divergence in this file.
4. Discuss the divergence with the user before introducing a new or expanded Vue-specific API translation.

If an agent is unsure whether a feature belongs in the near-100% bucket, the default action is to discuss it with the user before proceeding.

## Architectural decision: Render APIs -> Slots

Vue intentionally keeps slots as the primary customization model.
For render bridges, the mirror strategy is deterministic slot translation at chat view boundaries, with a small number of approved secondary programmatic APIs where strict parity requires framework-managed registration semantics.

### Translation map

| React surface                                                  | Vue surface                                          |
| -------------------------------------------------------------- | ---------------------------------------------------- |
| `renderToolCalls` / `useRenderToolCall` specific tool renderer | `#tool-call-<toolName>`                              |
| `renderToolCalls` wildcard renderer (`name: "*"` )             | `#tool-call`                                         |
| `renderActivityMessages` specific activity renderer            | `#activity-<activityType>`                           |
| `renderActivityMessages` fallback renderer                     | `#activity-message`                                  |
| `renderCustomMessages` (`position: "before"`)                  | `#message-before` or provider `renderCustomMessages` |
| `renderCustomMessages` (`position: "after"`)                   | `#message-after` or provider `renderCustomMessages`  |

### Deterministic rules

1. Keep precedence equivalent to React: specific match first, fallback second.
2. Keep status semantics equivalent for tools: `inProgress` -> `executing` -> `complete`.
3. Keep built-in MCP apps fallback behavior: if no matching slot handles `mcp-apps`, render `MCPAppsActivityRenderer`.
4. Keep built-in A2UI fallback behavior: if no matching slot handles `a2ui-surface` and the runtime reports `a2uiEnabled: true`, render `A2UISurfaceActivityRenderer`.
5. Keep slot payloads stable and parity-tested against React behavior, not component internals.
6. Keep public Vue interaction APIs idiomatic: use emits for component-level UI interactions such as `@submit-message`, `@input-change`, `@select-suggestion`, `@edit-message`, `@switch-to-branch`, `@thumbs-up`, `@thumbs-down`, `@read-aloud`, and `@regenerate`.
7. Keep slot payload actions imperative: use slot payload callbacks such as `onCopy`, `onEdit`, `goPrev`, `goNext`, and `onSubmitMessage` for slotted control surfaces.
8. Only keep public callback props for true command-style flows that must be awaited by the child. Current exception: `CopilotChatView.onFinishTranscribeWithAudio`.
9. If a programmatic renderer registration path is used, prefer Vue SFC/components over handwritten `h(...)` render functions when either can express the same behavior.
10. Keep slots as the primary public customization mechanism. Component-based registered renderers are acceptable for programmatic registration, but they do not replace the slot-first model.
11. `renderCustomMessages` is an approved secondary provider API in Vue because ordered multi-renderer registration and agent-scoped precedence cannot be expressed honestly through a single slot function alone.

This is a constraint for future parity work: new React render-hook behavior should be mirrored by extending slot contracts, not by re-introducing provider render props in Vue.

## Architectural decision: Render hooks -> Composable state + slots

Vue also diverges intentionally from React for render-oriented hooks that mix behavior with a render callback.

### Rule

- If a React hook is headless/data-oriented, mirror it as a normal Vue composable with near-identical semantics.
- If a React hook exists primarily to bridge stateful behavior into rendering, translate it into:
  - a Vue composable that owns the behavior/state machine
  - slot/template rendering at the chat/component boundary

This preserves semantic parity with React while avoiding a Vue API that requires userland render functions or TSX for common usage.

### Examples

- Keep as composables: `useAgent`, `useAgentContext`, `useFrontendTool`, `useHumanInTheLoop`, `useSuggestions`, `useConfigureSuggestions`, `useThreads`.
- Translate with this recipe: `useInterrupt`.
- `useRenderTool`, `useDefaultRenderTool`, and `useComponent` are supported in Vue as secondary programmatic APIs; keep slots as the primary customization surface.

### Design constraints

1. The composable owns subscription, filtering, preprocessing, pending state, and imperative actions such as resume/resolve.
2. In-chat presentation should be expressed through named/scoped slots on Vue chat components.
3. External/manual placement may expose reactive state or renderable refs from the composable when needed.
4. Do not require Vue consumers to write `h(...)` render functions or TSX for the primary usage path.
5. Keep divergence minimal and explicit: runtime semantics should still match React.

## Vue-specific translation principles

- Providers:
  - use default slots by default
  - preserve React provider semantics for inheritance, precedence, and defaults
- Reactivity:
  - prefer safe, explicit reactivity over clever shortcuts
  - avoid passing Vue reactive proxies into APIs that clone/serialize unless normalized
- Hook dependencies:
  - use Vue `WatchSource`-based dependencies to mirror React deps behavior
- Tool rendering:
  - preserve wildcard, specific, and agent-scoped semantics from React
  - keep slots as the primary public customization model
  - keep raw render functions mainly for renderer-bridge glue or places where template/SFC conversion is genuinely awkward

## Discoverability and naming policy

Keep React-to-Vue mapping obvious for both implementation and tests.

1. Mirror React file names and folder locations where semantics align.
2. For integration-style parity suites, use `*.e2e.test.ts` in Vue when React uses `*.e2e.test.tsx`.
3. When Vue mechanics force a different boundary (for example hook -> slot component), keep one primary counterpart and map it explicitly in the matrix below.
4. Do not hide React feature-specific behavior inside broad generic Vue tests if React has a dedicated suite.
5. For near-100% translatable suites, preserve React `describe`/`it` wording exactly for the mirrored cases.

## Testing and alignment

- Follow an integration-first strategy using real `CopilotKitCore` behavior where practical.
- Maintain parity test coverage for:
  - providers (`CopilotKitProvider`, `CopilotChatConfigurationProvider`)
  - hooks (`useAgent`, `useAgentContext`, `useSuggestions`, `useConfigureSuggestions`, `useFrontendTool`, `useHumanInTheLoop`)
  - type helpers (`defineToolCallRenderer`)
- Keep shared test utilities for agent simulation and provider mounting to reduce drift and duplication.
- Keep Vue `src/__tests__/utils/test-helpers.ts` aligned with React helper exports for framework-agnostic factories/scenario helpers.
- Keep Vue scheduler-flush helpers (`waitForAgentRunSubscription`, `emitAgentEventAndFlush`, `completeAgentAndFlush`) as explicit additive adapters; do not hide framework flush inside parity event factories.
- In this package phase, do not add a CI parity-enforcement check for helper export drift.
- Parity requirement is semantic, not snapshot or structure identity.
- Treat React `StrictMode` identity semantics as framework-specific: Vue parity targets lifecycle behavior invariants under rerender/remount, not same-instance identity across unmount/remount.
- Keep bundling and externalization intent aligned with React package behavior.
- Keep shared dependency versions aligned with sibling packages (`core`, `react`, `angular`) unless an intentional repo-wide upgrade occurs.
- Avoid introducing dynamic type-import workarounds when a direct typed import pattern used by React is available.
- For web inspector behavior, mirror React's runtime loading strategy and use test-time mocks in Vue tests.
- For icons, import only from `src/components/icons/index.ts` and do not import from `lucide-vue-next` directly in feature components.

### Test translation policy

Before writing or editing Vue parity tests:

1. Find the primary React counterpart test file.
2. Decide whether the feature is near-100% translatable using the rule above.
3. If yes, port the matching cases with:
   - the same suite names and test names
   - the same test approach (system boundary and trigger flow)
   - comparable assertion depth
4. If not, keep the behavior coverage equivalent but use Vue-native boundaries and call out the divergence in the matrix or notes.
5. If API divergence seems necessary or likely, stop and discuss with the user before extending the Vue public surface.
6. Never mark a row `matched` when wording is mirrored but approach/depth differs materially from the React counterpart.
7. For near-100% translatable suites, do not introduce fallback test variants (for example renderer-only mounts) just to make the suite pass if React validates the behavior through chat/integration flow.
8. Failures must stay explicit: if strict parity tests fail, keep the parity approach and report the failing cases; do not weaken scope, rename tests, or switch to a shallower boundary as a workaround.
9. For strict parity/e2e suites, prefer `@testing-library/vue` query style (`screen.getBy*`, `screen.findBy*`, `waitFor`) so the Vue assertion model mirrors React Testing Library usage closely.
10. In strict parity/e2e suites, avoid Vue Test Utils `wrapper.get(...)` as the primary assertion/query style unless there is a documented blocker.
11. When a parity test harness can be written with Vue templates/SFC components, do not introduce handwritten `h(...)` render-function harnesses.
12. When Vue-specific coverage is needed in an otherwise strict parity file, keep all React-mirrored cases first (same order and wording), then place Vue-only cases in a separate trailing `describe(...)` block labeled as Vue-specific semantics.
13. Do not emulate React `StrictMode` by introducing runtime remount caches in Vue production code; validate Vue rerender/remount lifecycle invariants directly in Vue tests.

### Slot-system suite translation policy

React slot-system suites need a separate rule from near-100% translatable suites.

#### Fixed architectural decision

- Vue stays slot-first for UI customization surfaces.
- Do not add React-style string/object/component override props to Vue components just to port React slot tests literally.
- Do not add nested prop-drill customization APIs to mirror React slot trees.
- Do not add React-style activity renderer registration props where Vue already uses named/scoped slots.

#### Translation goal

For React slot/customization suites, the parity target is:

- same feature coverage
- same behavioral intent
- same discoverability through dedicated counterpart files
- obvious React-to-Vue case mapping
- Vue-native slot/emits/callback mechanics

It is not:

- literal API-shape parity
- fake React-style override props in Vue tests

#### Required rules for slot-suite ports

1. Keep a dedicated Vue counterpart file when React has a dedicated slot/customization suite.
2. Keep the React counterpart obvious through matching file names, top-level suite titles, and case ordering.
3. Translate each React case by feature, not by API shape:
   - React prop/class override case -> Vue named/scoped slot case for the same visible surface
   - React callback/onClick plumbing case -> Vue slot payload callback or emit case for the same interaction
   - React precedence/fallback case -> Vue slot precedence/fallback case at the equivalent boundary
4. Preserve one React case -> one Vue case whenever practical. Do not collapse multiple React cases into one broad Vue test.
5. Keep React `describe`/`it` wording when it remains honest at the Vue slot boundary.
6. If wording must change because the React name is API-shape-specific, change it minimally and keep the same order so side-by-side mapping stays obvious.
7. Add a short mapping comment only when the React -> Vue translation would not be obvious from structure alone.
8. Do not mark a slot-suite row `matched` if the Vue file is broader, shallower, or validates a different feature than the React counterpart, even if the file names align.

#### Practical translation recipe

Use this default recipe for slot-only Vue counterparts:

1. Start from the React dedicated suite.
2. Keep the same file name in Vue where practical (`*.slots.e2e.test.ts`).
3. Keep the same top-level `describe(...)`.
4. Port cases in the same order.
5. Replace React override-prop setup with Vue slot setup for the same customization surface.
6. Keep assertions focused on the same user-visible outcome or interaction contract.
7. Record the mapping in the matrix/backlog if the file is still partial.

## Test script parity

Vue package scripts should mirror React command surface for tests:

- `test`
- `test:watch`
- `test:coverage`
- `test:ui`

This phase does not enforce coverage thresholds.

## Parity workflow and completion criteria

When React parity work is ported:

1. Identify the impacted React implementation and tests.
2. Apply the translation rules and constraints in this document.
3. Update the Vue implementation inside `packages/vue/src/**`.
4. Add or update equivalent Vue tests with parity-friendly discoverability.
5. Update this matrix in the same change.
6. If divergence is intentional, document it here.

For package-level parity work, all items below are required before a ported React feature is considered complete in this package:

1. API parity:
   Vue public surface is present in `packages/vue/src/**` and exports are wired through the relevant package barrels.
2. Functional parity:
   Runtime behavior and edge-case semantics match React intent, with only minimal documented divergence.
3. Test parity:
   Equivalent behavior coverage exists in Vue tests, including lifecycle and error/edge paths.
4. Code-level docs parity:
   New public hooks/composables include JSDoc on implementation with at least one usage example.
5. Package docs parity:
   User-facing Vue notes remain documented in `README.md`.

Out-of-package follow-up, when the repo enters repo-wide parity work:

1. Visual parity:
   Add or update the corresponding Vue Storybook story for user-visible features.
2. Demo/example parity:
   Add or update runnable Vue demo/example usage for user-visible features.

## React -> Vue Parity Matrix

Status values:

- `matched`: equivalent behavior and tests exist.
- `partial`: some behavior/tests exist, but parity depth is incomplete.
- `intentional-divergence`: API shape differs by design, behavior parity still required.

Current snapshot: mapped React->Vue counterpart rows are either `matched` or `intentional-divergence`.

### APIs and render model

| React surface                                                                                                                                    | Vue counterpart                                                                    | Status                 | Notes                                                                                                                                                                                                                                                                                                                                                                                                |
| ------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------- | ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `useAgent`, `useAgentContext`, `useSuggestions`, `useConfigureSuggestions`, `useFrontendTool`, `useHumanInTheLoop`, `useInterrupt`, `useThreads` | Same-named Vue composables in `src/hooks`                                          | matched                | Headless/data-oriented parity model. `useAgent` delegates subscription, throttle, and subscriber error-guarding to `CopilotKitCore.subscribeToAgentWithOptions` (shared core API) — matching React: `onMessagesChanged` and `onStateChanged` share a single leading+trailing throttle window, and `onRunInitialized` / `onRunFinalized` / `onRunFailed` / `onRunErrorEvent` always fire immediately. |
| `renderToolCalls` / `useRenderToolCall`                                                                                                          | `#tool-call-<toolName>` and `#tool-call` slots                                     | intentional-divergence | Slot translation, behavior parity required.                                                                                                                                                                                                                                                                                                                                                          |
| `renderActivityMessages` / `useRenderActivityMessage`                                                                                            | `#activity-<type>` and `#activity-message` slots                                   | intentional-divergence | Slot translation, behavior parity required.                                                                                                                                                                                                                                                                                                                                                          |
| `renderCustomMessages` / `useRenderCustomMessages`                                                                                               | `#message-before` and `#message-after` slots, plus provider `renderCustomMessages` | intentional-divergence | Slots remain primary; provider registration is the approved secondary parity surface for ordered/agent-scoped custom message renderers.                                                                                                                                                                                                                                                              |
| `useRenderTool`, `useDefaultRenderTool`, `useComponent`                                                                                          | Same-named Vue composables in `src/hooks`                                          | matched                | Secondary programmatic APIs now exist with dedicated parity tests, including SFC/component renderer support and React-matching `toolCallId` threading through render-tool prop unions and `CopilotChatToolCallsView` core render props; slots remain the primary customization surface.                                                                                                              |

### Providers

| React test/feature anchor                              | Vue counterpart                                       | Status  | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ------------------------------------------------------ | ----------------------------------------------------- | ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `CopilotKitProvider.test.tsx`                          | `CopilotKitProvider.test.ts`                          | matched | Core provider behavior.                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `CopilotKitProvider.wildcard.test.tsx`                 | `CopilotKitProvider.wildcard.test.ts`                 | matched | Wildcard behavior parity.                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `CopilotChatConfigurationProvider.test.tsx`            | `CopilotChatConfigurationProvider.test.ts`            | matched | Configuration provider parity.                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `CopilotKitProvider.onError.test.tsx`                  | `CopilotKitProvider.onError.test.ts`                  | matched | Dedicated Vue on-error parity suite.                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `CopilotKitProvider.stability.test.tsx`                | `CopilotKitProvider.stability.test.ts`                | matched | Strict counterpart matches provider stability behavior and runtimeUrl setter timing semantics; Vue remount lifecycle invariants are covered explicitly, while literal React StrictMode remount identity is treated as framework-specific.                                                                                                                                                                                                                            |
| `CopilotKitProvider.renderCustomMessages.e2e.test.tsx` | `CopilotKitProvider.renderCustomMessages.e2e.test.ts` | matched | Dedicated strict counterpart uses provider `renderCustomMessages` with React-matching case names and ordering/scoping semantics, with a trailing Vue-specific slot-precedence check.                                                                                                                                                                                                                                                                                 |
| React `CopilotKitProvider.tsx` `debug` prop            | `CopilotKitProvider.debug.test.ts`                    | matched | Vue `CopilotKitProvider` exposes `debug?: DebugConfig` parity with React. Dedicated Vue suite covers initial constructor threading, runtime `setDebug(...)` sync on prop changes, core-instance stability, clearing behavior, and regression safety for neighboring runtime-config prop sync.                                                                                                                                                                        |
| `CopilotKitProvider.license.test.tsx`                  | `CopilotKitProvider.license.test.ts`                  | matched | Dedicated strict counterpart for the `P1` license-banner parity package. Mirrors React case wording 1:1 across the five server-driven banner states (`none` shows "Powered by CopilotKit", `expired` shows the expired banner, `invalid` shows the invalid banner, `valid` shows no banner, missing `licenseStatus` shows no banner). Vue mocks `globalThis.fetch` via `vi.stubGlobal("fetch", ...)` in lockstep with React's `globalThis.fetch =` assignment style. |

### Chat/component integration

| React test anchor                                                                                  | Vue counterpart                                   | Status  | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| -------------------------------------------------------------------------------------------------- | ------------------------------------------------- | ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `CopilotChat.e2e.test.tsx`                                                                         | `CopilotChat.e2e.test.ts` + `CopilotChat.test.ts` | matched | Full strict counterpart exists with React-matching suite/case wording and now passes on Vue chat-flow boundaries.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `CopilotChatPropsRerender.e2e.test.tsx`                                                            | `CopilotChatPropsRerender.e2e.test.ts`            | matched | Dedicated strict counterpart now covers FOR-75 rerender stability parity through Vue slot analogues (`messageView` + `labels` inline-object regressions) with deterministic render-count assertions.                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `copilot-chat-throttle.test.tsx`                                                                   | `copilot-chat-throttle.test.ts`                   | matched | Dedicated strict counterpart verifies `CopilotChat` throttle forwarding and `CopilotSidebarProps`/`CopilotPopupProps` throttle inheritance parity.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `CopilotChat.attachments.test.tsx`                                                                 | `CopilotChat.attachments.test.ts`                 | matched | Dedicated strict counterpart mirrors React `onUploadFailed` coverage (`invalid-type`, `file-too-large`, `upload-failed`, multi-reject, and valid-file no-failure), validates Vue attachment drop flow through `CopilotChat`, and now asserts stable attachment action identities across input-only rerenders. Attachment public-surface closure is complete via exported `CopilotChatAttachmentQueue` / `CopilotChatAttachmentRenderer` plus `Attachment` / `AttachmentsConfig` / `AttachmentModality` type exports.                                                                                                                                  |
| `CopilotChat.onError.test.tsx`                                                                     | `CopilotChat.onError.test.ts`                     | matched | Dedicated strict counterpart exists with React-matching suite and case wording.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `CopilotChat.slots.e2e.test.tsx`                                                                   | `CopilotChat.slots.e2e.test.ts`                   | matched | Dedicated slot forwarding and override suite.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `CopilotChatActivityRendering.e2e.test.tsx`                                                        | `CopilotChatActivityRendering.e2e.test.ts`        | matched | Suite/case titles and approach now match React, including per-thread clone forwarding to activity renderers (`getThreadClone(...)` parity assertion), both `MockReconnectableAgent` durable-compaction restoration cases (`a2ui-surface` and `open-generative-ui`), and the `IntelligenceAgent /connect` gateway-replay restoration case (`restores a completed A2UI surface from IntelligenceAgent /connect gateway replay`) ported on `N3` with colocated Phoenix mock infrastructure (`MockPhoenixPush` / `MockPhoenixChannel` / `MockPhoenixSocket` / `mockPhoenixSockets` / `triggerJoin` / `serverPush`).                                       |
| `CopilotChatAssistantMessage.slots.e2e.test.tsx`                                                   | `CopilotChatAssistantMessage.slots.e2e.test.ts`   | matched | Dedicated strict slot counterpart now mirrors React section/case structure (`26` cases) using Vue slot translation boundaries.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `CopilotChatAssistantMessage.test.tsx`                                                             | `CopilotChatAssistantMessage.test.ts`             | matched | Dedicated strict counterpart now mirrors the React unit suite structure/case wording (`32` mirrored cases) using Vue slot translation, including a `#layout` counterpart for children-render-prop coverage; Vue-only checks are isolated in a trailing block.                                                                                                                                                                                                                                                                                                                                                                                         |
| `CopilotChatAssistantMessage.thumbs.test.tsx`                                                      | `CopilotChatAssistantMessage.thumbs.test.ts`      | matched | Dedicated strict counterpart for the React `#3457` thumbs callback payload fix. Asserts `@thumbs-up` / `@thumbs-down` emit the full `AssistantMessage` payload (id/role/content) and not an event-shaped object (no `nativeEvent`, `target`, or `currentTarget`).                                                                                                                                                                                                                                                                                                                                                                                     |
| `CopilotChatInput.slots.e2e.test.tsx`                                                              | `CopilotChatInput.slots.e2e.test.ts`              | matched | Dedicated strict slot counterpart now mirrors the full React matrix (`48` cases) with Vue slot-first translation and React-matching section/case wording.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `CopilotChatInput.test.tsx`                                                                        | `CopilotChatInput.test.ts`                        | matched | Dedicated strict counterpart mirrors the React suite/case structure and depth, including slash-command behavior plus the trailing container-dimension cache block (resize invalidation, warm-cache keystrokes, and fallback paths). Now also includes an "IME composition parity" block mirroring the React `#3318` guard (no-submit on Enter during composition, `isComposing: true` suppression, `keyCode === 229` suppression, and `compositionend`-then-submit) and the React `#3593` controlled-input clear-notification regressions that assert `update:modelValue("")` is emitted after button-click and Enter-key submits in controlled mode. |
| `CopilotChatSuggestionView.slots.e2e.test.tsx`                                                     | `CopilotChatSuggestionView.slots.e2e.test.ts`     | matched | Dedicated strict counterpart mirrors the React section/case structure across container/suggestion slots, children-render-function drill-down, and loading-state scenarios using Vue slot translation.                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `CopilotChatToolRendering.e2e.test.tsx`                                                            | `CopilotChatToolRendering.e2e.test.ts`            | matched | Dedicated tool rendering/status suite.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `CopilotChatToolRerenders.e2e.test.tsx`                                                            | `CopilotChatToolRerenders.e2e.test.ts`            | matched | Strict chat-flow parity rewrite is complete and now passes with React-matching rerender-prevention semantics.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `MCPAppsActivityRenderer.e2e.test.tsx`                                                             | `MCPAppsActivityRenderer.e2e.test.ts`             | matched | Strict counterpart now passes with React-matching MCP activity flow coverage (request/loading/error/content and metadata scenarios).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `MCPAppsUiMessage.e2e.test.tsx`                                                                    | `MCPAppsUiMessage.e2e.test.ts`                    | matched | Dedicated strict counterpart now mirrors `ui/message` continuation semantics (`followUp` default/override behavior plus add-message assertions).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `A2UIMessageRenderer.test.tsx`                                                                     | `A2UIMessageRenderer.test.ts`                     | matched | Dedicated strict counterpart mirrors the React A2UI rendering matrix (surface render, same-surface in-place update via `updateComponents` text flip, multi-surface independence) using the real `@copilotkit/a2ui-renderer` bridge, and asserts strict default-loading parity with React's `DefaultA2UILoading` (animated dot + `"Generating UI..."` label + three shimmer bars at 80% / 60% / 40% widths with staggered `cpk-a2ui-pulse` opacity animation and inline `@keyframes`). Custom `loadingComponent` override contract stays unchanged.                                                                                                    |
| `OpenGenerativeUIRenderer.test.tsx`                                                                | `OpenGenerativeUIRenderer.test.ts`                | matched | Dedicated strict counterpart mirrors the full React OpenGenerativeUI matrix — placeholder, final/preview sandbox creation, HTML wrapping/joining, `jsFunctions` and `jsExpressions` execution, recreation on html/function changes, `localApi` handler-identity (e.g. `localApi.addToCart.toBe(handler)`) and multi-handler identity, plus the progressive streaming matrix (chunk-arrival preview, throttled updates, preview→final handoff, `cssComplete` gating, non-meaningful body suppression, fast-path skip).                                                                                                                                 |
| `CopilotChatMessageView.slots.e2e.test.tsx`                                                        | `CopilotChatMessageView.slots.e2e.test.ts`        | matched | Dedicated slot precedence/fallback suite.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `CopilotChatMessageView.test.tsx`                                                                  | `CopilotChatMessageView.test.ts`                  | matched | Dedicated strict counterpart mirrors the React file shape and wording, including activity rendering and duplicate-id deduplication behavior.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `CopilotChatUserMessage.slots.e2e.test.tsx`                                                        | `CopilotChatUserMessage.slots.e2e.test.ts`        | matched | Dedicated strict slot counterpart now mirrors React section/case structure (`26` cases) using Vue slot composition for API-shape differences.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `CopilotChatView.onClick.e2e.test.tsx`                                                             | `CopilotChatView.onClick.e2e.test.ts`             | matched | Dedicated strict counterpart now mirrors React section/case structure and behavior boundaries (`29` cases), translated through Vue slots where API shape differs.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `CopilotChatView.slots.e2e.test.tsx`                                                               | `CopilotChatView.slots.e2e.test.ts`               | matched | Dedicated strict counterpart now mirrors React section/case structure and slot-system matrix (`43` cases), with Vue slot-first translation while preserving behavioral assertions.                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `CopilotChatView.pinToSend.test.tsx`                                                               | `CopilotChatView.pinToSend.test.ts`               | matched | Dedicated strict counterpart for the `pin-to-send` mode parity package (`N2`). Mirrors React case wording 1:1 across `pin-to-send` / `pin-to-bottom` / `none` / boolean back-compat, validating the `data-pin-to-send-spacer` element only renders for `autoScroll === "pin-to-send"`. Trailing Vue-specific block proves `LastUserMessageContext` reactivity (`provide(LastUserMessageKey, ref(...))`) drives `usePinToSend` updates the same way `<Provider value={...}>` rerender does in React.                                                                                                                                                   |
| `CopilotChatView.inputOverlay.test.tsx`                                                            | `CopilotChatView.inputOverlay.test.ts`            | matched | Dedicated strict counterpart for the `N2` input-overlay parity package. Mirrors React case wording 1:1 across overlay positioning, attachment-queue DOM order above the input, welcome-screen exclusion, and the `paddingBottom = inputContainerHeight + 32` formula. Vue swaps a few React-only testids (`copilot-send-button` → `copilot-chat-input-send`, `copilot-attachment-queue` → `copilot-chat-attachment-queue`) where the React testid does not exist on Vue components.                                                                                                                                                                   |
| `normalize-auto-scroll.test.ts`                                                                    | `normalize-auto-scroll.test.ts`                   | matched | Dedicated strict counterpart for the `N2` `AutoScrollMode` helper. Mirrors React case wording 1:1 across all 7 cases (default, boolean back-compat, string passthrough, unknown-string fallback).                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| React `CopilotChatInput.tsx` `bottomAnchored` prop + `CopilotChatView.tsx` main-overlay forwarding | `CopilotChatInput.bottomAnchored.test.ts`         | matched | Dedicated Vue counterpart for the `P1` license-banner offset contract (no React test counterpart exists at this granularity, so the file documents the Vue-side contract directly). Verifies `padding-bottom: var(--copilotkit-license-banner-offset, 0px)` is applied on the `[data-testid="copilot-chat-input-container"]` when `positioning="absolute"`, when `bottomAnchored=true` with `positioning="static"`, and is **not** applied for the welcome-screen static input. Also asserts `CopilotChatView`'s main run-state input forwards `bottomAnchored=true`.                                                                                 |
| React `CopilotChat.tsx` / `CopilotSidebar.tsx` / `CopilotPopup.tsx` inline feature-warning surface | `CopilotChat.licenseWarning.test.ts`              | matched | Dedicated Vue counterpart for the `P1` inline license-warning parity surface. Mirrors React's `InlineFeatureWarning featureName="Chat"` / `"Sidebar"` / `"Popup"` rendering and `console.warn('[CopilotKit] Warning: "<feature>" feature is not licensed. Visit copilotkit.ai/pricing')` semantics. The default permissive `createLicenseContextValue(null)` path renders no warning; an explicit gated `LicenseContextKey` provided **inside** `CopilotKitProvider` (which itself re-`provide`s the permissive default) renders the inline warning + emits the matching console warning.                                                             |
| `CopilotModalHeader.slots.e2e.test.tsx`                                                            | `CopilotModalHeader.slots.e2e.test.ts`            | matched | Dedicated strict counterpart now mirrors React section/case structure (`24` cases) via Vue slot translation, including layout/drill-down and mixed integration scenarios.                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `CopilotPopupView.slots.e2e.test.tsx`                                                              | `CopilotPopupView.slots.e2e.test.ts`              | matched | Dedicated strict counterpart now mirrors the full React section/case structure (`31` cases) across header slots, inherited chat-view slots, popup-specific props, integration, and toggle-button matrix.                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `CopilotSidebarView.slots.e2e.test.tsx`                                                            | `CopilotSidebarView.slots.e2e.test.ts`            | matched | Dedicated strict counterpart now mirrors the full React section/case structure (`25` cases) across header slots, inherited chat-view slots, width/mixed customization, integration, and toggle-button matrix.                                                                                                                                                                                                                                                                                                                                                                                                                                         |

### Hooks and integration depth

| React test anchor                        | Vue counterpart                                                                 | Status  | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ---------------------------------------- | ------------------------------------------------------------------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `use-agent-context.test.tsx`             | `use-agent-context.test.ts`                                                     | matched | Base parity exists.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `use-agent.e2e.test.tsx`                 | `use-agent.e2e.test.ts` (+ `use-agent.test.ts`)                                 | matched | Dedicated strict e2e counterpart exists and passes with React-matching case wording and behavior boundaries.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `use-agent-throttle.test.tsx`            | `use-agent-throttle.test.ts`                                                    | matched | Dedicated strict counterpart now mirrors the full React throttle/scheduling matrix, including unthrottled immediate message updates, state/run-status microtask batching, trailing-edge timing semantics, cleanup cases, and provider `defaultThrottleMs` coverage. Post-shared-core alignment it also covers: `onStateChanged` throttled in the same shared window as `onMessagesChanged`, `OnStateChanged`-only subscriptions firing on the leading edge, invalid `throttleMs` warnings sourced from `CopilotKitCore.subscribeToAgentWithOptions`, and `onRunErrorEvent` bypassing the shared window. |
| `use-agent-context-timing.e2e.test.tsx`  | `use-agent-context-timing.e2e.test.ts`                                          | matched | Dedicated strict counterpart exists and now passes with React-matching follow-up context behavior (`{"spicy":false}` on the second run).                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `use-agent-error-state.test.tsx`         | `use-agent-error-state.test.ts`                                                 | matched | Dedicated strict counterpart now matches React error-state behavior by returning a provisional runtime agent instead of throwing when runtime sync fails.                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `use-agent-stability.test.tsx`           | `use-agent-stability.test.ts`                                                   | matched | Dedicated strict counterpart now matches React provisional-agent caching semantics across Disconnected->Connecting->Connected transitions.                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `use-agent-thread-isolation.test.tsx`    | `use-agent-thread-isolation.test.ts`                                            | matched | Dedicated strict counterpart now mirrors React thread-clone isolation semantics, cache invalidation on registry replacement, and provisional->real clone transitions.                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `use-attachments.test.tsx`               | `use-attachments.test.ts`                                                       | matched | Dedicated strict counterpart validates stable attachment action identities across rerenders/config identity changes, latest-config reads without stale closures, and empty-queue `consumeAttachments()` no-op semantics.                                                                                                                                                                                                                                                                                                                                                                                |
| `use-configure-suggestions.e2e.test.tsx` | `use-configure-suggestions.e2e.test.ts` (+ `use-configure-suggestions.test.ts`) | matched | Dedicated strict e2e counterpart exists and now passes the full React-mirrored suite, including deferred reload behavior during in-progress runs.                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `use-frontend-tool-available.test.tsx`   | `use-frontend-tool-available.test.ts`                                           | matched | Dedicated strict counterpart exists with React-matching suite and case wording.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `use-frontend-tool.e2e.test.tsx`         | `use-frontend-tool.e2e.test.ts` (+ `use-frontend-tool.test.ts`)                 | matched | Dedicated strict e2e counterpart exists and now passes the full React-mirrored suite, including unmount, override, and error-propagation coverage.                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `use-interrupt.test.tsx`                 | `use-interrupt.test.ts`                                                         | matched | Dedicated strict counterpart includes the full React case set and naming, including thenable handler support and latest-interrupt-wins behavior.                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `use-render-tool.test.tsx`               | `use-render-tool.test.ts`                                                       | matched | Dedicated Vue counterpart exists with React-matching suite/case wording and matching Standard Schema/Zod regression coverage via dedicated counterparts.                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `use-default-render-tool.test.tsx`       | `use-default-render-tool.test.ts`                                               | matched | Dedicated Vue counterpart exists with React-matching suite/case wording.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `use-component.test.tsx`                 | `use-component.test.ts`                                                         | matched | Dedicated Vue counterpart exists with React-matching suite/case wording and matching Standard Schema/Zod regression coverage via dedicated counterparts.                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `standard-schema.test.tsx`               | `standard-schema.test.ts`                                                       | matched | Dedicated Vue counterpart exists with React-matching vendor coverage (`zod`, `valibot`, `arktype`) and matching suite/case wording.                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `standard-schema-types.test.tsx`         | `standard-schema-types.test.ts`                                                 | matched | Dedicated Vue counterpart exists with React-matching vendor type-inference coverage and matching suite/case wording.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `zod-regression.test.tsx`                | `zod-regression.test.ts`                                                        | matched | Dedicated Vue counterpart exists with React-matching suite/case wording and coverage boundaries.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `use-human-in-the-loop.e2e.test.tsx`     | `use-human-in-the-loop.e2e.test.ts` (+ `use-human-in-the-loop.test.ts`)         | matched | Dedicated strict e2e counterpart exists and now passes full React-mirrored HITL status, interaction, registration, and reconnection coverage.                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `use-suggestions.e2e.test.tsx`           | `use-suggestions.e2e.test.ts` (+ `use-suggestions.test.ts`)                     | matched | Dedicated strict e2e counterpart exists and passes the full mirrored React case set, including clear/reload/loading transitions.                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `use-threads.test.tsx`                   | `use-threads.test.ts`                                                           | matched | Dedicated strict counterpart preserves the full React case set and wording; Vue now also matches pagination naming (`hasMoreThreads`, `isFetchingMoreThreads`, `fetchMoreThreads`) and filtered public thread shape, with Vue-only reactivity coverage isolated in a trailing `Vue-specific reactive semantics` block.                                                                                                                                                                                                                                                                                  |
| `use-keyboard-height.test.tsx`           | `use-keyboard-height.test.ts`                                                   | matched | Dedicated strict counterpart mirrors the React `useKeyboardHeight` suite (Visual Viewport unavailable, open/close threshold at 150 px, resize + scroll updates, listener cleanup on unmount); Vue returns readonly refs with matching field names instead of a plain state object, and a chat-view-level integration assertion in `CopilotChatView.slots.e2e.test.ts` proves the `translateY(-keyboardHeight)` transform is forwarded through `CopilotChatView`.                                                                                                                                        |
| `use-katex-styles.test.tsx`              | `use-katex-styles.test.ts`                                                      | matched | Dedicated strict counterpart mirrors the React `useKatexStyles` suite (dynamic-import success path, failure path with no throw, regression guard that `CopilotChatAssistantMessage.vue` no longer statically imports `katex/dist/katex.min.css` and now calls `useKatexStyles()`).                                                                                                                                                                                                                                                                                                                      |
| `use-pin-to-send.test.tsx`               | `use-pin-to-send.test.ts`                                                       | matched | Dedicated strict counterpart for the `N2` `usePinToSend` parity package. Mirrors React case wording 1:1 across spacer height math (`viewportHeight - bubbleHeight - topOffset`), `scrollTo` offset (`offsetTop - topOffset`), shrink-only `ResizeObserver` semantics, and rAF cleanup on unmount. Vue uses `provide(LastUserMessageKey, ref(...))` instead of `LastUserMessageContext.Provider`, and reuses the same jsdom rAF + height-mock harness as React.                                                                                                                                          |

## Unmapped React Test Backlog

This backlog captures React tests that are intentionally out of scope or not yet represented by a Vue public surface.
It is no longer a list of open strict-port test failures.

Backlog classification:

- `existing-unmapped`: a Vue test file already exists, but the matrix does not yet audit/map it explicitly.
- `missing-parity`: no Vue counterpart exists at the React test boundary yet.
- `intentional-divergence`: React test targets a render-hook or API pattern that Vue should not port literally.
- `api-gap`: Vue does not yet expose an equivalent package surface, so this is not a pure test-port task.

### Chat and component tests

| React test anchor                | Current Vue state                                                                                     | Classification           | Next action                                                                                                                                                        |
| -------------------------------- | ----------------------------------------------------------------------------------------------------- | ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `CopilotChatCssClasses.test.tsx` | No dedicated Vue counterpart; Vue does not currently preserve React's legacy v1/v2 CSS class contract | `intentional-divergence` | Excluded from current parity scope. Keep Vue focused on behavioral/customization parity unless package-level styling contract parity is later required explicitly. |

### Hook and helper tests

_No currently open hook/helper items — `use-katex-styles` and `use-keyboard-height` are now mapped in the Hooks parity matrix below._
