# Agno — Parity Notes

Tracking notes for feature-matrix parity between this package and
`showcase/integrations/langgraph-python/` (canonical reference).

## Ported

See `manifest.yaml` for the authoritative list.

### Initial parity push

- `prebuilt-sidebar`, `prebuilt-popup` — chrome demos using the shared main agent
- `chat-slots`, `chat-customization-css` — chat customization paths
- `headless-simple` — minimal useAgent surface
- `frontend-tools`, `frontend-tools-async` — useFrontendTool (sync + async handlers)
- `readonly-state-agent-context` — useAgentContext read-only context
- `tool-rendering-default-catchall`, `tool-rendering-custom-catchall` — wildcard-only tool rendering variants (new `get_stock_price` + `roll_dice` tools added to the Agno main agent)
- `hitl-in-chat` booking flow — useHumanInTheLoop with a new `book_call` external-execution tool
- `hitl-in-app` — frontend-tool + app-level approval dialog (frontend-only)

### Second pass (deferred-demo recovery)

- `agentic-chat-reasoning`, `reasoning-default-render`,
  `tool-rendering-reasoning-chain` — reasoning family. Verified Agno's AGUI
  interface emits `REASONING_MESSAGE_*` events (`agno/os/interfaces/agui/utils.py`
  imports `ReasoningMessageStartEvent` / `ReasoningMessageContentEvent` /
  `ReasoningMessageEndEvent`). Added a new `reasoning_agent` Python module
  with `reasoning=True` plus a second `AGUI` interface mounted at prefix
  `/reasoning`. The Next.js runtime aliases the three reasoning agent names to
  an `HttpAgent` targeting `/reasoning/agui`.
- `headless-complete` — full chat from scratch on `useAgent` +
  `CopilotChatConfigurationProvider` + manual `useRenderToolCall` /
  `useRenderActivityMessage` / `useRenderCustomMessages` composition. Reuses
  the Agno main agent via the default `/api/copilotkit` endpoint. MCP-Apps
  activity surface is intentionally omitted — Agno's AGUI adapter doesn't
  expose an MCP-Apps runtime. Every other generative-UI branch (per-tool
  renderers, `useComponent` frontend tools, reasoning, custom messages,
  wildcard catch-all) is wired in.
- `auth` — dedicated `/api/copilotkit-auth` runtime using
  `createCopilotRuntimeHandler` from `@copilotkit/runtime/v2` with an
  `onRequest` hook that rejects requests lacking a static Bearer token.
  Authenticated target is the Agno main agent at `/agui`.

## Skipped

The following demos from the canonical LangGraph-Python reference are intentionally
NOT ported to this package. Each has a concrete reason tied to a genuine framework
capability difference or infrastructure requirement that we couldn't validate in
this blitz pass.

### LangGraph-specific primitives (no direct Agno equivalent)

- `gen-ui-interrupt` — Uses LangGraph's `interrupt()` primitive to pause the graph
  mid-run and resolve from the UI. Agno's AgentOS AGUI adapter does not expose an
  equivalent long-running-resume primitive at this time. We already ship
  `hitl-in-chat-booking` + `hitl-in-app`, which cover the user-facing HITL scenario
  via Agno's native tool-approval path.
- `interrupt-headless` — Same root cause as `gen-ui-interrupt`. Headless resume
  from a button grid requires a pause/resume handle the Agno AGUI adapter does
  not currently surface.

### Require dedicated runtimes we haven't wired yet

These demos depend on dedicated `/api/copilotkit-<variant>/route.ts` runtimes in
the canonical reference. They are portable in principle — they just need new
route files each and supporting Python wiring — but doing them right requires
exercising Agno's runtime config paths we haven't validated yet. Deferred for a
follow-up parity pass rather than faked in.

- `beautiful-chat` — combined runtime (openGenerativeUI + a2ui + mcpApps)
- `byoc-hashbrown` — dedicated `/api/copilotkit-byoc-hashbrown` runtime, requires
  Agno structured-output streaming matching the hashbrown Zod catalog
- `byoc-json-render` — dedicated `/api/copilotkit-byoc-json-render` runtime,
  requires streaming JSON-schema-constrained output from Agno
- `multimodal` — dedicated `/api/copilotkit-multimodal` runtime; Agno supports
  multimodal input via `UserMessage(images=[...])` but wiring vision to an
  AGUI-served agent needs a runtime surface we haven't built
- `voice` — dedicated `/api/copilotkit-voice` runtime + `@copilotkit/voice`;
  voice STT is a frontend concern independent of the Agno agent
- `open-gen-ui`, `open-gen-ui-advanced` — dedicated `/api/copilotkit-ogui`
  runtime; requires openGenerativeUI middleware on a V2 runtime talking to
  an Agno agent
- `agent-config` — dedicated `/api/copilotkit-agent-config` runtime with typed
  config forwarding; needs Agno dynamic-system-prompt wiring per-request
- `declarative-gen-ui` (A2UI dynamic) — dedicated runtime + frontend A2UI
  catalog; the existing Agno `main` agent already exposes `generate_a2ui`,
  but the declarative-gen-ui cell expects a different runtime surface
- `a2ui-fixed-schema` — dedicated runtime + fixed-schema catalog
- `mcp-apps` — requires Agno MCP client/server wiring; Agno has
  `agno.tools.mcp.MCPTools` but integration with the AGUI adapter's
  activity-message surface wasn't verified

### Not a real demo

- `cli-start` — Copy-paste starter command rendered by the dashboard as a
  command card with no route/agent. The equivalent starter for Agno is already
  advertised via `manifest.yaml`'s `starter:` section.
