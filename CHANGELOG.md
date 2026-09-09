# Changelog — monorepo lane

Every `@copilotkit/*` package listed under `scopes.monorepo` in
`release.config.json`. They share one version.

`release / create-pr` prepends a section here for each release, and
`release / publish` reads the newest section back as the GitHub Release body.
To change what ships, edit the section on the release PR branch before merging.

The other release lanes keep their own file:
[`packages/angular/CHANGELOG.md`](packages/angular/CHANGELOG.md) and
[`packages/channels/CHANGELOG.md`](packages/channels/CHANGELOG.md).

Entries begin with the first release cut after this file was added. Earlier
releases have no changelog: the per-package files from the changesets era stopped
at `1.55.2` while the lane shipped `1.69.3`, and they are recoverable from git
history (for example `git show v1.69.3:packages/core/CHANGELOG.md`).

## 1.71.0 - 2026-09-09

This release converges React Native's render-tool hooks onto react-core, improves Copilot context timing during page navigation, and adds provider-level agent configuration. It also includes fixes for nullable tool schemas, the Vue human-in-the-loop lifecycle, and the Inspector experience.

## Breaking Changes

### `@copilotkit/react-native`: render-tool hooks converged onto react-core (#6533)

React Native's `useRenderTool` was previously an alias that forwarded to `useFrontendTool`, which caused a range of subtle bugs — most notably, a wildcard renderer (`name: "*"`) registered a frontend tool literally named `*` rather than a display-only fallback. This release removes React Native's own implementation and re-exports core's two distinct hooks, so each capability has exactly one implementation — and `"*"` works as a real wildcard on React Native for the first time.

**What's removed:** `RenderToolProps`, `RenderToolFunction`, and `UseRenderToolOptions` are gone from `@copilotkit/react-native`. `useRenderTool` still exists this release as a **deprecated shim** that routes by call shape and warns in development (once per tool name); it is scheduled for removal in the next minor.

**Migration:**

| Before                                                                    | After                                                                                                    |
| ------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `useRenderTool({ name, description, parameters, handler, render }, deps)` | `useFrontendTool({ …identical object }, deps)` — the shim keeps this working with a warning this release |
| renderer-only registration (previously impossible)                        | `useRenderTool({ name, parameters, render, agentId? }, deps)`                                            |
| wildcard registered a tool named `*`                                      | `useRenderTool({ name: "*", render })` — now works like the web                                          |
| render props `{ args, status, … }`                                        | `{ parameters, status, … }` — **not** covered by the shim; the render body still needs the rename        |
| `RenderToolProps<T>` (args-shaped)                                        | `RenderToolProps<S>` (parameters-shaped, generic over schema)                                            |
| bare `RenderToolProps`                                                    | now requires the schema type argument (`TS2314`)                                                         |
| `UseRenderToolOptions<T>`                                                 | gone — write the config inline                                                                           |
| `RenderToolFunction<T>`                                                   | gone — use the opt-in `FrontendToolRenderFunction<T>` from `/headless` to narrow renderer return types   |

Note that some call shapes (hoisted configs, spread props, and untyped/`@ts-nocheck` call sites) will not be caught by the compiler — the shim's development warning is the only signal for those, so audit them by hand. `status` also moves from the `ToolCallStatus` enum to core's string-literal union; this is not a break, as enum members remain assignable to their own literal types.

## Features

- **`@copilotkit/react-core`: provider-level agent selection** (#6892). You can now set a default agent directly on `CopilotKitProvider` via the `agentId` prop, rather than only on `<CopilotChat>` or the v1 compatibility component. It acts as the last fallback before the default agent and is consulted by `CopilotChat`, `CopilotThreadsDrawer`, `useAgent`, `useSuggestions`, and nested chat configuration — an explicit `agentId` still wins everywhere. Sibling chats keep their own thread identities.
- **`@copilotkit/react-core`: renderers can return `null`** (#6533). Tool-call renderers may now return `null` to intentionally suppress UI, via widened return types on `useRenderTool` and `defineToolCallRenderer`. This reaches React Native consumers as well.
- **`@copilotkit/web-inspector`: escape actions for Learning setup** (#6995). The Learning onboarding flow is now reversible: a "Go back" action returns to the overview, and you can re-copy the setup prompt without leaving the flow, with copy confirmation, automatic reset, and failure feedback.

## Fixes

- **`@copilotkit/react-core`: v1 readables register before sibling effects run** (#6968). `useCopilotReadable` now registers in a layout effect instead of a passive effect, so an earlier-mounted consumer (such as a chat's connect request) no longer runs against an empty context store during page transitions.
- **`@copilotkit/runtime`: accept nullable frontend tool schemas** (#6958). Nullable tool fields that reach the built-in agent as `anyOf: [{type: "string"}, {type: "null"}]` no longer throw `Invalid JSON schema`. Required nullable fields still require a value; optional fields can be omitted; invalid non-null values still fail validation. Covers nullable unions, arrays, and Zod-generated fields.
- **`@copilotkit/vue`: human-in-the-loop lifecycle aligned with React** (#5965). `useHumanInTheLoop` now honors its `AbortSignal` (rejecting aborted or in-flight interactions with an explicit abort error instead of hanging), exposes the full render contract including `toolCallId` and static `agentId`, routes statuses through an exhaustive check, and preserves exact scoped-renderer cleanup on scope disposal.
- **`@copilotkit/react-core`: improve Inspector message shortcuts** (#6974). Message shortcuts now stay in sync with Inspector visibility. Adds a wrench shortcut with a hover menu and a hide-until-reload action, adds `CopilotChat.inspectorTools` (with provider settings taking precedence), and restricts the Inspector to local development.
- **Release notes now actually ship** (#6830). GitHub Release bodies were falling back to a bare `Release <tag>` because the generated notes were gitignored and never reached the release branch. Release notes are now recorded in a source-controlled `CHANGELOG.md` per release lane, scoped to the packages in each lane, and read back as the release body. (This is the machinery producing these very notes.)
