# CopilotKit v1 → v2 Rename Table

Canonical mapping of every v1 public API / prop / import to its v2
counterpart. Use this as the source of truth during migration. Packages
themselves do NOT rename — v2 lives at the `/v2` subpath of the same
packages.

## Columns

- **v1 API** — name as it appears in v1 code.
- **v2 API** — canonical v2 replacement name.
- **Package subpath** — the exact import path in v2.
- **Breaking?** — yes/no — whether the rename has semantic changes
  beyond name, or is safe for mechanical find/replace.

## Full Table

| #   | v1 API                                                          | v2 API                                                                                                      | Package subpath                                          | Breaking?                                                                                                                                                                                                                               |
| --- | --------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `CopilotKit` (provider component)                               | `CopilotKitProvider`                                                                                        | `@copilotkit/react-core/v2`                              | No — rename only                                                                                                                                                                                                                        |
| 2   | `useCopilotAction` (handler-only)                               | `useFrontendTool`                                                                                           | `@copilotkit/react-core/v2`                              | Yes — parameters now Standard Schema (zod) instead of array                                                                                                                                                                             |
| 3   | `useCopilotAction` (render-only / approval)                     | `useHumanInTheLoop`                                                                                         | `@copilotkit/react-core/v2`                              | Yes — `respond(result)` replaces `handler(args)`; status is camelCase                                                                                                                                                                   |
| 4   | `useCopilotAction` (handler + render)                           | `useFrontendTool` + `useHumanInTheLoop`                                                                     | `@copilotkit/react-core/v2`                              | Yes — split into TWO hooks, judgment required                                                                                                                                                                                           |
| 5   | `useCoAgent`                                                    | `useAgent`                                                                                                  | `@copilotkit/react-core/v2`                              | Yes — return shape: `{ agent }` (with `.state`, `.isRunning`, `.setState()` on the agent instance) replaces `{ state, setState, running }`                                                                                              |
| 6   | `useCopilotReadable`                                            | `useAgentContext`                                                                                           | `@copilotkit/react-core/v2`                              | Yes — only `{ description, value }` remain; `parentId`, `categories`, `available`, `convert` are removed and the hook no longer returns a context id. Context is global by design — per-agent scoping is not supported; see note below. |
| 7   | `useCopilotChatSuggestions`                                     | `useConfigureSuggestions` + `useSuggestions`                                                                | `@copilotkit/react-core/v2`                              | Yes — split into configure + read hooks                                                                                                                                                                                                 |
| 8   | `CopilotKitErrorCode` enum (SCREAMING_SNAKE)                    | `CopilotKitCoreErrorCode` enum (snake_case values)                                                          | `@copilotkit/react-core/v2`                              | Yes — string values change; equality checks break                                                                                                                                                                                       |
| 9   | `CopilotKit.publicApiKey` prop                                  | `CopilotKitProvider.publicApiKey` (canonical) — `publicLicenseKey` accepted as alias                        | provider prop                                            | No — keep `publicApiKey`; it is the canonical v2 name. Resolution is `publicApiKey ?? publicLicenseKey` in the provider source.                                                                                                         |
| 10  | `CopilotChat.imageUploadsEnabled` prop                          | `CopilotChat.attachments={{ enabled: true }}`                                                               | `<CopilotChat>` prop                                     | Yes — covers broader attachment types (files, paste, drag)                                                                                                                                                                              |
| 11  | `CopilotPopup`, `CopilotSidebar`, `CopilotChat`                 | same names                                                                                                  | `@copilotkit/react-core/v2` (was `@copilotkit/react-ui`) | Yes — package relocation; `react-ui` v2 is CSS-only                                                                                                                                                                                     |
| 12  | `@copilotkit/react-ui/styles.css`                               | `@copilotkit/react-core/v2/styles.css`                                                                      | stylesheet import                                        | Yes — path move                                                                                                                                                                                                                         |
| 13  | `copilotRuntimeNextJSAppRouterEndpoint`                         | `createCopilotRuntimeHandler` (fetch)                                                                       | `@copilotkit/runtime/v2`                                 | Yes — shape change; returns a `(req: Request) => Promise<Response>`                                                                                                                                                                     |
| 14  | `copilotRuntimeNodeHttpEndpoint`                                | `createCopilotNodeHandler(createCopilotRuntimeHandler(...))`                                                | `@copilotkit/runtime/v2/node`                            | Yes — now a composition of fetch handler + node adapter                                                                                                                                                                                 |
| 15  | `CopilotRuntime({ actions, agents })` (v1)                      | `CopilotRuntime({ agents, runner?, a2ui?, hooks? })`                                                        | `@copilotkit/runtime/v2`                                 | Yes — `actions` (server-side) is replaced by `BuiltInAgent.config.tools`; multi-agent is first class                                                                                                                                    |
| 16  | `createCopilotEndpoint*` aliases                                | `createCopilotRuntimeHandler`                                                                               | `@copilotkit/runtime/v2`                                 | No — aliases still accepted but new code uses the canonical name                                                                                                                                                                        |
| 17  | Service adapters (`OpenAIAdapter`, `AnthropicAdapter`, etc.)    | `BuiltInAgent` Simple Mode (`{ model: "openai/gpt-4o" }`) OR Factory Mode (`{ type: "tanstack", factory }`) | `@copilotkit/runtime/v2`                                 | Yes — adapters removed; agents own the model                                                                                                                                                                                            |
| 18  | `AbstractAgent` / `HttpAgent` type imports from `@ag-ui/client` | same names from `@copilotkit/react-core/v2`                                                                 | `@copilotkit/react-core/v2`                              | No — re-exported; dependency trim                                                                                                                                                                                                       |
| 19  | `<CopilotKit runtimeUrl=... />`                                 | `<CopilotKitProvider runtimeUrl=... />`                                                                     | provider                                                 | No — attribute stays identical                                                                                                                                                                                                          |
| 20  | `onError={ (e) => ... }` on `CopilotKit`                        | `onError={ ({ error, code, context }) => ... }` on `CopilotKitProvider`                                     | provider prop                                            | Yes — event shape changes; code field is new                                                                                                                                                                                            |
| 21  | `debug={true}` on `CopilotKit`                                  | `debug={{ events?, lifecycle?, verbose? }}` or `true` on `CopilotKitProvider`                               | provider prop                                            | Yes — object shape; boolean is shorthand for `{ events:true, lifecycle:true }`                                                                                                                                                          |
| 22  | `agents__unsafe_dev_only`, `selfManagedAgents`                  | (no v2 production replacement — use Cloud `publicApiKey` or backend runtime)                                | provider props (dev-only)                                | Yes — props exist but ONLY for local dev; production path is Cloud or runtime                                                                                                                                                           |

