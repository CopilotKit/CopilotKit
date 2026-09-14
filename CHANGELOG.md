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

## 1.71.1 - 2026-09-11

This release focuses on runtime MCP fixes, React hook performance, and improvements to the Inspector's onboarding experience.

## Fixes

### Runtime

- **MCP SSE headers now reach the wire** (#6930): v2 MCP `sse` servers accepted a `headers` auth map (for example, `Authorization: Bearer …`), but those headers were never sent, causing auth-required servers to 401 and drop their tools from the run. Headers are now passed via `requestInit`. No public type change.
- **Removed a duplicate `@ag-ui/client` install** (#7095): `@copilotkit/runtime` bundled `@ag-ui/mcp-middleware@0.0.1`, which pinned `@ag-ui/client` as an exact dependency and nested a second copy alongside the one consumers already had. Because `@ag-ui/client` carries types, the duplicate produced confusing type errors (for example, a mismatch naming a private `_debug` property) for anyone also depending on `@ag-ui/client`. Bumping to `0.0.2` moves the client to a peer dependency, so it resolves to the host's copy.

### React Core

- **Stopped unnecessary `useInterrupt` re-renders** (#6969): `useInterrupt` receives interrupt events through its own agent subscription, but was still re-rendering on every message, state, and run-status update. It now skips that update subscription entirely.

### Web Inspector

- **Unified locked Threads onboarding** (#7094): Threads availability is now gated on the Runtime Threads capability rather than license metadata, so every locked state shows the same Rich Threads setup guidance (product header, Copy setup prompt, Talk to an Engineer CTA, and video). Empty Threads views no longer display local example threads.
- **Learning setup prompt now targets Learning** (#7037): The Learning pane's "Copy setup prompt" button previously copied a Threads prompt (`--intent add-rich-threads`) and announced "Threads setup prompt copied." It now correctly targets Learning (`--intent add-learning`), including the accessible label. Learning does not require the Threads feature.
- **Hide enabled features from the launcher HUD** (#7075): The launcher heads-up display no longer shows Rich Threads or Automatic Learning once they're enabled. When only the dismiss action remains, the HUD collapses to a compact, centered state with no pointer.

## Improvements

### Web Inspector

- **Shorter copied onboarding prompt** (#7030): The prompt copied from the Inspector and feature cards now opens with a single command — `npx --yes copilotkit@latest onboard start --run <run-id>` — instead of two sentences of coding-agent identification. Identification moves into the prompt graph. The old wording still works against the published CLI.
- **Feature buttons point at CLI intent routes** (#7004): The Inspector's seven per-feature "Copy setup prompt" buttons now emit `onboard start … --intent <slug>`, targeting the CLI's feature routes instead of duplicating setup prose in the Inspector. Each tile maps to exactly one intent, enforced by the type system and a test.

### Skills

- **Consolidated packaged skills** (#7029): The nine packaged knowledge skills have been replaced with two entry points (`copilotkit` and `copilotkit-cli`) that look answers up rather than restating a stale copy of the documentation. As part of this, the `skills` directory is no longer included in the published tarballs for `@copilotkit/react-core`, `@copilotkit/runtime`, and `@copilotkit/a2ui-renderer`.
- **Audited react-core skill claims** (#6997): Corrected several stale or incorrect citations and stopped documenting Cloud keys (`publicApiKey` / `publicLicenseKey`) as the path to CopilotKit Intelligence, which is configured server-side on the runtime.

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
