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

Additional demos that require dedicated backend runtimes are deferred for a
follow-up blitz — they are not blocked by Strands primitives per se, but
porting them well requires building out parallel `/api/copilotkit-*` endpoints
with agent-owned tool behaviors (OGUI, BYOC renderers). These are:

- **beautiful-chat** — requires its own runtime enabling `openGenerativeUI` +
  `a2ui` + `mcpApps` simultaneously; dedicated backend graph. Deferred.
- **byoc-hashbrown** — Hashbrown renderer pipeline on a dedicated runtime.
  Deferred; the Strands agent exposes the same `query_data` tool but the
  frontend wiring + schema catalog is substantial.
- **byoc-json-render** — json-render renderer on a dedicated runtime.
  Deferred for the same reason as `byoc-hashbrown`.
- **open-gen-ui** — dedicated runtime with OGUI-specific agent plumbing.
  Deferred.
- **open-gen-ui-advanced** — same as `open-gen-ui` plus sandbox
  function-calling plumbing. Deferred.

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