## Per-agent context is NOT supported in v2 (row 6 note)

v1 `useCopilotReadable` did not accept an `agentId` param either, but a
common pattern was to gate the value's computation on the active agent.
In v2, `useAgentContext` registers context globally via
`copilotkit.addContext({ description, value })` — there is no `agentId`
field on the call. The underlying store at
`packages/core/src/core/context-store.ts:26-31` accepts only
`{ description, value }` and silently drops any extra fields. If you
need per-agent scoping, the options are:

- Register distinct tools per `agentId` (via `useFrontendTool`) and
  embed the agent-specific detail in the tool surface.
- Wrap the `value` computation in `useMemo` gated on the active
  `agentId` so the single `useAgentContext` reflects the right agent.
- Bake the per-agent detail into the agent's system prompt on the
  server side.

Do NOT rely on a `copilotkit.addContext({ agentId })` escape hatch —
the field is dropped. Track support for native per-agent context in
the CopilotKit issue tracker if you need it.

## Scope Trap

Only `@copilotkitnext/angular` uses the `@copilotkitnext` scope. Every
other CopilotKit package stays at `@copilotkit/`. Agents hallucinating
`@copilotkitnext/react-core`, `@copilotkitnext/runtime`, etc. is the
single most-common v2 migration error.

## Safety

Rows marked "Breaking? No" are safe for mechanical find/replace. Rows
marked "Breaking? Yes" require at least a read of the surrounding code —
the splits (row 4) and the error-code equality checks (row 8) always
require judgment. Use `references/migration-playbook.md` for the ordered
phase recipe.
