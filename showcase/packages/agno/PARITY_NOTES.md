# Agno — Parity Notes

Tracking notes for feature-matrix parity between this package and
`showcase/packages/langgraph-python/` (canonical reference).

## Ported

See `manifest.yaml` for the authoritative list. In this parity push we added:

- `prebuilt-sidebar`, `prebuilt-popup` — chrome demos using the shared main agent
- `chat-slots`, `chat-customization-css` — chat customization paths
- `headless-simple` — minimal useAgent surface
- `frontend-tools`, `frontend-tools-async` — useFrontendTool (sync + async handlers)
- `readonly-state-agent-context` — useAgentContext read-only context
- `tool-rendering-default-catchall`, `tool-rendering-custom-catchall` — wildcard-only tool rendering variants (new `get_stock_price` + `roll_dice` tools added to the Agno main agent)
- `hitl-in-chat` booking flow — useHumanInTheLoop with a new `book_call` external-execution tool
- `hitl-in-app` — frontend-tool + app-level approval dialog (frontend-only)

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

### Require dedicated runtimes we didn't wire up in this pass

These demos depend on dedicated `/api/copilotkit-<variant>/route.ts` runtimes in
the canonical reference. They're all portable in principle — they just need a
new route file each and supporting Python wiring — but doing them right requires
exercising Agno's runtime config paths we haven't validated here. Left for a
follow-up parity pass rather than faked in.

- `beautiful-chat` — combined runtime (openGenerativeUI + a2ui + mcpApps)
- `byoc-hashbrown` — dedicated `/api/copilotkit-byoc-hashbrown` runtime
- `byoc-json-render` — dedicated `/api/copilotkit-byoc-json-render` runtime
- `multimodal` — dedicated `/api/copilotkit-multimodal` runtime + vision-capable model
- `auth` — dedicated `/api/copilotkit-auth` runtime with `onRequest` bearer-token gate
- `voice` — dedicated `/api/copilotkit-voice` runtime + `@copilotkit/voice`
- `open-gen-ui`, `open-gen-ui-advanced` — dedicated `/api/copilotkit-ogui` runtime
- `agent-config` — dedicated `/api/copilotkit-agent-config` runtime with typed config forwarding
- `declarative-gen-ui` (A2UI dynamic) — dedicated runtime + frontend A2UI catalog
- `a2ui-fixed-schema` — dedicated runtime + fixed-schema catalog
- `mcp-apps` — requires Agno MCP client/server wiring; Agno MCP support status
  in AGUI adapter not verified in this pass
- `headless-complete` — routes through `/api/copilotkit-mcp-apps`; depends on
  mcp-apps infra

### Require reasoning-token emission via AG-UI we didn't verify

- `agentic-chat-reasoning`, `reasoning-default-render`,
  `tool-rendering-reasoning-chain` — These demos depend on the agent emitting
  AG-UI `REASONING_MESSAGE_*` events. Agno has a `reasoning` option on `Agent`
  but whether it translates through the `AGUI` interface into the exact
  REASONING_MESSAGE event shape the CopilotKit frontend consumes wasn't verified
  in this pass. Deferred rather than shipped broken.

### Not a real demo

- `cli-start` — Copy-paste starter command rendered by the dashboard as a
  command card with no route/agent. The equivalent starter for Agno is already
  advertised via `manifest.yaml`'s `starter:` section.
