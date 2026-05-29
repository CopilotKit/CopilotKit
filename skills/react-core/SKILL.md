---
name: react-core
description: >
  @copilotkit/react-core — mount CopilotKitProvider in a Next.js App Router / React Router
  v7 / TanStack Start / SPA app, drop in CopilotChat/CopilotPopup/CopilotSidebar (v2 chat
  components ship from react-core/v2 — NOT react-ui, which is CSS-only in v2), access and
  subscribe to agents with useAgent / useAgentContext / useCapabilities, switch between
  multiple agents, manage durable Intelligence threads with useThreads, register
  browser-side tools via useFrontendTool, render tool calls with useRenderTool /
  useComponent / useDefaultRenderTool, gate execution with useHumanInTheLoop, wire file
  attachments with useAttachments, configure suggestion pills, and register activity- and
  custom-message renderers. publicLicenseKey is canonical (publicApiKey is deprecated
  alias). Load the reference under references/ that matches your task.
type: framework
library: copilotkit
library_version: "1.56.2"
requires:
  - copilotkit/runtime
sources:
  - "CopilotKit/CopilotKit:packages/react-core/src/v2/providers/CopilotKitProvider.tsx"
  - "CopilotKit/CopilotKit:packages/react-core/src/v2/index.ts"
  - "CopilotKit/CopilotKit:packages/react-core/src/v2/components/chat/index.ts"
  - "CopilotKit/CopilotKit:packages/react-core/src/v2/components/chat/CopilotChat.tsx"
  - "CopilotKit/CopilotKit:packages/react-core/src/v2/components/chat/CopilotChatView.tsx"
  - "CopilotKit/CopilotKit:packages/react-core/src/v2/components/CopilotKitInspector.tsx"
  - "CopilotKit/CopilotKit:packages/react-core/src/v2/hooks/use-agent.tsx"
  - "CopilotKit/CopilotKit:packages/react-core/src/v2/hooks/use-agent-context.tsx"
  - "CopilotKit/CopilotKit:packages/react-core/src/v2/hooks/use-capabilities.tsx"
  - "CopilotKit/CopilotKit:packages/react-core/src/v2/hooks/use-threads.tsx"
  - "CopilotKit/CopilotKit:packages/react-core/src/v2/hooks/use-frontend-tool.tsx"
  - "CopilotKit/CopilotKit:packages/react-core/src/v2/hooks/use-render-tool.tsx"
  - "CopilotKit/CopilotKit:packages/react-core/src/v2/hooks/use-render-tool-call.tsx"
  - "CopilotKit/CopilotKit:packages/react-core/src/v2/hooks/use-default-render-tool.tsx"
  - "CopilotKit/CopilotKit:packages/react-core/src/v2/hooks/use-component.tsx"
  - "CopilotKit/CopilotKit:packages/react-core/src/v2/hooks/use-human-in-the-loop.tsx"
  - "CopilotKit/CopilotKit:packages/react-core/src/v2/hooks/use-attachments.tsx"
  - "CopilotKit/CopilotKit:packages/react-core/src/v2/hooks/use-configure-suggestions.tsx"
  - "CopilotKit/CopilotKit:packages/react-core/src/v2/hooks/use-suggestions.tsx"
  - "CopilotKit/CopilotKit:packages/react-core/src/v2/hooks/use-render-activity-message.tsx"
  - "CopilotKit/CopilotKit:packages/react-core/src/v2/hooks/use-render-custom-messages.tsx"
  - "CopilotKit/CopilotKit:packages/react-core/src/v2/lib/slots.tsx"
  - "CopilotKit/CopilotKit:packages/core/src/core/core.ts"
  - "CopilotKit/CopilotKit:packages/core/src/core/agent-registry.ts"
  - "CopilotKit/CopilotKit:packages/core/src/core/run-handler.ts"
  - "CopilotKit/CopilotKit:packages/core/src/types.ts"
---

# CopilotKit React Core

`@copilotkit/react-core` is the React frontend half of CopilotKit: it mounts a provider,
speaks AG-UI over SSE to a runtime (or directly to CopilotKit Cloud in SPA mode), and
exposes hooks for every interaction surface.

This SKILL.md is the **index**. Read the reference under `references/` that matches
your task — do not try to absorb the whole package from this file.

## Mental model — three shells you compose

1. **Provider shell** — `CopilotKitProvider` at or near the root (inside `"use client"` for
   Next.js App Router). Carries `runtimeUrl` (or `publicLicenseKey` for SPA), `headers`,
   `credentials`, `properties`, `onError`, `debug`, `showDevConsole`.
