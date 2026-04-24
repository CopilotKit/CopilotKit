# Mastra Showcase — Parity Notes

This document tracks progress toward feature parity with the LangGraph Python
showcase and the rationale for every LangGraph demo that has NOT (yet) been
ported to Mastra.

## Ported in this PR

- `prebuilt-sidebar`, `prebuilt-popup` — pre-built chat surfaces
- `chat-slots`, `chat-customization-css` — chat customization
- `headless-simple` — custom chat UI via `useAgent`
- `frontend-tools`, `frontend-tools-async` — `useFrontendTool` sync/async
- `hitl-in-chat`, `hitl-in-app` — both human-in-the-loop patterns
- `tool-rendering-default-catchall`, `tool-rendering-custom-catchall` — catch-all tool rendering variants
- `agentic-chat-reasoning`, `reasoning-default-render` — reasoning slot customization
- `readonly-state-agent-context` — `useAgentContext` read-only context
- `agent-config` — config-object forwarding (adapted to `useAgentContext`)

## Skipped / Deferred

Each entry below documents one LangGraph-Python demo that was not ported in
this PR and the reason.

### `cli-start`

No UI/page component; it's a copy-paste `npx` command entry in the manifest.
Mastra has its own CLI path. Not worth a stub demo.

### `gen-ui-interrupt`

Requires LangGraph's `interrupt()` primitive so the frontend can "resume" a
paused graph via `useInterrupt`. Mastra doesn't expose an equivalent
interrupt/resume lifecycle through the AG-UI adapter yet. The `hitl-in-chat`
port already covers the same user-visible UX using `useHumanInTheLoop`, so
this demo was skipped to avoid misleading the feature matrix.

### `interrupt-headless`

Same reason as `gen-ui-interrupt` — requires LangGraph interrupt lifecycle.

### `mcp-apps`

Requires an MCP client to be wired into the agent's tool surface. Mastra's
MCP story is still evolving and there's no established pattern for shipping
an MCP-backed demo inside the Mastra showcase.

### `byoc-hashbrown`

Large BYOC demo using `@hashbrownai/react` for structured streaming. The
langgraph-python implementation is ~9 files and depends on strict
hashbrown schema alignment. Deferred pending a dedicated pass.

### `byoc-json-render`

BYOC demo using `@json-render/react`. Large surface area (~10 files).
Deferred pending a dedicated pass.

### `declarative-gen-ui` (A2UI dynamic)

The `generateA2uiTool` is already wired on the shared Mastra agent, but
bringing the full declarative A2UI catalog + renderers + page + suggestion
set across requires copying ~6 files and porting the A2UI catalog to match
the Mastra runtime. Deferred.

### `a2ui-fixed-schema`

Same reason as `declarative-gen-ui` — A2UI catalog + fixed schemas + page
are a substantial port.

### `open-gen-ui`, `open-gen-ui-advanced`

The open generative UI demos ship their own iframe sandbox, frontend
function injection, and a bespoke `/api/copilotkit-ogui` route. Non-trivial
port. Deferred.

### `auth`

Requires a custom CopilotKit runtime with an `onRequest` auth hook at
`/api/copilotkit-auth`. Deferred to a follow-up focused on middleware.

### `multimodal`

Requires a vision-capable runtime and a dedicated `/api/copilotkit-multimodal`
route with attachment handling. Deferred.

### `voice`

Requires a voice-capable runtime at `/api/copilotkit-voice` plus a bundled
sample-audio asset. Deferred.

### `beautiful-chat`

Canonical polished starter — ~9 files including charts, hooks, and a dedicated
`/api/copilotkit-beautiful-chat` route. Deferred pending a dedicated pass.

### `tool-rendering-reasoning-chain`

Requires a dedicated agent that emits sequential tool calls with reasoning
tokens interleaved. Mastra's current agent config doesn't reliably produce
this shape. Deferred.

### `headless-complete`

Full chat-from-scratch including message list + rendered-messages hook +
MCP route. Deferred — the `headless-simple` port already exercises the core
`useAgent` path.

## Compatibility notes

- **Agent aliasing:** All ported demos currently route to the shared
  `weatherAgent` via the demo-alias list in `src/app/api/copilotkit/route.ts`.
  Each alias gets a dedicated `resourceId` so working-memory buckets don't
  cross-contaminate. Full per-demo agent specialization is a follow-up.

- **Reasoning tokens:** The Mastra weather agent is not guaranteed to emit
  AG-UI REASONING*MESSAGE*\* events. The two reasoning demos exercise the
  slot-override path but will not show reasoning content unless the
  underlying LLM produces reasoning output.

- **Agent config forwarding:** The LangGraph reference uses provider
  `properties` passed to a dedicated route that rebuilds the system prompt
  per turn. The Mastra port uses `useAgentContext` instead — functionally
  equivalent from the user's perspective but a different wiring pattern.
