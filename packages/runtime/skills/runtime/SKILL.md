---
name: runtime
description: >
  @copilotkit/runtime — mount a fetch-native CopilotRuntime on any JS server, wire
  middleware, pick an AgentRunner, instantiate BuiltInAgent (Factory Mode with TanStack AI
  is the preferred default) or plug in any of 12 external agent frameworks (Mastra,
  LangGraph, CrewAI Crews/Flows, PydanticAI, ADK, LlamaIndex, Agno, AWS Strands, MS Agent
  Framework, AG2, A2A), enable Intelligence mode for durable threads + websocket,
  register server-side tools via defineTool, and wire voice transcription. Uses the
  fetch-based createCopilotRuntimeHandler primitive — the Express/Hono adapters are
  discouraged. Load the reference under references/ that matches your task.
type: core
library: copilotkit
library_version: "1.56.2"
requires: []
sources:
  - "CopilotKit/CopilotKit:packages/runtime/src/v2/runtime/core/fetch-handler.ts"
  - "CopilotKit/CopilotKit:packages/runtime/src/v2/runtime/core/runtime.ts"
  - "CopilotKit/CopilotKit:packages/runtime/src/v2/runtime/core/hooks.ts"
  - "CopilotKit/CopilotKit:packages/runtime/src/v2/runtime/core/middleware.ts"
  - "CopilotKit/CopilotKit:packages/runtime/src/v2/runtime/runner/agent-runner.ts"
  - "CopilotKit/CopilotKit:packages/runtime/src/v2/runtime/runner/in-memory.ts"
  - "CopilotKit/CopilotKit:packages/runtime/src/v2/runtime/runner/intelligence.ts"
  - "CopilotKit/CopilotKit:packages/runtime/src/v2/runtime/intelligence-platform/client.ts"
  - "CopilotKit/CopilotKit:packages/runtime/src/v2/runtime/transcription-service/transcription-service.ts"
  - "CopilotKit/CopilotKit:packages/runtime/src/v2/runtime/handlers/handle-transcribe.ts"
  - "CopilotKit/CopilotKit:packages/runtime/src/agent/index.ts"
  - "CopilotKit/CopilotKit:packages/runtime/src/agent/converters/tanstack.ts"
  - "CopilotKit/CopilotKit:packages/sqlite-runner/src/sqlite-runner.ts"
  - "CopilotKit/CopilotKit:packages/shared/src/transcription-errors.ts"
---

# CopilotKit Runtime

`@copilotkit/runtime` is the server half of CopilotKit: it accepts AG-UI protocol
requests, dispatches them to an `AbstractAgent` (built-in or external), runs the
stream through an `AgentRunner`, and responds as Server-Sent Events.

This SKILL.md is the **index**. Read the reference under `references/` that matches
your task — do not try to absorb the whole package from this file.

## Mental Model — the three dictionaries you hand to `CopilotRuntime`

```ts
new CopilotRuntime({
  agents,       // Record<string, AbstractAgent>     — see wiring-external-agents or built-in-agent
  runner,       // AgentRunner (optional)            — see agent-runners
  intelligence, // CopilotKitIntelligence (optional) — see intelligence-mode (auto-wires runner)
  mcpApps,      // McpAppsConfig (optional)          — see wiring-mcp-apps-middleware
  a2ui,         // A2UIConfig (optional)             — see packages/a2ui-renderer skill
  hooks,        // { onRequest, onBeforeHandler }    — see middleware
  beforeRequestMiddleware, afterRequestMiddleware,   // legacy — see middleware
  transcription, // TranscriptionService (optional)  — see transcription
});
```

You then mount it:

```ts
import { createCopilotRuntimeHandler } from "@copilotkit/runtime/v2";
const handler = createCopilotRuntimeHandler({ runtime, basePath: "/api/copilotkit" });
export default { fetch: handler };
```

## When to load which reference

| Task | Reference |
| ---- | --------- |
| Mounting on any fetch-native server (Cloudflare Workers, Bun, Deno, Vercel Edge, Next.js App Router, React Router v7, TanStack Start) or delegating from Express/Node | `references/setup-endpoint.md` |
| Auth / logging / rate-limit / request-scoped guards via `hooks.onRequest` / `hooks.onBeforeHandler` (preferred) or legacy `beforeRequestMiddleware` / `afterRequestMiddleware` | `references/middleware.md` |
| Choosing between `InMemoryAgentRunner`, `SqliteAgentRunner`, or a custom subclass — including thread-locking semantics and the runner/Intelligence mutual exclusion | `references/agent-runners.md` (+ `-in-memory.md`, `-sqlite.md`, `-custom.md` for backend-specific detail) |
| Enabling durable threads + realtime websocket via CopilotKit Cloud (Intelligence is **Cloud-only**, not self-hostable) | `references/intelligence-mode.md` |
| Voice transcription — implementing a `TranscriptionService` subclass for the `/transcribe` endpoint | `references/transcription.md` |
| Instantiating `BuiltInAgent` — Simple Mode (classic) or Factory Mode with TanStack AI (preferred AG-UI-compliant default), AI SDK, or custom factory | `references/built-in-agent.md` (+ `-factory-modes.md`, `-helper-utilities.md`, `-model-identifiers.md`) |
| Defining server-side tools via `defineTool` for `BuiltInAgent.config.tools` (Simple Mode only) | `references/server-side-tools.md` |
| Wiring an external agent framework into `CopilotRuntime({ agents })` | `references/wiring-external-agents.md` (index) + per-framework refs (`wiring-mastra.md`, `wiring-langgraph.md`, `wiring-crewai-crews.md`, `wiring-crewai-flows.md`, `wiring-pydantic-ai.md`, `wiring-adk.md`, `wiring-llamaindex.md`, `wiring-agno.md`, `wiring-aws-strands.md`, `wiring-ms-agent-framework.md`, `wiring-ag2.md`, `wiring-a2a.md`) |
| Wiring MCP Apps (runtime-level middleware, not an agent) | `references/wiring-mcp-apps-middleware.md` |

## Invariants and gotchas (load-once, before any reference)

- `createCopilotRuntimeHandler` is the canonical primitive. `createCopilotExpressHandler` / `createCopilotHonoHandler` exist but are **avoid at all costs** — delegate from Express/Hono routes to the fetch primitive instead.
- `publicLicenseKey` is the canonical provider-side field. `publicApiKey` is a **deprecated alias** — expect to see it in legacy code, emit the canonical name in new code.
- Intelligence mode auto-wires `IntelligenceAgentRunner`. Passing both `runner` and `intelligence` to `CopilotRuntime` is rejected at construction.
- Intelligence mode targets CopilotKit Cloud (`api.cloud.copilotkit.ai`) and is **not self-hostable**.
- `hooks.onRequest` runs **before** `beforeRequestMiddleware` (hook-based middleware wins for Response short-circuits). `beforeRequestMiddleware` runs **after** `hooks.onRequest` (see `fetch-handler.ts:136-147`).
- `identifyUser` (Intelligence) does **not** forward thrown `Response` objects — convert to 500. Gate auth rejection in `hooks.onRequest`, which does forward Responses.
- `agents__unsafe_dev_only` and `selfManagedAgents` are dev-only aliases of each other; do not reach for them in production. Either signals that the SPA is in dev mode.

## Reading order for a first-time reader

1. `setup-endpoint` — the primitive.
2. `built-in-agent` **or** pick one from `wiring-external-agents` — the agent.
3. `agent-runners` — production persistence choice.
4. Optional: `middleware`, `intelligence-mode`, `server-side-tools`, `transcription`.
