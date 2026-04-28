# AG2 Parity Notes

Status of AG2 showcase demos relative to the langgraph-python canonical set.

## Ported

### Batch 1 — Frontend variants over the shared ConversableAgent

These demos reuse the existing `src/agents/agent.py` (one `ConversableAgent`
wrapped with `AGUIStream`). The runtime route registers each agent name,
all pointing to the same HTTP backend.

- `prebuilt-sidebar` — `<CopilotSidebar />` docked layout
- `prebuilt-popup` — `<CopilotPopup />` floating launcher
- `chat-slots` — slot-overridden `<CopilotChat />` (welcomeScreen, disclaimer, assistantMessage)
- `chat-customization-css` — scoped CSS theming of built-in classes
- `headless-simple` — bespoke chat built on `useAgent` / `useComponent`
- `readonly-state-agent-context` — `useAgentContext` read-only context
- `reasoning-default-render` — built-in `CopilotChatReasoningMessage` (no custom slot)
- `tool-rendering-default-catchall` — `useDefaultRenderTool()` (built-in card)
- `tool-rendering-custom-catchall` — single branded wildcard renderer
- `frontend-tools` — `useFrontendTool` with sync handler (change_background)
- `frontend-tools-async` — `useFrontendTool` with async handler (notes-card)
- `hitl-in-app` — async `useFrontendTool` + app-level modal (approval-dialog)

### Previously ported (kept)

- `agentic-chat`, `hitl-in-chat`, `tool-rendering`, `gen-ui-tool-based`,
  `gen-ui-agent`, `shared-state-read-write`, `shared-state-streaming`,
  `subagents`

## Deferred (require per-demo agent specialization)

AG2's AG-UI integration mounts a single `AGUIStream` over one
`ConversableAgent` at the FastAPI root. Achieving per-demo specialized
behavior (tailored system prompts, dedicated tool sets, backend-owned
A2UI tools, MCP integration, vision input, structured-output BYOC, etc.)
requires adding additional Python agent modules AND either (a) mounting
each as its own ASGI app at a distinct path and pointing a dedicated
`HttpAgent({ url })` at it from a per-demo Next.js runtime route, or
(b) adopting AG2's `GroupChat` to host multiple specialized agents
behind a single stream with router logic. Both approaches are feasible
but represent a distinct engineering investment and are not a pure port
of the langgraph-python cell.

The following demos fall into that bucket and are **deferred**, not
strictly "missing primitive" skips:

- `agentic-chat-reasoning`, `headless-complete`, `tool-rendering-reasoning-chain`
  — need a reasoning-forward AG2 agent (o1-style model config).
- `declarative-gen-ui`, `a2ui-fixed-schema` — need A2UI middleware parity
  with the langgraph-python `CopilotKitMiddleware` + `a2ui_dynamic` / `a2ui_fixed`
  graphs and a dedicated `/api/copilotkit-*` route per demo.
- `agent-config` — needs the agent to re-materialize system prompt from
  forwardedProps on every turn (AG2 ConversableAgent supports this but a
  dedicated runtime wiring is required).
- `auth` — pure runtime `onRequest` hook demo; dedicated `/api/copilotkit-auth`
  route; agent stays unchanged. Straightforward but requires a new route.
- `byoc-hashbrown`, `byoc-json-render` — streaming structured-output BYOC
  with Zod-validated catalogs; each has its own runtime route, catalog,
  renderer, and supporting components.
- `beautiful-chat` — branded starter chat with OGUI + A2UI + MCP combined
  runtime; large cross-cutting port.
- `multimodal` — vision-capable AG2 agent + dedicated `/api/copilotkit-multimodal`.
- `voice` — frontend voice STT; needs dedicated `/api/copilotkit-voice` and
  the lazy-init agent shape from langgraph-python.
- `open-gen-ui`, `open-gen-ui-advanced` — OGUI runtime with frontend sandbox.
- `mcp-apps` — MCP server-driven UI. AG2 has MCP support; needs wiring.
- `subagents` expansion — the current `subagents` demo uses the shared
  agent; a GroupChat-based multi-agent port is a separate scope.

## Skipped (missing primitive)

- `gen-ui-interrupt` — requires a LangGraph-style `interrupt()` that
  round-trips a resumable graph pause through the event stream. AG2's
  `human_input_mode` is a synchronous request/reply; it does not resume
  the same run from a persisted checkpoint.
- `interrupt-headless` — same underlying primitive as `gen-ui-interrupt`.
