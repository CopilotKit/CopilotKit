# AWS Strands — LangGraph-Python Parity Notes

This file documents the status of each showcase demo relative to the
canonical LangGraph-Python showcase package (`showcase/packages/langgraph-python`).

The overall architectural difference between the two packages:

- **LangGraph-Python** ships one `src/agents/<demo>.py` module per demo, each
  bound to its own LangGraph graph via `langgraph.json`.
- **AWS Strands** ships a single shared Strands agent (`src/agents/agent.py`)
  registered under many agent names in the AG-UI runtime. All demos in the
  Strands package reuse the same backend; per-demo differentiation happens
  almost entirely on the frontend via `useFrontendTool`, `useRenderTool`,
  `useHumanInTheLoop`, `useAgentContext`, and A2UI catalogs.

This keeps the Strands code base dramatically smaller without sacrificing
user-visible functionality — the demo URLs, pages, and interactive flows are
all present.

## Skipped demos

These demos depend on LangGraph-specific primitives that AWS Strands does not
expose at this time:

- **gen-ui-interrupt** — Built on `useLangGraphInterrupt`, which hooks directly
  into the LangGraph interrupt lifecycle. Strands does not provide an
  equivalent first-class interrupt primitive. The ergonomic replacement is
  `hitl-in-chat` (implemented), which uses `useHumanInTheLoop` on top of a
  regular frontend tool — Strands supports that natively.
- **interrupt-headless** — Same rationale as `gen-ui-interrupt`. Requires
  `useLangGraphInterrupt`'s resolve/respond primitive. Not portable.
- **mcp-apps** — Requires MCP server-driven UI routed through a LangGraph
  tool node. The MCP plumbing (StreamableHttp transport + the
  `useConfigureMcpClient` wiring) is LangGraph-specific in our current
  runtime glue. Not portable without new Strands-side integration work.

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
- **beautiful-chat** — **skipped** (truthfully). Porting fully requires
  dozens of starter-level sub-components (UI primitives, todo board,
  meeting-time picker, headless chat, theme toggle, a2ui catalog, etc.)
  AND a dedicated runtime that enables `openGenerativeUI` + `a2ui` +
  `mcpApps` simultaneously. That is more work than all four other wave-2
  demos combined and deserves its own blitz. See the LangGraph-Python
  reference in `showcase/packages/langgraph-python/src/app/demos/beautiful-chat/`
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

The Strands shared agent (`src/agents/agent.py`) already exposes the tools
all of the above need (weather, flights, query_data, schedule_meeting,
manage_sales_todos, set_theme_color, generate_a2ui). New demos that need
additional agent-side surface are documented inline in their respective demo
folders.
