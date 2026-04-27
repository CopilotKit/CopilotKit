# Parity Notes

Baseline: `showcase/packages/langgraph-python/`.

This package ports the frontend-composition demos satisfied by the shared
Claude backend in `src/agents/agent.py`, plus dedicated ogui / headless
surfaces. The demos below are deliberately out of scope for this pass and
left for a follow-up.

## New demos (post-PR #4271)

- `byoc-json-render` — dedicated `/byoc-json-render` agent endpoint emits
  a JSON spec; frontend renders via `<JSONUIProvider>` + `<Renderer />`
  against a Zod catalog (MetricCard, BarChart, PieChart). Includes the
  `<JSONUIProvider>` fix from PR #4271 and the `defineRegistry`
  children-forwarding fix for MetricCard.
- `byoc-hashbrown` — dedicated `/byoc-hashbrown` agent endpoint emits
  the hashbrown JSON envelope `{ui: [{metric: {props: {...}}}, ...]}`
  (NOT XML — the #4271 fix). Frontend parses via `useJsonParser` +
  `useUiKit` with MetricCard / PieChart / BarChart / DealCard / Markdown.
- `multimodal` — dedicated `/multimodal` agent endpoint with
  `convert_part_for_claude` that translates AG-UI `image` / `document`
  parts into Claude's native Messages API shape. PDFs flatten to text
  via `pypdf`. **No legacy-binary shim required** — that shim is
  specific to the `@ag-ui/langgraph@0.0.27` converter and is not needed
  when HttpAgent forwards modern parts to the Claude Agent SDK backend.
- `voice` — dedicated `/api/copilotkit-voice` runtime with a
  `GuardedOpenAITranscriptionService` that reports a typed 401 when
  `OPENAI_API_KEY` is missing (vs a silent 503). Transcription service
  is written onto the V2 runtime instance directly to work around the
  V1 wrapper silently dropping the service. Backend reuses the shared
  Claude agent.
- `agent-config` — dedicated `/agent-config` agent endpoint that reads
  `tone` / `expertise` / `responseLength` off
  `forwarded_props.config.configurable.properties` and builds the
  system prompt per turn. Frontend route subclasses `HttpAgent` to
  repack provider `properties` into the nested configurable shape so
  the wire format matches the langgraph-python reference exactly.
- `auth` — dedicated `/api/copilotkit-auth` route uses
  `createCopilotRuntimeHandler` from `@copilotkit/runtime/v2` directly
  so the `onRequest` hook actually fires (V1 adapter drops hooks).
  Bearer-token gate returns 401 on mismatch. Includes the #4271
  defaults fix: `useDemoAuth` defaults to signed-in, plus
  `ChatErrorBoundary` so the page never white-screens on auth
  transitions.

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