2. **Chat shell** — `CopilotChat` / `CopilotPopup` / `CopilotSidebar` or a composed
   `CopilotChatView` + slot primitives (`CopilotChatInput`, `CopilotChatMessageView`, etc.).
   All chat components ship from `@copilotkit/react-core/v2`. **`CopilotPanel` does not
   exist** — it's a common hallucination.
3. **Hook shell** — inside any component under the provider, call `useAgent`,
   `useFrontendTool`, `useRenderTool`, etc. Every hook takes optional `{ agentId }` for
   agent-scoped registration.

## When to load which reference

| Task                                                                                                      | Reference                                                                               |
| --------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| Mount `CopilotKitProvider`, pick `runtimeUrl` vs `publicLicenseKey`, RSC boundary rules                   | `references/provider-setup.md`                                                          |
| Drop in `CopilotChat` / `CopilotPopup` / `CopilotSidebar`, compose `CopilotChatView` with slot primitives | `references/chat-components.md`                                                         |
| File / image attachments via `useAttachments` — drag-drop, click, paste, custom upload                    | `references/attachments.md`                                                             |
| Client-side debug tooling — `showDevConsole`, `debug` prop, lazy-loaded web inspector                     | `references/debug-mode.md`                                                              |
| Read / subscribe to an agent (`useAgent`) and push global context (`useAgentContext`)                     | `references/agent-access.md`                                                            |
| Feature-gate UI on declared agent capabilities (`useCapabilities`)                                        | `references/capabilities.md`                                                            |
| Build a multi-agent UI (per-panel `useAgent`, agent-scoped tools, key-remount pattern)                    | `references/switching-agents.md` (+ `switching-agents-recipes.md` for concrete layouts) |
| List / rename / archive / delete durable Intelligence threads (`useThreads`)                              | `references/threads.md` (**requires runtime Intelligence mode**)                        |
| Register browser-side tools (`useFrontendTool`)                                                           | `references/client-side-tools.md`                                                       |
| Render per-tool UI (`useRenderTool`, `useComponent`, `useDefaultRenderTool`, `useRenderToolCall`)         | `references/rendering-tool-calls.md`                                                    |
| Gate tool execution behind user approval (`useHumanInTheLoop`)                                            | `references/human-in-the-loop.md`                                                       |
| Configure dynamic or static suggestion pills (`useConfigureSuggestions`, `useSuggestions`)                | `references/suggestions.md`                                                             |
| Render non-chat activity messages (`useRenderActivityMessage`)                                            | `references/rendering-activity-messages.md`                                             |
| Inject custom UI before/after specific messages (`useRenderCustomMessages`)                               | `references/custom-message-renderers.md`                                                |

## Invariants and gotchas (load-once, before any reference)

- `publicLicenseKey` is canonical. `publicApiKey` is a **deprecated alias** — expect it in legacy code.
- `agents__unsafe_dev_only` and `selfManagedAgents` are dev-only aliases of each other. **Not production-safe.** See `packages/a2ui-renderer` or the `spa-without-runtime` lifecycle skill for the supported SPA path.
- `CopilotPanel` does not exist. v2 chat components ship from `react-core/v2` — **not** `react-ui` (v2 `react-ui` is CSS-only).
- No `useAgents()` hook exists. Discover agents via `copilotkit.subscribe({ onAgentsChanged })`.
- `useRenderToolCall` is a **resolver** (for custom chat surfaces), **not** a registration hook. Register with `useRenderTool` / `useComponent` / `useDefaultRenderTool`.
- UI-kit detection rule — any `render` or tool-call UI MUST reuse the consumer's shadcn / MUI / Chakra / Ant / Mantine primitives before writing raw JSX. This applies across `client-side-tools`, `rendering-tool-calls`, and `human-in-the-loop`.
- Tool-call `status` values are camelCase: `'inProgress' | 'executing' | 'complete'`. In-progress args are `Partial<T>`.
- `useHumanInTheLoop` synthesized handler **MUST** call `respond(result)` (including reject paths), otherwise the agent run hangs. `respond` is `undefined` outside `Executing` status. Unmounting mid-Executing abandons the run.
- `useThreads` errors with `'Runtime URL is not configured'` outside Intelligence mode.
- `v1 → v2` migration renames: `useCopilotAction` → `useFrontendTool` + `useHumanInTheLoop`; `imageUploadsEnabled` → `attachments`. See the `v1-to-v2-migration` lifecycle skill.

## Reading order for a first-time reader

1. `provider-setup` — mount the provider.
2. `chat-components` — wire a chat surface.
3. `agent-access` — talk to agents.
4. `client-side-tools` + `rendering-tool-calls` — add tool-call UI.
5. Anything else as your feature requires.
