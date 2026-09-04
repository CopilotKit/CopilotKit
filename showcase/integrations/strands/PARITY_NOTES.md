# AWS Strands — LangGraph-Python Parity Notes

This file documents the status of each showcase demo relative to the
canonical LangGraph-Python showcase package (`showcase/integrations/langgraph-python`).

The overall architectural difference between the two packages:

- **LangGraph-Python** ships one `src/agents/<demo>.py` module per demo, each
  bound to its own LangGraph graph via `langgraph.json`.
- **AWS Strands** ships a single shared Strands agent (`src/agents/agent.py`)
  registered under many agent names in the AG-UI runtime, plus a handful of
  dedicated agents mounted on sub-paths (A2UI, voice, interrupts, reasoning)
  where a demo needs its own tools or model configuration. Most demos reuse the
  shared backend; per-demo differentiation then happens on the frontend via
  `useFrontendTool`, `useRenderTool`, `useHumanInTheLoop`, `useAgentContext`,
  and A2UI catalogs.

This keeps the Strands code base dramatically smaller without sacrificing
user-visible functionality — the demo URLs, pages, and interactive flows are
all present.

## Interrupts: native, both demos shipped

Strands has a first-class interrupt primitive
([docs](https://strandsagents.com/docs/user-guide/concepts/interrupts/)) and both
AG-UI Strands bridges implement the AG-UI interrupt protocol on top of it, so
these two demos run on the real mechanism rather than a frontend-tool stand-in:

- **gen-ui-interrupt**: `src/agents/interrupt_agent.py` owns a
  `schedule_meeting` tool that calls `tool_context.interrupt(...)`. The bridge
  finishes the run with `RUN_FINISHED` carrying `outcome.type == "interrupt"`,
  the frontend's `useInterrupt` renders the time picker inline, and `resolve()`
  resumes the same run so the tool body continues from the pause.
- **interrupt-headless**: same backend agent, with `useInterrupt`
  (`renderInChat: false`) placing the picker in the app surface instead of the
  chat.

Both are served by a dedicated agent mounted at `AGENT_URL/interrupt/` rather
than by the shared agent, because `hitl-in-chat` registers a FRONTEND tool
called `schedule_meeting`; one tool name cannot be both client-executed and
backend-pausing.

Interrupt payload channel, one live bridge difference: `ag_ui_strands` (Python)
carries the tool's `interrupt()` reason under the AG-UI interrupt's
`metadata.reason`, while the published `@ag-ui/aws-strands` 0.2.3 JSON-encodes
it into `message` instead. The demo pages read both channels. `metadata.reason`
is already in the TypeScript bridge's source and ships with its next release.

## Reasoning: shipped

`reasoning-default`, `reasoning-custom` and `tool-rendering-reasoning-chain` run
against dedicated agents on the OpenAI Responses API with reasoning summaries
enabled (`src/agents/reasoning_agent.py`,
`src/agents/reasoning_chain_agent.py`). The shared showcase agent stays on chat
completions so tool-call arguments keep streaming incrementally, and chat
completions emits no reasoning items at all, hence the separate agents.

## Skipped demos

- **shared-state-streaming**: both bridges emit state SNAPSHOTS; neither maps a
  Strands stream event onto AG-UI's `STATE_DELTA`, so there is no per-token
  state stream for the UI to apply. Deliberately not built. `shared-state-read`
  and `shared-state-read-write` cover the snapshot path.

## MCP Apps — now ported (wave-2 follow-up)

- **mcp-apps** — **shipped (simplified)**. Dedicated
  `/api/copilotkit-mcp-apps` route configures
  `mcpApps.servers: [{ type: "http", url: ..., serverId: "excalidraw" }]`.
  The Strands shared agent has no bespoke MCP tools — the runtime
  middleware advertises the MCP server's tools to the agent at request
  time and emits the activity events that CopilotKit's built-in
  `MCPAppsActivityRenderer` paints inline as a sandboxed iframe. Mirrors
  the langgraph-python sibling pattern.

Wave-2 port status for the previously deferred demos:

- **byoc-hashbrown** — **shipped**. Dedicated `/api/copilotkit-byoc-hashbrown`
  route, hashbrown renderer + catalog, MetricCard/PieChart/BarChart/DealCard
  components. The strict hashbrown JSON envelope prompt lives in
  `src/agents/byoc_hashbrown.py` and is injected into the shared Strands
  agent as `useAgentContext`. Incorporates PR #4271 fix from the start
  (JSON envelope — NOT XML).
- **byoc-json-render** — **shipped**. Dedicated `/api/copilotkit-byoc-json-render`
  route, `@json-render/react` renderer with `<JSONUIProvider>` wrap (PR #4271
  fix). Registry forwards `children` through the MetricCard wrapper so
  nested dashboards render. Output prompt lives in
  `src/agents/byoc_json_render.py` and is mirrored on the frontend via
  `useAgentContext`.
- **open-gen-ui** — **shipped**. Dedicated `/api/copilotkit-ogui` route with
  `openGenerativeUI: { agents: ["open-gen-ui", "open-gen-ui-advanced"] }`.
  Minimal variant uses `openGenerativeUI.designSkill` to steer the LLM
  toward intricate, educational visualisations.
- **open-gen-ui-advanced** — **shipped**. Same route as open-gen-ui; adds
  `openGenerativeUI.sandboxFunctions` (evaluateExpression, notifyHost) so
  the agent-authored iframe can invoke host functions via
  `Websandbox.connection.remote.<name>(...)`.
- **beautiful-chat** — **shipped (simplified)** in the wave-2 follow-up.
  Polished landing-style chat shell with brand theming and seeded
  suggestions, sitting on top of the shared Strands agent. Pattern
  mirrors the spring-ai sibling
  (`showcase/integrations/spring-ai/src/app/demos/beautiful-chat/`).
  Porting the full canonical surface (ExampleCanvas, GenerativeUIExamples,
  declarative A2UI catalog, theme provider, dedicated runtime that
  enables `openGenerativeUI` + `a2ui` + `mcpApps` simultaneously) remains
  out-of-scope future work — see the LangGraph-Python reference in
  `showcase/integrations/langgraph-python/src/app/demos/beautiful-chat/`
  for the full surface area.

### Per-demo prompt specialization caveat

The Strands showcase uses one shared Strands Agent backend
(`agent_server.py`). Wave-2's BYOC demos specialize the LLM's output shape
(hashbrown envelope / json-render spec) by injecting the canonical system
prompt via `useAgentContext` on the frontend, rather than by spinning up
dedicated Strands Agent instances per demo. The canonical prompts live in
`src/agents/byoc_hashbrown.py` and `src/agents/byoc_json_render.py` as the
single source of truth; the frontend strings mirror them. This keeps the
Strands backend topology simple while letting each demo specialize its
output contract.

All other LangGraph-Python demos are ported below.

## Ported demos

Existing (pre-blitz):

- `agentic-chat`, `hitl` (ergonomic HITL), `tool-rendering`, `gen-ui-tool-based`,
  `gen-ui-agent`, `shared-state-read-write`, `shared-state-streaming`, `subagents`.

Added in this blitz:

- `cli-start` — manifest-only start command.
- `chat-customization-css` — scoped CSS re-theme of `<CopilotChat />`.
- `prebuilt-sidebar` — `<CopilotSidebar />`.
- `prebuilt-popup` — `<CopilotPopup />`.
- `chat-slots` — slot-system chat customization.
- `headless-simple` — minimal chat built on `useAgent`.
- `headless-complete` — full headless chat implementation.
- `agentic-chat-reasoning` — reasoning chain rendered via a custom slot.
- `reasoning-default-render` — built-in `CopilotChatReasoningMessage` render.
- `frontend-tools` — `useFrontendTool` background-change demo.
- `frontend-tools-async` — async `useFrontendTool` handler.
- `hitl-in-chat` — `useHumanInTheLoop` ergonomic HITL.
- `hitl-in-app` — app-level modal HITL via async `useFrontendTool`.
- `tool-rendering-default-catchall` — zero-config wildcard tool render.
- `tool-rendering-custom-catchall` — branded wildcard renderer via `useDefaultRenderTool`.
- `tool-rendering-reasoning-chain` — tool renders + reasoning tokens side-by-side.
- `readonly-state-agent-context` — `useAgentContext` read-only context.
- `declarative-gen-ui` — dynamic A2UI via custom catalog.
- `a2ui-fixed-schema` — A2UI rendered against a known client-side schema.
- `multimodal` — image + PDF attachments.
- `auth` — bearer-token gated runtime.
- `voice` — voice input via `@copilotkit/voice`.
- `agent-config` — typed config object forwarded to agent.
- `gen-ui-tool-based` — tool-triggered generative UI (haiku generator) via
  `useFrontendTool` with a custom render. Manifest entry added; the page
  was already in place from a prior wave.
- `tool-rendering-default-catchall` — zero-config wildcard tool render via
  `useDefaultRenderTool()`. Manifest entry added; page already shipped.
- `tool-rendering-custom-catchall` — branded wildcard render. Manifest
  entry added; page already shipped.
- `hitl-in-chat-booking` — manifest alias of `hitl-in-chat`; both feature
  ids point to the same `/demos/hitl-in-chat` route, mirroring the
  langgraph-python manifest topology so the harness's per-feature live
  status surfaces the booking flow as its own row.

The Strands shared agent (`src/agents/agent.py`) already exposes the tools
all of the above need (weather, flights, query_data, schedule_meeting,
manage_sales_todos, set_theme_color, generate_a2ui). New demos that need
additional agent-side surface are documented inline in their respective demo
folders.
