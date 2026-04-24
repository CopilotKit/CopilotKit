# Parity Notes

Baseline: `showcase/packages/langgraph-python/`.

This package ports the frontend-composition demos satisfied by the shared
Claude backend in `src/agents/agent.py`, plus dedicated ogui / headless
surfaces. The demos below are deliberately out of scope for this pass and
left for a follow-up.

## Ported

### Initial pass (B2)

- `cli-start` — manifest-only entry with the framework-slug init command.
- `prebuilt-sidebar` — default `<CopilotSidebar />` against the shared agent.
- `prebuilt-popup` — default `<CopilotPopup />` against the shared agent.
- `chat-slots` — custom `welcomeScreen`, `input.disclaimer`, `messageView.assistantMessage` slots.
- `chat-customization-css` — scoped CSS variable and class overrides.
- `headless-simple` — `useAgent` + `useComponent` minimal custom chat surface.

### Follow-up pass (B2')

- `frontend-tools` — `useFrontendTool` with sync handler (change_background).
- `frontend-tools-async` — `useFrontendTool` with async handler (query_notes).
- `hitl-in-app` — async `useFrontendTool` HITL; `fixed inset-0` overlay
  (not `createPortal`) to avoid pulling in `@types/react-dom`.
- `readonly-state-agent-context` — `useAgentContext` read-only context.
- `tool-rendering-default-catchall` — zero-renderer built-in default.
- `tool-rendering-custom-catchall` — `useDefaultRenderTool` wildcard.
- `open-gen-ui` — minimal open-ended generative UI (dedicated
  `/api/copilotkit-ogui` route with `openGenerativeUI` flag).
- `open-gen-ui-advanced` — OGUI with frontend sandbox functions
  (evaluateExpression, notifyHost).
- `headless-complete` — full custom chat surface built on `useAgent`,
  with per-tool renderers, frontend component, and wildcard catch-all.
  Points to the shared `/api/copilotkit` route (the reference points at
  `/api/copilotkit-mcp-apps`; this package doesn't port mcp-apps — the
  Excalidraw-MCP suggestion will surface as a catch-all tool card).

## Skipped

### Require langgraph-specific primitives (no Claude Agent SDK equivalent)

- `gen-ui-interrupt` — relies on langgraph's `interrupt()` primitive that
  pauses the graph and resumes on a client-side response. Claude Agent SDK
  does not expose an equivalent graph-interrupt API.
- `interrupt-headless` — same reason; this is a headless surface for
  resolving a langgraph interrupt.

### Require streaming Claude extended-thinking plumbing

- `agentic-chat-reasoning`, `reasoning-default-render`,
  `tool-rendering-reasoning-chain` — require streaming Claude extended-
  thinking (reasoning) blocks as distinct AG-UI message parts. The current
  `src/agents/agent.py` AG-UI bridge does not translate Anthropic
  `thinking` content blocks; adding it correctly requires new event types
  and a thinking-aware message buffer. Follow-up.

### Deferred — larger-scope multi-file surfaces

These are feasible on this package but each pulls in substantial
multi-file frontend infrastructure (catalogs, renderers, MCP client
glue, theme pipelines) that did not fit this pass. Left for dedicated
follow-up commits.

- `declarative-gen-ui` — A2UI BYOC catalog (Card/StatusBadge/Metric/
  InfoRow/PrimaryButton) wired via `a2ui.catalog` on the provider.
- `a2ui-fixed-schema` — fixed-schema A2UI with two JSON schemas
  (flights + booked) and a per-demo catalog.
- `mcp-apps` — MCP server-driven UI via activity renderers. Claude Agent
  SDK supports MCP clients, but the langgraph-python reference relies on
  CopilotKit runtime wiring through a dedicated
  `/api/copilotkit-mcp-apps/route.ts` plus agent-side MCP client glue.
- `beautiful-chat` — 28+ supporting files (layout, canvas, generative UI
  charts, hooks, theme CSS, showcase config, A2UI catalog). Porting
  requires significant surface-area review that did not fit this pass.

## Follow-up buckets

- Reasoning / extended-thinking plumbing in `agent.py` (unlocks
  `agentic-chat-reasoning`, `reasoning-default-render`,
  `tool-rendering-reasoning-chain`).
- A2UI catalog demos (unlocks `declarative-gen-ui`, `a2ui-fixed-schema`).
- MCP client integration (unlocks `mcp-apps`).
- Beautiful-chat infrastructure port.
