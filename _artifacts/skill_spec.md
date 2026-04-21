# CopilotKit — Skill Spec

CopilotKit is a full-stack SDK for building agent-native applications. It connects React (or Angular/Vanilla) frontends to any AI agent framework — LangGraph, CrewAI, Mastra, PydanticAI, Google ADK, LlamaIndex, Agno, AWS Strands, Microsoft Agent Framework, A2A, MCP Apps, or a built-in agent with Vercel AI SDK / TanStack AI / custom factories — over the AG-UI event protocol (SSE by default, websocket in Intelligence mode).

**Pilot scope:** `@copilotkit/runtime`, `@copilotkit/react-core`, `@copilotkit/a2ui-renderer`. `@copilotkit/react-ui` dropped from the v2 pilot (its v2 subpath is CSS-only; all v2 chat components ship from `@copilotkit/react-core/v2`).

**Baseline reference:** `_baseline-skills/` contains the previous skill set, preserved for naming/tone reference. Several baseline claims turned out to be wrong against current v2 — notably `@copilotkit/react` and `@copilotkit/agent` as distinct packages (they don't exist — v2 is a `/v2` subpath on existing packages).

## Domains

| Domain                 | Description                                                          | Skills                                                                                                                                 |
| ---------------------- | -------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `client-integration`   | Provider setup, chat UI, attachments, debug tooling                  | `provider-setup`, `chat-components`, `attachments`, `debug-mode`                                                                       |
| `agent-interaction`    | Accessing agents, capabilities, switching agents, threads            | `agent-access`, `capabilities`, `switching-agents`, `threads`                                                                          |
| `tool-calling`         | Client and server tools, rendering tool calls, HITL                  | `client-side-tools`, `rendering-tool-calls`, `human-in-the-loop`, `server-side-tools`                                                  |
| `runtime-setup`        | Endpoint factories, middleware, runners, transcription, Intelligence | `setup-endpoint`, `middleware`, `agent-runners`, `intelligence-mode`, `transcription`                                                  |
| `agent-implementation` | BuiltInAgent and external framework wiring                           | `built-in-agent`, `wiring-external-agents`                                                                                             |
| `generative-ui`        | Suggestions, activity messages, custom message renderers, A2UI       | `suggestions`, `rendering-activity-messages`, `custom-message-renderers`, `a2ui-rendering`                                             |
| `journeys`             | Cross-cutting lifecycle paths                                        | `0-to-working-chat`, `spa-without-runtime`, `go-to-production`, `scale-to-multi-agent`, `v1-to-v2-migration`, `debug-and-troubleshoot` |

## Skill Inventory

| Skill                         | Type      | Domain               | Covers                                                                                                                                                                                    | Failure modes |
| ----------------------------- | --------- | -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------- |
| `provider-setup`              | core      | client-integration   | CopilotKitProvider, runtimeUrl/headers/credentials/properties, onError, showDevConsole, RSC boundary (agents\_\_unsafe_dev_only + selfManagedAgents are excluded — both dev-only aliases) | 5             |
| `chat-components`             | core      | client-integration   | CopilotChat/Popup/Sidebar, CopilotChatView slots, primitives                                                                                                                              | 4             |
| `attachments`                 | core      | client-integration   | useAttachments — drag/drop/paste, 20MB default, onUpload callback, consumeAttachments drain                                                                                               | 5             |
| `debug-mode`                  | core      | client-integration   | showDevConsole, debug prop, web-inspector lazy mount                                                                                                                                      | 3             |
| `agent-access`                | core      | agent-interaction    | useAgent, subscribers, per-thread clones, agent.addMessage/setState/abortRun + useAgentContext JSON-serializable shared state                                                             | 7             |
| `capabilities`                | core      | agent-interaction    | useCapabilities — AgentCapabilities from /info handshake, undefined until connected                                                                                                       | 3             |
| `switching-agents`            | core      | agent-interaction    | useAgent per panel, agentId-scoped tools/renderers, key-remount pattern                                                                                                                   | 3             |
| `threads`                     | core      | agent-interaction    | useThreads — Intelligence-mode only, list/rename/archive/delete                                                                                                                           | 3             |
| `client-side-tools`           | core      | tool-calling         | useFrontendTool, handler signal, StandardSchemaV1, UI-kit detection rule                                                                                                                  | 5             |
| `rendering-tool-calls`        | core      | tool-calling         | useRenderToolCall, useComponent, status lifecycle, Partial<T> args                                                                                                                        | 4             |
| `human-in-the-loop`           | core      | tool-calling         | useHumanInTheLoop, respond only during Executing, unmount risk                                                                                                                            | 4             |
| `server-side-tools`           | core      | tool-calling         | defineTool on BuiltInAgent, server-vs-client tradeoff                                                                                                                                     | 4             |
| `setup-endpoint`              | framework | runtime-setup        | Fetch-based primitive, Express/Hono/Node adapters, any JS runtime, multi-route vs single-route                                                                                            | 5             |
| `middleware`                  | core      | runtime-setup        | Legacy middleware + newer hooks, throw Response, non-blocking afterRequest                                                                                                                | 5             |
| `agent-runners`               | core      | runtime-setup        | InMemory/SQLite/Intelligence/custom, thread lock, 3 subsystems                                                                                                                            | 5             |
| `intelligence-mode`           | core      | runtime-setup        | CopilotKitIntelligence, identifyUser, durable threads, ws transport                                                                                                                       | 5             |
| `transcription`               | core      | runtime-setup        | TranscriptionService, /transcribe, MIME whitelist, auto-categorization                                                                                                                    | 4             |
| `built-in-agent`              | core      | agent-implementation | BuiltInAgent, classic + 3 factory modes, model resolution, maxSteps                                                                                                                       | 6             |
| `wiring-external-agents`      | framework | agent-implementation | 12 framework subsystems + MCP-Apps-as-middleware callout                                                                                                                                  | 5             |
| `suggestions`                 | core      | generative-ui        | useConfigureSuggestions, useSuggestions, availability windows                                                                                                                             | 3             |
| `rendering-activity-messages` | core      | generative-ui        | useRenderActivityMessage, schema safeParse, built-in override                                                                                                                             | 2             |
| `custom-message-renderers`    | core      | generative-ui        | useRenderCustomMessages, first-non-null-wins, stateSnapshot                                                                                                                               | 2             |
| `a2ui-rendering`              | core      | generative-ui        | Provider a2ui prop, runtime a2ui config, auto-detection via /info                                                                                                                         | 4             |
| `0-to-working-chat`           | lifecycle | journeys             | Scaffold + React Router v7 / TanStack Start / Next.js / SPA paths                                                                                                                         | 5             |
| `spa-without-runtime`         | lifecycle | journeys             | publicLicenseKey (CopilotKit Cloud) — the only production-safe SPA path                                                                                                                   | 4             |
| `go-to-production`            | lifecycle | journeys             | Pointer checklist — persistent runner, CORS, debug off, credentials, license                                                                                                              | 5             |
| `scale-to-multi-agent`        | lifecycle | journeys             | Single → multi-agent with thread switching and agent-scoped tools                                                                                                                         | 4             |
| `v1-to-v2-migration`          | lifecycle | journeys             | Rename table, import-path migration, error-code reshape, attachments                                                                                                                      | 8             |
| `debug-and-troubleshoot`      | lifecycle | journeys             | Error code catalogs, debug prop, event tracing, onError wiring                                                                                                                            | 5             |

**Totals:** 29 skills, 139 failure modes with wrong/correct code pairs, 15 resolved gaps (0 open), 6 tensions, 8 cross-references, 15 subsystems (across `wiring-external-agents` and `agent-runners`), 6 reference-file candidates, 1 deferred skill (`useInterrupt`).

## Tensions

| Tension                                        | Skills                                                                         | Agent implication                                                                                          |
| ---------------------------------------------- | ------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------- |
| Quickstart simplicity vs production durability | `0-to-working-chat` ↔ `agent-runners` ↔ `go-to-production`                     | Agents copy the default InMemory runner into prod; quickstart must surface SQLite/Intelligence early       |
| SPA convenience vs secret exposure             | `spa-without-runtime` ↔ `go-to-production` ↔ `provider-setup`                  | Agents reach for `agents__unsafe_dev_only` and leak keys; skills must route to HttpAgent + authed endpoint |
| Legacy middleware vs newer hooks               | `middleware` ↔ `setup-endpoint`                                                | Both coexist; agents mix them inconsistently. Hooks are preferred for route-aware work                     |
| Tool-typing precision vs wildcard flexibility  | `rendering-tool-calls` ↔ `client-side-tools`                                   | Agents default to `"*"` z.any() renderers everywhere, losing type safety                                   |
| v1/v2 subpath confusion                        | `v1-to-v2-migration` ↔ `provider-setup` ↔ `setup-endpoint` ↔ `chat-components` | Same package, two surfaces. Every import must specify `/v2`                                                |

## Cross-References

| From                   | To                            | Reason                                                           |
| ---------------------- | ----------------------------- | ---------------------------------------------------------------- |
| `0-to-working-chat`    | `debug-and-troubleshoot`      | Quickstart errors → troubleshooting path                         |
| `intelligence-mode`    | `threads`                     | useThreads only works in Intelligence mode                       |
| `intelligence-mode`    | `agent-runners`               | Intelligence forces IntelligenceAgentRunner                      |
| `middleware`           | `go-to-production`            | Auth/rate-limit wired via middleware, surfaced in prod checklist |
| `a2ui-rendering`       | `rendering-activity-messages` | A2UI is an activity-message renderer under the hood              |
| `human-in-the-loop`    | `client-side-tools`           | HITL is a frontend tool without a handler                        |
| `switching-agents`     | `threads`                     | Thread + agent switching usually pair                            |
| `scale-to-multi-agent` | `agent-runners`               | Horizontal scaling + in-memory runner footgun                    |
| `chat-components`      | `agent-access`                | CopilotChat internally calls useAgent                            |
| Every frontend skill   | `provider-setup`              | Provider is required by every client-side hook                   |

## Subsystems & Reference Candidates

| Skill                    | Subsystems                                                                                                                                                                   | Reference candidates                                                                                                   |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `wiring-external-agents` | Mastra, LangGraph, CrewAI Crews, CrewAI Flows, PydanticAI, Google ADK, LlamaIndex, Agno, AWS Strands, Microsoft Agent Framework, AG2, A2A (+ MCP Apps as runtime middleware) | Per-framework quickstart reference (12)                                                                                |
| `agent-runners`          | InMemoryAgentRunner, SqliteAgentRunner, IntelligenceAgentRunner                                                                                                              | —                                                                                                                      |
| `built-in-agent`         | —                                                                                                                                                                            | Model identifier table (40+); 3 factory type signatures                                                                |
| `v1-to-v2-migration`     | —                                                                                                                                                                            | Complete rename table (17+ rows)                                                                                       |
| `debug-and-troubleshoot` | —                                                                                                                                                                            | Error code catalog (CopilotKitCoreErrorCode ×15+, TranscriptionErrorCode ×9, legacy CopilotKitErrorCode for v1 compat) |

## Remaining Gaps

| Skill                    | Question                                                                   | Status |
| ------------------------ | -------------------------------------------------------------------------- | ------ |
| `chat-components`        | Is `CopilotPanel` baseline hallucination or upcoming/deprecated?           | open   |
| `client-side-tools`      | Exact contract of `followUp: boolean`                                      | open   |
| `rendering-tool-calls`   | Is `z.any()` on `"*"` wildcard renderers the intended public contract?     | open   |
| `provider-setup`         | `publicLicenseKey` vs `publicApiKey` — canonical name?                     | open   |
| `debug-mode`             | Full `DebugConfig` field set                                               | open   |
| `agent-access`           | Intended agent-scoped context hook, or `copilotkit.addContext` workaround? | open   |
| `wiring-external-agents` | AG2 — HttpAgent the intended path given no dedicated package?              | open   |
| `wiring-external-agents` | TanStack AI factory — documented anywhere or net-new?                      | open   |
| `intelligence-mode`      | Public spec for self-hosting Intelligence backend?                         | open   |
| `middleware`             | Webhook-URL middleware — planned or dead code?                             | open   |
| `v1-to-v2-migration`     | Official codemod or is the skill the authoritative tool?                   | open   |
| `0-to-working-chat`      | Canonical TanStack Start example in-tree?                                  | open   |
| `scale-to-multi-agent`   | Intended `CopilotAgentSwitcher` component?                                 | open   |
| `suggestions`            | Per-suggestion loading indices via `useSuggestions`?                       | open   |
| `transcription`          | In-tree `OpenAITranscription` class or always DIY?                         | open   |

15 open gaps; all feed into Phase 4 interview questions.

## Recommended Skill File Structure

Per Intent monorepo convention (`packages/<pkg>/skills/<domain>/<skill>/SKILL.md`):

- **`packages/runtime/skills/`** (8 skills)
  - `runtime-setup/setup-endpoint/`, `.../middleware/`, `.../agent-runners/`, `.../intelligence-mode/`, `.../transcription/`
  - `agent-implementation/built-in-agent/`, `.../wiring-external-agents/` (with 12 subsystem reference files)
  - `tool-calling/server-side-tools/`

- **`packages/react-core/skills/`** (15 skills)
  - `client-integration/provider-setup/`, `.../chat-components/`, `.../attachments/`, `.../debug-mode/`
  - `agent-interaction/agent-access/`, `.../capabilities/`, `.../switching-agents/`, `.../threads/`
  - `tool-calling/client-side-tools/`, `.../rendering-tool-calls/`, `.../human-in-the-loop/`
  - `generative-ui/suggestions/`, `.../rendering-activity-messages/`, `.../custom-message-renderers/`

- **`packages/a2ui-renderer/skills/`** (1 skill)
  - `generative-ui/a2ui-rendering/`

- **`skills/`** (repo root, 6 cross-cutting lifecycle skills)
  - `journeys/0-to-working-chat/`, `.../spa-without-runtime/`, `.../go-to-production/`, `.../scale-to-multi-agent/`, `.../v1-to-v2-migration/`, `.../debug-and-troubleshoot/`

**Reference files to produce:**

- `packages/runtime/skills/agent-implementation/wiring-external-agents/references/` with one `.md` per of: mastra, langgraph, crewai-crews, crewai-flows, pydantic-ai, adk, llamaindex, agno, aws-strands, ms-agent-framework, ag2, a2a — plus a `mcp-apps-middleware.md` pointer.
- `packages/runtime/skills/runtime-setup/agent-runners/references/` with `in-memory.md`, `sqlite.md`, `custom-runner.md`.
- `packages/runtime/skills/agent-implementation/built-in-agent/references/model-identifiers.md` and `factory-modes.md`.
- `skills/journeys/v1-to-v2-migration/references/rename-table.md`.
- `skills/journeys/debug-and-troubleshoot/references/error-codes.md`.

## Composition Opportunities

Compositions called out by the maintainer as in-scope for skill coverage (vs. delegated to external docs):

| Library                                     | Integration points                                             | Composition skill needed?                                                                                  |
| ------------------------------------------- | -------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| React Router v7 (framework mode)            | Runtime mount in loader/action; client provider + chat         | yes — priority 1 in `0-to-working-chat`                                                                    |
| TanStack Start                              | Runtime mount in server route; client provider + chat          | yes — priority 2 in `0-to-working-chat` (gap: no in-tree example)                                          |
| Next.js App Router                          | Runtime mount in `route.ts`; client in `"use client"` boundary | yes — priority 3 in `0-to-working-chat`                                                                    |
| Cloudflare Workers                          | Fetch-based runtime + env-arg secrets                          | yes — covered under `setup-endpoint` + `0-to-working-chat`                                                 |
| Bun / Deno / Vercel Edge                    | Fetch-based runtime, no adapter                                | yes — covered under `setup-endpoint`                                                                       |
| UI kits (shadcn, MUI, Chakra, Ant, Mantine) | Tool renderers, HITL approval UIs, chat customization          | yes — surfaced as cross-cutting rule in `client-side-tools` / `rendering-tool-calls` / `human-in-the-loop` |
| TanStack Query / Router                     | State reads feeding `useAgentContext`                          | yes — brief coverage in `agent-access`                                                                     |
| Auth libraries (Clerk/NextAuth/Supabase)    | Out of scope per maintainer                                    | no — mentioned only as "wire via headers or middleware hook"                                               |
| Rate limiting / monitoring / billing        | Out of scope per maintainer                                    | no — pointer in `middleware` + `go-to-production`                                                          |

## Phase 4 — Priority interview questions

Rank-ordered subset of the 15 gaps, for focused Phase 4 time:

1. **`CopilotPanel`** — exists? deprecated? upcoming? (blocks `chat-components` accuracy)
2. **TanStack AI factory contract** — public surface, docs status (blocks `built-in-agent` completeness; maintainer flagged it as a gap from baseline)
3. **`publicLicenseKey` vs `publicApiKey`** — canonical name to teach
4. **Wildcard `"*"` tool renderer typing** — intended design or gap
5. **v1→v2 codemod** — is one shipping or is the skill it?
6. **Agent-scoped context** — intended v2 hook API or stay on `copilotkit.addContext`?
7. **`CopilotAgentSwitcher`** — pre-built component planned?
8. **Intelligence self-hosting spec** — documentable?
9. **Middleware webhook URLs** — wire up or remove enum values?
10. **AG2 integration status** — current via HttpAgent?
